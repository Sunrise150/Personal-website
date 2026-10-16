/* ============ 飞机大战 ============ */
(function () {
  const canvas = document.getElementById('ft-canvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  const $score = document.getElementById('ft-score');
  const $lives = document.getElementById('ft-lives');
  const $wave = document.getElementById('ft-wave');
  const $best = document.getElementById('ft-best');
  const $gameover = document.getElementById('ft-gameover');

  let best = parseInt(localStorage.getItem('fighter_best') || '0', 10);
  $best.textContent = best;

  // 游戏状态
  let running = false;
  let paused = false;
  let gameOver = false;
  let lastTime = 0;

  // 玩家
  let player = null;
  const PLAYER_SPEED = 260;
  let keys = {};
  let joyX = 0, joyY = 0;
  let fireHeld = false;

  // 实体数组
  let bullets = [];       // 玩家子弹
  let enemyBullets = [];  // 敌机子弹
  let enemies = [];
  let particles = [];
  let stars = [];         // 背景星星

  // 游戏数据
  let score = 0;
  let lives = 3;
  let wave = 1;
  let spawnTimer = 0;
  let waveEnemiesLeft = 0;
  let waveSpawned = 0;
  let waveTotal = 8;
  let bossSpawned = false;

  // 玩家自动射击计时器
  let fireTimer = 0;
  const FIRE_INTERVAL = 0.15;

  // 初始化背景星星
  function initStars() {
    stars = [];
    for (let i = 0; i < 60; i++) {
      stars.push({
        x: Math.random() * W,
        y: Math.random() * H,
        size: Math.random() * 2 + 0.5,
        speed: Math.random() * 60 + 30
      });
    }
  }

  function init() {
    player = {
      x: W / 2, y: H - 60,
      w: 28, h: 28,
      invincible: 0,
      cooldown: 0
    };
    bullets = [];
    enemyBullets = [];
    enemies = [];
    particles = [];
    score = 0;
    lives = 3;
    wave = 1;
    spawnTimer = 0;
    waveEnemiesLeft = 0;
    waveSpawned = 0;
    bossSpawned = false;
    gameOver = false;
    paused = false;
    $score.textContent = 0;
    $lives.textContent = 3;
    $wave.textContent = 1;
    $gameover.classList.remove('show');
    initStars();
    startWave();
  }

  function startWave() {
    waveSpawned = 0;
    bossSpawned = false;
    waveTotal = 6 + wave * 2;
    waveEnemiesLeft = waveTotal;
    $wave.textContent = wave;
  }

  // ==== 敌机类型 ====
  const ENEMY_TYPES = {
    small: { w: 22, h: 22, hp: 1, speed: 80, score: 100, color: '#f97316' },
    medium: { w: 32, h: 32, hp: 3, speed: 55, score: 300, color: '#a855f7' },
    large: { w: 44, h: 44, hp: 6, speed: 40, score: 600, color: '#ef4444' },
    boss: { w: 80, h: 60, hp: 40, speed: 30, score: 3000, color: '#dc2626' }
  };

  function spawnEnemy(type) {
    const t = ENEMY_TYPES[type];
    const e = {
      type, ...t,
      x: Math.random() * (W - t.w - 20) + 10 + t.w / 2,
      y: -t.h,
      hp: t.hp,
      maxHp: t.hp,
      shootTimer: Math.random() * 2,
      moveTimer: 0,
      vx: 0
    };
    enemies.push(e);
  }

  function spawnBoss() {
    const t = ENEMY_TYPES.boss;
    enemies.push({
      type: 'boss', ...t,
      x: W / 2, y: -t.h,
      hp: t.hp + wave * 5,
      maxHp: t.hp + wave * 5,
      shootTimer: 1,
      moveTimer: 0,
      vx: 60
    });
  }

  // ==== 碰撞检测 ====
  function rectHit(a, b) {
    return Math.abs(a.x - b.x) < (a.w + b.w) / 2 &&
           Math.abs(a.y - b.y) < (a.h + b.h) / 2;
  }

  function circleHit(ax, ay, ar, bx, by, br) {
    const dx = ax - bx, dy = ay - by;
    return dx * dx + dy * dy < (ar + br) * (ar + br);
  }

  // ==== 爆炸粒子 ====
  function explode(x, y, color, count = 12) {
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const sp = Math.random() * 150 + 50;
      particles.push({
        x, y,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp,
        life: Math.random() * 0.4 + 0.3,
        maxLife: 0.7,
        size: Math.random() * 3 + 1.5,
        color
      });
    }
  }

  // ==== 玩家射击 ====
  function playerShoot() {
    if (player.cooldown > 0) return;
    player.cooldown = 0.12;
    // 根据分数解锁三连发
    if (score >= 2000) {
      bullets.push({ x: player.x - 8, y: player.y - 12, w: 3, h: 10, vy: -520 });
      bullets.push({ x: player.x, y: player.y - 14, w: 3, h: 10, vy: -560 });
      bullets.push({ x: player.x + 8, y: player.y - 12, w: 3, h: 10, vy: -520 });
    } else {
      bullets.push({ x: player.x, y: player.y - 14, w: 3, h: 10, vy: -560 });
    }
  }

  // ==== 敌机射击 ====
  function enemyShoot(e) {
    if (e.type === 'boss') {
      // Boss: 散弹
      for (let i = -2; i <= 2; i++) {
        const ang = Math.PI / 2 + i * 0.25;
        enemyBullets.push({
          x: e.x, y: e.y + e.h / 2,
          vx: Math.cos(ang) * 200,
          vy: Math.sin(ang) * 200,
          r: 4
        });
      }
    } else if (e.type === 'large') {
      enemyBullets.push({
        x: e.x, y: e.y + e.h / 2,
        vx: 0, vy: 220, r: 4
      });
    } else if (e.type === 'medium' && Math.random() < 0.5) {
      const dx = player.x - e.x, dy = player.y - e.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      enemyBullets.push({
        x: e.x, y: e.y + e.h / 2,
        vx: dx / d * 200, vy: dy / d * 200, r: 3
      });
    }
  }

  // ==== 更新 ====
  function update(dt) {
    if (!player) return;

    // 玩家移动
    let dx = 0, dy = 0;
    if (keys['arrowleft'] || keys['a']) dx -= 1;
    if (keys['arrowright'] || keys['d']) dx += 1;
    if (keys['arrowup'] || keys['w']) dy -= 1;
    if (keys['arrowdown'] || keys['s']) dy += 1;
    // 虚拟摇杆
    dx += joyX; dy += joyY;
    if (dx || dy) {
      const len = Math.sqrt(dx * dx + dy * dy);
      dx /= len; dy /= len;
      player.x += dx * PLAYER_SPEED * dt;
      player.y += dy * PLAYER_SPEED * dt;
    }
    player.x = Math.max(player.w / 2, Math.min(W - player.w / 2, player.x));
    player.y = Math.max(player.h / 2, Math.min(H - player.h / 2, player.y));

    // 玩家射击
    player.cooldown -= dt;
    if (keys[' '] || fireHeld) playerShoot();

    // 无敌帧
    if (player.invincible > 0) player.invincible -= dt;

    // 背景星星
    for (const s of stars) {
      s.y += s.speed * dt;
      if (s.y > H) { s.y = 0; s.x = Math.random() * W; }
    }

    // 生成敌机
    spawnTimer -= dt;
    if (spawnTimer <= 0 && waveSpawned < waveTotal) {
      spawnTimer = Math.max(0.4, 1.2 - wave * 0.08);
      const roll = Math.random();
      let type = 'small';
      if (wave >= 3 && roll < 0.15) type = 'large';
      else if (wave >= 2 && roll < 0.4) type = 'medium';
      spawnEnemy(type);
      waveSpawned++;
    }

    // 波次 Boss
    if (!bossSpawned && waveSpawned >= waveTotal && enemies.length === 0 && wave >= 2) {
      spawnBoss();
      bossSpawned = true;
    }

    // 波次完成检查
    if (bossSpawned && enemies.length === 0) {
      wave++;
      score += 500;
      startWave();
    } else if (!bossSpawned && waveSpawned >= waveTotal && enemies.length === 0 && wave < 2) {
      wave++;
      startWave();
    }

    // 更新玩家子弹
    for (const b of bullets) b.y += b.vy * dt;
    bullets = bullets.filter(b => b.y > -20);

    // 更新敌机
    for (const e of enemies) {
      if (e.type === 'boss') {
        // Boss 进场后左右移动
        if (e.y < 80) e.y += 40 * dt;
        else {
          e.x += e.vx * dt;
          if (e.x < e.w / 2 || e.x > W - e.w / 2) e.vx *= -1;
        }
      } else {
        e.y += e.speed * dt;
        e.moveTimer += dt;
        if (e.moveTimer > 1 && e.type === 'medium') {
          e.moveTimer = 0;
          e.vx = (Math.random() - 0.5) * 60;
        }
        e.x += e.vx * dt;
        e.x = Math.max(e.w / 2, Math.min(W - e.w / 2, e.x));
      }
      // 射击
      e.shootTimer -= dt;
      if (e.shootTimer <= 0) {
        if (e.type === 'boss') e.shootTimer = 0.8;
        else if (e.type === 'large') e.shootTimer = 2;
        else if (e.type === 'medium') e.shootTimer = 2.5;
        else e.shootTimer = 99; // small 不射击
        enemyShoot(e);
      }
    }
    // 移除飞出屏幕的敌机
    enemies = enemies.filter(e => e.y < H + 60 && e.hp > 0);

    // 更新敌机子弹
    for (const b of enemyBullets) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
    }
    enemyBullets = enemyBullets.filter(b => b.y < H + 20 && b.y > -20 && b.x > -20 && b.x < W + 20);

    // 更新粒子
    for (const p of particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
    }
    particles = particles.filter(p => p.life > 0);

    // ==== 碰撞：玩家子弹 vs 敌机 ====
    for (const b of bullets) {
      for (const e of enemies) {
        if (e.hp <= 0) continue;
        if (rectHit({ x: b.x, y: b.y, w: b.w, h: b.h }, e)) {
          e.hp--;
          b.y = -999; // 标记移除
          explode(b.x, b.y, '#fef08a', 4);
          if (e.hp <= 0) {
            score += e.score;
            explode(e.x, e.y, e.color, e.type === 'boss' ? 30 : 15);
          }
          break;
        }
      }
    }
    bullets = bullets.filter(b => b.y > -20);

    // ==== 碰撞：敌机子弹 vs 玩家 ====
    if (player.invincible <= 0) {
      for (const b of enemyBullets) {
        if (circleHit(b.x, b.y, b.r, player.x, player.y, 10)) {
          hitPlayer();
          b.y = 9999;
          break;
        }
      }
      enemyBullets = enemyBullets.filter(b => b.y < 9999);
    }

    // ==== 碰撞：敌机 vs 玩家 ====
    if (player.invincible <= 0) {
      for (const e of enemies) {
        if (e.hp <= 0) continue;
        if (rectHit(player, e)) {
          hitPlayer();
          e.hp = 0;
          explode(e.x, e.y, e.color, 15);
          break;
        }
      }
    }

    $score.textContent = score;
  }

  function hitPlayer() {
    lives--;
    $lives.textContent = lives;
    player.invincible = 2;
    explode(player.x, player.y, '#60a5fa', 20);
    if (lives <= 0) {
      endGame();
    }
  }

  function endGame() {
    running = false;
    gameOver = true;
    $gameover.classList.add('show');
    if (score > best) {
      best = score;
      localStorage.setItem('fighter_best', best);
      $best.textContent = best;
    }
  }

  // ==== 绘制 ====
  function draw() {
    // 背景
    ctx.fillStyle = '#0c0a09';
    ctx.fillRect(0, 0, W, H);
    // 星星
    for (const s of stars) {
      ctx.fillStyle = `rgba(255,255,255,${0.3 + s.speed / 100})`;
      ctx.fillRect(s.x, s.y, s.size, s.size);
    }

    // 粒子
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // 玩家子弹
    ctx.fillStyle = '#fef08a';
    for (const b of bullets) {
      ctx.fillRect(b.x - b.w / 2, b.y - b.h / 2, b.w, b.h);
    }

    // 敌机子弹
    for (const b of enemyBullets) {
      ctx.fillStyle = '#f87171';
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // 敌机
    for (const e of enemies) {
      drawEnemy(e);
    }

    // 玩家
    if (player) drawPlayer();
  }

  function drawPlayer() {
    const flashing = player.invincible > 0 && Math.floor(player.invincible * 10) % 2 === 0;
    if (flashing) return;
    ctx.save();
    ctx.translate(player.x, player.y);
    // 机身
    ctx.fillStyle = '#60a5fa';
    ctx.beginPath();
    ctx.moveTo(0, -14);
    ctx.lineTo(10, 10);
    ctx.lineTo(0, 5);
    ctx.lineTo(-10, 10);
    ctx.closePath();
    ctx.fill();
    // 引擎火焰
    ctx.fillStyle = '#fb923c';
    ctx.beginPath();
    ctx.moveTo(-4, 8);
    ctx.lineTo(0, 16 + Math.random() * 4);
    ctx.lineTo(4, 8);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawEnemy(e) {
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.fillStyle = e.color;
    if (e.type === 'boss') {
      // Boss: 椭圆 + 炮塔
      ctx.beginPath();
      ctx.ellipse(0, 0, e.w / 2, e.h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#7f1d1d';
      ctx.fillRect(-8, e.h / 2 - 6, 16, 6);
      // 血条
      const barW = e.w;
      const pct = e.hp / e.maxHp;
      ctx.fillStyle = '#292524';
      ctx.fillRect(-barW / 2, -e.h / 2 - 10, barW, 4);
      ctx.fillStyle = pct > 0.3 ? '#22c55e' : '#ef4444';
      ctx.fillRect(-barW / 2, -e.h / 2 - 10, barW * pct, 4);
    } else {
      // 普通敌机：三角形
      ctx.beginPath();
      ctx.moveTo(0, e.h / 2);
      ctx.lineTo(e.w / 2, -e.h / 2);
      ctx.lineTo(0, -e.h / 4);
      ctx.lineTo(-e.w / 2, -e.h / 2);
      ctx.closePath();
      ctx.fill();
      // 血条 (medium/large)
      if (e.type !== 'small' && e.hp < e.maxHp) {
        const pct = e.hp / e.maxHp;
        ctx.fillStyle = '#292524';
        ctx.fillRect(-e.w / 2, -e.h / 2 - 6, e.w, 3);
        ctx.fillStyle = '#22c55e';
        ctx.fillRect(-e.w / 2, -e.h / 2 - 6, e.w * pct, 3);
      }
    }
    ctx.restore();
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

  function start() {
    if (running) return;
    init();
    running = true;
    lastTime = 0;
    requestAnimationFrame(loop);
  }

  function pause() {
    if (!running) return;
    paused = !paused;
    document.getElementById('ft-pause').textContent = paused ? '继续' : '暂停';
  }

  function restart() {
    init();
    running = true;
    paused = false;
    lastTime = 0;
    document.getElementById('ft-pause').textContent = '暂停';
  }

  // ==== 输入 ====
  const GAME_KEYS = ['arrowup','arrowdown','arrowleft','arrowright',' ','w','a','s','d','p'];
  document.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    keys[k] = true;
    if (GAME_KEYS.includes(k)) e.preventDefault();
    if (k === 'p') pause();
  });
  document.addEventListener('keyup', (e) => {
    keys[e.key.toLowerCase()] = false;
  });

  document.getElementById('ft-start').addEventListener('click', () => {
    if (running) restart();
    else start();
  });
  document.getElementById('ft-pause').addEventListener('click', pause);
  document.getElementById('ft-restart').addEventListener('click', restart);

  // 虚拟摇杆
  const joy = document.getElementById('ft-joystick');
  const knob = document.getElementById('ft-joystick-knob');
  let joyActive = false, joyTouchId = null;
  joy.addEventListener('touchstart', (e) => {
    e.preventDefault();
    joyActive = true;
    const t = e.touches[0];
    joyTouchId = t.identifier;
    updateJoy(t.clientX, t.clientY);
  }, { passive: false });
  joy.addEventListener('touchmove', (e) => {
    e.preventDefault();
    for (const t of e.touches) {
      if (t.identifier === joyTouchId) { updateJoy(t.clientX, t.clientY); break; }
    }
  }, { passive: false });
  joy.addEventListener('touchend', () => {
    joyActive = false; joyTouchId = null; joyX = 0; joyY = 0;
    knob.style.transform = 'translate(0, 0)';
  });

  function updateJoy(cx, cy) {
    const rect = joy.getBoundingClientRect();
    const jx = cx - rect.left - rect.width / 2;
    const jy = cy - rect.top - rect.height / 2;
    const max = rect.width / 2 - 20;
    const dist = Math.sqrt(jx * jx + jy * jy);
    const scale = dist > max ? max / dist : 1;
    const rx = jx * scale, ry = jy * scale;
    knob.style.transform = `translate(${rx}px, ${ry}px)`;
    joyX = (rx / max) * 0.8;
    joyY = (ry / max) * 0.8;
  }

  // 射击按钮
  const fireBtn = document.getElementById('ft-fire-btn');
  fireBtn.addEventListener('touchstart', (e) => { e.preventDefault(); fireHeld = true; }, { passive: false });
  fireBtn.addEventListener('touchend', (e) => { e.preventDefault(); fireHeld = false; });
  fireBtn.addEventListener('mousedown', () => fireHeld = true);
  fireBtn.addEventListener('mouseup', () => fireHeld = false);
  fireBtn.addEventListener('mouseleave', () => fireHeld = false);

  // 配置
  function applyConfig() {
    document.getElementById('site-title').textContent = SITE_CONFIG.title;
    document.getElementById('footer-text').textContent = SITE_CONFIG.footer;
  }
  applyConfig();

  // 初始化画布绘制
  initStars();
  draw();
})();
