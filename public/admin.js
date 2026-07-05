const tokenInput = document.querySelector('#token');
const searchInput = document.querySelector('#search');
const itemsEl = document.querySelector('#items');
const exportLink = document.querySelector('#exportLink');
const addForm = document.querySelector('#addForm');
const addStatus = document.querySelector('#addStatus');
const locationForm = document.querySelector('#locationForm');
const locationParent = document.querySelector('#locationParent');
const locationStatus = document.querySelector('#locationStatus');
const locationsEl = document.querySelector('#locations');
const roomTabsEl = document.querySelector('#roomTabs');
const activeRoomTitle = document.querySelector('#activeRoomTitle');
const locationCount = document.querySelector('#locationCount');
const reviewPreview = document.querySelector('#reviewPreview');

let locations = [];
let items = [];
let activeRoom = '全部';

tokenInput.value = localStorage.getItem('storage-token') || '';

function headers() {
  const token = tokenInput.value.trim();
  localStorage.setItem('storage-token', token);
  return { 'X-Storage-Token': token, 'Content-Type': 'application/json' };
}

function esc(value) {
  return String(value || '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

function firstSegment(path) {
  return String(path || '').split('/')[0].trim() || '未分区';
}

function shortPath(path) {
  return String(path || '').replace(/\s*\/\s*/g, ' > ');
}

function countItemsInLocation(path) {
  if (!path) return 0;
  return items.filter((item) => String(item.location || '').startsWith(path)).length;
}

function locationIcon(location) {
  const path = location.path || '';
  if (path.includes('抽屉')) return '▤';
  if (path.includes('盒') || path.includes('箱')) return '□';
  if (path.includes('柜')) return '▥';
  if (path.includes('厨房')) return '⌂';
  if (path.includes('卧室')) return '▣';
  return '▧';
}

function filteredLocations() {
  if (activeRoom === '全部') return locations;
  return locations.filter((location) => firstSegment(location.path) === activeRoom);
}

async function loadItems() {
  const q = encodeURIComponent(searchInput.value.trim());
  exportLink.href = '/api/export.csv';
  const res = await fetch(`/api/items?q=${q}`, { headers: headers() });
  if (!res.ok) {
    itemsEl.innerHTML = '<p class="empty-state">无法加载记录，请检查访问令牌。</p>';
    renderReviewPreview();
    return;
  }
  const data = await res.json();
  items = data.items || [];
  renderItems();
  renderReviewPreview();
  renderLocations();
}

async function loadLocations() {
  const res = await fetch('/api/locations', { headers: headers() });
  if (!res.ok) {
    locationsEl.innerHTML = '<p class="empty-state">无法加载常用位置，请检查访问令牌。</p>';
    return;
  }
  const data = await res.json();
  locations = data.locations || [];
  renderLocationOptions();
  renderRoomTabs();
  renderLocations();
}

function renderReviewPreview() {
  const latest = items[0];
  if (!latest) {
    reviewPreview.innerHTML = `
      <div class="review-quote"><span class="quote-mark">“</span><span>修正后：<strong>把可乐放在客厅抽屉</strong></span></div>
      <div class="review-line"><span class="mini-icon">□</span><span>物品：可乐</span></div>
      <div class="review-line"><span class="mini-icon">⌖</span><span>位置：客厅 &gt; 电视柜 &gt; 左侧抽屉</span></div>
    `;
    return;
  }
  const corrected = latest.correctedText || latest.rawText || latest.displayName;
  reviewPreview.innerHTML = `
    <div class="review-quote"><span class="quote-mark">“</span><span>修正后：<strong>${esc(corrected)}</strong></span></div>
    <div class="review-line"><span class="mini-icon">□</span><span>物品：${esc(latest.displayName)}</span></div>
    <div class="review-line"><span class="mini-icon">⌖</span><span>位置：${esc(shortPath(latest.location || '未记录'))}</span></div>
  `;
}

function renderItems() {
  const content = items.map((item) => `
    <article class="item">
      <div class="item-head">
        <div>
          <h2>${esc(item.displayName)}</h2>
          <p class="muted">${esc(item.category)} · ${esc(item.zone || '未标记区域')}</p>
        </div>
        <span class="count-pill">${Math.round(Number(item.confidence || 0) * 10) || 1}</span>
      </div>
      <div class="item-location">${esc(shortPath(item.location || '未记录'))}</div>
      ${item.correctedText && item.correctedText !== item.rawText ? `<p class="muted">语音修正：${esc(item.correctedText)}</p>` : ''}
      <p class="muted">${esc(item.description || item.rawText || '暂无备注')}</p>
      <div class="tags">${(item.tags || []).map((tag) => `<span class="tag">${esc(tag)}</span>`).join('')}</div>
      <div class="item-actions">
        <button class="small-button" data-edit="${esc(item.id)}">修改位置</button>
        <button class="small-button danger-button" data-delete="${esc(item.id)}">删除</button>
      </div>
    </article>
  `).join('');
  itemsEl.innerHTML = `<h2 class="section-label">最近记忆</h2>${content || '<p class="empty-state">还没有记录。</p>'}`;
}

function renderLocationOptions() {
  locationParent.innerHTML = [
    '<option value="">顶层位置</option>',
    ...locations.map((location) => `<option value="${esc(location.id)}">${esc(location.path)}</option>`)
  ].join('');
}

function renderRoomTabs() {
  const rooms = ['全部', ...new Set(locations.map((location) => firstSegment(location.path)))];
  if (!rooms.includes(activeRoom)) activeRoom = '全部';
  roomTabsEl.innerHTML = [
    ...rooms.map((room) => `<button class="room-tab ${room === activeRoom ? 'active' : ''}" type="button" data-room="${esc(room)}">${esc(room)}</button>`),
    '<button class="room-tab" type="button" data-jump="#locationForm">＋ 添加</button>'
  ].join('');
}

function renderLocations() {
  const rows = filteredLocations();
  activeRoomTitle.textContent = activeRoom === '全部' ? '全部位置' : activeRoom;
  locationCount.textContent = `${rows.length} 个位置`;
  locationsEl.innerHTML = rows.map((location, index) => {
    const aliases = (location.aliases || []).join('、');
    return `
      <div class="location-row ${index === 1 ? 'featured' : ''}">
        <div class="location-main">
          <span class="location-emoji">${esc(locationIcon(location))}</span>
          <div class="location-text">
            <div class="location-path">${esc(shortPath(location.path))}</div>
            <div class="location-alias">${aliases ? `别名：${esc(aliases)}` : '别名：未设置'}</div>
          </div>
        </div>
        <div class="location-meta">
          <span class="count-pill">${countItemsInLocation(location.path)}</span>
          <button class="archive-button" data-archive-location="${esc(location.id)}" aria-label="归档 ${esc(location.path)}">⋮</button>
        </div>
      </div>
    `;
  }).join('') || '<p class="empty-state">还没有常用位置。</p>';
}

function jumpTo(selector) {
  const target = document.querySelector(selector);
  if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

itemsEl.addEventListener('click', async (event) => {
  const editId = event.target.dataset.edit;
  const deleteId = event.target.dataset.delete;
  if (editId) {
    const location = prompt('新的位置');
    if (!location) return;
    await fetch(`/api/items/${editId}`, {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify({ location, locationId: null })
    });
    loadItems();
  }
  if (deleteId && confirm('确定删除这条记录吗？')) {
    await fetch(`/api/items/${deleteId}`, { method: 'DELETE', headers: headers() });
    loadItems();
  }
});

locationsEl.addEventListener('click', async (event) => {
  const id = event.target.dataset.archiveLocation;
  if (!id || !confirm('确定归档这个位置吗？已有记忆不会被删除。')) return;
  await fetch(`/api/locations/${id}`, { method: 'DELETE', headers: headers() });
  loadLocations();
});

roomTabsEl.addEventListener('click', (event) => {
  const room = event.target.dataset.room;
  const jump = event.target.dataset.jump;
  if (room) {
    activeRoom = room;
    renderRoomTabs();
    renderLocations();
  }
  if (jump) jumpTo(jump);
});

document.addEventListener('click', (event) => {
  const jump = event.target.closest('[data-jump]')?.dataset.jump;
  if (!jump) return;
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.jump === jump);
  });
  jumpTo(jump);
});

tokenInput.addEventListener('change', () => {
  loadItems();
  loadLocations();
});

searchInput.addEventListener('input', () => {
  clearTimeout(window.searchTimer);
  window.searchTimer = setTimeout(loadItems, 200);
});

addForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  addStatus.textContent = '保存中...';
  const form = new FormData(addForm);
  const tags = String(form.get('tags') || '')
    .split(/[,，]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
  const res = await fetch('/api/items', {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      displayName: form.get('displayName'),
      location: form.get('location'),
      description: form.get('description'),
      tags
    })
  });
  if (!res.ok) {
    addStatus.textContent = '保存失败，请检查访问令牌和必填项。';
    return;
  }
  addForm.reset();
  addStatus.textContent = '已保存。';
  loadItems();
});

locationForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  locationStatus.textContent = '保存中...';
  const form = new FormData(locationForm);
  const aliases = String(form.get('aliases') || '')
    .split(/[,，]/)
    .map((alias) => alias.trim())
    .filter(Boolean);
  const res = await fetch('/api/locations', {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      name: form.get('name'),
      parentId: form.get('parentId') || null,
      aliases
    })
  });
  if (!res.ok) {
    locationStatus.textContent = '保存失败，可能是名称重复或访问令牌不正确。';
    return;
  }
  locationForm.reset();
  locationStatus.textContent = '已保存位置。';
  loadLocations();
});

renderReviewPreview();
loadItems();
loadLocations();
