#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const isWindows = process.platform === 'win32';

const commands = [
  {
    label: 'Mobile UI guardrails',
    command: 'npm',
    args: ['run', 'qa:mobile-ui'],
  },
  {
    label: 'Field and mobile regression tests',
    command: 'npx',
    args: [
      'vitest',
      'run',
      'services/__tests__/dashboardCustomFields.test.ts',
      'services/__tests__/dashboardCustomFieldCloudPreferences.test.ts',
      'services/__tests__/tenantHistoricalArrears.test.ts',
      'services/__tests__/cloudTenantHistoricalArrears.test.ts',
      'services/__tests__/budgetMobileAdjustment.test.ts',
      'services/__tests__/budgetTableImport.test.ts',
      'services/__tests__/dashboardMetrics.test.ts',
      'services/__tests__/parkAreaMetrics.test.ts',
      'components/__tests__/MobileNavigation.test.tsx',
      'components/__tests__/MobileTenantSearchPanel.test.tsx',
      'components/__tests__/DashboardCustomFields.test.tsx',
      'components/__tests__/BuildingMobileActionSheets.test.tsx',
      'scripts/__tests__/rolloutRecordScripts.test.ts',
    ],
  },
  {
    label: 'TypeScript verification',
    command: 'npx',
    args: ['tsc', '--noEmit'],
  },
  {
    label: 'Production build',
    command: 'npm',
    args: ['run', 'build'],
  },
];

for (const step of commands) {
  console.log(`\n▶ ${step.label}`);
  console.log(`$ ${step.command} ${step.args.join(' ')}`);
  const result = spawnSync(step.command, step.args, {
    cwd: rootDir,
    stdio: 'inherit',
    shell: isWindows,
  });

  if (result.error) {
    console.error(`\nRollout readiness failed while running ${step.label}: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error(`\nRollout readiness failed at: ${step.label}`);
    process.exit(result.status || 1);
  }
}

console.log('\nRollout readiness checks passed.');
