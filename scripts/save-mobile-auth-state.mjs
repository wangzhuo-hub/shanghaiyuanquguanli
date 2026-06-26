#!/usr/bin/env node
import { mkdir, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

function printHelp() {
  console.log(`Save a Playwright storage state file after manual login.

Usage:
  npm run qa:mobile-auth-state -- [--url http://127.0.0.1:5173/] [--out output/mobile-auth-state/auth-state.json] [--browser chromium] [--color-scheme light|dark] [--viewport-size 390,844]

Flow:
  1. The command opens a browser at the target URL.
  2. Log in manually with a QA account.
  3. Close the browser window.
  4. The storage state file can be passed to screenshot QA with --storage-state.

Example:
  npm run qa:mobile-auth-state -- --url http://127.0.0.1:5173/
  npm run qa:mobile-screenshots -- --url http://127.0.0.1:5173/ --color-scheme both --reduced-motion both --storage-state output/mobile-auth-state/auth-state.json --require-authenticated

Do not commit the generated storage state file. It can contain session cookies or tokens.
`);
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

function parseArgs(argv) {
  const options = {
    url: 'http://127.0.0.1:5173/',
    outFile: `output/mobile-auth-state/auth-state-${timestampForPath()}.json`,
    browser: 'chromium',
    colorScheme: 'light',
    viewportSize: '390,844',
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
      options.outFile = argv[++i] || '';
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
    if (arg === '--viewport-size') {
      options.viewportSize = argv[++i] || '';
      continue;
    }
    console.error(`Unknown option: ${arg}`);
    printHelp();
    process.exit(1);
  }

  return options;
}

function validateOptions(options) {
  if (!options.url) throw new Error('--url cannot be empty.');
  if (!options.outFile) throw new Error('--out cannot be empty.');
  if (!options.browser) throw new Error('--browser cannot be empty.');
  if (!['light', 'dark'].includes(options.colorScheme)) {
    throw new Error('--color-scheme must be one of: light, dark.');
  }
  if (!/^\d+,\d+$/.test(options.viewportSize)) {
    throw new Error('--viewport-size must use WIDTH,HEIGHT, for example 390,844.');
  }
}

function playwrightMissingBrowserHint(stderr) {
  return stderr.includes('Executable doesn\'t exist') || stderr.includes('Please run the following command to download new browsers');
}

const options = parseArgs(process.argv.slice(2));

try {
  validateOptions(options);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  printHelp();
  process.exit(1);
}

const storagePath = path.resolve(rootDir, options.outFile);
await mkdir(path.dirname(storagePath), { recursive: true });

console.log('Opening browser for manual QA login...');
console.log(`URL: ${options.url}`);
console.log(`Storage state will be saved to: ${path.relative(rootDir, storagePath)}`);
console.log('After login succeeds, close the browser window to finish saving the storage state.');

const result = spawnSync(
  'npx',
  [
    'playwright',
    'open',
    '--browser',
    options.browser,
    '--color-scheme',
    options.colorScheme,
    '--viewport-size',
    options.viewportSize,
    '--save-storage',
    storagePath,
    options.url,
  ],
  {
    cwd: rootDir,
    stdio: 'inherit',
    encoding: 'utf8',
  },
);

if (result.status !== 0) {
  if (typeof result.stderr === 'string' && playwrightMissingBrowserHint(result.stderr)) {
    console.error('Playwright browser is missing. Run: npx playwright install chromium');
  }
  process.exit(result.status || 1);
}

try {
  const fileStat = await stat(storagePath);
  if (!fileStat.isFile() || fileStat.size < 16) {
    throw new Error('storage state file was not created or is empty');
  }
} catch (error) {
  console.error(`Unable to verify storage state: ${path.relative(rootDir, storagePath)}`);
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

console.log(`Storage state saved: ${path.relative(rootDir, storagePath)}`);
console.log(`Use it with: npm run qa:mobile-screenshots -- --url ${options.url} --color-scheme both --reduced-motion both --storage-state ${path.relative(rootDir, storagePath)} --require-authenticated`);
