(function () {
  const MUSIC = (window.SITE_CONFIG && SITE_CONFIG.music) || [];
  if (!MUSIC.length) return; // 没配置音乐就不显示播放器

  const STORAGE_KEY = 'blog_music_state';
  const base = (window.SITE_CONFIG && SITE_CONFIG.base) || '/';

  const html = `
    <div id="music-player" class="music-player">
      <button id="music-fab" class="music-fab" aria-label="音乐">♪</button>
      <div id="music-panel" class="music-panel" hidden>
        <div class="music-meta">
          <span class="music-name" id="music-name">未播放</span>
          <span class="music-status" id="music-status"></span>
        </div>
        <div class="music-controls">
          <button id="music-prev" aria-label="上一首">⏮</button>
          <button id="music-play" aria-label="播放/暂停">▶</button>
          <button id="music-next" aria-label="下一首">⏭</button>
          <button id="music-close" aria-label="关闭">✕</button>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', html);

  const $ = id => document.getElementById(id);
  const audio = new Audio();
  audio.loop = false;
  audio.preload = 'auto';

  let current = 0;
  let playing = false;

  function absSrc(src) {
    if (/^https?:\/\//.test(src) || src.startsWith('/')) return src;
    return base + src;
  }

  function updateName() {
    const item = MUSIC[current];
    if (!item) return;
    $('music-name').textContent = item.name || '未知曲目';
    document.title = playing
      ? `♪ ${item.name} · ${SITE_CONFIG.title}`
      : SITE_CONFIG.title;
    $('music-status').textContent = `${current + 1} / ${MUSIC.length}`;
  }

  function load(index, autoplay) {
    current = (index + MUSIC.length) % MUSIC.length;
    audio.src = absSrc(MUSIC[current].src);
    updateName();
    if (autoplay) play();
  }

  function play() {
    const p = audio.play();
    if (p && p.catch) p.catch(() => {});
    playing = true;
    $('music-play').textContent = '❚❚';
    updateName();
    save();
  }

  function pause() {
    audio.pause();
    playing = false;
    $('music-play').textContent = '▶';
    updateName();
    save();
  }

  function togglePanel(open) {
    $('music-panel').hidden = !open;
  }

  function save() {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
        current,
        time: audio.currentTime || 0,
        playing
      }));
    } catch (e) {}
  }

  function restore() {
    try {
      const s = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null');
      if (!s) return;
      if (typeof s.current === 'number') {
        current = s.current;
        audio.src = absSrc(MUSIC[current].src);
        updateName();
      }
      if (typeof s.time === 'number' && s.time > 0) {
        audio.addEventListener('loadedmetadata', function once() {
          audio.removeEventListener('loadedmetadata', once);
          try { audio.currentTime = s.time; } catch (e) {}
        });
      }
      if (s.playing) {
        // 尝试恢复播放（可能被浏览器自动播放策略拦截）
        play();
      }
    } catch (e) {}
  }

  $('music-fab').addEventListener('click', () => {
    togglePanel(true);
    if (!playing) {
      if (!audio.src) load(current, true);
      else play();
    }
  });

  $('music-play').addEventListener('click', () => {
    if (playing) pause(); else play();
  });

  $('music-prev').addEventListener('click', () => load(current - 1, playing));
  $('music-next').addEventListener('click', () => load(current + 1, playing));

  $('music-close').addEventListener('click', () => {
    pause();
    togglePanel(false);
  });

  audio.addEventListener('ended', () => load(current + 1, true));

  let lastSave = 0;
  audio.addEventListener('timeupdate', () => {
    const now = Date.now();
    if (now - lastSave > 1000) {
      lastSave = now;
      save();
    }
  });

  window.addEventListener('beforeunload', save);

  // 初始化
  audio.src = absSrc(MUSIC[current].src);
  updateName();
  restore();
})();