'use strict';

/**
 * Error Handler & Retry Middleware
 * Provides graceful error handling, SAP service unavailability detection,
 * and structured error responses.
 */

const SAP_ERROR_CODES = new Set([
  'ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'EHOSTUNREACH',
]);

// HTTP status → user-facing category
const STATUS_MAP = {
  400: { category: 'ValidationError',    retryable: false },
  401: { category: 'AuthenticationError',retryable: false },
  403: { category: 'AuthorisationError', retryable: false },
  404: { category: 'NotFound',           retryable: false },
  409: { category: 'ConflictError',      retryable: false },
  422: { category: 'BusinessRuleError',  retryable: false },
  429: { category: 'RateLimitError',     retryable: true  },
  500: { category: 'InternalError',      retryable: true  },
  502: { category: 'GatewayError',       retryable: true  },
  503: { category: 'ServiceUnavailable', retryable: true  },
  504: { category: 'GatewayTimeout',     retryable: true  },
};

function classify(err) {
  if (err.status || err.statusCode) {
    const code = err.status || err.statusCode;
    return { ...(STATUS_MAP[code] || { category: 'UnknownError', retryable: false }), httpStatus: code };
  }
  if (SAP_ERROR_CODES.has(err.code)) {
    return { category: 'SAPServiceUnavailable', retryable: true, httpStatus: 503 };
  }
  if (err.name === 'ValidationError') {
    return { category: 'ValidationError', retryable: false, httpStatus: 422 };
  }
  return { category: 'InternalError', retryable: true, httpStatus: 500 };
}

/**
 * Express error handler middleware
 */
function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  const { category, retryable, httpStatus } = classify(err);

  const body = {
    error: {
      category,
      message: err.message || 'An unexpected error occurred.',
      retryable,
      timestamp: new Date().toISOString(),
      requestId: req.headers['x-request-id'] || null,
    },
  };

  // Attach validation details if present
  if (err.validationErrors) {
    body.error.validationErrors = err.validationErrors;
  }

  // SAP-specific guidance
  if (category === 'SAPServiceUnavailable') {
    body.error.sapGuidance = {
      message: 'SAP OData service is currently unavailable. The application is operating on cached data.',
      fallback: 'You can continue working offline. Changes will sync when connectivity is restored.',
      suggestedAction: 'Check BTP Connectivity Service status or retry in a few minutes.',
    };
  }

  if (process.env.NODE_ENV !== 'production') {
    body.error.stack = err.stack;
  }

  res.status(httpStatus).json(body);
}

/**
 * Retry wrapper for SAP OData calls
 * @param {Function} fn      - Async function to retry
 * @param {Object}   opts    - { maxAttempts, delayMs, backoffFactor }
 */
async function withRetry(fn, opts = {}) {
  const { maxAttempts = 3, delayMs = 500, backoffFactor = 2 } = opts;
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const { retryable } = classify(err);
      if (!retryable || attempt === maxAttempts) throw err;
      const wait = delayMs * Math.pow(backoffFactor, attempt - 1);
      await new Promise(r => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

/**
 * Wrap a SAP OData call with fallback to cached/mock data
 */
async function sapCallWithFallback(sapFn, fallbackFn, context = '') {
  try {
    return await withRetry(sapFn);
  } catch (err) {
    console.warn(`[SAP Fallback] ${context}: ${err.message}. Using fallback data.`);
    return {
      data: await fallbackFn(),
      _sapUnavailable: true,
      _fallbackUsed: true,
      _reason: err.message,
    };
  }
}

module.exports = { errorHandler, withRetry, sapCallWithFallback, classify };
