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

function saveSettings(s) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

function openSettings() {
  const s = getSettings() || {};
  document.getElementById('cfg-owner').value = s.owner || '';
  document.getElementById('cfg-repo').value = s.repo || '';
  document.getElementById('cfg-token').value = s.token || '';
  document.getElementById('settings-modal').hidden = false;
}

function closeSettings() {
  document.getElementById('settings-modal').hidden = true;
}

function setStatus(msg, type = '') {
  const el = document.getElementById('status');
  el.textContent = msg;
  el.className = 'status ' + type;
}

function encodeBase64(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

function makeSlug(title, date) {
  const ascii = title.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30);
  const stamp = Date.now().toString(36).slice(-5);
  return ascii ? `${date}-${ascii}-${stamp}` : `${date}-${stamp}`;
}

async function publishPost({ title, date, tags, excerpt, body }) {
  const settings = getSettings();
  if (!settings) throw new Error('请先点击「设置」填写 GitHub 信息');

  const slug = makeSlug(title, date);
  const tagLine = tags.length ? `[${tags.join(', ')}]` : '[]';
  const fm = [
    '---',
    `title: ${title}`,
    `date: ${date}`,
    `tags: ${tagLine}`,
    `excerpt: ${excerpt || ''}`,
    '---',
    '',
    body
  ].join('\n');

  const content = encodeBase64(fm);
  const path = `posts/${slug}.md`;
  const url = `https://api.github.com/repos/${settings.owner}/${settings.repo}/contents/${path}`;

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `token ${settings.token}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      message: `新文章：${title}`,
      content
    })
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `提交失败 (${res.status})`);
  }

  return slug;
}

document.getElementById('write-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  if (!getSettings()) {
    openSettings();
    return;
  }

  const title = document.getElementById('title').value.trim();
  const date = document.getElementById('date').value;
  const tagsRaw = document.getElementById('tags').value.trim();
  const excerpt = document.getElementById('excerpt').value.trim();
  const body = document.getElementById('body').value.trim();

  if (!title || !date || !body) {
    setStatus('请填写标题、日期和正文', 'error');
    return;
  }

  const tags = tagsRaw
    ? tagsRaw.split(/[,，]/).map(s => s.trim()).filter(Boolean)
    : [];

  const btn = document.getElementById('submit-btn');
  btn.disabled = true;
  setStatus('正在提交…');

  try {
    await publishPost({ title, date, tags, excerpt, body });
    setStatus('✓ 发布成功！GitHub Actions 正在构建，约 1 分钟后刷新首页可见。', 'ok');
    document.getElementById('title').value = '';
    document.getElementById('tags').value = '';
    document.getElementById('excerpt').value = '';
    document.getElementById('body').value = '';
  } catch (err) {
    setStatus('发布失败：' + err.message, 'error');
  } finally {
    btn.disabled = false;
  }
});

document.getElementById('open-settings').addEventListener('click', openSettings);

document.getElementById('cfg-save').addEventListener('click', () => {
  const owner = document.getElementById('cfg-owner').value.trim();
  const repo = document.getElementById('cfg-repo').value.trim();
  const token = document.getElementById('cfg-token').value.trim();
  if (!owner || !repo || !token) {
    alert('请填写完整');
    return;
  }
  saveSettings({ owner, repo, token });
  closeSettings();
  setStatus('设置已保存 ✓', 'ok');
});

document.getElementById('settings-modal').addEventListener('click', (e) => {
  if (e.target.id === 'settings-modal') closeSettings();
});

applyConfig();

const dateInput = document.getElementById('date');
if (!dateInput.value) {
  dateInput.value = new Date().toISOString().slice(0, 10);
}

if (!getSettings()) {
  openSettings();
}