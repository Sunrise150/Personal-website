const STORAGE_KEY = 'blog_gh_settings';
const MUSIC_JSON = 'data/music.json';
const MUSIC_DIR = 'assets/music';
const MUSIC_MAX_MB = 25;
const BRANCH_KEY = 'blog_gh_branch';

/* ============ 性能优化：列表缓存 ============ */
let musicCache = null;
const CACHE_TTL = 30000;

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

function getBranch() {
  try { return localStorage.getItem(BRANCH_KEY) || 'main'; } catch { return 'main'; }
}

let _statusTimer = null;
function setStatus(msg, type = '') {
  const el = document.getElementById('m-status');
  if (!el) return;
  el.textContent = msg;
  el.className = 'status ' + type;
  el.style.opacity = '1';
  el.style.transition = '';
  clearTimeout(_statusTimer);
  _statusTimer = setTimeout(() => {
    el.style.transition = 'opacity 2s ease';
    el.style.opacity = '0';
  }, 12000);
}

/* ============ 进度条 ============ */
function showProgress(percent, label) {
  const bar = document.getElementById('m-progress-bar');
  const fill = document.getElementById('m-progress-fill');
  const txt = document.getElementById('m-progress-text');
  if (!bar) return;
  bar.style.display = '';
  fill.style.width = percent + '%';
  txt.textContent = label ? `${label} ${percent}%` : percent + '%';
}
function hideProgress() {
  const bar = document.getElementById('m-progress-bar');
  if (bar) bar.style.display = 'none';
}

/* ============ 编码工具 ============ */
function encodeBase64(str) {
  return btoa(unescape(encodeURIComponent(str)));
}
function decodeBase64(str) {
  return decodeURIComponent(escape(atob(str)));
}
function blobToBase64(blob, onProgress) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const total = blob.size;
    reader.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round(e.loaded / total * 100));
    };
    reader.onload = () => {
      const s = reader.result;
      resolve(s.slice(s.indexOf(',') + 1));
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
// URL encode 路径中每个 segment
function encodePath(path) {
  return path.split('/').map(s => encodeURIComponent(s)).join('/');
}

function requireSettings() {
  const s = getSettings();
  if (!s) throw new Error('请先在「写文章」页面配置 GitHub 信息（Owner / Repo / Token）');
  return s;
}

/* ============ 错误分类 ============ */
function classifyError(status, msg) {
  if (status === 401) return 'GitHub Token 已失效或填错了。请去「写文章」页重新配置。';
  if (status === 403) return '没有仓库写入权限。Token 需要有 repo scope。检查「写文章」页的配置。';
  if (status === 404) return '路径不存在或仓库名写错。检查 Owner / Repo 配置。';
  if (status === 413 || status === 422) return '文件太大或内容格式错误（GitHub 单文件 100MB 上限，浏览器 Base64 约 75MB 就撑不住）。建议压缩后再传。';
  if (status === 409) return '冲突：文件已被别人改过。刷新列表后重试。';
  if (status === 0) return '网络请求失败（可能是 CORS 被拦截或断网）。确认你已登录 GitHub 且 Token 有效。';
  return `HTTP ${status}：${msg || '未知错误'}`;
}

/* ============ GitHub API 封装 ============ */
function ghHeaders(extra = {}) {
  const s = requireSettings();
  return {
    'Authorization': `token ${s.token}`,
    'Accept': 'application/vnd.github.v3+json',
    ...extra
  };
}

function ghRawUrl(path) {
  const s = requireSettings();
  return `https://api.github.com/repos/${s.owner}/${s.repo}/contents/${encodePath(path)}`;
}

async function ghGet(path) {
  const res = await fetch(ghRawUrl(path) + '?t=' + Date.now(), { headers: ghHeaders() });
  if (res.status === 404) return null;
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(classifyError(res.status, err.message));
  }
  const data = await res.json();
  return {
    sha: data.sha,
    content: data.content ? decodeBase64(data.content.replace(/\n/g, '')) : ''
  };
}

/* ============ 上传带进度（XMLHttpRequest） ============ */
function ghPutWithProgress(path, contentBase64, message, sha, onProgress) {
  return new Promise((resolve, reject) => {
    const s = requireSettings();
    const url = `https://api.github.com/repos/${s.owner}/${s.repo}/contents/${encodePath(path)}`;
    const body = { message, content: contentBase64 };
    if (sha) body.sha = sha;

    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url, true);
    xhr.setRequestHeader('Authorization', `token ${s.token}`);
    xhr.setRequestHeader('Accept', 'application/vnd.github.v3+json');
    xhr.setRequestHeader('Content-Type', 'application/json');

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round(e.loaded / e.total * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText));
      } else {
        let errMsg = '';
        try { errMsg = JSON.parse(xhr.responseText).message; } catch {}
        reject(new Error(classifyError(xhr.status, errMsg)));
      }
    };
    xhr.onerror = () => reject(new Error(classifyError(0)));
    xhr.send(JSON.stringify(body));
  });
}

/* ============ Git Data API（大文件 fallback） ============ */
async function ghPutBigFile(path, contentBase64, message, onProgress) {
  const s = requireSettings();
  const branch = getBranch();
  const api = `https://api.github.com/repos/${s.owner}/${s.repo}`;
  const h = ghHeaders();

  // Step 1: POST blob → sha
  showProgress(10, 'Git Data: 上传 blob');
  const blobRes = await fetch(`${api}/git/blobs`, {
    method: 'POST', headers: h,
    body: JSON.stringify({ content: contentBase64, encoding: 'base64' })
  });
  if (!blobRes.ok) {
    const e = await blobRes.json().catch(() => ({}));
    throw new Error(classifyError(blobRes.status, e.message));
  }
  const { sha: blobSha } = await blobRes.json();

  // Step 2: GET branch 最新 commit
  showProgress(30, 'Git Data: 查 commit');
  const refRes = await fetch(`${api}/git/ref/heads/${encodeURIComponent(branch)}`, { headers: h });
  if (!refRes.ok) throw new Error(classifyError(refRes.status));
  const commitSha = (await refRes.json()).object.sha;

  // Step 3: GET commit tree (recursive)
  showProgress(50, 'Git Data: 查 tree');
  const commitRes = await fetch(`${api}/git/commits/${commitSha}`, { headers: h });
  if (!commitRes.ok) throw new Error(classifyError(commitRes.status));
  const { tree: { sha: treeSha } } = await commitRes.json();

  const treeRes = await fetch(`${api}/git/trees/${treeSha}?recursive=1`, { headers: h });
  if (!treeRes.ok) throw new Error(classifyError(treeRes.status));
  const { tree: oldTree } = await treeRes.json();

  // Step 4: 构建新 tree（移除旧同名文件，加 blob）
  showProgress(60, 'Git Data: 构建 tree');
  const newTree = oldTree
    .filter(item => item.type === 'blob' && item.path !== path)
    .concat([{ path, mode: '100644', type: 'blob', sha: blobSha }]);

  const newTreeRes = await fetch(`${api}/git/trees`, {
    method: 'POST', headers: h,
    body: JSON.stringify({ tree: newTree, base_tree: treeSha })
  });
  if (!newTreeRes.ok) {
    const e = await newTreeRes.json().catch(() => ({}));
    throw new Error(classifyError(newTreeRes.status, e.message));
  }
  const newTreeSha = (await newTreeRes.json()).sha;

  // Step 5: 创建新 commit
  showProgress(80, 'Git Data: 创建 commit');
  const newCommitRes = await fetch(`${api}/git/commits`, {
    method: 'POST', headers: h,
    body: JSON.stringify({ message, tree: newTreeSha, parents: [commitSha] })
  });
  if (!newCommitRes.ok) {
    const e = await newCommitRes.json().catch(() => ({}));
    throw new Error(classifyError(newCommitRes.status, e.message));
  }
  const newCommitSha = (await newCommitRes.json()).sha;

  // Step 6: 更新 branch ref
  showProgress(95, 'Git Data: 更新分支');
  const patchRes = await fetch(`${api}/git/refs/heads/${encodeURIComponent(branch)}`, {
    method: 'PATCH', headers: h,
    body: JSON.stringify({ sha: newCommitSha })
  });
  if (!patchRes.ok) {
    const e = await patchRes.json().catch(() => ({}));
    throw new Error(classifyError(patchRes.status, e.message));
  }
  showProgress(100, '完成');
}

async function ghDelete(path, message, sha) {
  const s = requireSettings();
  const url = `https://api.github.com/repos/${s.owner}/${s.repo}/contents/${encodePath(path)}`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { ...ghHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, sha })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(classifyError(res.status, err.message));
  }
}

/* ============ 列表管理 ============ */
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
  try {
    window.dispatchEvent(new CustomEvent('blog:music-list', { detail: list }));
  } catch (e) {}
  return musicCache;
}

async function saveMusicList(list, sha, message) {
  const content = encodeBase64(JSON.stringify(list, null, 2));
  const result = await ghPutWithProgress(MUSIC_JSON, content, message, sha, null);
  musicCache = null;
  return result;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));
}

/* ============ 渲染 ============ */
let ALL_MUSIC = [];
function renderList(list) {
  const wrap = document.getElementById('music-admin-list');
  if (!wrap) return;
  if (!list.length) {
    wrap.innerHTML = '<p class="empty">还没有音乐，去上面上传一首吧</p>';
    return;
  }
  const frag = document.createDocumentFragment();
  list.forEach((m) => {
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

/* ============ 按钮事件 ============ */
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
    if (previewAudio) { previewAudio.pause(); previewAudio.src = ''; }
    const base = SITE_CONFIG.base || '/';
    const src = /^https?:|^\//.test(item.src) ? item.src : base + item.src;
    previewAudio = new Audio(src);
    previewAudio.play().catch(e => alert('无法播放：' + e.message));
  } catch (e) { alert(e.message); }
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
      // 文件可能已不存在
      console.warn('[music] delete file warn:', e.message);
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

/* ============ 上传主流程 ============ */
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
    setStatus(`文件超过 ${MUSIC_MAX_MB}MB 上限`, 'error');
    return;
  }

  // 检查配置
  try { requireSettings(); } catch (err) {
    setStatus(err.message, 'error');
    return;
  }

  const btn = document.getElementById('m-submit');
  btn.disabled = true;
  hideProgress();

  try {
    const ext = (selectedFile.name.match(/\.(\w+)$/) || [null, 'mp3'])[1].toLowerCase();
    const safeName = (name || selectedFile.name)
      .replace(/[^\w\-\u4e00-\u9fa5]+/g, '_')
      .slice(0, 40);
    const filename = `music-${Date.now().toString(36)}-${safeName}.${ext}`;
    const path = `${MUSIC_DIR}/${filename}`;

    // Step 1: 转 base64（显示进度）
    setStatus('正在读取文件…');
    const content = await blobToBase64(selectedFile, p => showProgress(p, '读取文件'));

    // Step 2: 上传（Contents API 优先，大文件自动 fallback Git Data）
    const sizeMB = selectedFile.size / 1024 / 1024;
    const useGitApi = sizeMB > 3; // >3MB 直接走 Git Data API 更稳

    if (useGitApi) {
      setStatus('文件较大，使用 Git Data API 上传…');
      await ghPutBigFile(path, content, `上传音乐：${name || selectedFile.name}`, p => showProgress(p, '上传'));
    } else {
      setStatus('正在上传文件…');
      try {
        await ghPutWithProgress(path, content, `上传音乐：${name || selectedFile.name}`, null, p => showProgress(p, '上传'));
      } catch (uploadErr) {
        // Contents API 失败 → fallback Git Data API
        console.warn('[music] Contents API failed, fallback Git Data:', uploadErr.message);
        setStatus('Contents API 失败，尝试 Git Data API…');
        await ghPutBigFile(path, content, `上传音乐：${name || selectedFile.name}`, p => showProgress(p, 'Git Data'));
      }
    }

    setStatus('文件已上传，正在更新列表…');

    // Step 3: 更新 music.json
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
    console.error('[music upload]', err);
  } finally {
    btn.disabled = false;
    setTimeout(hideProgress, 2000);
  }
});

applyConfig();
initSearch();
render();

/* ============ Branch 保存 ============ */
const branchInput = document.getElementById('m-branch');
const branchSave = document.getElementById('m-branch-save');
if (branchInput) {
  branchInput.value = getBranch();
  if (branchSave) {
    branchSave.addEventListener('click', () => {
      const v = branchInput.value.trim() || 'main';
      localStorage.setItem(BRANCH_KEY, v);
      setStatus('✓ 分支名已保存：' + v, 'ok');
    });
  }
  branchInput.addEventListener('change', () => {
    const v = branchInput.value.trim() || 'main';
    localStorage.setItem(BRANCH_KEY, v);
  });
}

const musicRefreshBtn = document.getElementById('music-refresh');
if (musicRefreshBtn) {
  musicRefreshBtn.addEventListener('click', () => {
    musicRefreshBtn.classList.add('spinning');
    render(true).finally(() => {
      setTimeout(() => musicRefreshBtn.classList.remove('spinning'), 600);
    });
  });
}
