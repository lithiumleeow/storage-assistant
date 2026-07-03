const tokenInput = document.querySelector('#token');
const searchInput = document.querySelector('#search');
const itemsEl = document.querySelector('#items');
const exportLink = document.querySelector('#exportLink');

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
      <div><strong>描述：</strong>${esc(item.description || item.rawText)}</div>
      <div class="tags">${(item.tags || []).map((tag) => `<span class="tag">${esc(tag)}</span>`).join('')}</div>
      <div class="actions">
        <button data-edit="${esc(item.id)}">修改位置</button>
        <button data-delete="${esc(item.id)}">删除</button>
      </div>
    </article>
  `).join('') || '<p class="meta">还没有记录。</p>';
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
      body: JSON.stringify({ location })
    });
    loadItems();
  }
  if (deleteId && confirm('确定删除这条记录吗？')) {
    await fetch(`/api/items/${deleteId}`, { method: 'DELETE', headers: headers() });
    loadItems();
  }
});

tokenInput.addEventListener('change', loadItems);
searchInput.addEventListener('input', () => {
  clearTimeout(window.searchTimer);
  window.searchTimer = setTimeout(loadItems, 200);
});

loadItems();
