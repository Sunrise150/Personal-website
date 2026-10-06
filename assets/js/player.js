(function () {
  // 在 iframe 内（被 shell 包裹）时不加载此 player，外层 shell 已加载
  // 这样 iframe 内的页面切换不会销毁外层的 Audio 元素，音乐持续播放
  if (window.top !== window.self) return;

  const base = (window.SITE_CONFIG && SITE_CONFIG.base) || '/';
  const STORAGE_KEY = 'blog_music_state';
  const MUSIC_CACHE_KEY = 'blog_music_json';
  const MUSIC_CACHE_TTL = 60000;
  const MODE_KEY = 'blog_music_playmode';
  // 播放模式：order=顺序循环（默认）, random=随机, one=单曲循环
  let playMode = 'order';

  let MUSIC = [];
  let current = 0;
  let playing = false;
  let mode = 'collapsed';
  let peekTimer = null;
  let pendingResume = false; // autoplay 被阻止时，等待用户首次交互后恢复
  let _endedTriggered = false; // 防止 ended 重复触发

  /* ============ 性能优化：懒创建 Audio，但首次用户交互即预热 ============ */
  let _audio = null;

  /* ============ 自动切歌：ended 事件 + timeupdate 备用检测 ============ */
  function handleEnded() {
    if (_endedTriggered) return;
    _endedTriggered = true;
    // setTimeout 0 让 ended 状态清理完，避免下一首 play() 被竞态拒绝
    setTimeout(() => {
      if (playMode === 'one') {
        load(current, true, false);
      } else if (playMode === 'random') {
        let nextIdx = current;
        if (MUSIC.length > 1) {
          while (nextIdx === current) nextIdx = Math.floor(Math.random() * MUSIC.length);
        }
        load(nextIdx, true, true);
      } else {
        load(current + 1, true, true);
      }
    }, 0);
  }

  function ensureAudio() {
    if (_audio) return _audio;
    _audio = new Audio();
    _audio.preload = 'auto';
    _audio.addEventListener('ended', handleEnded);
    _audio.addEventListener('play', () => {
      _endedTriggered = false; // 开始播放时重置标志
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
      // 备用：某些浏览器/音频格式 ended 事件不触发，用 timeupdate 检测播放结束
      if (_audio.duration > 0 && _audio.currentTime >= _audio.duration - 0.3) {
        handleEnded();
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
          <button id="music-mode" class="music-mode-btn" aria-label="播放模式" title="顺序循环">↻</button>
        </div>
        <div class="music-search-bar">
          <input type="search" id="music-search-input" placeholder="搜索曲目 / 歌手…" autocomplete="off">
          <button type="button" id="music-search-clear" aria-label="清空" style="display:none">×</button>
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

  /* ============ 修复：autoplay 被阻止后的恢复机制 ============ */
  // 用冒泡阶段监听，避免捕获阶段提前触发导致用户激活丢失
  // 跳过 music-play 按钮和抽屉内的点击，让按钮自己的 handler 处理 play/pause
  function onDocClick(e) {
    if (!pendingResume) return;
    const t = e.target;
    if (t && t.id === 'music-play') return; // 让按钮自己处理
    if (t && t.closest && t.closest('#music-drawer')) return; // 抽屉内点击不触发恢复
    pendingResume = false;
    play();
  }
  document.addEventListener('click', onDocClick);

  function setMode(m) {
    mode = m;
    drawer.classList.remove('is-collapsed', 'is-peek', 'is-expanded');
    drawer.classList.add('is-' + m);
  }

  /* ============ absSrc：始终用相对路径，避免 base 配置和环境判断的坑 ============ */
  // 之前用 base 拼接 + isLocal 判断，结果在 GitHub Pages 上 base 没正确加载
  // 导致 src='/Personal-website/assets/...' 没拼上，变成 '/assets/...' → 404
  // 现在始终用相对路径，让浏览器基于当前页面 URL 解析：
  // - 本地: http://localhost:8765/music.html + assets/music/x.mp3 → http://localhost:8765/assets/music/x.mp3 ✓
  // - GitHub 项目 Pages: https://sunrise150.github.io/Personal-website/music.html + assets/music/x.mp3 → https://sunrise150.github.io/Personal-website/assets/music/x.mp3 ✓
  // 前提：所有 HTML 页面都在仓库根目录（没有子目录），符合本站结构
  function absSrc(src) {
    if (!src) return '';
    if (/^https?:\/\//.test(src)) return src; // 完整 URL，直接用
    // 用相对路径，让浏览器基于当前页面 URL 解析
    // encodeURI 编码中文文件名
    return encodeURI(src);
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

  let MUSIC_QUERY = '';

  function filterMusic(q) {
    MUSIC_QUERY = q.trim().toLowerCase();
    if (!MUSIC_QUERY) return MUSIC;
    return MUSIC.map((m, i) => ({ m, i })).filter(({ m }) => {
      const name = (m.name || '').toLowerCase();
      const artist = (m.artist || '').toLowerCase();
      return name.includes(MUSIC_QUERY) || artist.includes(MUSIC_QUERY);
    });
  }

  function renderList() {
    const list = $('music-list');
    if (!MUSIC.length) {
      list.innerHTML = '<div class="music-list-empty">还没有音乐，去「音乐」页面上传</div>';
      return;
    }
    const filtered = filterMusic($('music-search-input') ? $('music-search-input').value : '');
    if (!filtered.length) {
      list.innerHTML = '<div class="music-list-empty">没有匹配的音乐</div>';
      return;
    }
    list.innerHTML = filtered.map(({ m, i }) => `
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

  function initMusicSearch() {
    const input = $('music-search-input');
    const clear = $('music-search-clear');
    if (!input || !clear) return;
    let timer = null;
    input.addEventListener('input', (e) => {
      const v = e.target.value;
      clear.style.display = v ? '' : 'none';
      clearTimeout(timer);
      timer = setTimeout(() => renderList(), 200);
    });
    clear.addEventListener('click', () => {
      input.value = '';
      clear.style.display = 'none';
      renderList();
      input.focus();
    });
  }

  function load(index, autoplay, doPeek) {
    if (!MUSIC.length) return;
    current = (index + MUSIC.length) % MUSIC.length;
    const a = ensureAudio();
    a.src = absSrc(currentItem().src);
    _endedTriggered = false; // 切歌时重置
    updateName();
    renderList();
    if (autoplay) {
      // 修复：等 canplay 事件再 play，避免 src 刚切换时 AbortError
      // 加 timeout 兜底：canplay 可能因缓存已存在而不触发
      let played = false;
      const onReady = () => {
        if (played) return;
        played = true;
        a.removeEventListener('canplay', onReady);
        play();
      };
      a.addEventListener('canplay', onReady, { once: true });
      a.load(); // 强制重新加载新 src
      // 兜底：1.5 秒后若 canplay 未触发，强制尝试 play
      setTimeout(() => {
        if (!played) {
          played = true;
          a.removeEventListener('canplay', onReady);
          play();
        }
      }, 1500);
    }
    if (doPeek) peek();
    save();
  }

  /* ============ 修复问题1：play() 正确处理 Promise，重试 AbortError ============ */
  function play() {
    if (!MUSIC.length) {
      setMode('expanded');
      return;
    }
    const a = ensureAudio();
    if (!a.src) a.src = absSrc(currentItem().src);

    // 重试机制：src 刚切换时 play() 可能被 AbortError 拒绝
    // 等一小段时间后重试，最多 8 次
    let retries = 0;
    function tryPlay() {
      const p = a.play();
      if (p && p.then) {
        p.then(() => {
          playing = true;
          pendingResume = false;
          $('music-play').textContent = '❚❚';
          updateName();
        }).catch((err) => {
          const errName = (err && err.name) || '';
          console.warn('[player] play() rejected:', errName,
            '| readyState:', a.readyState,
            '| networkState:', a.networkState,
            '| retries:', retries);
          // 自动切歌时 src 刚切换，AbortError 是正常的，重试
          if (errName === 'AbortError' && retries < 8) {
            retries++;
            setTimeout(tryPlay, 250);
            return;
          }
          if (errName === 'NotAllowedError' || errName === 'AbortError') {
            pendingResume = true;
            playing = false;
            $('music-play').textContent = '▶';
            const sub = $('music-sub');
            if (sub) sub.textContent = '点击页面任意位置恢复播放';
          } else {
            pendingResume = false;
            playing = false;
            $('music-play').textContent = '▶';
            const sub = $('music-sub');
            const msg = (err && err.message) || errName || '未知错误';
            if (sub) sub.textContent = '无法播放：' + msg;
          }
        });
      } else {
        playing = true;
        $('music-play').textContent = '❚❚';
        updateName();
      }
    }

    tryPlay();
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
        playMode,
        ts: Date.now()
      }));
    } catch (e) {}
  }

  /* ============ 修复问题2：跨页恢复 - 立即设置 src + currentTime ============ */
  function restore() {
    try {
      const s = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!s || !MUSIC.length) return;
      // 恢复播放模式
      if (s.playMode && ['order', 'random', 'one'].includes(s.playMode)) {
        playMode = s.playMode;
        updateModeBtn();
      }
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

  /* ============ 播放模式切换 ============ */
  function updateModeBtn() {
    const btn = $('music-mode');
    if (!btn) return;
    if (playMode === 'order') {
      btn.textContent = '↻';
      btn.title = '顺序循环';
      btn.classList.remove('is-random', 'is-one');
    } else if (playMode === 'random') {
      btn.textContent = '⇄';
      btn.title = '随机播放';
      btn.classList.add('is-random');
      btn.classList.remove('is-one');
    } else if (playMode === 'one') {
      btn.textContent = '↺';
      btn.title = '单曲循环';
      btn.classList.add('is-one');
      btn.classList.remove('is-random');
    }
  }

  function togglePlayMode() {
    if (playMode === 'order') playMode = 'random';
    else if (playMode === 'random') playMode = 'one';
    else playMode = 'order';
    updateModeBtn();
    save();
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
  $('music-mode').addEventListener('click', togglePlayMode);

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
    if (e.target && e.target.closest && e.target.closest('#music-drawer')) return;
    setMode('collapsed');
  });

  // 暴露全局函数，供 shell 在 iframe 内点击时调用（跨 iframe 边界）
  window.__blogPlayer = { collapse: () => setMode('collapsed') };

  /* ============ 修复问题2：可靠的状态保存事件 ============ */
  // pagehide 比 beforeunload 更可靠（移动端、bfcache 等场景）
  window.addEventListener('pagehide', save);
  window.addEventListener('beforeunload', save);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') save();
  });

  /* 初始化：先同步显示缓存，再异步 fetch 更新，避免卡在"加载中" */
  // 同步阶段：立即渲染缓存数据，不等待 fetch
  try {
    const cached = sessionStorage.getItem(MUSIC_CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed && Array.isArray(parsed.data)) {
        MUSIC = parsed.data;
      }
    }
  } catch (e) {}
  renderList();
  updateName();
  initMusicSearch();

  // 异步阶段：fetch 最新数据，更新列表
  (async function initAsync() {
    try {
      const res = await fetch('data/music.json?t=' + Date.now());
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          MUSIC = data;
          sessionStorage.setItem(MUSIC_CACHE_KEY, JSON.stringify({ data, ts: Date.now() }));
          renderList();
          updateName();
        }
      }
    } catch (e) {
      console.warn('[player] 加载 music.json 失败:', e);
    }
    if (MUSIC.length) {
      restore();
    }
  })();
})();
