import { api, showToast } from '../utils/api.js';

function fmt(n) { return n != null ? Number(n).toLocaleString('en-GB') : '—'; }

function drawBarChart(container, data, labelKey, valueKey, color = '#0070F2') {
  if (!data || data.length === 0) { container.innerHTML = '<p style="color:#5C6A75;padding:1rem;">No data.</p>'; return; }
  const max = Math.max(...data.map(d => d[valueKey]), 1);
  container.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:0.6rem;padding-top:0.5rem;">
      ${data.slice(0, 8).map(d => `
        <div style="display:flex;align-items:center;gap:0.75rem;">
          <span style="min-width:110px;font-size:0.8rem;color:#1C2B36;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${d[labelKey]}">${d[labelKey]}</span>
          <div style="flex:1;background:#EDEFF2;height:10px;border-radius:5px;overflow:hidden;">
            <div style="width:${(d[valueKey]/max*100).toFixed(1)}%;height:100%;background:${color};border-radius:5px;transition:width 0.6s ease;"></div>
          </div>
          <span style="min-width:36px;font-size:0.8rem;color:#5C6A75;text-align:right;">${d[valueKey]}</span>
        </div>`).join('')}
    </div>`;
}

function drawDonutChart(svgEl, segments) {
  const total = segments.reduce((s, sg) => s + sg.value, 0);
  if (total === 0) { svgEl.innerHTML = '<text x="50" y="55" text-anchor="middle" fill="#5C6A75" font-size="10">No data</text>'; return; }
  const r = 38, cx = 50, cy = 50;
  let startAngle = -Math.PI / 2;
  const paths = segments.map(sg => {
    const angle = (sg.value / total) * 2 * Math.PI;
    const x1 = cx + r * Math.cos(startAngle), y1 = cy + r * Math.sin(startAngle);
    startAngle += angle;
    const x2 = cx + r * Math.cos(startAngle), y2 = cy + r * Math.sin(startAngle);
    const large = angle > Math.PI ? 1 : 0;
    return `<path d="M${cx},${cy} L${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r} 0 ${large} 1 ${x2.toFixed(2)},${y2.toFixed(2)} Z" fill="${sg.color}" opacity="0.85"/>`;
  });
  svgEl.innerHTML = paths.join('') +
    `<circle cx="${cx}" cy="${cy}" r="22" fill="white"/>
     <text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="middle" font-size="9" fill="#1C2B36" font-weight="bold">${total}</text>
     <text x="${cx}" y="${cy + 10}" text-anchor="middle" font-size="6" fill="#5C6A75">items</text>`;
}

function drawLineChart(svgEl, points, color = '#0070F2') {
  if (!points || points.length < 2) { svgEl.innerHTML = '<text x="50%" y="50%" text-anchor="middle" fill="#5C6A75" font-size="10">Insufficient data</text>'; return; }
  const W = 440, H = 180, PAD = 28;
  const vals = points.map(p => p.y);
  const maxV = Math.max(...vals, 1), minV = Math.min(...vals, 0);
  const scaleX = i => PAD + (i / (points.length - 1)) * (W - 2 * PAD);
  const scaleY = v => H - PAD - ((v - minV) / (maxV - minV || 1)) * (H - 2 * PAD);

  const lineD = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${scaleX(i).toFixed(1)},${scaleY(p.y).toFixed(1)}`).join(' ');
  const areaD = lineD + ` L${scaleX(points.length - 1).toFixed(1)},${H - PAD} L${scaleX(0).toFixed(1)},${H - PAD} Z`;
  const circles = points.map((p, i) =>
    `<circle cx="${scaleX(i).toFixed(1)}" cy="${scaleY(p.y).toFixed(1)}" r="4" fill="white" stroke="${color}" stroke-width="2"/>
     <text x="${scaleX(i).toFixed(1)}" y="${H - 10}" text-anchor="middle" fill="#5C6A75" font-size="9">${p.label}</text>`
  ).join('');

  svgEl.innerHTML = `
    <defs><linearGradient id="lineGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${color}" stop-opacity="0.2"/><stop offset="100%" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
    <path d="${areaD}" fill="url(#lineGrad)"/>
    <path d="${lineD}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
    ${circles}`;
}

export function renderAnalytics() {
  const container = document.createElement('div');
  container.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem;">
      <h2 class="page-title" style="margin:0;">Financial Analytics</h2>
      <button class="fiori-btn fiori-btn-transparent" id="analytics-refresh-btn">↺ Refresh</button>
    </div>

    <!-- KPI row -->
    <div class="dashboard-grid" id="analytics-kpi-grid" style="margin-bottom:1.5rem;">
      <div class="fiori-card skeleton-card"></div>
      <div class="fiori-card skeleton-card"></div>
      <div class="fiori-card skeleton-card"></div>
    </div>

    <div class="dashboard-grid-large">
      <!-- Root Cause Bar -->
      <div class="fiori-card">
        <div class="card-header"><h3 class="card-title">Exceptions by Category</h3><p class="card-subtitle">Count and total exposure</p></div>
        <div class="card-content" id="root-cause-chart"><div class="loading-inline">Loading...</div></div>
      </div>

      <!-- By Business Partner -->
      <div class="fiori-card">
        <div class="card-header"><h3 class="card-title">Top Business Partners</h3><p class="card-subtitle">By exception value (£)</p></div>
        <div class="card-content" id="partner-chart"><div class="loading-inline">Loading...</div></div>
      </div>

      <!-- Risk Donut -->
      <div class="fiori-card">
        <div class="card-header"><h3 class="card-title">Risk Level Distribution</h3><p class="card-subtitle">Open exceptions</p></div>
        <div class="card-content" style="display:flex;align-items:center;justify-content:center;gap:2rem;padding-top:1rem;">
          <svg id="risk-donut" viewBox="0 0 100 100" style="width:150px;height:150px;"></svg>
          <div id="risk-legend" style="font-size:0.8rem;display:flex;flex-direction:column;gap:0.5rem;"></div>
        </div>
      </div>

      <!-- Cycle Time trend -->
      <div class="fiori-card">
        <div class="card-header"><h3 class="card-title">Resolution Cycle Time</h3><p class="card-subtitle">Hours to resolve per exception</p></div>
        <div class="card-content" style="padding-top:0.5rem;">
          <svg id="cycle-line-chart" viewBox="0 0 440 180" style="width:100%;height:auto;"></svg>
        </div>
      </div>

      <!-- By Location -->
      <div class="fiori-card" style="grid-column:1/-1;">
        <div class="card-header"><h3 class="card-title">Exceptions by Plant / Location</h3><p class="card-subtitle">Count per plant code</p></div>
        <div class="card-content" id="location-chart"><div class="loading-inline">Loading...</div></div>
      </div>
    </div>
  `;

  loadAnalyticsData(container);
  container.querySelector('#analytics-refresh-btn').addEventListener('click', () => loadAnalyticsData(container));
  return container;
}

async function loadAnalyticsData(container) {
  try {
    const [kpis, analytics] = await Promise.all([
      api.get('/treasury/kpis'),
      api.get('/treasury/analytics'),
    ]);

    // KPI row
    container.querySelector('#analytics-kpi-grid').innerHTML = `
      <div class="fiori-card">
        <div class="card-header"><h3 class="card-title">Recurrence Rate</h3><p class="card-subtitle">Exceptions recurring</p></div>
        <div class="card-content"><div class="kpi-value">${kpis.recurrenceRate}<span class="kpi-unit">%</span></div>
          <div class="kpi-trend ${kpis.recurrenceRate > 10 ? 'negative' : 'positive'}">${kpis.recurrenceRate > 10 ? '↑ High recurrence' : '↓ Good'}</div></div>
      </div>
      <div class="fiori-card">
        <div class="card-header"><h3 class="card-title">First-Pass Yield</h3><p class="card-subtitle">Resolved without recurrence</p></div>
        <div class="card-content"><div class="kpi-value">${kpis.firstPassYield}<span class="kpi-unit">%</span></div>
          <div class="kpi-trend ${kpis.firstPassYield >= 80 ? 'positive' : 'negative'}">${kpis.firstPassYield >= 80 ? '↑ On target' : '↓ Below 80%'}</div></div>
      </div>
      <div class="fiori-card">
        <div class="card-header"><h3 class="card-title">Revenue at Risk</h3><p class="card-subtitle">As % of annual revenue</p></div>
        <div class="card-content"><div class="kpi-value">${kpis.revenueAtRiskPct}<span class="kpi-unit">%</span></div>
          <div class="kpi-trend ${parseFloat(kpis.revenueAtRiskPct) > 1 ? 'negative' : 'positive'}">${parseFloat(kpis.revenueAtRiskPct) > 1 ? 'High exposure' : 'Within tolerance'}</div></div>
      </div>`;

    // Root cause bar
    drawBarChart(
      container.querySelector('#root-cause-chart'),
      analytics.rootCauses, 'category', 'count', '#0070F2'
    );

    // Business partner bar (by value)
    const partnerData = (analytics.byPartner || []).slice(0, 6).map(p => ({ ...p, value: Math.round(p.value) }));
    drawBarChart(container.querySelector('#partner-chart'), partnerData, 'partner', 'value', '#E9730C');

    // Risk donut
    const byRisk = kpis.byRiskLevel || {};
    drawDonutChart(container.querySelector('#risk-donut'), [
      { value: byRisk.Critical || 0, color: '#BB0000' },
      { value: byRisk.High     || 0, color: '#E9730C' },
      { value: byRisk.Medium   || 0, color: '#0070F2' },
      { value: byRisk.Low      || 0, color: '#107E3E' },
    ]);
    container.querySelector('#risk-legend').innerHTML = [
      { label: 'Critical', color: '#BB0000', count: byRisk.Critical || 0 },
      { label: 'High',     color: '#E9730C', count: byRisk.High     || 0 },
      { label: 'Medium',   color: '#0070F2', count: byRisk.Medium   || 0 },
      { label: 'Low',      color: '#107E3E', count: byRisk.Low      || 0 },
    ].map(d => `
      <div style="display:flex;align-items:center;gap:0.5rem;">
        <div style="width:10px;height:10px;border-radius:50%;background:${d.color};"></div>
        <span>${d.label}: <strong>${d.count}</strong></span>
      </div>`).join('');

    // Cycle time line chart
    const cycleData = (analytics.cycleTime || []).slice(0, 12);
    drawLineChart(
      container.querySelector('#cycle-line-chart'),
      cycleData.map((c, i) => ({ label: c.id.slice(-3), y: c.hours })),
      '#0070F2'
    );

    // Location bar
    drawBarChart(container.querySelector('#location-chart'), analytics.byLocation, 'plant', 'count', '#107E3E');

  } catch (err) {
    console.error('Analytics load error:', err);
    showToast('Failed to load analytics. Is the backend running?', 'error');
  }
}
