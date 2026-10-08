function applyConfig() {
  document.getElementById('site-title').textContent = SITE_CONFIG.title;
  document.getElementById('footer-text').textContent = SITE_CONFIG.footer;
}

function formatDate(str) {
  const d = new Date(str);
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
}

function readingTime(text) {
  const cn = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const en = (text.match(/[a-zA-Z]+/g) || []).length;
  return Math.max(1, Math.ceil((cn + en * 2) / 400));
}

// 修复图片路径：把相对路径补成 base 开头的绝对路径
function fixImagePaths(html) {
  const base = SITE_CONFIG.base || '/';
  return html.replace(
    /<img([^>]*?)src="(?!https?:|\/\/|\/|data:)([^"]+)"/g,
    (m, attrs, src) => `<img${attrs}src="${base}${src}"`
  );
}

async function loadPost() {
  const slug = new URLSearchParams(location.search).get('slug');
  if (!slug) return showError('未指定文章');

  try {
    const [idxRes, mdRes] = await Promise.all([
      fetch('data/posts.json?t=' + Date.now()),
      fetch(`posts/${encodeURIComponent(slug)}.md?t=` + Date.now())
    ]);
    if (!idxRes.ok) throw new Error('无法加载文章索引 (' + idxRes.status + ')');
    if (!mdRes.ok) throw new Error(`找不到文件 posts/${slug}.md (${mdRes.status})`);

    const posts = await idxRes.json();
    const markdown = await mdRes.text();
    const post = posts.find(p => p.slug === slug);
    if (!post) throw new Error(`索引里没有 slug = "${slug}" 的文章`);

    document.title = `${post.title} - ${SITE_CONFIG.title}`;
    document.getElementById('post-header').innerHTML = `
      <div class="post-meta">
        <time>${formatDate(post.date)}</time>
        <span class="dot">·</span>
        <span>${readingTime(markdown)} 分钟阅读</span>
        ${(post.tags || []).map(t => `<span class="tag">${t}</span>`).join('')}
      </div>
      <h1>${post.title}</h1>
    `;

    // 渲染 Markdown，然后修正图片路径
    let html = marked.parse(markdown);
    html = fixImagePaths(html);
    document.getElementById('post-content').innerHTML = html;

    const sorted = posts.slice().sort((a, b) => new Date(b.date) - new Date(a.date));
    const i = sorted.findIndex(p => p.slug === slug);
    const prev = sorted[i + 1];
    const next = sorted[i - 1];
    let nav = '<div class="post-nav">';
    nav += prev
      ? `<a class="post-nav-item" href="post.html?slug=${encodeURIComponent(prev.slug)}"><span>← 上一篇</span><strong>${prev.title}</strong></a>`
      : '<div></div>';
    nav += next
      ? `<a class="post-nav-item next" href="post.html?slug=${encodeURIComponent(next.slug)}"><span>下一篇 →</span><strong>${next.title}</strong></a>`
      : '<div></div>';
    nav += '</div>';
    document.getElementById('post-nav').innerHTML = nav;

    document.getElementById('loading').style.display = 'none';
    document.getElementById('post-wrap').style.display = 'block';
    // 显示评论区
    const cs = document.getElementById('comments-section');
    if (cs) cs.style.display = 'block';
    // 触发评论加载
    document.dispatchEvent(new CustomEvent('post:loaded', { detail: { slug } }));
  } catch (e) {
    showError(e.message);
  }
}

function showError(msg) {
  document.getElementById('loading').innerHTML = `<p class="empty">${msg}</p>`;
}

applyConfig();
loadPost();