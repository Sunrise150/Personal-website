/* ============ Cloudflare Workers AI 对话模块 ============
 * 两种模式：
 *   1) 独立页面模式（ai.html）：直接渲染聊天界面
 *   2) Drawer 抽屉模式（index.html shell）：注入右侧抽屉 + 悬浮按钮
 * 与音乐 player.js 独立共存（player 固定在底部，AI drawer 固定在右侧）
 *
 * 使用步骤：
 *   1. 部署 cf-ai-worker.js 到 Cloudflare Workers（见该文件顶部注释）
 *   2. 把下面 WORKER_URL 改成你自己的 Worker 地址
 *   3. 在 Worker 代码 ALLOWED_ORIGINS 里加上你的博客域名
 *   4. 刷新页面即可
 *
 * 🔒 安全说明：开源仓库不存任何密钥，靠 Worker 端的 CORS Origin 白名单防护
 *    浏览器同源策略保证 Origin 无法伪造，足够防止其他网站盗用
 */
(function () {
  // ====== ⚠️ 只需填这一行 ======
  const WORKER_URL = 'https://my-blog-ai.974111779.workers.dev';
  // ==================================

  const HISTORY_KEY = 'cf_ai_history';
  const MAX_HISTORY = 30;

  // Worker 状态：'unknown' / 'up' / 'down' / 'unconfigured'
  let workerStatus = WORKER_URL ? 'unknown' : 'unconfigured';

  // ==== 探测 Worker（发送 POST ping）====
  async function detectWorker() {
    if (!WORKER_URL) { workerStatus = 'unconfigured'; return false; }
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 3000);
      const res = await fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ msg: 'ping', history: [] }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (res.ok) { workerStatus = 'up'; return true; }
      workerStatus = 'down'; return false;
    } catch (e) {
      workerStatus = 'down'; return false;
    }
  }

  // ==== 调用 Workers AI（带多轮历史）====
  async function askAI(userMsg) {
    if (workerStatus === 'unknown') await detectWorker();

    if (!WORKER_URL) {
      return '🔧 请先在 assets/js/ai.js 顶部配置 WORKER_URL。';
    }

    if (workerStatus === 'unconfigured') {
      return '🔧 WORKER_URL 未配置。打开 assets/js/ai.js 填写。';
    }

    // 取出历史，格式化为 Worker 需要的 messages 数组
    const fullHistory = loadHistory();
    const messages = [];
    for (const h of fullHistory) {
      if (h.role === 'user') messages.push({ role: 'user', content: h.text || h.content || '' });
      else if (h.role === 'bot') messages.push({ role: 'assistant', content: h.text || h.content || '' });
    }

    try {
      const res = await fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ msg: userMsg, history: messages }),
      });
      if (res.status === 403) {
        return '❌ 当前域名不在 Worker 的 ALLOWED_ORIGINS 白名单里。\n\n👉 请到 Cloudflare Worker 代码里把当前域名加进去：\n    ' + location.origin;
      }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      if (data && data.result === 0) {
        return (data.content || '').replace(/\{br\}/g, '\n').trim();
      }
      return '❌ ' + (data && data.content ? data.content : (data && data.error ? data.error : '未知错误'));
    } catch (err) {
      const stillUp = await detectWorker();
      if (!stillUp) {
        return '❌ 无法连接到 Cloudflare Worker（' + WORKER_URL + '）。\n\n👉 请确认：\n   1. Worker 已成功部署\n   2. URL 拼写正确\n   3. Workers AI Binding 已配置\n\n错误：' + (err && err.message ? err.message : err);
      }
      return '❌ 请求失败：' + (err && err.message ? err.message : err);
    }
  }

  // ==== 历史记录存取 ====
  function loadHistory() {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { return []; }
  }
  function saveHistory(arr) {
    if (arr.length > MAX_HISTORY) arr = arr.slice(-MAX_HISTORY);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(arr));
  }

  // ==== 状态指示器 ====
  function makeStatusEl(parent) {
    const el = document.createElement('div');
    el.className = 'ai-proxy-status';
    el.style.cssText = 'font-size:11px;color:#78716c;margin-bottom:6px;padding:4px 10px;background:rgba(64,64,64,0.4);border-radius:6px;text-align:center;';
    el.textContent = WORKER_URL ? '🔍 正在探测 Worker...' : '🔧 WORKER_URL 未配置';
    parent.prepend ? parent.prepend(el) : (parent.firstChild ? parent.insertBefore(el, parent.firstChild) : parent.appendChild(el));
    return el;
  }
  async function refreshStatus(el) {
    if (!WORKER_URL) {
      el.innerHTML = '🔧 未配置 WORKER_URL — 打开 <b style="color:#fbbf24">assets/js/ai.js</b> 填写你的 Cloudflare Worker 地址';
      el.style.color = '#fbbf24'; el.style.background = 'rgba(251,191,36,0.12)';
      return;
    }
    el.textContent = '🔍 正在探测 Worker...';
    el.style.color = '#a8a29e'; el.style.background = 'rgba(64,64,64,0.4)';
    const ok = await detectWorker();
    if (ok) {
      el.textContent = '🟢 Cloudflare AI 已就绪';
      el.style.color = '#86efac'; el.style.background = 'rgba(34,197,94,0.15)';
    } else {
      const shortUrl = WORKER_URL.replace('https://', '').replace('http://', '');
      el.innerHTML = '🔴 Worker 不可用 <span style="color:#a8a29e;font-size:10px">' + shortUrl + '</span>';
      el.style.color = '#fca5a5'; el.style.background = 'rgba(239,68,68,0.12)';
    }
  }

  // ==== 模式一：独立页面（ai.html） ====
  function setupPageMode() {
    const $chat = document.getElementById('ai-chat');
    const $input = document.getElementById('ai-input');
    const $send = document.getElementById('ai-send');
    const $reset = document.getElementById('ai-reset');
    if (!$chat) return false;

    // Worker 状态指示器
    const $status = makeStatusEl($chat.parentElement);
    refreshStatus($status);
    const history = loadHistory();
    if (history.length > 0) {
      $chat.innerHTML = '';
      for (const m of history) {
        const div = document.createElement('div');
        div.className = 'ai-msg ' + m.role;
        div.textContent = m.text;
        $chat.appendChild(div);
      }
    }

    async function send() {
      const text = ($input.value || '').trim();
      if (!text) return;
      $input.value = '';
      $input.style.height = 'auto';

      const u = document.createElement('div');
      u.className = 'ai-msg user'; u.textContent = text;
      $chat.appendChild(u);
      scrollBottom();

      const loading = document.createElement('div');
      loading.className = 'ai-loading';
      loading.innerHTML = '<span>●</span><span>●</span><span>●</span>';
      $chat.appendChild(loading);
      scrollBottom();

      $send.disabled = true;
      const reply = await askAI(text);
      loading.remove();

      const b = document.createElement('div');
      b.className = 'ai-msg ' + (reply.indexOf('❌') === 0 || reply.indexOf('🔧') === 0 ? 'err' : 'bot');
      b.textContent = reply;
      $chat.appendChild(b);
      scrollBottom();

      // 历史
      history.push({ role: 'user', text });
      history.push({ role: 'bot', text: reply });
      saveHistory(history);

      $send.disabled = false;
      $input.focus();
    }

    function scrollBottom() {
      $chat.scrollTop = $chat.scrollHeight;
    }

    $send.addEventListener('click', send);
    $input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });
    // 自动高度
    $input.addEventListener('input', () => {
      $input.style.height = 'auto';
      $input.style.height = Math.min(120, $input.scrollHeight) + 'px';
    });
    $reset.addEventListener('click', () => {
      if (!confirm('清空对话记录？')) return;
      localStorage.removeItem(HISTORY_KEY);
      $chat.innerHTML = '<div class="ai-msg bot">你好呀～有什么可以帮你的吗？</div>';
    });

    return true;
  }

  // ==== 模式二：Drawer 抽屉（index.html shell） ====
  let drawerEl = null, chatEl = null, inputEl = null, sendBtn = null, fabBtn = null, overlayEl = null;
  let drawerOpen = false;

  function setupDrawerMode() {
    if (document.getElementById('ai-drawer')) return false; // 已经注入过
    if (window.top === window.self && document.getElementById('content-frame')) {
      // 仅在 shell 页（index.html）注入 drawer
    } else {
      return false;
    }

    // 注入样式
    const style = document.createElement('style');
    style.textContent = `
      /* AI Drawer 抽屉 */
      .ai-fab {
        position: fixed;
        right: 18px;
        bottom: 96px; /* 避开底部音乐播放器 */
        width: 50px; height: 50px; border-radius: 50%;
        background: #60a5fa; color: #0c0a09;
        border: 0; cursor: pointer;
        box-shadow: 0 4px 14px rgba(96,165,250,0.4);
        font-size: 22px; z-index: 8900;
        display: flex; align-items: center; justify-content: center;
        transition: transform 0.2s;
      }
      .ai-fab:hover { transform: scale(1.08); }
      .ai-fab.is-open { background: #ef4444; box-shadow: 0 4px 14px rgba(239,68,68,0.4); }
      .ai-drawer-overlay {
        position: fixed; inset: 0; background: rgba(0,0,0,0.4);
        z-index: 8950; opacity: 0; pointer-events: none; transition: opacity 0.25s;
      }
      .ai-drawer-overlay.is-open { opacity: 1; pointer-events: auto; }
      .ai-drawer {
        position: fixed; top: 0; right: 0; height: 100%;
        width: 380px; max-width: 92vw;
        background: #0c0a09; color: #fafaf9;
        border-left: 1px solid #292524;
        transform: translateX(100%);
        transition: transform 0.28s cubic-bezier(0.22,1,0.36,1);
        z-index: 9000; display: flex; flex-direction: column;
        box-shadow: -8px 0 24px rgba(0,0,0,0.35);
      }
      .ai-drawer.is-open { transform: translateX(0); }
      .ai-drawer-header {
        padding: 14px 16px; border-bottom: 1px solid #292524;
        display: flex; justify-content: space-between; align-items: center;
        flex-shrink: 0;
      }
      .ai-drawer-title { font-family: 'Noto Serif SC', serif; font-size: 16px; font-weight: 700; }
      .ai-drawer-close { background: transparent; border: 0; color: #a8a29e; font-size: 22px; cursor: pointer; padding: 4px 8px; }
      .ai-drawer-close:hover { color: #fafaf9; }
      .ai-drawer-chat {
        flex: 1; overflow-y: auto; padding: 12px; display: flex;
        flex-direction: column; gap: 8px;
      }
      .ai-drawer-input {
        padding: 10px 12px; border-top: 1px solid #292524; display: flex; gap: 8px; flex-shrink: 0;
      }
      .ai-drawer-input textarea {
        flex: 1; resize: none; padding: 8px 10px; border-radius: 8px; border: 1px solid #292524;
        background: #1c1917; color: #fafaf9; font-size: 13px; line-height: 1.4;
        min-height: 38px; max-height: 100px; font-family: inherit;
      }
      .ai-drawer-input textarea:focus { outline: none; border-color: #60a5fa; }
      .ai-drawer-input button {
        padding: 0 14px; border-radius: 8px; border: 0; background: #60a5fa;
        color: #0c0a09; font-weight: 700; cursor: pointer; white-space: nowrap; font-size: 13px;
      }
      .ai-drawer-input button:disabled { opacity: 0.5; cursor: not-allowed; }
      .ai-drawer-reset { text-align: center; padding: 4px 0 8px; }
      .ai-drawer-reset button {
        background: transparent; border: 1px solid #44403c; color: #78716c;
        padding: 3px 10px; border-radius: 5px; font-size: 11px; cursor: pointer;
      }
      .ai-drawer-reset button:hover { color: #fafaf9; border-color: #78716c; }
      /* 消息样式（复用独立页） */
      .ai-drawer .ai-msg {
        max-width: 85%; padding: 7px 11px; border-radius: 12px;
        font-size: 13px; line-height: 1.45; word-break: break-word; white-space: pre-wrap;
      }
      .ai-drawer .ai-msg.user { align-self: flex-end; background: #60a5fa; color: #0c0a09; border-bottom-right-radius: 4px; }
      .ai-drawer .ai-msg.bot { align-self: flex-start; background: #292524; color: #fafaf9; border-bottom-left-radius: 4px; border: 1px solid #44403c; }
      .ai-drawer .ai-msg.err { align-self: flex-start; background: #7f1d1d; color: #fecaca; border-bottom-left-radius: 4px; }
      .ai-drawer .ai-loading { display: inline-block; padding: 4px 10px; color: #a8a29e; font-size: 12px; }
      .ai-drawer .ai-loading span { display: inline-block; animation: ai-blink 1.2s infinite; }
      .ai-drawer .ai-loading span:nth-child(2) { animation-delay: 0.2s; }
      .ai-drawer .ai-loading span:nth-child(3) { animation-delay: 0.4s; }
      @keyframes ai-blink { 0%, 80%, 100% { opacity: 0.2; } 40% { opacity: 1; } }
      @media (max-width: 768px) {
        .ai-drawer { width: 100%; max-width: 100%; }
        .ai-fab { bottom: 78px; right: 14px; }
      }
    `;
    document.head.appendChild(style);

    // FAB 按钮
    fabBtn = document.createElement('button');
    fabBtn.className = 'ai-fab';
    fabBtn.id = 'ai-fab';
    fabBtn.title = 'Cloudflare AI';
    fabBtn.textContent = '🤖';
    fabBtn.setAttribute('aria-label', '打开 AI 对话');
    document.body.appendChild(fabBtn);

    // Overlay（遮罩）
    overlayEl = document.createElement('div');
    overlayEl.className = 'ai-drawer-overlay';
    overlayEl.id = 'ai-drawer-overlay';
    document.body.appendChild(overlayEl);

    // Drawer
    drawerEl = document.createElement('aside');
    drawerEl.className = 'ai-drawer';
    drawerEl.id = 'ai-drawer';
    drawerEl.innerHTML = `
      <div class="ai-drawer-header">
        <div class="ai-drawer-title">🤖 Cloudflare AI</div>
        <button class="ai-drawer-close" id="ai-drawer-close" title="关闭">×</button>
      </div>
      <div class="ai-drawer-chat" id="ai-drawer-chat"></div>
      <div class="ai-drawer-reset"><button id="ai-drawer-reset">清空对话</button></div>
      <div class="ai-drawer-input">
        <textarea id="ai-drawer-input" placeholder="Enter 发送 / Shift+Enter 换行..." rows="1"></textarea>
        <button id="ai-drawer-send">发送</button>
      </div>
    `;
    document.body.appendChild(drawerEl);

    chatEl = drawerEl.querySelector('#ai-drawer-chat');
    inputEl = drawerEl.querySelector('#ai-drawer-input');
    sendBtn = drawerEl.querySelector('#ai-drawer-send');

    // Worker 状态指示器（插入 header 和 chat 之间）
    const $status = makeStatusEl(drawerEl);
    $status.style.margin = '0';
    $status.style.borderRadius = '0';
    $status.style.borderTop = '1px solid #292524';
    $status.style.borderBottom = '1px solid #292524';
    $status.style.fontSize = '10.5px';
    refreshStatus($status);

    // 恢复历史
    const history = loadHistory();
    if (history.length > 0) {
      chatEl.innerHTML = '';
      for (const m of history) {
        const div = document.createElement('div');
        div.className = 'ai-msg ' + m.role;
        div.textContent = m.text;
        chatEl.appendChild(div);
      }
    } else {
      const div = document.createElement('div');
      div.className = 'ai-msg bot';
      div.textContent = '你好呀～点下方输入框开始对话吧！';
      chatEl.appendChild(div);
    }

    function scrollBottom() { chatEl.scrollTop = chatEl.scrollHeight; }

    function open() {
      drawerOpen = true;
      drawerEl.classList.add('is-open');
      overlayEl.classList.add('is-open');
      fabBtn.classList.add('is-open');
      fabBtn.textContent = '×';
      setTimeout(() => inputEl.focus(), 280);
      scrollBottom();
    }
    function close() {
      drawerOpen = false;
      drawerEl.classList.remove('is-open');
      overlayEl.classList.remove('is-open');
      fabBtn.classList.remove('is-open');
      fabBtn.textContent = '🤖';
    }
    function toggle() { drawerOpen ? close() : open(); }

    fabBtn.addEventListener('click', toggle);
    overlayEl.addEventListener('click', close);
    drawerEl.querySelector('#ai-drawer-close').addEventListener('click', close);
    drawerEl.querySelector('#ai-drawer-reset').addEventListener('click', () => {
      if (!confirm('清空对话记录？')) return;
      localStorage.removeItem(HISTORY_KEY);
      chatEl.innerHTML = '';
      const div = document.createElement('div');
      div.className = 'ai-msg bot'; div.textContent = '对话记录已清空。';
      chatEl.appendChild(div);
    });

    function handleKeydown(e) {
      if (e.key === 'Escape' && drawerOpen) { close(); return; }
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doDrawerSend(); }
    }
    inputEl.addEventListener('keydown', handleKeydown);
    inputEl.addEventListener('input', () => {
      inputEl.style.height = 'auto';
      inputEl.style.height = Math.min(100, inputEl.scrollHeight) + 'px';
    });
    sendBtn.addEventListener('click', doDrawerSend);

    // ESC 关闭
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && drawerOpen && document.activeElement !== inputEl) close();
    });

    let drawerHistory = loadHistory();
    async function doDrawerSend() {
      const text = (inputEl.value || '').trim();
      if (!text) return;
      inputEl.value = '';
      inputEl.style.height = 'auto';

      const u = document.createElement('div');
      u.className = 'ai-msg user'; u.textContent = text;
      chatEl.appendChild(u);
      scrollBottom();

      const loading = document.createElement('div');
      loading.className = 'ai-loading';
      loading.innerHTML = '<span>●</span><span>●</span><span>●</span>';
      chatEl.appendChild(loading);
      scrollBottom();
      sendBtn.disabled = true;

      const reply = await askAI(text);
      loading.remove();

      const b = document.createElement('div');
      b.className = 'ai-msg ' + (reply.indexOf('❌') === 0 || reply.indexOf('🔧') === 0 ? 'err' : 'bot');
      b.textContent = reply;
      chatEl.appendChild(b);
      scrollBottom();

      drawerHistory.push({ role: 'user', text });
      drawerHistory.push({ role: 'bot', text: reply });
      saveHistory(drawerHistory);
      sendBtn.disabled = false;
    }

    return true;
  }

  // ==== 入口 ====
  // 页面加载后判断是独立页还是 shell
  function init() {
    if (document.getElementById('ai-chat')) {
      setupPageMode(); // ai.html 独立页
      return;
    }
    // 尝试 drawer 模式（shell），等到 body 就绪
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', setupDrawerMode);
    } else {
      setupDrawerMode();
    }
  }
  init();
})();
