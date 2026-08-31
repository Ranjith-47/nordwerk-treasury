'use strict';

/**
 * AI Explainer & Next Best Action (NBA) Engine
 *
 * Transparent rules-based system — no LLM dependency.
 * Every output includes the evidence used so users can verify and override.
 */

// ─── SIGNAVIO PROCESS STEPS ──────────────────────────────────────────────────

const SIGNAVIO_FLOW = [
  'Create Purchase Requisition',
  'Approve Purchase Requisition',
  'Create Purchase Order',
  'Validate PO Master Data',
  'Approve Purchase Order',
  'Send PO to Supplier',
  'Goods Receipt',
  'Validate Invoice',
  'Three-Way Match',
  'Reconcile Payment with Invoice',
  'Post Payment',
  'Cash Position Monitoring',
  'Cash Flow Forecast',
  'Liquidity Analysis',
  'Treasury Reporting',
];

// ─── EXCEPTION EXPLANATION TEMPLATES ─────────────────────────────────────────

const EXPLANATION_TEMPLATES = {
  MissingMasterData: {
    MissingCostCentre: (exc) =>
      `PO ${exc.documentId} (£${fmt(exc.amount)}, ${exc.businessPartner_name || exc.businessPartner_id}, due ${exc.requestedDate}) ` +
      `cannot be posted to accounting because the Cost Centre field is blank. ` +
      `SAP requires a valid cost assignment before journal entry creation. ` +
      `This has delayed the process at step "${exc.signavioStep || 'Validate PO Master Data'}". ` +
      `Impact: accounting period close risk and working capital lock-up of £${fmt(exc.amount)}.`,

    MissingStorageLocation: (exc) =>
      `${exc.documentType} ${exc.documentId} (£${fmt(exc.amount)}) cannot be goods-receipted because ` +
      `storage location '${exc.storageLocation || '[blank]'}' is not mapped for material ${exc.material_code} at plant ${exc.plant_code}. ` +
      `Until this is resolved, physical stock cannot be confirmed in SAP. ` +
      `Process deviated at: "${exc.signavioStep || 'Validate Invoice Master Data'}".`,

    default: (exc) =>
      `${exc.documentType} ${exc.documentId} (£${fmt(exc.amount)}) is blocked due to missing master data. ` +
      `Affected fields: ${exc.missingFields || 'see validation errors'}. ` +
      `SAP cannot complete the "${exc.signavioStep || 'data validation'}" step until all mandatory fields are populated. ` +
      `Financial exposure: £${fmt(exc.amount)}.`,
  },

  ApprovalGap: {
    PendingManagerApproval: (exc) =>
      `${exc.documentType} ${exc.documentId} (£${fmt(exc.amount)}, ${exc.businessPartner_name || exc.businessPartner_id}) ` +
      `has been awaiting manager approval since ${exc.raisedAt ? fmtDate(exc.raisedAt) : 'creation'}. ` +
      `The document is blocked at Signavio step "${exc.signavioStep || 'Approve Purchase Order'}". ` +
      `${exc.agingDays > 2 ? `Approval is now ${exc.agingDays} day(s) overdue — SLA breach risk.` : ''} ` +
      `Unresolved, this will delay delivery to ${exc.businessPartner_name || 'the business partner'} and risk an SLA breach.`,

    default: (exc) =>
      `${exc.documentType} ${exc.documentId} (£${fmt(exc.amount)}) is pending approval. ` +
      `No approver has actioned the request since ${exc.raisedAt ? fmtDate(exc.raisedAt) : 'creation'} (${exc.agingDays || 0} day(s) old). ` +
      `Process is stalled at: "${exc.signavioStep}".`,
  },

  DataMismatch: {
    PaymentAmountMismatch: (exc) =>
      `Payment ${exc.documentId} (£${fmt(exc.amount)}) does not match the linked invoice amount. ` +
      `The ${exc.processDeviation ? exc.processDeviation : 'difference'} prevents automated three-way match completion. ` +
      `SAP will not post the payment until reconciliation is confirmed. ` +
      `Risk: supplier relationship impact and potential duplicate payment if re-raised without correction.`,

    default: (exc) =>
      `${exc.documentType} ${exc.documentId} has a data mismatch: ${exc.processDeviation || 'see timeline for detail'}. ` +
      `The discrepancy prevents the process from advancing past "${exc.signavioStep}". ` +
      `Financial exposure: £${fmt(exc.amount)}.`,
  },

  AgingItem: {
    NoOwnerAssigned: (exc) =>
      `${exc.documentType} ${exc.documentId} (£${fmt(exc.amount)}) has been open for ${exc.agingDays || 0} day(s) with no assigned owner. ` +
      `Unowned exceptions cannot be progressed and impair cash flow forecasting accuracy (Signavio: "${exc.signavioStep || 'Cash Position Monitoring'}""). ` +
      `Each day without action increases the risk of SLA breach. ` +
      `Working capital impact: £${fmt(exc.amount)} locked.`,

    default: (exc) =>
      `${exc.documentType} ${exc.documentId} (£${fmt(exc.amount)}) has been unactioned for ${exc.agingDays || 0} day(s). ` +
      `This is an ageing exception that has missed its expected resolution window. ` +
      `Current status: ${exc.status}. Process step: "${exc.signavioStep}".`,
  },

  default: {
    default: (exc) =>
      `${exc.documentType} ${exc.documentId} (£${fmt(exc.amount)}) requires attention. ` +
      `Category: ${exc.category || 'General'}. Status: ${exc.status}. ` +
      `Raised: ${exc.raisedAt ? fmtDate(exc.raisedAt) : 'unknown'}. ` +
      `${exc.agingDays > 0 ? `Open for ${exc.agingDays} day(s).` : ''}`,
  },
};

// ─── NEXT BEST ACTION DECISION TREE ──────────────────────────────────────────

/**
 * Returns prioritised array of recommended actions.
 * Each action: { rank, category, label, description, actionType, requiresConfirmation, sapTransaction }
 */
function getNBA(exc) {
  const actions = [];
  const amount = parseFloat(exc.amount) || 0;

  // NBA-01: SLA about to breach or already breached
  if (exc.slaBreach || exc.hoursOverdue > 0) {
    actions.push({
      rank: 1,
      category: 'Escalation',
      label: 'Escalate Immediately',
      description: `SLA breached by ${exc.hoursOverdue || 0}h. Assign to Treasury Manager and notify CFO if value > £50,000.`,
      actionType: 'Escalation',
      requiresConfirmation: false,
      urgency: 'Critical',
    });
  }

  // NBA-02: No owner assigned
  if (!exc.owner_id) {
    actions.push({
      rank: 2,
      category: 'OwnerAssign',
      label: 'Assign Owner',
      description: 'No owner is assigned. Assign a Treasury Analyst to take accountability for resolution.',
      actionType: 'OwnerAssign',
      requiresConfirmation: false,
      urgency: 'High',
    });
  }

  // NBA-03: Missing master data
  if (exc.category === 'MissingMasterData' && exc.missingFields) {
    actions.push({
      rank: 3,
      category: 'FieldCorrection',
      label: 'Correct Missing Fields',
      description: `Complete the missing SAP master data fields: ${exc.missingFields}. Validate in SAP transaction MM01/XK01.`,
      actionType: 'FieldCorrection',
      requiresConfirmation: false,
      sapTransaction: exc.documentType === 'PO' ? 'ME22N' : 'MM01',
      urgency: 'High',
    });
  }

  // NBA-04: Approval pending > 2 days
  if (exc.category === 'ApprovalGap' && (exc.agingDays >= 2)) {
    actions.push({
      rank: 4,
      category: 'ApprovalRequest',
      label: 'Request Approval',
      description: `Send approval reminder to ${exc.approver || 'assigned approver'}. PO ${exc.documentId} has been pending ${exc.agingDays} day(s).`,
      actionType: 'ApprovalRequest',
      requiresConfirmation: false,
      sapTransaction: 'ME29N',
      urgency: 'High',
    });
  }

  // NBA-05: Payment mismatch — reconcile
  if (exc.subcategory === 'PaymentAmountMismatch') {
    actions.push({
      rank: 5,
      category: 'DocumentGenerate',
      label: 'Generate Reconciliation Report',
      description: 'Produce a reconciliation report comparing payment vs invoice amounts for Finance review.',
      actionType: 'DocumentGenerate',
      requiresConfirmation: false,
      urgency: 'High',
    });
  }

  // NBA-06: High value — SAP API call (requires confirmation)
  if (amount > 50_000 && exc.status !== 'Resolved') {
    actions.push({
      rank: 6,
      category: 'SAPAPICall',
      label: 'Trigger SAP Release via API',
      description: `Call SAP OData API to release ${exc.documentId} in ${exc.documentType === 'PO' ? 'ME29N' : 'F-53'}. Amount £${fmt(amount)} — human confirmation required.`,
      actionType: 'SAPAPICall',
      requiresConfirmation: true, // HIGH-VALUE GATE
      sapTransaction: exc.documentType === 'PO' ? 'ME29N' : 'F-53',
      sapEndpoint: `/sap/opu/odata/sap/MM_PUR_PO_MAINT_V2_SRV/PurchaseOrders('${exc.documentId}')`,
      urgency: 'Medium',
    });
  }

  // NBA-07: Recurrence > 2 — root cause review
  if ((exc.recurrenceCount || 0) >= 2) {
    actions.push({
      rank: 7,
      category: 'RootCauseReview',
      label: 'Flag for Root Cause Review',
      description: `This exception type has recurred ${exc.recurrenceCount} times. Refer to Analytics for pattern analysis.`,
      actionType: 'Comment',
      requiresConfirmation: false,
      urgency: 'Medium',
    });
  }

  // NBA-08: Default — add a comment/note
  if (actions.length === 0) {
    actions.push({
      rank: 99,
      category: 'Comment',
      label: 'Add Progress Note',
      description: 'Document current status and next action in the resolution log.',
      actionType: 'Comment',
      requiresConfirmation: false,
      urgency: 'Low',
    });
  }

  // Sort by rank
  return actions.sort((a, b) => a.rank - b.rank);
}

// ─── SIGNAVIO DEVIATION DETECTION ────────────────────────────────────────────

function getSignavioDeviation(exc) {
  const step = exc.signavioStep;
  if (!step) return { deviationIndex: -1, expectedPreviousStep: null, stepsRemaining: [] };

  const idx = SIGNAVIO_FLOW.indexOf(step);
  return {
    deviationIndex:      idx,
    deviationStep:       step,
    expectedPreviousStep: idx > 0 ? SIGNAVIO_FLOW[idx - 1] : null,
    stepsRemaining:       idx >= 0 ? SIGNAVIO_FLOW.slice(idx + 1) : [],
    totalSteps:           SIGNAVIO_FLOW.length,
    completionPct:        idx >= 0 ? Math.round((idx / SIGNAVIO_FLOW.length) * 100) : 0,
    fullFlow:             SIGNAVIO_FLOW,
  };
}

// ─── CONFIDENCE SCORING ───────────────────────────────────────────────────────

function calcConfidence(exc) {
  let score = 1.0;
  if (!exc.category)       score -= 0.15;
  if (!exc.subcategory)    score -= 0.10;
  if (!exc.signavioStep)   score -= 0.10;
  if (!exc.missingFields && exc.category === 'MissingMasterData') score -= 0.10;
  if (!exc.processDeviation) score -= 0.05;
  return Math.max(0.5, Math.round(score * 100) / 100);
}

// ─── MAIN ENTRY POINT ─────────────────────────────────────────────────────────

/**
 * Generate full AI analysis for a treasury exception.
 *
 * @param {Object} exc  - Scored exception (post risk-engine)
 * @returns {Object} { explanation, nba, signavio, confidence, evidence }
 */
function analyse(exc) {
  const catTemplates = EXPLANATION_TEMPLATES[exc.category] || EXPLANATION_TEMPLATES.default;
  const templateFn   = catTemplates[exc.subcategory] || catTemplates.default || EXPLANATION_TEMPLATES.default.default;

  const explanation = templateFn(exc);
  const nba         = getNBA(exc);
  const signavio    = getSignavioDeviation(exc);
  const confidence  = calcConfidence(exc);

  // Evidence used — transparent list shown to user
  const evidence = [
    `Document: ${exc.documentId} | Type: ${exc.documentType}`,
    `Amount: £${fmt(exc.amount)} | Currency: ${exc.currency || 'GBP'}`,
    `Status: ${exc.status} | Risk: ${exc.riskLevel} (score ${exc.riskScore})`,
    `Aging: ${exc.agingDays} day(s) | SLA Breached: ${exc.slaBreach ? 'YES' : 'No'}`,
    `Category: ${exc.category} → ${exc.subcategory || 'N/A'}`,
    `Signavio Step: ${exc.signavioStep || 'Not mapped'}`,
    `Owner: ${exc.owner_id || 'UNASSIGNED'}`,
    exc.missingFields ? `Missing Fields: ${exc.missingFields}` : null,
    exc.recurrenceCount > 0 ? `Recurrence: ${exc.recurrenceCount}x` : null,
  ].filter(Boolean);

  return {
    explanation,
    nba,
    signavio,
    confidence,
    evidence,
    generatedAt: new Date().toISOString(),
    topAction: nba[0] || null,
  };
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function fmt(n) {
  const num = parseFloat(n);
  if (isNaN(num)) return '0.00';
  return num.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(iso) {
  try { return new Date(iso).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' }); }
  catch { return iso; }
}

module.exports = { analyse, getNBA, getSignavioDeviation, SIGNAVIO_FLOW };
