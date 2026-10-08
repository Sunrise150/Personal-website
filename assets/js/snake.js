/* ============ 贪吃蛇游戏 ============ */
(function () {
  const canvas = document.getElementById('snake-canvas');
  const ctx = canvas.getContext('2d');
  const CELL = 20; // 每格 20px
  const COLS = canvas.width / CELL;
  const ROWS = canvas.height / CELL;

  let snake = [];
  let dir = { x: 1, y: 0 };
  let nextDir = { x: 1, y: 0 };
  let food = { x: 10, y: 10 };
  let score = 0;
  let best = parseInt(localStorage.getItem('snake_best') || '0', 10);
  let running = false;
  let paused = false;
  let timer = null;
  let speed = 5;

  const $score = document.getElementById('snake-score');
  const $best = document.getElementById('snake-best');
  const $speed = document.getElementById('snake-speed');
  const $speedVal = document.getElementById('snake-speed-val');
  const $gameover = document.getElementById('snake-gameover');

  $best.textContent = best;

  function reset() {
    snake = [{ x: 8, y: 10 }, { x: 7, y: 10 }, { x: 6, y: 10 }];
    dir = { x: 1, y: 0 };
    nextDir = { x: 1, y: 0 };
    score = 0;
    $score.textContent = score;
    placeFood();
    $gameover.classList.remove('show');
    draw();
  }

  function placeFood() {
    while (true) {
      food = { x: Math.floor(Math.random() * COLS), y: Math.floor(Math.random() * ROWS) };
      if (!snake.some(s => s.x === food.x && s.y === food.y)) break;
    }
  }

  function tickInterval() {
    // 速度 1~10：间隔 250ms~50ms
    return 300 - speed * 25;
  }

  function step() {
    if (paused) return;
    dir = nextDir;
    let nx = snake[0].x + dir.x;
    let ny = snake[0].y + dir.y;
    // 穿墙：从一侧穿出，从另一侧穿入
    nx = (nx + COLS) % COLS;
    ny = (ny + ROWS) % ROWS;
    const head = { x: nx, y: ny };

    // 撞自己才结束
    if (snake.some(s => s.x === head.x && s.y === head.y)) {
      return gameOver();
    }
    snake.unshift(head);
    // 吃食物
    if (head.x === food.x && head.y === food.y) {
      score += 10;
      $score.textContent = score;
      if (score > best) {
        best = score;
        $best.textContent = best;
        localStorage.setItem('snake_best', best);
      }
      placeFood();
    } else {
      snake.pop();
    }
    draw();
  }

  function draw() {
    // 背景
    ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--bg').trim() || '#fafaf9';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // 网格线（淡）
    ctx.strokeStyle = 'rgba(0,0,0,0.05)';
    ctx.lineWidth = 1;
    for (let i = 1; i < COLS; i++) {
      ctx.beginPath(); ctx.moveTo(i * CELL, 0); ctx.lineTo(i * CELL, canvas.height); ctx.stroke();
    }
    for (let j = 1; j < ROWS; j++) {
      ctx.beginPath(); ctx.moveTo(0, j * CELL); ctx.lineTo(canvas.width, j * CELL); ctx.stroke();
    }
    // 食物（红色圆）
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.arc(food.x * CELL + CELL / 2, food.y * CELL + CELL / 2, CELL / 2 - 2, 0, Math.PI * 2);
    ctx.fill();
    // 蛇
    const accent = getComputedStyle(document.body).getPropertyValue('--accent').trim() || '#1e6091';
    snake.forEach((s, i) => {
      ctx.fillStyle = i === 0 ? accent : 'rgba(30, 96, 145, 0.7)';
      ctx.fillRect(s.x * CELL + 1, s.y * CELL + 1, CELL - 2, CELL - 2);
    });
  }

  function gameOver() {
    running = false;
    paused = false;
    clearInterval(timer);
    timer = null;
    $gameover.classList.add('show');
    document.getElementById('snake-start').textContent = '开始';
  }

  function start() {
    if (running) return;
    if (!snake.length) reset();
    running = true;
    paused = false;
    $gameover.classList.remove('show');
    document.getElementById('snake-start').textContent = '运行中';
    timer = setInterval(step, tickInterval());
  }

  function pause() {
    if (!running) return;
    paused = !paused;
    document.getElementById('snake-pause').textContent = paused ? '继续' : '暂停';
  }

  function restart() {
    clearInterval(timer);
    timer = null;
    running = false;
    paused = false;
    reset();
    document.getElementById('snake-start').textContent = '开始';
    document.getElementById('snake-pause').textContent = '暂停';
  }

  function changeDir(d) {
    const map = {
      up: { x: 0, y: -1 },
      down: { x: 0, y: 1 },
      left: { x: -1, y: 0 },
      right: { x: 1, y: 0 }
    };
    const nd = map[d];
    if (!nd) return;
    // 不能 180 度反向
    if (snake.length > 1 && nd.x === -dir.x && nd.y === -dir.y) return;
    nextDir = nd;
  }

  // 键盘
  document.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'arrowup' || k === 'w') { changeDir('up'); e.preventDefault(); }
    else if (k === 'arrowdown' || k === 's') { changeDir('down'); e.preventDefault(); }
    else if (k === 'arrowleft' || k === 'a') { changeDir('left'); e.preventDefault(); }
    else if (k === 'arrowright' || k === 'd') { changeDir('right'); e.preventDefault(); }
    else if (k === ' ' || k === 'spacebar') {
      e.preventDefault();
      if (running) pause();
      else start();
    }
  });

  // 按钮
  document.getElementById('snake-start').addEventListener('click', () => {
    if (running) pause();
    else start();
  });
  document.getElementById('snake-pause').addEventListener('click', pause);
  document.getElementById('snake-restart').addEventListener('click', restart);

  // 速度
  $speed.addEventListener('input', (e) => {
    speed = parseInt(e.target.value, 10);
    $speedVal.textContent = speed;
    if (running && timer) {
      clearInterval(timer);
      timer = setInterval(step, tickInterval());
    }
  });

  // 移动端方向键：用 touchstart 立即响应，避免 click 的 300ms 延迟
  // 同时 preventDefault 阻止触摸引发的滚动/双击缩放
  document.querySelectorAll('.snake-dpad button').forEach(btn => {
    const fire = (e) => {
      e.preventDefault();
      changeDir(btn.dataset.dir);
    };
    btn.addEventListener('touchstart', fire, { passive: false });
    // 鼠标点击仍用 click（桌面端兼容）
    btn.addEventListener('click', (e) => {
      // 触摸已处理过则不再重复触发
      if (e.detail === 0) return;
      changeDir(btn.dataset.dir);
    });
  });

  // 配置 + footer
  function applyConfig() {
    document.getElementById('site-title').textContent = SITE_CONFIG.title;
    document.getElementById('footer-text').textContent = SITE_CONFIG.footer;
  }
  applyConfig();

  // 初始化
  reset();
})();
