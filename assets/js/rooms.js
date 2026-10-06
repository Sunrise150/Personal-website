function applyConfig() {
  document.getElementById('site-title').textContent = SITE_CONFIG.title;
  document.getElementById('footer-text').textContent = SITE_CONFIG.footer;
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str).replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));
}

/**
 * 排序权重：
 *   0 = CN1（置顶）
 *   1 = CN2
 *   2 = 普通房间
 *   3 = 无法获取（置底）
 */
function rankOf(room) {
  if (!room || room.name === '无法获取') return 3;
  const n = (room.name || '').toUpperCase().replace(/\s+/g, '');
  if (n.includes('[CN1]')) return 0;
  if (n.includes('[CN2]')) return 1;
  return 2;
}

function sortRooms(rooms) {
  return rooms.slice().sort((a, b) => {
    const ra = rankOf(a);
    const rb = rankOf(b);
    if (ra !== rb) return ra - rb;
    // 同一档内：先按在线人数降序，再按名字
    const oa = a.online || 0;
    const ob = b.online || 0;
    if (oa !== ob) return ob - oa;
    return (a.name || '').localeCompare(b.name || '');
  });
}

function formatTime(iso) {
  if (!iso) return '尚未更新';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString('zh-CN', { hour12: false });
  } catch {
    return iso;
  }
}

function escapeAttr(v) {
  return escapeHtml(v);
}

async function loadRooms() {
  const tbody = document.getElementById('rooms-body');
  const summary = document.getElementById('rooms-summary');
  const hint = document.getElementById('rooms-footer-hint');

  try {
    const res = await fetch('data/rooms.json?t=' + Date.now());
    if (!res.ok) throw new Error('无法加载房间数据 (' + res.status + ')');

    const data = await res.json();
    const rooms = Array.isArray(data.rooms) ? data.rooms : [];
    const sorted = sortRooms(rooms);

    if (!sorted.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="rooms-loading">暂无房间数据，请稍后再试</td></tr>';
      summary.innerHTML = '<span class="rooms-stat">暂无数据</span>';
      hint.textContent = '';
      return;
    }

    tbody.innerHTML = sorted.map((r, i) => {
      const isUnknown = r.name === '无法获取';
      const countText = isUnknown ? '0/0' : `${r.online}/${r.capacity}`;
      return `<tr class="${isUnknown ? 'room-unknown' : ''}">
        <td class="col-idx">${i + 1}</td>
        <td class="col-ip">${escapeHtml(r.ip)}</td>
        <td class="col-port">${escapeHtml(r.port)}</td>
        <td class="col-count">${countText}</td>
        <td class="col-name">${escapeHtml(r.name)}</td>
      </tr>`;
    }).join('');

    const active = (data.activeRooms != null) ? data.activeRooms : sorted.filter(r => r.name !== '无法获取').length;
    const total = (data.totalPlayers != null) ? data.totalPlayers : 0;

    summary.innerHTML = `
      <span class="rooms-stat">活跃房间：<strong>${active}</strong></span>
      <span class="rooms-stat">全服总人数：<strong>${total}</strong></span>
      <span class="rooms-stat rooms-stat-time">更新于 ${formatTime(data.updatedAt)}</span>
    `;
    hint.textContent = '每 5 分钟自动更新一次';
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="5" class="rooms-loading">加载失败：${escapeHtml(e.message)}</td></tr>`;
    summary.innerHTML = '<span class="rooms-stat">加载失败</span>';
    hint.textContent = '';
  }
}

applyConfig();
loadRooms();

// 刷新按钮
const refreshBtn = document.getElementById('rooms-refresh');
if (refreshBtn) {
  refreshBtn.addEventListener('click', () => {
    refreshBtn.classList.add('spinning');
    loadRooms().finally(() => {
      setTimeout(() => refreshBtn.classList.remove('spinning'), 600);
    });
  });
}

// 页面可见时每 60 秒重新拉一次（配合 Actions 每 5 分钟更新一次）
setInterval(() => {
  if (!document.hidden) loadRooms();
}, 60 * 1000);