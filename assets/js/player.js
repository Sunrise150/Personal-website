(function () {
  const base = (window.SITE_CONFIG && SITE_CONFIG.base) || '/';
  const STORAGE_KEY = 'blog_music_state';
  const MUSIC_CACHE_KEY = 'blog_music_json';
  const MUSIC_CACHE_TTL = 60000; // 60s 内跨页复用 music.json，避免每页都 fetch

  let MUSIC = [];
  let current = 0;
  let playing = false;
  let mode = 'collapsed'; // collapsed | peek | expanded
  let peekTimer = null;

  // 性能优化：延迟创建 Audio，首次播放时才实例化
  let _audio = null;
  function audio() {
    if (!_audio) {
      _audio = new Audio();
      _audio.preload = 'auto';
      _audio.addEventListener('ended', () => load(current + 1, true, true));
      let lastSave = 0;
      _audio.addEventListener('timeupdate', () => {
        const now = Date.now();
        if (now - lastSave > 1000) {
          lastSave = now;
          save();
        }
      });
    }
    return _audio;
  }

  const html = `
    <div id="music-drawer" class="music-drawer is-collapsed">
      <div class="music-drawer-body">
        <div class="music-head">
          <span>音乐</span>
          <button id="music-collapse" class="music-head-close" aria-label="收起">✕</button>
        </div>
        <div class="music-now">
          <div class="music-now-name" id="music-name">未播放</div>
          <div class="music-now-sub" id="music-sub">点击 ♪ 展开</div>
        </div>
        <div class="music-controls">
          <button id="music-prev" aria-label="上一首">⏮</button>
          <button id="music-play" aria-label="播放/暂停">▶</button>
          <button id="music-next" aria-label="下一首">⏭</button>
        </div>
        <div class="music-list" id="music-list">
          <div class="music-list-empty">加载中…</div>
        </div>
      </div>
      <button id="music-tab" class="music-tab" aria-label="音乐">♪</button>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', html);

  const $ = id => document.getElementById(id);
  const drawer = $('music-drawer');

  function setMode(m) {
    mode = m;
    drawer.classList.remove('is-collapsed', 'is-peek', 'is-expanded');
    drawer.classList.add('is-' + m);
  }

  function absSrc(src) {
    if (!src) return '';
    if (/^https?:\/\//.test(src) || src.startsWith('/')) return src;
    return base + src;
  }

  function currentItem() {
    return MUSIC[current] || null;
  }

  function updateName() {
    const item = currentItem();
    if (!item) {
      $('music-name').textContent = '未播放';
      $('music-sub').textContent = MUSIC.length ? '' : '还没有音乐';
      return;
    }
    $('music-name').textContent = item.name || '未知曲目';
    $('music-sub').textContent = item.artist
      ? item.artist
      : `${current + 1} / ${MUSIC.length}`;
    document.title = playing
      ? `♪ ${item.name} · ${SITE_CONFIG.title}`
      : SITE_CONFIG.title;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[m]));
  }

  function renderList() {
    const list = $('music-list');
    if (!MUSIC.length) {
      list.innerHTML = '<div class="music-list-empty">还没有音乐，去「音乐」页面上传</div>';
      return;
    }
    list.innerHTML = MUSIC.map((m, i) => `
      <div class="music-list-item ${i === current ? 'active' : ''}" data-i="${i}">
        <span class="music-list-name">${escapeHtml(m.name || '未知曲目')}</span>
        <span class="music-list-artist">${escapeHtml(m.artist || '')}</span>
      </div>
    `).join('');
    list.querySelectorAll('.music-list-item').forEach(el => {
      el.addEventListener('click', () => {
        load(Number(el.dataset.i), true, false);
      });
    });
  }

  function load(index, autoplay, doPeek) {
    if (!MUSIC.length) return;
    current = (index + MUSIC.length) % MUSIC.length;
    audio().src = absSrc(currentItem().src);
    updateName();
    renderList();
    if (autoplay) play();
    if (doPeek) peek();
    save();
  }

  function play() {
    if (!MUSIC.length) {
      setMode('expanded');
      return;
    }
    if (!audio().src) {
      load(current, true, false);
      return;
    }
    const p = audio().play();
    if (p && p.catch) p.catch(() => {});
    playing = true;
    $('music-play').textContent = '❚❚';
    updateName();
    save();
  }

  function pause() {
    audio().pause();
    playing = false;
    $('music-play').textContent = '▶';
    updateName();
    save();
  }

  function peek() {
    if (mode === 'expanded') return;
    setMode('peek');
    clearTimeout(peekTimer);
    peekTimer = setTimeout(() => {
      if (mode === 'peek') setMode('collapsed');
    }, 3500);
  }

  function save() {
    try {
      const a = _audio; // 未初始化时无需保存播放进度
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
        current,
        time: a ? a.currentTime || 0 : 0,
        playing
      }));
    } catch (e) {}
  }

  function restore() {
    try {
      const s = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null');
      if (!s || !MUSIC.length) return;
      if (typeof s.current === 'number' && s.current < MUSIC.length) {
        current = s.current;
        // 仅当之前在播放时才创建 audio，避免无谓开销
        if (s.playing || (typeof s.time === 'number' && s.time > 0)) {
          audio().src = absSrc(currentItem().src);
        }
        updateName();
        renderList();
      }
      if (typeof s.time === 'number' && s.time > 0 && _audio) {
        const a = audio();
        const apply = () => { try { a.currentTime = s.time; } catch (e) {} };
        if (a.readyState >= 1) apply();
        else a.addEventListener('loadedmetadata', apply, { once: true });
      }
      if (s.playing) {
        const p = audio().play();
        if (p && p.then) {
          p.then(() => {
            playing = true;
            $('music-play').textContent = '❚❚';
            updateName();
          }).catch(() => {
            playing = false;
            $('music-play').textContent = '▶';
          });
        }
      }
    } catch (e) {}
  }

  /* 事件 */
  $('music-tab').addEventListener('click', () => {
    if (mode === 'expanded') setMode('collapsed');
    else setMode('expanded');
  });

  $('music-collapse').addEventListener('click', () => setMode('collapsed'));

  $('music-play').addEventListener('click', () => {
    if (playing) pause(); else play();
  });

  $('music-prev').addEventListener('click', () => load(current - 1, playing, true));
  $('music-next').addEventListener('click', () => load(current + 1, playing, true));

  // 性能优化：ended / timeupdate 事件已移入 audio() 延迟初始化中
  window.addEventListener('beforeunload', save);

  /* 初始化：带 sessionStorage 缓存的 music.json，避免每次跳页都发请求 */
  (async function init() {
    try {
      const cached = sessionStorage.getItem(MUSIC_CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && Array.isArray(parsed.data) && Date.now() - parsed.ts < MUSIC_CACHE_TTL) {
          MUSIC = parsed.data;
        }
      }
      if (!MUSIC.length) {
        const res = await fetch('data/music.json?t=' + Date.now());
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data)) {
            MUSIC = data;
            sessionStorage.setItem(MUSIC_CACHE_KEY, JSON.stringify({ data, ts: Date.now() }));
          }
        }
      }
    } catch (e) {}
    renderList();
    updateName();
    // 性能优化：不再预加载第一首的 src，仅在用户点击播放时才创建 audio
    if (MUSIC.length) {
      restore();
    }
  })();
})();