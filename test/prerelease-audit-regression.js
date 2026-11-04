'use strict';
const assert = require('node:assert/strict');
const { validateReviewedAudit } = require('../scripts/audit-prerelease-dependencies');
const now = new Date('2026-11-04T00:00:00Z');
const report = () => ({ auditReportVersion: 2, metadata: { vulnerabilities: { total: 1 } }, vulnerabilities: {
  'extract-zip': { name: 'extract-zip', nodes: ['node_modules/extract-zip'], via: [{
    name: 'extract-zip', severity: 'high', url: 'https://github.com/advisories/GHSA-jmr9-qjv8-65gv',
  }] },
} });
const lock = { packages: { 'node_modules/extract-zip': { dev: true } } };
const check = (r = report(), l = lock, version = '2.23.4', date = now) => validateReviewedAudit(r, l, version, date);
assert.equal(check().length, 1);
assert.throws(() => check(report(), lock, '2.23.5'), /only/);
assert.throws(() => check(report(), lock, '2.23.4-beta.3'), /only/);
assert.throws(() => check(report(), lock, '2.23.4', new Date('2026-12-04')), /expired/);
assert.throws(() => check({ error: { message: 'registry unavailable' } }), /invalid/);
assert.throws(() => check(report(), { packages: { 'node_modules/extract-zip': {} } }), /production/);
assert.throws(() => check(report(), { packages: {} }), /unknown/);
const unknown = report(); unknown.vulnerabilities['extract-zip'].via[0].url = 'https://github.com/advisories/unknown';
assert.throws(() => check(unknown), /Unreviewed/);
const critical = report(); critical.vulnerabilities['extract-zip'].via[0].severity = 'critical';
assert.throws(() => check(critical), /Unreviewed/);
const unresolved = report(); unresolved.vulnerabilities['extract-zip'].via = ['missing'];
assert.throws(() => check(unresolved), /Unresolved/);
const badCounts = report(); badCounts.metadata.vulnerabilities.total = 0;
assert.throws(() => check(badCounts), /counts/);
console.log('Prerelease audit policy regression checks passed');
