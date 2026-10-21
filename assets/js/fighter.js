/* ============ 飞机大战 v2 ============ */
(function () {
  const canvas = document.getElementById('ft-canvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  const $score = document.getElementById('ft-score');
  const $lives = document.getElementById('ft-lives');
  const $wave = document.getElementById('ft-wave');
  const $best = document.getElementById('ft-best');
  const $gameover = document.getElementById('ft-gameover');
  const $scoreList = document.getElementById('ft-score-list');
  const $nameInput = document.getElementById('ft-name-input');
  const $uploadBtn = document.getElementById('ft-upload-btn');
  const $buffs = document.getElementById('ft-buffs');
  const $toast = document.getElementById('ft-toast');

  const BEST_KEY = 'fighter_best';
  const SCORES_KEY = 'fighter_scores';
  const AUTO_FIRE_KEY = 'fighter_autofire';
  const DIFF_KEY = 'fighter_diff';

  let best = parseInt(localStorage.getItem(BEST_KEY) || '0', 10);
  $best.textContent = best;

  // ==== 难度配置 ====
  const DIFF = {
    easy:   { spawnMul: 0.7, hpMul: 0.7, bulletMul: 0.7, speedMul: 0.8, lives: 5 },
    normal: { spawnMul: 1.0, hpMul: 1.0, bulletMul: 1.0, speedMul: 1.0, lives: 3 },
    hard:   { spawnMul: 1.5, hpMul: 1.4, bulletMul: 1.6, speedMul: 1.3, lives: 2 }
  };
  let difficulty = localStorage.getItem(DIFF_KEY) || 'normal';
  let diffCfg = DIFF[difficulty];

  // 游戏状态
  let running = false, paused = false, gameOver = false, lastTime = 0, slowMo = false;
  let keys = {}, joyX = 0, joyY = 0, fireHeld = false;
  let autoFire = localStorage.getItem(AUTO_FIRE_KEY) === '1';

  // 实体
  let player = null;
  const PLAYER_SPEED = 260;
  let bullets = [], enemyBullets = [], enemies = [], particles = [], stars = [], powerups = [];

  // 游戏数据
  let score = 0, lives = 3, wave = 1;
  let spawnTimer = 0, waveSpawned = 0, waveTotal = 8, bossSpawned = false, ghostSpawned = false;
  let currentScore = 0, currentWave = 0;

  // Buff 系统
  let buffs = { shield: 0, power: 0, laser: 0 };

  // ==== 敌机类型 ====
  const ENEMY_TYPES = {
    small:    { w: 22, h: 22, hp: 1, speed: 80,  score: 100, color: '#f97316', shootMode: 'none' },
    medium:   { w: 32, h: 32, hp: 3, speed: 55,  score: 300, color: '#a855f7', shootMode: 'aimed' },
    large:    { w: 44, h: 44, hp: 6, speed: 40,  score: 600, color: '#ef4444', shootMode: 'triple' },
    scout:    { w: 20, h: 26, hp: 1, speed: 160, score: 150, color: '#06b6d4', shootMode: 'dive' },
    tank:     { w: 50, h: 50, hp: 12, speed: 30, score: 800, color: '#65a30d', shootMode: 'spread' },
    gunship:  { w: 38, h: 30, hp: 5, speed: 45,  score: 500, color: '#ec4899', shootMode: 'spiral' },
    laser:    { w: 36, h: 40, hp: 4, speed: 35, score: 700, color: '#06d6a0', shootMode: 'laser' }, // 新增：激光敌人
    ghost:    { w: 34, h: 34, hp: 999, speed: 50, score: 2000, color: '#a1a1aa', shootMode: 'ghost', isGhost: true, lifeTime: 30 },
    boss:     { w: 100, h: 70, hp: 80, speed: 30, score: 5000, color: '#dc2626', shootMode: 'boss' }
  };

  function spawnEnemy(type) {
    const t = ENEMY_TYPES[type];
    const hp = Math.round(t.hp * diffCfg.hpMul);
    const e = {
      type, ...t,
      x: Math.random() * (W - t.w - 20) + 10 + t.w / 2,
      y: -t.h,
      hp, maxHp: hp,
      shootTimer: 1 + Math.random() * 2,
      moveTimer: 0, vx: 0,
      phase: 0, spiralAng: 0,
      ghostTimer: t.isGhost ? t.lifeTime : 0,
      notHitTime: t.isGhost ? 0 : 0
    };
    enemies.push(e);
  }

  function spawnBoss() {
    const t = ENEMY_TYPES.boss;
    const hp = Math.round((t.hp + wave * 8) * diffCfg.hpMul);
    enemies.push({
      type: 'boss', ...t,
      x: W / 2, y: -t.h, hp, maxHp: hp,
      shootTimer: 1.5, moveTimer: 0, vx: 70, phase: 0, spiralAng: 0
    });
  }

  function spawnGhost() {
    // 幽灵：不掉血，30秒内不被击中自动消失
    const t = ENEMY_TYPES.ghost;
    enemies.push({
      type: 'ghost', ...t,
      x: W / 2, y: -t.h,
      hp: 999, maxHp: 999,
      shootTimer: 2, moveTimer: 0, vx: 40,
      ghostTimer: 30, notHitTime: 0,
      spiralAng: 0, isBossLike: true
    });
    ghostSpawned = true;
    showToast('⚠️ 幽灵首领出现！30秒内不被击中才会消失');
  }

  // ==== 敌机射击 ====
  function enemyShoot(e) {
    const px = player.x, py = player.y;
    const bMul = diffCfg.bulletMul;
    switch (e.shootMode) {
      case 'none': break;
      case 'aimed': {
        const dx = px - e.x, dy = py - e.y;
        const d = Math.hypot(dx, dy) || 1;
        enemyBullets.push({ x: e.x, y: e.y + e.h / 2, vx: dx / d * 220 * bMul, vy: dy / d * 220 * bMul, r: 3 });
        break;
      }
      case 'triple': {
        for (let i = -1; i <= 1; i++) {
          const ang = Math.PI / 2 + i * 0.2;
          enemyBullets.push({ x: e.x, y: e.y + e.h / 2, vx: Math.cos(ang) * 200 * bMul, vy: Math.sin(ang) * 200 * bMul, r: 4 });
        }
        break;
      }
      case 'spread': {
        for (let i = -3; i <= 3; i++) {
          const ang = Math.PI / 2 + i * 0.18;
          enemyBullets.push({ x: e.x, y: e.y + e.h / 2, vx: Math.cos(ang) * 180 * bMul, vy: Math.sin(ang) * 180 * bMul, r: 4 });
        }
        break;
      }
      case 'dive': {
        const dx = px - e.x, dy = py - e.y;
        const d = Math.hypot(dx, dy) || 1;
        enemyBullets.push({ x: e.x, y: e.y + e.h / 2, vx: dx / d * 280 * bMul, vy: dy / d * 280 * bMul, r: 3 });
        break;
      }
      case 'spiral': {
        e.spiralAng = (e.spiralAng || 0) + 0.6;
        for (let i = 0; i < 3; i++) {
          const ang = e.spiralAng + i * (Math.PI * 2 / 3);
          enemyBullets.push({ x: e.x, y: e.y, vx: Math.cos(ang) * 180 * bMul, vy: Math.sin(ang) * 180 * bMul, r: 3 });
        }
        break;
      }
      case 'laser': {
        // 激光敌人：发射一束快速直线激光弹（粗子弹）
        const dx = px - e.x, dy = py - e.y;
        const d = Math.hypot(dx, dy) || 1;
        // 主激光（粗、快）
        enemyBullets.push({ x: e.x, y: e.y + e.h / 2, vx: dx / d * 380 * bMul, vy: dy / d * 380 * bMul, r: 6, isLaser: true, color: '#06d6a0' });
        // 两侧副弹
        const baseAng = Math.atan2(dy, dx);
        enemyBullets.push({ x: e.x, y: e.y + e.h / 2, vx: Math.cos(baseAng + 0.2) * 280 * bMul, vy: Math.sin(baseAng + 0.2) * 280 * bMul, r: 3 });
        enemyBullets.push({ x: e.x, y: e.y + e.h / 2, vx: Math.cos(baseAng - 0.2) * 280 * bMul, vy: Math.sin(baseAng - 0.2) * 280 * bMul, r: 3 });
        break;
      }
      case 'ghost': {
        // 幽灵：根据时间切换多种弹幕模式，弹幕更密集
        const hardMode = diffCfg.bulletMul >= 1.3;
        // 困难模式最后 10 秒：中央释放追踪激光 + 旋转弹
        if (hardMode && (e.ghostTimer || 30) <= 10) {
          // 追踪玩家激光（速度比 shift 慢，约 120）
          const dx = px - e.x, dy = py - e.y;
          const d = Math.hypot(dx, dy) || 1;
          enemyBullets.push({ x: e.x, y: e.y, vx: dx / d * 120, vy: dy / d * 120, r: 7, isLaser: true, color: '#ef4444' });
          // 旋转弹（8 方向）
          e.spiralAng = (e.spiralAng || 0) + 0.2;
          for (let i = 0; i < 8; i++) {
            const ang = i * Math.PI / 4 + (e.spiralAng || 0);
            enemyBullets.push({ x: e.x, y: e.y, vx: Math.cos(ang) * 160 * bMul, vy: Math.sin(ang) * 160 * bMul, r: 3 });
          }
          break;
        }
        const phase = Math.floor((30 - (e.ghostTimer || 30)) / 5) % 4; // 每5秒切换，4阶段循环
        if (phase === 0) {
          // 阶段1：旋转十字弹（密集）
          const n = hardMode ? 10 : 8;
          for (let i = 0; i < n; i++) {
            const ang = i * Math.PI * 2 / n + (e.spiralAng || 0);
            enemyBullets.push({ x: e.x, y: e.y, vx: Math.cos(ang) * 180 * bMul, vy: Math.sin(ang) * 180 * bMul, r: 4 });
          }
        } else if (phase === 1) {
          // 阶段2：双层螺旋（10条）
          e.spiralAng = (e.spiralAng || 0) + 0.3;
          for (let i = 0; i < 10; i++) {
            const ang = e.spiralAng + i * (Math.PI * 2 / 10);
            enemyBullets.push({ x: e.x, y: e.y, vx: Math.cos(ang) * 160 * bMul, vy: Math.sin(ang) * 160 * bMul, r: 3 });
          }
          // 第二层反向螺旋
          const ang2 = -e.spiralAng;
          for (let i = 0; i < 6; i++) {
            const ang = ang2 + i * (Math.PI * 2 / 6);
            enemyBullets.push({ x: e.x, y: e.y, vx: Math.cos(ang) * 140 * bMul, vy: Math.sin(ang) * 140 * bMul, r: 3 });
          }
        } else if (phase === 2) {
          // 阶段3：追踪散弹（7发扇形）
          const dx = px - e.x, dy = py - e.y;
          const baseAng = Math.atan2(dy, dx);
          for (let i = -3; i <= 3; i++) {
            const ang = baseAng + i * 0.12;
            enemyBullets.push({ x: e.x, y: e.y, vx: Math.cos(ang) * 240 * bMul, vy: Math.sin(ang) * 240 * bMul, r: 4 });
          }
          // 额外环形 6 发
          for (let i = 0; i < 6; i++) {
            const ang = i * Math.PI / 3 + (e.spiralAng || 0);
            enemyBullets.push({ x: e.x, y: e.y, vx: Math.cos(ang) * 120 * bMul, vy: Math.sin(ang) * 120 * bMul, r: 3 });
          }
        } else {
          // 阶段4：全屏环形弹幕（12方向 + 6方向内圈）
          for (let i = 0; i < 12; i++) {
            const ang = i * Math.PI / 6 + (e.spiralAng || 0);
            enemyBullets.push({ x: e.x, y: e.y, vx: Math.cos(ang) * 150 * bMul, vy: Math.sin(ang) * 150 * bMul, r: 4 });
          }
          for (let i = 0; i < 6; i++) {
            const ang = i * Math.PI / 3 - (e.spiralAng || 0);
            enemyBullets.push({ x: e.x, y: e.y, vx: Math.cos(ang) * 100 * bMul, vy: Math.sin(ang) * 100 * bMul, r: 3 });
          }
        }
        e.spiralAng = (e.spiralAng || 0) + 0.15;
        // 困难模式每次额外加 2 发追踪弹
        if (hardMode) {
          const dx = px - e.x, dy = py - e.y;
          const d = Math.hypot(dx, dy) || 1;
          for (let i = 0; i < 2; i++) {
            enemyBullets.push({ x: e.x, y: e.y, vx: dx / d * 280 * bMul + (Math.random() - 0.5) * 60, vy: dy / d * 280 * bMul + (Math.random() - 0.5) * 60, r: 5 });
          }
        }
        break;
      }
      case 'boss': {
        const pct = e.hp / e.maxHp;
        if (pct > 0.6) {
          for (let i = -2; i <= 2; i++) {
            const ang = Math.PI / 2 + i * 0.22;
            enemyBullets.push({ x: e.x, y: e.y + e.h / 2, vx: Math.cos(ang) * 220 * bMul, vy: Math.sin(ang) * 220 * bMul, r: 5 });
          }
        } else if (pct > 0.3) {
          const dx = px - e.x, dy = py - e.y;
          const d = Math.hypot(dx, dy) || 1;
          enemyBullets.push({ x: e.x, y: e.y + e.h / 2, vx: dx / d * 260 * bMul, vy: dy / d * 260 * bMul, r: 5 });
          for (let i = -3; i <= 3; i++) {
            const ang = Math.PI / 2 + i * 0.18;
            enemyBullets.push({ x: e.x, y: e.y + e.h / 2, vx: Math.cos(ang) * 200 * bMul, vy: Math.sin(ang) * 200 * bMul, r: 4 });
          }
        } else {
          for (let i = -4; i <= 4; i++) {
            const ang = Math.PI / 2 + i * 0.14;
            enemyBullets.push({ x: e.x, y: e.y + e.h / 2, vx: Math.cos(ang) * 240 * bMul, vy: Math.sin(ang) * 240 * bMul, r: 5 });
          }
          e.spiralAng = (e.spiralAng || 0) + 0.4;
          for (let i = 0; i < 4; i++) {
            const ang = e.spiralAng + i * (Math.PI / 2);
            enemyBullets.push({ x: e.x, y: e.y - e.h / 2, vx: Math.cos(ang) * 160 * bMul, vy: Math.sin(ang) * 160 * bMul, r: 4 });
          }
        }
        break;
      }
    }
  }

  // ==== 碰撞 ====
  function rectHit(a, b) { return Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.h + b.h) / 2; }
  function circleHit(ax, ay, ar, bx, by, br) { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy < (ar + br) * (ar + br); }

  function explode(x, y, color, count = 12) {
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const sp = Math.random() * 150 + 50;
      particles.push({ x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
        life: Math.random() * 0.4 + 0.3, maxLife: 0.7, size: Math.random() * 3 + 1.5, color });
    }
  }

  function showToast(msg) {
    $toast.textContent = msg;
    $toast.classList.add('show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => $toast.classList.remove('show'), 1800);
  }

  function updateBuffsUI() {
    const arr = [];
    if (buffs.shield > 0) arr.push(`<span class="ft-buff shield">🛡 护盾 ${buffs.shield.toFixed(1)}s</span>`);
    if (buffs.power > 0) arr.push(`<span class="ft-buff power">⚡ 火力 ${buffs.power.toFixed(1)}s</span>`);
    if (buffs.laser > 0) arr.push(`<span class="ft-buff laser">💫 激光 ${buffs.laser.toFixed(1)}s</span>`);
    $buffs.innerHTML = arr.join('');
  }

  function spawnPowerup(x, y) {
    if (Math.random() > 0.08) return; // 8% 掉落率，一波约 1-2 个
    const types = ['shield', 'power', 'laser', 'life'];
    const weights = [0.35, 0.30, 0.20, 0.15];
    let r = Math.random(), t = 'shield';
    for (let i = 0; i < types.length; i++) { if (r < weights[i]) { t = types[i]; break; } r -= weights[i]; }
    powerups.push({ x, y, vy: 80, type: t, r: 10 });
  }

  function applyPowerup(type) {
    switch (type) {
      case 'shield': buffs.shield = 8; showToast('🛡 获得护盾！持续 8 秒'); break;
      case 'power':  buffs.power = 8; showToast('⚡ 火力强化 8 秒！'); break;
      case 'laser':  buffs.laser = 6; showToast('💫 激光模式 6 秒！'); break;
      case 'life':   lives = Math.min(9, lives + 1); $lives.textContent = lives; showToast('❤️ +1 生命！'); break;
    }
    updateBuffsUI();
  }

  // ==== 玩家射击 ====
  function playerShoot() {
    if (player.cooldown > 0) return;
    const hasLaser = buffs.laser > 0, hasPower = buffs.power > 0;
    player.cooldown = hasLaser ? 0.06 : (hasPower ? 0.09 : 0.12);
    const speedMul = hasPower ? 1.2 : 1;

    if (hasLaser) {
      // 激光：单发穿透
      bullets.push({ x: player.x, y: player.y - 18, w: 4, h: 30, vy: -800 * speedMul, pierce: true, color: '#ec4899' });
      bullets.push({ x: player.x - 10, y: player.y - 10, w: 2, h: 10, vy: -600 * speedMul, vx: -80 });
      bullets.push({ x: player.x + 10, y: player.y - 10, w: 2, h: 10, vy: -600 * speedMul, vx: 80 });
    } else if (score >= 5000 || hasPower) {
      bullets.push({ x: player.x - 12, y: player.y - 10, w: 3, h: 10, vy: -520 * speedMul, vx: -40 });
      bullets.push({ x: player.x + 12, y: player.y - 10, w: 3, h: 10, vy: -520 * speedMul, vx: 40 });
      bullets.push({ x: player.x, y: player.y - 14, w: 3, h: 10, vy: -560 * speedMul });
      bullets.push({ x: player.x, y: player.y - 20, w: 5, h: 5, vy: -500 * speedMul, homing: true });
    } else if (score >= 2000) {
      bullets.push({ x: player.x - 8, y: player.y - 12, w: 3, h: 10, vy: -520 * speedMul });
      bullets.push({ x: player.x, y: player.y - 14, w: 3, h: 10, vy: -560 * speedMul });
      bullets.push({ x: player.x + 8, y: player.y - 12, w: 3, h: 10, vy: -520 * speedMul });
    } else {
      bullets.push({ x: player.x, y: player.y - 14, w: 3, h: 10, vy: -560 * speedMul });
    }
  }

  // ==== 更新 ====
  function update(dt) {
    if (!player) return;

    // 减速倍率
    const speedMul = slowMo ? 0.5 : 1;

    // 玩家移动
    let dx = 0, dy = 0;
    if (keys['arrowleft'] || keys['a']) dx -= 1;
    if (keys['arrowright'] || keys['d']) dx += 1;
    if (keys['arrowup'] || keys['w']) dy -= 1;
    if (keys['arrowdown'] || keys['s']) dy += 1;
    dx += joyX; dy += joyY;
    if (dx || dy) {
      const len = Math.hypot(dx, dy) || 1;
      dx /= len; dy /= len;
      player.x += dx * PLAYER_SPEED * speedMul * dt;
      player.y += dy * PLAYER_SPEED * speedMul * dt;
    }
    player.x = Math.max(player.w / 2, Math.min(W - player.w / 2, player.x));
    player.y = Math.max(player.h / 2, Math.min(H - player.h / 2, player.y));

    // 射击（空格 / FIRE / 自动射击）
    player.cooldown -= dt;
    if (keys[' '] || fireHeld || autoFire) playerShoot();
    if (player.invincible > 0) player.invincible -= dt;

    // Buff 计时
    if (buffs.shield > 0) buffs.shield = Math.max(0, buffs.shield - dt);
    if (buffs.power > 0) buffs.power = Math.max(0, buffs.power - dt);
    if (buffs.laser > 0) buffs.laser = Math.max(0, buffs.laser - dt);
    updateBuffsUI();

    // 背景
    for (const s of stars) { s.y += s.speed * dt; if (s.y > H) { s.y = 0; s.x = Math.random() * W; } }

    // 生成敌机（幽灵/幽灵首领出现时不再生成普通敌人）
    spawnTimer -= dt;
    const hasBossLike = ghostSpawned || bossSpawned || enemies.some(e => e.isBossLike);
    if (spawnTimer <= 0 && waveSpawned < waveTotal && !hasBossLike) {
      spawnTimer = Math.max(0.25, (1.2 - wave * 0.07) / diffCfg.spawnMul);
      const roll = Math.random();
      let type = 'small';
      if (wave >= 5 && roll < 0.1) type = 'tank';
      else if (wave >= 4 && roll < 0.25) type = 'gunship';
      else if (wave >= 4 && roll < 0.35) type = 'laser'; // 新增：激光敌人
      else if (wave >= 3 && roll < 0.5) type = 'scout';
      else if (wave >= 3 && roll < 0.65) type = 'large';
      else if (wave >= 2 && roll < 0.8) type = 'medium';
      spawnEnemy(type);
      waveSpawned++;
    }

    // 波次普通敌人清完 → 决定下一个阶段
    if (!ghostSpawned && !bossSpawned && waveSpawned >= waveTotal && enemies.length === 0) {
      // 每 4 波：幽灵首领
      if (wave % 4 === 0) {
        spawnGhost();
      }
      // 每 2 波（除了幽灵波）：Boss
      else if (wave % 2 === 0 && wave >= 2) {
        spawnBoss(); bossSpawned = true;
      }
      // 其他：直接推进下一波
      else {
        wave++; startWave();
        showToast(`第 ${wave - 1} 波清完！`);
      }
    }

    // 幽灵首领消失后推进
    if (ghostSpawned && enemies.length === 0) {
      ghostSpawned = false;
      wave++; score += 1500; startWave();
      // 幽灵首领奖励
      if (Math.random() < 0.7) spawnPowerup(W / 2, 100);
      showToast(`幽灵首领消失！+1500 分`);
    }

    // Boss 清完推进
    if (bossSpawned && enemies.length === 0) {
      bossSpawned = false;
      wave++; score += 800; startWave();
      // Boss 奖励
      if (Math.random() < 0.8) spawnPowerup(W / 2, 100);
      showToast(`第 ${wave - 1} 波 Boss 清完！+800 分`);
    }

    // 玩家子弹（追踪弹/激光）
    for (const b of bullets) {
      if (b.homing && enemies.length > 0) {
        let nearest = enemies[0], nd = Infinity;
        for (const e of enemies) { const d = Math.hypot(e.x - b.x, e.y - b.y); if (d < nd) { nd = d; nearest = e; } }
        const dx2 = nearest.x - b.x, dy2 = nearest.y - b.y;
        const d2 = Math.hypot(dx2, dy2) || 1;
        b.vx += (dx2 / d2) * 800 * dt; b.vy += (dy2 / d2) * 800 * dt;
        const sp = Math.hypot(b.vx, b.vy), max = 600;
        if (sp > max) { b.vx *= max / sp; b.vy *= max / sp; }
      }
      b.x += (b.vx || 0) * dt; b.y += b.vy * dt;
    }
    bullets = bullets.filter(b => b.y > -30 && b.y < H + 30 && b.x > -30 && b.x < W + 30);

    // 敌机
    const eSpeed = diffCfg.speedMul;
    for (const e of enemies) {
      if (e.type === 'boss') {
        if (e.y < 90) e.y += 45 * dt;
        else { e.x += e.vx * dt; if (e.x < e.w / 2 || e.x > W - e.w / 2) e.vx *= -1; }
      } else if (e.type === 'ghost') {
        // 幽灵：30秒倒计时，不被击中就自动消失
        e.ghostTimer -= dt;
        if (e.ghostTimer <= 0) { e.hp = 0; score += e.score; explode(e.x, e.y, e.color, 20); continue; }
        // 悬浮在画面顶部 80px 处，左右徘徊
        e.moveTimer += dt;
        const hardMode = diffCfg.bulletMul >= 1.3;
        // 困难模式最后 10 秒转移到中央
        if (hardMode && e.ghostTimer <= 10) {
          // 平滑移到中央 (W/2, 100)
          e.x += (W / 2 - e.x) * Math.min(1, dt * 2);
          e.y += (100 - e.y) * Math.min(1, dt * 2);
        } else if (e.y < 80) {
          e.y += 120 * dt; // 快速飞到目标高度
        } else {
          // 悬浮 + 左右徘徊
          e.x = W / 2 + Math.sin(e.moveTimer * 0.8) * (W / 3);
          e.y = 80 + Math.sin(e.moveTimer * 1.5) * 15;
        }
      } else if (e.type === 'scout') {
        const dx = player.x - e.x;
        e.vx += Math.sign(dx) * 60 * dt;
        e.vx = Math.max(-120, Math.min(120, e.vx));
        e.x += e.vx * dt; e.y += e.speed * eSpeed * dt * 1.2;
      } else if (e.type === 'gunship') {
        e.moveTimer += dt;
        e.vx = Math.sin(e.moveTimer * 2) * 80;
        e.x += e.vx * dt; e.y += e.speed * eSpeed * dt;
      } else if (e.type === 'laser') {
        // 激光敌人：缓慢下降到中部后悬浮，左右徘徊
        if (e.y < 100) {
          e.y += e.speed * eSpeed * dt;
        } else {
          e.moveTimer += dt;
          e.x += Math.sin(e.moveTimer * 1.2) * 60 * dt;
          // y 小幅浮动
          e.y = 100 + Math.sin(e.moveTimer * 2) * 10;
        }
      } else {
        e.y += e.speed * eSpeed * dt;
        e.moveTimer += dt;
        if (e.moveTimer > 1 && e.type === 'medium') { e.moveTimer = 0; e.vx = (Math.random() - 0.5) * 80; }
        e.x += e.vx * dt;
      }
      e.x = Math.max(e.w / 2, Math.min(W - e.w / 2, e.x));

      // 射击
      e.shootTimer -= dt;
      if (e.shootTimer <= 0) {
        if (e.type === 'boss') e.shootTimer = e.hp / e.maxHp > 0.3 ? 0.9 : 0.5;
        else if (e.type === 'ghost') e.shootTimer = 0.5; // 弹幕更频繁
        else if (e.type === 'gunship') e.shootTimer = 0.6;
        else if (e.type === 'laser') e.shootTimer = 1.8; // 激光敌人射击间隔
        else if (e.type === 'tank') e.shootTimer = 1.5;
        else if (e.type === 'large') e.shootTimer = 1.8;
        else if (e.type === 'medium') e.shootTimer = 2.2;
        else if (e.type === 'scout') e.shootTimer = 1.5;
        else e.shootTimer = 99;
        enemyShoot(e);
      }
    }
    enemies = enemies.filter(e => e.y < H + 80 && e.hp > 0);

    // 敌机子弹
    for (const b of enemyBullets) { b.x += b.vx * dt; b.y += b.vy * dt; }
    enemyBullets = enemyBullets.filter(b => b.y < H + 20 && b.y > -20 && b.x > -20 && b.x < W + 20);

    // 粒子
    for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
    particles = particles.filter(p => p.life > 0);

    // 掉落道具
    for (const p of powerups) { p.y += p.vy * dt; }
    powerups = powerups.filter(p => p.y < H + 20);

    // ==== 碰撞：玩家子弹 vs 敌机 ====
    for (const b of bullets) {
      for (const e of enemies) {
        if (e.hp <= 0) continue;
        if (rectHit({ x: b.x, y: b.y, w: b.w || 3, h: b.h || 10 }, e)) {
          b.y = -999;
          if (e.isGhost) {
            // 幽灵：不受伤害，也不重置倒计时
            explode(b.x, b.y, '#a1a1aa', 3);
          } else {
            e.hp--;
            explode(b.x, b.y, b.color || '#fef08a', 4);
            if (e.hp <= 0) {
              score += e.score;
              explode(e.x, e.y, e.color, e.type === 'boss' ? 40 : (e.type === 'tank' || e.type === 'gunship' ? 20 : 12));
              // 掉落道具
              spawnPowerup(e.x, e.y);
            }
          }
          if (!b.pierce) break;
        }
      }
    }
    bullets = bullets.filter(b => b.y > -20);

    // ==== 碰撞：敌机子弹 vs 玩家 ====
    if (player.invincible <= 0) {
      for (const b of enemyBullets) {
        if (circleHit(b.x, b.y, b.r, player.x, player.y, 10)) { hitPlayer(); b.y = 9999; break; }
      }
      enemyBullets = enemyBullets.filter(b => b.y < 9999);
    }

    // ==== 碰撞：敌机 vs 玩家 ====
    if (player.invincible <= 0) {
      for (const e of enemies) {
        if (e.hp <= 0 || e.isGhost) continue;
        if (rectHit(player, e)) { hitPlayer(); e.hp = 0; explode(e.x, e.y, e.color, 15); break; }
      }
    }

    // ==== 碰撞：道具 vs 玩家 ====
    for (const p of powerups) {
      if (circleHit(p.x, p.y, p.r, player.x, player.y, 18)) {
        applyPowerup(p.type); p.y = 9999;
      }
    }
    powerups = powerups.filter(p => p.y < 9999);

    $score.textContent = score;
    currentScore = score; currentWave = wave;
  }

  function hitPlayer() {
    if (buffs.shield > 0) {
      // 护盾：每次被击中扣 2 秒持续时间
      buffs.shield = Math.max(0, buffs.shield - 2); updateBuffsUI();
      player.invincible = 0.5;
      explode(player.x, player.y, '#22c55e', 10);
      if (buffs.shield <= 0) showToast('🛡 护盾耗尽！');
      return;
    }
    // 扣血 + 释放冲击波清屏 + 武器重置
    lives--; $lives.textContent = lives; player.invincible = 2.5;
    // 冲击波：清空所有敌方子弹和普通敌人（Boss/幽灵除外）
    shockwave();
    // 武器回到初始状态
    buffs.power = 0; buffs.laser = 0; updateBuffsUI();
    explode(player.x, player.y, '#60a5fa', 20);
    showToast('💥 冲击波！武器已重置');
    if (lives <= 0) endGame();
  }

  // 冲击波特效：清屏子弹 + 消灭普通敌人
  function shockwave() {
    // 视觉特效：从玩家位置扩散的圆环
    for (let i = 0; i < 30; i++) {
      const ang = (i / 30) * Math.PI * 2;
      particles.push({
        x: player.x, y: player.y,
        vx: Math.cos(ang) * 400, vy: Math.sin(ang) * 400,
        life: 0.6, maxLife: 0.6, color: '#60a5fa', size: 4
      });
    }
    // 大圆环粒子
    for (let i = 0; i < 50; i++) {
      const ang = (i / 50) * Math.PI * 2;
      particles.push({
        x: player.x, y: player.y,
        vx: Math.cos(ang) * 200, vy: Math.sin(ang) * 200,
        life: 0.8, maxLife: 0.8, color: '#fbbf24', size: 6
      });
    }
    // 清空敌方子弹
    enemyBullets.length = 0;
    // 消灭普通敌人（Boss/幽灵保留）
    const survivors = [];
    for (const e of enemies) {
      if (e.isBossLike || e.type === 'boss' || e.type === 'ghost') {
        survivors.push(e);
      } else {
        explode(e.x, e.y, e.color, 10);
        score += 50;
      }
    }
    enemies.length = 0;
    enemies.push(...survivors);
  }

  function endGame() {
    running = false; gameOver = true;
    $gameover.classList.add('show');
    if (score > best) { best = score; localStorage.setItem(BEST_KEY, best); $best.textContent = best; }
  }

  function startWave() { waveSpawned = 0; bossSpawned = false; ghostSpawned = false; waveTotal = 6 + wave * 2; $wave.textContent = wave; }

  function init() {
    player = { x: W / 2, y: H - 60, w: 28, h: 28, invincible: 0, cooldown: 0 };
    bullets = []; enemyBullets = []; enemies = []; particles = []; powerups = [];
    score = 0; lives = diffCfg.lives; wave = 1; spawnTimer = 0; waveSpawned = 0; bossSpawned = false; ghostSpawned = false;
    buffs = { shield: 0, power: 0, laser: 0 };
    gameOver = false; paused = false;
    $score.textContent = 0; $lives.textContent = lives; $wave.textContent = 1;
    $gameover.classList.remove('show');
    updateBuffsUI();
    initStars(); startWave();
    // 清空输入状态，防止残留按键导致卡死
    keys = {}; joyX = 0; joyY = 0; fireHeld = false; slowMo = false;
  }

  function initStars() {
    stars = [];
    for (let i = 0; i < 70; i++) {
      stars.push({ x: Math.random() * W, y: Math.random() * H, size: Math.random() * 2 + 0.5, speed: Math.random() * 60 + 30 });
    }
  }

  // ==== 绘制 ====
  function draw() {
    ctx.fillStyle = '#0c0a09'; ctx.fillRect(0, 0, W, H);
    for (const s of stars) { ctx.fillStyle = `rgba(255,255,255,${0.3 + s.speed / 100})`; ctx.fillRect(s.x, s.y, s.size, s.size); }
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife); ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;

    // 掉落道具
    for (const p of powerups) {
      const pulse = 1 + Math.sin(Date.now() / 150) * 0.15;
      ctx.save(); ctx.translate(p.x, p.y); ctx.scale(pulse, pulse);
      const colors = { shield: '#22c55e', power: '#fbbf24', laser: '#ec4899', life: '#ef4444' };
      const icons = { shield: '🛡', power: '⚡', laser: '💫', life: '❤️' };
      ctx.fillStyle = colors[p.type] || '#fff';
      ctx.beginPath(); ctx.arc(0, 0, p.r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(icons[p.type] || '?', 0, 1);
      ctx.restore();
    }

    // 玩家子弹
    for (const b of bullets) {
      ctx.fillStyle = b.color || '#fef08a';
      if (b.pierce) { ctx.fillRect(b.x - (b.w || 4) / 2, b.y - (b.h || 30) / 2, b.w || 4, b.h || 30); }
      else { ctx.fillRect(b.x - (b.w || 3) / 2, b.y - (b.h || 10) / 2, b.w || 3, b.h || 10); }
    }

    // 敌机子弹
    for (const b of enemyBullets) {
      ctx.fillStyle = b.homing ? '#22d3ee' : '#f87171';
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
    }

    for (const e of enemies) drawEnemy(e);
    if (player) drawPlayer();

    // 减速模式：绘制判定点
    if (slowMo && player) {
      ctx.strokeStyle = '#60a5fa'; ctx.lineWidth = 1; ctx.globalAlpha = 0.6;
      ctx.beginPath(); ctx.arc(player.x, player.y, 10, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#60a5fa'; ctx.beginPath(); ctx.arc(player.x, player.y, 2, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }

    // 护盾
    if (buffs.shield > 0 && player) {
      ctx.strokeStyle = '#22c55e'; ctx.lineWidth = 2; ctx.globalAlpha = 0.7 + Math.sin(Date.now() / 200) * 0.2;
      ctx.beginPath(); ctx.arc(player.x, player.y, 20, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // 幽灵倒计时
    for (const e of enemies) {
      if (e.isGhost && e.ghostTimer > 0) {
        ctx.fillStyle = '#fff'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(e.ghostTimer.toFixed(0), e.x, e.y + 4);
      }
    }
  }

  function drawPlayer() {
    if (player.invincible > 0 && Math.floor(player.invincible * 10) % 2 === 0) return;
    ctx.save(); ctx.translate(player.x, player.y);
    ctx.fillStyle = buffs.laser > 0 ? '#ec4899' : (buffs.power > 0 ? '#fbbf24' : '#60a5fa');
    ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(10, 10); ctx.lineTo(0, 5); ctx.lineTo(-10, 10); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#fb923c';
    ctx.beginPath(); ctx.moveTo(-4, 8); ctx.lineTo(0, 16 + Math.random() * 4); ctx.lineTo(4, 8); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  function drawEnemy(e) {
    ctx.save(); ctx.translate(e.x, e.y);
    if (e.isGhost) {
      // 幽灵：半透明
      ctx.globalAlpha = 0.5 + Math.sin(Date.now() / 200) * 0.2;
      ctx.fillStyle = e.color;
      ctx.beginPath(); ctx.arc(0, 0, e.w / 2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(-5, -2, 3, 0, Math.PI * 2); ctx.arc(5, -2, 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.arc(-5, -2, 1.5, 0, Math.PI * 2); ctx.arc(5, -2, 1.5, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.restore(); return;
    }
    ctx.fillStyle = e.color;
    if (e.type === 'boss') {
      ctx.beginPath(); ctx.ellipse(0, 0, e.w / 2, e.h / 2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#7f1d1d'; ctx.fillRect(-10, e.h / 2 - 8, 20, 8);
      const pct = e.hp / e.maxHp;
      ctx.fillStyle = '#292524'; ctx.fillRect(-e.w / 2, -e.h / 2 - 12, e.w, 5);
      ctx.fillStyle = pct > 0.3 ? '#22c55e' : '#ef4444'; ctx.fillRect(-e.w / 2, -e.h / 2 - 12, e.w * pct, 5);
    } else if (e.type === 'scout') {
      ctx.beginPath(); ctx.moveTo(0, e.h / 2); ctx.lineTo(e.w / 2, 0); ctx.lineTo(0, -e.h / 2); ctx.lineTo(-e.w / 2, 0); ctx.closePath(); ctx.fill();
    } else if (e.type === 'tank') {
      ctx.fillRect(-e.w / 2, -e.h / 2, e.w, e.h);
      ctx.fillStyle = '#365314'; ctx.fillRect(-e.w / 4, -e.h / 4, e.w / 2, e.h / 2);
    } else if (e.type === 'gunship') {
      ctx.beginPath(); ctx.arc(0, 0, e.w / 2, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#fbcfe8'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(0, -e.h / 2 - 2, e.w / 2 + 4, 2, 0, 0, Math.PI * 2); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.moveTo(0, e.h / 2); ctx.lineTo(e.w / 2, -e.h / 2); ctx.lineTo(0, -e.h / 4); ctx.lineTo(-e.w / 2, -e.h / 2); ctx.closePath(); ctx.fill();
    }
    if (e.type !== 'small' && e.hp < e.maxHp) {
      const pct = e.hp / e.maxHp;
      ctx.fillStyle = '#292524'; ctx.fillRect(-e.w / 2, -e.h / 2 - 6, e.w, 3);
      ctx.fillStyle = '#22c55e'; ctx.fillRect(-e.w / 2, -e.h / 2 - 6, e.w * pct, 3);
    }
    ctx.restore();
  }

  // ==== 主循环 ====
  let _loopTick = 0;
  function loop(time) {
    if (!lastTime) lastTime = time;
    const dt = Math.min(0.05, (time - lastTime) / 1000);
    lastTime = time;
    try {
      if (running && !paused) update(dt);
      draw();
    } catch (err) {
      console.error('[fighter] loop error:', err);
      // 出错也继续循环，不卡死
    }
    // 每 60 帧打印一次状态，方便调试
    _loopTick++;
    if (_loopTick % 120 === 0) {
      console.log('[fighter] tick=' + _loopTick + ' running=' + running + ' paused=' + paused + ' keys=' + JSON.stringify(keys) + ' playerAt=' + (player ? player.x.toFixed(0) + ',' + player.y.toFixed(0) : 'null'));
    }
    requestAnimationFrame(loop);
  }

  function start() { if (running) return; init(); running = true; lastTime = 0; console.log('[fighter] STARTED'); requestAnimationFrame(loop); }
  function pause() { if (!running) return; paused = !paused; document.getElementById('ft-pause').textContent = paused ? '继续' : '暂停'; }
  function restart() { init(); running = true; paused = false; lastTime = 0; document.getElementById('ft-pause').textContent = '暂停'; console.log('[fighter] RESTARTED'); }

  // ==== 战绩榜单 ====
  function loadScores() { try { return JSON.parse(localStorage.getItem(SCORES_KEY) || '[]'); } catch { return []; } }
  function saveScores(list) { localStorage.setItem(SCORES_KEY, JSON.stringify(list.slice(0, 10))); }
  function renderScores() {
    const list = loadScores();
    if (list.length === 0) { $scoreList.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:8px;">暂无战绩</div>'; return; }
    $scoreList.innerHTML = list.map((s, i) => `
      <div class="ft-score-row ${i === 0 ? 'win' : ''}">
        <span class="rank">#${i + 1}</span>
        <span class="name">${escapeHtml(s.name)}</span>
        <span class="score">${s.score}${s.wave ? ` · W${s.wave}` : ''}</span>
      </div>`).join('');
  }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  $uploadBtn.addEventListener('click', () => {
    const name = ($nameInput.value || '').trim();
    if (!name) { alert('请输入昵称'); return; }
    if (currentScore <= 0) { alert('先玩一局再上传吧！'); return; }
    const list = loadScores();
    list.push({ name: name.slice(0, 12), score: currentScore, wave: currentWave, date: new Date().toISOString() });
    list.sort((a, b) => b.score - a.score); saveScores(list); renderScores();
    $nameInput.value = ''; alert('上传成功！🎉');
  });

  // ==== 难度选择 ====
  document.querySelectorAll('.ft-difficulty button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.ft-difficulty button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      difficulty = btn.dataset.diff; diffCfg = DIFF[difficulty];
      localStorage.setItem(DIFF_KEY, difficulty);
      if (running) restart();
    });
  });
  // 初始化难度按钮
  document.querySelector(`.ft-difficulty button[data-diff="${difficulty}"]`).classList.add('active');

  // ==== 自动射击 ====
  const $autoFire = document.getElementById('ft-auto-fire');
  $autoFire.checked = autoFire;
  $autoFire.addEventListener('change', () => { autoFire = $autoFire.checked; localStorage.setItem(AUTO_FIRE_KEY, autoFire ? '1' : '0'); });

  // ==== 输入（极简版，排除一切干扰）====
  const GAME_KEYS = ['arrowup','arrowdown','arrowleft','arrowright',' ','w','a','s','d','p','shift'];

  document.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    console.log('[fighter] keydown:', k);
    keys[k] = true;
    if (GAME_KEYS.includes(k)) e.preventDefault();
    if (k === 'p' && running) pause();
    if (k === 'shift') slowMo = true;
  });
  document.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    keys[k] = false;
    if (k === 'shift') slowMo = false;
  });
  // 窗口失焦时清空所有按键
  window.addEventListener('blur', () => { keys = {}; slowMo = false; fireHeld = false; joyX = 0; joyY = 0; });

  document.getElementById('ft-start').addEventListener('click', () => { if (running) restart(); else start(); });
  document.getElementById('ft-pause').addEventListener('click', pause);
  document.getElementById('ft-restart').addEventListener('click', restart);

  // 虚拟摇杆
  const joy = document.getElementById('ft-joystick');
  const knob = document.getElementById('ft-joystick-knob');
  let joyActive = false, joyTouchId = null;
  joy.addEventListener('touchstart', (e) => { e.preventDefault(); joyActive = true; const t = e.touches[0]; joyTouchId = t.identifier; updateJoy(t.clientX, t.clientY); }, { passive: false });
  joy.addEventListener('touchmove', (e) => { e.preventDefault(); for (const t of e.touches) { if (t.identifier === joyTouchId) { updateJoy(t.clientX, t.clientY); break; } } }, { passive: false });
  joy.addEventListener('touchend', () => { joyActive = false; joyTouchId = null; joyX = 0; joyY = 0; knob.style.transform = 'translate(0, 0)'; });
  function updateJoy(cx, cy) {
    const rect = joy.getBoundingClientRect();
    const jx = cx - rect.left - rect.width / 2, jy = cy - rect.top - rect.height / 2;
    const max = rect.width / 2 - 20;
    const dist = Math.hypot(jx, jy), scale = dist > max ? max / dist : 1;
    const rx = jx * scale, ry = jy * scale;
    knob.style.transform = `translate(${rx}px, ${ry}px)`;
    joyX = (rx / max) * 0.8; joyY = (ry / max) * 0.8;
  }

  const fireBtn = document.getElementById('ft-fire-btn');
  fireBtn.addEventListener('touchstart', (e) => { e.preventDefault(); fireHeld = true; }, { passive: false });
  fireBtn.addEventListener('touchend', (e) => { e.preventDefault(); fireHeld = false; });
  fireBtn.addEventListener('mousedown', () => fireHeld = true);
  fireBtn.addEventListener('mouseup', () => fireHeld = false);
  fireBtn.addEventListener('mouseleave', () => fireHeld = false);

  function applyConfig() {
    document.getElementById('site-title').textContent = SITE_CONFIG.title;
    document.getElementById('footer-text').textContent = SITE_CONFIG.footer;
  }
  applyConfig();

  initStars(); draw(); renderScores();
})();
