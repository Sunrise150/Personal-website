// 从当前页面到项目根的相对路径（自动根据 html/root/ 或 html/leaf/ 位置计算）
// root 目录: html/root/index.html → ../../
// leaf 目录: html/leaf/snake.html → ../../
// 根目录旧结构: 直接在根目录 → ''
const ROOT_PREFIX = (function() {
  try {
    const p = location.pathname;
    if (p.indexOf('/html/') !== -1) return '../../';
  } catch (e) {}
  return '';
})();

const SITE_CONFIG = {
  title: '日出的blog',
  description: '发动一些想法，记录一些思考，耍起耍起',
  footer: '© ' + new Date().getFullYear() + ' TruthDesperation团队 · Powered by GitHub Pages',
  // 博客创建日期（用于计算运行天数）
  birth: '2026-10-05',
  // 仓库路径前缀，必须以 / 开头和结尾
  // 如果 Pages 地址是 https://用户名.github.io/仓库名/，这里填 '/仓库名/'
  // 如果 Pages 地址是 https://用户名.github.io/，这里填 '/'
  base: '/Personal-website/'
};