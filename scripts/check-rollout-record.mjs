#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { checkMobileScreenshotReport } from './check-mobile-screenshot-report.mjs';

function printHelp() {
  console.log(`Check that a rollout acceptance record has been filled in.

Usage:
  npm run qa:rollout:record:check -- docs/rollout-records/mobile-field-rollout-YYYY-MM-DD.md

The check intentionally focuses on unresolved decision placeholders. Notes and remarks may remain blank when there is nothing useful to add.
`);
}

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  printHelp();
  process.exit(0);
}

const recordPath = args[0];
if (!recordPath) {
  console.error('Missing rollout record path.');
  printHelp();
  process.exit(1);
}

const absolutePath = path.resolve(process.cwd(), recordPath);
let content = '';
try {
  content = await readFile(absolutePath, 'utf8');
} catch (error) {
  console.error(`Unable to read rollout record: ${recordPath}`);
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const failures = [];

function requireIncludes(needle, label) {
  if (!content.includes(needle)) failures.push(`${label}: missing "${needle}"`);
}

function requireNotIncludes(needle, label) {
  if (content.includes(needle)) failures.push(`${label}: unresolved placeholder "${needle}"`);
}

function requireMatch(pattern, label) {
  if (!pattern.test(content)) failures.push(label);
}

requireIncludes('# 移动端与字段口径上线验收记录', 'title');
[
  '## 1. 发布信息',
  '## 2. 自动回归记录',
  '## 3. 移动 / 平板截图 QA',
  '## 4. 字段口径抽查',
  '## 5. 封账明细迁移记录',
  '## 6. 云端接口与迁移记录',
  '## 7. 灰度观察',
  '## 8. 结论',
].forEach((section) => requireIncludes(section, 'section'));

[
  '通过 / 不通过',
  '正常 / 异常',
  '允许 / 暂缓',
  '是 / 否',
  '浅色 / 深色 / 浅色+深色',
  '默认 / 减少动态 / 默认+减少动态',
  '本地 / 测试 / 阿里云生产',
  'YYYY-MM-DD',
].forEach((placeholder) => requireNotIncludes(placeholder, 'placeholder'));

requireMatch(/\| 发布日期 \| \d{4}-\d{2}-\d{2} \|/, 'release date must be filled as YYYY-MM-DD');
requireMatch(/\| 部署环境 \| [^|\s][^|]* \|/, 'deployment environment must be filled');
requireMatch(/\| 代码分支 \/ Commit \| [^|\s][^|]* \|/, 'branch / commit must be filled');
requireMatch(/\| 是否加载登录态 \| 是 \|/, 'mobile screenshot QA must load authenticated storage state');
requireMatch(/\| 是否启用登录后校验 \| 是 \|/, 'mobile screenshot QA must enable authenticated shell verification');
requireMatch(/\| 色彩模式覆盖 \| 浅色\+深色 \|/, 'mobile screenshot QA must cover both light and dark color schemes');
requireMatch(/\| 动态效果覆盖 \| 默认\+减少动态 \|/, 'mobile screenshot QA must cover default and reduced motion preferences');
requireMatch(/\| 截图报告路径 \| [^|\s][^|]* \|/, 'mobile screenshot QA report path must be filled');
requireMatch(/- 是否允许上线：(?!\s*$)\s*(允许|暂缓)/m, 'final launch decision must be filled with 允许 or 暂缓');

const screenshotReportPathMatch = content.match(/\| 截图报告路径 \| ([^|\s][^|]*) \|/);
if (screenshotReportPathMatch) {
  const screenshotReportPath = screenshotReportPathMatch[1].trim();
  const screenshotReportCheck = await checkMobileScreenshotReport(screenshotReportPath);
  if (!screenshotReportCheck.ok) {
    failures.push('mobile screenshot QA report content must prove authenticated light and dark viewport coverage with reduced motion evidence');
    for (const failure of screenshotReportCheck.failures) {
      failures.push(`mobile screenshot report: ${failure}`);
    }
  }
}

[
  '375x812',
  '390x844',
  '430x932',
  '768x1024',
  '1024x768',
  'npm run qa:rollout',
  'npm run qa:mobile-auth-state',
  'npm run qa:mobile-screenshots',
  '--color-scheme both',
  '--reduced-motion both',
  '--require-authenticated',
  'npm run seal:backfill -- --from 2026-01 --to 上月 --dry-run',
  'GET /api/integration/app/preferences/dashboard-custom-fields',
  'PUT /api/integration/app/preferences/dashboard-custom-fields',
  'POST /api/integration/app/compute/tenant-historical-arrears',
].forEach((needle) => requireIncludes(needle, 'required evidence row'));

if (failures.length) {
  console.error(`Rollout record check failed for ${recordPath}:`);
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Rollout record check passed: ${recordPath}`);
