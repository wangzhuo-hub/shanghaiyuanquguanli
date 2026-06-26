#!/usr/bin/env node
import { constants } from 'node:fs';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

function printHelp() {
  console.log(`Create a rollout acceptance record from the mobile/field checklist template.

Usage:
  npm run qa:rollout:record -- [--date YYYY-MM-DD] [--env 环境] [--out docs/rollout-records]

Examples:
  npm run qa:rollout:record
  npm run qa:rollout:record -- --date 2026-06-24 --env 阿里云生产
`);
}

function parseArgs(argv) {
  const options = {
    date: null,
    env: '',
    outDir: 'docs/rollout-records',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
    if (arg === '--date') {
      options.date = argv[++i] || '';
      continue;
    }
    if (arg === '--env') {
      options.env = argv[++i] || '';
      continue;
    }
    if (arg === '--out') {
      options.outDir = argv[++i] || '';
      continue;
    }
    console.error(`Unknown option: ${arg}`);
    printHelp();
    process.exit(1);
  }

  return options;
}

function formatShanghaiDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function formatShanghaiTimestamp(date = new Date()) {
  const datePart = formatShanghaiDate(date);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${datePart} ${values.hour}:${values.minute}:${values.second} Asia/Shanghai`;
}

function gitValue(args, fallback = '') {
  const result = spawnSync('git', args, {
    cwd: rootDir,
    encoding: 'utf8',
  });
  if (result.status !== 0) return fallback;
  return result.stdout.trim() || fallback;
}

async function exists(filePath) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function nextAvailablePath(outDir, date) {
  const baseName = `mobile-field-rollout-${date}`;
  let candidate = path.join(outDir, `${baseName}.md`);
  let index = 2;
  while (await exists(candidate)) {
    candidate = path.join(outDir, `${baseName}-${index}.md`);
    index += 1;
  }
  return candidate;
}

const options = parseArgs(process.argv.slice(2));
const rolloutDate = options.date || formatShanghaiDate();

if (!/^\d{4}-\d{2}-\d{2}$/.test(rolloutDate)) {
  console.error(`Invalid --date value: ${rolloutDate}. Expected YYYY-MM-DD.`);
  process.exit(1);
}

if (!options.outDir) {
  console.error('--out cannot be empty.');
  process.exit(1);
}

const templatePath = path.join(rootDir, 'docs/11-移动端与字段口径上线验收记录模板.md');
const outDir = path.resolve(rootDir, options.outDir);
const branch = gitValue(['rev-parse', '--abbrev-ref', 'HEAD'], 'unknown-branch');
const commit = gitValue(['rev-parse', '--short', 'HEAD'], 'unknown-commit');
const generatedAt = formatShanghaiTimestamp();

let content = await readFile(templatePath, 'utf8');
content = content
  .replace('# 移动端与字段口径上线验收记录模板', '# 移动端与字段口径上线验收记录')
  .replace(/^> 使用方式：.*$/m, `> 生成时间：${generatedAt}。\n> 生成命令：\`npm run qa:rollout:record\`。请按实际发布情况补齐截图、接口、dry-run 和灰度观察，不要写入生产账号密码、token、客户敏感信息或原始个人联系方式。`)
  .replace('| 发布日期 | YYYY-MM-DD |', `| 发布日期 | ${rolloutDate} |`)
  .replace('| 代码分支 / Commit |  |', `| 代码分支 / Commit | ${branch} @ ${commit} |`);

if (options.env) {
  content = content.replace('| 部署环境 | 本地 / 测试 / 阿里云生产 |', `| 部署环境 | ${options.env} |`);
}

await mkdir(outDir, { recursive: true });
const outputPath = await nextAvailablePath(outDir, rolloutDate);
await writeFile(outputPath, content, 'utf8');

console.log(`Created rollout record: ${path.relative(rootDir, outputPath)}`);
