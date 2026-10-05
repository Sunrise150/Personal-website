const STORAGE_KEY = 'blog_gh_settings';
const POSTS_JSON = 'data/posts.json';
const POSTS_DIR = 'posts';

/* ============ 性能优化：索引缓存 ============ */
let postsCache = null; // { list, sha, ts }
const CACHE_TTL = 30000; // 30s 内复用，删除/编辑时不重复拉取

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

function setStatus(msg, type = '') {
  const el = document.getElementById('status');
  if (!el) return;
  el.textContent = msg;
  el.className = 'status ' + type;
}

function encodeBase64(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

function decodeBase64(str) {
  return decodeURIComponent(escape(atob(str)));
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

/* ============ 性能优化：带缓存的 loadPosts ============ */
async function loadPosts(force = false) {
  if (postsCache && !force && Date.now() - postsCache.ts < CACHE_TTL) {
    return postsCache;
  }
  const meta = await ghGet(POSTS_JSON);
  if (!meta) { postsCache = { list: [], sha: null, ts: Date.now() }; return postsCache; }
  let list = [];
  try { list = JSON.parse(meta.content); } catch (e) { list = []; }
  if (!Array.isArray(list)) list = [];
  postsCache = { list, sha: meta.sha, ts: Date.now() };
  return postsCache;
}

async function savePosts(list, sha, message) {
  const content = encodeBase64(JSON.stringify(list, null, 2));
  const result = await ghPut(POSTS_JSON, content, message, sha);
  postsCache = null; // 写入后失效缓存
  return result;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));
}

function formatDate(str) {
  const d = new Date(str);
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
}

/* ============ 性能优化：DocumentFragment 渲染 ============ */
function renderList(list) {
  const wrap = document.getElementById('manage-list');
  if (!wrap) return;
  if (!list.length) {
    wrap.innerHTML = '<p class="empty">还没有文章</p>';
    return;
  }
  // 按日期倒序
  const sorted = list.slice().sort((a, b) => new Date(b.date) - new Date(a.date));
  const frag = document.createDocumentFragment();
  sorted.forEach((p) => {
    const item = document.createElement('div');
    item.className = 'manage-item';
    item.dataset.slug = p.slug;
    item.innerHTML = `
      <div class="manage-info">
        <div class="manage-title">${escapeHtml(p.title || '(无标题)')}</div>
        <div class="manage-meta">${escapeHtml(formatDate(p.date))} · ${(p.tags || []).map(escapeHtml).join(', ') || '无标签'} · ${escapeHtml(p.slug)}</div>
      </div>
      <div class="manage-actions">
        <a class="mini-btn" href="post.html?slug=${encodeURIComponent(p.slug)}" target="_blank">查看</a>
        <button class="mini-btn danger" data-act="del" data-slug="${escapeHtml(p.slug)}">删除</button>
      </div>
    `;
    frag.appendChild(item);
  });
  wrap.replaceChildren(frag);
}

async function render() {
  const wrap = document.getElementById('manage-list');
  if (!wrap) return;
  wrap.innerHTML = '<div class="loading">加载中…</div>';
  try {
    const { list } = await loadPosts();
    renderList(list);
  } catch (e) {
    if (!getSettings()) {
      wrap.innerHTML = '<p class="empty">请先在「写文章」页面配置 GitHub 信息</p>';
    } else {
      wrap.innerHTML = `<p class="empty">加载失败：${e.message}</p>`;
    }
  }
}

/* ============ 性能优化：事件委托（单一监听器） ============ */
document.getElementById('manage-list').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-act="del"]');
  if (!btn) return;
  onDelete(btn.dataset.slug);
});

async function onDelete(slug) {
  if (!confirm(`确定删除文章「${slug}」吗？此操作不可恢复。`)) return;
  try {
    const { list, sha } = await loadPosts();
    const item = list.find(p => p.slug === slug);
    if (!item) throw new Error('文章不在索引中');

    setStatus('正在删除文章文件…');
    try {
      const fileMeta = await ghGet(`${POSTS_DIR}/${slug}.md`);
      if (fileMeta) {
        await ghDelete(`${POSTS_DIR}/${slug}.md`, `删除文章：${item.title}`, fileMeta.sha);
      }
    } catch (e) {
      // 文件可能已删除，继续更新索引
    }

    setStatus('正在更新索引…');
    const newList = list.filter(p => p.slug !== slug);
    await savePosts(newList, sha, `移除文章：${item.title}`);
    setStatus('✓ 已删除，约 1 分钟后全站生效', 'ok');
    render();
  } catch (e) {
    setStatus('删除失败：' + e.message, 'error');
  }
}

applyConfig();
render();
