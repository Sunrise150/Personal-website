/* ============ 评论模块 ============
 * 数据结构：data/comments-{slug}.json
 * [{ id, name, body, time, replyTo, attachments: [{ type: 'image'|'file', url, name }] }]
 * 通过 GitHub Contents API 写入；读取时直接 fetch JSON
 */

const CMT_STORAGE_KEY = 'blog_gh_settings'; // 复用 write.js 的 key
const CMT_IMG_DIR = 'assets/comments/images';
const CMT_FILE_DIR = 'assets/comments/files';

let _currentSlug = null;
let _comments = [];
let _draftImages = []; // { file, name }
let _draftFiles = [];  // { file, name }
let _replyToId = null; // 当前回复的评论 id
let _emojiPanelBuilt = false;

const $ = id => document.getElementById(id);

/* ============ 设置 ============ */
function cmtGetSettings() {
  try {
    const raw = localStorage.getItem(CMT_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function cmtSaveSettings(s) {
  localStorage.setItem(CMT_STORAGE_KEY, JSON.stringify(s));
}

function cmtOpenSettings() {
  const s = cmtGetSettings() || {};
  $('cmt-cfg-owner').value = s.owner || '';
  $('cmt-cfg-repo').value = s.repo || '';
  $('cmt-cfg-token').value = s.token || '';
  $('comment-settings-modal').hidden = false;
}

function cmtCloseSettings() {
  $('comment-settings-modal').hidden = true;
}

/* ============ 加载评论 ============ */
async function cmtLoad() {
  if (!_currentSlug) return;
  const list = $('comments-list');
  try {
    const res = await fetch(`data/comments-${_currentSlug}.json?t=` + Date.now());
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) {
        _comments = data;
      }
    } else if (res.status === 404) {
      _comments = [];
    } else {
      throw new Error('加载评论失败: HTTP ' + res.status);
    }
  } catch (e) {
    console.warn('[comments] 加载失败:', e);
  }
  cmtRender();
}

/* ============ 渲染评论（支持嵌套） ============ */
function cmtRender() {
  const list = $('comments-list');
  if (!_comments.length) {
    list.innerHTML = '<div class="comments-empty">暂无评论，来抢沙发吧</div>';
    return;
  }
  // 按 time 排序，旧在前
  const sorted = [..._comments].sort((a, b) => new Date(a.time) - new Date(b.time));
  // 构建嵌套树
  const map = new Map();
  sorted.forEach(c => map.set(c.id, { ...c, children: [] }));
  const roots = [];
  sorted.forEach(c => {
    if (c.replyTo && map.has(c.replyTo)) {
      map.get(c.replyTo).children.push(map.get(c.id));
    } else {
      roots.push(map.get(c.id));
    }
  });
  list.innerHTML = roots.map(c => cmtRenderItem(c, 0)).join('');
  // 绑定回复按钮
  list.querySelectorAll('.comment-action-btn[data-reply]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.reply;
      cmtOpenInlineReply(id);
    });
  });
}

function cmtRenderItem(c, depth) {
  const time = c.time ? new Date(c.time).toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit'
  }) : '';
  let bodyHtml;
  try {
    bodyHtml = marked.parse(c.body || '', { breaks: true });
  } catch {
    bodyHtml = (c.body || '').replace(/\n/g, '<br>');
  }
  let attachHtml = '';
  if (c.attachments && c.attachments.length) {
    attachHtml = '<div class="comment-attachments-list">';
    c.attachments.forEach(a => {
      if (a.type === 'image') {
        attachHtml += `<a href="${a.url}" target="_blank"><img src="${a.url}" alt="${a.name || ''}" style="max-height:120px;border-radius:6px"></a>`;
      } else {
        attachHtml += `<a href="${a.url}" target="_blank" class="comment-attach">📦 ${a.name || '附件'}</a>`;
      }
    });
    attachHtml += '</div>';
  }
  const replyBtn = depth < 3 ? `<button class="comment-action-btn" data-reply="${c.id}">回复</button>` : '';
  let html = `
    <div class="comment-item" data-id="${c.id}">
      <div class="comment-head">
        <span class="comment-author">${cmtEscape(c.name || '匿名')}</span>
        <span class="comment-time">${time}</span>
      </div>
      <div class="comment-body">${bodyHtml}</div>
      ${attachHtml}
      <div class="comment-actions">${replyBtn}</div>
      <div class="inline-reply-container"></div>
  `;
  if (c.children && c.children.length) {
    html += '<div class="comment-reply">';
    html += c.children.map(ch => cmtRenderItem(ch, depth + 1)).join('');
    html += '</div>';
  }
  html += '</div>';
  return html;
}

function cmtEscape(s) {
  return String(s).replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[m]);
}

/* ============ 内联回复表单 ============ */
function cmtOpenInlineReply(replyToId) {
  // 先清掉其他内联回复
  document.querySelectorAll('.inline-reply-container').forEach(el => el.innerHTML = '');
  const item = document.querySelector(`.comment-item[data-id="${replyToId}"]`);
  if (!item) return;
  const container = item.querySelector('.inline-reply-container');
  if (!container) return;
  container.innerHTML = `
    <div class="comment-inline-reply">
      <textarea placeholder="回复…" rows="2"></textarea>
      <div class="inline-reply-actions">
        <button class="inline-cancel">取消</button>
        <button class="inline-submit">回复</button>
      </div>
    </div>
  `;
  const ta = container.querySelector('textarea');
  const cancel = container.querySelector('.inline-cancel');
  const submit = container.querySelector('.inline-submit');
  ta.focus();
  cancel.addEventListener('click', () => container.innerHTML = '');
  submit.addEventListener('click', () => {
    const text = ta.value.trim();
    if (!text) return;
    const name = $('comment-name').value.trim() || '匿名';
    cmtSubmitComment({ name, body: text, replyTo: replyToId, attachments: [] });
    container.innerHTML = '';
  });
}

/* ============ 提交评论 ============ */
function cmtSetStatus(msg, type = '') {
  const el = $('comment-status');
  if (!el) return;
  el.textContent = msg;
  el.className = 'comment-status ' + type;
}

function encodeBase64(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

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

async function cmtUploadAttachment(file, kind, slug) {
  const settings = cmtGetSettings();
  if (!settings) throw new Error('请先设置 GitHub 信息');
  const dir = kind === 'image' ? CMT_IMG_DIR : CMT_FILE_DIR;
  const ext = (file.name.match(/\.(\w+)$/) || [null, kind === 'image' ? 'png' : 'zip'])[1].toLowerCase();
  const safeName = file.name.replace(/[^\w.\-\u4e00-\u9fa5]+/g, '_');
  const fileName = `cmt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6)}-${safeName}`;
  const path = `${dir}/${slug}/${fileName}`;
  const content = await blobToBase64(file);
  const url = `https://api.github.com/repos/${settings.owner}/${settings.repo}/contents/${path}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `token ${settings.token}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ message: `评论附件：${file.name}`, content })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `附件上传失败 (${res.status})`);
  }
  const base = SITE_CONFIG.base || '/';
  return { type: kind, url: `${base}${path}`, name: file.name };
}

async function cmtFetchExistingSha() {
  const settings = cmtGetSettings();
  const path = `data/comments-${_currentSlug}.json`;
  const url = `https://api.github.com/repos/${settings.owner}/${settings.repo}/contents/${path}`;
  const res = await fetch(url, {
    headers: { 'Authorization': `token ${settings.token}`, 'Accept': 'application/vnd.github.v3+json' }
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`获取评论文件失败 (${res.status})`);
  const data = await res.json();
  return data.sha;
}

async function cmtSubmitComment({ name, body, replyTo, attachments }) {
  const settings = cmtGetSettings();
  if (!settings) {
    cmtOpenSettings();
    return;
  }
  const submit = $('comment-submit');
  submit.disabled = true;
  cmtSetStatus('正在提交…');

  try {
    // 上传新附件
    const newAttachments = [];
    for (let i = 0; i < _draftImages.length; i++) {
      const a = await cmtUploadAttachment(_draftImages[i].file, 'image', _currentSlug);
      newAttachments.push(a);
    }
    for (let i = 0; i < _draftFiles.length; i++) {
      const a = await cmtUploadAttachment(_draftFiles[i].file, 'file', _currentSlug);
      newAttachments.push(a);
    }

    const comment = {
      id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: name || '匿名',
      body,
      time: new Date().toISOString(),
      replyTo: replyTo || null,
      attachments: newAttachments
    };

    // 先拉取最新评论（避免覆盖其他人的提交）
    let latestList = [];
    try {
      const res = await fetch(`data/comments-${_currentSlug}.json?t=` + Date.now());
      if (res.ok) latestList = await res.json();
    } catch (e) {}
    if (!Array.isArray(latestList)) latestList = [];
    latestList.push(comment);

    const content = encodeBase64(JSON.stringify(latestList, null, 2));
    const path = `data/comments-${_currentSlug}.json`;
    const url = `https://api.github.com/repos/${settings.owner}/${settings.repo}/contents/${path}`;
    // 获取现有 sha（更新而不是创建）
    let sha;
    try {
      sha = await cmtFetchExistingSha();
    } catch (e) { sha = null; }
    const bodyObj = {
      message: `新评论：${name || '匿名'} on ${_currentSlug}`,
      content
    };
    if (sha) bodyObj.sha = sha;
    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': `token ${settings.token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(bodyObj)
    });
    if (!res.ok) {
      // 409 conflict：他人刚提交过，重试
      if (res.status === 409 || res.status === 422) {
        cmtSetStatus('提交冲突，正在重试…');
        // 简单重试一次
        const retryRes = await fetch(url, {
          method: 'PUT',
          headers: {
            'Authorization': `token ${settings.token}`,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(bodyObj)
        });
        if (!retryRes.ok) throw new Error('提交失败，请刷新后重试');
      } else {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `提交失败 (${res.status})`);
      }
    }

    // 提交成功，更新本地状态
    _comments = latestList;
    cmtRender();
    // 清空表单
    $('comment-body').value = '';
    _draftImages.length = 0;
    _draftFiles.length = 0;
    cmtRenderAttachments();
    _replyToId = null;
    $('comment-form-title').textContent = '发表评论';
    cmtSetStatus('✓ 评论成功', 'ok');
    setTimeout(() => cmtSetStatus(''), 5000);
  } catch (e) {
    cmtSetStatus('提交失败：' + e.message, 'error');
  } finally {
    submit.disabled = false;
  }
}

/* ============ 附件选择 ============ */
function cmtRenderAttachments() {
  const el = $('comment-attachments');
  let html = '';
  _draftImages.forEach((d, i) => {
    html += `<div class="comment-attach-item">📷 ${d.name}<span class="remove" data-idx="${i}" data-kind="img">✕</span></div>`;
  });
  _draftFiles.forEach((d, i) => {
    html += `<div class="comment-attach-item">📦 ${d.name}<span class="remove" data-idx="${i}" data-kind="file">✕</span></div>`;
  });
  el.innerHTML = html;
  el.querySelectorAll('.remove').forEach(r => {
    r.addEventListener('click', () => {
      const idx = parseInt(r.dataset.idx);
      if (r.dataset.kind === 'img') _draftImages.splice(idx, 1);
      else _draftFiles.splice(idx, 1);
      cmtRenderAttachments();
    });
  });
}

function cmtHandleImages(files) {
  for (const f of files) {
    if (!f.type.startsWith('image/')) continue;
    if (f.size > 5 * 1024 * 1024) {
      cmtSetStatus(`图片 ${f.name} 超过 5MB`, 'error');
      continue;
    }
    _draftImages.push({ file: f, name: f.name });
  }
  cmtRenderAttachments();
}

function cmtHandleFiles(files) {
  const allowed = ['.zip', '.rar', '.7z', '.tar', '.gz', '.tgz', '.xz', '.bz2'];
  for (const f of files) {
    if (f.size > 100 * 1024 * 1024) {
      cmtSetStatus(`文件 ${f.name} 超过 100MB`, 'error');
      continue;
    }
    const lower = f.name.toLowerCase();
    if (!allowed.some(ext => lower.endsWith(ext))) {
      cmtSetStatus(`文件 ${f.name} 非压缩包格式`, 'error');
      continue;
    }
    _draftFiles.push({ file: f, name: f.name });
  }
  cmtRenderAttachments();
}

/* ============ Emoji 面板 ============ */
const EMOJI_LIST = [
  '😀','😁','😂','🤣','😃','😄','😅','😆','😉','😊','😋','😎','😍','😘','😗','😙',
  '😚','🙂','🤗','🤔','😐','😑','😶','🙄','😏','😣','😥','😮','🤐','😯','😪','😫',
  '😴','😌','😛','😜','😝','🤤','😒','😓','😔','😕','🙃','🤑','😲','😖','😞','😟',
  '😠','😡','😢','😭','😤','😰','🤯','😬','🤥','😈','👿','💀','👻','👽','🤖',
  '💌','❤️','💔','💕','💖','💗','💘','💝','💣','💥','💦','💨','💫','🌟','⭐','⚡',
  '🔥','☀️','☁️','🌧','⛈','🌪','🌫','🌈','❄️','⛄','🌊','🎯','🎁','🏆','🎉','🎊',
  '🎈','🎂','🍰','🍔','🍟','🍕','🍦','🍩','🍪','🍫','🍬','🍭','🍯','🍵','☕','🍷',
  '🍺','🍻','⚽','🏀','🏈','⚾','🎾','🏐','🎱','🏓','🎮','🎨','🎵','🎶','🎤','🎧',
  '👍','👎','👌','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','👇','☝️','✋','🤚','🖐',
  '👋','🤝','👏','🙌','👐','🤲','🙏','💪','🦾','🦿','👀','👁','👅','👄','🦷','🧠'
];

function cmtBuildEmojiPanel() {
  const panel = $('emoji-panel');
  if (!panel) return;
  panel.innerHTML = '';
  EMOJI_LIST.forEach(e => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = e;
    btn.addEventListener('click', () => cmtInsertEmoji(e));
    panel.appendChild(btn);
  });
  _emojiPanelBuilt = true;
}

function cmtInsertEmoji(e) {
  const ta = $('comment-body');
  const start = ta.selectionStart ?? ta.value.length;
  const end = ta.selectionEnd ?? ta.value.length;
  ta.value = ta.value.slice(0, start) + e + ta.value.slice(end);
  ta.focus();
  ta.selectionStart = ta.selectionEnd = start + e.length;
}

/* ============ 初始化 ============ */
function cmtInit() {
  // 文章加载后，读取 slug
  document.addEventListener('post:loaded', (e) => {
    _currentSlug = e.detail.slug;
    cmtLoad();
  });

  // 表单提交
  $('comment-submit').addEventListener('click', () => {
    const name = $('comment-name').value.trim() || '匿名';
    const body = $('comment-body').value.trim();
    if (!body) {
      cmtSetStatus('请填写评论内容', 'error');
      return;
    }
    cmtSubmitComment({ name, body, replyTo: _replyToId, attachments: [] });
  });

  // emoji 按钮
  $('emoji-btn').addEventListener('click', () => {
    const panel = $('emoji-panel');
    if (!_emojiPanelBuilt) cmtBuildEmojiPanel();
    panel.hidden = !panel.hidden;
    $('emoji-btn').classList.toggle('active', !panel.hidden);
  });
  // 点击外部关闭 emoji 面板
  document.addEventListener('click', (e) => {
    const panel = $('emoji-panel');
    if (panel.hidden) return;
    if (e.target.closest('.emoji-panel') || e.target.closest('#emoji-btn')) return;
    panel.hidden = true;
    $('emoji-btn').classList.remove('active');
  });

  // 图片选择
  $('comment-img-btn').addEventListener('click', () => $('comment-img-input').click());
  $('comment-img-input').addEventListener('change', e => {
    if (e.target.files.length) cmtHandleImages(e.target.files);
    e.target.value = '';
  });

  // 文件选择
  $('comment-file-btn').addEventListener('click', () => $('comment-file-input').click());
  $('comment-file-input').addEventListener('change', e => {
    if (e.target.files.length) cmtHandleFiles(e.target.files);
    e.target.value = '';
  });

  // 设置弹窗
  $('comment-settings-link').addEventListener('click', cmtOpenSettings);
  $('cmt-cfg-cancel').addEventListener('click', cmtCloseSettings);
  $('comment-settings-modal').addEventListener('click', e => {
    if (e.target.id === 'comment-settings-modal') cmtCloseSettings();
  });
  $('cmt-cfg-save').addEventListener('click', () => {
    const owner = $('cmt-cfg-owner').value.trim();
    const repo = $('cmt-cfg-repo').value.trim();
    const token = $('cmt-cfg-token').value.trim();
    if (!owner || !repo || !token) {
      alert('请填写完整');
      return;
    }
    cmtSaveSettings({ owner, repo, token });
    cmtCloseSettings();
    cmtSetStatus('设置已保存 ✓', 'ok');
  });

  // 粘贴图片
  document.addEventListener('paste', e => {
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
      cmtHandleImages(files);
    }
  });
}

// 等到 DOM 就绪后初始化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', cmtInit);
} else {
  cmtInit();
}
