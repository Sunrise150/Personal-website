/* ============ 数独游戏 ============ */
(function () {
  const HOLES = { easy: 35, medium: 45, hard: 55 };

  let solution = [];    // 完整解 9x9
  let puzzle = [];      // 题目 9x9 (0=空)
  let current = [];     // 当前填入状态 9x9
  let notes = [];       // 笔记 9x9 每格是 Set
  let fixed = [];       // 是否原题数字不可改
  let selected = null;  // { r, c }
  let noteMode = false;
  let history = [];     // 撤销栈
  let timer = null;
  let seconds = 0;
  let level = 'easy';
  let gameOver = false;

  const $board = document.getElementById('sd-board');
  const $time = document.getElementById('sd-time');
  const $progress = document.getElementById('sd-progress');
  const $result = document.getElementById('sd-result');

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function generateSolution() {
    const grid = Array.from({ length: 9 }, () => Array(9).fill(0));
    function solve() {
      for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
          if (grid[r][c] === 0) {
            const nums = shuffle([1,2,3,4,5,6,7,8,9]);
            for (const n of nums) {
              if (isValid(grid, r, c, n)) {
                grid[r][c] = n;
                if (solve()) return true;
                grid[r][c] = 0;
              }
            }
            return false;
          }
        }
      }
      return true;
    }
    solve();
    return grid;
  }

  function isValid(grid, r, c, n) {
    for (let i = 0; i < 9; i++) {
      if (grid[r][i] === n || grid[i][c] === n) return false;
    }
    const br = Math.floor(r / 3) * 3;
    const bc = Math.floor(c / 3) * 3;
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        if (grid[br + i][bc + j] === n) return false;
      }
    }
    return true;
  }

  function makePuzzle(sol, holes) {
    const p = sol.map(row => row.slice());
    const positions = shuffle(Array.from({ length: 81 }, (_, i) => i));
    let removed = 0;
    for (const pos of positions) {
      if (removed >= holes) break;
      const r = Math.floor(pos / 9), c = pos % 9;
      if (p[r][c] !== 0) {
        p[r][c] = 0;
        removed++;
      }
    }
    return p;
  }

  function init() {
    solution = generateSolution();
    puzzle = makePuzzle(solution, HOLES[level]);
    current = puzzle.map(row => row.slice());
    fixed = puzzle.map(row => row.map(v => v !== 0));
    notes = Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => new Set()));
    selected = null;
    noteMode = false;
    history = [];
    gameOver = false;
    seconds = 0;
    clearInterval(timer);
    timer = setInterval(() => { seconds++; $time.textContent = seconds; }, 1000);
    $time.textContent = '0';
    $result.className = 'sd-result';
    $result.textContent = '';
    render();
  }

  function render() {
    $board.innerHTML = '';
    let filled = 0;
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const v = current[r][c];
        const cell = document.createElement('div');
        cell.className = 'sd-cell';
        cell.dataset.row = r;
        cell.dataset.col = c;
        if (fixed[r][c]) cell.classList.add('fixed');
        if (selected && selected.r === r && selected.c === c) cell.classList.add('selected');
        // 同行/同列/同宫格高亮
        if (selected && (selected.r === r || selected.c === c ||
            (Math.floor(selected.r/3) === Math.floor(r/3) && Math.floor(selected.c/3) === Math.floor(c/3)))) {
          if (!(selected.r === r && selected.c === c)) cell.classList.add('highlight');
        }
        // 相同数字高亮
        if (selected && v !== 0 && current[selected.r][selected.c] === v && !(selected.r === r && selected.c === c)) {
          cell.classList.add('same');
        }
        // 错误检测
        if (v !== 0 && !fixed[r][c] && hasConflict(r, c)) cell.classList.add('error');

        if (v !== 0) {
          cell.textContent = v;
          filled++;
        } else if (notes[r][c].size > 0) {
          cell.classList.add('note');
          const ng = document.createElement('div');
          ng.className = 'note-grid';
          for (let i = 1; i <= 9; i++) {
            const s = document.createElement('span');
            s.textContent = notes[r][c].has(i) ? i : '';
            ng.appendChild(s);
          }
          cell.appendChild(ng);
        }
        $board.appendChild(cell);
      }
    }
    $progress.textContent = filled;
  }

  function hasConflict(r, c) {
    const v = current[r][c];
    if (!v) return false;
    for (let i = 0; i < 9; i++) {
      if (i !== c && current[r][i] === v) return true;
      if (i !== r && current[i][c] === v) return true;
    }
    const br = Math.floor(r / 3) * 3;
    const bc = Math.floor(c / 3) * 3;
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        const nr = br + i, nc = bc + j;
        if ((nr !== r || nc !== c) && current[nr][nc] === v) return true;
      }
    }
    return false;
  }

  function setNumber(n) {
    if (!selected || gameOver) return;
    const { r, c } = selected;
    if (fixed[r][c]) return;

    if (noteMode) {
      // 笔记模式
      if (n === 0) {
        notes[r][c].clear();
      } else {
        if (notes[r][c].has(n)) notes[r][c].delete(n);
        else notes[r][c].add(n);
      }
    } else {
      // 正常输入
      const prev = current[r][c];
      history.push({ r, c, prev, notes: new Set(notes[r][c]) });
      if (n === 0) {
        current[r][c] = 0;
      } else {
        current[r][c] = n;
        notes[r][c].clear();
      }
      // 检查完成
      if (n !== 0 && checkComplete()) {
        gameOver = true;
        clearInterval(timer);
        $result.className = 'sd-result win';
        $result.textContent = `🎉 完成！用时 ${seconds}s`;
      }
    }
    render();
  }

  function checkComplete() {
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        if (current[r][c] !== solution[r][c]) return false;
      }
    }
    return true;
  }

  function undo() {
    if (!history.length || gameOver) return;
    const h = history.pop();
    current[h.r][h.c] = h.prev;
    notes[h.r][h.c] = h.notes;
    render();
  }

  function hint() {
    if (gameOver) return;
    // 找一个空的或错误的格子，填入正确答案
    const candidates = [];
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        if (!fixed[r][c] && (current[r][c] === 0 || current[r][c] !== solution[r][c])) {
          candidates.push({ r, c });
        }
      }
    }
    if (!candidates.length) return;
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    current[pick.r][pick.c] = solution[pick.r][pick.c];
    notes[pick.r][pick.c].clear();
    selected = pick;
    history.push({ r: pick.r, c: pick.c, prev: 0, notes: new Set() });
    if (checkComplete()) {
      gameOver = true;
      clearInterval(timer);
      $result.className = 'sd-result win';
      $result.textContent = `🎉 完成！用时 ${seconds}s`;
    }
    render();
  }

  // 事件
  $board.addEventListener('click', (e) => {
    const cell = e.target.closest('.sd-cell');
    if (!cell) return;
    selected = { r: Number(cell.dataset.row), c: Number(cell.dataset.col) };
    render();
  });

  document.querySelectorAll('.sd-num-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const n = btn.dataset.num;
      if (n === '0') setNumber(0);
      else setNumber(Number(n));
    });
  });

  document.addEventListener('keydown', (e) => {
    if (!selected || gameOver) return;
    const k = e.key;
    if (k >= '1' && k <= '9') setNumber(Number(k));
    else if (k === 'Backspace' || k === 'Delete' || k === '0') setNumber(0);
    else if (k === 'ArrowUp') { selected.r = Math.max(0, selected.r - 1); render(); e.preventDefault(); }
    else if (k === 'ArrowDown') { selected.r = Math.min(8, selected.r + 1); render(); e.preventDefault(); }
    else if (k === 'ArrowLeft') { selected.c = Math.max(0, selected.c - 1); render(); e.preventDefault(); }
    else if (k === 'ArrowRight') { selected.c = Math.min(8, selected.c + 1); render(); e.preventDefault(); }
  });

  document.getElementById('sd-note').addEventListener('click', () => {
    noteMode = !noteMode;
    document.getElementById('sd-note').classList.toggle('active', noteMode);
  });
  document.getElementById('sd-hint').addEventListener('click', hint);
  document.getElementById('sd-undo').addEventListener('click', undo);
  document.getElementById('sd-new').addEventListener('click', init);

  document.querySelectorAll('.sd-difficulty button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sd-difficulty button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      level = btn.dataset.level;
      init();
    });
  });

  function applyConfig() {
    document.getElementById('site-title').textContent = SITE_CONFIG.title;
    document.getElementById('footer-text').textContent = SITE_CONFIG.footer;
  }
  applyConfig();

  init();
})();
