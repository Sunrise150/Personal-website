const STORAGE_KEY = 'blog_gh_settings';
const MUSIC_JSON = 'data/music.json';
const MUSIC_DIR = 'assets/music';
const MUSIC_MAX_MB = 25;

/* ============ 性能优化：列表缓存 ============ */
let musicCache = null; // { list, sha, ts }
const CACHE_TTL = 30000; // 30s 内复用列表，避免编辑/删除/试听时重复请求

function applyConfig() {
  const t = document.getElementById('site-title');
  const f = document.getElementById('footer-text');
  if (t) t.textContent = SITE_CONFIG.title;
  if (f) f.textContent = SITE_CONFIG.footer;
}

function getSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

let _statusTimer = null;
function setStatus(msg, type = '') {
  const el = document.getElementById('m-status');
  if (!el) return;
  el.textContent = msg;
  el.className = 'status ' + type;
  // 重置可见状态
  el.style.opacity = '1';
  el.style.transition = '';
  // 10 秒后缓慢淡出
  clearTimeout(_statusTimer);
  _statusTimer = setTimeout(() => {
    el.style.transition = 'opacity 2s ease';
    el.style.opacity = '0';
  }, 10000);
}

function encodeBase64(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

function decodeBase64(str) {
  return decodeURIComponent(escape(atob(str)));
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const s = reader.result;
      resolve(s.slice(s.indexOf(',') + 1));
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function requireSettings() {
  const s = getSettings();
  if (!s) throw new Error('请先在「写文章」页面配置 GitHub 信息');
  return s;
}

function ghUrl(path) {
  const s = requireSettings();
  return `https://api.github.com/repos/${s.owner}/${s.repo}/contents/${path}`;
}

function ghHeaders() {
  const s = requireSettings();
  return {
    'Authorization': `token ${s.token}`,
    'Accept': 'application/vnd.github.v3+json'
  };
}

async function ghGet(path) {
  const res = await fetch(ghUrl(path) + '?t=' + Date.now(), { headers: ghHeaders() });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`读取 ${path} 失败 (${res.status})`);
  const data = await res.json();
  return {
    sha: data.sha,
    content: data.content ? decodeBase64(data.content.replace(/\n/g, '')) : ''
  };
}

async function ghPut(path, contentBase64, message, sha) {
  const body = { message, content: contentBase64 };
  if (sha) body.sha = sha;
  const res = await fetch(ghUrl(path), {
    method: 'PUT',
    headers: { ...ghHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `HTTP ${res.status}`);
  }
  return res.json();
}

async function ghDelete(path, message, sha) {
  const res = await fetch(ghUrl(path), {
    method: 'DELETE',
    headers: { ...ghHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, sha })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `HTTP ${res.status}`);
  }
}

/* ============ 性能优化：带缓存的 loadMusicList ============ */
async function loadMusicList(force = false) {
  if (musicCache && !force && Date.now() - musicCache.ts < CACHE_TTL) {
    return musicCache;
  }
  const meta = await ghGet(MUSIC_JSON);
  if (!meta) { musicCache = { list: [], sha: null, ts: Date.now() }; return musicCache; }
  let list = [];
  try { list = JSON.parse(meta.content); } catch (e) { list = []; }
  if (!Array.isArray(list)) list = [];
  musicCache = { list, sha: meta.sha, ts: Date.now() };
  // 派发事件让音乐抽屉（player.js）共享最新列表，避免抽屉读到本地陈旧 data/music.json
  try {
    window.dispatchEvent(new CustomEvent('blog:music-list', { detail: list }));
  } catch (e) {}
  return musicCache;
}

async function saveMusicList(list, sha, message) {
  const content = encodeBase64(JSON.stringify(list, null, 2));
  const result = await ghPut(MUSIC_JSON, content, message, sha);
  // 写入后失效缓存，下次读取会拿到新 sha
  musicCache = null;
  return result;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));
}

/* ============ 性能优化：DocumentFragment + 事件委托 ============ */
let ALL_MUSIC = []; // 完整列表（供搜索过滤后还原索引）
function renderList(list) {
  const wrap = document.getElementById('music-admin-list');
  if (!wrap) return;
  if (!list.length) {
    wrap.innerHTML = '<p class="empty">还没有音乐，去上面上传一首吧</p>';
    return;
  }
  const frag = document.createDocumentFragment();
  list.forEach((m) => {
    // 用在 ALL_MUSIC 中的原索引作为 data-i，确保编辑/删除能找到正确条目
    const realIdx = ALL_MUSIC.indexOf(m);
    const item = document.createElement('div');
    item.className = 'music-admin-item';
    item.dataset.i = String(realIdx);
    item.innerHTML = `
      <div class="music-admin-info">
        <div class="music-admin-name">${escapeHtml(m.name || '未知曲目')}</div>
        <div class="music-admin-meta">${escapeHtml(m.artist || '未填写艺术家')} · ${escapeHtml(m.src || '')}</div>
      </div>
      <div class="music-admin-actions">
        <button class="mini-btn" data-act="edit" data-i="${realIdx}">编辑</button>
        <button class="mini-btn" data-act="play" data-i="${realIdx}">试听</button>
        <button class="mini-btn danger" data-act="del" data-i="${realIdx}">删除</button>
      </div>
    `;
    frag.appendChild(item);
  });
  wrap.replaceChildren(frag);
}

/* ============ 搜索过滤 ============ */
function applyFilter() {
  const q = (document.getElementById('music-search')?.value || '').trim().toLowerCase();
  let filtered = ALL_MUSIC;
  if (q) {
    filtered = ALL_MUSIC.filter(m => {
      const name = (m.name || '').toLowerCase();
      const artist = (m.artist || '').toLowerCase();
      return name.includes(q) || artist.includes(q);
    });
  }
  renderList(filtered);
  const cnt = document.getElementById('music-count');
  if (cnt) {
    const total = ALL_MUSIC.length;
    const shown = filtered.length;
    cnt.textContent = q ? `${shown} / ${total} 首` : `${total} 首`;
  }
}

function initSearch() {
  const input = document.getElementById('music-search');
  if (!input) return;
  let timer = null;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(applyFilter, 150);
  });
}

async function render(force = false) {
  const wrap = document.getElementById('music-admin-list');
  if (!wrap) return;
  try {
    const { list } = await loadMusicList(force);
    ALL_MUSIC = list;
    applyFilter();
  } catch (e) {
    wrap.innerHTML = `<p class="empty">加载失败：${e.message}</p>`;
  }
}

/* ============ 事件委托：单一监听器处理所有按钮 ============ */
document.getElementById('music-admin-list').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;
  const i = Number(btn.dataset.i);
  if (act === 'edit') onEdit(i);
  else if (act === 'del') onDelete(i);
  else if (act === 'play') onPlay(i);
});

let previewAudio = null;
async function onPlay(i) {
  try {
    const { list } = await loadMusicList();
    const item = list[i];
    if (!item) return;
    if (previewAudio) {
      previewAudio.pause();
      previewAudio.src = '';
    }
    const base = SITE_CONFIG.base || '/';
    const src = /^https?:|^\//.test(item.src) ? item.src : base + item.src;
    previewAudio = new Audio(src);
    previewAudio.play().catch(e => alert('无法播放：' + e.message));
  } catch (e) {
    alert(e.message);
  }
}

async function onEdit(i) {
  try {
    const { list, sha } = await loadMusicList();
    const item = list[i];
    if (!item) return;
    const newName = prompt('新歌名', item.name || '');
    if (newName === null) return;
    const newArtist = prompt('艺术家（可留空）', item.artist || '');
    if (newArtist === null) return;
    item.name = newName.trim() || item.name;
    item.artist = newArtist.trim();
    setStatus('正在保存…');
    await saveMusicList(list, sha, `更新音乐信息：${item.name}`);
    setStatus('✓ 已更新，约 1 分钟后全站生效', 'ok');
    render();
  } catch (e) {
    setStatus('更新失败：' + e.message, 'error');
  }
}

async function onDelete(i) {
  if (!confirm('确定要删除这首音乐吗？文件也会一并删除。')) return;
  try {
    const { list, sha } = await loadMusicList();
    const item = list[i];
    if (!item) return;

    setStatus('正在删除文件…');
    try {
      const fileMeta = await ghGet(item.src);
      if (fileMeta) {
        await ghDelete(item.src, `删除音乐文件：${item.name}`, fileMeta.sha);
      }
    } catch (e) {
      // 文件可能已删除，忽略
    }

    setStatus('正在更新列表…');
    list.splice(i, 1);
    await saveMusicList(list, sha, `移除音乐：${item.name}`);
    setStatus('✓ 已删除，约 1 分钟后全站生效', 'ok');
    render();
  } catch (e) {
    setStatus('删除失败：' + e.message, 'error');
  }
}

/* ============ 上传 ============ */
let selectedFile = null;

document.getElementById('m-file-pick').addEventListener('click', () => {
  document.getElementById('m-file').click();
});

document.getElementById('m-file').addEventListener('change', (e) => {
  const f = e.target.files[0];
  selectedFile = f || null;
  const el = document.getElementById('m-file-name');
  if (f) {
    el.textContent = `已选择：${f.name}（${(f.size / 1024 / 1024).toFixed(2)} MB）`;
    const nameInput = document.getElementById('m-name');
    if (!nameInput.value) {
      nameInput.value = f.name.replace(/\.[^.]+$/, '');
    }
  } else {
    el.textContent = '支持 mp3 / m4a / ogg / wav / flac / aac，单个不超过 25MB';
  }
});

document.getElementById('music-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('m-name').value.trim();
  const artist = document.getElementById('m-artist').value.trim();

  if (!selectedFile) {
    setStatus('请先选择音乐文件', 'error');
    return;
  }
  if (selectedFile.size > MUSIC_MAX_MB * 1024 * 1024) {
    setStatus(`文件超过 ${MUSIC_MAX_MB}MB`, 'error');
    return;
  }

  const btn = document.getElementById('m-submit');
  btn.disabled = true;
  setStatus('正在上传文件…');

  try {
    const ext = (selectedFile.name.match(/\.(\w+)$/) || [null, 'mp3'])[1].toLowerCase();
    const safeName = (name || selectedFile.name)
      .replace(/[^\w\-\u4e00-\u9fa5]+/g, '_')
      .slice(0, 40);
    const filename = `music-${Date.now().toString(36)}-${safeName}.${ext}`;
    const path = `${MUSIC_DIR}/${filename}`;
    const content = await blobToBase64(selectedFile);

    await ghPut(path, content, `上传音乐：${name || selectedFile.name}`);
    setStatus('文件已上传，正在更新列表…');

    const { list, sha } = await loadMusicList(true);
    list.push({
      name: name || selectedFile.name.replace(/\.[^.]+$/, ''),
      artist: artist || '',
      src: path,
      uploadedAt: Date.now()
    });
    await saveMusicList(list, sha, `添加音乐：${name || selectedFile.name}`);

    setStatus('✓ 上传成功，约 1 分钟后全站生效', 'ok');
    selectedFile = null;
    document.getElementById('m-file').value = '';
    document.getElementById('m-file-name').textContent =
      '支持 mp3 / m4a / ogg / wav / flac / aac，单个不超过 25MB';
    document.getElementById('m-name').value = '';
    document.getElementById('m-artist').value = '';
    render();
  } catch (err) {
    setStatus('上传失败：' + err.message, 'error');
  } finally {
    btn.disabled = false;
  }
});

applyConfig();
initSearch();
render();

// 刷新按钮：强制重新拉取列表
const musicRefreshBtn = document.getElementById('music-refresh');
if (musicRefreshBtn) {
  musicRefreshBtn.addEventListener('click', () => {
    musicRefreshBtn.classList.add('spinning');
    render(true).finally(() => {
      setTimeout(() => musicRefreshBtn.classList.remove('spinning'), 600);
    });
  });
}
