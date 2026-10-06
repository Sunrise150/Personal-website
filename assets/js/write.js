const STORAGE_KEY = 'blog_gh_settings';
const IMG_DIR = 'assets/images';
const FILE_DIR = 'assets/files';

/* ============ 草稿态：暂存图片和文件，发布时一起上传到 slug 子目录 ============ */
// 取消文章时清空，避免仓库冗余文件
const draftImages = []; // { file, blobUrl, name }
const draftFiles = [];  // { file, name }

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

let _statusTimer = null;
function setStatus(msg, type = '') {
  const el = document.getElementById('status');
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
  const base = SITE_CONFIG.base || '/';

  // 上传草稿图片到 assets/images/<slug>/，替换正文占位符
  for (let i = 0; i < draftImages.length; i++) {
    const d = draftImages[i];
    const ext = (d.name.match(/\.(\w+)$/) || [null, 'png'])[1].toLowerCase();
    const imgName = `img-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}.${ext}`;
    const path = `${IMG_DIR}/${slug}/${imgName}`;
    const content = await blobToBase64(d.file);
    const url = `https://api.github.com/repos/${settings.owner}/${settings.repo}/contents/${path}`;
    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': `token ${settings.token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ message: `上传图片：${imgName}`, content })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `图片上传失败 (${res.status})`);
    }
    body = body.split(`draft://img/${i}`).join(`${base}${path}`);
  }

  // 上传草稿文件到 assets/files/<slug>/，替换正文占位符
  for (let i = 0; i < draftFiles.length; i++) {
    const d = draftFiles[i];
    const safeName = d.name.replace(/[^\w.\-\u4e00-\u9fa5]+/g, '_');
    const fileName = `file-${Date.now().toString(36)}-${safeName}`;
    const path = `${FILE_DIR}/${slug}/${fileName}`;
    const content = await blobToBase64(d.file);
    const url = `https://api.github.com/repos/${settings.owner}/${settings.repo}/contents/${path}`;
    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': `token ${settings.token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ message: `上传文件：${d.name}`, content })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `文件上传失败 (${res.status})`);
    }
    body = body.split(`draft://file/${i}`).join(`${base}${path}`);
  }

  // 发布文章
  const tagLine = tags.length ? `[${tags.join(', ')}]` : '[]';
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

/* 清空草稿（取消文章或发布成功后调用） */
function clearDrafts() {
  draftImages.forEach(d => { try { URL.revokeObjectURL(d.blobUrl); } catch (e) {} });
  draftImages.length = 0;
  draftFiles.length = 0;
  document.getElementById('image-list').innerHTML = '';
  document.getElementById('file-list').innerHTML = '';
}

/* ============ 通用：把 File 转 base64 ============ */
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

/* ============ Tab 缩进支持 ============ */
const bodyTa = document.getElementById('body');
bodyTa.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab') return;
  e.preventDefault();
  const start = bodyTa.selectionStart;
  const end = bodyTa.selectionEnd;

  if (e.shiftKey) {
    // Shift+Tab：减少缩进（删除行首的 4 空格或 1 tab）
    const before = bodyTa.value.slice(0, start);
    const lineStart = before.lastIndexOf('\n') + 1;
    const linePrefix = bodyTa.value.slice(lineStart, start);
    let removed = 0;
    if (linePrefix.startsWith('    ')) removed = 4;
    else if (linePrefix.startsWith('\t')) removed = 1;
    if (removed) {
      bodyTa.value = bodyTa.value.slice(0, lineStart) + linePrefix.slice(removed) + bodyTa.value.slice(start);
      const newSel = Math.max(lineStart, start - removed);
      bodyTa.selectionStart = bodyTa.selectionEnd = newSel;
    }
  } else {
    // Tab：插入 4 个空格
    bodyTa.value = bodyTa.value.slice(0, start) + '    ' + bodyTa.value.slice(end);
    bodyTa.selectionStart = bodyTa.selectionEnd = start + 4;
  }
});

/* ============ 插入到正文 ============ */
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

/* ============ 图片流程：草稿态，发布时才上传 ============ */
function handleImages(files) {
  const list = document.getElementById('image-list');
  for (const f of files) {
    if (!f.type.startsWith('image/')) {
      const item = document.createElement('div');
      item.className = 'image-item error';
      item.textContent = `✗ ${f.name}：只能上传图片`;
      list.appendChild(item);
      continue;
    }
    if (f.size > 5 * 1024 * 1024) {
      const item = document.createElement('div');
      item.className = 'image-item error';
      item.textContent = `✗ ${f.name}：图片超过 5MB`;
      list.appendChild(item);
      continue;
    }
    const idx = draftImages.length;
    const blobUrl = URL.createObjectURL(f);
    draftImages.push({ file: f, blobUrl, name: f.name });
    const item = document.createElement('div');
    item.className = 'image-item ok';
    item.innerHTML = `<img src="${blobUrl}" alt="" style="max-width:60px;max-height:60px;border-radius:6px;vertical-align:middle;margin-right:8px">✓ ${f.name}（草稿，发布时上传到文章专属目录）`;
    list.appendChild(item);
    insertToBody(`![${f.name}](draft://img/${idx})`);
  }
}

/* ============ 压缩包流程：草稿态，发布时才上传 ============ */
function handleFiles(files) {
  const list = document.getElementById('file-list');
  for (const f of files) {
    // GitHub Contents API 单文件硬限制：100MB
    if (f.size > 100 * 1024 * 1024) {
      const item = document.createElement('div');
      item.className = 'image-item error';
      item.textContent = `✗ ${f.name}：文件超过 100MB（GitHub API 单文件上限）`;
      list.appendChild(item);
      continue;
    }
    const allowed = ['.zip', '.rar', '.7z', '.tar', '.gz', '.tgz', '.xz', '.bz2'];
    const lower = f.name.toLowerCase();
    if (!allowed.some(ext => lower.endsWith(ext))) {
      const item = document.createElement('div');
      item.className = 'image-item error';
      item.textContent = `✗ ${f.name}：只支持压缩包格式`;
      list.appendChild(item);
      continue;
    }
    const idx = draftFiles.length;
    draftFiles.push({ file: f, name: f.name });
    const item = document.createElement('div');
    item.className = 'image-item ok';
    item.textContent = `✓ ${f.name}（草稿，发布时上传到文章专属目录）`;
    list.appendChild(item);
    insertToBody(`📦 [下载：${f.name}](draft://file/${idx})`);
  }
}

/* ============ 事件绑定：表单 ============ */
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
    clearDrafts();
  } catch (err) {
    setStatus('发布失败：' + err.message, 'error');
  } finally {
    btn.disabled = false;
  }
});

/* 取消链接：清空草稿，避免仓库冗余文件 */
document.querySelector('.cancel-link').addEventListener('click', clearDrafts);

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

/* ============ 图片事件 ============ */
const imageInput = document.getElementById('image-input');
document.getElementById('image-pick').addEventListener('click', () => imageInput.click());
imageInput.addEventListener('change', (e) => {
  if (e.target.files.length) handleImages(e.target.files);
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
  if (e.dataTransfer.files.length) handleImages(e.dataTransfer.files);
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
    handleImages(files);
  }
});

/* ============ 压缩包事件 ============ */
const fileInput = document.getElementById('file-input');
document.getElementById('file-pick').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => {
  if (e.target.files.length) handleFiles(e.target.files);
  e.target.value = '';
});

/* ============ 初始化 ============ */
applyConfig();

const dateInput = document.getElementById('date');
if (!dateInput.value) {
  dateInput.value = new Date().toISOString().slice(0, 10);
}

if (!getSettings()) {
  openSettings();
}