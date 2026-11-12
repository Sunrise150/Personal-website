/* ============ 站点统计 + 深色/浅色切换 ============ */
(function () {
  // ============ 1. 运行天数 ============
  function initSiteDays() {
    const el = document.getElementById('site-days');
    if (!el) return;
    const birth = (SITE_CONFIG && SITE_CONFIG.birth) || '2024-01-01';
    const b = new Date(birth);
    const days = Math.floor((new Date() - b) / 86400000);
    el.textContent = days >= 0 ? days + ' 天' : '即将上线';
  }

  // ============ 2. 不蒜子访问计数 ============
  function initBusuanzi() {
    if (window.top !== window.self) return;
    if (document.getElementById('busuanzi_value_site_pv')) {
      const s = document.createElement('script');
      s.src = '//busuanzi.ibruce.info/busuanzi/2.3/busuanzi.pure.mini.js';
      s.async = true;
      document.head.appendChild(s);
    }
  }

  // ============ 3. 主题切换（默认浅色，localStorage 存储） ============
  const THEME_KEY = 'blog-theme';

  function applyTheme(theme) {
    const root = document.documentElement;
    if (theme === 'auto') {
      root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', theme);
    }
    try { localStorage.setItem(THEME_KEY, theme); } catch (e) {}
  }

  function readTheme() {
    try {
      const v = localStorage.getItem(THEME_KEY);
      if (v === 'light' || v === 'dark' || v === 'auto') return v;
    } catch (e) {}
    return 'light'; // 默认浅色
  }

  function initTheme() {
    // 立即应用（避免白屏闪烁）
    applyTheme(readTheme());

    // shell 页：初始化按钮 + iframe 联动
    if (window.top === window.self) {
      const btn = document.getElementById('theme-toggle');
      if (btn) {
        const icon = btn.querySelector('.theme-icon');
        const updateIcon = () => {
          const t = document.documentElement.getAttribute('data-theme') || 'auto';
          if (icon) icon.textContent = t === 'dark' ? '☀️' : t === 'light' ? '🌙' : '🌓';
          btn.title = t === 'dark' ? '切换到浅色' : t === 'light' ? '切换到跟随系统' : '切换到深色';
        };

        // 同步 iframe 当前主题
        function syncIframeTheme() {
          const frame = document.getElementById('content-frame');
          if (!frame) return;
          try {
            const frameDoc = frame.contentDocument;
            if (!frameDoc) return;
            const cur = readTheme();
            if (cur === 'auto') {
              frameDoc.documentElement.removeAttribute('data-theme');
            } else {
              frameDoc.documentElement.setAttribute('data-theme', cur);
            }
          } catch (e) {}
        }

        // iframe 每次加载新页面时也同步一次
        const frame = document.getElementById('content-frame');
        if (frame) {
          frame.addEventListener('load', syncIframeTheme);
        }

        // 三态：light → dark → auto → light
        btn.addEventListener('click', () => {
          const cur = readTheme();
          const next = cur === 'light' ? 'dark' : cur === 'dark' ? 'auto' : 'light';
          applyTheme(next);
          updateIcon();
          syncIframeTheme();
        });
        updateIcon();

        // 立即同步一次
        syncIframeTheme();
      }

      // 系统主题变化（auto 模式）
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (readTheme() === 'auto') {
          applyTheme('auto');
          // 同步 iframe
          const frame = document.getElementById('content-frame');
          if (frame) {
            try { frame.contentDocument?.documentElement?.removeAttribute('data-theme'); } catch(e) {}
          }
        }
      });
    }

    // iframe 内子页面：监听 storage 事件同步
    window.addEventListener('storage', (e) => {
      if (e.key === THEME_KEY) {
        applyTheme(e.newValue || 'light');
      }
    });
  }

  // 尽早执行主题初始化（在 DOMContentLoaded 之前，避免闪烁）
  initTheme();

  document.addEventListener('DOMContentLoaded', () => {
    initSiteDays();
    initBusuanzi();
  });
})();
