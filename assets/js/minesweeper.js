/* ============ 扫雷游戏 ============ */
(function () {
  const LEVELS = {
    easy:   { rows: 9,  cols: 9,  mines: 10 },
    medium: { rows: 16, cols: 16, mines: 40 },
    hard:   { rows: 16, cols: 30, mines: 99 }
  };

  let level = 'easy';
  let rows, cols, totalMines;
  let board = [];       // 二维数组：0=空, -1=雷, 1~8=周围雷数
  let revealed = [];    // 是否已揭开
  let flagged = [];     // 是否标旗
  let firstClick = true;
  let gameOver = false;
  let win = false;
  let timer = null;
  let seconds = 0;
  let flagCount = 0;

  const $board = document.getElementById('ms-board');
  const $mines = document.getElementById('ms-mines');
  const $time = document.getElementById('ms-time');
  const $best = document.getElementById('ms-best');
  const $result = document.getElementById('ms-result');

  function loadBest() {
    const key = 'minesweeper_best_' + level;
    const v = parseInt(localStorage.getItem(key) || '0', 10);
    $best.textContent = v > 0 ? v + 's' : '—';
  }

  function init() {
    const cfg = LEVELS[level];
    rows = cfg.rows; cols = cfg.cols; totalMines = cfg.mines;
    $board.dataset.level = level;
    board = Array.from({ length: rows }, () => Array(cols).fill(0));
    revealed = Array.from({ length: rows }, () => Array(cols).fill(false));
    flagged = Array.from({ length: rows }, () => Array(cols).fill(false));
    firstClick = true;
    gameOver = false;
    win = false;
    flagCount = 0;
    seconds = 0;
    clearInterval(timer);
    timer = null;
    $time.textContent = '0';
    $mines.textContent = totalMines;
    $result.className = 'ms-result';
    $result.textContent = '';
    loadBest();
    render();
  }

  function placeMines(safeR, safeC) {
    // 首次点击安全：safeR/safeC 及其周围 8 格不布雷
    const safe = new Set();
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const r = safeR + dr, c = safeC + dc;
        if (r >= 0 && r < rows && c >= 0 && c < cols) safe.add(r * cols + c);
      }
    }
    let placed = 0;
    while (placed < totalMines) {
      const r = Math.floor(Math.random() * rows);
      const c = Math.floor(Math.random() * cols);
      if (board[r][c] === -1 || safe.has(r * cols + c)) continue;
      board[r][c] = -1;
      placed++;
    }
    // 计算周围雷数
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (board[r][c] === -1) continue;
        let n = 0;
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (!dr && !dc) continue;
            const nr = r + dr, nc = c + dc;
            if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && board[nr][nc] === -1) n++;
          }
        }
        board[r][c] = n;
      }
    }
  }

  function render() {
    $board.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    $board.innerHTML = '';
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cell = document.createElement('div');
        cell.className = 'ms-cell';
        cell.dataset.r = r;
        cell.dataset.c = c;
        if (revealed[r][c]) {
          cell.classList.add('revealed');
          if (board[r][c] === -1) {
            cell.classList.add('mine');
            cell.textContent = '💣';
          } else if (board[r][c] > 0) {
            cell.dataset.n = board[r][c];
            cell.textContent = board[r][c];
          }
        } else if (flagged[r][c]) {
          cell.classList.add('flagged');
          cell.textContent = '🚩';
        }
        $board.appendChild(cell);
      }
    }
  }

  function startTimer() {
    if (timer) return;
    timer = setInterval(() => {
      seconds++;
      $time.textContent = seconds;
    }, 1000);
  }

  function reveal(r, c) {
    if (r < 0 || r >= rows || c < 0 || c >= cols) return;
    if (revealed[r][c] || flagged[r][c]) return;
    revealed[r][c] = true;
    if (board[r][c] === -1) return;
    if (board[r][c] === 0) {
      // 空白区域递归展开
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          reveal(r + dr, c + dc);
        }
      }
    }
  }

  function checkWin() {
    let unrevealed = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (!revealed[r][c]) unrevealed++;
      }
    }
    // 所有非雷格都已揭开
    if (unrevealed === totalMines) {
      win = true;
      gameOver = true;
      clearInterval(timer);
      // 自动给所有雷插旗
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (board[r][c] === -1) flagged[r][c] = true;
        }
      }
      // 保存最佳时间
      const key = 'minesweeper_best_' + level;
      const best = parseInt(localStorage.getItem(key) || '0', 10);
      if (!best || seconds < best) localStorage.setItem(key, seconds);
      $result.className = 'ms-result win';
      $result.textContent = `🎉 胜利！用时 ${seconds}s`;
    }
  }

  function loseGame() {
    gameOver = true;
    clearInterval(timer);
    // 揭示所有雷
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (board[r][c] === -1) revealed[r][c] = true;
        // 错误标旗
        if (flagged[r][c] && board[r][c] !== -1) {
          const idx = r * cols + c;
          $board.children[idx].classList.add('wrong-flag');
        }
      }
    }
    $result.className = 'ms-result lose';
    $result.textContent = '💥 踩到雷了！';
  }

  function onCellClick(r, c) {
    if (gameOver || flagged[r][c] || revealed[r][c]) return;
    if (firstClick) {
      placeMines(r, c);
      firstClick = false;
      startTimer();
    }
    if (board[r][c] === -1) {
      revealed[r][c] = true;
      render();
      loseGame();
      return;
    }
    reveal(r, c);
    render();
    checkWin();
  }

  function onCellRightClick(r, c) {
    if (gameOver || revealed[r][c]) return;
    if (flagged[r][c]) {
      flagged[r][c] = false;
      flagCount--;
    } else {
      flagged[r][c] = true;
      flagCount++;
    }
    $mines.textContent = totalMines - flagCount;
    render();
  }

  // 事件委托
  $board.addEventListener('click', (e) => {
    const cell = e.target.closest('.ms-cell');
    if (!cell) return;
    onCellClick(Number(cell.dataset.r), Number(cell.dataset.c));
  });
  $board.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const cell = e.target.closest('.ms-cell');
    if (!cell) return;
    onCellRightClick(Number(cell.dataset.r), Number(cell.dataset.c));
  });

  // 移动端：长按 = 标旗
  let longPressTimer = null;
  let longPressFired = false;
  let longPressTarget = null;
  $board.addEventListener('touchstart', (e) => {
    const cell = e.target.closest('.ms-cell');
    if (!cell) return;
    e.preventDefault();
    longPressFired = false;
    longPressTarget = cell;
    longPressTimer = setTimeout(() => {
      longPressFired = true;
      onCellRightClick(Number(cell.dataset.r), Number(cell.dataset.c));
    }, 500);
  }, { passive: false });
  $board.addEventListener('touchend', (e) => {
    if (longPressTimer) clearTimeout(longPressTimer);
    if (longPressFired) {
      e.preventDefault();
      longPressFired = false;
    }
  }, { passive: false });
  $board.addEventListener('touchmove', () => {
    if (longPressTimer) clearTimeout(longPressTimer);
  }, { passive: false });

  // 难度切换
  document.querySelectorAll('.ms-difficulty button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.ms-difficulty button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      level = btn.dataset.level;
      init();
    });
  });

  document.getElementById('ms-restart').addEventListener('click', init);

  // 配置
  function applyConfig() {
    document.getElementById('site-title').textContent = SITE_CONFIG.title;
    document.getElementById('footer-text').textContent = SITE_CONFIG.footer;
  }
  applyConfig();

  init();
})();
