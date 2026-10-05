(function () {
  const base = (window.SITE_CONFIG && SITE_CONFIG.base) || '/';
  const STORAGE_KEY = 'blog_music_state';
  const MUSIC_CACHE_KEY = 'blog_music_json';
  const MUSIC_CACHE_TTL = 60000;

  let MUSIC = [];
  let current = 0;
  let playing = false;
  let mode = 'collapsed';
  let peekTimer = null;
  let pendingResume = false; // autoplay 被阻止时，等待用户首次交互后恢复

  /* ============ 性能优化：懒创建 Audio，但首次用户交互即预热 ============ */
  let _audio = null;

  function ensureAudio() {
    if (_audio) return _audio;
    _audio = new Audio();
    _audio.preload = 'auto';
    _audio.addEventListener('ended', () => load(current + 1, true, true));
    _audio.addEventListener('play', () => {
      // 浏览器真正开始播放时同步 UI（覆盖各种来源的 play 状态）
      playing = true;
      pendingResume = false;
      $('music-play').textContent = '❚❚';
      updateName();
    });
    let lastSave = 0;
    _audio.addEventListener('timeupdate', () => {
      const now = Date.now();
      if (now - lastSave > 1000) {
        lastSave = now;
        save();
      }
    });
    _audio.addEventListener('loadedmetadata', save);
    // 注：不绑定 pause 事件，避免切换 src 时触发 pause 导致 UI 闪烁
    // pause 状态由 play() Promise 的 catch 与 pause() 函数显式管理
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

  /* ============ 预热：用户首次任意交互即创建 Audio 并预载 src ============ */
  // 解决问题1：响应缓慢。这样真正点播放时 Audio 已 ready，几乎瞬时响应
  function warmup() {
    if (_audio) return;
    const item = currentItem();
    if (!item) return;
    const a = ensureAudio();
    if (!a.src) a.src = absSrc(item.src);
  }

  // 首次任意交互（click / keydown）触发预热，并处理被阻止的 autoplay 恢复
  function onFirstInteraction(e) {
    // 跳过音乐抽屉自身的点击，避免与播放按钮的 handler 冲突
    if (e && e.target && e.target.closest && e.target.closest('#music-drawer')) {
      warmup(); // 仍预热
      return;
    }
    warmup();
    if (pendingResume) {
      pendingResume = false;
      play();
    }
    window.removeEventListener('click', onFirstInteraction, true);
    window.removeEventListener('keydown', onFirstInteraction, true);
    document.removeEventListener('touchstart', onFirstInteraction, true);
  }
  window.addEventListener('click', onFirstInteraction, true);
  window.addEventListener('keydown', onFirstInteraction, true);
  document.addEventListener('touchstart', onFirstInteraction, true);

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
    const a = ensureAudio();
    a.src = absSrc(currentItem().src);
    updateName();
    renderList();
    if (autoplay) play();
    if (doPeek) peek();
    save();
  }

  /* ============ 修复问题1：play() 正确处理 Promise，不再静默吞错 ============ */
  function play() {
    if (!MUSIC.length) {
      setMode('expanded');
      return;
    }
    const a = ensureAudio();
    if (!a.src) {
      a.src = absSrc(currentItem().src);
    }
    const p = a.play();
    if (p && p.then) {
      p.then(() => {
        // 真正开始播放后才设状态（play 事件已处理，此处兜底）
        playing = true;
        pendingResume = false;
        $('music-play').textContent = '❚❚';
        updateName();
      }).catch((err) => {
        // 调试输出，便于定位真实错误（src 404 / 格式不支持 / autoplay 阻止）
        console.warn('[player] play() rejected:', err,
          '| src:', a.src,
          '| readyState:', a.readyState,
          '| networkState:', a.networkState,
          '| error:', a.error);
        const errName = (err && err.name) || '';
        if (errName === 'NotAllowedError' || errName === 'AbortError') {
          // autoplay 阻止或被打断：标记待恢复
          pendingResume = true;
          playing = false;
          $('music-play').textContent = '▶';
          const sub = $('music-sub');
          if (sub) sub.textContent = '点击页面任意位置恢复播放';
        } else {
          // 其他错误（如 NotSupportedError：src 404 或格式不支持）
          pendingResume = false;
          playing = false;
          $('music-play').textContent = '▶';
          const sub = $('music-sub');
          const msg = (err && err.message) || errName || '未知错误';
          if (sub) sub.textContent = '无法播放：' + msg;
        }
      });
    } else {
      // 旧浏览器同步返回
      playing = true;
      $('music-play').textContent = '❚❚';
      updateName();
    }
    save();
  }

  function pause() {
    if (!_audio) return; // 未创建 audio 时无需暂停
    _audio.pause();
    playing = false;
    pendingResume = false;
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

  /* ============ 修复问题2：localStorage 跨页保持状态 ============ */
  function save() {
    try {
      const a = _audio;
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        current,
        time: a ? a.currentTime || 0 : 0,
        playing,
        pendingResume,
        ts: Date.now()
      }));
    } catch (e) {}
  }

  /* ============ 修复问题2：跨页恢复 - 立即设置 src + currentTime ============ */
  function restore() {
    try {
      const s = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!s || !MUSIC.length) return;
      if (typeof s.current === 'number' && s.current < MUSIC.length) {
        current = s.current;
        const item = currentItem();
        if (!item) return;

        // 立即创建 audio 并设置 src，让浏览器并行预载
        const a = ensureAudio();
        a.src = absSrc(item.src);

        // 恢复播放进度（loadedmetadata 后才能设 currentTime）
        if (typeof s.time === 'number' && s.time > 0) {
          const apply = () => { try { a.currentTime = s.time; } catch (e) {} };
          if (a.readyState >= 1) apply();
          else a.addEventListener('loadedmetadata', apply, { once: true });
        }

        updateName();
        renderList();

        // 关键：不在此处调用 a.play()！
        // 页面加载时无用户手势，a.play() 必然被 reject，且会让 _audio 元素
        // 进入 interrupted 状态，导致后续用户点击时的 a.play() 也失败。
        // 改为只设置 pendingResume 标志，等用户首次点击触发 play()。
        if (s.playing || s.pendingResume) {
          pendingResume = true;
          playing = false;
          $('music-play').textContent = '▶';
          const sub = $('music-sub');
          if (sub) sub.textContent = '点击页面任意位置恢复播放';
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

  /* ============ 修复：接收 music-manage.js 派发的最新列表 ============ */
  // 音乐管理页通过 GitHub API 拿到的列表比本地 data/music.json 新（Actions 还没跑）
  // 接收后更新抽屉列表，否则抽屉显示空列表导致播放无声音
  window.addEventListener('blog:music-list', (e) => {
    const list = e && e.detail;
    if (!Array.isArray(list)) return;
    MUSIC = list;
    // 同步缓存
    try {
      sessionStorage.setItem(MUSIC_CACHE_KEY, JSON.stringify({ data: list, ts: Date.now() }));
    } catch (e2) {}
    // 当前索引若超出范围则归零
    if (current >= MUSIC.length) current = 0;
    renderList();
    updateName();
    // 若未播放且未预热 audio，列表更新后无需额外动作；
    // 若正在播放或待恢复，让 src 保持，下次切歌会用到新列表
  });

  /* ============ 修复：点击抽屉外部关闭抽屉 ============ */
  // 抽屉展开时，点击正文区域自动收起
  document.addEventListener('click', (e) => {
    if (mode !== 'expanded' && mode !== 'peek') return;
    // 点击抽屉自身或抽屉内任意元素，不处理
    if (e.target && e.target.closest && e.target.closest('#music-drawer')) return;
    setMode('collapsed');
  });

  /* ============ 修复问题2：可靠的状态保存事件 ============ */
  // pagehide 比 beforeunload 更可靠（移动端、bfcache 等场景）
  window.addEventListener('pagehide', save);
  window.addEventListener('beforeunload', save);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') save();
  });

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
    if (MUSIC.length) {
      // 立即恢复状态：设置 src + currentTime，并尝试续播
      restore();
    }
  })();
})();
