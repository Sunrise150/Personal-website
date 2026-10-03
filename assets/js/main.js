function applyConfig() {
  document.title = SITE_CONFIG.title;
  document.getElementById('site-title').textContent = SITE_CONFIG.title;
  document.getElementById('hero-title').textContent = SITE_CONFIG.title;
  document.getElementById('hero-desc').textContent = SITE_CONFIG.description;
  document.getElementById('footer-text').textContent = SITE_CONFIG.footer;
}

function formatDate(str) {
  const d = new Date(str);
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
}

async function renderPosts() {
  const list = document.getElementById('post-list');
  try {
    const res = await fetch('data/posts.json?t=' + Date.now());
    if (!res.ok) throw new Error('无法加载文章列表');
    const posts = await res.json();
    posts.sort((a, b) => new Date(b.date) - new Date(a.date));

    if (posts.length === 0) {
      list.innerHTML = '<p class="empty">还没有文章</p>';
      return;
    }

    list.innerHTML = posts.map(p => `
      <a href="post.html?slug=${encodeURIComponent(p.slug)}" class="post-card">
        <div class="post-meta">
          <time>${formatDate(p.date)}</time>
          ${(p.tags || []).map(t => `<span class="tag">${t}</span>`).join('')}
        </div>
        <h2 class="post-title">${p.title}</h2>
        <p class="post-excerpt">${p.excerpt || ''}</p>
        <span class="read-more">阅读 →</span>
      </a>
    `).join('');
  } catch (e) {
    list.innerHTML = `<p class="empty">加载失败：${e.message}</p>`;
  }
}

applyConfig();
renderPosts();