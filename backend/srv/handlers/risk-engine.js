'use strict';

/**
 * Risk & Ageing Scoring Engine
 * Computes riskScore, riskLevel, agingDays, slaBreach, overdueValue and priority.
 *
 * Transparent algorithm — all weights are documented and configurable.
 */

const ANNUAL_REVENUE = 780_000_000;

// SLA hours per risk level (mirrors SLAConfig seed data)
const SLA_HOURS = { Critical: 4, High: 24, Medium: 72, Low: 168 };

// Scoring weights (must sum to 1.0 across dimensions)
const WEIGHTS = {
  amount:      0.35, // financial exposure
  aging:       0.30, // time factor
  missingData: 0.20, // data completeness
  recurrence:  0.10, // repeat offender
  docType:     0.05, // document criticality
};

// Document type criticality multipliers
const DOC_TYPE_CRITICALITY = {
  Payment:     1.5,
  CashFlow:    1.4,
  PO:          1.2,
  Invoice:     1.1,
  GoodsReceipt:1.0,
  Contract:    0.9,
};

// Category severity base scores
const CATEGORY_BASE = {
  DataMismatch:     20,
  ApprovalGap:      15,
  MissingMasterData:12,
  AgingItem:        10,
};

/**
 * Calculate aging days from raisedAt to now (or resolvedAt)
 */
function calcAgingDays(raisedAt, resolvedAt = null) {
  if (!raisedAt) return 0;
  const start = new Date(raisedAt);
  const end   = resolvedAt ? new Date(resolvedAt) : new Date();
  const diff  = end - start;
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
}

/**
 * Compute SLA deadline and whether it has been breached
 */
function calcSLA(raisedAt, riskLevel) {
  if (!raisedAt || !riskLevel) return { slaDeadline: null, slaBreach: false, hoursOverdue: 0 };
  const slaHrs = SLA_HOURS[riskLevel] || SLA_HOURS.Low;
  const deadline = new Date(new Date(raisedAt).getTime() + slaHrs * 60 * 60 * 1000);
  const now = new Date();
  const slaBreach = now > deadline;
  const hoursOverdue = slaBreach ? Math.ceil((now - deadline) / (1000 * 60 * 60)) : 0;
  return { slaDeadline: deadline.toISOString(), slaBreach, hoursOverdue };
}

/**
 * Count missing mandatory fields from missingFields string
 */
function countMissingFields(missingFields) {
  if (!missingFields || missingFields.trim() === '') return 0;
  return missingFields.split(',').filter(f => f.trim() !== '').length;
}

/**
 * Main scoring function
 *
 * @param {Object} exc - Exception data
 * @returns {Object} scores: { riskScore, riskLevel, agingDays, slaDeadline, slaBreach, overdueValue, priority, breakdown }
 */
function calculateRisk(exc) {
  const amount       = parseFloat(exc.amount) || 0;
  const agingDays    = calcAgingDays(exc.raisedAt, exc.resolvedAt);
  const missingCount = countMissingFields(exc.missingFields);
  const recurrences  = parseInt(exc.recurrenceCount) || 0;
  const docMult      = DOC_TYPE_CRITICALITY[exc.documentType] || 1.0;
  const catBase      = CATEGORY_BASE[exc.category] || 5;

  // Normalise each dimension to 0–100
  const amountScore    = Math.min(100, (amount / 100_000) * 100);          // £100k = 100
  const agingScore     = Math.min(100, agingDays * 3.33);                   // 30 days = 100
  const missingScore   = Math.min(100, missingCount * 20);                  // 5 missing = 100
  const recurScore     = Math.min(100, recurrences * 25);                   // 4 recurrences = 100
  const docScore       = (docMult - 0.9) / 0.6 * 100;                      // normalise 0.9–1.5 → 0–100

  const weightedScore =
    (amountScore    * WEIGHTS.amount) +
    (agingScore     * WEIGHTS.aging) +
    (missingScore   * WEIGHTS.missingData) +
    (recurScore     * WEIGHTS.recurrence) +
    (docScore       * WEIGHTS.docType);

  const riskScore = Math.min(100, Math.round((weightedScore + catBase) * docMult * 10) / 10);

  const riskLevel =
    riskScore >= 80 ? 'Critical' :
    riskScore >= 50 ? 'High'     :
    riskScore >= 20 ? 'Medium'   : 'Low';

  // SLA (use pre-computed riskLevel)
  const { slaDeadline, slaBreach, hoursOverdue } = calcSLA(exc.raisedAt, riskLevel);

  // Overdue value = amount if SLA breached
  const overdueValue = slaBreach ? amount : 0;

  // Priority index (lower = more urgent in queue)
  // Combines risk score, ageing, and financial weight
  const priority = Math.round(1000 - (riskScore * 7) - (agingDays * 2) - (amount / 10_000));

  // Revenue at risk percentage
  const revenueRiskPct = ((amount / ANNUAL_REVENUE) * 100).toFixed(4);

  const breakdown = {
    amountScore:   Math.round(amountScore),
    agingScore:    Math.round(agingScore),
    missingScore:  Math.round(missingScore),
    recurScore:    Math.round(recurScore),
    docScore:      Math.round(docScore),
    catBase,
    docMultiplier: docMult,
    weights:       WEIGHTS,
    revenueRiskPct,
  };

  return {
    riskScore,
    riskLevel,
    agingDays,
    slaDeadline,
    slaBreach,
    hoursOverdue,
    overdueValue,
    priority,
    breakdown,
  };
}

/**
 * Bulk-score an array of exceptions and sort by priority ascending.
 */
function scoreAndRank(exceptions) {
  return exceptions
    .map(exc => ({ ...exc, ...calculateRisk(exc) }))
    .sort((a, b) => a.priority - b.priority);
}

/**
 * Calculate portfolio-level KPIs from a set of scored exceptions.
 */
function portfolioKPIs(exceptions) {
  const open = exceptions.filter(e => !['Resolved','Closed','Cancelled'].includes(e.status));
  const resolved = exceptions.filter(e => e.status === 'Resolved');

  const totalExposure = open.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
  const overdueTotal  = open.filter(e => e.slaBreach).reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);

  const avgResolutionHours = resolved.length > 0
    ? resolved.reduce((s, e) => {
        if (!e.raisedAt || !e.resolvedAt) return s;
        return s + (new Date(e.resolvedAt) - new Date(e.raisedAt)) / (1000 * 60 * 60);
      }, 0) / resolved.length
    : null;

  const slaCompliant = open.filter(e => !e.slaBreach).length;
  const slaAdherence = open.length > 0 ? ((slaCompliant / open.length) * 100).toFixed(1) : 100;

  const firstPassYield = exceptions.length > 0
    ? ((resolved.filter(e => e.recurrenceCount === 0).length / exceptions.length) * 100).toFixed(1)
    : 100;

  const recurrenceRate = exceptions.length > 0
    ? ((exceptions.filter(e => e.recurrenceCount > 0).length / exceptions.length) * 100).toFixed(1)
    : 0;

  const agingBuckets = {
    '0-3d':  open.filter(e => e.agingDays <= 3).length,
    '3-7d':  open.filter(e => e.agingDays > 3 && e.agingDays <= 7).length,
    '7-14d': open.filter(e => e.agingDays > 7 && e.agingDays <= 14).length,
    '>14d':  open.filter(e => e.agingDays > 14).length,
  };

  const byRiskLevel = {
    Critical: open.filter(e => e.riskLevel === 'Critical').length,
    High:     open.filter(e => e.riskLevel === 'High').length,
    Medium:   open.filter(e => e.riskLevel === 'Medium').length,
    Low:      open.filter(e => e.riskLevel === 'Low').length,
  };

  // Productivity & financial impact estimates
  const productivityGainLow  = totalExposure * 0.20;
  const productivityGainHigh = totalExposure * 0.35;
  const workingCapitalReleaseLow  = overdueTotal * 0.10;
  const workingCapitalReleaseHigh = overdueTotal * 0.20;

  return {
    exceptionCount:        exceptions.length,
    openCount:             open.length,
    resolvedCount:         resolved.length,
    totalExposure:         Math.round(totalExposure * 100) / 100,
    overdueTotal:          Math.round(overdueTotal * 100) / 100,
    revenueAtRiskPct:      ((totalExposure / ANNUAL_REVENUE) * 100).toFixed(3),
    avgResolutionHours:    avgResolutionHours ? Math.round(avgResolutionHours * 10) / 10 : null,
    slaAdherence:          parseFloat(slaAdherence),
    firstPassYield:        parseFloat(firstPassYield),
    recurrenceRate:        parseFloat(recurrenceRate),
    agingBuckets,
    byRiskLevel,
    productivityGainLow:   Math.round(productivityGainLow),
    productivityGainHigh:  Math.round(productivityGainHigh),
    workingCapitalReleaseLow:  Math.round(workingCapitalReleaseLow),
    workingCapitalReleaseHigh: Math.round(workingCapitalReleaseHigh),
  };
}

module.exports = { calculateRisk, scoreAndRank, portfolioKPIs, calcAgingDays, calcSLA, SLA_HOURS };
