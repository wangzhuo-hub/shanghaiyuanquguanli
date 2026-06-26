import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const rootDir = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const tempDirs: string[] = [];

function makeTempDir() {
  const dir = mkdtempSync(path.join(tmpdir(), 'kingdee-rollout-record-test-'));
  tempDirs.push(dir);
  return dir;
}

function runNode(args: string[]) {
  return spawnSync(process.execPath, args, {
    cwd: rootDir,
    encoding: 'utf8',
    env: {
      ...process.env,
      TZ: 'Asia/Shanghai',
    },
  });
}

const requiredScreenshotViewports = [
  '375x812-dashboard',
  '390x844-more-filter',
  '430x932-building-budget',
  '768x1024-tablet-portrait',
  '1024x768-tablet-landscape',
];

function writeValidScreenshotReport(baseDir: string) {
  const reportDir = path.join(baseDir, 'mobile-screenshot-report');
  mkdirSync(reportDir, { recursive: true });
  const records = requiredScreenshotViewports.flatMap((key) =>
    ['light', 'dark'].flatMap((colorScheme) =>
      ['no-preference', 'reduce'].map((reducedMotion) => {
        const motionName = reducedMotion === 'reduce' ? 'reduced-motion' : 'default-motion';
        const filename = `${colorScheme}-${motionName}-${key}.png`;
        const screenshotPath = path.join(reportDir, filename);
        writeFileSync(screenshotPath, Buffer.alloc(2048, 1));
        return {
          key,
          width: Number(key.split('x')[0]),
          height: Number(key.split('x')[1].split('-')[0]),
          focus: '测试视口',
          colorScheme,
          reducedMotion,
          authenticated: true,
          filename,
          path: screenshotPath,
          ok: true,
          exitCode: 0,
          durationMs: 10,
          size: 2048,
          stdout: '',
          stderr: '',
        };
      }),
    ),
  );
  writeFileSync(path.join(reportDir, 'README.md'), '# 移动端截图 QA 记录\n', 'utf8');
  writeFileSync(path.join(reportDir, 'report.json'), `${JSON.stringify({
    generatedAt: '2026/06/24 12:00:00',
    url: 'http://127.0.0.1:5173/',
    outDir: reportDir,
    colorScheme: 'both',
    reducedMotion: 'both',
    storageState: 'output/mobile-auth-state/auth-state.json',
    requireAuthenticated: true,
    authenticatedSelector: '[title="退出登录"]',
    fullPage: false,
    records,
  }, null, 2)}\n`, 'utf8');
  return path.join(reportDir, 'README.md');
}

function fillRequiredDecisionPlaceholders(filePath: string, screenshotReportPath: string) {
  const content = readFileSync(filePath, 'utf8')
    .replaceAll('通过 / 不通过', '通过')
    .replaceAll('正常 / 异常', '正常')
    .replaceAll('允许 / 暂缓', '允许')
    .replaceAll('是 / 否', '是')
    .replaceAll('浅色 / 深色 / 浅色+深色', '浅色+深色')
    .replaceAll('默认 / 减少动态 / 默认+减少动态', '默认+减少动态')
    .replace('| 截图报告路径 |  |', `| 截图报告路径 | ${screenshotReportPath} |`);
  writeFileSync(filePath, content, 'utf8');
}

afterEach(() => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('rollout record scripts', () => {
  it('generates a dated rollout record from the template without preserving template usage copy', () => {
    const outDir = makeTempDir();
    const result = runNode([
      'scripts/create-rollout-record.mjs',
      '--date',
      '2026-06-24',
      '--env',
      '本地',
      '--out',
      outDir,
    ]);

    expect(result.status).toBe(0);
    const generatedPath = path.join(outDir, 'mobile-field-rollout-2026-06-24.md');
    const content = readFileSync(generatedPath, 'utf8');

    expect(content).toContain('# 移动端与字段口径上线验收记录');
    expect(content).not.toContain('# 移动端与字段口径上线验收记录模板');
    expect(content).toContain('> 生成时间：');
    expect(content).toContain('> 生成命令：`npm run qa:rollout:record`');
    expect(content).not.toContain('> 使用方式：');
    expect(content).toContain('| 发布日期 | 2026-06-24 |');
    expect(content).toContain('| 部署环境 | 本地 |');
    expect(content).toMatch(/\| 代码分支 \/ Commit \| .+ @ [0-9a-f]{7,}/);
  });

  it('does not overwrite an existing rollout record for the same date', () => {
    const outDir = makeTempDir();
    const args = [
      'scripts/create-rollout-record.mjs',
      '--date',
      '2026-06-24',
      '--env',
      '本地',
      '--out',
      outDir,
    ];

    const first = runNode(args);
    const second = runNode(args);

    expect(first.status).toBe(0);
    expect(second.status).toBe(0);
    expect(readFileSync(path.join(outDir, 'mobile-field-rollout-2026-06-24.md'), 'utf8')).toContain('| 发布日期 | 2026-06-24 |');
    expect(readFileSync(path.join(outDir, 'mobile-field-rollout-2026-06-24-2.md'), 'utf8')).toContain('| 发布日期 | 2026-06-24 |');
  });

  it('rejects generated drafts until required decision placeholders are filled', () => {
    const outDir = makeTempDir();
    runNode([
      'scripts/create-rollout-record.mjs',
      '--date',
      '2026-06-24',
      '--env',
      '阿里云生产',
      '--out',
      outDir,
    ]);
    const draftPath = path.join(outDir, 'mobile-field-rollout-2026-06-24.md');

    const result = runNode(['scripts/check-rollout-record.mjs', draftPath]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('unresolved placeholder "通过 / 不通过"');
    expect(result.stderr).toContain('unresolved placeholder "允许 / 暂缓"');
    expect(result.stderr).toContain('unresolved placeholder "浅色 / 深色 / 浅色+深色"');
    expect(result.stderr).toContain('unresolved placeholder "默认 / 减少动态 / 默认+减少动态"');
    expect(result.stderr).toContain('mobile screenshot QA report path must be filled');
  });

  it('passes a filled record that keeps screenshot, migration and endpoint evidence rows', () => {
    const outDir = makeTempDir();
    runNode([
      'scripts/create-rollout-record.mjs',
      '--date',
      '2026-06-24',
      '--env',
      '阿里云生产',
      '--out',
      outDir,
    ]);
    const recordPath = path.join(outDir, 'mobile-field-rollout-2026-06-24.md');
    const screenshotReportPath = writeValidScreenshotReport(outDir);
    fillRequiredDecisionPlaceholders(recordPath, screenshotReportPath);

    const result = runNode(['scripts/check-rollout-record.mjs', recordPath]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Rollout record check passed');
  });

  it('rejects a filled record when screenshot report does not prove authenticated light and dark coverage', () => {
    const outDir = makeTempDir();
    runNode([
      'scripts/create-rollout-record.mjs',
      '--date',
      '2026-06-24',
      '--env',
      '阿里云生产',
      '--out',
      outDir,
    ]);
    const reportDir = path.join(outDir, 'bad-mobile-screenshot-report');
    mkdirSync(reportDir, { recursive: true });
    writeFileSync(path.join(reportDir, 'README.md'), '# 移动端截图 QA 记录\n', 'utf8');
    writeFileSync(path.join(reportDir, 'report.json'), `${JSON.stringify({
      generatedAt: '2026/06/24 12:00:00',
      url: 'http://127.0.0.1:5173/',
      outDir: reportDir,
      colorScheme: 'dark',
      reducedMotion: 'reduce',
      storageState: null,
      requireAuthenticated: false,
      authenticatedSelector: null,
      fullPage: false,
      records: [],
    }, null, 2)}\n`, 'utf8');
    const recordPath = path.join(outDir, 'mobile-field-rollout-2026-06-24.md');
    fillRequiredDecisionPlaceholders(recordPath, path.join(reportDir, 'README.md'));

    const result = runNode(['scripts/check-rollout-record.mjs', recordPath]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('mobile screenshot QA report content must prove authenticated light and dark viewport coverage with reduced motion evidence');
    expect(result.stderr).toContain('report colorScheme must be "both"');
    expect(result.stderr).toContain('report reducedMotion must be "both"');
    expect(result.stderr).toContain('report must include a non-empty storageState');
    expect(result.stderr).toContain('report must be captured with requireAuthenticated=true');
  });
});
