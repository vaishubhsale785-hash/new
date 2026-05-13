// src/config/helpers.js
// Shared utility functions used across routes

const crypto = require('crypto');

/**
 * Generate a unique referral code from tg_id
 */
function generateReferralCode(tg_id) {
  const hash = crypto
    .createHash('md5')
    .update(tg_id + Date.now() + Math.random().toString())
    .digest('hex')
    .toUpperCase()
    .substring(0, 8);
  return `REF${hash}`;
}

/**
 * Format a decimal number to 2dp string
 */
function fmt(num) {
  return parseFloat(num || 0).toFixed(2);
}

/**
 * Format a date to 'DD Mon YYYY'
 */
function fmtDate(d) {
  return new Date(d).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

module.exports = { generateReferralCode, fmt, fmtDate };
