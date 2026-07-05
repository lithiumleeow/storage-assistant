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

let locations = [];

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

async function loadItems() {
  const q = encodeURIComponent(searchInput.value.trim());
  exportLink.href = '/api/export.csv';
  const res = await fetch(`/api/items?q=${q}`, { headers: headers() });
  if (!res.ok) {
    itemsEl.innerHTML = '<p class="meta">无法加载记录，请检查访问令牌。</p>';
    return;
  }
  const data = await res.json();
  itemsEl.innerHTML = data.items.map((item) => `
    <article class="item">
      <h2>${esc(item.displayName)}</h2>
      <div class="meta">${esc(item.category)} · ${esc(item.zone || '未标记区域')}</div>
      <div><strong>位置：</strong>${esc(item.location || '未记录')}</div>
      ${item.correctedText && item.correctedText !== item.rawText ? `<div><strong>语音修正：</strong>${esc(item.correctedText)}</div>` : ''}
      ${item.locationMatchStatus ? `<div class="meta">位置匹配：${esc(item.locationMatchStatus)}</div>` : ''}
      <div><strong>描述：</strong>${esc(item.description || item.rawText)}</div>
      <div class="tags">${(item.tags || []).map((tag) => `<span class="tag">${esc(tag)}</span>`).join('')}</div>
      <div class="actions">
        <button data-edit="${esc(item.id)}">修改位置</button>
        <button data-delete="${esc(item.id)}">删除</button>
      </div>
    </article>
  `).join('') || '<p class="meta">还没有记录。</p>';
}

async function loadLocations() {
  const res = await fetch('/api/locations', { headers: headers() });
  if (!res.ok) {
    locationsEl.innerHTML = '<p class="meta">无法加载常用位置，请检查访问令牌。</p>';
    return;
  }
  const data = await res.json();
  locations = data.locations || [];
  renderLocationOptions();
  renderLocations();
}

function renderLocationOptions() {
  locationParent.innerHTML = [
    '<option value="">顶层位置</option>',
    ...locations.map((location) => `<option value="${esc(location.id)}">${esc(location.path)}</option>`)
  ].join('');
}

function renderLocations() {
  locationsEl.innerHTML = locations.map((location) => `
    <div class="location-row">
      <div>
        <strong>${esc(location.path)}</strong>
        ${(location.aliases || []).length ? `<div class="meta">别名：${location.aliases.map(esc).join('，')}</div>` : ''}
      </div>
      <button data-archive-location="${esc(location.id)}">归档</button>
    </div>
  `).join('') || '<p class="meta">还没有常用位置。</p>';
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

loadItems();
loadLocations();
