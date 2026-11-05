'use strict';

// Explicit, time-limited build-tool exceptions for the reviewed 2.23.5 GitHub prerelease.
// This does not change npm audit, dismiss GitHub alerts, or permit runtime flaws.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const reviewed = new Map([
  ['https://github.com/advisories/GHSA-jmr9-qjv8-65gv', ['extract-zip', 'high']],
  ['https://github.com/advisories/GHSA-7pqw-9j4j-h8q3', ['extract-zip', 'high']],
  ['https://github.com/advisories/GHSA-g3hv-75wg-m249', ['minimatch', 'moderate']],
  ['https://github.com/advisories/GHSA-3g3m-2fjr-6pw4', ['glob', 'moderate']],
]);

function validateReviewedAudit(report, lock, version, now = new Date()) {
  if (version !== '2.23.5') throw new Error('Tooling exceptions apply only to 2.23.5');
  if (now >= new Date('2026-12-04T00:00:00Z')) throw new Error('Prerelease tooling review has expired');
  if (report.error || report.auditReportVersion !== 2 || !report.vulnerabilities || !report.metadata?.vulnerabilities) {
    throw new Error('Missing or invalid npm audit report');
  }
  const vulnerabilities = Object.values(report.vulnerabilities);
  if (report.metadata.vulnerabilities.total !== vulnerabilities.length) throw new Error('Inconsistent npm audit counts');
  const accepted = new Set();
  for (const entry of vulnerabilities) {
    if (!Array.isArray(entry.nodes) || !entry.nodes.length || !Array.isArray(entry.via) || !entry.via.length) {
      throw new Error(`Incomplete audit entry: ${entry.name}`);
    }
    for (const node of entry.nodes) {
      if (lock.packages[node]?.dev !== true) throw new Error(`Vulnerable production or unknown package: ${node}`);
    }
    for (const via of entry.via) {
      if (typeof via === 'string') {
        if (!report.vulnerabilities[via]) throw new Error(`Unresolved advisory dependency: ${via}`);
      } else {
        const allowed = reviewed.get(via.url);
        if (!allowed || via.name !== allowed[0] || via.severity !== allowed[1]) {
          throw new Error(`Unreviewed advisory: ${via.url || entry.name}`);
        }
        accepted.add(via.url);
      }
    }
  }
  if (vulnerabilities.length && !accepted.size) throw new Error('Audit has vulnerabilities without reviewed advisories');
  return [...accepted];
}

function main() {
  const root = path.resolve(__dirname, '..');
  const lock = require('../package-lock.json');
  const version = require('../package.json').version;
  // Invoke npm through Node where possible; avoid shell interpolation of output.
  const args = ['audit', '--package-lock-only', '--json'];
  const cli = process.env.npm_execpath;
  const result = cli ? spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8' }) :
    process.platform === 'win32' ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm.cmd audit --package-lock-only --json'], { cwd: root, encoding: 'utf8', windowsHide: true }) :
      spawnSync('npm', args, { cwd: root, encoding: 'utf8' });
  if (result.error || ![0, 1].includes(result.status)) throw result.error || new Error(`npm audit failed: ${result.stderr}`);
  const report = JSON.parse(result.stdout);
  const output = path.join(root, 'dist', 'security-audit.json');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2));
  const accepted = validateReviewedAudit(report, lock, version);
  for (const url of accepted) console.warn(`REVIEWED PRERELEASE BUILD-TOOL RISK (not fixed): ${url}`);
  console.log(`Prerelease audit policy passed; ${accepted.length} reviewed build-tool advisories remain. Full report: ${output}`);
}

if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { validateReviewedAudit };
