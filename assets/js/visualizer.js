/* ============ 音乐可视化 —— 水平直方图 + 圆形频谱 ============
 *
 * 两种模式：
 *   bar   — 底部水平条形图（默认）
 *   circle — 右下角圆形频谱（居中辐射柱）
 *
 * 双击 canvas 或长按 🎵 按钮切换模式，🎵 按钮短按开/关
 * 状态持久化到 localStorage
 */
(function () {
  if (window.top !== window.self) return;

  // ===== 读取偏好 =====
  let vizOn = false;
  let mode = 'bar'; // 'bar' | 'circle'
  try {
    vizOn = localStorage.getItem('blog-viz') === '1';
    mode = localStorage.getItem('blog-viz-mode') || 'bar';
  } catch {}

  const canvas = document.createElement('canvas');
  canvas.id = 'audio-viz';
  applyModeStyle(); // 先应用样式再 append
  canvas.style.cssText += 'pointer-events:auto; z-index:7999;';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  let audioCtx = null, analyser = null, source = null;
  let freqData = null;
  let connectedAudio = null;
  let rafId = null;

  // 视觉参数
  const BAR_COUNT = 64;
  const BAR_SMOOTH_UP = 0.7;    // 上升快
  const BAR_SMOOTH_DOWN = 0.88; // 下降慢
  const barSmoothed = new Array(BAR_COUNT).fill(0);
  const barPeak = new Array(BAR_COUNT).fill(0);
  const PEAK_DECAY = 0.94;

  let dpr = window.devicePixelRatio || 1;

  function applyModeStyle() {
    if (mode === 'bar') {
      canvas.style.cssText = `
        position:fixed; left:0; right:0; bottom:64px; height:56px;
        pointer-events:auto; z-index:7999; opacity:0.9;
        display:${vizOn ? '' : 'none'};
      `;
    } else {
      // 圆形：右下角正方形，稍微浮起
      canvas.style.cssText = `
        position:fixed; right:20px; bottom:80px; width:220px; height:220px;
        pointer-events:auto; z-index:7999; opacity:0.92;
        border-radius:50%;
        display:${vizOn ? '' : 'none'};
      `;
    }
  }

  function resize() {
    dpr = window.devicePixelRatio || 1;
    if (mode === 'bar') {
      canvas.width = window.innerWidth * dpr;
      canvas.height = 56 * dpr;
      canvas.style.width = window.innerWidth + 'px';
      canvas.style.height = '56px';
    } else {
      const size = 220;
      canvas.width = size * dpr;
      canvas.height = size * dpr;
      canvas.style.width = size + 'px';
      canvas.style.height = size + 'px';
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function switchMode() {
    mode = mode === 'bar' ? 'circle' : 'bar';
    try { localStorage.setItem('blog-viz-mode', mode); } catch {}
    applyModeStyle();
    resize();
    console.log('[viz] mode →', mode);
  }

  // 双击切换
  canvas.addEventListener('dblclick', switchMode);
  // 长按（600ms）也能切换
  let pressTimer = null;
  canvas.addEventListener('touchstart', () => {
    pressTimer = setTimeout(switchMode, 600);
  }, { passive: true });
  canvas.addEventListener('touchend', () => { clearTimeout(pressTimer); }, { passive: true });
  canvas.addEventListener('touchcancel', () => { clearTimeout(pressTimer); }, { passive: true });

  function ensureAnalyser() {
    const player = window.__blogPlayer;
    if (!player) return false;
    const audio = player.getAudio && player.getAudio();
    if (!audio) return false;
    if (analyser && connectedAudio === audio) {
      if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
      return true;
    }
    if (analyser) {
      try { source.disconnect(); analyser.disconnect(); } catch(e) {}
      source = null; analyser = null;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!audioCtx) audioCtx = new AC();
      if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
      source = audioCtx.createMediaElementSource(audio);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.75;
      analyser.minDecibels = -80;
      analyser.maxDecibels = -10;
      source.connect(analyser);
      analyser.connect(audioCtx.destination);
      freqData = new Uint8Array(analyser.frequencyBinCount);
      connectedAudio = audio;
      console.log('[viz] connected, mode=', mode);
      return true;
    } catch (e) {
      console.warn('[viz] connect fail:', e.message);
      return false;
    }
  }

  function computeBars() {
    const binLen = freqData.length;
    const bars = new Array(BAR_COUNT);
    const binsPerBar = binLen / BAR_COUNT;
    for (let b = 0; b < BAR_COUNT; b++) {
      let sum = 0;
      const start = Math.floor(b * binsPerBar);
      const end = Math.floor((b + 1) * binsPerBar);
      for (let i = start; i < end; i++) sum += freqData[i];
      bars[b] = sum / (end - start) / 255;
    }
    return bars;
  }

  function smoothBars(rawBars) {
    for (let i = 0; i < BAR_COUNT; i++) {
      const target = rawBars[i];
      const smooth = target > barSmoothed[i] ? BAR_SMOOTH_UP : BAR_SMOOTH_DOWN;
      barSmoothed[i] = barSmoothed[i] * smooth + target * (1 - smooth);
      if (barSmoothed[i] > barPeak[i]) barPeak[i] = barSmoothed[i];
      else barPeak[i] *= PEAK_DECAY;
    }
  }

  // ===== 绘制：水平条形 =====
  function drawBar(w, h) {
    const gapRatio = 0.25;
    const barW = w / BAR_COUNT * (1 - gapRatio);
    const gap = w / BAR_COUNT * gapRatio;
    const maxH = h * 1;

    for (let i = 0; i < BAR_COUNT; i++) {
      const v = Math.max(0.02, Math.min(1, barSmoothed[i]));
      const barH = v * maxH;
      const x = i * (barW + gap) + gap / 2;
      const y = h - barH;

      const t = i / BAR_COUNT;
      const hueNorm = ((120 - t * 180) % 360 + 360) % 360;
      const light = 45 + v * 25;
      const alpha = 0.7 + v * 0.3;

      const grad = ctx.createLinearGradient(0, y, 0, h);
      grad.addColorStop(0, `hsla(${hueNorm}, 85%, ${light + 10}%, ${alpha})`);
      grad.addColorStop(1, `hsla(${hueNorm}, 80%, ${light - 10}%, ${alpha})`);
      ctx.fillStyle = grad;

      roundRect(ctx, x, y, barW, barH, Math.min(barW / 2, 3));
      ctx.fill();

      // 峰值
      if (barPeak[i] > 0.05) {
        const peakY = h - barPeak[i] * maxH - 2;
        ctx.fillStyle = `hsla(${hueNorm}, 90%, ${light + 20}%, 0.9)`;
        roundRect(ctx, x, peakY, barW, 2, 1);
        ctx.fill();
      }
    }
  }

  // ===== 绘制：圆形频谱 =====
  function drawCircle(w, h) {
    const cx = w / 2, cy = h / 2;
    const baseRadius = Math.min(w, h) * 0.18;  // 内圈基础半径
    const maxRadius = Math.min(w, h) * 0.42;  // 外圈最大柱长
    const totalBars = BAR_COUNT;

    // 先画个半透明内圈，让整体看起来不那么散
    ctx.beginPath();
    ctx.arc(cx, cy, baseRadius * 0.6, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.03)';
    ctx.fill();

    // 背景参考圈（最外圈虚线）
    ctx.beginPath();
    ctx.arc(cx, cy, maxRadius, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(100,100,100,0.12)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.stroke();
    ctx.setLineDash([]);

    // 画每根辐射柱
    for (let i = 0; i < totalBars; i++) {
      const v = Math.max(0.02, Math.min(1, barSmoothed[i]));
      const innerR = baseRadius;
      const outerR = baseRadius + v * (maxRadius - baseRadius);

      // 角度：从 -90° (顶部) 开始顺时针
      const angle = -Math.PI / 2 + (i / totalBars) * Math.PI * 2;
      const nextAngle = -Math.PI / 2 + ((i + 0.85) / totalBars) * Math.PI * 2;

      const x1 = cx + Math.cos(angle) * innerR;
      const y1 = cy + Math.sin(angle) * innerR;
      const x2 = cx + Math.cos(angle) * outerR;
      const y2 = cy + Math.sin(angle) * outerR;
      const x3 = cx + Math.cos(nextAngle) * outerR;
      const y3 = cy + Math.sin(nextAngle) * outerR;
      const x4 = cx + Math.cos(nextAngle) * innerR;
      const y4 = cy + Math.sin(nextAngle) * innerR;

      // 颜色：同样 bass→treble 映射 hue，音量影响亮度
      const t = i / totalBars;
      const hueNorm = ((120 - t * 180) % 360 + 360) % 360;
      const light = 40 + v * 30;
      const alpha = 0.75 + v * 0.25;

      const grad = ctx.createRadialGradient(cx, cy, innerR, cx, cy, outerR);
      grad.addColorStop(0, `hsla(${hueNorm}, 75%, ${light}%, ${alpha})`);
      grad.addColorStop(1, `hsla(${hueNorm}, 85%, ${light + 15}%, ${alpha})`);
      ctx.fillStyle = grad;

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.lineTo(x3, y3);
      ctx.lineTo(x4, y4);
      ctx.closePath();
      ctx.fill();

      // 峰值小圆点
      if (barPeak[i] > 0.05) {
        const peakR = baseRadius + barPeak[i] * (maxRadius - baseRadius);
        const px = cx + Math.cos(angle + 0.01) * peakR;
        const py = cy + Math.sin(angle + 0.01) * peakR;
        ctx.beginPath();
        ctx.arc(px, py, 1.8, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${hueNorm}, 95%, ${light + 25}%, 0.95)`;
        ctx.fill();
      }
    }

    // 中心装饰圈
    const totalEnergy = barSmoothed.reduce((a, b) => a + b, 0) / BAR_COUNT;
    const pulseR = baseRadius * 0.5 + totalEnergy * 4;
    ctx.beginPath();
    ctx.arc(cx, cy, pulseR, 0, Math.PI * 2);
    const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, pulseR);
    cg.addColorStop(0, `hsla(210, 80%, 65%, ${0.5 + totalEnergy * 0.3})`);
    cg.addColorStop(1, `hsla(210, 80%, 50%, ${0.1})`);
    ctx.fillStyle = cg;
    ctx.fill();
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x, y + h);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function draw() {
    rafId = requestAnimationFrame(draw);
    if (!vizOn) return;

    const player = window.__blogPlayer;
    const playing = player && player.isPlaying && player.isPlaying();
    const w = canvas.width / dpr, h = canvas.height / dpr;

    ctx.clearRect(0, 0, w, h);

    if (mode === 'circle') {
      // 先画圆形的半透明底
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, Math.min(w, h) / 2, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(12,12,14,0.04)';
      ctx.fill();
    }

    if (!playing || !analyser || !freqData) {
      // 未播放：安静的基线
      const quiet = new Array(BAR_COUNT).fill(0.04);
      smoothBars(quiet);
      if (mode === 'bar') drawBar(w, h); else drawCircle(w, h);
      for (let i = 0; i < BAR_COUNT; i++) barPeak[i] *= PEAK_DECAY;
      return;
    }

    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});

    analyser.getByteFrequencyData(freqData);
    const raw = computeBars();
    smoothBars(raw);

    if (mode === 'bar') drawBar(w, h); else drawCircle(w, h);
  }

  // ===== 长按检测（给 player.js 的 🎵 按钮切换模式用） =====
  let btnPressTimer = null;
  window.__blogVizLongPress = false;

  // ===== 公共 API =====
  const VizAPI = {
    toggle(on) {
      vizOn = !!on;
      canvas.style.display = vizOn ? '' : 'none';
      try { localStorage.setItem('blog-viz', vizOn ? '1' : '0'); } catch {}
      if (vizOn) { ensureAnalyser(); resize(); }
    },
    init(on) {
      vizOn = !!on;
      canvas.style.display = vizOn ? '' : 'none';
      if (vizOn) ensureAnalyser();
    },
    show() { this.toggle(true); },
    hide() { this.toggle(false); },
    switchMode: switchMode,
    getMode: () => mode
  };

  document.addEventListener('DOMContentLoaded', () => {
    resize();
    window.addEventListener('resize', resize);
    draw();

    const checkPlayer = setInterval(() => {
      const p = window.__blogPlayer;
      const audio = p && p.getAudio && p.getAudio();
      if (audio) {
        clearInterval(checkPlayer);
        audio.addEventListener('play', () => {
          if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
          ensureAnalyser();
        });
        ensureAnalyser();
      }
    }, 200);

    ['click', 'touchstart', 'keydown'].forEach(evt => {
      window.addEventListener(evt, () => {
        if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
        ensureAnalyser();
      }, { passive: true });
    });
  });

  window.__blogViz = VizAPI;
})();
