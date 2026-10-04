const STORAGE_KEY = 'blog_gh_settings';
const IMG_DIR = 'assets/images';

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

  // 用模板字符串拼接，保证换行正确
  const fileContent = `---
title: ${title}
date: ${date}
tags: ${tagLine}
excerpt: ${excerpt || ''}
---

${body}
`;

  const content = encodeBase64(fileContent);
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

/* ============ 图片上传 ============ */
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

async function uploadImage(file) {
  const settings = getSettings();
  if (!settings) throw new Error('请先点击「设置」填写 GitHub 信息');
  if (!file.type.startsWith('image/')) throw new Error('只能上传图片');
  if (file.size > 5 * 1024 * 1024) throw new Error('图片超过 5MB');

  const ext = (file.name.match(/\.(\w+)$/) || [null, 'png'])[1].toLowerCase();
  const name = `img-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}.${ext}`;
  const path = `${IMG_DIR}/${name}`;
  const content = await blobToBase64(file);
  const url = `https://api.github.com/repos/${settings.owner}/${settings.repo}/contents/${path}`;

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `token ${settings.token}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      message: `上传图片：${name}`,
      content
    })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `上传失败 (${res.status})`);
  }
  return path;
}

function insertToBody(md) {
  const ta = document.getElementById('body');
  const start = ta.selectionStart ?? ta.value.length;
  const end = ta.selectionEnd ?? ta.value.length;
  const before = ta.value.slice(0, start);
  const after = ta.value.slice(end);
  const prefix = before && !before.endsWith('\n') ? '\n\n' : '';
  const suffix = after && !after.startsWith('\n') ? '\n\n' : '';
  ta.value = before + prefix + md + suffix + after;
  ta.focus();
  ta.selectionStart = ta.selectionEnd = (before + prefix + md).length;
}

async function handleFiles(files) {
  const list = document.getElementById('image-list');
  for (const f of files) {
    const item = document.createElement('div');
    item.className = 'image-item';
    item.textContent = `上传中：${f.name} …`;
    list.appendChild(item);
    try {
      const path = await uploadImage(f);
      // 用 base 拼成绝对路径，保证任何页面都能加载
      const base = SITE_CONFIG.base || '/';
      const md = `![${f.name}](${base}${path})`;
      insertToBody(md);
      item.textContent = `✓ ${f.name} → 已插入正文`;
      item.classList.add('ok');
    } catch (e) {
      item.textContent = `✗ ${f.name}：${e.message}`;
      item.classList.add('error');
    }
  }
}

/* ============ 事件绑定 ============ */
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
    document.getElementById('image-list').innerHTML = '';
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

/* 图片相关事件 */
const imageInput = document.getElementById('image-input');
document.getElementById('image-pick').addEventListener('click', () => imageInput.click());
imageInput.addEventListener('change', (e) => {
  if (e.target.files.length) handleFiles(e.target.files);
  e.target.value = '';
});

const drop = document.getElementById('image-drop');
['dragenter', 'dragover'].forEach(ev => {
  drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('dragging'); });
});
['dragleave', 'drop'].forEach(ev => {
  drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('dragging'); });
});
drop.addEventListener('drop', (e) => {
  if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
});

document.addEventListener('paste', (e) => {
  const items = e.clipboardData?.items || [];
  const files = [];
  for (const it of items) {
    if (it.type.startsWith('image/')) {
      const f = it.getAsFile();
      if (f) files.push(f);
    }
  }
  if (files.length) {
    e.preventDefault();
    handleFiles(files);
  }
});

/* 初始化 */
applyConfig();

const dateInput = document.getElementById('date');
if (!dateInput.value) {
  dateInput.value = new Date().toISOString().slice(0, 10);
}

if (!getSettings()) {
  openSettings();
}