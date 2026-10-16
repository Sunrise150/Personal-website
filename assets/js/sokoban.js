/* ============ 推箱子 ============ */
(function () {
  // 关卡：#墙  空地 .目标 $箱子 @玩家 *箱子在目标上 +玩家在目标上
  // 每个关卡箱子数 = 目标数
  const LEVELS = [
    // 1 - 入门 1箱 (b=1 t=1)
    [
      "#####",
      "#   #",
      "# . #",
      "#   #",
      "# $ #",
      "# @ #",
      "#####"
    ],
    // 2 - 2箱 (b=2 t=2)
    [
      "#######",
      "#     #",
      "# . . #",
      "#     #",
      "# $ $ #",
      "#  @  #",
      "#######"
    ],
    // 3 - 2箱 (b=2 t=2)
    [
      "########",
      "#      #",
      "# . .  #",
      "#      #",
      "# $ $  #",
      "#  @   #",
      "########"
    ],
    // 4 - 3箱 (b=3 t=3)
    [
      "########",
      "#      #",
      "# . . .#",
      "#      #",
      "# $ $ $#",
      "#  @   #",
      "########"
    ],
    // 5 - 3箱 带墙 (b=3 t=3)
    [
      "########",
      "#      #",
      "# . .  #",
      "# ##   #",
      "# $ $  #",
      "#  $ @ #",
      "#   .  #",
      "########"
    ],
    // 6 - 4箱 (b=4 t=4)
    [
      "########",
      "#      #",
      "# .**. #",
      "#      #",
      "# $  $ #",
      "#      #",
      "# $  $ #",
      "#  @   #",
      "########"
    ],
    // 7 - 4箱 (b=4 t=4)
    [
      "#########",
      "#       #",
      "# . . . #",
      "#  $ $  #",
      "#  $ $  #",
      "#  @    #",
      "#    .  #",
      "#########"
    ],
    // 8 - 5箱 (b=5 t=5)
    [
      "#########",
      "#       #",
      "# . . . #",
      "#  $ $  #",
      "# $ @ $ #",
      "#  $    #",
      "#  . . .#",
      "#########"
    ],
    // 9 - 5箱 (b=5 t=5)
    [
      "##########",
      "#        #",
      "# . . . .#",
      "#  $ $ $ #",
      "# $ @ $  #",
      "#  $     #",
      "#   . . .#",
      "##########"
    ],
    // 10 - 6箱 (b=6 t=6)
    [
      "##########",
      "#        #",
      "# . . .  #",
      "#  $ $   #",
      "# $ @ $  #",
      "#  $ $   #",
      "# . . .  #",
      "##########"
    ],
    // 11 - 7箱 (b=7 t=7)
    [
      "##########",
      "#        #",
      "# . . . .#",
      "#  $ $ $ #",
      "# $  @ $ #",
      "#  $ $   #",
      "#  . . . #",
      "##########"
    ],
    // 12 - 8箱 困难 (b=8 t=8)
    [
      "###########",
      "#         #",
      "# . . . . #",
      "#  $ $ $  #",
      "# $  @  $ #",
      "#  $ $ $  #",
      "# . . . . #",
      "#    . .  #",
      "###########"
    ]
  ];

  const DIRS = {
    up:    { dr: -1, dc: 0 },
    down:  { dr: 1,  dc: 0 },
    left:  { dr: 0,  dc: -1 },
    right: { dr: 0,  dc: 1 }
  };

  // 解析关卡：返回 { grid, boxes, targets, player }
  // grid: 0=墙, 1=地板
  // boxes: Set of "r,c"
  // targets: Set of "r,c"
  // player: { r, c }
  function parseLevel(map) {
    const rows = map.length;
    const cols = Math.max(...map.map(r => r.length));
    const grid = [];
    const boxes = new Set();
    const targets = new Set();
    let player = null;

    for (let r = 0; r < rows; r++) {
      const row = [];
      for (let c = 0; c < cols; c++) {
        const ch = map[r][c] || ' ';
        if (ch === '#') { row.push(0); }
        else { row.push(1); }

        if (ch === '.' || ch === '+' || ch === '*') targets.add(r + ',' + c);
        if (ch === '$' || ch === '*') boxes.add(r + ',' + c);
        if (ch === '@' || ch === '+') player = { r, c };
      }
      grid.push(row);
    }
    // 校验：箱子数 = 目标数
    if (boxes.size !== targets.size) {
      console.error('[Sokoban] 关卡箱子数(' + boxes.size + ') != 目标数(' + targets.size + ')');
    }
    if (!player) console.error('[Sokoban] 关卡缺少玩家(@)');
    return { grid, boxes, targets, player };
  }

  let level = 0;
  let state = null;    // { grid, boxes, targets, player }
  let history = [];    // 撤销栈
  let steps = 0;
  let won = false;

  const $board = document.getElementById('sk-board');
  const $steps = document.getElementById('sk-steps');
  const $lv = document.getElementById('sk-lv');
  const $win = document.getElementById('sk-win');
  const $levels = document.getElementById('sk-levels');

  const PROGRESS_KEY = 'sokoban_progress';
  let progress = JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{"done":[]}');

  function loadLevel(idx) {
    level = Math.max(0, Math.min(LEVELS.length - 1, idx));
    state = parseLevel(LEVELS[level]);
    history = [];
    steps = 0;
    won = false;
    $steps.textContent = 0;
    $lv.textContent = level + 1;
    $win.classList.remove('show');
    renderBoard();
    renderLevels();
  }

  function renderBoard() {
    const { grid, boxes, targets, player } = state;
    let html = '';
    for (let r = 0; r < grid.length; r++) {
      html += '<div class="sk-row">';
      for (let c = 0; c < grid[r].length; c++) {
        const isWall = grid[r][c] === 0;
        const isTarget = targets.has(r + ',' + c);
        const isBox = boxes.has(r + ',' + c);
        const isPlayer = player.r === r && player.c === c;

        let cls = 'sk-cell ';
        let content = '';
        if (isWall) {
          cls += 'wall';
        } else if (isBox && isTarget) {
          cls += 'box-on-target';
          content = '📦';
        } else if (isBox) {
          cls += 'box';
          content = '📦';
        } else if (isPlayer && isTarget) {
          cls += 'player-on-target';
          content = '🧍';
        } else if (isPlayer) {
          cls += 'player';
          content = '🧍';
        } else if (isTarget) {
          cls += 'target';
          content = '⭐';
        } else {
          cls += 'floor';
        }
        html += `<div class="${cls}">${content}</div>`;
      }
      html += '</div>';
    }
    $board.innerHTML = html;
  }

  function renderLevels() {
    let html = '';
    for (let i = 0; i < LEVELS.length; i++) {
      let cls = 'sk-level';
      if (i === level) cls += ' active';
      if (progress.done.includes(i)) cls += ' done';
      html += `<button class="${cls}" data-idx="${i}">${i + 1}</button>`;
    }
    $levels.innerHTML = html;
    $levels.querySelectorAll('.sk-level').forEach(btn => {
      btn.addEventListener('click', () => loadLevel(parseInt(btn.dataset.idx)));
    });
  }

  function saveState() {
    // 深拷贝当前状态到历史
    history.push({
      boxes: new Set(state.boxes),
      player: { r: state.player.r, c: state.player.c }
    });
    if (history.length > 500) history.shift(); // 防止内存泄漏
  }

  function undo() {
    if (won) return;
    const prev = history.pop();
    if (!prev) return;
    state.boxes = prev.boxes;
    state.player = prev.player;
    steps = Math.max(0, steps - 1);
    $steps.textContent = steps;
    renderBoard();
  }

  function reset() {
    loadLevel(level);
  }

  function isWin() {
    const { boxes, targets } = state;
    if (boxes.size !== targets.size) return false;
    for (const b of boxes) {
      if (!targets.has(b)) return false;
    }
    return true;
  }

  function move(dir) {
    if (won) return;
    const d = DIRS[dir];
    if (!d) return;

    const nr = state.player.r + d.dr;
    const nc = state.player.c + d.dc;

    // 越界或墙
    if (nr < 0 || nr >= state.grid.length || nc < 0 || nc >= state.grid[nr].length) return;
    if (state.grid[nr][nc] === 0) return;

    const boxKey = nr + ',' + nc;
    const hasBox = state.boxes.has(boxKey);

    if (hasBox) {
      // 推箱子
      const br = nr + d.dr;
      const bc = nc + d.dc;
      // 箱子新位置越界或墙或已有箱子
      if (br < 0 || br >= state.grid.length || bc < 0 || bc >= state.grid[br].length) return;
      if (state.grid[br][bc] === 0) return;
      if (state.boxes.has(br + ',' + bc)) return;

      saveState();
      state.boxes.delete(boxKey);
      state.boxes.add(br + ',' + bc);
      state.player = { r: nr, c: nc };
      steps++;
      $steps.textContent = steps;
      renderBoard();

      if (isWin()) {
        won = true;
        $win.classList.add('show');
        if (!progress.done.includes(level)) {
          progress.done.push(level);
          localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
        }
        renderLevels();
      }
    } else {
      // 直接移动
      saveState();
      state.player = { r: nr, c: nc };
      steps++;
      $steps.textContent = steps;
      renderBoard();
    }
  }

  // ==== 输入 ====
  const GAME_KEYS = ['arrowup','arrowdown','arrowleft','arrowright',' ','w','a','s','d','z','r','n','p'];
  document.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (GAME_KEYS.includes(k)) e.preventDefault();
    if (k === 'arrowup' || k === 'w') move('up');
    else if (k === 'arrowdown' || k === 's') move('down');
    else if (k === 'arrowleft' || k === 'a') move('left');
    else if (k === 'arrowright' || k === 'd') move('right');
    else if (k === 'z') undo();
    else if (k === 'r') reset();
    else if (k === 'n') loadLevel(level + 1);
    else if (k === 'p') loadLevel(level - 1);
  });

  document.getElementById('sk-undo').addEventListener('click', undo);
  document.getElementById('sk-reset').addEventListener('click', reset);
  document.getElementById('sk-prev').addEventListener('click', () => loadLevel(level - 1));
  document.getElementById('sk-next').addEventListener('click', () => loadLevel(level + 1));

  document.querySelectorAll('.sk-dpad button').forEach(btn => {
    const fire = (e) => { e.preventDefault(); move(btn.dataset.dir); };
    btn.addEventListener('touchstart', fire, { passive: false });
    btn.addEventListener('click', (e) => { if (e.detail !== 0) fire(e); });
  });

  function applyConfig() {
    document.getElementById('site-title').textContent = SITE_CONFIG.title;
    document.getElementById('footer-text').textContent = SITE_CONFIG.footer;
  }
  applyConfig();

  loadLevel(0);
})();
