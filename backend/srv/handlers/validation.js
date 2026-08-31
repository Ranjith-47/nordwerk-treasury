'use strict';

/**
 * Validation Engine
 * Handles all field-level, format, document-relationship and business-rule validation
 * for Nordwerk Treasury Exception Management.
 *
 * Each validator returns: { valid: Boolean, errors: ValidationMessage[] }
 * ValidationMessage: { severity, field, code, message, suggestion }
 */

const REQUIRED_FIELDS = {
  PO:          ['companyCode', 'plant', 'storageLocation', 'costCentre', 'material', 'businessPartner', 'documentId', 'amount', 'requestedDate'],
  Payment:     ['companyCode', 'plant', 'businessPartner', 'documentId', 'amount', 'requestedDate', 'postingDate'],
  CashFlow:    ['companyCode', 'documentId', 'amount', 'requestedDate'],
  Invoice:     ['companyCode', 'plant', 'storageLocation', 'material', 'businessPartner', 'documentId', 'amount', 'requestedDate'],
  GoodsReceipt:['companyCode', 'plant', 'storageLocation', 'material', 'documentId', 'amount', 'requestedDate'],
  Contract:    ['companyCode', 'businessPartner', 'documentId', 'amount', 'requestedDate'],
};

const DOCUMENT_PATTERNS = {
  PO:          /^PO-\d{6,}$/,
  Payment:     /^PAY-\d{6,}$/,
  CashFlow:    /^CF-\d{6,}$/,
  Invoice:     /^INV-\d{6,}$/,
  GoodsReceipt:/^GR-\d{6,}$/,
  Contract:    /^CON-\d{6,}$/,
};

const VALID_COMPANY_CODES = ['1100', '1200'];
const VALID_PLANTS = { '1100': ['1103', '1104'], '1200': ['1201'] };
const VALID_STORAGE_LOCS = ['SL10', 'SL20', 'SL30', 'SL40'];
const MAX_AMOUNT_GBP = 10_000_000;
const MIN_AMOUNT_GBP = 0.01;
const ANNUAL_REVENUE  = 780_000_000;
const HIGH_VALUE_THRESHOLD = 50_000;

// ─── HELPER ──────────────────────────────────────────────────────────────────

function err(field, code, message, suggestion = null) {
  return { severity: 'E', field, code, message, suggestion };
}
function warn(field, code, message, suggestion = null) {
  return { severity: 'W', field, code, message, suggestion };
}
function info(field, code, message) {
  return { severity: 'I', field, code, message };
}

function isBlank(v) {
  return v === null || v === undefined || String(v).trim() === '';
}

function isValidDate(str) {
  if (!str) return false;
  const d = new Date(str);
  return !isNaN(d.getTime());
}

function parseDate(str) { return new Date(str); }

// ─── 1. MANDATORY FIELD VALIDATION ───────────────────────────────────────────

function validateMandatoryFields(data) {
  const messages = [];
  const docType = data.documentType;
  const required = REQUIRED_FIELDS[docType] || [];

  for (const field of required) {
    if (isBlank(data[field]) || isBlank(data[`${field}_code`]) || isBlank(data[`${field}_id`])) {
      // resolve nested association key
      const hasValue = !isBlank(data[field]) || !isBlank(data[`${field}_code`]) || !isBlank(data[`${field}_id`]);
      if (!hasValue) {
        messages.push(err(field, 'MISSING_MANDATORY',
          `Field '${field}' is mandatory for document type ${docType} but is missing.`,
          `Provide a valid ${field} to proceed.`
        ));
      }
    }
  }

  // documentType itself must be set
  if (isBlank(docType)) {
    messages.push(err('documentType', 'MISSING_DOCTYPE',
      'Document type is required.',
      'Set documentType to one of: PO, Payment, CashFlow, Invoice, GoodsReceipt, Contract.'
    ));
  }

  return messages;
}

// ─── 2. FORMAT VALIDATION ────────────────────────────────────────────────────

function validateFormats(data) {
  const messages = [];

  // Document ID format
  if (!isBlank(data.documentId) && !isBlank(data.documentType)) {
    const pattern = DOCUMENT_PATTERNS[data.documentType];
    if (pattern && !pattern.test(data.documentId)) {
      messages.push(err('documentId', 'INVALID_DOC_FORMAT',
        `Document ID '${data.documentId}' does not match expected format for ${data.documentType}.`,
        `Expected format: ${pattern.toString()}. Example: ${data.documentType === 'PO' ? 'PO-460021' : data.documentType + '-000001'}`
      ));
    }
  }

  // Amount validations
  const amount = parseFloat(data.amount);
  if (!isNaN(amount)) {
    if (amount < MIN_AMOUNT_GBP) {
      messages.push(err('amount', 'AMOUNT_TOO_LOW',
        `Amount £${amount} is below minimum threshold £${MIN_AMOUNT_GBP}.`,
        'Verify the amount. If intentional, flag for manual review.'
      ));
    }
    if (amount > MAX_AMOUNT_GBP) {
      messages.push(err('amount', 'AMOUNT_EXCEEDS_MAX',
        `Amount £${amount.toLocaleString()} exceeds single-document maximum £${MAX_AMOUNT_GBP.toLocaleString()}.`,
        'Split into multiple documents or obtain CFO approval for override.'
      ));
    }
    if (amount > HIGH_VALUE_THRESHOLD) {
      messages.push(warn('amount', 'HIGH_VALUE_WARNING',
        `Amount £${amount.toLocaleString()} exceeds £${HIGH_VALUE_THRESHOLD.toLocaleString()} — high-value approval required.`,
        'Ensure manager approval is obtained before processing.'
      ));
    }
    const revenuePercent = (amount / ANNUAL_REVENUE) * 100;
    if (revenuePercent > 1) {
      messages.push(warn('amount', 'REVENUE_RISK',
        `Amount represents ${revenuePercent.toFixed(2)}% of annual revenue (£780M). Elevated exposure risk.`,
        'Escalate to Treasury Manager for review.'
      ));
    }
  } else if (!isBlank(data.amount)) {
    messages.push(err('amount', 'INVALID_AMOUNT_FORMAT',
      `Amount '${data.amount}' is not a valid number.`,
      'Provide a numeric value in GBP (e.g. 41375.00).'
    ));
  }

  // Currency
  if (!isBlank(data.currency) && !['GBP', 'EUR', 'USD'].includes(data.currency)) {
    messages.push(warn('currency', 'UNSUPPORTED_CURRENCY',
      `Currency '${data.currency}' is not in the supported list (GBP, EUR, USD).`,
      'Confirm currency code with Finance before posting.'
    ));
  }

  // Date validations
  if (!isBlank(data.requestedDate) && !isValidDate(data.requestedDate)) {
    messages.push(err('requestedDate', 'INVALID_DATE_FORMAT',
      `Requested date '${data.requestedDate}' is not a valid date.`,
      'Use ISO 8601 format: YYYY-MM-DD.'
    ));
  }
  if (!isBlank(data.postingDate) && !isValidDate(data.postingDate)) {
    messages.push(err('postingDate', 'INVALID_POSTING_DATE',
      `Posting date '${data.postingDate}' is not a valid date.`,
      'Use ISO 8601 format: YYYY-MM-DD.'
    ));
  }
  if (!isBlank(data.dueDate) && !isValidDate(data.dueDate)) {
    messages.push(err('dueDate', 'INVALID_DUE_DATE',
      `Due date '${data.dueDate}' is not a valid date.`,
      'Use ISO 8601 format: YYYY-MM-DD.'
    ));
  }

  return messages;
}

// ─── 3. BUSINESS RULE VALIDATION ────────────────────────────────────────────

function validateBusinessRules(data) {
  const messages = [];
  const now = new Date();

  // Rule BR-01: Company Code must be valid
  if (!isBlank(data.companyCode_code) && !VALID_COMPANY_CODES.includes(data.companyCode_code)) {
    messages.push(err('companyCode', 'INVALID_COMPANY_CODE',
      `Company code '${data.companyCode_code}' is not a valid Nordwerk entity.`,
      `Valid codes: ${VALID_COMPANY_CODES.join(', ')}.`
    ));
  }

  // Rule BR-02: Plant must belong to Company Code
  if (!isBlank(data.companyCode_code) && !isBlank(data.plant_code)) {
    const allowedPlants = VALID_PLANTS[data.companyCode_code] || [];
    if (!allowedPlants.includes(data.plant_code)) {
      messages.push(err('plant', 'PLANT_COMPANY_MISMATCH',
        `Plant '${data.plant_code}' does not belong to company code '${data.companyCode_code}'.`,
        `Valid plants for ${data.companyCode_code}: ${allowedPlants.join(', ')}.`
      ));
    }
  }

  // Rule BR-03: Storage location must be valid
  if (!isBlank(data.storageLocation) && !VALID_STORAGE_LOCS.includes(data.storageLocation)) {
    messages.push(warn('storageLocation', 'UNKNOWN_STORAGE_LOCATION',
      `Storage location '${data.storageLocation}' is not in the known list.`,
      `Known locations: ${VALID_STORAGE_LOCS.join(', ')}. Verify with Logistics.`
    ));
  }

  // Rule BR-04: Requested date cannot be in the past by > 90 days
  if (isValidDate(data.requestedDate)) {
    const reqDate = parseDate(data.requestedDate);
    const daysDiff = (now - reqDate) / (1000 * 60 * 60 * 24);
    if (daysDiff > 90) {
      messages.push(warn('requestedDate', 'STALE_REQUESTED_DATE',
        `Requested date is ${Math.floor(daysDiff)} days in the past. This may be a stale record.`,
        'Confirm whether the requested date should be updated before processing.'
      ));
    }
  }

  // Rule BR-05: Posting date cannot be future-dated
  if (isValidDate(data.postingDate)) {
    const postDate = parseDate(data.postingDate);
    if (postDate > now) {
      messages.push(err('postingDate', 'FUTURE_POSTING_DATE',
        `Posting date '${data.postingDate}' is in the future. SAP does not allow future posting dates.`,
        'Use today or a past date for posting.'
      ));
    }
  }

  // Rule BR-06: Due date must not be before requested date
  if (isValidDate(data.requestedDate) && isValidDate(data.dueDate)) {
    if (parseDate(data.dueDate) < parseDate(data.requestedDate)) {
      messages.push(err('dueDate', 'DUE_BEFORE_REQUESTED',
        `Due date '${data.dueDate}' is before requested date '${data.requestedDate}'.`,
        'Due date must be on or after the requested date.'
      ));
    }
  }

  // Rule BR-07: PO cannot be self-approved (same user as owner and approver)
  if (!isBlank(data.owner_id) && !isBlank(data.approvedBy_id) &&
      data.owner_id === data.approvedBy_id && data.documentType === 'PO') {
    messages.push(err('approvedBy', 'SELF_APPROVAL_PROHIBITED',
      'PO owner and approver cannot be the same person. Self-approval is not permitted.',
      'Assign a different user as approver (minimum: Treasury Manager role).'
    ));
  }

  // Rule BR-08: High-value PO requires manager owner
  if (data.documentType === 'PO' && parseFloat(data.amount) > HIGH_VALUE_THRESHOLD) {
    if (!isBlank(data.owner_id) && data.owner_role === 'TreasuryAnalyst') {
      messages.push(warn('owner', 'HIGH_VALUE_ANALYST_OWNER',
        `PO value £${parseFloat(data.amount).toLocaleString()} exceeds £${HIGH_VALUE_THRESHOLD.toLocaleString()}. Analyst cannot be sole owner.`,
        'Co-assign a Treasury Manager as secondary owner.'
      ));
    }
  }

  // Rule BR-09: Escalated items must have escalation target
  if (data.status === 'Escalated' && isBlank(data.escalatedTo_id)) {
    messages.push(err('escalatedTo', 'ESCALATION_TARGET_MISSING',
      "Status is 'Escalated' but no escalation target user is assigned.",
      'Assign an escalation target (Treasury Manager or CFO) before saving.'
    ));
  }

  // Rule BR-10: Resolved status requires resolution notes
  if (data.status === 'Resolved' && isBlank(data.resolutionNotes)) {
    messages.push(err('resolutionNotes', 'RESOLUTION_NOTES_REQUIRED',
      "Resolution notes are mandatory when closing an exception as 'Resolved'.",
      'Add a brief description of the action taken and outcome achieved.'
    ));
  }

  // Rule BR-11: Cancelled status requires a comment
  if (data.status === 'Cancelled' && isBlank(data.resolutionNotes)) {
    messages.push(err('resolutionNotes', 'CANCEL_REASON_REQUIRED',
      "A cancellation reason is required when setting status to 'Cancelled'.",
      'Document why this exception is being cancelled for audit purposes.'
    ));
  }

  // Rule BR-12: Payment amount mismatch check (if referenceAmount provided)
  if (data.documentType === 'Payment' && !isBlank(data.referenceAmount)) {
    const payAmt = parseFloat(data.amount);
    const refAmt = parseFloat(data.referenceAmount);
    if (!isNaN(payAmt) && !isNaN(refAmt)) {
      const diff = Math.abs(payAmt - refAmt);
      const tolerancePct = 0.001; // 0.1% tolerance
      if (diff / refAmt > tolerancePct) {
        messages.push(err('amount', 'PAYMENT_AMOUNT_MISMATCH',
          `Payment amount £${payAmt.toLocaleString()} differs from reference £${refAmt.toLocaleString()} by £${diff.toLocaleString()} (${((diff/refAmt)*100).toFixed(2)}%).`,
          'Reconcile with the originating invoice before posting payment.'
        ));
      }
    }
  }

  // Rule BR-13: Cash flow item without owner flagged as critical risk
  if (data.documentType === 'CashFlow' && isBlank(data.owner_id)) {
    messages.push(warn('owner', 'CASHFLOW_NO_OWNER',
      'Cash flow item has no assigned owner. Forecasting accuracy may be impacted.',
      'Assign a Treasury Analyst as owner immediately.'
    ));
  }

  return messages;
}

// ─── 4. DOCUMENT RELATIONSHIP VALIDATION ─────────────────────────────────────

function validateDocumentRelationships(data, relatedDocuments = {}) {
  const messages = [];

  // Check that PO references valid GR (if GR provided)
  if (data.documentType === 'PO' && relatedDocuments.goodsReceipt) {
    const gr = relatedDocuments.goodsReceipt;
    if (gr.plant_code !== data.plant_code) {
      messages.push(err('documentId', 'GR_PLANT_MISMATCH',
        `Goods Receipt plant '${gr.plant_code}' does not match PO plant '${data.plant_code}'.`,
        'Ensure Goods Receipt is posted to the same plant as the Purchase Order.'
      ));
    }
    if (gr.material_code !== data.material_code) {
      messages.push(err('material', 'GR_MATERIAL_MISMATCH',
        `Goods Receipt material '${gr.material_code}' differs from PO material '${data.material_code}'.`,
        'Verify material codes match across PO and GR.'
      ));
    }
  }

  // Payment must reference an invoice
  if (data.documentType === 'Payment' && !relatedDocuments.invoice) {
    messages.push(warn('documentId', 'PAYMENT_NO_INVOICE_LINK',
      'Payment document has no linked invoice. Three-way match cannot be completed.',
      'Link the originating invoice document before processing payment.'
    ));
  }

  // Invoice must reference a PO for B2B
  if (data.documentType === 'Invoice' && !relatedDocuments.purchaseOrder) {
    messages.push(warn('documentId', 'INVOICE_NO_PO_LINK',
      'Invoice has no linked Purchase Order. Cannot verify against approved procurement.',
      'Provide the originating PO reference.'
    ));
  }

  return messages;
}

// ─── 5. PROCESS COMPLIANCE VALIDATION ────────────────────────────────────────

function validateProcessCompliance(data) {
  const messages = [];

  // Signavio step: if status is Blocked but no signavioStep
  if (data.status === 'Open' && isBlank(data.signavioStep)) {
    messages.push(info('signavioStep', 'SIGNAVIO_STEP_MISSING',
      'Signavio process step not mapped. Exception cannot be linked to process deviation report.'
    ));
  }

  // Overdue SLA
  if (data.slaDeadline && !isBlank(data.slaDeadline)) {
    const now = new Date();
    const sla = new Date(data.slaDeadline);
    if (now > sla && !['Resolved', 'Closed', 'Cancelled'].includes(data.status)) {
      const hoursOverdue = Math.ceil((now - sla) / (1000 * 60 * 60));
      messages.push(err('slaDeadline', 'SLA_BREACHED',
        `SLA deadline was ${sla.toISOString()} — now ${hoursOverdue} hour(s) overdue.`,
        'Immediate action required. Escalate to Treasury Manager.'
      ));
    }
  }

  return messages;
}

// ─── MAIN ENTRY POINT ─────────────────────────────────────────────────────────

/**
 * Runs the full validation pipeline for a treasury exception record.
 *
 * @param {Object} data           - Exception data object
 * @param {Object} relatedDocs    - Optional: { goodsReceipt, invoice, purchaseOrder }
 * @returns {{ valid: Boolean, errors: Array, warnings: Array, infos: Array, missingFields: String }}
 */
function validate(data, relatedDocs = {}) {
  const allMessages = [
    ...validateMandatoryFields(data),
    ...validateFormats(data),
    ...validateBusinessRules(data),
    ...validateDocumentRelationships(data, relatedDocs),
    ...validateProcessCompliance(data),
  ];

  const errors   = allMessages.filter(m => m.severity === 'E');
  const warnings = allMessages.filter(m => m.severity === 'W');
  const infos    = allMessages.filter(m => m.severity === 'I');

  const missingFields = allMessages
    .filter(m => m.code.startsWith('MISSING_'))
    .map(m => m.field)
    .join(', ');

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    infos,
    allMessages,
    missingFields,
    summary: `${errors.length} error(s), ${warnings.length} warning(s), ${infos.length} info(s)`,
  };
}

/**
 * Validates only the fields included in a partial update (PATCH).
 * Runs relevant rule subsets without penalising absent fields.
 */
function validatePatch(patchData, existingData) {
  const merged = { ...existingData, ...patchData };
  // Only run format + business rules — skip mandatory (partial update is allowed)
  const allMessages = [
    ...validateFormats(patchData),
    ...validateBusinessRules(merged),
    ...validateProcessCompliance(merged),
  ];
  const errors   = allMessages.filter(m => m.severity === 'E');
  const warnings = allMessages.filter(m => m.severity === 'W');
  return { valid: errors.length === 0, errors, warnings, allMessages };
}

module.exports = { validate, validatePatch, validateMandatoryFields, validateFormats, validateBusinessRules };
