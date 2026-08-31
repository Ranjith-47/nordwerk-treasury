import { api, showToast, setLoading } from '../utils/api.js';

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(n) { return n != null ? Number(n).toLocaleString('en-GB') : '—'; }
function pct(v) { return v != null ? `${v}%` : '—'; }
function riskClass(level) {
  return { Critical: 'status-error', High: 'status-warning', Medium: 'status-info', Low: 'status-success' }[level] || 'status-info';
}

function sparkBar(value, max = 100, color = '#0070F2') {
  const pct = Math.min(100, Math.round((value / max) * 100));
  return `<div class="spark-bar-bg"><div class="spark-bar-fill" style="width:${pct}%;background:${color};"></div></div>`;
}

// ── KPI Card ──────────────────────────────────────────────────────────────────
function kpiCard({ title, subtitle, value, unit, trend, trendClass, icon }) {
  return `
    <div class="fiori-card kpi-card">
      <div class="card-header" style="display:flex;justify-content:space-between;align-items:flex-start;">
        <div>
          <h3 class="card-title">${title}</h3>
          <p class="card-subtitle">${subtitle}</p>
        </div>
        <div class="kpi-icon-bg">${icon}</div>
      </div>
      <div class="card-content">
        <div class="kpi-value">${value}<span class="kpi-unit">${unit}</span></div>
        ${trend ? `<div class="kpi-trend ${trendClass}">${trend}</div>` : ''}
      </div>
    </div>`;
}

// ── Aging Buckets ─────────────────────────────────────────────────────────────
function agingBucket(label, count, total) {
  const pctV = total > 0 ? Math.round((count / total) * 100) : 0;
  return `
    <div class="aging-row">
      <span class="aging-label">${label}</span>
      <div class="aging-bar-wrap">
        <div class="aging-bar" style="width:${pctV}%;"></div>
      </div>
      <span class="aging-count">${count}</span>
    </div>`;
}

// ── Risk Level Bar ────────────────────────────────────────────────────────────
function riskBar(label, count, color, total) {
  const pctV = total > 0 ? Math.round((count / total) * 100) : 0;
  return `
    <div class="aging-row">
      <span class="aging-label" style="color:${color}">${label}</span>
      <div class="aging-bar-wrap">
        <div class="aging-bar" style="width:${pctV}%;background:${color};"></div>
      </div>
      <span class="aging-count">${count}</span>
    </div>`;
}

// ── Main Render ───────────────────────────────────────────────────────────────
export function renderDashboard() {
  const container = document.createElement('div');
  container.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem;">
      <h2 class="page-title" style="margin:0;">Executive Overview</h2>
      <div style="display:flex;align-items:center;gap:0.5rem;">
        <span class="backend-badge" id="backend-status">
          <span class="status-dot"></span> Connecting...
        </span>
        <button class="fiori-btn fiori-btn-transparent" id="dashboard-refresh-btn">↺ Refresh</button>
      </div>
    </div>

    <div class="dashboard-grid" id="kpi-grid">
      <!-- KPIs loaded dynamically -->
      <div class="fiori-card skeleton-card"></div>
      <div class="fiori-card skeleton-card"></div>
      <div class="fiori-card skeleton-card"></div>
      <div class="fiori-card skeleton-card"></div>
    </div>

    <div class="dashboard-grid-large" id="lower-grid">
      <div class="fiori-card">
        <div class="card-header"><h3 class="card-title">Aging Buckets</h3><p class="card-subtitle">Open exceptions by age</p></div>
        <div class="card-content" id="aging-content"><div class="loading-inline">Loading...</div></div>
      </div>
      <div class="fiori-card">
        <div class="card-header"><h3 class="card-title">Risk Distribution</h3><p class="card-subtitle">Open exceptions by severity</p></div>
        <div class="card-content" id="risk-dist-content"><div class="loading-inline">Loading...</div></div>
      </div>
      <div class="fiori-card" style="grid-column: 1/-1;">
        <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;">
          <div><h3 class="card-title">Recent High-Priority Exceptions</h3><p class="card-subtitle">Top items requiring action</p></div>
          <button class="fiori-btn fiori-btn-transparent" id="view-all-btn">View All →</button>
        </div>
        <div class="card-content" style="padding:0;" id="recent-exceptions-content">
          <div style="padding:1.25rem;"><div class="loading-inline">Loading...</div></div>
        </div>
      </div>
    </div>
  `;

  loadDashboardData(container);

  container.querySelector('#dashboard-refresh-btn').addEventListener('click', () => loadDashboardData(container));
  container.querySelector('#view-all-btn')?.addEventListener('click', () => {
    // Trigger navigation to exception queue
    document.querySelector('[data-route="exceptions"]')?.click();
  });

  return container;
}

async function loadDashboardData(container) {
  const statusEl = container.querySelector('#backend-status');
  try {
    const [kpis, exceptions] = await Promise.all([
      api.get('/treasury/kpis'),
      api.get('/treasury/exceptions?$top=5&sortBy=priority'),
    ]);

    // Backend status
    statusEl.innerHTML = `<span class="status-dot dot-success"></span> Live Data`;
    statusEl.classList.add('connected');

    // KPI Grid
    const kpiGrid = container.querySelector('#kpi-grid');
    kpiGrid.innerHTML = [
      kpiCard({ title: 'Total Exceptions', subtitle: 'All time', value: fmt(kpis.exceptionCount), unit: 'Items',
        trend: `${kpis.openCount} open · ${kpis.resolvedCount} resolved`, trendClass: 'neutral',
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>` }),
      kpiCard({ title: 'Total Exposure', subtitle: 'Open items', value: `£${fmt(kpis.totalExposure)}`, unit: '',
        trend: kpis.overdueTotal > 0 ? `£${fmt(kpis.overdueTotal)} overdue` : 'No overdue items', trendClass: kpis.overdueTotal > 0 ? 'negative' : 'positive',
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>` }),
      kpiCard({ title: 'SLA Adherence', subtitle: 'Open exceptions', value: pct(kpis.slaAdherence), unit: '',
        trend: kpis.slaAdherence >= 80 ? '↑ On track' : '↓ Below target (80%)', trendClass: kpis.slaAdherence >= 80 ? 'positive' : 'negative',
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>` }),
      kpiCard({ title: 'Avg. Resolution', subtitle: 'Resolved exceptions', value: kpis.avgResolutionHours != null ? fmt(Math.round(kpis.avgResolutionHours)) : '—', unit: 'hrs',
        trend: kpis.firstPassYield != null ? `${pct(kpis.firstPassYield)} first-pass yield` : '',  trendClass: 'neutral',
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 11.08 22 12 12 22 2 12V2h10"></polyline><polyline points="22 2 12 12 8 8"></polyline></svg>` }),
    ].join('');

    // Aging buckets
    const agingContent = container.querySelector('#aging-content');
    const buckets = kpis.agingBuckets || {};
    const total   = kpis.openCount || 1;
    agingContent.innerHTML = `
      <div class="aging-chart">
        ${agingBucket('0–3 days',   buckets['0-3d']  || 0, total)}
        ${agingBucket('3–7 days',   buckets['3-7d']  || 0, total)}
        ${agingBucket('7–14 days',  buckets['7-14d'] || 0, total)}
        ${agingBucket('> 14 days',  buckets['>14d']  || 0, total)}
      </div>`;

    // Risk distribution
    const riskContent = container.querySelector('#risk-dist-content');
    const byRisk = kpis.byRiskLevel || {};
    riskContent.innerHTML = `
      <div class="aging-chart">
        ${riskBar('Critical', byRisk.Critical || 0, '#BB0000', total)}
        ${riskBar('High',     byRisk.High     || 0, '#E9730C', total)}
        ${riskBar('Medium',   byRisk.Medium   || 0, '#0070F2', total)}
        ${riskBar('Low',      byRisk.Low      || 0, '#107E3E', total)}
      </div>`;

    // Recent exceptions table
    const recentContent = container.querySelector('#recent-exceptions-content');
    const items = (exceptions.value || []).slice(0, 5);
    recentContent.innerHTML = items.length === 0
      ? '<p style="padding:1.25rem;color:#5C6A75;">No exceptions found.</p>'
      : `<table class="fiori-table">
          <thead><tr>
            <th>Document ID</th><th>Type</th><th>Category</th>
            <th>Amount</th><th>Risk</th><th>Status</th>
          </tr></thead>
          <tbody>
            ${items.map(e => `
              <tr>
                <td><strong>${e.documentId || e.ID}</strong></td>
                <td>${e.documentType || '—'}</td>
                <td>${e.category || '—'}</td>
                <td>£${fmt(e.amount)}</td>
                <td><span class="status-badge ${riskClass(e.riskLevel)}">${e.riskLevel || '—'}</span></td>
                <td>${e.status || '—'}</td>
              </tr>`).join('')}
          </tbody>
        </table>`;

  } catch (err) {
    console.error('Dashboard load error:', err);
    statusEl.innerHTML = `<span class="status-dot dot-error"></span> Backend Offline`;
    showToast('Could not connect to backend. Showing cached data.', 'error');
  }
}
