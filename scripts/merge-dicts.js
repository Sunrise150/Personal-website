/* ============ 合并词库脚本 ============
 * 将卡拉彼丘词库合并到 extra-dict.json
 * 运行：node scripts/merge-dicts.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const EXTRA = path.join(ROOT, 'words', 'extra-dict.json');
const KLBQ = path.join(ROOT, 'words', 'klbq-dict.json');

// 读取
const extra = JSON.parse(fs.readFileSync(EXTRA, 'utf8'));
const klbq = JSON.parse(fs.readFileSync(KLBQ, 'utf8'));

console.log('合并前 extra:', Object.keys(extra).length);
console.log('卡拉彼丘词库:', Object.keys(klbq).length);

// 合并：extra 的 key 优先（覆盖 klbq），因为 extra 里有精品词条
const merged = Object.assign({}, klbq, extra);

console.log('合并后:', Object.keys(merged).length);

fs.writeFileSync(EXTRA, JSON.stringify(merged, null, 2), 'utf8');
console.log('写入完成！');
