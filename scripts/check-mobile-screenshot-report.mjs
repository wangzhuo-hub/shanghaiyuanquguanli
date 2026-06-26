#!/usr/bin/env node
import { access, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const expectedViewports = [
  '375x812-dashboard',
  '390x844-more-filter',
  '430x932-building-budget',
  '768x1024-tablet-portrait',
  '1024x768-tablet-landscape',
];

const expectedColorSchemes = ['light', 'dark'];
const expectedReducedMotionModes = ['no-preference', 'reduce'];

function printHelp() {
  console.log(`Check a mobile screenshot QA report for rollout-ready evidence.

Usage:
  npm run qa:mobile-screenshot-report -- output/mobile-screenshot-qa/20260624-120000/README.md
  npm run qa:mobile-screenshot-report -- output/mobile-screenshot-qa/20260624-120000/report.json

The report must prove authenticated light + dark screenshots, default + reduced motion, for all five required mobile/tablet viewports.
`);
}

function resolveReportJsonPath(inputPath) {
  const absolutePath = path.resolve(process.cwd(), inputPath);
  if (path.basename(absolutePath) === 'report.json') return absolutePath;
  return path.join(path.dirname(absolutePath), 'report.json');
}

async function pathExists(absolutePath) {
  try {
    await access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

function getRecordKey(record) {
  return `${record.colorScheme}:${record.reducedMotion}:${record.key}`;
}

async function validateScreenshotRecord(record, reportDir, failures) {
  const label = `${record.colorScheme} ${record.reducedMotion} ${record.key}`;
  if (record.ok !== true) failures.push(`${label}: screenshot record is not marked ok`);
  if (record.exitCode !== 0) failures.push(`${label}: screenshot command exitCode is ${record.exitCode}`);
  if (record.authenticated !== true) failures.push(`${label}: screenshot was not captured with authenticated storage state`);
  if (!expectedReducedMotionModes.includes(record.reducedMotion)) failures.push(`${label}: reducedMotion must be no-preference or reduce`);
  if (!Number.isFinite(record.size) || record.size <= 1024) failures.push(`${label}: screenshot size is too small or missing`);

  const screenshotCandidate = record.relativePath
    ? path.resolve(process.cwd(), record.relativePath)
    : record.path
      ? path.resolve(reportDir, record.path)
      : '';

  if (!screenshotCandidate) {
    failures.push(`${label}: screenshot path is missing`);
    return;
  }

  if (!(await pathExists(screenshotCandidate))) {
    failures.push(`${label}: screenshot file does not exist at ${screenshotCandidate}`);
    return;
  }

  const fileStat = await stat(screenshotCandidate);
  if (!fileStat.isFile()) {
    failures.push(`${label}: screenshot path is not a file`);
    return;
  }
  if (fileStat.size <= 1024) failures.push(`${label}: screenshot file is too small`);
}

export async function checkMobileScreenshotReport(inputPath) {
  const reportPath = resolveReportJsonPath(inputPath);
  const reportDir = path.dirname(reportPath);
  const failures = [];

  let report;
  try {
    report = JSON.parse(await readFile(reportPath, 'utf8'));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      reportPath,
      failures: [`unable to read or parse report.json: ${reason}`],
    };
  }

  if (report.colorScheme !== 'both') {
    failures.push('report colorScheme must be "both"');
  }
  if (report.reducedMotion !== 'both') {
    failures.push('report reducedMotion must be "both"');
  }
  if (!report.storageState) {
    failures.push('report must include a non-empty storageState');
  }
  if (report.requireAuthenticated !== true) {
    failures.push('report must be captured with requireAuthenticated=true');
  }
  if (!report.authenticatedSelector) {
    failures.push('report must include the authenticatedSelector used for logged-in shell verification');
  }
  if (!Array.isArray(report.records)) {
    failures.push('report.records must be an array');
    return { ok: false, reportPath, failures };
  }

  const recordMap = new Map(report.records.map((record) => [getRecordKey(record), record]));
  for (const colorScheme of expectedColorSchemes) {
    for (const reducedMotion of expectedReducedMotionModes) {
      for (const viewportKey of expectedViewports) {
        const key = `${colorScheme}:${reducedMotion}:${viewportKey}`;
        const record = recordMap.get(key);
        if (!record) {
          failures.push(`${key}: required screenshot record is missing`);
          continue;
        }
        await validateScreenshotRecord(record, reportDir, failures);
      }
    }
  }

  const expectedRecordCount = expectedViewports.length * expectedColorSchemes.length * expectedReducedMotionModes.length;
  if (report.records.length < expectedRecordCount) {
    failures.push(`report must contain at least ${expectedRecordCount} records, found ${report.records.length}`);
  }

  return {
    ok: failures.length === 0,
    reportPath,
    failures,
  };
}

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  printHelp();
  process.exit(0);
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const inputPath = args[0];
  if (!inputPath) {
    console.error('Missing mobile screenshot report path.');
    printHelp();
    process.exit(1);
  }

  const result = await checkMobileScreenshotReport(inputPath);
  if (!result.ok) {
    console.error(`Mobile screenshot report check failed for ${inputPath}:`);
    for (const failure of result.failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log(`Mobile screenshot report check passed: ${inputPath}`);
}
