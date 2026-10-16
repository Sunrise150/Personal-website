/* ============ 吃豆人 ============ */
(function () {
  const COLS = 28, ROWS = 31;
  const MAX_CANVAS_W = 504;
  let CELL = 18;

  const canvas = document.getElementById('pc-canvas');
  const ctx = canvas.getContext('2d');

  const $score = document.getElementById('pc-score');
  const $lives = document.getElementById('pc-lives');
  const $best = document.getElementById('pc-best');
  const $gameover = document.getElementById('pc-gameover');
  const $win = document.getElementById('pc-win');

  let best = parseInt(localStorage.getItem('pacman_best') || '0', 10);
  $best.textContent = best;

  // 迷宫：0=墙 1=路 2=豆 3=能量豆
  let grid = [];
  let dotsLeft = 0;
  let score = 0;
  let lives = 3;
  let running = false;
  let paused = false;
  let gameOver = false;
  let lastTime = 0;

  const DIRS = {
    up:    { x: 0, y: -1 },
    down:  { x: 0, y: 1 },
    left:  { x: -1, y: 0 },
    right: { x: 1, y: 0 },
    none:  { x: 0, y: 0 }
  };

  let pac = null;
  let ghosts = [];
  let frightened = false;
  let frightenedTimer = 0;

  // ==== 随机迷宫生成（DFS Recursive Backtracker）====
  // 奇数坐标 (1,1), (1,3), (3,1)... 是"格子"，偶数坐标是"墙/通道"
  // 生成后，随机打通一些额外的墙，避免迷宫太线性
  function generateMaze() {
    // 全墙
    const g = [];
    for (let r = 0; r < ROWS; r++) {
      g.push(new Array(COLS).fill(0));
    }
    // DFS 生成（只走奇数坐标的格子）
    const visited = new Set();
    const stack = [{ r: 1, c: 1 }];
    g[1][1] = 1;
    visited.add('1,1');

    while (stack.length) {
      const cur = stack[stack.length - 1];
      const neighbors = [];
      // 四个方向跳 2 格
      const candidates = [
        { r: cur.r - 2, c: cur.c },
        { r: cur.r + 2, c: cur.c },
        { r: cur.r, c: cur.c - 2 },
        { r: cur.r, c: cur.c + 2 }
      ];
      // 打乱
      for (let i = candidates.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
      }
      for (const n of candidates) {
        if (n.r > 0 && n.r < ROWS - 1 && n.c > 0 && n.c < COLS - 1 &&
            !visited.has(n.r + ',' + n.c)) {
          // 打通中间的墙
          g[(cur.r + n.r) / 2][(cur.c + n.c) / 2] = 1;
          g[n.r][n.c] = 1;
          visited.add(n.r + ',' + n.c);
          neighbors.push(n);
          break;
        }
      }
      if (neighbors.length) {
        stack.push(neighbors[0]);
      } else {
        stack.pop();
      }
    }

    // 额外随机打通一些墙（20% 的内部墙），让迷宫不那么线性
    for (let r = 1; r < ROWS - 1; r++) {
      for (let c = 1; c < COLS - 1; c++) {
        if (g[r][c] === 0 && Math.random() < 0.12) {
          // 只打通周围至少有 2 个通路的墙（避免孤立区域）
          const paths = (g[r-1][c] === 1 ? 1 : 0) + (g[r+1][c] === 1 ? 1 : 0) +
                        (g[r][c-1] === 1 ? 1 : 0) + (g[r][c+1] === 1 ? 1 : 0);
          if (paths >= 2) g[r][c] = 1;
        }
      }
    }

    // 隧道：确保左右两侧某一行是通路
    // 找一行让整行都是路
    const tunnelRow = 1 + Math.floor(Math.random() * (ROWS - 2));
    for (let c = 0; c < COLS; c++) g[tunnelRow][c] = 1;
    // 边界保持墙（除了隧道行）
    for (let c = 0; c < COLS; c++) { g[0][c] = 0; g[ROWS - 1][c] = 0; }
    for (let r = 0; r < ROWS; r++) { g[r][0] = 0; g[r][COLS - 1] = 0; }
    // 隧道行两端开口
    g[tunnelRow][0] = 1; g[tunnelRow][COLS - 1] = 1;

    return g;
  }

  // 从 grid 中找所有通路格子，随机选一个
  function findOpenCells(g) {
    const cells = [];
    for (let r = 1; r < ROWS - 1; r++) {
      for (let c = 1; c < COLS - 1; c++) {
        if (g[r][c] === 1) cells.push({ r, c });
      }
    }
    return cells;
  }

  // ==== 初始化 ====
  function initLevel() {
    grid = generateMaze();

    // 找通路，选吃豆人和幽灵的位置
    const open = findOpenCells(grid);
    // 吃豆人在底部区域
    const bottomArea = open.filter(c => c.r > ROWS * 0.6);
    const pacStart = bottomArea[Math.floor(Math.random() * bottomArea.length)] || open[0];

    // 幽灵在顶部/中部区域，远离吃豆人
    const topArea = open.filter(c => c.r < ROWS * 0.5 &&
      Math.hypot(c.r - pacStart.r, c.c - pacStart.c) > 8);
    const ghostSpots = [];
    const pool = topArea.length > 0 ? topArea : open;
    // 选 4 个互相远离的点
    for (let i = 0; i < 4 && pool.length > 0; i++) {
      const idx = Math.floor(Math.random() * pool.length);
      ghostSpots.push(pool[idx]);
      pool.splice(idx, 1);
    }

    // 撒豆子：所有通路格子放豆，能量豆放 4 个角落附近
    dotsLeft = 0;
    for (let r = 1; r < ROWS - 1; r++) {
      for (let c = 1; c < COLS - 1; c++) {
        if (grid[r][c] === 1) { grid[r][c] = 2; dotsLeft++; }
      }
    }
    // 能量豆：随机 4 个远离吃豆人的位置
    const energySpots = [];
    const allOpen = open.filter(c =>
      Math.hypot(c.r - pacStart.r, c.c - pacStart.c) > 5 && grid[c.r][c.c] === 2);
    for (let i = 0; i < 4 && allOpen.length > 0; i++) {
      const idx = Math.floor(Math.random() * allOpen.length);
      energySpots.push(allOpen[idx]);
      allOpen.splice(idx, 1);
    }
    for (const s of energySpots) { grid[s.r][s.c] = 3; }

    // 吃豆人位置设为路（不是豆）
    grid[pacStart.r][pacStart.c] = 1;
    // 幽灵位置也是路
    for (const s of ghostSpots) { grid[s.r][s.c] = 1; }

    // 创建实体
    pac = {
      r: pacStart.r, c: pacStart.c,
      subX: 0, subY: 0, dir: 'none', nextDir: 'none',
      speed: 90, mouth: 0
    };
    const gnames = ['blinky', 'pinky', 'inky', 'clyde'];
    const gcolors = { blinky: '#ef4444', pinky: '#f9a8d4', inky: '#22d3ee', clyde: '#fb923c' };
    ghosts = ghostSpots.map((s, i) => ({
      name: gnames[i], r: s.r, c: s.c, subX: 0, subY: 0,
      dir: 'up', nextDir: 'up', speed: 70, eaten: false
    }));
  }

  function reset() {
    initLevel();
    score = 0; lives = 3;
    frightened = false; frightenedTimer = 0;
    $score.textContent = 0; $lives.textContent = 3;
    $gameover.classList.remove('show'); $win.classList.remove('show');
  }

  function start() {
    if (running) return;
    reset(); running = true; paused = false; lastTime = 0;
    requestAnimationFrame(loop);
  }
  function restart() {
    reset(); running = true; paused = false; lastTime = 0;
    document.getElementById('pc-pause').textContent = '暂停';
  }
  function pause() {
    if (!running) return;
    paused = !paused;
    document.getElementById('pc-pause').textContent = paused ? '继续' : '暂停';
    if (!paused) lastTime = 0;
  }

  function isWall(r, c, forGhost) {
    if (c < 0 || c >= COLS) return false; // 隧道
    if (r < 0 || r >= ROWS) return true;
    return grid[r][c] === 0;
  }

  function pxOf(e) { return e.c * CELL + CELL / 2 + e.subX * CELL; }
  function pyOf(e) { return e.r * CELL + CELL / 2 + e.subY * CELL; }

  // ==== 核心移动 ====
  function moveGridEntity(e, dt, speedCellsPerSec, forGhost) {
    const atCenter = Math.abs(e.subX) < 0.01 && Math.abs(e.subY) < 0.01;
    if (atCenter && e.nextDir && e.nextDir !== e.dir) {
      const nd = DIRS[e.nextDir];
      if (nd && !isWall(e.r + nd.y, e.c + nd.x, forGhost)) {
        e.dir = e.nextDir;
        e.nextDir = e.dir;
      }
    }

    const d = DIRS[e.dir];
    if (!d || (d.x === 0 && d.y === 0)) return;

    const step = speedCellsPerSec * dt;
    if (d.x !== 0) e.subX += d.x * step;
    if (d.y !== 0) e.subY += d.y * step;

    const mainAxis = d.x !== 0 ? 'subX' : 'subY';
    const otherAxis = d.x !== 0 ? 'subY' : 'subX';
    const mainDelta = d.x !== 0 ? d.x : d.y;

    while ((mainDelta > 0 && e[mainAxis] >= 0.5) || (mainDelta < 0 && e[mainAxis] <= -0.5)) {
      const nr = e.r + (d.y !== 0 ? mainDelta : 0);
      const nc = e.c + (d.x !== 0 ? mainDelta : 0);

      if (isWall(nr, nc, forGhost)) {
        e[mainAxis] = 0;
        e[otherAxis] = 0;
        if (e.nextDir && e.nextDir !== e.dir) {
          const nd = DIRS[e.nextDir];
          if (nd && !isWall(e.r + nd.y, e.c + nd.x, forGhost)) {
            e.dir = e.nextDir; e.nextDir = e.dir;
          }
        }
        return;
      }

      if (d.x !== 0) e.c = nc; else e.r = nr;
      e[mainAxis] -= mainDelta;
      e[otherAxis] = 0;

      if (e.c < 0) e.c = COLS - 1;
      if (e.c >= COLS) e.c = 0;

      if (e.nextDir && e.nextDir !== e.dir) {
        const nd = DIRS[e.nextDir];
        if (nd && !isWall(e.r + nd.y, e.c + nd.x, forGhost)) {
          e.dir = e.nextDir; e.nextDir = e.dir;
          break;
        }
      }
    }
  }

  // ==== 幽灵 AI ====
  function opp(d) {
    return { up: 'down', down: 'up', left: 'right', right: 'left', none: 'none' }[d];
  }

  function ghostTarget(g) {
    const pr = pac.r, pc = pac.c;
    const pd = DIRS[pac.dir] || DIRS.none;
    switch (g.name) {
      case 'blinky': return { r: pr, c: pc };
      case 'pinky':  return { r: pr + pd.y * 4, c: pc + pd.x * 4 };
      case 'inky': {
        const tr = pr + pd.y * 2, tc = pc + pd.x * 2;
        const br = ghosts[0].r, bc = ghosts[0].c;
        return { r: tr + (tr - br), c: tc + (tc - bc) };
      }
      case 'clyde': {
        const dist = Math.hypot(pr - g.r, pc - g.c);
        if (dist > 8) return { r: pr, c: pc };
        return { r: 1, c: 1 };
      }
    }
  }

  function chooseGhostDir(g) {
    if (Math.abs(g.subX) > 0.01 || Math.abs(g.subY) > 0.01) return;
    const target = ghostTarget(g);
    let options = ['up', 'down', 'left', 'right'].filter(d => {
      if (d === opp(g.dir)) return false;
      const nd = DIRS[d];
      return !isWall(g.r + nd.y, g.c + nd.x, true);
    });
    if (!options.length) {
      options = ['up', 'down', 'left', 'right'].filter(d => {
        const nd = DIRS[d];
        return !isWall(g.r + nd.y, g.c + nd.x, true);
      });
    }
    if (!options.length) return;

    if (frightened && !g.eaten) {
      g.nextDir = options[Math.floor(Math.random() * options.length)];
      return;
    }
    let best = options[0], bestD = Infinity;
    for (const d of options) {
      const nd = DIRS[d];
      const nr = g.r + nd.y, nc = g.c + nd.x;
      const dist = Math.hypot(target.r - nr, target.c - nc);
      if (dist < bestD) { bestD = dist; best = d; }
    }
    g.nextDir = best;
  }

  // ==== 更新 ====
  function update(dt) {
    if (!pac || gameOver) return;

    if (frightened) {
      frightenedTimer -= dt;
      if (frightenedTimer <= 0) {
        frightened = false;
        ghosts.forEach(g => g.eaten = false);
      }
    }

    moveGridEntity(pac, dt, pac.speed / CELL, false);
    const v = grid[pac.r][pac.c];
    if (v === 2) { grid[pac.r][pac.c] = 1; score += 10; dotsLeft--; }
    else if (v === 3) {
      grid[pac.r][pac.c] = 1; score += 50; dotsLeft--;
      frightened = true; frightenedTimer = 7;
      ghosts.forEach(g => g.eaten = false);
    }
    $score.textContent = score;
    if (score > best) { best = score; localStorage.setItem('pacman_best', best); $best.textContent = best; }
    if (dotsLeft <= 0) { gameOver = true; $win.classList.add('show'); }
    pac.mouth += dt * 8;

    for (const g of ghosts) {
      if (g.eaten) {
        // 回家：直奔吃豆人附近（被吃后随机复活在某个通路）
        const homeR = 1, homeC = 1;
        if (Math.abs(g.subX) < 0.01 && Math.abs(g.subY) < 0.01) {
          const dr = homeR - g.r, dc = homeC - g.c;
          if (Math.abs(dr) + Math.abs(dc) <= 1) {
            g.eaten = false;
          } else {
            if (Math.abs(dr) > Math.abs(dc)) {
              g.nextDir = dr < 0 ? 'up' : 'down';
            } else {
              g.nextDir = dc < 0 ? 'left' : 'right';
            }
          }
        }
        moveGridEntity(g, dt, 160 / CELL, true);
      } else {
        chooseGhostDir(g);
        const sp = frightened ? 50 : 70;
        moveGridEntity(g, dt, sp / CELL, true);
      }
    }

    for (const g of ghosts) {
      const dx = pxOf(g) - pxOf(pac), dy = pyOf(g) - pyOf(pac);
      if (Math.hypot(dx, dy) < CELL * 0.7) {
        if (g.eaten) continue;
        if (frightened) {
          g.eaten = true; score += 200; $score.textContent = score;
        } else {
          lives--; $lives.textContent = lives;
          if (lives <= 0) { endGame(); }
          else {
            // 重置位置但不换地图
            initLevel();
            score = parseInt($score.textContent) || 0;
          }
          break;
        }
      }
    }
  }

  function endGame() {
    running = false; gameOver = true;
    $gameover.classList.add('show');
  }

  // ==== 绘制 ====
  function draw() {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 墙
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (grid[r][c] === 0) {
          ctx.fillStyle = '#1e40af';
          ctx.fillRect(c * CELL + 1, r * CELL + 1, CELL - 2, CELL - 2);
          ctx.strokeStyle = '#3b82f6';
          ctx.lineWidth = 1;
          ctx.strokeRect(c * CELL + 1.5, r * CELL + 1.5, CELL - 3, CELL - 3);
        }
      }
    }

    // 豆子
    ctx.fillStyle = '#fde68a';
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const v = grid[r][c];
        const cx = c * CELL + CELL / 2;
        const cy = r * CELL + CELL / 2;
        if (v === 2) { ctx.beginPath(); ctx.arc(cx, cy, 1.8, 0, Math.PI * 2); ctx.fill(); }
        else if (v === 3) {
          ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#fff';
          ctx.beginPath(); ctx.arc(cx, cy, 3, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#fde68a';
        }
      }
    }

    if (pac) drawPac();
    for (const g of ghosts) drawGhost(g);
  }

  function drawPac() {
    const cx = pxOf(pac), cy = pyOf(pac);
    const r = CELL * 0.45;
    const mouthOpen = Math.abs(Math.sin(pac.mouth)) * 0.4;
    let rot = 0;
    if (pac.dir === 'right') rot = 0;
    else if (pac.dir === 'down') rot = Math.PI / 2;
    else if (pac.dir === 'left') rot = Math.PI;
    else if (pac.dir === 'up') rot = -Math.PI / 2;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(rot);
    ctx.fillStyle = '#fbbf24';
    ctx.beginPath(); ctx.moveTo(0, 0);
    ctx.arc(0, 0, r, mouthOpen, Math.PI * 2 - mouthOpen);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  function drawGhost(g) {
    const cx = pxOf(g), cy = pyOf(g);
    const r = CELL * 0.42;
    const colorMap = { blinky: '#ef4444', pinky: '#f9a8d4', inky: '#22d3ee', clyde: '#fb923c' };
    let color = colorMap[g.name];
    if (g.eaten) { /* 只画眼睛 */ }
    else if (frightened) {
      color = frightenedTimer < 2 && Math.floor(frightenedTimer * 8) % 2 === 0 ? '#fff' : '#1e40af';
    }
    if (!g.eaten) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(cx, cy - 1, r, Math.PI, 0);
      const waveY = cy + r, segs = 4, segW = (r * 2) / segs;
      for (let i = 0; i < segs; i++) {
        const x1 = cx + r - i * segW, x2 = x1 - segW / 2;
        ctx.lineTo(x1, waveY);
        ctx.lineTo(x2, waveY - (i % 2 === 0 ? r * 0.25 : 0));
      }
      ctx.lineTo(cx - r, cy - 1);
      ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = '#fff';
    let eoy = 0;
    if (g.dir === 'up' || g.nextDir === 'up') eoy = -2;
    else if (g.dir === 'down' || g.nextDir === 'down') eoy = 2;
    const lex = cx - r * 0.4, rex = cx + r * 0.4, ey = cy - r * 0.1;
    ctx.beginPath(); ctx.arc(lex, ey, 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(rex, ey, 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.arc(lex, ey + eoy * 0.5, 1.8, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(rex, ey + eoy * 0.5, 1.8, 0, Math.PI * 2); ctx.fill();
  }

  // ==== 主循环 ====
  function loop(time) {
    if (!lastTime) lastTime = time;
    const dt = Math.min(0.05, (time - lastTime) / 1000);
    lastTime = time;
    if (running && !paused) update(dt);
    draw();
    requestAnimationFrame(loop);
  }

  // ==== 输入 ====
  const GAME_KEYS = ['arrowup','arrowdown','arrowleft','arrowright',' ','w','a','s','d','p'];
  document.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (GAME_KEYS.includes(k)) e.preventDefault();
    if (!pac) return;
    if (k === 'arrowup' || k === 'w') pac.nextDir = 'up';
    else if (k === 'arrowdown' || k === 's') pac.nextDir = 'down';
    else if (k === 'arrowleft' || k === 'a') pac.nextDir = 'left';
    else if (k === 'arrowright' || k === 'd') pac.nextDir = 'right';
    else if (k === 'p') pause();
    else if (k === ' ') { if (!running) start(); else pause(); }
  });

  document.getElementById('pc-start').addEventListener('click', () => { if (running) restart(); else start(); });
  document.getElementById('pc-pause').addEventListener('click', pause);
  document.getElementById('pc-restart').addEventListener('click', restart);

  document.querySelectorAll('.pc-dpad button').forEach(btn => {
    const fire = (e) => {
      e.preventDefault();
      if (!pac) return;
      pac.nextDir = btn.dataset.dir;
      if (!running) start();
    };
    btn.addEventListener('touchstart', fire, { passive: false });
    btn.addEventListener('click', (e) => { if (e.detail !== 0) fire(e); });
  });

  // ==== Canvas 响应式 ====
  function resizeCanvas() {
    const wrap = canvas.parentElement;
    const avail = wrap.clientWidth - 32;
    const ratio = ROWS / COLS;
    let w = Math.min(avail, MAX_CANVAS_W);
    let h = w * ratio;
    const maxH = window.innerHeight - 300;
    if (h > maxH) { h = maxH; w = h / ratio; }
    CELL = Math.max(10, Math.floor(w / COLS));
    canvas.width = CELL * COLS;
    canvas.height = CELL * ROWS;
    canvas.style.width = canvas.width + 'px';
    canvas.style.height = canvas.height + 'px';
  }
  window.addEventListener('resize', resizeCanvas);

  function applyConfig() {
    document.getElementById('site-title').textContent = SITE_CONFIG.title;
    document.getElementById('footer-text').textContent = SITE_CONFIG.footer;
  }
  applyConfig();

  resizeCanvas();
  reset();
  requestAnimationFrame(loop);
})();
