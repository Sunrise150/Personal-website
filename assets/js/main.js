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

let ALL_POSTS = [];        // 全部文章缓存
let POST_QUERY = '';       // 当前搜索词

function renderPostList(posts) {
  const list = document.getElementById('post-list');
  if (posts.length === 0) {
    list.innerHTML = ALL_POSTS.length === 0
      ? '<p class="empty">还没有文章</p>'
      : '<p class="empty">没有匹配的文章</p>';
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
}

function filterPosts(q) {
  POST_QUERY = q.trim().toLowerCase();
  if (!POST_QUERY) return ALL_POSTS;
  return ALL_POSTS.filter(p => {
    const title = (p.title || '').toLowerCase();
    const excerpt = (p.excerpt || '').toLowerCase();
    const tags = (p.tags || []).join(' ').toLowerCase();
    return title.includes(POST_QUERY) || excerpt.includes(POST_QUERY) || tags.includes(POST_QUERY);
  });
}

function initPostSearch() {
  const bar = document.getElementById('post-search-bar');
  const input = document.getElementById('post-search-input');
  const clear = document.getElementById('post-search-clear');
  if (!bar || !input || !clear) return;
  bar.style.display = ''; // 文章加载完才显示
  let timer = null;
  input.addEventListener('input', (e) => {
    const v = e.target.value;
    clear.style.display = v ? '' : 'none';
    clearTimeout(timer);
    timer = setTimeout(() => renderPostList(filterPosts(v)), 200);
  });
  clear.addEventListener('click', () => {
    input.value = '';
    clear.style.display = 'none';
    renderPostList(ALL_POSTS);
    input.focus();
  });
}

async function renderPosts() {
  const list = document.getElementById('post-list');
  try {
    const res = await fetch('data/posts.json?t=' + Date.now());
    if (!res.ok) throw new Error('无法加载文章列表');
    ALL_POSTS = await res.json();
    ALL_POSTS.sort((a, b) => new Date(b.date) - new Date(a.date));
    renderPostList(ALL_POSTS);
    initPostSearch(); // 文章加载完成才初始化搜索框
  } catch (e) {
    list.innerHTML = `<p class="empty">加载失败：${e.message}</p>`;
  }
}

applyConfig();
renderPosts();
