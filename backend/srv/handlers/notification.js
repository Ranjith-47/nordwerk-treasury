'use strict';

/**
 * Notification Service
 * Handles in-app and email notifications for threshold breaches,
 * SLA violations, escalations and resolution confirmations.
 */

const NOTIFICATION_RULES = [
  { trigger: 'SLABreach',    channel: 'Both',  targetRole: 'TreasuryManager', thresholdAmount: 0 },
  { trigger: 'HighRisk',     channel: 'InApp', targetRole: 'TreasuryAnalyst', thresholdAmount: 50_000 },
  { trigger: 'Escalation',   channel: 'Both',  targetRole: 'CFO',             thresholdAmount: 100_000 },
  { trigger: 'Resolved',     channel: 'InApp', targetRole: 'TreasuryAnalyst', thresholdAmount: 0 },
];

function buildSubject(exc, trigger) {
  return `[Nordwerk Treasury] ${trigger}: ${exc.documentId} · £${parseFloat(exc.amount).toLocaleString('en-GB')} · Risk: ${exc.riskLevel}`;
}

function buildBody(exc, trigger) {
  return [
    `Document: ${exc.documentId}`,
    `Type: ${exc.documentType}`,
    `Amount: £${parseFloat(exc.amount).toLocaleString('en-GB', { minimumFractionDigits: 2 })}`,
    `Business Partner: ${exc.businessPartner_id}`,
    `Risk Level: ${exc.riskLevel} (score ${exc.riskScore})`,
    `Ageing: ${exc.agingDays} day(s)`,
    `SLA Breached: ${exc.slaBreach ? 'YES' : 'No'}`,
    `Status: ${exc.status}`,
    `Trigger: ${trigger}`,
    `Action Required: ${exc.nextBestAction || 'Review exception immediately'}`,
    '',
    `View in Treasury App: http://localhost:3000/exceptions/${exc.ID}`,
  ].join('\n');
}

/**
 * Determine which notifications should fire for a given exception state change.
 * Returns array of notification objects (not yet persisted).
 */
function computeNotifications(exc, trigger) {
  const amount = parseFloat(exc.amount) || 0;
  return NOTIFICATION_RULES
    .filter(rule => {
      if (rule.trigger !== trigger) return false;
      if (rule.thresholdAmount > 0 && amount < rule.thresholdAmount) return false;
      return true;
    })
    .map(rule => ({
      exception_ID:       exc.ID,
      channel:            rule.channel,
      recipientRole:      rule.targetRole,
      subject:            buildSubject(exc, trigger),
      body:               buildBody(exc, trigger),
      thresholdBreached:  `${trigger} · £${amount.toLocaleString('en-GB')}`,
      delivered:          false,
      sentAt:             new Date().toISOString(),
    }));
}

/**
 * Mock send — in production, replace with BTP Alert Notification Service / nodemailer
 */
async function sendNotification(notification) {
  // Simulate delivery
  console.log(`[Notification] ${notification.channel} → ${notification.recipientRole}: ${notification.subject}`);
  notification.delivered = true;
  return notification;
}

module.exports = { computeNotifications, sendNotification };
