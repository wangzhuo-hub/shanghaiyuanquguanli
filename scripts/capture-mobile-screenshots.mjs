#!/usr/bin/env node
import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const defaultViewports = [
  { key: '375x812-dashboard', width: 375, height: 812, focus: '工作台、客户查询、月度明细' },
  { key: '390x844-more-filter', width: 390, height: 844, focus: '工作台、更多入口、筛选 sheet' },
  { key: '430x932-building-budget', width: 430, height: 932, focus: '楼宇资管、预算明细、action sheet' },
  { key: '768x1024-tablet-portrait', width: 768, height: 1024, focus: '合同、财务、发票、预算平板主从' },
  { key: '1024x768-tablet-landscape', width: 1024, height: 768, focus: '横屏平板 / 小桌面边界' },
];

function printHelp() {
  console.log(`Capture mobile and tablet screenshots for rollout QA.

Usage:
  npm run qa:mobile-screenshots -- [--url http://127.0.0.1:5173/] [--out output/mobile-screenshot-qa] [--wait 1600] [--full-page] [--color-scheme light|dark|both] [--reduced-motion no-preference|reduce|both] [--storage-state auth.json] [--require-authenticated]

Notes:
  - This command captures the five required rollout viewports into a timestamped folder.
  - Use --color-scheme dark or both to reproduce iPhone dark appearance readability issues.
  - Use --reduced-motion reduce or both to verify that iOS Reduce Motion does not hide state changes.
  - Use --storage-state with a Playwright storage file to capture the authenticated dashboard instead of the login page.
  - Use --require-authenticated to fail when the saved storage state no longer reaches the logged-in app shell.
  - It is a visual QA aid, not a replacement for manually opening More, filter sheets, monthly details, budget editors, or building action sheets.
  - If Playwright reports missing browsers, run: npx playwright install chromium
`);
}

function parseArgs(argv) {
  const options = {
    url: 'http://127.0.0.1:5173/',
    outDir: 'output/mobile-screenshot-qa',
    wait: 1600,
    fullPage: false,
    browser: 'chromium',
    colorScheme: 'light',
    reducedMotion: 'no-preference',
    storageState: '',
    requireAuthenticated: false,
    authenticatedSelector: '[title="退出登录"]',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
    if (arg === '--url') {
      options.url = argv[++i] || '';
      continue;
    }
    if (arg === '--out') {
      options.outDir = argv[++i] || '';
      continue;
    }
    if (arg === '--wait') {
      options.wait = Number(argv[++i] || '0');
      continue;
    }
    if (arg === '--full-page') {
      options.fullPage = true;
      continue;
    }
    if (arg === '--browser') {
      options.browser = argv[++i] || '';
      continue;
    }
    if (arg === '--color-scheme') {
      options.colorScheme = argv[++i] || '';
      continue;
    }
    if (arg === '--reduced-motion') {
      options.reducedMotion = argv[++i] || '';
      continue;
    }
    if (arg === '--storage-state' || arg === '--load-storage') {
      options.storageState = argv[++i] || '';
      continue;
    }
    if (arg === '--require-authenticated') {
      options.requireAuthenticated = true;
      continue;
    }
    if (arg === '--authenticated-selector') {
      options.authenticatedSelector = argv[++i] || '';
      continue;
    }
    console.error(`Unknown option: ${arg}`);
    printHelp();
    process.exit(1);
  }

  return options;
}

function timestampForPath(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}${values.month}${values.day}-${values.hour}${values.minute}${values.second}`;
}

function validateOptions(options) {
  if (!options.url) throw new Error('--url cannot be empty.');
  if (!options.outDir) throw new Error('--out cannot be empty.');
  if (!Number.isFinite(options.wait) || options.wait < 0) throw new Error('--wait must be a non-negative number.');
  if (!options.browser) throw new Error('--browser cannot be empty.');
  if (!['light', 'dark', 'both'].includes(options.colorScheme)) {
    throw new Error('--color-scheme must be one of: light, dark, both.');
  }
  if (!['no-preference', 'reduce', 'both'].includes(options.reducedMotion)) {
    throw new Error('--reduced-motion must be one of: no-preference, reduce, both.');
  }
  if (options.requireAuthenticated && !options.storageState) {
    throw new Error('--require-authenticated requires --storage-state.');
  }
  if (options.requireAuthenticated && !options.authenticatedSelector) {
    throw new Error('--authenticated-selector cannot be empty when --require-authenticated is used.');
  }
}

function playwrightMissingBrowserHint(stderr) {
  return stderr.includes('Executable doesn\'t exist') || stderr.includes('Please run the following command to download new browsers');
}

async function validateStorageState(options) {
  if (!options.storageState) return '';
  const storagePath = path.resolve(rootDir, options.storageState);
  const fileStat = await stat(storagePath);
  if (!fileStat.isFile()) throw new Error(`--storage-state must point to a file: ${options.storageState}`);
  return storagePath;
}

function getColorSchemes(options) {
  return options.colorScheme === 'both' ? ['light', 'dark'] : [options.colorScheme];
}

function getReducedMotionModes(options) {
  return options.reducedMotion === 'both' ? ['no-preference', 'reduce'] : [options.reducedMotion];
}

function getBrowserType(browserName) {
  if (['chromium', 'cr'].includes(browserName)) return chromium;
  if (['firefox', 'ff'].includes(browserName)) return firefox;
  if (['webkit', 'wk'].includes(browserName)) return webkit;
  throw new Error('--browser must be one of: chromium, cr, firefox, ff, webkit, wk.');
}

async function captureViewport(options, browser, runDir, viewport, colorScheme, reducedMotion, storagePath) {
  const shouldPrefixScheme = options.colorScheme === 'both' || colorScheme !== 'light';
  const shouldPrefixMotion = options.reducedMotion === 'both' || reducedMotion === 'reduce';
  const motionPrefix = reducedMotion === 'reduce' ? 'reduced-motion' : 'default-motion';
  const filename = `${shouldPrefixScheme ? `${colorScheme}-` : ''}${shouldPrefixMotion ? `${motionPrefix}-` : ''}${viewport.key}.png`;
  const screenshotPath = path.join(runDir, filename);
  const startedAt = Date.now();

  let context;
  try {
    context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      colorScheme,
      reducedMotion,
      storageState: storagePath || undefined,
      deviceScaleFactor: viewport.width < 768 ? 3 : 2,
      hasTouch: viewport.width < 768,
      isMobile: viewport.width < 768,
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
    });
    const page = await context.newPage();
    await page.goto(options.url, { waitUntil: 'networkidle' });
    if (options.requireAuthenticated) {
      await page.waitForSelector(options.authenticatedSelector, { timeout: Math.max(options.wait, 5000) });
    }
    if (options.wait > 0) await page.waitForTimeout(options.wait);
    await page.screenshot({ path: screenshotPath, fullPage: options.fullPage });
    const fileStat = await stat(screenshotPath);
    return {
      ...viewport,
      colorScheme,
      reducedMotion,
      authenticated: Boolean(storagePath),
      filename,
      path: screenshotPath,
      relativePath: path.relative(rootDir, screenshotPath),
      ok: fileStat.size > 1024,
      exitCode: 0,
      durationMs: Date.now() - startedAt,
      size: fileStat.size,
      stdout: '',
      stderr: '',
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      ...viewport,
      colorScheme,
      reducedMotion,
      authenticated: Boolean(storagePath),
      filename,
      path: screenshotPath,
      relativePath: path.relative(rootDir, screenshotPath),
      ok: false,
      exitCode: 1,
      durationMs: Date.now() - startedAt,
      size: 0,
      stdout: '',
      stderr: reason,
    };
  } finally {
    if (context) await context.close();
  }
}

function buildMarkdownReport({ options, runDir, records, startedAt }) {
  const passed = records.filter((record) => record.ok).length;
  const lines = [
    '# 移动端截图 QA 记录',
    '',
    `- 生成时间：${startedAt}`,
    `- URL：${options.url}`,
    `- 输出目录：${path.relative(rootDir, runDir)}`,
    `- 色彩模式：${options.colorScheme}`,
    `- 减少动态效果：${options.reducedMotion}`,
    `- 登录态：${options.storageState ? `已加载 ${options.storageState}` : '未加载，可能停留在登录页'}`,
    `- 登录后校验：${options.requireAuthenticated ? `已启用，等待 ${options.authenticatedSelector}` : '未启用'}`,
    `- 截图结果：${passed}/${records.length} 通过`,
    `- 模式：${options.fullPage ? '完整页面截图' : '当前视口截图'}`,
    '',
    '## 视口截图',
    '',
    '| 色彩模式 | 动态效果 | 视口 | 检查重点 | 结果 | 截图 | 备注 |',
    '|---|---|---|---|---|---|---|',
  ];

  for (const record of records) {
    const note = record.ok
      ? `${Math.round(record.size / 1024)} KB，${record.durationMs} ms`
      : (record.stderr || record.stdout || `exit ${record.exitCode}`).replace(/\n/g, '<br>');
    lines.push(`| ${record.colorScheme} | ${record.reducedMotion} | ${record.width}x${record.height} | ${record.focus} | ${record.ok ? '通过' : '失败'} | ${record.ok ? record.relativePath : '-'} | ${note} |`);
  }

  lines.push(
    '',
    '## 人工复核提醒',
    '',
    '- 若本次问题与 iPhone 深色外观有关，必须使用 `--color-scheme dark` 或 `--color-scheme both` 重新留存截图。',
    '- 若本次问题与动效、弹层或加载状态有关，必须使用 `--reduced-motion reduce` 或 `--reduced-motion both` 留存减少动态效果截图。',
    '- 若需要验收登录后的工作台、更多入口、月度明细、预算或楼宇页面，应先准备 Playwright storage state，并通过 `--storage-state` 加载，再追加 `--require-authenticated` 防止误截登录页。',
    '- 打开「更多管理」、移动查询筛选 sheet、月度收款明细、预算编辑浮层和楼宇 action sheet，再补充对应状态截图。',
    '- 检查底部导航是否遮挡关注字段、待办卡、园区切换或核心按钮。',
    '- 检查毛玻璃浮层文字对比度，尤其是浅色背景上的表头、标签和合计行。',
    '- 将通过的截图路径填写进 `docs/rollout-records/` 下的上线验收记录。',
  );

  const missingBrowser = records.some((record) => !record.ok && playwrightMissingBrowserHint(record.stderr));
  if (missingBrowser) {
    lines.push('', '## 环境提示', '', '- 当前 Playwright 浏览器未安装，可运行 `npx playwright install chromium` 后重试。');
  }

  return `${lines.join('\n')}\n`;
}

const options = parseArgs(process.argv.slice(2));

try {
  validateOptions(options);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  printHelp();
  process.exit(1);
}

const startedAt = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
}).format(new Date());
const runDir = path.resolve(rootDir, options.outDir, timestampForPath());
await mkdir(runDir, { recursive: true });

let storagePath = '';
try {
  storagePath = await validateStorageState(options);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const records = [];
let browser;
try {
  browser = await getBrowserType(options.browser).launch();
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error);
  console.error(reason);
  if (playwrightMissingBrowserHint(reason)) {
    console.error('Playwright browser is missing. Run: npx playwright install chromium');
  }
  process.exit(1);
}

try {
  for (const colorScheme of getColorSchemes(options)) {
    for (const reducedMotion of getReducedMotionModes(options)) {
      for (const viewport of defaultViewports) {
        console.log(`Capturing ${colorScheme} ${reducedMotion} ${viewport.width}x${viewport.height} ${viewport.focus}...`);
        records.push(await captureViewport(options, browser, runDir, viewport, colorScheme, reducedMotion, storagePath));
      }
    }
  }
} finally {
  await browser.close();
}

const report = {
  generatedAt: startedAt,
  url: options.url,
  outDir: path.relative(rootDir, runDir),
  colorScheme: options.colorScheme,
  reducedMotion: options.reducedMotion,
  storageState: options.storageState || null,
  requireAuthenticated: options.requireAuthenticated,
  authenticatedSelector: options.requireAuthenticated ? options.authenticatedSelector : null,
  fullPage: options.fullPage,
  records,
};

await writeFile(path.join(runDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
await writeFile(path.join(runDir, 'README.md'), buildMarkdownReport({ options, runDir, records, startedAt }), 'utf8');

const passed = records.filter((record) => record.ok).length;
console.log(`Mobile screenshot QA complete: ${passed}/${records.length} screenshots captured.`);
console.log(`Report: ${path.relative(rootDir, path.join(runDir, 'README.md'))}`);

if (passed !== records.length) {
  const missingBrowser = records.some((record) => !record.ok && playwrightMissingBrowserHint(record.stderr));
  if (missingBrowser) {
    console.error('Playwright browser is missing. Run: npx playwright install chromium');
  }
  process.exit(1);
}
