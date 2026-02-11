#!/usr/bin/env node

/**
 * Generate secure random secrets for JWT tokens
 * Usage: node scripts/generate-secrets.js
 */

const crypto = require('crypto');

function generateSecret(length = 64) {
    return crypto.randomBytes(length).toString('base64');
}

console.log('🔐 Generated Secure Secrets for JWT\n');
console.log('Add these to your .env file:\n');
console.log(`JWT_SECRET=${generateSecret()}`);
console.log(`JWT_REFRESH_SECRET=${generateSecret()}`);
console.log('\n⚠️  Keep these secrets secure and never commit them to version control!');
