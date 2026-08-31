'use strict';

/**
 * Automated test suite for validation, risk engine and AI explainer.
 * Run: node srv/tests/run-tests.js
 */

const { validate, validatePatch }     = require('../handlers/validation');
const { calculateRisk, portfolioKPIs } = require('../handlers/risk-engine');
const { analyse }                      = require('../handlers/ai-explainer');

let passed = 0, failed = 0;

function assert(desc, condition) {
  if (condition) { console.log(`  ✓ ${desc}`); passed++; }
  else           { console.error(`  ✗ FAIL: ${desc}`); failed++; }
}

// ─── VALIDATION TESTS ────────────────────────────────────────────────────────

console.log('\n=== Validation Engine ===');

// V-01: Valid PO-460021 from brief
{
  const valid = validate({
    companyCode_code: '1100', plant_code: '1103', storageLocation: 'SL10',
    costCentre_code: 'CC-2221', material_code: 'MAT-SV20',
    businessPartner_id: 'BP-NVC001', documentId: 'PO-460021',
    documentType: 'PO', amount: 41375.00, currency: 'GBP',
    requestedDate: '2026-09-06',
  });
  assert('V-01 Valid PO passes validation', valid.valid === true);
  assert('V-01 No errors on valid PO', valid.errors.length === 0);
}

// V-02: Missing mandatory field (documentId)
{
  const r = validate({ documentType: 'PO', amount: 100, requestedDate: '2026-09-01', companyCode_code: '1100', plant_code: '1103' });
  assert('V-02 Missing documentId produces error', r.errors.some(e => e.code === 'MISSING_MANDATORY' && e.field === 'documentId'));
}

// V-03: Invalid document ID format
{
  const r = validate({ documentType: 'PO', documentId: 'WRONG123', amount: 100, requestedDate: '2026-09-01', companyCode_code: '1100', plant_code: '1103', storageLocation: 'SL10', costCentre_code: 'CC-2221', material_code: 'M', businessPartner_id: 'BP-NVC001' });
  assert('V-03 Invalid PO ID format produces error', r.errors.some(e => e.code === 'INVALID_DOC_FORMAT'));
}

// V-04: Negative amount
{
  const r = validate({ documentType: 'PO', documentId: 'PO-460099', amount: -500, requestedDate: '2026-09-01', companyCode_code: '1100', plant_code: '1103', storageLocation: 'SL10', costCentre_code: 'CC-2221', material_code: 'M', businessPartner_id: 'BP-001' });
  assert('V-04 Negative amount produces error', r.errors.some(e => e.code === 'AMOUNT_TOO_LOW'));
}

// V-05: Amount exceeding max
{
  const r = validate({ documentType: 'PO', documentId: 'PO-460098', amount: 15_000_000, requestedDate: '2026-09-01', companyCode_code: '1100', plant_code: '1103', storageLocation: 'SL10', costCentre_code: 'CC-2221', material_code: 'M', businessPartner_id: 'BP-001' });
  assert('V-05 Amount > 10M produces error', r.errors.some(e => e.code === 'AMOUNT_EXCEEDS_MAX'));
}

// V-06: Plant-company mismatch
{
  const r = validate({ documentType: 'PO', documentId: 'PO-460097', amount: 500, requestedDate: '2026-09-01', companyCode_code: '1100', plant_code: '1201', storageLocation: 'SL10', costCentre_code: 'CC-2221', material_code: 'M', businessPartner_id: 'BP-001' });
  assert('V-06 Plant-company mismatch produces error', r.errors.some(e => e.code === 'PLANT_COMPANY_MISMATCH'));
}

// V-07: Future posting date
{
  const r = validate({ documentType: 'PO', documentId: 'PO-460096', amount: 500, requestedDate: '2026-09-01', postingDate: '2027-01-01', companyCode_code: '1100', plant_code: '1103', storageLocation: 'SL10', costCentre_code: 'CC-2221', material_code: 'M', businessPartner_id: 'BP-001' });
  assert('V-07 Future posting date produces error', r.errors.some(e => e.code === 'FUTURE_POSTING_DATE'));
}

// V-08: Self-approval prohibited
{
  const r = validate({ documentType: 'PO', documentId: 'PO-460095', amount: 500, requestedDate: '2026-09-01', companyCode_code: '1100', plant_code: '1103', storageLocation: 'SL10', costCentre_code: 'CC-2221', material_code: 'M', businessPartner_id: 'BP-001', owner_id: 'USR001', approvedBy_id: 'USR001' });
  assert('V-08 Self-approval produces error', r.errors.some(e => e.code === 'SELF_APPROVAL_PROHIBITED'));
}

// V-09: Resolved without notes
{
  const r = validate({ documentType: 'PO', documentId: 'PO-460094', amount: 500, requestedDate: '2026-09-01', companyCode_code: '1100', plant_code: '1103', storageLocation: 'SL10', costCentre_code: 'CC-2221', material_code: 'M', businessPartner_id: 'BP-001', status: 'Resolved' });
  assert('V-09 Resolved without notes produces error', r.errors.some(e => e.code === 'RESOLUTION_NOTES_REQUIRED'));
}

// V-10: Payment amount mismatch warning
{
  const r = validate({ documentType: 'Payment', documentId: 'PAY-780001', amount: 124500, referenceAmount: 119750, requestedDate: '2026-09-01', postingDate: '2026-08-20', companyCode_code: '1100', plant_code: '1103', businessPartner_id: 'BP-001' });
  assert('V-10 Payment mismatch produces error', r.errors.some(e => e.code === 'PAYMENT_AMOUNT_MISMATCH'));
}

// V-11: Escalated without target
{
  const r = validate({ documentType: 'PO', documentId: 'PO-460093', amount: 500, requestedDate: '2026-09-01', companyCode_code: '1100', plant_code: '1103', storageLocation: 'SL10', costCentre_code: 'CC-2221', material_code: 'M', businessPartner_id: 'BP-001', status: 'Escalated' });
  assert('V-11 Escalated without target produces error', r.errors.some(e => e.code === 'ESCALATION_TARGET_MISSING'));
}

// V-12: High value warning
{
  const r = validate({ documentType: 'PO', documentId: 'PO-460092', amount: 75000, requestedDate: '2026-09-01', companyCode_code: '1100', plant_code: '1103', storageLocation: 'SL10', costCentre_code: 'CC-2221', material_code: 'M', businessPartner_id: 'BP-001' });
  assert('V-12 High value produces warning', r.warnings.some(e => e.code === 'HIGH_VALUE_WARNING'));
}

// V-13: validatePatch only checks partial
{
  const r = validatePatch({ amount: -10 }, { documentType: 'PO', documentId: 'PO-460021', requestedDate: '2026-09-01', companyCode_code: '1100', plant_code: '1103' });
  assert('V-13 Patch with invalid amount fails', r.valid === false);
}

// V-14: Due before requested
{
  const r = validate({ documentType: 'PO', documentId: 'PO-460091', amount: 500, requestedDate: '2026-09-10', dueDate: '2026-09-01', companyCode_code: '1100', plant_code: '1103', storageLocation: 'SL10', costCentre_code: 'CC-2221', material_code: 'M', businessPartner_id: 'BP-001' });
  assert('V-14 Due before requested produces error', r.errors.some(e => e.code === 'DUE_BEFORE_REQUESTED'));
}

// V-15: CashFlow no owner
{
  const r = validate({ documentType: 'CashFlow', documentId: 'CF-220001', amount: 5000, requestedDate: '2026-09-01', companyCode_code: '1100' });
  assert('V-15 CashFlow no owner produces warning', r.warnings.some(e => e.code === 'CASHFLOW_NO_OWNER'));
}

// ─── RISK ENGINE TESTS ────────────────────────────────────────────────────────

console.log('\n=== Risk Engine ===');

{
  const r = calculateRisk({ documentType: 'PO', amount: 41375, agingDays: 6, missingFields: '', recurrenceCount: 0, category: 'ApprovalGap', raisedAt: new Date(Date.now() - 6 * 86400000).toISOString() });
  assert('R-01 PO-460021 gets a riskScore > 0', r.riskScore > 0);
  assert('R-01 riskLevel is defined', ['Critical','High','Medium','Low'].includes(r.riskLevel));
  assert('R-01 agingDays >= 6', r.agingDays >= 6);
}

{
  const r = calculateRisk({ documentType: 'Payment', amount: 124500, agingDays: 9, missingFields: 'amount', recurrenceCount: 2, category: 'DataMismatch', raisedAt: new Date(Date.now() - 9 * 86400000).toISOString() });
  assert('R-02 High-value Payment scores Critical or High', ['Critical','High'].includes(r.riskLevel));
}

{
  const r = calculateRisk({ documentType: 'CashFlow', amount: 100, agingDays: 1, missingFields: '', recurrenceCount: 0, category: 'AgingItem', raisedAt: new Date().toISOString() });
  assert('R-03 Low-value new item scores Low or Medium', ['Low','Medium'].includes(r.riskLevel));
}

{
  const excs = [
    { ID:'E1', status:'Resolved', amount:10000, raisedAt: new Date(Date.now() - 2*86400000).toISOString(), resolvedAt: new Date().toISOString(), recurrenceCount: 0, documentType:'PO', agingDays:2, riskLevel:'Low', slaBreach:false },
    { ID:'E2', status:'Open',     amount:80000, raisedAt: new Date(Date.now() - 5*86400000).toISOString(), recurrenceCount:1, documentType:'Payment', agingDays:5, riskLevel:'High', slaBreach:true },
  ];
  const kpis = portfolioKPIs(excs);
  assert('R-04 portfolioKPIs counts open correctly', kpis.openCount === 1);
  assert('R-04 totalExposure = 80000', kpis.totalExposure === 80000);
  assert('R-04 overdueTotal = 80000 (SLA breached)', kpis.overdueTotal === 80000);
}

// ─── AI EXPLAINER TESTS ───────────────────────────────────────────────────────

console.log('\n=== AI Explainer ===');

{
  const exc = {
    ID: 'EXC-001', documentId: 'PO-460021', documentType: 'PO', amount: 41375,
    businessPartner_id: 'BP-NVC001', requestedDate: '2026-09-06',
    status: 'Open', riskLevel: 'High', riskScore: 62, agingDays: 6, slaBreach: false,
    category: 'ApprovalGap', subcategory: 'PendingManagerApproval',
    signavioStep: 'Approve Purchase Order',
    owner_id: 'USR001', recurrenceCount: 0, missingFields: '',
  };
  const ai = analyse(exc);
  assert('AI-01 Explanation is non-empty string', typeof ai.explanation === 'string' && ai.explanation.length > 20);
  assert('AI-01 NBA array is non-empty', Array.isArray(ai.nba) && ai.nba.length > 0);
  assert('AI-01 Confidence between 0.5 and 1.0', ai.confidence >= 0.5 && ai.confidence <= 1.0);
  assert('AI-01 Evidence list populated', Array.isArray(ai.evidence) && ai.evidence.length > 0);
  assert('AI-01 Signavio deviation index > -1 for known step', ai.signavio.deviationIndex >= 0);
}

{
  const exc = { ID:'EXC-X', documentId:'CF-220019', documentType:'CashFlow', amount:31800,
    status:'Open', riskLevel:'High', riskScore:55, agingDays:21, slaBreach:true, hoursOverdue:120,
    category:'AgingItem', subcategory:'NoOwnerAssigned', owner_id: null, recurrenceCount:0, missingFields:'' };
  const ai = analyse(exc);
  assert('AI-02 Unowned cash flow item recommends Escalation or OwnerAssign first', ['Escalation','OwnerAssign'].includes(ai.topAction.category));
}

{
  const exc = { ID:'EXC-Y', documentId:'PO-460099', documentType:'PO', amount:75000,
    status:'Open', riskLevel:'High', riskScore:70, agingDays:3, slaBreach:false,
    category:'MissingMasterData', subcategory:'MissingCostCentre',
    missingFields:'costCentre', owner_id:'USR001', recurrenceCount:0 };
  const ai = analyse(exc);
  assert('AI-03 Missing data NBA includes FieldCorrection', ai.nba.some(a => a.actionType === 'FieldCorrection'));
}

{
  const exc = { ID:'EXC-Z', documentId:'PAY-780043', documentType:'Payment', amount:124500,
    status:'Open', riskLevel:'Critical', riskScore:88, agingDays:9, slaBreach:false,
    category:'DataMismatch', subcategory:'PaymentAmountMismatch',
    missingFields:'', owner_id:'USR002', recurrenceCount:0 };
  const ai = analyse(exc);
  assert('AI-04 High-value payment includes SAPAPICall with confirmation gate', ai.nba.some(a => a.actionType === 'SAPAPICall' && a.requiresConfirmation === true));
}

// ─── SUMMARY ──────────────────────────────────────────────────────────────────

console.log(`\n════════════════════════════════════`);
console.log(`Results: ${passed} passed · ${failed} failed`);
if (failed > 0) process.exit(1);
else console.log('All tests passed.');
