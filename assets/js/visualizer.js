/* ============ 音乐可视化 —— 真正 Beat Detection ============
 * 
 * 默认隐藏，音乐抽屉的 🎵 按钮开关，状态记忆到 localStorage
 * Beat Detection: bass onset + 自适应阈值 + 最小间隔去密集
 */
(function () {
  if (window.top !== window.self) return;

  const canvas = document.createElement('canvas');
  canvas.id = 'audio-viz';
  canvas.style.cssText = `
    position: fixed; left: 0; right: 0;
    bottom: 64px; height: 44px; z-index: 7999;
    pointer-events: none; opacity: 0.85;
    display: none;
  `;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  let audioCtx = null, analyser = null, source = null;
  let freqData = null, timeData = null;
  let connectedAudio = null;
  let rafId = null;
  let visible = false;

  // ===== Beat Detection 状态 =====
  const BEAT = {
    bassFloor: 0, midFloor: 0, trebleFloor: 0,
    bass: 0, mid: 0, treble: 0, volume: 0,
    prevBass: 0,
    pulse: 0,
    lastBeatAt: 0,
    fluxWindow: [],
    onsetThreshold: 0.2,
    huePulse: 0
  };
  // 两个 beat 最小间隔 (ms) —— 调到 500ms = ~120BPM 上限，稳一点
  const MIN_BEAT_GAP_MS = 500;

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * dpr;
    canvas.height = 44 * dpr;
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = '44px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function computeBands() {
    const len = freqData.length;
    let bass = 0;
    for (let i = 1; i < 11; i++) bass += freqData[i] / 255;
    bass /= 10;
    let mid = 0;
    for (let i = 11; i < 81; i++) mid += freqData[i] / 255;
    mid /= 70;
    let treble = 0;
    for (let i = 81; i < len; i++) treble += freqData[i] / 255;
    treble /= Math.max(1, len - 81);
    let sumSq = 0;
    for (let i = 2; i < len; i++) {
      const v = freqData[i] / 255;
      sumSq += v * v;
    }
    const volume = Math.sqrt(sumSq / (len - 2));
    return { bass, mid, treble, volume };
  }

  function detectBeat(bands) {
    const now = performance.now();
    BEAT.bassFloor = BEAT.bassFloor * 0.97 + bands.bass * 0.03;
    BEAT.midFloor = BEAT.midFloor * 0.97 + bands.mid * 0.03;
    BEAT.trebleFloor = BEAT.trebleFloor * 0.97 + bands.treble * 0.03;
    BEAT.bass = Math.min(1, bands.bass / Math.max(0.01, BEAT.bassFloor));
    BEAT.mid = Math.min(1, bands.mid / Math.max(0.01, BEAT.midFloor));
    BEAT.treble = Math.min(1, bands.treble / Math.max(0.01, BEAT.trebleFloor));
    BEAT.volume = bands.volume;

    const flux = Math.max(0, bands.bass - BEAT.prevBass);
    BEAT.prevBass = bands.bass;

    BEAT.fluxWindow.push(flux);
    if (BEAT.fluxWindow.length > 120) BEAT.fluxWindow.shift();
    let maxFlux = 0;
    for (const f of BEAT.fluxWindow) if (f > maxFlux) maxFlux = f;
    BEAT.onsetThreshold = Math.max(0.18, maxFlux * 0.6);

    const gapOk = (now - BEAT.lastBeatAt) > MIN_BEAT_GAP_MS;
    const fluxOk = flux > BEAT.onsetThreshold;
    const bassStrong = bands.bass > BEAT.bassFloor * 1.6;

    if (gapOk && fluxOk && bassStrong) {
      BEAT.pulse = Math.min(1, flux * 3 + 0.45);
      BEAT.lastBeatAt = now;
      BEAT.huePulse = Math.min(1, BEAT.mid * 1.1 + bands.treble * 0.4);
    }

    BEAT.pulse *= 0.9;
    BEAT.huePulse *= 0.93;
    BEAT.volume *= 0.96;
  }

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
      analyser.smoothingTimeConstant = 0.82;
      analyser.minDecibels = -80;
      analyser.maxDecibels = -10;
      source.connect(analyser);
      analyser.connect(audioCtx.destination);
      freqData = new Uint8Array(analyser.frequencyBinCount);
      timeData = new Uint8Array(analyser.fftSize);
      connectedAudio = audio;
      console.log('[viz] Beat detector connected');
      return true;
    } catch (e) {
      console.warn('[viz] connect fail:', e.message);
      return false;
    }
  }

  function draw() {
    rafId = requestAnimationFrame(draw);
    // 隐藏时不画
    if (!visible) return;

    const player = window.__blogPlayer;
    const playing = player && player.isPlaying && player.isPlaying();
    const w = window.innerWidth, h = 44, cy = h / 2;

    ctx.clearRect(0, 0, w, h);

    if (!playing) {
      ctx.strokeStyle = 'rgba(96,165,250,0.2)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      const t = Date.now() / 1000;
      for (let x = 0; x <= w; x += 4) {
        const y = cy + Math.sin(x * 0.012 + t * 1.2) * 0.8;
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      BEAT.pulse *= 0.9;
      BEAT.huePulse *= 0.9;
      return;
    }

    if (!analyser) { ensureAnalyser(); }
    if (!analyser || !freqData) return;

    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }

    analyser.getByteFrequencyData(freqData);
    analyser.getByteTimeDomainData(timeData);

    const bands = computeBands();
    detectBeat(bands);

    const baseAmp = 4 + BEAT.volume * 32;
    const beatBoost = BEAT.pulse * 22;

    const hueShift = BEAT.pulse * 40 + BEAT.huePulse * 25;
    const hue1 = 210 + hueShift * 0.3;
    const hue2 = 170 + hueShift * 0.5;
    const hue3 = 260 + hueShift * 0.2;
    const alpha = 0.8 + BEAT.pulse * 0.2;

    // ===== 主波形线 =====
    ctx.lineWidth = 2 + BEAT.pulse * 1.8;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const grad = ctx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, `hsla(${hue1}, 90%, 65%, ${alpha})`);
    grad.addColorStop(0.5, `hsla(${hue2}, 95%, 60%, ${Math.min(1, alpha + 0.1)})`);
    grad.addColorStop(1, `hsla(${hue3}, 85%, 70%, ${alpha})`);
    ctx.strokeStyle = grad;
    ctx.beginPath();

    const tdLen = timeData.length;
    const step = w / tdLen;
    for (let i = 0; i < tdLen; i++) {
      const sample = (timeData[i] - 128) / 128;
      const v = Math.abs(sample);
      const midMod = 1 + BEAT.mid * 0.3;
      const amp = (v * baseAmp + beatBoost * v + BEAT.pulse * 3) * midMod;
      const x = i * step;
      const y = cy - amp * Math.sign(sample || 1);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // ===== 频谱柱 =====
    ctx.globalAlpha = 0.25 + BEAT.pulse * 0.3;
    const bars = 64;
    const stepB = w / bars;
    ctx.beginPath();
    for (let i = 0; i < bars; i++) {
      const binIdx = Math.floor(i * freqData.length / bars);
      const v = freqData[binIdx] / 255;
      const amp = v * baseAmp * 0.7 + 1 + BEAT.pulse * (i < bars * 0.25 ? 2.5 : 1);
      const x = i * stepB + stepB / 2;
      const y = cy - amp;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    const gradTop = ctx.createLinearGradient(0, 0, w, 0);
    gradTop.addColorStop(0, `hsla(${120 + BEAT.pulse * 30}, 70%, 55%, ${0.5 + BEAT.pulse * 0.4})`);
    gradTop.addColorStop(0.4, `hsla(${45 + BEAT.pulse * 20}, 85%, 55%, ${0.5 + BEAT.pulse * 0.4})`);
    gradTop.addColorStop(1, `hsla(${280 - BEAT.pulse * 40}, 75%, 60%, ${0.5 + BEAT.pulse * 0.4})`);
    ctx.strokeStyle = gradTop;
    ctx.lineWidth = 1.5 + BEAT.pulse;
    ctx.stroke();

    // ===== 下半部镜像 =====
    ctx.globalAlpha = 0.2 + BEAT.pulse * 0.2;
    ctx.beginPath();
    for (let i = 0; i < bars; i++) {
      const binIdx = Math.floor(i * freqData.length / bars);
      const v = freqData[binIdx] / 255;
      const amp = v * baseAmp * 0.5 + 1;
      const x = i * stepB + stepB / 2;
      const y = cy + amp;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = gradTop;
    ctx.lineWidth = 1;
    ctx.stroke();

    // ===== Beat 闪光 =====
    if (BEAT.pulse > 0.5) {
      ctx.globalAlpha = (BEAT.pulse - 0.5) * 2;
      ctx.strokeStyle = `hsla(${330 + BEAT.huePulse * 40}, 90%, 70%, 0.8)`;
      ctx.lineWidth = 1;
      const flashBars = 16;
      const flashStep = w / flashBars;
      ctx.beginPath();
      for (let i = 0; i < flashBars; i++) {
        const binIdx = Math.floor(i * 8);
        const v = freqData[Math.min(binIdx, freqData.length - 1)] / 255;
        const spark = v * 8 * BEAT.pulse;
        const x = i * flashStep + flashStep / 2;
        if (i === 0) ctx.moveTo(x, cy - spark - 4); else ctx.lineTo(x, cy - spark - 4);
      }
      ctx.stroke();
    }

    ctx.globalAlpha = 1;
  }

  // ===== 公共 API =====
  const VizAPI = {
    toggle(on) {
      visible = !!on;
      canvas.style.display = visible ? '' : 'none';
      if (visible) {
        ensureAnalyser();
      }
    },
    init(on) {
      visible = !!on;
      canvas.style.display = visible ? '' : 'none';
      if (visible) ensureAnalyser();
    },
    show() { this.toggle(true); },
    hide() { this.toggle(false); }
  };

  document.addEventListener('DOMContentLoaded', () => {
    resize();
    window.addEventListener('resize', resize);
    draw(); // 即使隐藏也保持 RAF（pause 时 overhead 很低）

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
