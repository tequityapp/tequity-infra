#!/usr/bin/env node

const { execFileSync } = require('node:child_process');
const { existsSync, readFileSync } = require('node:fs');

const RULES = [
  {
    name: 'github-token',
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/g,
  },
  {
    name: 'aws-access-key',
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  },
  {
    name: 'private-key',
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
  },
  {
    name: 'live-payment-key',
    pattern: /\bsk_live_[A-Za-z0-9]{16,}\b/g,
  },
  {
    name: 'jwt',
    pattern: /\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g,
  },
  {
    name: 'secret-assignment',
    pattern:
      /\b(?:api[_-]?key|api[_-]?secret|password|private[_-]?key|secret|token)\b\s*[:=]\s*["']([A-Za-z0-9+/_=-]{24,})["']/gi,
  },
];

function lineNumberAt(text, offset) {
  return text.slice(0, offset).split('\n').length;
}

function scanText(path, text) {
  const findings = [];
  for (const rule of RULES) {
    const pattern = new RegExp(rule.pattern.source, rule.pattern.flags);
    for (const match of text.matchAll(pattern)) {
      findings.push({
        path,
        line: lineNumberAt(text, match.index ?? 0),
        rule: rule.name,
      });
    }
  }
  return findings;
}

function trackedFiles() {
  return execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    },
  )
    .split('\0')
    .filter(Boolean);
}

function main() {
  const findings = [];
  for (const path of trackedFiles()) {
    if (!existsSync(path)) continue;
    const contents = readFileSync(path);
    if (contents.includes(0)) continue;
    findings.push(...scanText(path, contents.toString('utf8')));
  }

  if (findings.length > 0) {
    for (const finding of findings) {
      process.stderr.write(`${finding.path}:${finding.line}: ${finding.rule}\n`);
    }
    process.exitCode = 1;
    return;
  }
  process.stdout.write('Secret policy scan passed for all tracked text files.\n');
}

module.exports = { scanText };

if (require.main === module) main();
