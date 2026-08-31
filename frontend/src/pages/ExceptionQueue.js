import { api, showToast, showModal } from '../utils/api.js';

// ── Helpers ────────────────────────────────────────────────────────────────────
function fmt(n) { return n != null ? Number(n).toLocaleString('en-GB') : '—'; }

const RISK_COLORS = { Critical: '#BB0000', High: '#E9730C', Medium: '#0070F2', Low: '#107E3E' };
const RISK_CLASSES = { Critical: 'status-error', High: 'status-warning', Medium: 'status-info', Low: 'status-success' };

function riskBadge(level) {
  return `<span class="status-badge ${RISK_CLASSES[level] || 'status-info'}">${level || '—'}</span>`;
}
function slaBadge(breach) {
  return breach
    ? `<span class="status-badge status-error">⚠ Breached</span>`
    : `<span class="status-badge status-success">✓ OK</span>`;
}

// ── Risk Assessment Drawer ─────────────────────────────────────────────────────
async function openRiskAssessment(exceptionId, docId) {
  const modalEl = showModal({
    title: `Risk Assessment — ${docId}`,
    html: `<div class="loading-inline" style="padding:2rem;text-align:center;">Fetching risk data...</div>`,
  });

  try {
    const risk = await api.get(`/treasury/exceptions/${exceptionId}/risk`);
    const body = modalEl.querySelector('.fiori-modal-body');

    body.innerHTML = `
      <!-- Score header -->
      <div class="risk-score-header">
        <div class="risk-gauge" style="border-color:${RISK_COLORS[risk.riskLevel] || '#0070F2'};">
          <span class="risk-gauge-value" style="color:${RISK_COLORS[risk.riskLevel] || '#0070F2'};">${risk.riskScore}</span>
          <span class="risk-gauge-label">/ 100</span>
        </div>
        <div class="risk-meta">
          <div class="risk-level-pill" style="background:${RISK_COLORS[risk.riskLevel]}22;color:${RISK_COLORS[risk.riskLevel]};border:1px solid ${RISK_COLORS[risk.riskLevel]};">${risk.riskLevel}</div>
          <p>Aging: <strong>${risk.agingDays}d</strong></p>
          <p>SLA Deadline: <strong>${risk.slaDeadline ? new Date(risk.slaDeadline).toLocaleString('en-GB') : '—'}</strong></p>
          <p>SLA Breach: ${risk.slaBreach ? '<strong style="color:#BB0000">YES ⚠</strong>' : '<strong style="color:#107E3E">No ✓</strong>'}</p>
          ${risk.hoursOverdue > 0 ? `<p>Hours Overdue: <strong style="color:#BB0000">${risk.hoursOverdue}h</strong></p>` : ''}
        </div>
      </div>

      <!-- Rule Breakdown -->
      <h4 style="margin:1.25rem 0 0.75rem;font-size:0.9rem;text-transform:uppercase;color:#5C6A75;letter-spacing:0.05em;">Rule-Based Scoring Breakdown</h4>
      <div class="risk-rules">
        ${risk.rules.map(r => `
          <div class="risk-rule-row">
            <div class="risk-rule-info">
              <span class="risk-rule-name">${r.rule}</span>
              <span class="risk-rule-weight">${r.weight}</span>
            </div>
            <div class="risk-rule-bar-wrap">
              <div class="risk-rule-bar" style="width:${r.score}%;background:${r.score >= 70 ? '#BB0000' : r.score >= 40 ? '#E9730C' : '#0070F2'};"></div>
            </div>
            <span class="risk-rule-score">${r.score}/100</span>
            <p class="risk-rule-desc">${r.description}</p>
          </div>`).join('')}
      </div>

      <!-- AI Insight -->
      <div class="ai-insight-box">
        <div class="ai-insight-header">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z"/><path d="M12 6v6l4 2"/></svg>
          AI Insight
          <span class="ai-confidence-badge">${Math.round((risk.aiConfidence || 0) * 100)}% confidence</span>
        </div>
        <p class="ai-insight-text">${risk.aiExplanation || 'No AI explanation available.'}</p>
        ${risk.nextBestAction ? `<div class="ai-nba"><strong>Recommended Action:</strong> ${risk.nextBestAction}</div>` : ''}
      </div>

      <!-- Email this exception -->
      <div class="modal-email-section">
        <label style="font-size:0.8rem;color:#5C6A75;display:block;margin-bottom:0.25rem;">Email this exception report to:</label>
        <div style="display:flex;gap:0.5rem;">
          <input class="fiori-input" type="email" id="risk-email-to" placeholder="recipient@company.com" style="flex:1;" />
          <button class="fiori-btn fiori-btn-primary" id="risk-send-email-btn">Send Mail</button>
        </div>
        <div id="email-result" style="margin-top:0.5rem;font-size:0.8rem;"></div>
      </div>
    `;

    // Wire email button
    modalEl.querySelector('#risk-send-email-btn').addEventListener('click', async () => {
      const toEl   = modalEl.querySelector('#risk-email-to');
      const resEl  = modalEl.querySelector('#email-result');
      const to     = toEl.value.trim();
      if (!to) { resEl.textContent = 'Please enter a recipient email.'; return; }

      resEl.textContent = 'Sending...';
      try {
        const result = await api.post('/treasury/mail', {
          to,
          subject: `[Nordwerk Treasury] Exception ${docId} — Risk ${risk.riskLevel} (Score ${risk.riskScore})`,
          exceptionId,
        });
        resEl.innerHTML = result.previewUrl
          ? `✓ Sent! <a href="${result.previewUrl}" target="_blank" style="color:#0070F2;">Preview email ↗</a>`
          : '✓ Email sent successfully.';
        showToast('Email sent successfully!', 'success');
      } catch (e) {
        resEl.textContent = `✕ Failed: ${e?.error?.message || 'Unknown error'}`;
        showToast('Failed to send email.', 'error');
      }
    });

  } catch (err) {
    console.error(err);
    modalEl.querySelector('.fiori-modal-body').innerHTML = `<p style="color:#BB0000;padding:1rem;">Failed to load risk data. Is the backend running?</p>`;
  }
}

// ── Resolve Modal ──────────────────────────────────────────────────────────────
function openResolveModal(exc, onResolved) {
  showModal({
    title: `Resolve Exception — ${exc.documentId || exc.ID}`,
    html: `
      <p style="margin-bottom:1rem;color:#5C6A75;">Provide resolution notes (minimum 10 characters).</p>
      <textarea id="resolve-notes" class="fiori-textarea" placeholder="Describe the resolution steps taken..." rows="4"></textarea>
      <p style="margin-top:0.5rem;font-size:0.75rem;color:#5C6A75;">Resolved By: <strong>CurrentUser</strong></p>
    `,
    confirmLabel: 'Resolve Exception',
    onConfirm: async () => {
      const notes = document.getElementById('resolve-notes')?.value || '';
      if (notes.length < 10) { showToast('Notes must be at least 10 characters.', 'error'); return; }
      try {
        await api.post(`/treasury/exceptions/${exc.ID}/resolve`, { notes, resolvedBy: 'CurrentUser' });
        showToast(`Exception ${exc.documentId} resolved.`, 'success');
        if (onResolved) onResolved();
      } catch (e) {
        showToast(`Failed: ${e?.error?.message || 'Unknown'}`, 'error');
      }
    },
  });
}

// ── Table Row ─────────────────────────────────────────────────────────────────
function buildRow(exc) {
  return `
    <tr data-id="${exc.ID}">
      <td><input type="checkbox" class="row-checkbox" data-id="${exc.ID}" /></td>
      <td><strong>${exc.documentId || exc.ID}</strong></td>
      <td>${exc.documentType || '—'}</td>
      <td>${exc.category || '—'}</td>
      <td>${exc.businessPartner_id || '—'}</td>
      <td>£${fmt(exc.amount)}</td>
      <td>${riskBadge(exc.riskLevel)}</td>
      <td>${exc.agingDays != null ? exc.agingDays + 'd' : '—'}</td>
      <td>${slaBadge(exc.slaBreach)}</td>
      <td>${exc.status || '—'}</td>
      <td>
        <button class="fiori-btn fiori-btn-transparent row-btn-investigate" data-id="${exc.ID}" data-docid="${exc.documentId || exc.ID}" style="height:1.75rem;padding:0 0.5rem;font-size:0.75rem;">
          ⚡ Assess
        </button>
        <button class="fiori-btn row-btn-resolve" data-exc='${JSON.stringify({ ID: exc.ID, documentId: exc.documentId })}' style="height:1.75rem;padding:0 0.5rem;font-size:0.75rem;background:#107E3E;color:white;border-radius:4px;${exc.status === 'Resolved' ? 'opacity:0.4;pointer-events:none;' : ''}">
          ✓ Resolve
        </button>
      </td>
    </tr>`;
}

// ── Email Report Modal ─────────────────────────────────────────────────────────
function openEmailReportModal(total) {
  showModal({
    title: 'Email Exception Report',
    html: `
      <p style="margin-bottom:1rem;color:#5C6A75;">Send the current exception list summary to a recipient.</p>
      <label class="fiori-field-label">Recipient Email</label>
      <input class="fiori-input" type="email" id="report-email-to" placeholder="manager@company.com" style="width:100%;margin-bottom:0.75rem;" />
      <label class="fiori-field-label">Subject (optional)</label>
      <input class="fiori-input" type="text" id="report-email-subject" placeholder="[Nordwerk Treasury] Exception Summary" style="width:100%;margin-bottom:0.5rem;" />
      <p style="font-size:0.75rem;color:#5C6A75;">The email will include a summary of ${total} exception(s).</p>
      <div id="report-email-result" style="margin-top:0.5rem;font-size:0.8rem;"></div>
    `,
    confirmLabel: 'Send Report',
    onConfirm: async (overlay) => {
      const to      = overlay.querySelector('#report-email-to')?.value?.trim();
      const subject = overlay.querySelector('#report-email-subject')?.value?.trim();
      const resEl   = overlay.querySelector('#report-email-result');
      if (!to) { if (resEl) resEl.textContent = 'Recipient required.'; return; }
      try {
        const result = await api.post('/treasury/mail', {
          to,
          subject: subject || '[Nordwerk Treasury] Exception Summary Report',
          body: `Exception Queue Summary\nTotal exceptions: ${total}\nGenerated: ${new Date().toLocaleString('en-GB')}`,
        });
        showToast(result.previewUrl
          ? `Email sent! Open Ethereal to preview.`
          : 'Email sent successfully.', 'success');
        if (result.previewUrl) window.open(result.previewUrl, '_blank');
      } catch (e) {
        showToast(`Mail failed: ${e?.error?.message || 'Unknown'}`, 'error');
      }
    },
  });
}

// ── Main Render ───────────────────────────────────────────────────────────────
export function renderExceptionQueue() {
  const container = document.createElement('div');

  container.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem;flex-wrap:wrap;gap:0.5rem;">
      <h2 class="page-title" style="margin:0;">Exception Queue</h2>
      <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
        <button class="fiori-btn fiori-btn-primary" id="resolve-selected-btn" disabled>✓ Resolve Selected</button>
        <a class="fiori-btn fiori-btn-transparent" id="export-pdf-btn" href="${api.exportPdfUrl()}" target="_blank">⬇ Export PDF</a>
        <button class="fiori-btn fiori-btn-transparent" id="email-report-btn">✉ Email Report</button>
        <button class="fiori-btn fiori-btn-transparent" id="eq-refresh-btn">↺ Refresh</button>
      </div>
    </div>

    <!-- Filters -->
    <div class="fiori-card" style="margin-bottom:1.5rem;">
      <div style="padding:1rem;display:flex;gap:1rem;flex-wrap:wrap;align-items:flex-end;">
        <div style="flex:1;min-width:180px;">
          <label class="fiori-field-label">Status</label>
          <select class="fiori-select" id="filter-status">
            <option value="">All Statuses</option>
            <option>Open</option><option>InProgress</option><option>Escalated</option>
            <option>Resolved</option><option>Closed</option>
          </select>
        </div>
        <div style="flex:1;min-width:180px;">
          <label class="fiori-field-label">Risk Level</label>
          <select class="fiori-select" id="filter-risk">
            <option value="">All Levels</option>
            <option>Critical</option><option>High</option><option>Medium</option><option>Low</option>
          </select>
        </div>
        <div style="flex:1;min-width:180px;">
          <label class="fiori-field-label">Document Type</label>
          <select class="fiori-select" id="filter-doctype">
            <option value="">All Types</option>
            <option>Payment</option><option>Invoice</option><option>PO</option>
            <option>CashFlow</option><option>GoodsReceipt</option><option>Contract</option>
          </select>
        </div>
        <div style="flex:2;min-width:200px;">
          <label class="fiori-field-label">Search</label>
          <input class="fiori-input" type="text" id="filter-search" placeholder="Document ID, partner, category..." />
        </div>
        <button class="fiori-btn fiori-btn-primary" id="apply-filter-btn">Apply</button>
      </div>
    </div>

    <!-- Results summary -->
    <div id="eq-summary" style="margin-bottom:0.75rem;font-size:0.875rem;color:#5C6A75;"></div>

    <!-- Table wrapper -->
    <div class="fiori-table-wrapper" id="eq-table-wrapper">
      <table class="fiori-table">
        <thead>
          <tr>
            <th style="width:40px;"><input type="checkbox" id="select-all-cb" /></th>
            <th>Document ID</th><th>Type</th><th>Category</th><th>Partner</th>
            <th>Amount</th><th>Risk</th><th>Aging</th><th>SLA</th><th>Status</th><th>Actions</th>
          </tr>
        </thead>
        <tbody id="eq-tbody">
          <tr><td colspan="11" style="text-align:center;padding:2rem;color:#5C6A75;">Loading exceptions...</td></tr>
        </tbody>
      </table>
      <div id="eq-pagination" style="padding:0.75rem 1rem;display:flex;justify-content:space-between;align-items:center;border-top:1px solid var(--sapBorderColor);font-size:0.875rem;color:#5C6A75;"></div>
    </div>
  `;

  // State
  let currentFilters = {};
  let currentPage    = 0;
  let totalCount     = 0;
  const PAGE_SIZE    = 15;

  async function loadExceptions() {
    const tbody = container.querySelector('#eq-tbody');
    tbody.innerHTML = `<tr><td colspan="11" style="text-align:center;padding:2rem;color:#5C6A75;">Loading...</td></tr>`;

    const params = new URLSearchParams({
      ...currentFilters,
      $top: PAGE_SIZE,
      $skip: currentPage * PAGE_SIZE,
      sortBy: 'priority',
    });
    // Remove empty values
    for (const [k, v] of [...params.entries()]) { if (!v) params.delete(k); }

    try {
      const data = await api.get(`/treasury/exceptions?${params}`);
      const items = data.value || [];
      totalCount  = data['@odata.count'] || items.length;

      container.querySelector('#eq-summary').textContent =
        `Showing ${currentPage * PAGE_SIZE + 1}–${Math.min((currentPage + 1) * PAGE_SIZE, totalCount)} of ${totalCount} exceptions`;

      // Update PDF export link with same filters
      const pdfBtn = container.querySelector('#export-pdf-btn');
      pdfBtn.href = api.exportPdfUrl(`?${params}`);

      tbody.innerHTML = items.length
        ? items.map(buildRow).join('')
        : `<tr><td colspan="11" style="text-align:center;padding:2rem;color:#5C6A75;">No exceptions match your filters.</td></tr>`;

      // Pagination
      const pag = container.querySelector('#eq-pagination');
      pag.innerHTML = `
        <span>${totalCount} total exceptions</span>
        <div style="display:flex;gap:0.5rem;">
          <button class="fiori-btn fiori-btn-transparent" id="prev-page-btn" ${currentPage === 0 ? 'disabled' : ''}>← Prev</button>
          <span>Page ${currentPage + 1} / ${Math.ceil(totalCount / PAGE_SIZE) || 1}</span>
          <button class="fiori-btn fiori-btn-transparent" id="next-page-btn" ${(currentPage + 1) * PAGE_SIZE >= totalCount ? 'disabled' : ''}>Next →</button>
        </div>`;
      pag.querySelector('#prev-page-btn')?.addEventListener('click', () => { currentPage--; loadExceptions(); });
      pag.querySelector('#next-page-btn')?.addEventListener('click', () => { currentPage++; loadExceptions(); });

      wireRowActions();
    } catch (err) {
      console.error(err);
      tbody.innerHTML = `<tr><td colspan="11" style="text-align:center;padding:2rem;color:#BB0000;">Backend unavailable. Start the backend server on port 4004.</td></tr>`;
    }
  }

  function wireRowActions() {
    // Risk assessment
    container.querySelectorAll('.row-btn-investigate').forEach(btn => {
      btn.addEventListener('click', () => openRiskAssessment(btn.dataset.id, btn.dataset.docid));
    });
    // Resolve
    container.querySelectorAll('.row-btn-resolve').forEach(btn => {
      btn.addEventListener('click', () => {
        const exc = JSON.parse(btn.dataset.exc);
        openResolveModal(exc, loadExceptions);
      });
    });
    // Row checkboxes
    container.querySelectorAll('.row-checkbox').forEach(cb => {
      cb.addEventListener('change', updateResolveBtn);
    });
  }

  function updateResolveBtn() {
    const checked = [...container.querySelectorAll('.row-checkbox:checked')];
    const btn = container.querySelector('#resolve-selected-btn');
    btn.disabled = checked.length === 0;
    btn.textContent = checked.length > 0 ? `✓ Resolve ${checked.length} Selected` : '✓ Resolve Selected';
  }

  // Select all
  container.querySelector('#select-all-cb').addEventListener('change', (e) => {
    container.querySelectorAll('.row-checkbox').forEach(cb => { cb.checked = e.target.checked; });
    updateResolveBtn();
  });

  // Resolve selected
  container.querySelector('#resolve-selected-btn').addEventListener('click', () => {
    const checked = [...container.querySelectorAll('.row-checkbox:checked')];
    const ids = checked.map(cb => cb.dataset.id);
    showModal({
      title: `Resolve ${ids.length} Exception(s)`,
      html: `
        <p style="color:#5C6A75;margin-bottom:1rem;">Provide resolution notes for all ${ids.length} selected exception(s).</p>
        <textarea class="fiori-textarea" id="bulk-resolve-notes" rows="4" placeholder="Bulk resolution reason..."></textarea>`,
      confirmLabel: `Resolve ${ids.length} Items`,
      onConfirm: async () => {
        const notes = document.getElementById('bulk-resolve-notes')?.value || '';
        if (notes.length < 10) { showToast('Notes must be at least 10 characters.', 'error'); return; }
        let resolved = 0;
        for (const id of ids) {
          try { await api.post(`/treasury/exceptions/${id}/resolve`, { notes, resolvedBy: 'CurrentUser' }); resolved++; }
          catch (e) { console.warn('Resolve failed for', id, e); }
        }
        showToast(`${resolved} exception(s) resolved.`, 'success');
        loadExceptions();
      },
    });
  });

  // Email report
  container.querySelector('#email-report-btn').addEventListener('click', () => openEmailReportModal(totalCount));

  // Filters
  container.querySelector('#apply-filter-btn').addEventListener('click', () => {
    currentFilters = {
      status:       container.querySelector('#filter-status').value,
      riskLevel:    container.querySelector('#filter-risk').value,
      documentType: container.querySelector('#filter-doctype').value,
      search:       container.querySelector('#filter-search').value,
    };
    currentPage = 0;
    loadExceptions();
  });

  container.querySelector('#filter-search').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') container.querySelector('#apply-filter-btn').click();
  });

  // Refresh
  container.querySelector('#eq-refresh-btn').addEventListener('click', loadExceptions);

  loadExceptions();
  return container;
}
