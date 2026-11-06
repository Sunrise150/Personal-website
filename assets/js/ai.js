/* ============ 博客问答机器人（自定义词库 + 大词库 + 文章检索版） ============
 * 三层问答系统（按优先级）：
 *   1. 第一层：自定义词库（data/qa-dict.json）
 *      - 关键词包含匹配 → 返回预设回答
 *      - 用于博客功能介绍（游戏、音乐、写文章等）—— 优先级最高
 *   2. 第二层：大词库匹配（words/可爱系二次元bot词库1.5万词V1.2.json + words/extra-dict.json）
 *      - 精确匹配 / 包含匹配（长 key 优先）→ 随机回答
 *      - 1.2 万词条 + 扩展词库，覆盖日常对话、二次元、闲聊
 *   3. 第三层：博客文章检索
 *      - 加载所有文章 → 关键词打分 → 返回相关文章
 */
(function () {
  const POSTS_JSON = 'data/posts.json?t=' + Date.now();
  const QA_DICT_JSON = 'data/qa-dict.json?t=' + Date.now();
  const BIG_DICT_JSON = 'words/可爱系二次元bot词库1.5万词V1.2.json?t=' + Date.now();
  const EXTRA_DICT_JSON = 'words/extra-dict.json?t=' + Date.now();
  const POSTS_DIR = 'posts/';
  const HISTORY_KEY = 'blog_qa_history';
  const MAX_HISTORY = 30;

  // 缓存
  let postsCache = null;
  let qaDictCache = null;
  let bigDictCache = null;
  let bigDictKeys = null;  // 排序后的 key 数组（最长优先匹配）
  let markdownCache = {};

  // ==== 加载大词库（原词库 + 扩展词库合并） ====
  async function loadBigDict() {
    if (bigDictCache) return bigDictCache;
    try {
      // 并行加载两个词库
      const [res1, res2] = await Promise.all([
        fetch(BIG_DICT_JSON).then(r => r.ok ? r.json() : {}),
        fetch(EXTRA_DICT_JSON).then(r => r.ok ? r.json() : {})
      ]);
      // 合并：扩展词库优先（后加载的覆盖前面的）
      bigDictCache = Object.assign({}, res1, res2);
      // 按 key 长度降序排序（长的优先匹配，避免短 key 误命中）
      bigDictKeys = Object.keys(bigDictCache).sort((a, b) => b.length - a.length);
      return bigDictCache;
    } catch (e) {
      console.error('[BlogQA] 加载大词库失败', e);
      bigDictKeys = [];
      return {};
    }
  }

  // ==== 大词库匹配（精确 + 最长前缀） ====
  function matchBigDict(userMsg, dict) {
    const text = String(userMsg).trim();
    if (!text || !bigDictKeys) return null;
    // 1. 完全相等匹配
    if (dict[text]) {
      const arr = dict[text];
      if (Array.isArray(arr) && arr.length > 0) {
        const valid = arr.filter(s => s && String(s).trim());
        if (valid.length > 0) return valid[Math.floor(Math.random() * valid.length)];
      }
    }
    // 2. 包含匹配（用户消息包含某个 key）—— 长的优先
    for (const key of bigDictKeys) {
      if (key.length < 2) continue;  // 跳过单字 key
      if (text.includes(key)) {
        const arr = dict[key];
        if (Array.isArray(arr) && arr.length > 0) {
          const valid = arr.filter(s => s && String(s).trim());
          if (valid.length > 0) return valid[Math.floor(Math.random() * valid.length)];
        }
      }
    }
    return null;
  }

  // ==== 加载自定义词库 ====
  async function loadQADict() {
    if (qaDictCache) return qaDictCache;
    try {
      const res = await fetch(QA_DICT_JSON);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      qaDictCache = await res.json();
      return qaDictCache;
    } catch (e) {
      console.error('[BlogQA] 加载词库失败', e);
      return [];
    }
  }

  // ==== 加载文章列表 ====
  async function loadPosts() {
    if (postsCache) return postsCache;
    try {
      const res = await fetch(POSTS_JSON);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      postsCache = await res.json();
      return postsCache;
    } catch (e) {
      console.error('[BlogQA] 加载文章列表失败', e);
      return [];
    }
  }

  // ==== 加载单篇文章 markdown ====
  async function loadMarkdown(slug) {
    if (markdownCache[slug]) return markdownCache[slug];
    try {
      const res = await fetch(POSTS_DIR + slug + '.md?t=' + Date.now());
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const text = await res.text();
      const cleaned = text.replace(/^---[\s\S]*?---\n/, '');
      markdownCache[slug] = cleaned;
      return cleaned;
    } catch (e) {
      return '';
    }
  }

  // ==== 简单中文分词（仅用于文章检索） ====
  function tokenize(text) {
    if (!text) return [];
    const lower = String(text).toLowerCase();
    const cleaned = lower.replace(/[^\u4e00-\u9fa5a-z0-9\s]/g, ' ');
    const tokens = [];
    const enWords = cleaned.match(/[a-z][a-z0-9]+/g) || [];
    tokens.push(...enWords.filter(w => w.length > 2));
    const cnChars = cleaned.match(/[\u4e00-\u9fa5]+/g) || [];
    for (const seg of cnChars) {
      for (let i = 0; i < seg.length - 1; i++) {
        tokens.push(seg.substr(i, 2));
      }
      if (seg.length === 1) tokens.push(seg);
    }
    return [...new Set(tokens)];
  }

  // ==== 自定义词库匹配（关键词任一命中） ====
  function matchDict(userMsg, dict) {
    const text = String(userMsg).toLowerCase().trim();
    if (!text) return null;
    for (const item of dict) {
      if (!item.keywords || !Array.isArray(item.keywords)) continue;
      for (const kw of item.keywords) {
        const k = String(kw).toLowerCase();
        if (k && text.includes(k)) return item;
      }
    }
    return null;
  }

  // ==== 给文章打分 ====
  function scorePost(post, keywords) {
    if (!keywords.length) return 0;
    const title = (post.title || '').toLowerCase();
    const excerpt = (post.excerpt || '').toLowerCase();
    const tags = (post.tags || []).join(' ').toLowerCase();
    let score = 0;
    for (const kw of keywords) {
      if (title.includes(kw)) score += 5;
      if (tags.includes(kw)) score += 3;
      if (excerpt.includes(kw)) score += 2;
    }
    return score;
  }

  // ==== 从 markdown 找相关段落 ====
  function findSnippets(markdown, keywords, maxSnippets = 2) {
    if (!markdown) return [];
    const paragraphs = markdown.split(/\n\n+/).filter(p => p.trim().length > 20);
    const scored = paragraphs.map(p => {
      const lower = p.toLowerCase();
      let s = 0;
      for (const kw of keywords) {
        if (lower.includes(kw)) s += 1;
      }
      return { text: p.trim(), score: s };
    }).filter(p => p.score > 0).sort((a, b) => b.score - a.score);
    return scored.slice(0, maxSnippets).map(p => p.text);
  }

  // ==== 主问答函数 ====
  async function askAI(userMsg) {
    const text = String(userMsg).trim();
    if (!text) {
      return { text: '请输入你的问题～', suggestions: [] };
    }

    // === 第一层：自定义词库匹配（博客功能问答，优先级最高） ===
    const dict = await loadQADict();
    if (dict.length > 0) {
      const match = matchDict(text, dict);
      if (match) {
        return {
          text: match.answer || '(空回答)',
          suggestions: Array.isArray(match.suggestions) ? match.suggestions : []
        };
      }
    }

    // === 第二层：大词库匹配（闲聊问答） ===
    const bigDict = await loadBigDict();
    if (bigDict && bigDictKeys && bigDictKeys.length > 0) {
      const reply = matchBigDict(text, bigDict);
      if (reply) {
        return { text: reply, suggestions: [] };
      }
    }

    // === 第三层：文章检索 ===
    const keywords = tokenize(text);
    const posts = await loadPosts();

    if (posts.length === 0) {
      return {
        text: '⚠️ 暂时无法加载博客文章。请稍后再试。',
        suggestions: []
      };
    }

    if (keywords.length === 0) {
      return {
        text: '嗯…我没太理解你的意思呢 (´・ω・`)\n试试问我：「博客有什么内容」「有什么游戏」「怎么写文章」',
        suggestions: ['博客有什么内容', '有什么游戏', '怎么写文章']
      };
    }

    const scored = posts.map(p => ({ ...p, score: scorePost(p, keywords) }));
    const top = scored.filter(p => p.score > 0).sort((a, b) => b.score - a.score).slice(0, 3);

    if (top.length === 0) {
      return {
        text: '唔…我在博客里没找到与「' + text + '」相关的内容呢 (´・ω・`)\n\n也许你可以试试这些常见问题：',
        suggestions: ['博客有什么内容', '有什么游戏', '怎么写文章', '音乐怎么用']
      };
    }

    const results = [];
    for (const p of top) {
      const md = await loadMarkdown(p.slug);
      const snippets = findSnippets(md, keywords, 2);
      results.push({ post: p, snippets });
    }

    let reply = '📚 为你找到 ' + top.length + ' 篇相关文章：\n\n';
    results.forEach((r, i) => {
      const p = r.post;
      reply += '【' + (i + 1) + '】' + p.title + '\n';
      if (p.excerpt) reply += '摘要：' + p.excerpt + '\n';
      reply += '链接：post.html?slug=' + encodeURIComponent(p.slug) + '\n';
      if (r.snippets.length > 0) {
        reply += '相关段落：\n';
        for (const s of r.snippets) {
          const short = s.length > 200 ? s.slice(0, 200) + '...' : s;
          reply += '  > ' + short.replace(/\n/g, '\n  > ') + '\n';
        }
      }
      reply += '\n';
    });
    reply += '💡 点击链接可查看完整文章。';
    return { text: reply, suggestions: [] };
  }

  // ==== 历史记录 ====
  function loadHistory() {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { return []; }
  }
  function saveHistory(arr) {
    if (arr.length > MAX_HISTORY) arr = arr.slice(-MAX_HISTORY);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(arr));
  }

  // ==== 渲染消息（支持建议按钮） ====
  function createMsgEl(role, text, suggestions, onSuggestionClick) {
    const div = document.createElement('div');
    div.className = 'ai-msg ' + role;

    const textDiv = document.createElement('div');
    textDiv.textContent = text;
    div.appendChild(textDiv);

    if (suggestions && suggestions.length > 0 && onSuggestionClick) {
      const sgDiv = document.createElement('div');
      sgDiv.className = 'ai-suggestions';
      sgDiv.style.cssText = 'margin-top:8px;display:flex;flex-wrap:wrap;gap:6px;';
      for (const sg of suggestions) {
        const btn = document.createElement('button');
        btn.className = 'ai-suggestion-btn';
        btn.textContent = sg;
        btn.style.cssText = 'padding:3px 10px;border-radius:12px;border:1px solid #60a5fa;background:rgba(96,165,250,0.15);color:#60a5fa;font-size:12px;cursor:pointer;font-family:inherit;';
        btn.addEventListener('click', () => onSuggestionClick(sg));
        sgDiv.appendChild(btn);
      }
      div.appendChild(sgDiv);
    }
    return div;
  }

  // ==== 状态指示器 ====
  function makeStatusEl(parent) {
    const el = document.createElement('div');
    el.className = 'ai-proxy-status';
    el.style.cssText = 'font-size:11px;color:#78716c;margin-bottom:6px;padding:4px 10px;background:rgba(64,64,64,0.4);border-radius:6px;text-align:center;';
    el.textContent = '🤖 博客问答机器人加载中...';
    parent.prepend ? parent.prepend(el) : (parent.firstChild ? parent.insertBefore(el, parent.firstChild) : parent.appendChild(el));
    return el;
  }
  async function refreshStatus(el) {
    const [bigDict, dict, posts] = await Promise.all([loadBigDict(), loadQADict(), loadPosts()]);
    const bigCount = bigDictKeys ? bigDictKeys.length : 0;
    const dictCount = dict.length;
    const postCount = posts.length;
    if (bigCount > 0 || dictCount > 0 || postCount > 0) {
      el.textContent = '🤖 博客问答就绪 · 大词库 ' + bigCount + ' 条 · 词库 ' + dictCount + ' 条 · 文章 ' + postCount + ' 篇';
      el.style.color = '#86efac'; el.style.background = 'rgba(34,197,94,0.15)';
    } else {
      el.textContent = '⚠️ 无法加载词库和文章';
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

    const $status = makeStatusEl($chat.parentElement);
    refreshStatus($status);

    const history = loadHistory();
    if (history.length > 0) {
      $chat.innerHTML = '';
      for (const m of history) {
        const div = createMsgEl(m.role, m.text, m.suggestions, (sg) => {
          $input.value = sg;
          send();
        });
        $chat.appendChild(div);
      }
    }

    async function send() {
      const text = ($input.value || '').trim();
      if (!text) return;
      $input.value = '';
      $input.style.height = 'auto';

      const u = createMsgEl('user', text);
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

      const b = createMsgEl('bot', reply.text, reply.suggestions, (sg) => {
        $input.value = sg;
        send();
      });
      $chat.appendChild(b);
      scrollBottom();

      history.push({ role: 'user', text });
      history.push({ role: 'bot', text: reply.text, suggestions: reply.suggestions });
      saveHistory(history);

      $send.disabled = false;
      $input.focus();
    }

    function scrollBottom() { $chat.scrollTop = $chat.scrollHeight; }

    $send.addEventListener('click', send);
    $input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });
    $input.addEventListener('input', () => {
      $input.style.height = 'auto';
      $input.style.height = Math.min(120, $input.scrollHeight) + 'px';
    });
    $reset.addEventListener('click', () => {
      if (!confirm('清空对话记录？')) return;
      localStorage.removeItem(HISTORY_KEY);
      $chat.innerHTML = '';
      const div = createMsgEl('bot', '你好呀～问我关于博客内容的任何问题！\n比如：怎么写文章？有什么游戏？', ['博客有什么内容', '有什么游戏'], (sg) => {
        $input.value = sg;
        send();
      });
      $chat.appendChild(div);
    });

    return true;
  }

  // ==== 模式二：Drawer 抽屉（index.html shell） ====
  let drawerEl = null, chatEl = null, inputEl = null, sendBtn = null, fabBtn = null, overlayEl = null;
  let drawerOpen = false;

  function setupDrawerMode() {
    if (document.getElementById('ai-drawer')) return false;
    if (!(window.top === window.self && document.getElementById('content-frame'))) {
      return false;
    }

    const style = document.createElement('style');
    style.textContent = `
      .ai-fab {
        position: fixed; right: 18px; bottom: 96px;
        width: 50px; height: 50px; border-radius: 50%;
        background: #60a5fa; color: #0c0a09; border: 0; cursor: pointer;
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
        display: flex; justify-content: space-between; align-items: center; flex-shrink: 0;
      }
      .ai-drawer-title { font-family: 'Noto Serif SC', serif; font-size: 16px; font-weight: 700; }
      .ai-drawer-close { background: transparent; border: 0; color: #a8a29e; font-size: 22px; cursor: pointer; padding: 4px 8px; }
      .ai-drawer-close:hover { color: #fafaf9; }
      .ai-drawer-chat {
        flex: 1; overflow-y: auto; padding: 12px; display: flex;
        flex-direction: column; gap: 8px;
      }
      .ai-drawer-input { padding: 10px 12px; border-top: 1px solid #292524; display: flex; gap: 8px; flex-shrink: 0; }
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
      .ai-drawer .ai-msg {
        max-width: 85%; padding: 7px 11px; border-radius: 12px;
        font-size: 13px; line-height: 1.45; word-break: break-word; white-space: pre-wrap;
      }
      .ai-drawer .ai-msg.user { align-self: flex-end; background: #60a5fa; color: #0c0a09; border-bottom-right-radius: 4px; }
      .ai-drawer .ai-msg.bot { align-self: flex-start; background: #292524; color: #fafaf9; border-bottom-left-radius: 4px; border: 1px solid #44403c; }
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

    fabBtn = document.createElement('button');
    fabBtn.className = 'ai-fab'; fabBtn.id = 'ai-fab';
    fabBtn.title = '博客问答'; fabBtn.textContent = '🤖';
    fabBtn.setAttribute('aria-label', '打开博客问答');
    document.body.appendChild(fabBtn);

    overlayEl = document.createElement('div');
    overlayEl.className = 'ai-drawer-overlay'; overlayEl.id = 'ai-drawer-overlay';
    document.body.appendChild(overlayEl);

    drawerEl = document.createElement('aside');
    drawerEl.className = 'ai-drawer'; drawerEl.id = 'ai-drawer';
    drawerEl.innerHTML = `
      <div class="ai-drawer-header">
        <div class="ai-drawer-title">🤖 博客问答</div>
        <button class="ai-drawer-close" id="ai-drawer-close" title="关闭">×</button>
      </div>
      <div class="ai-drawer-chat" id="ai-drawer-chat"></div>
      <div class="ai-drawer-reset"><button id="ai-drawer-reset">清空对话</button></div>
      <div class="ai-drawer-input">
        <textarea id="ai-drawer-input" placeholder="问我关于博客的任何问题..." rows="1"></textarea>
        <button id="ai-drawer-send">发送</button>
      </div>
    `;
    document.body.appendChild(drawerEl);

    chatEl = drawerEl.querySelector('#ai-drawer-chat');
    inputEl = drawerEl.querySelector('#ai-drawer-input');
    sendBtn = drawerEl.querySelector('#ai-drawer-send');

    const $status = makeStatusEl(drawerEl);
    $status.style.margin = '0'; $status.style.borderRadius = '0';
    $status.style.borderTop = '1px solid #292524'; $status.style.borderBottom = '1px solid #292524';
    $status.style.fontSize = '10.5px';
    refreshStatus($status);

    const history = loadHistory();
    if (history.length > 0) {
      chatEl.innerHTML = '';
      for (const m of history) {
        const div = createMsgEl(m.role, m.text, m.suggestions, (sg) => {
          inputEl.value = sg;
          doDrawerSend();
        });
        chatEl.appendChild(div);
      }
    } else {
      const div = createMsgEl('bot',
        '你好呀～问我关于博客内容的任何问题！\n比如：怎么写文章？有什么游戏？',
        ['博客有什么内容', '有什么游戏', '怎么写文章'],
        (sg) => { inputEl.value = sg; doDrawerSend(); }
      );
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
      const div = createMsgEl('bot', '对话记录已清空。', ['博客有什么内容'], (sg) => {
        inputEl.value = sg; doDrawerSend();
      });
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
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && drawerOpen && document.activeElement !== inputEl) close();
    });

    let drawerHistory = loadHistory();
    async function doDrawerSend() {
      const text = (inputEl.value || '').trim();
      if (!text) return;
      inputEl.value = '';
      inputEl.style.height = 'auto';

      const u = createMsgEl('user', text);
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

      const b = createMsgEl('bot', reply.text, reply.suggestions, (sg) => {
        inputEl.value = sg;
        doDrawerSend();
      });
      chatEl.appendChild(b);
      scrollBottom();

      drawerHistory.push({ role: 'user', text });
      drawerHistory.push({ role: 'bot', text: reply.text, suggestions: reply.suggestions });
      saveHistory(drawerHistory);
      sendBtn.disabled = false;
    }

    return true;
  }

  // ==== 入口 ====
  function init() {
    if (document.getElementById('ai-chat')) {
      setupPageMode();
      return;
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', setupDrawerMode);
    } else {
      setupDrawerMode();
    }
  }
  init();
})();
