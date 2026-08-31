'use strict';

const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');
const path       = require('path');
const { v4: uuidv4 } = require('uuid');

const { validate, validatePatch }     = require('./handlers/validation');
const { calculateRisk, scoreAndRank, portfolioKPIs } = require('./handlers/risk-engine');
const { analyse }                     = require('./handlers/ai-explainer');
const { errorHandler, sapCallWithFallback } = require('./middleware/error-handler');
const { buildAuditEntry }             = require('./middleware/audit');
const seedData                        = require('../db/seed-data/exceptions.json');

const app  = express();
const PORT = process.env.PORT || 4004;

// ─── SECURITY & PARSING ─────────────────────────────────────────────────────

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || '*' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const apiLimiter = rateLimit({ windowMs: 60_000, max: 200, standardHeaders: true, legacyHeaders: false });
app.use('/api/', apiLimiter);

// Request ID
app.use((req, _res, next) => {
  req.id = req.headers['x-request-id'] || uuidv4();
  next();
});

// ─── IN-MEMORY STORE (replaces HANA in demo mode) ───────────────────────────

let store = { exceptions: [], auditLog: [], resolutionLog: [], timeline: [], notifications: [] };

function initStore() {
  const now = new Date();
  store.exceptions = seedData.map(raw => {
    const raisedAt = raw.raisedAt || now.toISOString();
    const enriched = {
      ...raw,
      raisedAt,
      missingFields: '',
      recurrenceCount: raw.recurrenceCount || 0,
      validationPassed: false,
      aiExplanation: null,
      aiConfidence: null,
      nextBestAction: null,
    };

    // Run validation
    const valResult  = validate(enriched);
    enriched.validationPassed = valResult.valid;
    enriched.missingFields    = valResult.missingFields;

    // Run risk scoring
    const risk = calculateRisk({ ...enriched, missingFields: valResult.missingFields });
    Object.assign(enriched, risk);

    // Run AI analysis
    const ai = analyse(enriched);
    enriched.aiExplanation  = ai.explanation;
    enriched.aiConfidence   = ai.confidence;
    enriched.nextBestAction = ai.topAction ? ai.topAction.label : null;
    enriched.nbaCategory    = ai.topAction ? ai.topAction.category : null;

    return enriched;
  });
}

initStore();

// ─── HELPER ──────────────────────────────────────────────────────────────────

function findException(id) {
  return store.exceptions.find(e => e.ID === id || e.documentId === id);
}

function applyFilters(exceptions, query) {
  let result = [...exceptions];
  if (query.companyCode)    result = result.filter(e => e.companyCode_code === query.companyCode);
  if (query.plant)          result = result.filter(e => e.plant_code === query.plant);
  if (query.status)         result = result.filter(e => e.status === query.status);
  if (query.riskLevel)      result = result.filter(e => e.riskLevel === query.riskLevel);
  if (query.owner)          result = result.filter(e => e.owner_id === query.owner);
  if (query.documentType)   result = result.filter(e => e.documentType === query.documentType);
  if (query.businessPartner)result = result.filter(e => e.businessPartner_id === query.businessPartner);
  if (query.search) {
    const s = query.search.toLowerCase();
    result = result.filter(e =>
      e.documentId.toLowerCase().includes(s) ||
      (e.businessPartner_id || '').toLowerCase().includes(s) ||
      (e.category || '').toLowerCase().includes(s)
    );
  }
  // Sorting
  const sortBy = query.sortBy || 'priority';
  const order  = query.order === 'desc' ? -1 : 1;
  result.sort((a, b) => {
    const av = a[sortBy]; const bv = b[sortBy];
    if (av === undefined) return 1;
    if (bv === undefined) return -1;
    return av < bv ? -order : av > bv ? order : 0;
  });
  // Pagination
  const top  = parseInt(query.$top)  || 50;
  const skip = parseInt(query.$skip) || 0;
  const total = result.length;
  return { items: result.slice(skip, skip + top), total };
}

function addTimeline(excId, step, actor, eventType, fieldChanged, oldVal, newVal, comment) {
  store.timeline.push({
    ID: uuidv4(), exception_ID: excId, stepName: step,
    actor_id: actor, eventType, fieldChanged, oldValue: oldVal, newValue: newVal, comment,
    timestamp: new Date().toISOString(),
  });
}

function addAudit(entityId, action, performedBy, changes, req) {
  store.auditLog.push(buildAuditEntry({ entityType: 'TreasuryException', entityId, action, performedBy, changes, req }));
}

// ─── ROUTES ──────────────────────────────────────────────────────────────────

// GET /api/treasury/exceptions
app.get('/api/treasury/exceptions', (req, res) => {
  const { items, total } = applyFilters(store.exceptions, req.query);
  res.json({ value: items, '@odata.count': total, _sapUnavailable: false });
});

// GET /api/treasury/exceptions/:id
app.get('/api/treasury/exceptions/:id', (req, res) => {
  const exc = findException(req.params.id);
  if (!exc) return res.status(404).json({ error: { category: 'NotFound', message: `Exception '${req.params.id}' not found.` } });

  // Enrich with full AI analysis on detail view
  const ai = analyse(exc);
  res.json({ ...exc, _ai: ai });
});

// POST /api/treasury/exceptions — create new
app.post('/api/treasury/exceptions', (req, res) => {
  const data = req.body;

  // Validation pipeline
  const valResult = validate(data);
  if (!valResult.valid) {
    const err = new Error('Validation failed');
    err.status = 422;
    err.validationErrors = valResult.errors;
    return res.status(422).json({
      error: { category: 'ValidationError', message: 'Record failed validation.', validationErrors: valResult.errors },
      warnings: valResult.warnings,
      summary: valResult.summary,
    });
  }

  const id = `EXC-${String(store.exceptions.length + 100).padStart(3, '0')}`;
  const now = new Date().toISOString();

  const newExc = {
    ID: id,
    ...data,
    raisedAt: now,
    status: data.status || 'Open',
    missingFields: valResult.missingFields,
    validationPassed: true,
    createdAt: now,
    modifiedAt: now,
  };

  const risk = calculateRisk({ ...newExc, missingFields: valResult.missingFields });
  Object.assign(newExc, risk);

  const ai = analyse(newExc);
  newExc.aiExplanation  = ai.explanation;
  newExc.aiConfidence   = ai.confidence;
  newExc.nextBestAction = ai.topAction?.label || null;
  newExc.nbaCategory    = ai.topAction?.category || null;

  store.exceptions.push(newExc);
  addTimeline(id, 'Exception Created', data.owner_id || 'SYSTEM', 'Created', null, null, null, 'Exception created via API');
  addAudit(id, 'CREATE', data.owner_id || 'SYSTEM', { newExc }, req);

  res.status(201).json({ ...newExc, _ai: ai, warnings: valResult.warnings });
});

// PATCH /api/treasury/exceptions/:id — partial update
app.patch('/api/treasury/exceptions/:id', (req, res) => {
  const exc = findException(req.params.id);
  if (!exc) return res.status(404).json({ error: { category: 'NotFound', message: `Exception '${req.params.id}' not found.` } });

  const patchData = req.body;
  const valResult = validatePatch(patchData, exc);

  if (!valResult.valid) {
    return res.status(422).json({
      error: { category: 'ValidationError', message: 'Patch failed validation.', validationErrors: valResult.errors },
      warnings: valResult.warnings,
    });
  }

  const before = { ...exc };
  Object.assign(exc, patchData, { modifiedAt: new Date().toISOString() });

  // Re-score after update
  const risk = calculateRisk(exc);
  Object.assign(exc, risk);
  const ai = analyse(exc);
  exc.aiExplanation  = ai.explanation;
  exc.aiConfidence   = ai.confidence;
  exc.nextBestAction = ai.topAction?.label || null;

  addTimeline(exc.ID, 'Exception Updated', patchData.modifiedBy || 'SYSTEM', 'Updated',
    Object.keys(patchData).join(', '), JSON.stringify(before), JSON.stringify(patchData), null);
  addAudit(exc.ID, 'UPDATE', patchData.modifiedBy || 'SYSTEM', { before: pick(before, Object.keys(patchData)), after: patchData }, req);

  res.json({ ...exc, _ai: ai, warnings: valResult.warnings });
});

// ─── ACTIONS ──────────────────────────────────────────────────────────────────

// POST /api/treasury/exceptions/:id/validate
app.post('/api/treasury/exceptions/:id/validate', (req, res) => {
  const exc = findException(req.params.id);
  if (!exc) return res.status(404).json({ error: { category: 'NotFound', message: 'Exception not found.' } });

  const valResult = validate(exc);
  exc.validationPassed = valResult.valid;
  exc.missingFields    = valResult.missingFields;

  addTimeline(exc.ID, 'Validation Run', 'SYSTEM', 'Validated', null, null, null,
    `Result: ${valResult.summary}`);

  res.json({ valid: valResult.valid, errors: valResult.errors, warnings: valResult.warnings, infos: valResult.infos, summary: valResult.summary, missingFields: valResult.missingFields });
});

// POST /api/treasury/exceptions/:id/assign
app.post('/api/treasury/exceptions/:id/assign', (req, res) => {
  const exc = findException(req.params.id);
  if (!exc) return res.status(404).json({ error: { category: 'NotFound', message: 'Exception not found.' } });

  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: { category: 'ValidationError', message: '`userId` is required.' } });

  const prev = exc.owner_id;
  exc.owner_id  = userId;
  exc.assignedAt = new Date().toISOString();

  addTimeline(exc.ID, 'Owner Assigned', req.body.performedBy || 'SYSTEM', 'Assigned', 'owner_id', prev, userId, req.body.comment);
  addAudit(exc.ID, 'ASSIGN_OWNER', req.body.performedBy || 'SYSTEM', { from: prev, to: userId }, req);

  res.json({ success: true, message: `Owner assigned to ${userId}`, exceptionId: exc.ID, timestamp: exc.assignedAt });
});

// POST /api/treasury/exceptions/:id/escalate
app.post('/api/treasury/exceptions/:id/escalate', (req, res) => {
  const exc = findException(req.params.id);
  if (!exc) return res.status(404).json({ error: { category: 'NotFound', message: 'Exception not found.' } });

  const { userId, reason } = req.body;
  if (!userId) return res.status(400).json({ error: { category: 'ValidationError', message: '`userId` is required for escalation.' } });
  if (!reason) return res.status(400).json({ error: { category: 'ValidationError', message: '`reason` is required for escalation audit trail.' } });

  exc.escalatedTo_id = userId;
  exc.escalatedAt    = new Date().toISOString();
  exc.status         = 'Escalated';

  addTimeline(exc.ID, 'Escalated', req.body.performedBy || 'SYSTEM', 'Escalated', 'status', exc.status, 'Escalated', reason);
  addAudit(exc.ID, 'ESCALATE', req.body.performedBy || 'SYSTEM', { escalatedTo: userId, reason }, req);

  res.json({ success: true, message: `Escalated to ${userId}`, exceptionId: exc.ID, timestamp: exc.escalatedAt });
});

// POST /api/treasury/exceptions/:id/resolve
app.post('/api/treasury/exceptions/:id/resolve', (req, res) => {
  const exc = findException(req.params.id);
  if (!exc) return res.status(404).json({ error: { category: 'NotFound', message: 'Exception not found.' } });

  const { notes, resolvedBy } = req.body;
  if (!notes || notes.trim().length < 10) {
    return res.status(422).json({ error: { category: 'ValidationError', message: 'Resolution notes must be at least 10 characters.' } });
  }

  const prev = exc.status;
  exc.status          = 'Resolved';
  exc.resolvedAt      = new Date().toISOString();
  exc.resolvedBy_id   = resolvedBy || req.body.performedBy;
  exc.resolutionNotes = notes;

  // Check for recurrence
  const similar = store.exceptions.filter(e =>
    e.ID !== exc.ID &&
    e.documentType === exc.documentType &&
    e.category === exc.category &&
    e.businessPartner_id === exc.businessPartner_id
  );
  if (similar.length > 0) {
    similar.forEach(s => { s.recurrenceCount = (s.recurrenceCount || 0) + 1; });
  }

  addTimeline(exc.ID, 'Exception Resolved', resolvedBy || 'SYSTEM', 'Resolved', 'status', prev, 'Resolved', notes);
  addAudit(exc.ID, 'RESOLVE', resolvedBy || 'SYSTEM', { notes, prevStatus: prev }, req);

  res.json({ success: true, message: 'Exception resolved.', exceptionId: exc.ID, timestamp: exc.resolvedAt });
});

// POST /api/treasury/exceptions/:id/comment
app.post('/api/treasury/exceptions/:id/comment', (req, res) => {
  const exc = findException(req.params.id);
  if (!exc) return res.status(404).json({ error: { category: 'NotFound', message: 'Exception not found.' } });

  const { text, performedBy } = req.body;
  if (!text || text.trim() === '') {
    return res.status(400).json({ error: { category: 'ValidationError', message: 'Comment text is required.' } });
  }

  const entry = { ID: uuidv4(), exception_ID: exc.ID, actionType: 'Comment', performedBy_id: performedBy, performedByName: performedBy, timestamp: new Date().toISOString(), description: text, success: true };
  store.resolutionLog.push(entry);
  addTimeline(exc.ID, 'Comment Added', performedBy || 'SYSTEM', 'Updated', null, null, null, text);

  res.json({ success: true, message: 'Comment added.', entry });
});

// POST /api/treasury/exceptions/:id/sap-release — with human confirmation gate
app.post('/api/treasury/exceptions/:id/sap-release', (req, res) => {
  const exc = findException(req.params.id);
  if (!exc) return res.status(404).json({ error: { category: 'NotFound', message: 'Exception not found.' } });

  const { confirmed, performedBy } = req.body;
  const amount = parseFloat(exc.amount) || 0;

  // High-value gate: require explicit confirmation
  if (amount > 50_000 && !confirmed) {
    return res.status(202).json({
      requiresConfirmation: true,
      message: `Amount £${amount.toLocaleString()} exceeds £50,000. Explicit confirmation required before SAP API call.`,
      payload: buildSAPPayload(exc),
      confirmationRequired: true,
    });
  }

  // Mock SAP OData call (with fallback)
  const sapCallResult = simulateSAPCall(exc);

  store.resolutionLog.push({
    ID: uuidv4(), exception_ID: exc.ID, actionType: 'SAPAPICall',
    performedBy_id: performedBy, timestamp: new Date().toISOString(),
    sapPayload: JSON.stringify(buildSAPPayload(exc)),
    sapResponse: JSON.stringify(sapCallResult),
    success: sapCallResult.success,
    errorMessage: sapCallResult.error || null,
  });

  addTimeline(exc.ID, 'SAP Release Triggered', performedBy || 'SYSTEM', 'Updated', 'status',
    exc.status, sapCallResult.success ? 'Released' : exc.status,
    `SAP API call: ${sapCallResult.success ? 'SUCCESS' : 'FAILED'}`);

  if (sapCallResult.success) {
    exc.status = 'InProgress';
  }

  addAudit(exc.ID, 'SAP_RELEASE', performedBy || 'SYSTEM', sapCallResult, req);
  res.json(sapCallResult);
});

// ─── AI ENDPOINT ─────────────────────────────────────────────────────────────

// GET /api/treasury/exceptions/:id/analyse
app.get('/api/treasury/exceptions/:id/analyse', (req, res) => {
  const exc = findException(req.params.id);
  if (!exc) return res.status(404).json({ error: { category: 'NotFound', message: 'Exception not found.' } });
  const ai = analyse(exc);
  res.json(ai);
});

// ─── KPI & ANALYTICS ──────────────────────────────────────────────────────────

app.get('/api/treasury/kpis', (req, res) => {
  const scored = scoreAndRank(store.exceptions);
  const kpis   = portfolioKPIs(scored);
  res.json(kpis);
});

app.get('/api/treasury/analytics', (req, res) => {
  const excs = store.exceptions;

  const rootCauses = Object.entries(
    excs.reduce((acc, e) => { acc[e.category] = (acc[e.category] || 0) + 1; return acc; }, {})
  ).map(([category, count]) => ({ category, count, value: excs.filter(e => e.category === category).reduce((s, e) => s + (parseFloat(e.amount) || 0), 0) }))
   .sort((a, b) => b.count - a.count);

  const byLocation = Object.entries(
    excs.reduce((acc, e) => { const k = e.plant_code || 'Unknown'; acc[k] = (acc[k] || 0) + 1; return acc; }, {})
  ).map(([plant, count]) => ({ plant, count }));

  const byPartner = Object.entries(
    excs.reduce((acc, e) => { const k = e.businessPartner_id || 'Unknown'; acc[k] = (acc[k] || 0) + 1; return acc; }, {})
  ).map(([partner, count]) => ({ partner, count, value: excs.filter(e => e.businessPartner_id === partner).reduce((s, e) => s + (parseFloat(e.amount) || 0), 0) }))
   .sort((a, b) => b.value - a.value);

  const cycleTime = excs.filter(e => e.resolvedAt && e.raisedAt).map(e => ({
    id: e.ID, hours: Math.round((new Date(e.resolvedAt) - new Date(e.raisedAt)) / 3_600_000 * 10) / 10,
  }));

  res.json({ rootCauses, byLocation, byPartner, cycleTime });
});

// ─── TIMELINE & AUDIT ─────────────────────────────────────────────────────────

app.get('/api/treasury/exceptions/:id/timeline', (req, res) => {
  const events = store.timeline.filter(t => t.exception_ID === req.params.id)
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  res.json({ value: events, '@odata.count': events.length });
});

app.get('/api/treasury/exceptions/:id/resolution-log', (req, res) => {
  const log = store.resolutionLog.filter(r => r.exception_ID === req.params.id)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  res.json({ value: log, '@odata.count': log.length });
});

app.get('/api/treasury/audit-log', (req, res) => {
  const { entityId } = req.query;
  const log = entityId
    ? store.auditLog.filter(a => a.entityId === entityId)
    : store.auditLog;
  res.json({ value: log.slice(-200), '@odata.count': log.length });
});

// ─── IMPORT ──────────────────────────────────────────────────────────────────

app.post('/api/treasury/import', (req, res) => {
  let records;
  try {
    records = typeof req.body.payload === 'string' ? JSON.parse(req.body.payload) : req.body.payload;
    if (!Array.isArray(records)) records = [records];
  } catch {
    return res.status(400).json({ error: { category: 'ValidationError', message: 'Invalid JSON payload.' } });
  }

  let imported = 0; const errors = [];
  for (const raw of records) {
    const val = validate(raw);
    if (!val.valid) {
      errors.push({ documentId: raw.documentId, errors: val.errors.map(e => e.message) });
      continue;
    }
    const id  = raw.ID || `EXC-IMP-${uuidv4().slice(0, 8).toUpperCase()}`;
    const now = new Date().toISOString();
    const exc = { ...raw, ID: id, raisedAt: raw.raisedAt || now, validationPassed: true, missingFields: val.missingFields, createdAt: now };
    const risk = calculateRisk(exc);
    Object.assign(exc, risk);
    const ai = analyse(exc);
    exc.aiExplanation = ai.explanation;
    exc.aiConfidence  = ai.confidence;
    exc.nextBestAction = ai.topAction?.label || null;
    store.exceptions.push(exc);
    imported++;
  }

  addAudit('IMPORT', 'BULK_IMPORT', 'SYSTEM', { imported, failed: errors.length }, req);
  res.json({ imported, failed: errors.length, errors });
});

// ─── HEALTH ───────────────────────────────────────────────────────────────────

app.get('/api/health', (_req, res) => {
  res.json({ status: 'UP', timestamp: new Date().toISOString(), exceptions: store.exceptions.length, sapMode: process.env.SAP_MODE || 'mock' });
});

// ─── STATIC (React build in production) ──────────────────────────────────────

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../../frontend/build')));
  app.get('*', (_req, res) => res.sendFile(path.join(__dirname, '../../frontend/build/index.html')));
}

// ─── ERROR HANDLER ────────────────────────────────────────────────────────────

app.use(errorHandler);

app.listen(PORT, () => console.log(`[Nordwerk Treasury] Server running on http://localhost:${PORT}`));

module.exports = app;

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function pick(obj, keys) {
  return keys.reduce((acc, k) => { if (k in obj) acc[k] = obj[k]; return acc; }, {});
}

function buildSAPPayload(exc) {
  return {
    DocumentId:    exc.documentId,
    DocumentType:  exc.documentType,
    CompanyCode:   exc.companyCode_code,
    Amount:        exc.amount,
    Currency:      exc.currency || 'GBP',
    Status:        'Released',
    ChangedBy:     'NORDWERK_TREASURY_APP',
    ChangedAt:     new Date().toISOString(),
  };
}

function simulateSAPCall(exc) {
  // Simulate occasional SAP failure for demo realism
  const failRate = parseFloat(process.env.SAP_FAIL_RATE) || 0.05; // 5%
  if (Math.random() < failRate) {
    return { success: false, sapStatus: 'ERROR', error: 'SAP gateway timeout (simulated)', retryable: true };
  }
  return {
    success: true,
    sapStatus: 'RELEASED',
    message: `Document ${exc.documentId} successfully released in SAP.`,
    transactionCode: exc.documentType === 'PO' ? 'ME29N' : 'F-53',
    sapDocumentNumber: exc.documentId,
    timestamp: new Date().toISOString(),
  };
}
