const fs = require('fs');
const path = require('path');

const POSTS_DIR = path.join(__dirname, '..', 'posts');
const OUT_FILE = path.join(__dirname, '..', 'data', 'posts.json');

function parseFrontmatter(text) {
  const match = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!match) return { data: {} };
  const yaml = match[1];
  const data = {};
  for (const line of yaml.split('\n')) {
    const m = line.match(/^(\w+)\s*:\s*(.+)$/);
    if (!m) continue;
    const key = m[1].trim();
    let val = m[2].trim();
    if (val.startsWith('[') && val.endsWith(']')) {
      val = val.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    } else {
      val = val.replace(/^["']|["']$/g, '');
    }
    data[key] = val;
  }
  return { data };
}

if (!fs.existsSync(POSTS_DIR)) {
  console.log('没有 posts 目录，跳过');
  process.exit(0);
}

const files = fs.readdirSync(POSTS_DIR).filter(f => f.endsWith('.md'));
const posts = files.map(file => {
  const slug = file.replace(/\.md$/, '');
  const raw = fs.readFileSync(path.join(POSTS_DIR, file), 'utf-8');
  const { data } = parseFrontmatter(raw);
  return {
    slug,
    title: data.title || slug,
    date: data.date || '1970-01-01',
    tags: Array.isArray(data.tags) ? data.tags : [],
    excerpt: data.excerpt || ''
  };
});

posts.sort((a, b) => new Date(b.date) - new Date(a.date));

fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
fs.writeFileSync(OUT_FILE, JSON.stringify(posts, null, 2));
console.log(`已生成 ${posts.length} 篇文章索引 → data/posts.json`);