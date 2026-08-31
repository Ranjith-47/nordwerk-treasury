'use strict';

/**
 * Audit Logger
 * Append-only immutable audit trail with SHA-256 hash chains.
 */

const crypto = require('crypto');

function sha256(data) {
  return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
}

/**
 * Build an audit entry.
 * In production, persist to AuditLog entity via CAP.
 */
function buildAuditEntry({ entityType, entityId, action, performedBy, changes, req }) {
  const payload = {
    entityType,
    entityId,
    action,
    performedBy: performedBy || 'SYSTEM',
    timestamp: new Date().toISOString(),
    changes: changes ? JSON.stringify(changes) : null,
    ipAddress: req ? (req.ip || req.headers['x-forwarded-for']) : null,
    sessionId: req ? req.headers['x-session-id'] : null,
  };
  payload.auditHash = sha256(payload);
  return payload;
}

module.exports = { buildAuditEntry, sha256 };
