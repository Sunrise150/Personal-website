/* ============ 站点统计 + 深色/浅色切换 ============
 * 功能：
 *   1. 运行天数计数器
 *   2. 不蒜子访问计数（busuanzi）
 *   3. 深色/浅色主题切换（localStorage 持久化）
 */
(function () {
  // ============ 1. 运行天数 ============
  function initSiteDays() {
    const el = document.getElementById('site-days');
    if (!el) return;
    const birth = (SITE_CONFIG && SITE_CONFIG.birth) || '2024-01-01';
    const b = new Date(birth);
    const now = new Date();
    const days = Math.floor((now - b) / 86400000);
    el.textContent = days >= 0 ? days + ' 天' : '即将上线';
  }

  // ============ 2. 不蒜子访问计数 ============
  function initBusuanzi() {
    // 只在 index.html（shell 页）加载，避免 iframe 页面重复加载
    if (window.top !== window.self) return;
    if (document.getElementById('busuanzi_value_site_pv')) {
      const s = document.createElement('script');
      s.src = '//busuanzi.ibruce.info/busuanzi/2.3/busuanzi.pure.mini.js';
      s.async = true;
      document.head.appendChild(s);
    }
  }

  // ============ 3. 深色/浅色主题 ============
  const THEME_KEY = 'blog-theme';

  function applyTheme(theme) {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('theme-dark');
      root.classList.remove('theme-light');
    } else if (theme === 'light') {
      root.classList.add('theme-light');
      root.classList.remove('theme-dark');
    } else {
      // auto - 跟随系统
      root.classList.remove('theme-dark', 'theme-light');
    }
    try { localStorage.setItem(THEME_KEY, theme); } catch (e) {}
  }

  function initTheme() {
    // 只在 shell 页（index.html）初始化主题按钮
    if (window.top !== window.self) return;
    const saved = (function () { try { return localStorage.getItem(THEME_KEY) || 'auto'; } catch (e) { return 'auto'; } })();
    applyTheme(saved);

    const btn = document.getElementById('theme-toggle');
    if (btn) {
      const icon = btn.querySelector('.theme-icon');
      const updateIcon = () => {
        const t = document.documentElement.classList.contains('theme-dark') ? 'dark' :
                  document.documentElement.classList.contains('theme-light') ? 'light' : 'auto';
        if (icon) icon.textContent = t === 'dark' ? '☀️' : t === 'light' ? '🌙' : '🌓';
        btn.title = t === 'dark' ? '切换到浅色' : t === 'light' ? '切换到跟随系统' : '切换到深色';
      };
      // 三态循环：auto → light → dark → auto
      btn.addEventListener('click', () => {
        const cur = (function () { try { return localStorage.getItem(THEME_KEY) || 'auto'; } catch (e) { return 'auto'; } })();
        const next = cur === 'auto' ? 'light' : cur === 'light' ? 'dark' : 'auto';
        applyTheme(next);
        updateIcon();
      });
      updateIcon();
    }

    // 监听系统主题变化（auto 模式下实时切换）
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      try {
        if (localStorage.getItem(THEME_KEY) === 'auto') {
          applyTheme('auto');
        }
      } catch (e) {}
    });
  }

  // ============ 执行 ============
  document.addEventListener('DOMContentLoaded', () => {
    initSiteDays();
    initBusuanzi();
    initTheme();
  });
})();
