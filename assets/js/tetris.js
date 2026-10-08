/* ============ 俄罗斯方块 ============ */
(function () {
  const canvas = document.getElementById('tetris-canvas');
  const ctx = canvas.getContext('2d');
  const nextCanvas = document.getElementById('tetris-next');
  const nextCtx = nextCanvas.getContext('2d');

  const COLS = 10;
  const ROWS = 20;
  const CELL = canvas.width / COLS; // 30px
  const NEXT_CELL = nextCanvas.width / 4; // 30px

  // 7 种方块，每种 4 个旋转状态
  const SHAPES = {
    I: [
      [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]],
      [[0,0,1,0],[0,0,1,0],[0,0,1,0],[0,0,1,0]],
      [[0,0,0,0],[0,0,0,0],[1,1,1,1],[0,0,0,0]],
      [[0,1,0,0],[0,1,0,0],[0,1,0,0],[0,1,0,0]]
    ],
    O: [
      [[1,1],[1,1]],
      [[1,1],[1,1]],
      [[1,1],[1,1]],
      [[1,1],[1,1]]
    ],
    T: [
      [[0,1,0],[1,1,1],[0,0,0]],
      [[0,1,0],[0,1,1],[0,1,0]],
      [[0,0,0],[1,1,1],[0,1,0]],
      [[0,1,0],[1,1,0],[0,1,0]]
    ],
    S: [
      [[0,1,1],[1,1,0],[0,0,0]],
      [[0,1,0],[0,1,1],[0,0,1]],
      [[0,0,0],[0,1,1],[1,1,0]],
      [[1,0,0],[1,1,0],[0,1,0]]
    ],
    Z: [
      [[1,1,0],[0,1,1],[0,0,0]],
      [[0,0,1],[0,1,1],[0,1,0]],
      [[0,0,0],[1,1,0],[0,1,1]],
      [[0,1,0],[1,1,0],[1,0,0]]
    ],
    J: [
      [[1,0,0],[1,1,1],[0,0,0]],
      [[0,1,1],[0,1,0],[0,1,0]],
      [[0,0,0],[1,1,1],[0,0,1]],
      [[0,1,0],[0,1,0],[1,1,0]]
    ],
    L: [
      [[0,0,1],[1,1,1],[0,0,0]],
      [[0,1,0],[0,1,0],[0,1,1]],
      [[0,0,0],[1,1,1],[1,0,0]],
      [[1,1,0],[0,1,0],[0,1,0]]
    ]
  };
  const COLORS = {
    I: '#06b6d4', O: '#eab308', T: '#a855f7',
    S: '#22c55e', Z: '#ef4444', J: '#3b82f6', L: '#f97316'
  };
  const KEYS = ['I','O','T','S','Z','J','L'];

  let board = [];
  let current = null;   // { shape, rot, x, y, key }
  let next = null;
  let score = 0;
  let lines = 0;
  let level = 1;
  let best = parseInt(localStorage.getItem('tetris_best') || '0', 10);
  let running = false;
  let paused = false;
  let timer = null;
  let dropCounter = 0;
  let lastTime = 0;

  const $score = document.getElementById('tetris-score');
  const $lines = document.getElementById('tetris-lines');
  const $level = document.getElementById('tetris-level');
  const $best = document.getElementById('tetris-best');
  const $gameover = document.getElementById('tetris-gameover');

  $best.textContent = best;

  function newBoard() {
    return Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  }

  function randomKey() {
    return KEYS[Math.floor(Math.random() * KEYS.length)];
  }

  function newPiece(key) {
    key = key || randomKey();
    const shape = SHAPES[key][0];
    return {
      key,
      shape,
      rot: 0,
      x: Math.floor((COLS - shape[0].length) / 2),
      y: 0
    };
  }

  function rotate(piece) {
    const newRot = (piece.rot + 1) % 4;
    return {
      key: piece.key,
      shape: SHAPES[piece.key][newRot],
      rot: newRot,
      x: piece.x,
      y: piece.y
    };
  }

  function collide(p, dx, dy, shape) {
    shape = shape || p.shape;
    for (let y = 0; y < shape.length; y++) {
      for (let x = 0; x < shape[y].length; x++) {
        if (!shape[y][x]) continue;
        const nx = p.x + x + dx;
        const ny = p.y + y + dy;
        if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
        if (ny >= 0 && board[ny][nx]) return true;
      }
    }
    return false;
  }

  function merge() {
    for (let y = 0; y < current.shape.length; y++) {
      for (let x = 0; x < current.shape[y].length; x++) {
        if (current.shape[y][x]) {
          const by = current.y + y;
          const bx = current.x + x;
          if (by >= 0 && by < ROWS) board[by][bx] = current.key;
        }
      }
    }
  }

  function clearLines() {
    let cleared = 0;
    for (let y = ROWS - 1; y >= 0; y--) {
      if (board[y].every(c => c)) {
        board.splice(y, 1);
        board.unshift(Array(COLS).fill(null));
        cleared++;
        y++; // 重检这一行
      }
    }
    if (cleared) {
      const points = [0, 100, 300, 500, 800][cleared] || 0;
      score += points * level;
      lines += cleared;
      const newLevel = Math.floor(lines / 10) + 1;
      if (newLevel > level) level = newLevel;
      $score.textContent = score;
      $lines.textContent = lines;
      $level.textContent = level;
      if (score > best) {
        best = score;
        $best.textContent = best;
        localStorage.setItem('tetris_best', best);
      }
    }
  }

  function spawn() {
    current = next || newPiece();
    next = newPiece();
    drawNext();
    if (collide(current, 0, 0)) {
      gameOver();
    }
  }

  function drop() {
    if (collide(current, 0, 1)) {
      merge();
      clearLines();
      spawn();
    } else {
      current.y++;
    }
    dropCounter = 0;
  }

  function softDrop() {
    if (!running || paused) return;
    drop();
    draw();
  }

  function move(dx) {
    if (!running || paused || !current) return;
    if (!collide(current, dx, 0)) {
      current.x += dx;
      draw();
    }
  }

  function rotatePiece() {
    if (!running || paused || !current) return;
    const r = rotate(current);
    // 简单墙踢：尝试不偏移、左偏 1、右偏 1
    const tries = [0, -1, 1, -2, 2];
    for (const dx of tries) {
      if (!collide(r, dx, 0)) {
        r.x += dx;
        current = r;
        draw();
        return;
      }
    }
  }

  function hardDrop() {
    if (!running || paused || !current) return;
    while (!collide(current, 0, 1)) {
      current.y++;
      score += 2;
    }
    $score.textContent = score;
    merge();
    clearLines();
    spawn();
    draw();
  }

  function step(time) {
    if (!running || paused) {
      lastTime = time;
      requestAnimationFrame(step);
      return;
    }
    if (!lastTime) lastTime = time;
    const delta = time - lastTime;
    lastTime = time;
    dropCounter += delta;
    // 速度：级别越高越快
    const interval = Math.max(80, 800 - (level - 1) * 70);
    if (dropCounter > interval) {
      drop();
      draw();
    }
    requestAnimationFrame(step);
  }

  function drawCell(c, x, y, color, cellSize) {
    c.fillStyle = color;
    c.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
    c.strokeStyle = 'rgba(0,0,0,0.3)';
    c.lineWidth = 1;
    c.strokeRect(x * cellSize + 0.5, y * cellSize + 0.5, cellSize - 1, cellSize - 1);
  }

  function draw() {
    // 背景
    ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--bg').trim() || '#fafaf9';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // 网格线
    ctx.strokeStyle = 'rgba(0,0,0,0.05)';
    for (let i = 1; i < COLS; i++) {
      ctx.beginPath(); ctx.moveTo(i * CELL, 0); ctx.lineTo(i * CELL, canvas.height); ctx.stroke();
    }
    for (let j = 1; j < ROWS; j++) {
      ctx.beginPath(); ctx.moveTo(0, j * CELL); ctx.lineTo(canvas.width, j * CELL); ctx.stroke();
    }
    // 已固定方块
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (board[y][x]) {
          drawCell(ctx, x, y, COLORS[board[y][x]], CELL);
        }
      }
    }
    // 当前方块
    if (current) {
      // 投影
      let ghostY = current.y;
      while (!collide(current, 0, ghostY - current.y + 1)) ghostY++;
      for (let y = 0; y < current.shape.length; y++) {
        for (let x = 0; x < current.shape[y].length; x++) {
          if (current.shape[y][x]) {
            const gx = current.x + x;
            const gy = ghostY + y;
            if (gy >= 0) {
              ctx.fillStyle = 'rgba(0,0,0,0.15)';
              ctx.fillRect(gx * CELL, gy * CELL, CELL, CELL);
            }
          }
        }
      }
      // 实体
      for (let y = 0; y < current.shape.length; y++) {
        for (let x = 0; x < current.shape[y].length; x++) {
          if (current.shape[y][x]) {
            const gx = current.x + x;
            const gy = current.y + y;
            if (gy >= 0) drawCell(ctx, gx, gy, COLORS[current.key], CELL);
          }
        }
      }
    }
  }

  function drawNext() {
    nextCtx.fillStyle = getComputedStyle(document.body).getPropertyValue('--bg').trim() || '#fafaf9';
    nextCtx.fillRect(0, 0, nextCanvas.width, nextCanvas.height);
    if (!next) return;
    const s = next.shape;
    const offsetX = (4 - s[0].length) / 2;
    const offsetY = (4 - s.length) / 2;
    for (let y = 0; y < s.length; y++) {
      for (let x = 0; x < s[y].length; x++) {
        if (s[y][x]) {
          drawCell(nextCtx, x + offsetX, y + offsetY, COLORS[next.key], NEXT_CELL);
        }
      }
    }
  }

  function gameOver() {
    running = false;
    paused = false;
    $gameover.classList.add('show');
    document.getElementById('tetris-start').textContent = '开始';
  }

  function start() {
    if (running) return;
    running = true;
    paused = false;
    $gameover.classList.remove('show');
    document.getElementById('tetris-start').textContent = '运行中';
    lastTime = 0;
    requestAnimationFrame(step);
  }

  function pause() {
    if (!running) return;
    paused = !paused;
    document.getElementById('tetris-pause').textContent = paused ? '继续' : '暂停';
    if (!paused) lastTime = 0;
  }

  function restart() {
    running = false;
    paused = false;
    board = newBoard();
    score = 0; lines = 0; level = 1;
    $score.textContent = 0;
    $lines.textContent = 0;
    $level.textContent = 1;
    $gameover.classList.remove('show');
    document.getElementById('tetris-start').textContent = '开始';
    document.getElementById('tetris-pause').textContent = '暂停';
    next = null;
    spawn();
    draw();
  }

  // 键盘
  document.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'arrowleft' || k === 'a') { move(-1); e.preventDefault(); }
    else if (k === 'arrowright' || k === 'd') { move(1); e.preventDefault(); }
    else if (k === 'arrowdown' || k === 's') { softDrop(); e.preventDefault(); }
    else if (k === 'arrowup' || k === 'w') { rotatePiece(); e.preventDefault(); }
    else if (k === ' ' || k === 'spacebar') {
      e.preventDefault();
      if (running) hardDrop();
      else start();
    }
    else if (k === 'p') { pause(); e.preventDefault(); }
  });

  document.getElementById('tetris-start').addEventListener('click', () => {
    if (running) pause();
    else start();
  });
  document.getElementById('tetris-pause').addEventListener('click', pause);
  document.getElementById('tetris-restart').addEventListener('click', restart);

  // 移动端方向键：用 touchstart 立即响应，避免 click 延迟
  // preventDefault 阻止触摸引发的滚动/缩放
  document.querySelectorAll('.tetris-dpad button').forEach(btn => {
    const fire = (e) => {
      e.preventDefault();
      const act = btn.dataset.act;
      if (act === 'left') move(-1);
      else if (act === 'right') move(1);
      else if (act === 'down') softDrop();
      else if (act === 'rotate') rotatePiece();
      else if (act === 'drop') hardDrop();
    };
    btn.addEventListener('touchstart', fire, { passive: false });
    btn.addEventListener('click', (e) => {
      if (e.detail === 0) return; // 触摸已处理
      const act = btn.dataset.act;
      if (act === 'left') move(-1);
      else if (act === 'right') move(1);
      else if (act === 'down') softDrop();
      else if (act === 'rotate') rotatePiece();
      else if (act === 'drop') hardDrop();
    });
  });

  function applyConfig() {
    document.getElementById('site-title').textContent = SITE_CONFIG.title;
    document.getElementById('footer-text').textContent = SITE_CONFIG.footer;
  }
  applyConfig();

  // 初始化
  restart();
})();
