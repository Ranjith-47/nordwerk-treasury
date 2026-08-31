// ── API Client ────────────────────────────────────────────────────────────────
const API_BASE = 'http://localhost:4004/api';

export const api = {
  async get(path) {
    const res = await fetch(`${API_BASE}${path}`);
    if (!res.ok) throw new Error(`API Error ${res.status}: ${path}`);
    return res.json();
  },
  async post(path, body) {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw data;
    return data;
  },
  async patch(path, body) {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw data;
    return data;
  },
  exportPdfUrl(query = '') {
    return `${API_BASE}/treasury/export/pdf${query}`;
  },
};

// ── Toast Notification ────────────────────────────────────────────────────────
export function showToast(message, type = 'success') {
  const existing = document.getElementById('fiori-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'fiori-toast';
  toast.className = `fiori-toast fiori-toast-${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ'}</span>
    <span>${message}</span>
  `;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('visible'));
  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ── Modal ─────────────────────────────────────────────────────────────────────
export function showModal({ title, html, onConfirm, confirmLabel = 'Confirm' }) {
  const existing = document.getElementById('fiori-modal-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'fiori-modal-overlay';
  overlay.className = 'fiori-modal-overlay';
  overlay.innerHTML = `
    <div class="fiori-modal" role="dialog" aria-modal="true">
      <div class="fiori-modal-header">
        <h3 class="fiori-modal-title">${title}</h3>
        <button class="fiori-modal-close" id="modal-close-btn" aria-label="Close">✕</button>
      </div>
      <div class="fiori-modal-body">${html}</div>
      <div class="fiori-modal-footer">
        <button class="fiori-btn fiori-btn-transparent" id="modal-cancel-btn">Cancel</button>
        ${onConfirm ? `<button class="fiori-btn fiori-btn-primary" id="modal-confirm-btn">${confirmLabel}</button>` : ''}
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('visible'));

  const close = () => {
    overlay.classList.remove('visible');
    setTimeout(() => overlay.remove(), 250);
  };

  overlay.querySelector('#modal-close-btn').addEventListener('click', close);
  overlay.querySelector('#modal-cancel-btn').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  if (onConfirm) {
    overlay.querySelector('#modal-confirm-btn').addEventListener('click', () => {
      onConfirm(overlay);
      close();
    });
  }

  return overlay;
}

// ── Loading State Helper ───────────────────────────────────────────────────────
export function setLoading(container, isLoading, message = 'Loading...') {
  const existing = container.querySelector('.loading-overlay');
  if (isLoading && !existing) {
    const el = document.createElement('div');
    el.className = 'loading-overlay';
    el.innerHTML = `<div class="loading-spinner"></div><span>${message}</span>`;
    container.style.position = 'relative';
    container.appendChild(el);
  } else if (!isLoading && existing) {
    existing.remove();
  }
}
