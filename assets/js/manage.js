const STORAGE_KEY = 'blog_gh_settings';

function applyConfig() {
  document.getElementById('site-title').textContent = SITE_CONFIG.title;
  document.getElementById('footer-text').textContent = SITE_CONFIG.footer;
}

function getSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function setStatus(msg, type = '') {
  const el = document.getElementById('status');
  el.textContent = msg;
  el.className = 'status ' + type;
}

function formatDate(str) {
  const d = new Date(str);
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
}

async function loadList() {
  const wrap = document.getElementById('manage-list');
  try {
    const res = await fetch('data/posts.json?t=' + Date.now());
    if (!res.ok) throw new Error('无法加载文章列表');
    const posts = await res.json();
    posts.sort((a, b) => new Date(b.date) - new Date(a.date));

    if (posts.length === 0) {
      wrap.innerHTML = '<p class="empty">还没有文章</p>';
      return;
    }

    wrap.innerHTML = posts.map(p => `
      <div class="manage-item" data-slug="${p.slug}">
        <div class="manage-info">
          <div class="manage-title">${p.title}</div>
          <div class="manage-meta">${formatDate(p.date)} · slug: ${p.slug}</div>
        </div>
        <div class="manage-actions">
          <a class="mini-btn" href="post.html?slug=${encodeURIComponent(p.slug)}" target="_blank">查看</a>
          <button class="mini-btn danger" data-slug="${p.slug}">删除</button>
        </div>
      </div>
    `).join('');

    wrap.querySelectorAll('button.danger').forEach(btn => {
      btn.addEventListener('click', () => onDelete(btn.dataset.slug));
    });
  } catch (e) {
    wrap.innerHTML = `<p class="empty">加载失败：${e.message}</p>`;
  }
}

async function onDelete(slug) {
  if (!confirm(`确定要删除「${slug}」吗？此操作不可恢复。`)) return;
  const settings = getSettings();
  if (!settings) {
    setStatus('请先在写文章页配置 GitHub 信息', 'error');
    return;
  }

  setStatus('正在删除…');
  try {
    const path = `posts/${slug}.md`;
    const url = `https://api.github.com/repos/${settings.owner}/${settings.repo}/contents/${path}`;
    const headers = {
      'Authorization': `token ${settings.token}`,
      'Accept': 'application/vnd.github.v3+json'
    };

    const getRes = await fetch(url, { headers });
    if (!getRes.ok) throw new Error('找不到文件 (' + getRes.status + ')');
    const { sha } = await getRes.json();

    const delRes = await fetch(url, {
      method: 'DELETE',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `删除文章：${slug}`,
        sha
      })
    });
    if (!delRes.ok) {
      const err = await delRes.json().catch(() => ({}));
      throw new Error(err.message || `删除失败 (${delRes.status})`);
    }

    setStatus('✓ 已删除，Actions 正在更新索引，约 1 分钟后生效。', 'ok');
    await loadList();
  } catch (e) {
    setStatus('删除失败：' + e.message, 'error');
  }
}

applyConfig();
loadList();