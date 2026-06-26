#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const fileMap = {
  gitignore: '.gitignore',
  packageJson: 'package.json',
  app: 'App.tsx',
  css: 'index.css',
  html: 'index.html',
  mobileSheetFocus: 'components/useMobileSheetFocus.ts',
  mobileNavigation: 'components/MobileNavigation.tsx',
  mobileNavigationTest: 'components/__tests__/MobileNavigation.test.tsx',
  mobileSearch: 'components/MobileTenantSearchPanel.tsx',
  mobileSearchTest: 'components/__tests__/MobileTenantSearchPanel.test.tsx',
  contractManager: 'components/ContractManager.tsx',
  contractSummaryModal: 'components/ContractSummaryModal.tsx',
  nameChangeDialog: 'components/NameChangeDialog.tsx',
  paymentCycleDialog: 'components/PaymentCycleChangeDialog.tsx',
  aiContractModal: 'components/AIContractRecognitionModal.tsx',
  aiPaymentModal: 'components/AIPaymentRecognitionModal.tsx',
  buildingManager: 'components/BuildingManager.tsx',
  buildingMobileActionSheets: 'components/BuildingMobileActionSheets.tsx',
  buildingMobileActionSheetsTest: 'components/__tests__/BuildingMobileActionSheets.test.tsx',
  budgetManager: 'components/BudgetManager.tsx',
  financeManager: 'components/FinanceManager.tsx',
  billingTable: 'components/BillingTable.tsx',
  systemSettingsPanel: 'components/SystemSettingsPanel.tsx',
  assistantPanel: 'components/AssistantPanel.tsx',
  invoiceManager: 'components/InvoiceManager.tsx',
  conflictDialog: 'components/ConflictDialog.tsx',
  tenantMergeTool: 'components/TenantMergeTool.tsx',
  tenantInsights: 'components/TenantInsights.tsx',
  dashboardAlerts: 'components/DashboardAlerts.tsx',
  charts: 'components/Charts.tsx',
  sourceAnalysisCharts: 'components/SourceAnalysisCharts.tsx',
  sourceAnalysisDashboard: 'components/SourceAnalysisDashboard.tsx',
  sharedTables: 'components/Tables.tsx',
  virtualizedTable: 'components/VirtualizedTable.tsx',
  statsCards: 'components/StatsCards.tsx',
  searchableTenantSelect: 'components/SearchableTenantSelect.tsx',
  dashboardCustomFieldsComponent: 'components/DashboardCustomFields.tsx',
  dashboardCustomFieldsTest: 'components/__tests__/DashboardCustomFields.test.tsx',
  customFields: 'services/dashboardCustomFields.ts',
  customFieldCloudPreferences: 'services/dashboardCustomFieldCloudPreferences.ts',
  arrears: 'services/tenantHistoricalArrears.ts',
  integrationGateway: 'scripts/integration-gateway.ts',
  urls: 'config/urls.ts',
  userPreferencesMigration: 'pocketbase/pb_migrations/1789000000_created_pb_user_preferences.js',
  contentDoc: 'UI界面内容与移动端使用优化建议.md',
  glassDoc: 'UI毛玻璃设计优化建议（移动端与细节）.md',
  rolloutChecklist: 'docs/10-移动端与字段口径上线验收清单.md',
  rolloutRecordTemplate: 'docs/11-移动端与字段口径上线验收记录模板.md',
  rolloutReadiness: 'scripts/check-rollout-readiness.mjs',
  rolloutRecordCreator: 'scripts/create-rollout-record.mjs',
  rolloutRecordChecker: 'scripts/check-rollout-record.mjs',
  rolloutRecordScriptsTest: 'scripts/__tests__/rolloutRecordScripts.test.ts',
  mobileScreenshotQa: 'scripts/capture-mobile-screenshots.mjs',
  mobileScreenshotReportChecker: 'scripts/check-mobile-screenshot-report.mjs',
  mobileAuthState: 'scripts/save-mobile-auth-state.mjs',
  deploymentDoc: 'docs/DEPLOYMENT.md',
};

const entries = await Promise.all(
  Object.entries(fileMap).map(async ([key, relativePath]) => {
    const absolutePath = path.join(rootDir, relativePath);
    return [key, await readFile(absolutePath, 'utf8')];
  }),
);
const files = Object.fromEntries(entries);

const checks = [];
const warnings = [];

function addCheck(label, ok, detail) {
  checks.push({ label, ok, detail });
}

function addWarning(label, ok, detail) {
  if (!ok) warnings.push({ label, detail });
}

function includes(fileKey, needle, label) {
  addCheck(label, files[fileKey].includes(needle), `${fileMap[fileKey]} should include: ${needle}`);
}

function includesAtLeast(fileKey, needle, minimum, label) {
  const count = files[fileKey].split(needle).length - 1;
  addCheck(label, count >= minimum, `${fileMap[fileKey]} should include "${needle}" at least ${minimum} times, found ${count}`);
}

function matches(fileKey, pattern, label) {
  addCheck(label, pattern.test(files[fileKey]), `${fileMap[fileKey]} should match: ${pattern}`);
}

function notMatches(fileKey, pattern, label) {
  addCheck(label, !pattern.test(files[fileKey]), `${fileMap[fileKey]} should not match: ${pattern}`);
}

function hasBalancedCurlyBraces(fileKey) {
  let depth = 0;
  let minDepth = 0;
  for (const char of files[fileKey]) {
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    minDepth = Math.min(minDepth, depth);
  }
  addCheck(
    `${fileMap[fileKey]} has balanced curly braces`,
    depth === 0 && minDepth === 0,
    `${fileMap[fileKey]} curly brace balance ended at ${depth} with minimum depth ${minDepth}`,
  );
}

function numberInputsHaveMobileKeyboardHints(fileKey) {
  const missing = [];
  const inputTagPattern = /<input\b[\s\S]*?(?:\/>|>)/g;
  let match;
  while ((match = inputTagPattern.exec(files[fileKey])) !== null) {
    const tag = match[0];
    if (!/type="number"/.test(tag)) continue;
    const line = files[fileKey].slice(0, match.index).split('\n').length;
    const missingAttrs = [];
    if (!/inputMode=/.test(tag)) missingAttrs.push('inputMode');
    if (!/enterKeyHint=/.test(tag)) missingAttrs.push('enterKeyHint');
    if (missingAttrs.length) missing.push(`line ${line}: ${missingAttrs.join(', ')}`);
  }
  addCheck(
    `${fileMap[fileKey]} numeric inputs expose mobile keyboard hints`,
    missing.length === 0,
    `${fileMap[fileKey]} missing numeric input mobile hints: ${missing.join('; ')}`,
  );
}

includes('html', 'viewport-fit=cover', 'iPhone safe-area viewport is enabled');
includes('html', 'min-height: 100dvh', 'initial loading shell supports dynamic viewport height');

hasBalancedCurlyBraces('css');
notMatches('css', /\.liquid-budget-mobile-layout\s*\{\s*\.liquid-budget-mobile-layout\s*\{/m, 'tablet budget mobile layout does not contain accidental nested duplicate selectors');
includes('css', '--mobile-touch-target: 44px', 'mobile touch target token remains 44px');
includes('css', '--liquid-primary: #2563eb', 'liquid primary color remains mineral blue, not green');
includes('css', '--liquid-primary-strong: #1d4ed8', 'liquid strong primary color remains deep blue');
includes('css', '--liquid-cyan: #0891b2', 'liquid secondary action color remains cyan');
includes('css', 'min-height: var(--mobile-touch-target) !important', 'pressable controls inherit the 44px target');
includes('css', '.liquid-mobile-filter-clear', 'mobile filter clear action participates in the 44px touch target group');
includes('css', '.liquid-auth-field,', 'auth inputs participate in the 44px touch target group');
includes('css', '.liquid-auth-park-option,', 'auth park options participate in the 44px touch target group');
includes('css', 'touch-action: manipulation', 'tap delay is disabled for interactive controls');
includes('css', ':where(.liquid-pressable, .mobile-pressable, .liquid-glass-control, .liquid-mobile-bottom-item, .liquid-mobile-more-item, .liquid-mobile-year-step, .liquid-auth-field, .liquid-auth-park-option):focus-visible', 'core glass controls and auth fields keep a unified focus-visible rule');
includes('css', '.liquid-auth-park-option:focus-within', 'auth park options show a full-row focus ring when their checkbox is focused');
includes('css', 'outline: 2px solid rgba(37, 99, 235, 0.72)', 'focus ring keeps visible blue outline');
includes('css', 'outline-offset: 3px', 'focus ring keeps offset from glass controls');
includes('css', '0 0 0 5px rgba(37, 99, 235, 0.14)', 'focus ring keeps soft outer glow');
includes('css', '@supports (height: 100dvh)', 'dynamic viewport height fallback is present');
includes('css', '@media (prefers-color-scheme: dark)', 'dark material token fallback is present');
includes('css', '@media (prefers-contrast: more)', 'high-contrast material fallback is present');
includes('css', '@media (prefers-reduced-transparency: reduce)', 'reduced-transparency material fallback is present');
includes('css', '@media (prefers-reduced-motion: reduce)', 'reduced-motion fallback is present');
includes('css', '.animate-in,', 'reduced-motion fallback disables decorative entry animations');
includes('css', '.animate-spin,', 'reduced-motion fallback disables continuous loading spin motion');
includes('css', '.animate-marquee,', 'reduced-motion fallback disables marquee motion');
includes('css', '.animate-pulse', 'reduced-motion fallback disables pulse motion');
includes('css', 'animation: none !important', 'reduced-motion fallback wins over animation utilities');
includes('css', '.ios-liquid-app :where([class*="transition"], [class*="duration-"])', 'reduced-motion fallback disables Tailwind transition utilities inside the app shell');
includes('css', '.liquid-mobile-filter-sheet,', 'reduced-motion fallback covers mobile filter sheet motion');
includes('css', '.liquid-mobile-more-sheet,', 'reduced-motion fallback covers mobile More sheet motion');
includes('css', 'linear-gradient(145deg, rgba(255, 255, 255, 0.975), rgba(248, 250, 252, 0.92))', 'mobile More sheet uses a stronger readable glass base');
includes('css', 'linear-gradient(145deg, rgba(255, 255, 255, 0.97), rgba(248, 250, 252, 0.88))', 'mobile More management rows use readable glass cards');
includes('css', 'linear-gradient(145deg, rgba(219, 234, 254, 0.94), rgba(255, 255, 255, 0.88))', 'mobile More active row keeps a clear selected readable fill');
includes('css', '.monthly-detail-backdrop,', 'reduced-motion fallback covers monthly detail backdrop motion');
includes('css', '.liquid-mobile-primary-metric,', 'high-contrast fallback covers the mobile primary KPI card');
includes('css', '.liquid-mobile-primary-badge,', 'high-contrast fallback covers the mobile primary KPI badge');
includes('css', '.liquid-mobile-micro-card,', 'high-contrast fallback covers mobile dashboard micro KPI cards');
includes('css', '.liquid-mobile-bottom-nav,', 'high-contrast fallback covers the mobile bottom navigation glass layer');
includes('css', '.monthly-detail-table-shell,', 'high-contrast fallback covers the desktop monthly detail table shell');
includes('css', 'background: rgba(255, 255, 255, 0.97);', 'high-contrast fallback makes glass content layers nearly opaque');
matches(
  'css',
  /@media \(prefers-contrast: more\)[\s\S]*?\.monthly-detail-mobile-card,\s*\.liquid-auth-panel,\s*\.liquid-auth-segment,\s*\.liquid-auth-field,\s*\.liquid-auth-park-option \{[\s\S]*?background: rgba\(255, 255, 255, 0\.97\);[\s\S]*?\.liquid-auth-field::placeholder[\s\S]*?color: #475569;/,
  'high-contrast fallback covers auth glass, auth inputs and placeholders',
);
matches(
  'css',
  /@media \(prefers-reduced-transparency: reduce\)(?=[\s\S]*?\.liquid-mobile-primary-metric,)(?=[\s\S]*?\.liquid-mobile-primary-badge,)(?=[\s\S]*?\.liquid-mobile-task-card,)(?=[\s\S]*?\.mobile-dashboard-custom-fields,)(?=[\s\S]*?\.monthly-detail-table-shell,)[\s\S]*?\.liquid-mobile-bottom-item-active,\s*\.liquid-auth-panel,\s*\.liquid-auth-segment,\s*\.liquid-auth-field,\s*\.liquid-auth-park-option,[\s\S]*?backdrop-filter: none/,
  'reduced-transparency fallback covers mobile KPI, tasks, custom fields, monthly detail and auth content layers',
);
includes('css', '.ios-liquid-app.mobile-typography-guard :where(', 'mobile dark-mode readability override remains scoped to the mobile app shell');
includes('css', '.liquid-mobile-focus-cell', 'mobile KPI focus cells remain part of readability rules');
includes('css', '.liquid-mobile-hero', 'mobile dashboard hero remains part of readability rules');
includes('css', '.liquid-mobile-primary-metric', 'mobile primary KPI uses a dedicated readable glass metric card');
includes('css', '.liquid-mobile-primary-value', 'mobile primary KPI value has a dedicated high-emphasis ink rule');
includes('css', '.liquid-mobile-progress-track', 'mobile dashboard progress track uses a dedicated readable layer');
includes('css', '.liquid-mobile-progress-fill', 'mobile dashboard progress fill keeps blue-cyan emphasis instead of white-on-glass');
includes('css', '.liquid-mobile-micro-card', 'mobile dashboard micro KPI cards remain part of readable glass layers');
includes('css', '.mobile-dashboard-custom-fields', 'mobile custom field shell remains part of readability rules');
includes('css', 'color: #0f172a !important', 'mobile dark-mode readable glass cards force dark ink over global dark slate text');
includes('css', ') :where(.text-slate-950, .text-slate-900, .text-slate-800, .text-slate-700)', 'mobile dark-mode high-emphasis text keeps dark readable ink on light glass cards');
includes('css', ') :where(.text-slate-600, .text-slate-500, .text-slate-400)', 'mobile dark-mode supporting text keeps readable muted ink on light glass cards');
includes('css', '.liquid-mobile-top-pill', 'mobile top park pill stays in the readable glass dark-mode guard');
includes('css', '.liquid-mobile-toolbar-title', 'mobile toolbar title has a named readable typography rule');
includes('css', '.liquid-mobile-action-helper', 'mobile quick action helper copy has a named readable typography rule');
includes('css', '.liquid-mobile-action-blue .liquid-mobile-action-helper', 'mobile blue quick action helper keeps readable light ink');
includes('css', '.liquid-mobile-action-amber .liquid-mobile-action-helper', 'mobile amber quick action helper keeps readable slate ink');
includes('css', '.liquid-mobile-bottom-item-active) :where(svg, span)', 'mobile active bottom navigation keeps white icon and label in dark mode');
includes('css', '.ios-liquid-app :where(.liquid-auth-panel)', 'auth panel keeps a readable light glass layer in dark mode');
includes('css', '.ios-liquid-app :where(.liquid-auth-panel) :where(.text-slate-950, .text-slate-900, .text-slate-800, .text-slate-700)', 'auth panel high-emphasis text keeps dark readable ink in dark mode');
includes('css', '.ios-liquid-app :where(.liquid-auth-panel) :where(.text-slate-600, .text-slate-500, .text-slate-400)', 'auth panel supporting text keeps readable muted ink in dark mode');
includes('css', '.ios-liquid-app :where(.liquid-auth-field)::placeholder', 'auth input placeholders keep readable contrast in dark mode');
includes('contentDoc', '移动深色系统约束', 'mobile content recommendations record dark-system readability constraints');
includes('contentDoc', '移动高对比系统约束', 'mobile content recommendations record high-contrast readability constraints');
includes('contentDoc', '移动降低透明度约束', 'mobile content recommendations record reduced-transparency readability constraints');
includes('contentDoc', '移动减少动态效果约束', 'mobile content recommendations record reduced-motion constraints');
includes('glassDoc', '移动端深色系统可读性修复', 'glass optimization recommendations record the mobile dark-system readability fix');
includes('contentDoc', '移动模块顶部阅读层收口', 'mobile content recommendations record mobile module hero readable chrome');
includes('glassDoc', '移动模块顶部 readable 收口', 'glass optimization recommendations record mobile module hero readable chrome');
includes('glassDoc', '移动高对比系统可读性守卫', 'glass optimization recommendations record the mobile high-contrast readability guard');
includes('glassDoc', '移动降低透明度可读性守卫', 'glass optimization recommendations record the mobile reduced-transparency readability guard');
includes('glassDoc', '移动减少动态效果守卫', 'glass optimization recommendations record the mobile reduced-motion guard');
includes('css', 'contain: paint', 'mobile glass layers isolate repaint work');
includes('css', 'mobile-typography-guard', 'mobile typography guard remains enabled');
includes('css', '.text-\\[9px\\], .text-\\[10px\\], .text-\\[11px\\]', 'core mobile card microcopy is lifted to the 12px readable floor');
includes('css', '.mobile-typography-guard :where(.liquid-mobile-bottom-item span)', 'mobile bottom navigation labels participate in typography guard');
includes('app', '<div className="mt-0.5 truncate text-xs font-semibold text-slate-500">{todoScopeLabel}</div>', 'mobile dashboard todo scope copy uses the explicit 12px text floor');
includesAtLeast('app', 'className="mt-0.5 truncate text-xs font-bold text-slate-500"', 1, 'mobile dashboard hero status copy uses the explicit 12px text floor');
includes('app', 'className="liquid-mobile-toolbar-title min-w-0 truncate text-base font-black text-slate-950 lg:text-lg"', 'mobile toolbar title uses an explicit 16px phone floor');
includes('app', 'aria-label={mobileNavLayout ? mobilePageTitle : pageTitle}', 'mobile toolbar title exposes the full page title when truncated');
includes('app', 'title={mobileNavLayout ? mobilePageTitle : pageTitle}', 'mobile toolbar title keeps a native full-title affordance');
includes('app', 'aria-label={`当前园区：${currentParkDisplayName}`}', 'mobile top park pill exposes the full park name when truncated');
includes('app', 'title={currentParkDisplayName}', 'mobile top park pill keeps a native full-name affordance');
includes('app', 'className="liquid-mobile-action-helper mt-0.5 block truncate text-xs font-bold"', 'mobile quick action helper copy avoids translucent micro text');
includes('app', 'const fullLabel = `${label} ${value}，${helper}`;', 'mobile focus KPI cells compose a full semantic label');
includes('app', 'role="group"', 'mobile focus KPI cells expose grouped metric semantics');
includes('app', 'aria-label={fullLabel}', 'mobile focus KPI cells expose full text when values or helpers are truncated');
includes('app', 'title={fullLabel}', 'mobile focus KPI cells keep a native full text affordance');
includes('app', 'const actionLabel = `${label}，${helper}`;', 'mobile quick action buttons compose full semantic labels');
includes('app', 'aria-label={actionLabel}', 'mobile quick action buttons expose full helper text when truncated');
includes('app', 'const todoLabel = `${title}，${metric}，${helper}，${actionLabel}`;', 'mobile todo cards compose full semantic labels');
includes('app', 'aria-label={todoLabel}', 'mobile todo cards expose full title metric helper and action when truncated');
includes('app', 'const mobileCanSwitchParks = mobileNavLayout && mobileAuthorizedParks.length > 1;', 'mobile workbench park switching is promoted to the top toolbar');
includes('app', 'aria-label={`当前园区：${currentParkDisplayName}，点击切换园区`}', 'mobile top park trigger announces that it switches parks');
includes('app', 'aria-haspopup="dialog"', 'mobile top park trigger declares the picker dialog');
includes('app', 'className="liquid-mobile-park-picker mobile-card-enter relative mx-auto max-w-[420px] rounded-[26px] p-2"', 'mobile top park picker uses a named liquid glass panel');
includes('app', 'aria-current={selected ? \'true\' : undefined}', 'mobile top park picker exposes the selected park');
notMatches('app', /liquid-mobile-park-switcher|园区汇总与切换|parkSwitchSummary|parkSwitchLabel|MOBILE_TOTAL_SCOPE|source:\s*'total'/, 'mobile dashboard no longer renders the bottom park summary or all-park total scope');
includes('app', 'className="liquid-mobile-context-line min-w-0 truncate rounded-full px-2.5 py-1 text-xs font-black sm:hidden"', 'mobile top context pill uses the explicit 12px text floor');
includes('app', '<div className="text-xs font-bold text-slate-500">收款缺口</div>', 'mobile revenue gap label uses the explicit 12px text floor');
includes('app', '<div className="text-xs font-bold text-slate-500">已租面积</div>', 'mobile leased area label uses the explicit 12px text floor');
includes('app', '<div className="text-xs font-bold text-slate-500">出租目标</div>', 'mobile occupancy target label uses the explicit 12px text floor');
includes('app', 'const mobileRemainingRevenueLabel = kpiUnavailable ? \'--\' : formatWan(remainingRevenue, 0);', 'mobile revenue gap micro value is resolved once for visible and semantic text');
includes('app', 'const mobileLeasedAreaLabel = kpiUnavailable ? \'--\' : formatArea(leasedArea);', 'mobile leased area micro value is resolved once for visible and semantic text');
includes('app', 'const mobileOccupancyTargetLabel = kpiUnavailable ? \'--\' : formatPercent(displayKpi.occupancyTarget || 0, 0);', 'mobile occupancy target micro value is resolved once for visible and semantic text');
includes('app', 'aria-label={`收款缺口 ${mobileRemainingRevenueLabel}`}', 'mobile revenue gap micro value exposes full semantic text when truncated');
includes('app', 'aria-label={`已租面积 ${mobileLeasedAreaLabel}`}', 'mobile leased area micro value exposes full semantic text when truncated');
includes('app', 'aria-label={`出租目标 ${mobileOccupancyTargetLabel}`}', 'mobile occupancy target micro value exposes full semantic text when truncated');
includes('app', 'className="liquid-mobile-focus-cell mobile-card-enter min-w-0 rounded-[18px] border px-3 py-3"', 'mobile focus KPI cells use individual readable cards');
includes('app', 'liquid-mobile-focus-grid grid grid-cols-3 gap-1.5 p-2', 'mobile focus KPI row uses spaced cards instead of faint dividers');
notMatches('app', /grid grid-cols-3 divide-x divide-slate-100\/80/, 'mobile focus KPI row avoids low-contrast divider layout');
includes('app', 'rounded-full border px-2 py-0.5 text-xs font-black ${toneClass}', 'mobile focus helper pills use the explicit 12px strong text floor');
includes('dashboardCustomFieldsComponent', '<div className="text-xs font-semibold text-slate-500">', 'mobile custom field limit and sync copy uses the explicit 12px text floor');
includes('contentDoc', '移动首屏显式字号收口', 'mobile content recommendations record the explicit mobile first-screen typography floor');
includes('glassDoc', '移动首屏显式字号收口', 'glass optimization recommendations record the explicit mobile first-screen typography floor');
includes('contentDoc', '移动首屏显式字号二次收口', 'mobile content recommendations record the second explicit mobile typography pass');
includes('glassDoc', '移动首屏显式字号二次收口', 'glass optimization recommendations record the second explicit mobile typography pass');
includes('contentDoc', '移动顶部与快捷入口可读性收口', 'mobile content recommendations record mobile toolbar and quick action readability');
includes('glassDoc', '移动顶部与快捷入口可读性收口', 'glass optimization recommendations record mobile toolbar and quick action readability');
includes('css', 'font-size: clamp(2.25rem, 11vw, 2.85rem)', 'mobile primary KPI value keeps a bounded responsive size');
includes('css', '.liquid-mobile-hero :where(.min-h-\\[96px\\])', 'mobile workbench hero has a compact short-screen height rule');
includes('css', '.liquid-mobile-filter-clear', 'mobile filter clear action has a named readable glass style');
includes('css', '.liquid-mobile-filter-clear,', 'mobile filter clear action participates in shared glass fallback groups');
includes('css', '.liquid-mobile-task-card', 'mobile todo cards keep compact short-screen spacing');
matches(
  'css',
  /@keyframes mobile-card-in\s*\{[\s\S]*?0%\s*\{[\s\S]*?opacity:\s*1;[\s\S]*?transform:\s*translateY\(0\)\s*scale\(1\);/,
  'mobile entering card keyframes keep content stable and visible from the first frame',
);
matches(
  'css',
  /\.mobile-card-enter\s*\{[\s\S]*?opacity:\s*1;[\s\S]*?transform:\s*translateY\(0\)\s*scale\(1\);/,
  'mobile entering cards keep a visible base state when animation is interrupted',
);
matches(
  'css',
  /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.mobile-card-enter\s*\{[\s\S]*?opacity:\s*1 !important;[\s\S]*?transform:\s*none !important;/,
  'mobile entering cards remain visible when reduced motion disables animation',
);
includes('css', '.liquid-mobile-park-picker', 'mobile top park picker has a named liquid glass style');
includes('css', '.liquid-mobile-park-option', 'mobile top park picker options have named readable styles');
includes('css', '.mobile-dashboard-custom-fields', 'mobile custom fields keep bottom navigation avoidance spacing');
includes('css', 'margin-top: max(', 'mobile custom fields use the larger of safe-area and viewport spacing');
includes('css', 'calc(var(--mobile-bottom-nav-height) + env(safe-area-inset-bottom) + 0.75rem)', 'mobile custom fields keep safe-area-aware bottom navigation spacing');
includes('css', 'calc(100dvh - 45rem)', 'mobile custom fields keep large-phone dynamic viewport spacing');
notMatches('css', /\.liquid-mobile-park-switcher/, 'mobile bottom park switcher spacing class is removed');
includes('css', '-webkit-overflow-scrolling: touch', 'mobile long lists keep iOS momentum scrolling');
includes('css', 'overflow-anchor: auto', 'mobile long lists keep stable scroll anchoring');
includes('css', 'padding-bottom: calc(var(--mobile-bottom-nav-height) + env(safe-area-inset-bottom) + 0.75rem)', 'mobile lists keep bottom navigation safe space');
includes('dashboardCustomFieldsComponent', 'liquid-mobile-custom-fields-track', 'mobile custom fields use a named horizontal scroll track');
includes('dashboardCustomFieldsComponent', "role: 'list' as const", 'mobile custom field track exposes list semantics');
includes('dashboardCustomFieldsComponent', '横向滚动', 'mobile custom field track announces horizontal scrolling');
includes('dashboardCustomFieldsComponent', "role={compact ? 'listitem' : undefined}", 'mobile custom field cards expose list item semantics');
includes('css', '.liquid-mobile-custom-fields-track', 'mobile custom field track participates in scroll affordance styles');
includes('css', '.liquid-budget-mobile-months, .liquid-mobile-filter-months, .liquid-mobile-search-chips, .liquid-building-switcher, .liquid-mobile-custom-fields-track', 'horizontal mobile tracks remain grouped for scroll affordance');
includes('css', '-webkit-mask-image: linear-gradient(90deg', 'horizontal mobile tracks keep a visible edge fade');
includes('css', 'scrollbar-width: none', 'horizontal mobile tracks hide native scrollbars after adding edge affordance');
includes('css', '.liquid-contract-tablet-master-detail', 'contract tablet master-detail layout remains styled');
includes('css', '.liquid-finance-tablet-master-detail', 'finance tablet master-detail layout remains styled');
includes('css', '.liquid-invoice-tablet-master-detail', 'invoice tablet master-detail layout remains styled');
includes('css', 'grid-template-columns: minmax(0, 1.08fr) minmax(280px, 0.92fr)', 'tablet master-detail layout keeps a readable preview column');
includes('css', 'max-height: calc(100dvh - 7.5rem)', 'tablet sticky previews stay within the dynamic viewport');

matches(
  'css',
  /@media \(max-width: 1023px\)[\s\S]*?\.liquid-mobile-bottom-nav[\s\S]*?backdrop-filter: blur\(16px\)/,
  'mobile bottom navigation blur is capped by the mobile performance rule',
);
matches(
  'css',
  /@media \(max-width: 1023px\)[\s\S]*?\.monthly-detail-panel[\s\S]*?backdrop-filter: blur\(16px\)/,
  'monthly detail panel blur is capped by the mobile performance rule',
);
matches(
  'css',
  /@media \(max-width: 1023px\)[\s\S]*?\.liquid-mobile-filter-backdrop[\s\S]*?backdrop-filter: blur\(12px\)/,
  'mobile sheet backdrop blur is capped by the mobile performance rule',
);

includes('app', "MOBILE_NAV_MEDIA_QUERY = '(max-width: 1023px)'", 'JS mobile breakpoint matches the lg CSS breakpoint');
includes('app', 'MOBILE_TENANT_SEARCH_PAGE_SIZE = 6', 'mobile tenant search keeps an explicit progressive result page size');
includes('app', 'setMobileSearchResultLimit(MOBILE_TENANT_SEARCH_PAGE_SIZE)', 'mobile tenant search resets visible result count when query or filters change');
includes('app', 'loadMoreMobileSearchResults', 'mobile tenant search has a load-more handler');
includes('app', 'collapseMobileSearchResults', 'mobile tenant search has a collapse handler');
includes('app', 'mobileContractFocus', 'mobile tenant search can focus the selected tenant in contracts');
includes('app', 'mobileFinanceFocus', 'mobile tenant search can focus the selected tenant in finance');
includes('app', 'toMobileTenantActionFocus', 'mobile tenant search focus ignores plain navigation click events');
includes('app', 'mobileFocusTenantId={mobileContractFocus?.tenantId}', 'contract manager receives mobile tenant focus id');
includes('app', 'mobileFocusTenantId={mobileFinanceFocus?.tenantId}', 'finance manager receives mobile tenant focus id');
includes('app', 'mobileMoreItems', 'mobile More management entry remains wired');
includes('app', 'MobileNavigation', 'mobile navigation remains componentized');
notMatches('app', /text-slate-400">(?:正在连接后端…|Loading Dashboard\.\.\.|同步中)<\/(?:div|span)>/, 'app loading and sync status avoid weak-gray text');
notMatches('app', /setSidebarOpen\(false\)\} className="absolute right-4 top-5 text-slate-400 lg:hidden"|<User size=\{14\} className="text-slate-400" \/>|<User size=\{14\} className="absolute left-3\.5 top-1\/2 -translate-y-1\/2 text-slate-400"\/>/, 'app shell and elevated user icons avoid weak-gray text');
includes('app', '<div className="text-slate-500">正在连接后端…</div>', 'app boot loading text uses readable muted text');
includes('app', '<div className="text-slate-500">Loading Dashboard...</div>', 'dashboard loading text uses readable muted text');
includes('app', '{isSyncing && <span className="text-slate-500">同步中</span>}', 'dashboard sync status uses readable muted text');
includes('app', 'className="absolute right-4 top-5 text-slate-500 lg:hidden"', 'mobile sidebar close icon uses readable muted text');
includes('app', '<User size={14} className="text-slate-500" />', 'topbar user icon uses readable muted text');
includes('app', '<User size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500"/>', 'cloud save operator icon uses readable muted text');
notMatches('app', /liquid-elevated-field[^"]*text-slate-900 outline-none focus-visible:ring-4[^"]*" placeholder="(?:请输入您的姓名|例如: 10月份月结后备份)"/, 'cloud save elevated inputs avoid default weak placeholders');
includes('app', 'className="liquid-elevated-field w-full rounded-2xl py-3 pl-9 pr-3.5 text-sm font-semibold text-slate-900 outline-none placeholder:text-slate-500 focus-visible:ring-4 focus-visible:ring-blue-500/10"', 'cloud save operator input uses readable placeholder text');
includes('app', 'className="liquid-elevated-field w-full rounded-2xl px-3.5 py-3 text-sm font-semibold text-slate-900 outline-none placeholder:text-slate-500 focus-visible:ring-4 focus-visible:ring-blue-500/10"', 'cloud save note input uses readable placeholder text');
notMatches('app', /text-\[10px\][^"]*"[^>]*>(?:V4\.0|Software Park)<\/span>/, 'sidebar brand helper text avoids 10px labels');
includes('app', 'rounded-full px-1.5 py-0.5 text-xs font-bold leading-none text-blue-700', 'sidebar version badge uses the explicit 12px text floor');
includes('app', 'text-xs uppercase tracking-[0.16em] text-slate-500', 'sidebar brand subtitle uses readable 12px helper text');
includes('app', 'aria-labelledby="auth-form-title"', 'auth form is labelled by its visible title');
includes('app', 'aria-describedby="auth-form-description"', 'auth form is described by its visible helper copy');
includes('app', 'id="auth-form-title"', 'auth form title has a stable id');
includes('app', 'id="auth-form-description"', 'auth form description has a stable id');
includes('app', 'role="group" aria-label="登录方式"', 'auth mode segmented control is named as a group');
includes('app', "aria-pressed={authMode === 'login'}", 'auth login segment exposes selected state');
includes('app', "aria-pressed={authMode === 'register'}", 'auth register segment exposes selected state');
includes('app', 'htmlFor="auth-email"', 'auth email label is explicitly associated');
includes('app', 'id="auth-email"', 'auth email input has a stable id');
includes('app', 'inputMode="email"', 'auth email input requests the email keyboard');
includes('app', 'autoCapitalize="none"', 'auth email input disables mobile auto-capitalization');
includes('app', 'spellCheck={false}', 'auth email input disables spellcheck');
includes('app', 'htmlFor="auth-applicant-name"', 'auth applicant name label is explicitly associated');
includes('app', 'id="auth-applicant-name"', 'auth applicant name input has a stable id');
includes('app', 'inputMode="text"', 'auth applicant name input declares its keyboard mode');
includes('app', 'htmlFor="auth-password"', 'auth password label is explicitly associated');
includes('app', 'id="auth-password"', 'auth password input has a stable id');
includes('app', "enterKeyHint={authMode === 'login' ? 'go' : 'done'}", 'auth password input exposes login/register submit intent to mobile keyboards');
notMatches('app', /<(?:Mail|User|LockKeyhole) className="pointer-events-none[^"]*text-slate-400"|liquid-auth-field[^"]*placeholder:text-slate-400/, 'auth input icons and placeholders avoid weak-gray text');
includes('app', '<Mail className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={17} />', 'auth email icon uses readable muted text');
includes('app', '<User className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={17} />', 'auth applicant icon uses readable muted text');
includes('app', '<LockKeyhole className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={17} />', 'auth password icon uses readable muted text');
includesAtLeast('app', 'className="liquid-auth-field w-full rounded-2xl py-3 pl-11 pr-4 text-sm font-semibold text-slate-900 outline-none transition placeholder:text-slate-500 focus:border-blue-300 focus:ring-4 focus:ring-blue-500/10"', 3, 'auth fields use readable placeholder text');
includes('app', 'id="auth-park-options-label"', 'auth park options group has a visible label id');
includes('app', 'aria-live="polite" aria-atomic="true"', 'auth selected park count is announced politely');
includes('app', 'aria-live="polite" aria-atomic="true" className="rounded-full bg-white/54 px-2.5 py-1 text-xs font-black text-blue-700"', 'auth selected park count uses the explicit 12px text floor');
includes('app', 'role="group" aria-labelledby="auth-park-options-label" aria-busy={isLoadingPublicParks}', 'auth park options are exposed as a labelled busy group');
includesAtLeast('app', 'role="status" aria-live="polite"', 2, 'auth park loading and empty states are announced politely');
includes('app', 'aria-describedby={parkMetaId}', 'auth park checkboxes describe their project id');
includes('app', 'className="sr-only">园区编号 {park.projectId}</span>', 'auth park project ids remain available to assistive tech');
includes('app', 'className="hidden shrink-0 text-xs font-black text-slate-500 sm:inline">{park.projectId}</span>', 'auth visible park project id uses the explicit 12px text floor');
includes('app', 'role="alert" aria-live="assertive"', 'auth login errors are announced assertively');
includes('app', "role={signupMsg.includes('失败') || signupMsg.includes('请') ? 'alert' : 'status'}", 'auth signup feedback distinguishes errors from status messages');
includes('app', "aria-live={signupMsg.includes('失败') || signupMsg.includes('请') ? 'assertive' : 'polite'}", 'auth signup feedback uses assertive or polite live regions');
includes('app', "aria-busy={authMode === 'login' ? isLoggingIn : isSubmittingSignup}", 'auth submit button exposes pending state');
includes('app', 'className="mt-3 flex flex-wrap gap-2 text-xs font-bold"', 'initialization entry chips use the explicit 12px text floor');
includes('app', 'rounded-full border border-amber-200/80 bg-amber-50/80 px-2.5 py-1 text-xs font-black text-amber-700', 'initialization mobile debt badge uses the explicit 12px text floor');
notMatches('app', /<span className="absolute (?:left|right)-3 (?:top-1\/2 -translate-y-1\/2|top-2\.5) text-xs font-bold text-slate-400">[￥%]<\/span>/, 'initialization amount and rate unit hints avoid weak-gray text');
includesAtLeast('app', 'text-xs font-bold text-slate-500">￥</span>', 2, 'initialization revenue unit hints use readable muted text');
includesAtLeast('app', 'text-xs font-bold text-slate-500">%</span>', 2, 'initialization occupancy unit hints use readable muted text');
includes('app', 'liquid-mobile-primary-metric', 'mobile dashboard primary KPI renders the readable glass metric card');
includes('app', 'liquid-mobile-primary-badge', 'mobile dashboard collection gap renders as a readable badge');
includes('app', 'liquid-mobile-status-pill', 'mobile dashboard status pill avoids white text on transparent blue glass');
includes('app', 'liquid-mobile-progress-track', 'mobile dashboard progress track avoids low-contrast white-on-blue glass');
includesAtLeast('app', 'liquid-mobile-card liquid-mobile-dashboard-shell mobile-card-enter lg:hidden overflow-hidden rounded-[24px]', 2, 'mobile workbench overview shells use the dedicated readable dashboard material');
includesAtLeast('app', 'liquid-mobile-hero liquid-mobile-dashboard-hero px-3.5 py-3', 2, 'mobile workbench hero areas use the dedicated readable dashboard material');
includes('app', 'liquid-mobile-readable liquid-mobile-dashboard-section border-t border-white/70 p-2.5', 'mobile todo section uses the dedicated readable dashboard section material');
includes('app', 'liquid-glass-toolbar liquid-mobile-toolbar-shell flex min-h-12', 'mobile top navigation participates in the readable phone toolbar material');
notMatches('app', /className="liquid-mobile-card mobile-card-enter lg:hidden overflow-hidden rounded-\[24px\]"/, 'mobile workbench shells do not use the generic card material without the readable dashboard class');
notMatches('app', /className="liquid-mobile-hero px-3\.5 py-3"/, 'mobile workbench hero areas do not use the generic hero material without the readable dashboard class');
includes('mobileNavigation', 'liquid-mobile-bottom-nav liquid-mobile-bottom-readable', 'mobile bottom navigation participates in the readable phone navigation material');
includes('css', '--liquid-mobile-readable-fill', 'mobile dashboard text surfaces share a high-opacity readable glass fill');
includes('css', '--liquid-mobile-readable-border', 'mobile readable glass surfaces keep a clear edge on phones');
includes('css', 'rgba(255, 255, 255, 0.998)', 'mobile readable glass fill keeps a near-opaque first layer for true-phone legibility');
includes('css', 'rgba(248, 250, 252, 0.982)', 'mobile readable glass fill keeps a stronger second layer for screenshot-compressed phones');
includes('css', 'rgba(255, 255, 255, 0.995)', 'mobile KPI/custom field cards keep a stronger readable glass layer');
includes('css', '.liquid-mobile-dashboard-shell', 'mobile workbench has a named readable shell class');
includes('css', '.liquid-mobile-dashboard-hero', 'mobile workbench hero has a named readable material class');
includes('css', '.liquid-mobile-dashboard-section', 'mobile workbench supporting sections have a named readable material class');
includes('css', '.liquid-mobile-toolbar-shell', 'mobile top navigation has a named readable material class');
includes('css', '.liquid-mobile-bottom-readable', 'mobile bottom navigation has a named readable material class');
includes('css', '.liquid-mobile-readable,', 'mobile readable sections are covered by the phone typography fallback');
includes('css', '.mobile-dashboard-custom-fields,', 'mobile custom fields inherit the phone typography readability fallback');
includes('css', 'color: #475569 !important;', 'mobile muted text is forced to a readable slate on glass');
includes('app', 'text-sm font-black text-slate-950', 'mobile dashboard top labels use high-emphasis slate text');
includes('app', 'aria-label={`当前移动端上下文：${mobilePageContext}`}', 'mobile context line exposes the visible context to assistive tech');
includes('app', 'title={mobilePageContext}', 'mobile context line keeps the full context available when visually truncated');
includes('app', 'monthly-collection-detail-title', 'monthly collection detail has a visible dialog title');
includes('app', 'monthly-collection-detail-description', 'monthly collection detail has a stable description id');
includes('app', 'const rowSummaryLabel = `${row.monthName}，完成率 ${completionRateLabel}，累计达成 ${cumulativeRateLabel}，实际收款 ${actualLabel}，合同应收 ${contractReceivableLabel}，年初预算 ${initialBudgetLabel}，去年同期 ${prevActualLabel}`;', 'monthly collection mobile cards compose full row summaries');
includes('app', 'aria-label={rowSummaryLabel}', 'monthly collection mobile cards expose full row summaries');
includes('app', 'title={rowSummaryLabel}', 'monthly collection mobile cards keep a native full-summary affordance');
includes('app', 'const monthlyDetailTotalLabel = `合计，实际收款 ${monthlyDetailTotalActualLabel}，年度累计达成 ${monthlyDetailTotalCumulativeLabel}，年初预算 ${monthlyDetailTotalInitialBudgetLabel}，合同应收 ${monthlyDetailTotalContractReceivableLabel}`;', 'monthly collection mobile total composes a full summary');
includes('app', 'aria-label={monthlyDetailTotalLabel}', 'monthly collection mobile total exposes full summary');
notMatches('app', /collectionRateTone[\s\S]*?text-slate-300|text-center font-bold text-slate-300">-<\/td>/, 'monthly collection desktop detail avoids weak-gray empty states');
includes('app', "if (rate == null) return 'bg-transparent text-slate-500';", 'monthly collection empty completion tone uses readable muted text');
includes('app', 'className="px-4 py-3.5 text-center font-bold text-slate-500">-</td>', 'monthly collection total comparison placeholder uses readable muted text');
notMatches('app', /className="mt-0\.5 text-xs font-semibold text-white\/70">年度累计达成|className="mt-0\.5 text-xs font-black text-white\/78"/, 'monthly collection mobile total avoids low-opacity white text');
includes('app', 'className="mt-0.5 text-xs font-semibold text-white/85">年度累计达成', 'monthly collection mobile total label uses high-opacity text');
includes('app', 'className="mt-0.5 text-xs font-black text-white/90"', 'monthly collection mobile total cumulative value uses high-opacity text');
includes('app', 'useDashboardCustomFieldSelection', 'dashboard custom fields use the shared preference hook');
includes('app', 'fetchCloudDashboardCustomFieldIds()', 'dashboard custom fields load cloud user preference');
includes('app', 'writeCloudDashboardCustomFieldIds(normalized)', 'dashboard custom fields save cloud user preference');
includes('app', 'writeDashboardCustomFieldIds(customFieldStorageKey, normalized)', 'dashboard custom fields keep local fallback persistence');
includes('app', "saving: { label: '同步中'", 'dashboard custom fields show a cloud sync in-progress status');
includes('app', "synced: { label: '已同步到账号'", 'dashboard custom fields show a cloud sync success status');
includes('app', "fallback: { label: '本机已保存'", 'dashboard custom fields show a local fallback status');
includesAtLeast('app', 'syncLabel={customFieldSync.label}', 2, 'dashboard custom field status copy is rendered in both dashboard layouts');
includesAtLeast('app', 'syncTone={customFieldSync.tone}', 2, 'dashboard custom field status tone is rendered in both dashboard layouts');
matches(
  'app',
  /const MonthlyCollectionDetail[\s\S]*?useMobileSheetFocus<HTMLElement, HTMLButtonElement, HTMLElement>\(\{[\s\S]*?onEscape: onClose/,
  'monthly collection detail reuses the shared focus hook for Escape handling',
);
includes('app', 'monthlyDetailTriggerRef.current = activeElement', 'monthly collection detail stores the opener for focus return');
includes('app', 'ref={monthlyDetailSheetRef}', 'monthly collection detail panel is wired to the shared focus-trap ref');
includes('app', 'ref={monthlyDetailCloseButtonRef}', 'monthly collection detail close button receives initial focus');
includes('contentDoc', '月度收款明细焦点闭环', 'mobile content recommendations record monthly detail focus loop');
includes('glassDoc', '月度收款明细焦点闭环', 'glass optimization recommendations record monthly detail focus loop');
includes('rolloutChecklist', '关闭后返回触发入口', 'mobile rollout checklist requires monthly detail focus return');
matches(
  'app',
  /const MonthlyCollectionDetail[\s\S]*?aria-labelledby="monthly-collection-detail-title"/,
  'monthly collection detail dialog is labelled by its visible title',
);
matches(
  'app',
  /const MonthlyCollectionDetail[\s\S]*?aria-describedby="monthly-collection-detail-description"/,
  'monthly collection detail dialog is described by its visible methodology copy',
);
includes('contentDoc', '月度收款明细口径说明语义守卫', 'mobile content recommendations record monthly detail methodology description semantics');
includes('glassDoc', '月度收款明细口径说明语义守卫', 'glass optimization recommendations record monthly detail methodology description semantics');
includes('rolloutChecklist', '月度明细还必须关联可见口径说明', 'mobile rollout checklist requires monthly detail methodology description semantics');
includes('contentDoc', '移动月度明细卡语义补全', 'mobile content recommendations record monthly detail card summaries');
includes('glassDoc', '移动月度明细卡语义补全', 'glass optimization recommendations record monthly detail card summaries');
matches(
  'app',
  /const MonthlyCollectionDetail[\s\S]*?onClick=\{\(event\) => event\.stopPropagation\(\)\}/,
  'monthly collection detail keeps backdrop click separate from panel clicks',
);
includes('mobileNavigation', 'liquid-mobile-bottom-nav', 'mobile bottom navigation remains present');
includes('mobileNavigation', 'liquid-mobile-more-sheet', 'mobile More management sheet remains present');
includes('mobileNavigation', 'id="mobile-more-management-sheet"', 'mobile More management sheet has a stable controlled id');
includes('mobileNavigation', 'role="dialog"', 'mobile More management sheet is exposed as a dialog');
includes('mobileNavigation', 'aria-modal="true"', 'mobile More management sheet is modal');
includes('mobileNavigation', 'aria-labelledby="mobile-more-management-title"', 'mobile More management sheet has a visible label');
includes('mobileNavigation', 'aria-describedby="mobile-more-management-context"', 'mobile More management sheet describes the current park and year context');
includes('mobileNavigation', 'id="mobile-more-management-context"', 'mobile More management context has a stable description id');
includes('mobileNavigation', 'aria-label="移动端主导航"', 'mobile bottom navigation has a stable accessible name');
includes('mobileSheetFocus', 'mobileSheetFocusableSelector', 'shared mobile sheet focus hook declares focusable controls');
includes('mobileSheetFocus', 'keepFocusInsideMobileSheet', 'shared mobile sheet focus hook traps Tab inside the panel');
includes('mobileSheetFocus', "event.key === 'Escape'", 'shared mobile sheet focus hook handles Escape');
includes('mobileSheetFocus', 'initialFocusRef.current?.focus()', 'shared mobile sheet focus hook moves focus inside after opening');
includes('mobileSheetFocus', 'triggerRef.current?.focus()', 'shared mobile sheet focus hook returns focus to trigger after closing');
includes('mobileNavigation', 'useMobileSheetFocus<HTMLButtonElement, HTMLButtonElement, HTMLElement>', 'mobile More sheet uses the shared focus hook');
includes('mobileNavigation', 'moreSheetRef', 'mobile More sheet keeps a panel ref for focus trapping');
includes('mobileNavigation', 'ref={moreSheetRef}', 'mobile More sheet panel is wired to the focus-trap ref');
includes('mobileNavigation', 'moreButtonRef', 'mobile More trigger keeps a ref for focus return');
includes('mobileNavigation', 'moreCloseButtonRef', 'mobile More sheet close action keeps a ref for initial focus');
includes('mobileNavigation', 'ref={moreCloseButtonRef}', 'mobile More close control is wired to the initial-focus ref');
includes('mobileNavigation', 'ref={isMoreItem ? moreButtonRef : undefined}', 'mobile More trigger is wired to the focus-return ref');
includes('mobileNavigation', 'const isMoreItem = item.key === \'more\'', 'mobile navigation distinguishes the More trigger from page entries');
includes('mobileNavigation', 'aria-current={item.active && !isMoreItem ? \'page\' : undefined}', 'mobile navigation exposes page entries as current without marking the More trigger as a page');
includes('mobileNavigation', 'aria-expanded={isMoreItem ? isMoreOpen : undefined}', 'mobile More trigger exposes expanded state');
includes('mobileNavigation', 'aria-controls={isMoreItem ? \'mobile-more-management-sheet\' : undefined}', 'mobile More trigger points to its sheet');
includes('mobileNavigation', 'className="liquid-glass-control liquid-pressable flex h-11 w-11 items-center justify-center rounded-full text-slate-500"', 'mobile More sheet close control keeps the 44px touch target');
includes('mobileNavigation', 'const itemLabel = `${item.active ? \'当前页面，\' : \'\'}${item.label}，${item.description}`;', 'mobile More management items compose full semantic labels');
includes('mobileNavigation', 'aria-label={itemLabel}', 'mobile More management items expose full labels when text is truncated');
includes('mobileNavigation', 'title={itemLabel}', 'mobile More management items keep a native full-label affordance');
notMatches('mobileNavigation', /text-\[(?:9|10|11)px\]|text-slate-400|text-slate-300/, 'mobile navigation avoids sub-12px and weak helper text');
includes('mobileNavigation', '<ChevronRight size={17} className="shrink-0 text-slate-500" />', 'mobile More sheet direction affordance uses readable muted text');
includes('mobileNavigationTest', 'aria-current="page"', 'mobile navigation render test covers current-page semantics');
includes('mobileNavigationTest', 'aria-expanded="true"', 'mobile navigation render test covers More trigger expanded state');
includes('mobileNavigationTest', 'aria-controls="mobile-more-management-sheet"', 'mobile navigation render test covers More trigger sheet relationship');
includes('mobileNavigationTest', 'aria-label="移动端主导航"', 'mobile navigation render test covers the named bottom navigation landmark');
includes('mobileNavigationTest', 'aria-describedby="mobile-more-management-context"', 'mobile navigation render test covers More sheet context description');
includes('mobileNavigationTest', 'aria-label="预算管理，预算执行"', 'mobile navigation render test covers More item full semantic label');
includes('mobileNavigationTest', 'title="当前页面，楼宇资管，房源与面积"', 'mobile navigation render test covers More active item title affordance');
includes('mobileNavigationTest', 'h-11 w-11', 'mobile navigation render test covers More close 44px control');
includes('contentDoc', '移动导航上下文语义守卫', 'mobile content recommendations record navigation context semantics');
includes('glassDoc', '移动导航上下文语义守卫', 'glass optimization recommendations record navigation context semantics');
includes('rolloutChecklist', '移动底部导航必须有明确导航名称', 'mobile rollout checklist requires named bottom navigation context');
includes('app', 'MobileTenantSearchPanel', 'mobile tenant query remains componentized');
notMatches('mobileSearch', /liquid-mobile-hero[^\n"]*text-white/, 'mobile tenant search hero must use readable slate text, not white text on light glass');
notMatches('mobileSearch', /text-\[(?:9|10|11)px\]|text-slate-400|text-slate-300|placeholder:text-slate-400/, 'mobile tenant search avoids sub-12px and weak helper text');
includes('mobileSearch', '<Search size={16} className="shrink-0 text-slate-500" />', 'mobile tenant search icon avoids weak-gray text');
includes('mobileSearch', 'className="min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none placeholder:text-slate-500"', 'mobile tenant search input placeholder uses readable muted text');
includes('mobileSearch', 'className="ml-1 font-black text-slate-500">{option.count}</span>', 'mobile tenant expiry month counts use readable muted text');
notMatches('contractManager', /liquid-mobile-hero[^\n"]*text-white/, 'mobile contract hero must use readable slate text, not white text on light glass');
notMatches('financeManager', /liquid-mobile-hero[^\n"]*text-white/, 'mobile finance hero must use readable slate text, not white text on light glass');
includes('mobileSearch', 'role="group"', 'mobile tenant search exposes option groups to assistive tech');
includes('mobileSearch', 'aria-label="合同状态筛选"', 'mobile tenant status chips have a named group');
includes('mobileSearch', 'aria-label={searchAdvancedActiveCount > 0 ? `打开筛选，已启用 ${searchAdvancedActiveCount} 项高级筛选` : \'打开筛选\'}', 'mobile tenant filter trigger announces active advanced filter count');
includes('mobileSearch', 'className="liquid-mobile-filter-button mobile-pressable inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-black"', 'mobile tenant filter trigger uses an explicit 44px touch target');
notMatches('mobileSearch', /className="liquid-mobile-filter-button mobile-pressable inline-flex min-h-8 shrink-0 items-center gap-1\.5 rounded-full px-3 py-1\.5 text-xs font-black"/, 'mobile tenant filter trigger does not rely on a 32px source target');
includes('mobileSearch', 'className="liquid-mobile-filter-clear mobile-pressable inline-flex min-h-11 items-center justify-center rounded-full px-2.5 py-1 text-xs font-black"', 'mobile tenant clear filters action uses an explicit 44px touch target');
notMatches('mobileSearch', /className="liquid-mobile-filter-clear mobile-pressable inline-flex items-center justify-center rounded-full px-2\.5 py-1 text-xs font-black"/, 'mobile tenant clear filters action does not rely only on global touch target fallback');
includes('mobileSearch', 'liquid-mobile-filter-count inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs', 'mobile tenant active filter count badge uses the explicit 12px text floor');
includes('mobileSearch', 'rounded-full bg-amber-50 px-2.5 py-1 text-xs text-amber-700', 'mobile tenant arrears prerequisite badge uses the explicit 12px text floor');
includes('mobileSearch', 'className="liquid-mobile-inline-action mobile-pressable inline-flex h-11 w-11 items-center justify-center rounded-full"', 'mobile tenant filter sheet close button uses a 44px explicit touch target');
notMatches('mobileSearch', /className="liquid-mobile-inline-action mobile-pressable inline-flex h-9 w-9 items-center justify-center rounded-full"/, 'mobile tenant filter sheet close button does not use a 36px visual target');
includes('mobileSearch', 'id="mobile-tenant-filter-building-title"', 'mobile tenant building filter has a visible group title id');
includes('mobileSearch', 'aria-labelledby="mobile-tenant-filter-building-title"', 'mobile tenant building filter options are labelled by the visible title');
includes('mobileSearch', 'id="mobile-tenant-filter-expiry-title"', 'mobile tenant expiry filter has a visible group title id');
includes('mobileSearch', 'aria-labelledby="mobile-tenant-filter-expiry-title"', 'mobile tenant expiry filter options are labelled by the visible title');
includes('mobileSearch', 'id="mobile-tenant-filter-payment-title"', 'mobile tenant payment filter has a visible group title id');
includes('mobileSearch', 'aria-labelledby="mobile-tenant-filter-payment-title"', 'mobile tenant payment filter options are labelled by the visible title');
includes('mobileSearch', 'id="mobile-tenant-filter-receivable-title"', 'mobile tenant current-period filter has a visible group title id');
includes('mobileSearch', 'aria-labelledby="mobile-tenant-filter-receivable-title"', 'mobile tenant current-period filter options are labelled by the visible title');
includes('mobileSearch', 'id="mobile-tenant-filter-arrears-title"', 'mobile tenant historical-arrears filter has a visible group title id');
includes('mobileSearch', 'aria-labelledby="mobile-tenant-filter-arrears-title"', 'mobile tenant historical-arrears filter options are labelled by the visible title');
includes('mobileSearchTest', 'aria-label="打开筛选，已启用 2 项高级筛选"', 'mobile tenant search render test covers active filter count announcement');
includes('mobileSearchTest', 'liquid-mobile-filter-button mobile-pressable inline-flex min-h-11', 'mobile tenant search render test covers the 44px filter trigger');
includes('mobileSearchTest', 'liquid-mobile-filter-clear mobile-pressable inline-flex min-h-11', 'mobile tenant search render test covers the 44px clear action');
includes('mobileSearchTest', 'h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs', 'mobile tenant search render test covers readable filter count badge');
includes('contentDoc', '移动筛选分组选项语义守卫', 'mobile content recommendations record the tenant filter grouping semantics');
includes('glassDoc', '移动筛选分组选项语义守卫', 'glass optimization recommendations record the tenant filter grouping semantics');
includes('rolloutChecklist', '客户查询筛选项必须按状态、楼栋、到期月份、收款记录、当前账期和历史欠费建立命名分组', 'mobile rollout checklist requires named tenant filter groups');
includes('app', 'DashboardCustomFields', 'dashboard custom field UI remains componentized');
includes('dashboardCustomFieldsComponent', 'syncLabel?: string', 'dashboard custom field component accepts sync status copy');
includes('dashboardCustomFieldsComponent', "syncTone?: 'blue' | 'cyan' | 'amber' | 'slate'", 'dashboard custom field component accepts sync status tone');
includes('dashboardCustomFieldsComponent', 'settingsOpen?: boolean', 'dashboard custom field triggers accept open state from the parent');
includes('dashboardCustomFieldsComponent', 'syncLabel &&', 'dashboard custom field component renders sync status when provided');
includesAtLeast('app', 'settingsOpen={customFieldSettingsOpen}', 2, 'dashboard custom field triggers stay wired on desktop and mobile');
includesAtLeast('dashboardCustomFieldsComponent', 'aria-expanded={settingsOpen}', 2, 'dashboard custom field triggers expose whether the settings panel is open');
includesAtLeast('dashboardCustomFieldsComponent', 'aria-controls="dashboard-custom-field-settings-panel"', 2, 'dashboard custom field triggers point to the settings panel');
includes('dashboardCustomFieldsComponent', 'useMobileSheetFocus<HTMLElement, HTMLButtonElement, HTMLElement>', 'dashboard custom field settings reuse the shared mobile sheet focus hook');
includes('dashboardCustomFieldsComponent', 'settingsTriggerRef.current = activeElement', 'dashboard custom field settings stores the opener for focus return');
includes('dashboardCustomFieldsComponent', 'ref={settingsSheetRef}', 'dashboard custom field settings panel wires the focus-trap ref');
includes('dashboardCustomFieldsComponent', 'ref={settingsCloseButtonRef}', 'dashboard custom field settings close button receives initial focus');
includes('dashboardCustomFieldsComponent', 'id="dashboard-custom-field-settings-panel"', 'dashboard custom field settings panel has a stable id');
includes('dashboardCustomFieldsComponent', 'aria-describedby="dashboard-custom-field-settings-description"', 'dashboard custom field settings dialog describes the field limit and sync behavior');
includes('dashboardCustomFieldsComponent', 'id="dashboard-custom-field-settings-description"', 'dashboard custom field settings description has a stable id');
includes('dashboardCustomFieldsComponent', 'aria-pressed={checked}', 'dashboard custom field settings options expose selected state');
includes('dashboardCustomFieldsComponent', 'aria-live="polite" aria-atomic="true"', 'dashboard custom field selected count is announced politely');
includes('dashboardCustomFieldsTest', 'aria-expanded="true"', 'dashboard custom field render test covers opened trigger state');
includes('dashboardCustomFieldsTest', 'aria-expanded="false"', 'dashboard custom field render test covers closed trigger state');
includes('dashboardCustomFieldsTest', 'aria-controls="dashboard-custom-field-settings-panel"', 'dashboard custom field render test covers trigger-panel linkage');
includes('dashboardCustomFieldsTest', 'id="dashboard-custom-field-settings-panel"', 'dashboard custom field render test covers settings panel id');
includes('dashboardCustomFieldsComponent', 'mobile-dashboard-custom-fields liquid-mobile-readable', 'mobile custom field shell uses the named readable glass material');
includes('dashboardCustomFieldsComponent', 'liquid-mobile-custom-field min-h-[84px]', 'mobile custom field cards keep enough vertical space for clear labels and values');
notMatches('dashboardCustomFieldsComponent', /mobile-dashboard-custom-fields[^'"]*bg-white\/90/, 'mobile custom field shell avoids plain utility white in place of named glass material');
includesAtLeast('app', 'className="liquid-mobile-year-step mobile-pressable flex h-11 w-11 items-center justify-center rounded-full text-blue-700"', 2, 'mobile dashboard year step buttons use explicit 44px touch targets in source');
notMatches('app', /className="liquid-mobile-year-step mobile-pressable flex h-9 w-9 items-center justify-center rounded-full text-blue-700"/, 'mobile dashboard year step buttons do not rely on 36px visual buttons');
includes('contentDoc', '关注字段设置触发器语义', 'mobile content recommendations record custom field settings trigger semantics');
includes('glassDoc', '关注字段设置触发器语义', 'glass optimization recommendations record custom field settings trigger semantics');
includes('rolloutChecklist', '空状态添加入口和常规设置入口应指向同一个设置面板', 'mobile rollout checklist requires settings triggers to share a stable panel target');
includes('contentDoc', '移动首页可读玻璃层级', 'mobile content recommendations record the readable mobile dashboard glass layer');
includes('glassDoc', '移动首页可读玻璃层级', 'glass optimization recommendations record the readable mobile dashboard glass layer');
includes('contentDoc', '移动工作台真机可读层加固', 'mobile content recommendations record the real-device readable mobile workbench layer');
includes('glassDoc', '移动工作台真机可读层加固', 'glass optimization recommendations record the real-device readable mobile workbench layer');
includes('contentDoc', '移动顶部园区切换语义补全', 'mobile content recommendations record top-toolbar park switching');
includes('glassDoc', '移动顶部园区切换语义补全', 'glass optimization recommendations record top-toolbar park switching');
includes('rolloutChecklist', '移动首页首屏必须避免白字叠高透明蓝色玻璃', 'mobile rollout checklist requires readable mobile dashboard glass');
includes('customFieldCloudPreferences', 'fetchCloudDashboardCustomFieldIds', 'dashboard custom fields have a cloud preference reader');
includes('customFieldCloudPreferences', 'writeCloudDashboardCustomFieldIds', 'dashboard custom fields have a cloud preference writer');
includes('customFieldCloudPreferences', 'normalizeDashboardCustomFieldIds', 'cloud preference payloads reuse the same five-field normalization');
includes('customFieldCloudPreferences', 'getCurrentCloudAuthToken', 'cloud preference calls are scoped to the logged-in user token');
includes('urls', 'getIntegrationAppDashboardCustomFieldsPreferenceUrl', 'dashboard custom field preference endpoint URL remains centralized');
includes('integrationGateway', 'pb_user_preferences', 'gateway persists dashboard custom fields in the user preference collection');
includes('integrationGateway', 'handleAppDashboardCustomFieldsPreferenceGet', 'gateway exposes a reader for dashboard custom field preferences');
includes('integrationGateway', 'handleAppDashboardCustomFieldsPreferenceSave', 'gateway exposes a writer for dashboard custom field preferences');
includes('integrationGateway', '/api/integration/app/preferences/dashboard-custom-fields', 'gateway keeps the compatible dashboard custom field preference path');
includes('userPreferencesMigration', 'pb_user_preferences', 'PocketBase migration creates the user preference collection');
includes('userPreferencesMigration', 'idx_pb_user_preferences_user_key', 'user preference collection enforces one row per user and key');
includes('userPreferencesMigration', 'user_id = @request.auth.id', 'user preference collection keeps per-user access rules');
includes('rolloutChecklist', '移动端与字段口径上线验收清单', 'mobile rollout checklist remains present');
includes('rolloutChecklist', './11-移动端与字段口径上线验收记录模板.md', 'mobile rollout checklist links the rollout record template');
includes('rolloutChecklist', '不能替代人工截图和生产环境接口验收', 'mobile rollout checklist distinguishes automated checks from manual production QA');
includes('rolloutRecordTemplate', '移动端与字段口径上线验收记录模板', 'mobile rollout record template remains present');
includes('rolloutRecordTemplate', 'npm run qa:rollout:record:check -- docs/rollout-records/记录文件.md', 'mobile rollout record template points to the record completeness check');
includes('rolloutRecordTemplate', '发布信息', 'mobile rollout record template captures release metadata');
includes('rolloutRecordTemplate', '自动回归记录', 'mobile rollout record template captures automated regression output');
includes('rolloutRecordTemplate', '移动 / 平板截图 QA', 'mobile rollout record template captures screenshot QA');
includes('rolloutRecordTemplate', 'npm run qa:mobile-auth-state', 'mobile rollout record template captures authenticated storage state generation');
includes('rolloutRecordTemplate', '--color-scheme both', 'mobile rollout record template captures light and dark screenshot coverage');
includes('rolloutRecordTemplate', '--reduced-motion both', 'mobile rollout record template captures reduced-motion screenshot coverage');
includes('rolloutRecordTemplate', '--require-authenticated', 'mobile rollout record template requires authenticated screenshot verification');
includes('rolloutRecordTemplate', '是否加载登录态', 'mobile rollout record template records whether screenshots used auth state');
includes('rolloutRecordTemplate', '是否启用登录后校验', 'mobile rollout record template records authenticated shell verification');
includes('rolloutRecordTemplate', '色彩模式覆盖', 'mobile rollout record template records light/dark coverage');
includes('rolloutRecordTemplate', '动态效果覆盖', 'mobile rollout record template records default/reduced motion coverage');
includes('rolloutRecordTemplate', '字段口径抽查', 'mobile rollout record template captures field calculation spot checks');
includes('rolloutRecordTemplate', '封账明细迁移记录', 'mobile rollout record template captures sealed-month migration evidence');
includes('rolloutRecordTemplate', '云端接口与迁移记录', 'mobile rollout record template captures cloud endpoint and migration checks');
includes('rolloutRecordTemplate', '灰度观察', 'mobile rollout record template captures canary observations');
includes('rolloutRecordTemplate', 'npm run qa:rollout', 'mobile rollout record template captures the one-command rollout check');
includes('rolloutRecordTemplate', '375x812', 'mobile rollout record template covers narrow mobile screenshots');
includes('rolloutRecordTemplate', '1024x768', 'mobile rollout record template covers tablet landscape boundary screenshots');
includes('rolloutRecordTemplate', 'npm run seal:backfill -- --from 2026-01 --to 上月 --dry-run', 'mobile rollout record template captures sealed-month dry-run evidence');
includes('rolloutRecordTemplate', 'GET /api/integration/app/preferences/dashboard-custom-fields', 'mobile rollout record template covers preference endpoint verification');
includes('rolloutRecordTemplate', 'POST /api/integration/app/compute/tenant-historical-arrears', 'mobile rollout record template covers arrears endpoint verification');
includes('packageJson', '"qa:rollout": "node scripts/check-rollout-readiness.mjs"', 'package exposes the rollout readiness command');
includes('packageJson', '"qa:rollout:record": "node scripts/create-rollout-record.mjs"', 'package exposes the rollout record generator command');
includes('packageJson', '"qa:rollout:record:check": "node scripts/check-rollout-record.mjs"', 'package exposes the rollout record completeness check');
includes('packageJson', '"qa:mobile-screenshots": "node scripts/capture-mobile-screenshots.mjs"', 'package exposes the mobile screenshot QA command');
includes('packageJson', '"qa:mobile-screenshot-report": "node scripts/check-mobile-screenshot-report.mjs"', 'package exposes the mobile screenshot report checker command');
includes('packageJson', '"qa:mobile-auth-state": "node scripts/save-mobile-auth-state.mjs"', 'package exposes the mobile auth state helper command');
includes('packageJson', '"playwright": "^1.61.1"', 'package includes Playwright as a dev dependency for API-based screenshot emulation');
includes('gitignore', 'output/mobile-auth-state/', 'generated mobile auth storage states stay out of git');
includes('rolloutReadiness', 'npm', 'rollout readiness script can run npm commands');
includes('rolloutReadiness', "['run', 'qa:mobile-ui']", 'rollout readiness script runs the mobile UI guardrails first');
includes('rolloutReadiness', 'services/__tests__/dashboardCustomFields.test.ts', 'rollout readiness script covers dashboard custom field tests');
includes('rolloutReadiness', 'services/__tests__/tenantHistoricalArrears.test.ts', 'rollout readiness script covers tenant historical arrears tests');
includes('rolloutReadiness', 'services/__tests__/budgetMobileAdjustment.test.ts', 'rollout readiness script covers mobile budget adjustment tests');
includes('rolloutReadiness', 'components/__tests__/BuildingMobileActionSheets.test.tsx', 'rollout readiness script covers building mobile action sheet tests');
includes('rolloutReadiness', 'scripts/__tests__/rolloutRecordScripts.test.ts', 'rollout readiness script covers rollout record script tests');
includes('rolloutReadiness', "['tsc', '--noEmit']", 'rollout readiness script runs TypeScript verification');
includes('rolloutReadiness', "['run', 'build']", 'rollout readiness script runs the production build');
includes('rolloutRecordCreator', 'docs/11-移动端与字段口径上线验收记录模板.md', 'rollout record generator reads the canonical template');
includes('rolloutRecordCreator', 'docs/rollout-records', 'rollout record generator writes records into the archive directory by default');
includes('rolloutRecordCreator', 'formatShanghaiDate', 'rollout record generator uses Asia/Shanghai release dates');
includes('rolloutRecordCreator', 'gitValue', 'rollout record generator captures git branch and commit');
includes('rolloutRecordCreator', 'nextAvailablePath', 'rollout record generator avoids overwriting existing records');
includes('rolloutRecordScriptsTest', 'scripts/create-rollout-record.mjs', 'rollout record script test runs the generator CLI');
includes('rolloutRecordScriptsTest', 'scripts/check-rollout-record.mjs', 'rollout record script test runs the completeness checker CLI');
includes('rolloutRecordScriptsTest', 'not.toContain(\'> 使用方式：\')', 'rollout record script test guards against leaking template usage copy into generated records');
includes('rolloutRecordScriptsTest', 'mobile-field-rollout-2026-06-24-2.md', 'rollout record script test guards against overwriting same-day records');
includes('rolloutRecordScriptsTest', 'unresolved placeholder "通过 / 不通过"', 'rollout record script test covers unfinished draft rejection');
includes('rolloutRecordScriptsTest', 'unresolved placeholder "默认 / 减少动态 / 默认+减少动态"', 'rollout record script test covers unfinished reduced-motion coverage rejection');
includes('rolloutRecordScriptsTest', 'report reducedMotion must be "both"', 'rollout record script test covers weak reduced-motion screenshot report rejection');
includes('rolloutRecordScriptsTest', 'Rollout record check passed', 'rollout record script test covers filled record acceptance');
includes('mobileScreenshotQa', '375x812-dashboard', 'mobile screenshot QA captures the narrow phone viewport');
includes('mobileScreenshotQa', '390x844-more-filter', 'mobile screenshot QA captures the standard phone viewport');
includes('mobileScreenshotQa', '430x932-building-budget', 'mobile screenshot QA captures the large phone viewport');
includes('mobileScreenshotQa', '768x1024-tablet-portrait', 'mobile screenshot QA captures the tablet portrait viewport');
includes('mobileScreenshotQa', '1024x768-tablet-landscape', 'mobile screenshot QA captures the tablet landscape boundary viewport');
includes('mobileScreenshotQa', 'output/mobile-screenshot-qa', 'mobile screenshot QA writes artifacts into the output folder');
includes('mobileScreenshotQa', "import { chromium, firefox, webkit } from 'playwright'", 'mobile screenshot QA uses Playwright API instead of the limited screenshot CLI');
includes('mobileScreenshotQa', '--color-scheme light|dark|both', 'mobile screenshot QA documents color-scheme coverage');
includes('mobileScreenshotQa', '--reduced-motion no-preference|reduce|both', 'mobile screenshot QA documents reduced-motion coverage');
includes('mobileScreenshotQa', 'getColorSchemes', 'mobile screenshot QA can capture more than one color scheme');
includes('mobileScreenshotQa', 'getReducedMotionModes', 'mobile screenshot QA can capture more than one motion preference');
includes('mobileScreenshotQa', '--color-scheme', 'mobile screenshot QA passes preferred color scheme to Playwright');
includes('mobileScreenshotQa', 'reducedMotion,', 'mobile screenshot QA passes reduced-motion preference to Playwright');
includes('mobileScreenshotQa', '--storage-state', 'mobile screenshot QA documents authenticated storage state loading');
includes('mobileScreenshotQa', '--load-storage', 'mobile screenshot QA passes authenticated storage state to Playwright');
includes('mobileScreenshotQa', 'storageState: storagePath || undefined', 'mobile screenshot QA passes authenticated storage state to the Playwright context');
includes('mobileScreenshotQa', '--require-authenticated', 'mobile screenshot QA can fail when auth state lands on the login page');
includes('mobileScreenshotQa', '--authenticated-selector', 'mobile screenshot QA exposes the authenticated shell selector');
includes('mobileScreenshotQa', 'reducedMotion: options.reducedMotion', 'mobile screenshot QA writes reduced-motion coverage into report JSON');
includes('mobileScreenshotQa', 'requireAuthenticated: options.requireAuthenticated', 'mobile screenshot QA writes authenticated-shell verification into report JSON');
includes('mobileScreenshotQa', 'authenticatedSelector: options.requireAuthenticated ? options.authenticatedSelector : null', 'mobile screenshot QA writes authenticated selector into report JSON');
includes('mobileScreenshotQa', '[title="退出登录"]', 'mobile screenshot QA waits for the logged-in app shell by default');
includes('mobileScreenshotQa', 'npx playwright install chromium', 'mobile screenshot QA explains the Playwright browser install prerequisite');
includes('mobileScreenshotQa', 'docs/rollout-records/', 'mobile screenshot QA tells reviewers to attach screenshots to rollout records');
includes('mobileScreenshotReportChecker', 'expectedViewports', 'mobile screenshot report checker declares required viewport coverage');
includes('mobileScreenshotReportChecker', "report.colorScheme !== 'both'", 'mobile screenshot report checker requires light and dark coverage');
includes('mobileScreenshotReportChecker', 'expectedReducedMotionModes', 'mobile screenshot report checker declares required motion preference coverage');
includes('mobileScreenshotReportChecker', "report.reducedMotion !== 'both'", 'mobile screenshot report checker requires default and reduced-motion coverage');
includes('mobileScreenshotReportChecker', 'report.storageState', 'mobile screenshot report checker requires authenticated storage state evidence');
includes('mobileScreenshotReportChecker', 'report.requireAuthenticated !== true', 'mobile screenshot report checker requires authenticated-shell verification evidence');
includes('mobileScreenshotReportChecker', 'report.authenticatedSelector', 'mobile screenshot report checker requires the authenticated shell selector evidence');
includes('mobileScreenshotReportChecker', 'reducedMotion must be no-preference or reduce', 'mobile screenshot report checker validates each screenshot motion preference');
includes('mobileScreenshotReportChecker', 'record.authenticated !== true', 'mobile screenshot report checker rejects unauthenticated screenshots');
includes('mobileScreenshotReportChecker', 'screenshot file does not exist', 'mobile screenshot report checker verifies referenced screenshot files');
includes('mobileAuthState', 'npx playwright install chromium', 'mobile auth state helper explains the Playwright browser install prerequisite');
includes('mobileAuthState', '--save-storage', 'mobile auth state helper saves Playwright storage state');
includes('mobileAuthState', 'output/mobile-auth-state', 'mobile auth state helper writes to the ignored auth-state output folder');
includes('mobileAuthState', 'Do not commit the generated storage state file', 'mobile auth state helper warns against committing session files');
includes('mobileAuthState', 'npm run qa:mobile-screenshots', 'mobile auth state helper prints the follow-up screenshot command');
includes('mobileAuthState', '--reduced-motion both', 'mobile auth state helper prints reduced-motion screenshot coverage in the follow-up command');
includes('rolloutRecordChecker', '通过 / 不通过', 'rollout record checker rejects unresolved pass/fail placeholders');
includes('rolloutRecordChecker', '正常 / 异常', 'rollout record checker rejects unresolved canary placeholders');
includes('rolloutRecordChecker', '允许 / 暂缓', 'rollout record checker rejects unresolved launch decision placeholders');
includes('rolloutRecordChecker', '浅色 / 深色 / 浅色+深色', 'rollout record checker rejects unresolved light/dark screenshot coverage placeholders');
includes('rolloutRecordChecker', '默认 / 减少动态 / 默认+减少动态', 'rollout record checker rejects unresolved reduced-motion coverage placeholders');
includes('rolloutRecordChecker', 'mobile screenshot QA must load authenticated storage state', 'rollout record checker requires authenticated screenshot evidence');
includes('rolloutRecordChecker', 'mobile screenshot QA must enable authenticated shell verification', 'rollout record checker requires authenticated shell verification evidence');
includes('rolloutRecordChecker', 'mobile screenshot QA must cover both light and dark color schemes', 'rollout record checker requires light and dark screenshot evidence');
includes('rolloutRecordChecker', 'mobile screenshot QA must cover default and reduced motion preferences', 'rollout record checker requires reduced-motion screenshot evidence');
includes('rolloutRecordChecker', 'mobile screenshot QA report path must be filled', 'rollout record checker requires screenshot report evidence');
includes('rolloutRecordChecker', 'checkMobileScreenshotReport', 'rollout record checker validates screenshot report content');
includes('rolloutRecordChecker', 'mobile screenshot QA report content must prove authenticated light and dark viewport coverage with reduced motion evidence', 'rollout record checker rejects weak screenshot report evidence');
includes('rolloutRecordChecker', 'release date must be filled as YYYY-MM-DD', 'rollout record checker validates release date');
includes('rolloutRecordChecker', 'final launch decision must be filled with 允许 or 暂缓', 'rollout record checker validates final launch decision');
includes('rolloutRecordChecker', 'GET /api/integration/app/preferences/dashboard-custom-fields', 'rollout record checker keeps preference endpoint evidence rows');
includes('rolloutRecordChecker', 'POST /api/integration/app/compute/tenant-historical-arrears', 'rollout record checker keeps arrears endpoint evidence rows');
includes('rolloutChecklist', 'npm run qa:rollout:record -- --env 阿里云生产', 'mobile rollout checklist points to the rollout record generator');
includes('rolloutChecklist', 'npm run qa:rollout:record:check -- docs/rollout-records/记录文件.md', 'mobile rollout checklist points to the rollout record completeness check');
includes('rolloutChecklist', 'npm run qa:rollout', 'mobile rollout checklist points to the one-command rollout readiness check');
includes('rolloutChecklist', 'npm run qa:mobile-ui', 'mobile rollout checklist requires the mobile UI guardrail command');
includes('rolloutChecklist', 'npx tsc --noEmit', 'mobile rollout checklist requires TypeScript verification');
includes('rolloutChecklist', 'npm run build', 'mobile rollout checklist requires production build verification');
includes('rolloutChecklist', '375x812', 'mobile rollout checklist covers narrow iPhone screenshot QA');
includes('rolloutChecklist', '390x844', 'mobile rollout checklist covers standard iPhone screenshot QA');
includes('rolloutChecklist', '430x932', 'mobile rollout checklist covers large iPhone screenshot QA');
includes('rolloutChecklist', '768x1024', 'mobile rollout checklist covers tablet portrait screenshot QA');
includes('rolloutChecklist', '1024x768', 'mobile rollout checklist covers tablet landscape boundary QA');
includes('rolloutChecklist', '--color-scheme both', 'mobile rollout checklist requires light and dark screenshot evidence');
includes('rolloutChecklist', '--reduced-motion both', 'mobile rollout checklist requires reduced-motion screenshot evidence');
includes('rolloutChecklist', '--storage-state', 'mobile rollout checklist requires authenticated screenshots when validating logged-in pages');
includes('rolloutChecklist', 'npm run qa:mobile-auth-state', 'mobile rollout checklist requires creating auth storage state before authenticated screenshots');
includes('rolloutChecklist', 'npm run qa:mobile-screenshot-report', 'mobile rollout checklist requires validating screenshot reports');
includes('rolloutChecklist', '--require-authenticated', 'mobile rollout checklist requires authenticated shell verification for logged-in screenshots');
includes('rolloutChecklist', 'iPhone 深色外观', 'mobile rollout checklist explicitly covers iPhone dark appearance readability');
includes('rolloutChecklist', '默认+减少动态', 'mobile rollout checklist explicitly covers default and reduced-motion readability');
includes('rolloutChecklist', 'buildTenantHistoricalArrears', 'mobile rollout checklist pins the tenant arrears calculation source');
includes('rolloutChecklist', 'pb_user_preferences.user_id + preference_key', 'mobile rollout checklist pins dashboard preference persistence scope');
includes('rolloutChecklist', 'amount_delta', 'mobile rollout checklist pins the mobile budget adjustment kind');
includes('rolloutChecklist', '/api/integration/app/compute/tenant-historical-arrears', 'mobile rollout checklist requires the tenant arrears compute endpoint');
includes('rolloutChecklist', '/api/integration/app/preferences/dashboard-custom-fields', 'mobile rollout checklist requires the custom field preference endpoint');
includes('rolloutChecklist', 'pocketbase/pb_migrations/1789000000_created_pb_user_preferences.js', 'mobile rollout checklist requires the user preference migration');
includes('rolloutChecklist', 'npm run seal:backfill -- --from 2026-01 --to 上月 --dry-run', 'mobile rollout checklist requires the sealed-month dry-run');
includes('rolloutChecklist', '不允许在组件里新写欠费、应收、出租率、合同应收或预算合计公式', 'mobile rollout checklist blocks UI-side metric recalculation');
includes('deploymentDoc', 'npm run qa:rollout', 'deployment guide requires the rollout readiness command before deploy');
includes('deploymentDoc', 'npm run qa:rollout:record -- --env 阿里云生产', 'deployment guide requires creating a rollout record before deploy');
includes('deploymentDoc', 'npm run qa:rollout:record:check -- docs/rollout-records/记录文件.md', 'deployment guide requires checking the filled rollout record');
includes('deploymentDoc', 'npm run qa:mobile-screenshots', 'deployment guide mentions the mobile screenshot QA helper command');
includes('deploymentDoc', 'npm run qa:mobile-auth-state', 'deployment guide requires the mobile auth state helper before authenticated screenshot QA');
includes('deploymentDoc', 'npm run qa:mobile-screenshot-report', 'deployment guide validates mobile screenshot report content before deploy');
includes('deploymentDoc', '--color-scheme both', 'deployment guide captures light and dark mobile screenshot QA before deploy');
includes('deploymentDoc', '--reduced-motion both', 'deployment guide captures default and reduced-motion screenshot QA before deploy');
includes('deploymentDoc', '--storage-state output/mobile-auth-state/auth-state.json', 'deployment guide documents authenticated mobile screenshot QA');
includes('deploymentDoc', '--require-authenticated', 'deployment guide fails authenticated screenshot QA when auth state is stale');
includes('deploymentDoc', './10-移动端与字段口径上线验收清单.md', 'deployment guide links the rollout checklist');
includes('deploymentDoc', './11-移动端与字段口径上线验收记录模板.md', 'deployment guide links the rollout record template');
includes('app', 'mobilePageContext', 'mobile top context line remains wired');
includes('css', 'liquid-mobile-context-line', 'mobile context line keeps dedicated styling');
includes('app', '客户查询', 'mobile context line covers tenant query mode');
includes('app', '今日待办', 'mobile context line covers dashboard action mode');
includes('app', '应收核销', 'mobile context line covers finance receivable mode');
includes('app', '合同轻管理', 'mobile context line covers contract management mode');
includes('app', '预算执行', 'mobile context line covers budget mode');
includes('app', '房源与面积', 'mobile context line covers building management mode');

[
  'app',
  'contractManager',
  'buildingManager',
  'budgetManager',
  'financeManager',
  'paymentCycleDialog',
  'aiContractModal',
  'aiPaymentModal',
].forEach(numberInputsHaveMobileKeyboardHints);

includes('mobileSearch', 'aria-modal="true"', 'mobile filter sheet is exposed as a modal dialog');
includes('mobileSearch', 'id="mobile-tenant-filter-sheet"', 'mobile filter sheet has a stable controlled id');
includes('mobileSearch', 'role="dialog"', 'mobile filter sheet is exposed as a dialog');
includes('mobileSearch', 'aria-labelledby="mobile-tenant-filter-title"', 'mobile filter sheet has a visible label');
includes('mobileSearch', 'useMobileSheetFocus<HTMLButtonElement, HTMLButtonElement, HTMLElement>', 'mobile filter sheet uses the shared focus hook');
includes('mobileSearch', 'filterSheetRef', 'mobile filter sheet keeps a panel ref for focus trapping');
includes('mobileSearch', 'ref={filterSheetRef}', 'mobile filter sheet panel is wired to the focus-trap ref');
includes('mobileSearch', 'filterButtonRef', 'mobile filter trigger keeps a ref for focus return');
includes('mobileSearch', 'filterCloseButtonRef', 'mobile filter sheet close action keeps a ref for initial focus');
includes('mobileSearch', 'ref={filterCloseButtonRef}', 'mobile filter close control is wired to the initial-focus ref');
includes('mobileSearch', 'ref={filterButtonRef}', 'mobile filter trigger is wired to the focus-return ref');
includes('mobileSearch', 'closeSearchFilterSheet', 'mobile filter sheet uses a shared close path');
includes('mobileSearch', 'aria-expanded={isSearchFilterSheetOpen}', 'mobile filter trigger exposes expanded state');
includes('mobileSearch', 'aria-controls="mobile-tenant-filter-sheet"', 'mobile filter trigger points to its sheet');
includes('mobileSearch', 'type="search"', 'mobile tenant search input uses the native search field type');
includes('mobileSearch', 'enterKeyHint="search"', 'mobile tenant search input exposes a search keyboard action');
includes('mobileSearch', 'const itemContext = `${item.name}，${item.location}，${item.statusLabel}，${itemSummary}`', 'mobile tenant result cards preserve full context when visible text is truncated');
includes('mobileSearch', 'aria-label={itemContext}', 'mobile tenant result cards expose full tenant context to assistive tech');
includes('mobileSearch', 'title={itemContext}', 'mobile tenant result cards retain full truncated context for inspection');
includes('mobileSearch', 'title={`${item.location} · ${item.statusLabel}`}', 'mobile tenant result location/status text keeps a full title');
includes('mobileSearch', 'aria-label={`查看 ${item.name} 合同`}', 'mobile tenant contract action names the selected tenant');
includes('mobileSearch', 'aria-label={`核销 ${item.name} 收款`}', 'mobile tenant finance action names the selected tenant');
includes('mobileSearch', 'className="liquid-mobile-inline-action mobile-pressable inline-flex min-h-11 items-center rounded-xl px-3 py-2 text-xs font-black"', 'mobile tenant contract/collapse actions use 44px touch targets');
includes('mobileSearch', 'className="liquid-mobile-inline-action-strong mobile-pressable inline-flex min-h-11 items-center rounded-xl px-3 py-2 text-xs font-black"', 'mobile tenant finance/load-more actions use 44px touch targets');
includes('mobileSearch', 'className="liquid-mobile-inline-action mobile-pressable mt-4 inline-flex min-h-11 items-center rounded-xl px-4 py-2 text-xs font-black"', 'mobile tenant empty-state action uses a 44px touch target');
notMatches('mobileSearch', /liquid-mobile-inline-action(?:-strong)?[^\n"]*min-h-10/, 'mobile tenant inline actions avoid 40px touch targets');
includes('mobileSearch', 'aria-pressed={searchFilter === option.key}', 'mobile search status chips expose selected state');
includes('mobileSearch', 'aria-pressed={searchBuildingFilter ===', 'mobile search building filter options expose selected state');
includes('mobileSearch', 'aria-pressed={searchExpiryMonthFilter ===', 'mobile search expiry filter options expose selected state');
includes('mobileSearch', 'aria-pressed={searchPaymentFilter === option.key}', 'mobile search payment filter options expose selected state');
includes('mobileSearch', 'aria-pressed={searchReceivableFilter === option.key}', 'mobile search receivable filter options expose selected state');
includes('mobileSearch', 'aria-pressed={searchArrearsFilter === option.key}', 'mobile search arrears filter options expose selected state');
includes('mobileSearch', 'liquid-mobile-search-chips', 'mobile search status chips use the shared horizontal track affordance');
includes('mobileSearch', '已筛 {searchResultCount} 条', 'mobile search keeps visible result-count feedback');
includes('mobileSearch', 'onClearSearchFilters', 'mobile search keeps one-tap filter clearing');
includes('mobileSearch', 'aria-label="清除当前查询筛选"', 'mobile search clear action has a descriptive label');
includes('mobileSearch', 'liquid-mobile-filter-clear mobile-pressable', 'mobile search clear action uses the 44px touch target layer');
includes('mobileSearch', 'liquid-mobile-empty-state', 'mobile search empty state uses the readable glass layer');
includes('mobileSearch', '当前关键词或筛选组合没有命中客户', 'mobile search explains filter-empty states');
includes('mobileSearch', '暂无可查询客户', 'mobile search distinguishes true empty states');
includes('mobileSearch', '清除筛选', 'mobile search empty state offers a safe clear-filters action');
includes('mobileSearch', '已显示 {searchResults.length} / {searchResultCount} 条', 'mobile search shows progressive result visibility feedback');
includes('mobileSearch', 'aria-live="polite"', 'mobile search result visibility feedback is announced politely');
includes('mobileSearch', '显示更多', 'mobile search exposes a load-more action for longer result sets');
includes('mobileSearch', '收起结果', 'mobile search exposes a collapse action after expanded results');
includes('mobileSearch', 'onGoContracts(item)', 'mobile search contract action carries the selected tenant');
includes('mobileSearch', 'onGoFinance(item)', 'mobile search finance action carries the selected tenant');
includes('mobileSearchTest', '显示更多', 'mobile tenant search render test covers the load-more action');
includes('mobileSearchTest', '收起结果', 'mobile tenant search render test covers the collapse action');
includes('mobileSearchTest', 'liquid-mobile-empty-state', 'mobile tenant search render test covers the readable empty state');
includes('mobileSearchTest', 'min-h-11 items-center rounded-xl px-3 py-2 text-xs font-black', 'mobile tenant search render test covers 44px result actions');
includes('mobileSearchTest', 'mt-4 inline-flex min-h-11 items-center rounded-xl px-4 py-2 text-xs font-black', 'mobile tenant search render test covers 44px empty-state action');
includes('mobileSearchTest', 'type="search"', 'mobile tenant search render test covers search input semantics');
includes('mobileSearchTest', 'aria-pressed="true"', 'mobile tenant search render test covers selected chip semantics');
includes('mobileSearchTest', 'aria-expanded="false"', 'mobile tenant search render test covers collapsed filter trigger semantics');
includes('mobileSearchTest', 'aria-controls="mobile-tenant-filter-sheet"', 'mobile tenant search render test covers filter trigger sheet relationship');

includes('contractManager', 'mobileFocusTenantId?: string', 'contract manager accepts a mobile tenant focus id');
includes('contractManager', 'setSearchTerm(nextSearch)', 'contract manager applies mobile tenant focus through its existing search field');
includes('contractManager', "focusedTenant?.status === ContractStatus.Terminated ? 'Terminated' : 'List'", 'contract manager routes terminated mobile search targets to the history tab');
includes('contractManager', '<Search size={15} className="shrink-0 text-slate-500" />', 'contract mobile search icon uses readable muted text');
includes('contractManager', 'placeholder="搜索企业名称"', 'contract mobile search placeholder copy remains explicit');
includes('contractManager', 'className="min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none placeholder:text-slate-500"', 'contract mobile search placeholder uses readable muted text');
notMatches('contractManager', /<Search size=\{15\} className="shrink-0 text-slate-400" \/>[\s\S]*?placeholder="搜索企业名称"[\s\S]*?placeholder:text-slate-400/, 'contract mobile search avoids weak icon and placeholder text');
includes('contractManager', 'className="w-full rounded-full bg-transparent py-2.5 pl-9 pr-3 text-sm font-semibold text-slate-800 outline-none placeholder:text-slate-500 focus:ring-0"', 'contract desktop and tablet search placeholder uses readable muted text');
notMatches('contractManager', /placeholder="搜索企业名称…"[\s\S]*?placeholder:text-slate-400 focus:ring-0/, 'contract desktop and tablet search avoids weak placeholder text');
matches(
  'contractManager',
  /liquid-contract-mobile-floor[^\n]*text-xs font-bold text-slate-600/,
  'contract mobile floor labels use the explicit 12px text floor',
);
matches(
  'contractManager',
  /liquid-contract-mobile-card[\s\S]*?rounded-full border px-2 py-0\.5 text-xs font-black[\s\S]*?本年续租/,
  'contract mobile status badges use the explicit 12px text floor',
);
matches(
  'contractManager',
  /liquid-contract-mobile-card[\s\S]*?mt-2 grid grid-cols-2 gap-x-2 gap-y-1 text-xs text-slate-600/,
  'contract mobile detail grids use the explicit 12px text floor',
);
matches(
  'contractManager',
  /text-xs font-black text-cyan-700 lg:text-\[10px\]/,
  'contract management-fee tags stay readable on mobile while desktop remains compact',
);
matches(
  'contractSummaryModal',
  /rounded-full bg-sky-200\/95 px-2 py-0\.5 text-xs font-black text-sky-950 md:text-\[10px\]/,
  'contract summary current-period badges use the explicit 12px mobile text floor',
);
matches(
  'contractSummaryModal',
  /text-xs font-black text-slate-500">账单月[\s\S]*?text-xs font-black text-slate-500">应收金额[\s\S]*?text-xs font-black text-slate-500">覆盖租期/,
  'contract summary mobile bill card labels use the explicit 12px text floor',
);
includes(
  'contractSummaryModal',
  'className={`inline-flex items-center px-1.5 py-0.5 rounded border text-xs font-bold flex-shrink-0 md:text-[10px] ${',
  'contract summary overlay tags stay readable on mobile while desktop remains compact',
);
includes(
  'contractSummaryModal',
  'className="liquid-elevated-card mt-2 rounded-2xl border border-rose-200/80 bg-rose-50/78 px-3 py-2 text-xs font-semibold leading-snug text-rose-900"',
  'contract summary vacancy budget note uses readable 12px text',
);
includes('searchableTenantSelect', 'className="mt-0.5 text-xs font-semibold leading-snug text-slate-500"', 'shared tenant picker subline uses readable 12px text');
includes('searchableTenantSelect', '<span className="mx-1 text-slate-400">·</span>', 'shared tenant picker metadata separators avoid very weak-gray text');
includes('searchableTenantSelect', 'py-1.5 text-xs font-black ${classes.label}', 'shared tenant picker reselect action uses readable 12px text');
includes('searchableTenantSelect', 'inputMode="search"', 'shared tenant picker search input declares mobile search keyboard mode');
includes('searchableTenantSelect', 'enterKeyHint="search"', 'shared tenant picker search input exposes a search keyboard action');
includes('searchableTenantSelect', 'className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-slate-900 outline-none placeholder:text-slate-500"', 'shared tenant picker search placeholder uses readable muted text');
includes('searchableTenantSelect', 'liquid-tenant-picker-empty p-4 text-center text-xs font-bold text-slate-500', 'shared tenant picker empty state avoids low-contrast helper text');
includes('searchableTenantSelect', 'liquid-tenant-picker-hint px-1 text-xs font-semibold text-slate-500', 'shared tenant picker result-limit hint uses readable 12px text');
notMatches('searchableTenantSelect', /text-slate-300|placeholder:text-slate-400/, 'shared tenant picker avoids very weak separators and placeholder text');
includes('financeManager', 'mobileFocusTenantId?: string', 'finance manager accepts a mobile tenant focus id');
includes('financeManager', "setActiveView('Receivables')", 'finance manager routes mobile tenant focus to receivable write-off');
includes('financeManager', 'setReceivableKeyword(nextKeyword)', 'finance manager applies mobile tenant focus through its existing receivable search field');
matches(
  'financeManager',
  /financePaymentTypePillClass\(p\.type\)[^\n]*text-xs font-black/,
  'finance mobile payment type pills use the explicit 12px text floor',
);
matches(
  'financeManager',
  /const ReceivableCard[\s\S]*?text-xs font-bold leading-snug text-orange-800[\s\S]*?text-xs font-bold leading-snug text-sky-800/,
  'finance mobile receivable defer notes use the explicit 12px text floor',
);
matches(
  'financeManager',
  /const ReceivableCard[\s\S]*?liquid-finance-mobile-metric[\s\S]*?font-black text-slate-500[\s\S]*?text-xs font-semibold text-slate-500/,
  'finance mobile receivable metrics avoid tiny low-contrast helper text',
);
includes('financeManager', 'className="mt-0.5 block truncate text-xs font-bold text-white/90"', 'finance mobile primary quick action helper uses readable 12px text');
includes('financeManager', 'className="text-xs font-bold text-slate-500">待核销</div>', 'finance mobile receivable filter labels use readable 12px text');
includes('financeManager', 'className="text-xs font-bold text-slate-500">本月待收</div>', 'finance mobile receivable summary labels use readable 12px text');
includes('financeManager', '<Search size={15} className="shrink-0 text-slate-500" />', 'finance mobile receivable search icon uses readable muted text');
includes('financeManager', 'className="min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none placeholder:text-slate-500"', 'finance mobile receivable search placeholder uses readable muted text');
notMatches('financeManager', /<Search size=\{15\} className="shrink-0 text-slate-400" \/>[\s\S]*?placeholder="搜索客户"[\s\S]*?placeholder:text-slate-400/, 'finance mobile receivable search avoids weak icon and placeholder text');
includes('financeManager', 'className="text-xs font-black text-slate-500">收款流水预览</div>', 'finance tablet payment preview title uses readable 12px text');
includes('financeManager', 'financePaymentTypePillClass(payment.type)} shrink-0 rounded-full px-2.5 py-1 text-xs font-black', 'finance tablet payment type pill uses readable 12px text');
matches(
  'financeManager',
  /text-xs font-black text-slate-500">特殊业态录入 · \{receivableMonth\}[\s\S]*?text-xs font-black text-slate-500">已保存应收[\s\S]*?text-xs font-black text-slate-500">草稿金额[\s\S]*?text-xs font-black text-slate-500">本月应收（元）[\s\S]*?text-xs font-black text-slate-500">备注/,
  'finance tablet special-business preview labels use readable 12px text',
);
matches(
  'financeManager',
  /text-xs font-black text-slate-500">\{feeKindLabel\} · \{receivableMonth\}[\s\S]*?text-xs font-black text-slate-500">实际核销[\s\S]*?text-xs font-black text-slate-500">合同应收[\s\S]*?text-xs font-black text-slate-500">已收[\s\S]*?text-xs font-black text-slate-500">待收/,
  'finance tablet receivable preview metrics use readable 12px text',
);
includes('financeManager', 'className="mt-0.5 px-0.5 text-center text-xs font-semibold leading-snug text-slate-500"', 'finance overview helper copy uses readable 12px text');
includes('financeManager', 'className="mt-1.5 text-xs font-semibold text-slate-500">将上述待收金额从原账期移至所选月份，在「原账期」与「目标账期」列表中都会醒目标注。</p>', 'finance defer modal helper copy uses readable 12px text');
includesAtLeast('financeManager', 'mobile-pressable min-h-11 rounded-full px-3 text-sm font-black', 9, 'finance tablet/mobile preview row actions keep 44px touch targets');
includes('financeManager', 'className="liquid-mobile-inline-action mobile-pressable col-span-2 min-h-11 rounded-full px-3 text-sm font-black text-rose-700 disabled:opacity-45"', 'finance special-business clear action keeps a 44px touch target');
notMatches('financeManager', /liquid-mobile-inline-action(?:-strong)?[^\n"]*min-h-10/, 'finance mobile inline actions avoid 40px touch targets');
notMatches('financeManager', /text-\[(?:9|10|11)px\]|text-slate-300/, 'finance manager avoids sub-12px and very weak-gray business text');
includes('financeManager', "className={`${financeSourcePillClass('special')} inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-black`}", 'finance receivable source special-business pill uses readable 12px text');
includes('financeManager', "className={`${financeSourcePillClass('manual')} rounded-full px-2 py-0.5 text-xs font-black`}", 'finance receivable source manual pill uses readable 12px text');
includes('financeManager', "className={`${financeSourcePillClass('contract')} rounded-full px-2 py-0.5 text-xs font-black`}", 'finance receivable source contract pill uses readable 12px text');
includes('financeManager', 'className="mt-1 text-xs font-semibold text-orange-800">缓出 → {item.deferredToPeriod}（{formatCurrency(item.deferredAmount ?? 0)}）</div>', 'finance receivable table defer-out note uses readable 12px text');
includes('financeManager', 'className="liquid-finance-alignment-note mt-1.5 rounded-2xl px-2 py-1 text-xs font-semibold leading-snug"', 'finance receivable table budget alignment note uses readable 12px text');
includes('financeManager', 'className="px-2 py-2.5 text-xs font-semibold leading-snug text-slate-500"', 'finance receivable table footnote uses readable 12px text');
includes('financeManager', 'className="px-6 py-4 font-mono text-xs font-semibold text-slate-500">#{p.id.split(\'_\')[0]}</td>', 'finance payment table ids use readable 12px text');
notMatches('billingTable', /text-\[(?:9|10|11)px\]/, 'dashboard billing detail avoids sub-12px text in readable finance layers');
includes(
  'billingTable',
  'const cardSummaryLabel = `${item.tenantName}，${building?.name || \'未匹配楼宇\'} ${unitNames || \'未匹配房号\'}，${writeOffLabel}，应收 ${formatCurrency(receivableBudgetDisplay(item))}，实收 ${formatCurrency(item.amountPaid)}${hasDeferOut ? `，缓出至 ${item.deferredToPeriod} ${formatCurrency(item.deferredAmount ?? 0)}` : \'\'}${hasDeferIn ? `，由 ${item.deferredInFromSummary} 缓入 ${formatCurrency(item.deferredInAmount ?? 0)}` : \'\'}`;',
  'dashboard billing mobile cards compose full readable summaries',
);
includes('billingTable', 'aria-label={cardSummaryLabel}', 'dashboard billing mobile cards expose summaries to assistive tech');
includes('billingTable', 'className="ml-8 mt-1.5 text-xs font-semibold leading-snug text-orange-800"', 'dashboard billing mobile defer-out note uses readable 12px text');
includes('billingTable', 'className="liquid-finance-alignment-note ml-8 mt-1.5 rounded-xl px-2 py-1 text-xs font-semibold leading-snug"', 'dashboard billing mobile budget alignment note uses readable 12px text');
includes('billingTable', 'className="text-xs font-bold text-slate-500">备注</label>', 'dashboard billing mobile remark label uses readable 12px text');
includes('billingTable', 'className="text-xs font-black uppercase tracking-wide text-slate-500">{isMgmtTab ? "当月应收物业费" : "当月应收租金"}</p>', 'dashboard billing due summary label uses readable 12px text');
includes('billingTable', 'className="text-xs font-black uppercase tracking-wide text-slate-500">{isMgmtTab ? "当月实收物业费" : "当月实收租金"}</p>', 'dashboard billing paid summary label uses readable 12px text');
notMatches('systemSettingsPanel', /text-\[(?:9|10|11)px\]|text-slate-400|text-slate-300|min-h-\[32px\]/, 'system settings panel avoids sub-12px, weak-gray copy and tiny controls');
includes('systemSettingsPanel', "'liquid-settings-action liquid-pressable inline-flex min-h-[36px] items-center justify-center rounded-full px-3 py-1.5 text-xs font-bold'", 'system settings tiny actions keep readable 12px text and 36px visual height');
includes('systemSettingsPanel', 'className={`ml-1.5 inline-flex min-w-[1.5rem] justify-center rounded-full px-1.5 text-xs font-black ${', 'system settings tab count badges use readable 12px text');
includes('systemSettingsPanel', 'className="text-xs font-black text-slate-500">当前园区</div>', 'system settings current-park label uses readable slate-500 text');
includes('systemSettingsPanel', 'className="ml-2 text-xs font-semibold text-slate-500">（顶栏切换）</span>', 'system settings park-switch helper uses readable 12px text');
includes('systemSettingsPanel', 'className="text-xs font-semibold text-slate-500 group-open:hidden">展开配置</span>', 'system settings AI collapsed helper uses readable 12px text');
includes('systemSettingsPanel', 'className="flex items-center gap-1 text-xs font-semibold text-slate-500"', 'system settings backup timestamp uses readable 12px text');
includes('systemSettingsPanel', 'className="text-xs font-semibold text-slate-500">含 project_id={cloudConfig.projectId}</div>', 'system settings export project helper uses readable 12px text');
includes('systemSettingsPanel', 'className="text-xs font-semibold text-slate-500">校验备份 project_id</div>', 'system settings import project helper uses readable 12px text');
notMatches('assistantPanel', /text-\[(?:9|10|11)px\]|text-slate-400|text-blue-100|placeholder:text-slate-400/, 'assistant panel avoids sub-12px and weak helper text');
includes('assistantPanel', 'role="dialog"', 'assistant panel is exposed as a dialog');
includes('assistantPanel', 'aria-modal="true"', 'assistant panel is modal');
includes('assistantPanel', 'aria-labelledby="assistant-panel-title"', 'assistant panel has a visible title label');
includes('assistantPanel', 'id="assistant-panel-title"', 'assistant panel title remains visible');
matches(
  'assistantPanel',
  /event\.key === 'Escape'[\s\S]*?onClose\(\)/,
  'assistant panel closes on Escape',
);
includes('assistantPanel', 'rounded-full border border-sky-200/80 bg-sky-50/80 px-2.5 py-1 text-xs font-black text-blue-700', 'assistant panel realtime badge uses readable 12px text');
includes('assistantPanel', "msg.role === 'user' ? 'text-blue-50/95' : 'text-slate-500'", 'assistant panel message timestamps avoid low-contrast text');
includes('assistantPanel', 'role="status" className="liquid-glass-readable flex items-center gap-2 rounded-[22px] rounded-bl-md px-4 py-3 text-sm font-semibold text-slate-500"', 'assistant panel loading state is announced and readable');

includes('contractManager', 'aria-labelledby="contract-termination-modal-title"', 'contract termination modal has a visible title label');
includes('contractManager', 'id="contract-termination-modal-title"', 'contract termination modal title remains visible');
includes('contractManager', 'aria-label="关闭办理退租"', 'contract termination modal has a named close control');
includes('contractManager', "event.key !== 'Escape'", 'contract termination modal listens for Escape');
includes('contractManager', 'closeTerminateModal()', 'contract termination modal can be closed from keyboard/backdrop');
matches(
  'contractManager',
  /contract-termination-modal-title[\s\S]*?onClick=\{\(event\) => event\.stopPropagation\(\)\}/,
  'contract termination modal keeps backdrop click separate from panel clicks',
);
includes('contractManager', 'aria-labelledby="contract-init-payment-modal-title"', 'contract initial payment modal has a visible title label');
includes('contractManager', 'id="contract-init-payment-modal-title"', 'contract initial payment modal title remains visible');
includes('contractManager', 'aria-label="关闭初始化收款录入"', 'contract initial payment modal has a named close control');
includes('contractManager', 'closeInitPaymentModal()', 'contract initial payment modal can be closed from keyboard/backdrop');
matches(
  'contractManager',
  /contract-init-payment-modal-title[\s\S]*?onClick=\{\(event\) => event\.stopPropagation\(\)\}/,
  'contract initial payment modal keeps backdrop click separate from panel clicks',
);
includes('contractManager', 'aria-labelledby="contract-prompt-title"', 'contract prompt overlay has a visible title label');
includes('contractManager', 'id="contract-prompt-title"', 'contract prompt overlay title remains visible');
includes('contractManager', 'aria-label="关闭提示"', 'contract prompt overlay has a named close control');
includes('contractManager', 'dismissPrompt', 'contract prompt overlay has a shared dismiss path');
matches(
  'contractManager',
  /const ContractPromptOverlay[\s\S]*?event\.key !== 'Escape'[\s\S]*?dismissPrompt\(\)/,
  'contract prompt overlay closes on Escape through the dismiss path',
);
matches(
  'contractManager',
  /contract-prompt-title[\s\S]*?onClick=\{\(event\) => event\.stopPropagation\(\)\}/,
  'contract prompt overlay keeps backdrop click separate from panel clicks',
);
includes('contractManager', 'aria-labelledby="contract-import-result-title"', 'contract import result modal has a visible title label');
includes('contractManager', 'id="contract-import-result-title"', 'contract import result modal title remains visible');
includes('contractManager', 'aria-label="关闭批量导入结果"', 'contract import result modal has a named close control');
includes('contractManager', 'closeImportResultModal()', 'contract import result modal uses a shared close path');
matches(
  'contractManager',
  /showImportResult[\s\S]*?event\.key !== 'Escape'[\s\S]*?closeImportResultModal\(\)/,
  'contract import result modal closes on Escape',
);
matches(
  'contractManager',
  /contract-import-result-title[\s\S]*?onClick=\{\(event\) => event\.stopPropagation\(\)\}/,
  'contract import result modal keeps backdrop click separate from panel clicks',
);
includes('contractManager', 'liquid-contract-tablet-master-detail', 'contract tablet master-detail layout remains rendered');
includes('contractManager', 'liquid-contract-tablet-preview', 'contract tablet preview remains rendered');
includes('contractManager', 'className="text-xs font-black text-slate-500"', 'contract tablet preview eyebrow uses the explicit 12px text floor');
includes('contractManager', 'liquid-contract-tablet-status shrink-0 rounded-full px-2.5 py-1 text-xs font-black', 'contract tablet preview status uses the explicit 12px text floor');
includesAtLeast('contractManager', 'className="text-xs font-black text-slate-500"', 5, 'contract tablet preview metric labels use readable 12px text');
includes('contractManager', 'className="liquid-mobile-inline-action-strong mobile-pressable min-h-11 rounded-full px-3 text-sm font-black"', 'contract tablet preview primary action uses an explicit 44px touch target');
includes('contractManager', 'className="liquid-mobile-inline-action mobile-pressable min-h-11 rounded-full px-3 text-sm font-black text-blue-700"', 'contract tablet preview secondary blue actions use explicit 44px touch targets');
includes('contractManager', 'className="liquid-mobile-inline-action mobile-pressable min-h-11 rounded-full px-3 text-sm font-black text-amber-700"', 'contract tablet preview terminate action uses an explicit 44px touch target');
notMatches('contractManager', /liquid-contract-tablet-status[^\n]*text-\[11px\]/, 'contract tablet preview status does not use 11px text');
notMatches('contractManager', /className="text-\[10px\] font-black text-slate-500">租赁面积/, 'contract tablet preview lease-area label does not use 10px text');
notMatches('contractManager', /className="text-\[10px\] font-black text-slate-500">\{rentDisplay\.label\}/, 'contract tablet preview rent label does not use 10px text');
notMatches('contractManager', /className="text-\[10px\] font-black text-slate-500">月租金/, 'contract tablet preview monthly-rent label does not use 10px text');
notMatches('contractManager', /className="text-\[10px\] font-black text-slate-500">付款周期/, 'contract tablet preview payment-cycle label does not use 10px text');
notMatches('contractManager', /liquid-mobile-inline-action(?:-strong)? mobile-pressable min-h-10 rounded-full px-3 text-sm font-black/, 'contract tablet preview actions do not use 40px source targets');
includes('contractManager', 'data-selected={tabletPreviewTenant?.id === t.id ? \'true\' : \'false\'}', 'contract tablet list keeps selected-state feedback');
matches(
  'contractManager',
  /tabletPreviewTenants\.some\(\(tenant\) => tenant\.id === tabletPreviewTenantId\)[\s\S]*?setTabletPreviewTenantId\(tabletPreviewTenants\[0\]\.id\)/,
  'contract tablet preview resets when filters remove the selected contract',
);

includes('nameChangeDialog', 'aria-labelledby="name-change-dialog-title"', 'name change dialog has a visible title label');
includes('nameChangeDialog', 'id="name-change-dialog-title"', 'name change dialog title remains visible');
includes('nameChangeDialog', 'aria-label="关闭名称变更"', 'name change dialog has a named close control');
notMatches('nameChangeDialog', /text-\[(?:9|10|11)px\]|text-slate-400|text-slate-300|text-blue-400/, 'name change dialog avoids sub-12px and weak-gray business text');
matches(
  'nameChangeDialog',
  /event\.key !== 'Escape'[\s\S]*?onClose\(\)/,
  'name change dialog closes on Escape',
);
matches(
  'nameChangeDialog',
  /name-change-dialog-title[\s\S]*?onClick=\{\(event\) => event\.stopPropagation\(\)\}/,
  'name change dialog keeps backdrop click separate from panel clicks',
);
includes(
  'nameChangeDialog',
  'className="mt-1 text-xs font-bold text-slate-500">{r.changedAt?.slice(0, 10)}</div>',
  'name change history date uses readable 12px text',
);
includes(
  'nameChangeDialog',
  'className="mx-1.5 font-black text-slate-500">→</span>',
  'name change history arrow avoids very weak-gray separators',
);

includes('paymentCycleDialog', 'aria-labelledby="payment-cycle-change-dialog-title"', 'payment cycle dialog has a visible title label');
includes('paymentCycleDialog', 'id="payment-cycle-change-dialog-title"', 'payment cycle dialog title remains visible');
includes('paymentCycleDialog', 'aria-label="关闭付款周期变更"', 'payment cycle dialog has a named close control');
notMatches('paymentCycleDialog', /text-\[(?:9|10|11)px\]|text-slate-400|text-slate-300|text-blue-400/, 'payment cycle dialog avoids sub-12px and weak-gray business text');
matches(
  'paymentCycleDialog',
  /event\.key !== 'Escape'[\s\S]*?onClose\(\)/,
  'payment cycle dialog closes on Escape',
);
matches(
  'paymentCycleDialog',
  /payment-cycle-change-dialog-title[\s\S]*?onClick=\{\(event\) => event\.stopPropagation\(\)\}/,
  'payment cycle dialog keeps backdrop click separate from panel clicks',
);
matches(
  'paymentCycleDialog',
  /text-xs font-black text-slate-500">客户[\s\S]*?text-xs font-black text-slate-500">当前周期[\s\S]*?text-xs font-black text-slate-500">租期/,
  'payment cycle current contract labels use readable 12px text',
);
includes(
  'paymentCycleDialog',
  'className="mt-1 text-xs font-semibold text-slate-500">生效日期前的账单按原周期，生效日期起按新周期</p>',
  'payment cycle effective-date helper uses readable 12px text',
);
includes(
  'paymentCycleDialog',
  'className="mt-1 font-bold text-slate-500">',
  'payment cycle history meta avoids low-contrast helper text',
);
includes(
  'paymentCycleDialog',
  'className="ml-2 text-xs font-semibold text-slate-500"',
  'payment cycle bill-preview boundary note uses readable muted text',
);
includes(
  'paymentCycleDialog',
  'className="text-xs font-bold italic text-slate-500">计算中...</div>',
  'payment cycle original-preview loading state uses readable muted text',
);
includes(
  'paymentCycleDialog',
  'className="text-xs font-bold italic text-blue-700">无后续账单</div>',
  'payment cycle simulated-preview empty state uses readable blue text',
);
includes(
  'paymentCycleDialog',
  'className="mx-1.5 font-black text-slate-500">→</span>',
  'payment cycle history arrow avoids very weak-gray separators',
);

includes('aiContractModal', 'aria-labelledby="ai-contract-recognition-title"', 'AI contract recognition modal has a visible title label');
includes('aiContractModal', 'id="ai-contract-recognition-title"', 'AI contract recognition modal title remains visible');
includes('aiContractModal', 'aria-label="关闭 AI 智能合同录入"', 'AI contract recognition modal has a named close control');
matches(
  'aiContractModal',
  /event\.key !== 'Escape'[\s\S]*?onClose\(\)/,
  'AI contract recognition modal closes on Escape',
);
matches(
  'aiContractModal',
  /ai-contract-recognition-title[\s\S]*?onClick=\{\(event\) => event\.stopPropagation\(\)\}/,
  'AI contract recognition modal keeps backdrop click separate from panel clicks',
);
matches(
  'aiContractModal',
  /text-xs font-black text-slate-500[\s\S]*?楼宇匹配[\s\S]*?text-xs font-black text-slate-500">已选房源[\s\S]*?text-xs font-black text-slate-500">识别面积/,
  'AI contract recognition summary labels use readable 12px text',
);
includes(
  'aiContractModal',
  'className="mt-1 block text-xs font-bold text-amber-700">AI识别"{editData.buildingName}"未匹配，请手动选择</span>',
  'AI contract unmatched-building warning uses readable 12px text',
);
includes(
  'aiContractModal',
  'className="text-xs font-semibold text-slate-500">{formatArea(u.area)}</div>',
  'AI contract unit area chip uses readable 12px text',
);
includes(
  'aiContractModal',
  "const fieldClass = 'liquid-elevated-field min-h-11 w-full rounded-2xl px-3 py-2 text-sm font-semibold text-slate-900 outline-none transition placeholder:text-slate-500 focus:border-blue-300 focus:ring-4 focus:ring-blue-100'",
  'AI contract elevated fields use readable placeholder text',
);
includes(
  'aiContractModal',
  "const textareaClass = 'liquid-elevated-field h-48 w-full resize-none rounded-2xl p-3 text-sm font-semibold text-slate-900 outline-none transition placeholder:text-slate-500 focus:border-blue-300 focus:ring-4 focus:ring-blue-100'",
  'AI contract elevated textarea uses readable placeholder text',
);
includes(
  'aiContractModal',
  '<Upload size={40} className="mx-auto text-slate-500 mb-3" />',
  'AI contract image dropzone upload icon uses readable muted text',
);
includes(
  'aiContractModal',
  '<FileSpreadsheet size={40} className="mx-auto text-slate-500 mb-3" />',
  'AI contract Excel dropzone icon uses readable muted text',
);
notMatches('aiContractModal', /<(?:Upload|FileSpreadsheet) size=\{40\} className="mx-auto text-slate-400 mb-3" \/>/, 'AI contract dropzone icons avoid weak-gray text');
notMatches('aiContractModal', /placeholder:text-slate-400/, 'AI contract modal avoids weak placeholder text');

includes('aiPaymentModal', 'aria-labelledby="ai-payment-recognition-title"', 'AI payment recognition modal has a visible title label');
includes('aiPaymentModal', 'id="ai-payment-recognition-title"', 'AI payment recognition modal title remains visible');
includes('aiPaymentModal', 'aria-label="关闭 AI 智能收款录入"', 'AI payment recognition modal has a named close control');
matches(
  'aiPaymentModal',
  /event\.key !== 'Escape'[\s\S]*?onClose\(\)/,
  'AI payment recognition modal closes on Escape',
);
matches(
  'aiPaymentModal',
  /ai-payment-recognition-title[\s\S]*?onClick=\{\(event\) => event\.stopPropagation\(\)\}/,
  'AI payment recognition modal keeps backdrop click separate from panel clicks',
);
matches(
  'aiPaymentModal',
  /py-0\.5 text-xs font-black[\s\S]*?mb-1 block text-xs font-black text-slate-500">金额[\s\S]*?mb-1 block text-xs font-black text-slate-500">日期[\s\S]*?mb-1 block text-xs font-black text-slate-500">匹配客户[\s\S]*?mb-1 block text-xs font-black text-slate-500">类型[\s\S]*?mb-1 block text-xs font-black text-slate-500">备注/,
  'AI payment mobile result card labels use readable 12px text',
);
includes(
  'aiPaymentModal',
  'className="mt-1 block truncate text-xs font-bold text-slate-500">{tenantName}</span>',
  'AI payment matched tenant helper uses readable 12px text',
);
includes(
  'aiPaymentModal',
  'className="mt-1 block text-xs font-bold text-amber-700">低置信度匹配，请确认</span>',
  'AI payment low-confidence warning uses readable 12px text',
);
includes(
  'aiPaymentModal',
  "const largeFieldClass = 'liquid-elevated-field w-full h-48 rounded-xl p-3 text-sm text-slate-800 outline-none resize-none transition placeholder:text-slate-500 focus:border-blue-300 focus:ring-2 focus:ring-blue-100'",
  'AI payment elevated textarea uses readable placeholder text',
);
includes(
  'aiPaymentModal',
  'className="liquid-elevated-field min-h-11 w-full rounded-2xl px-3 py-2 text-sm font-semibold text-slate-900 outline-none placeholder:text-slate-500 focus-visible:ring-4 focus-visible:ring-blue-500/10"',
  'AI payment result remark field uses readable placeholder text',
);
includes(
  'aiPaymentModal',
  '<ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" />',
  'AI payment mobile tenant select chevron uses readable muted text',
);
includes(
  'aiPaymentModal',
  '<ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />',
  'AI payment table tenant select chevron uses readable muted text',
);
notMatches('aiPaymentModal', /ChevronDown[^>]+text-slate-400/, 'AI payment select chevrons avoid weak-gray text');
includes(
  'aiPaymentModal',
  '<Upload size={40} className="mx-auto text-slate-500 mb-3" />',
  'AI payment image dropzone upload icon uses readable muted text',
);
includes(
  'aiPaymentModal',
  '<FileSpreadsheet size={40} className="mx-auto text-slate-500 mb-3" />',
  'AI payment Excel dropzone icon uses readable muted text',
);
notMatches('aiPaymentModal', /<(?:Upload|FileSpreadsheet) size=\{40\} className="mx-auto text-slate-400 mb-3" \/>/, 'AI payment dropzone icons avoid weak-gray text');
notMatches('aiPaymentModal', /placeholder:text-slate-400/, 'AI payment modal avoids weak placeholder text');

includes('buildingMobileActionSheets', 'aria-labelledby="building-mobile-quick-unit-title"', 'building quick action sheet has a visible title label');
includes('buildingMobileActionSheets', 'aria-describedby="building-mobile-quick-unit-description"', 'building quick action sheet describes the selected unit context');
includes('buildingMobileActionSheets', 'id="building-mobile-quick-unit-sheet"', 'building quick action sheet has a stable controlled id');
includes('buildingMobileActionSheets', 'id="building-mobile-quick-unit-title"', 'building quick action sheet title remains visible');
includes('buildingMobileActionSheets', 'id="building-mobile-quick-unit-description"', 'building quick action sheet description remains visible');
includes('buildingMobileActionSheets', 'aria-labelledby="building-mobile-batch-status-title"', 'building batch action sheet has a visible title label');
includes('buildingMobileActionSheets', 'aria-describedby="building-mobile-batch-status-description"', 'building batch action sheet describes the batch handling rule');
includes('buildingMobileActionSheets', 'id="building-mobile-batch-status-sheet"', 'building batch action sheet has a stable controlled id');
includes('buildingMobileActionSheets', 'id="building-mobile-batch-status-title"', 'building batch action sheet title remains visible');
includes('buildingMobileActionSheets', 'id="building-mobile-batch-status-description"', 'building batch action sheet description remains visible');
includes('buildingManager', 'BuildingMobileQuickUnitSheet', 'building quick action sheet rendering is componentized');
includes('buildingManager', 'BuildingMobileBatchStatusSheet', 'building batch action sheet rendering is componentized');
includes('buildingMobileActionSheets', 'BuildingMobileQuickUnitSheet', 'building quick action sheet component remains exported');
includes('buildingMobileActionSheets', 'BuildingMobileBatchStatusSheet', 'building batch action sheet component remains exported');
includes('buildingMobileActionSheets', 'role="dialog"', 'building mobile action sheet components keep dialog semantics');
includes('buildingMobileActionSheets', 'aria-modal="true"', 'building mobile action sheet components keep modal semantics');
includes('buildingMobileActionSheets', 'aria-labelledby="building-mobile-quick-unit-title"', 'building quick action sheet component has a visible label');
includes('buildingMobileActionSheets', 'aria-labelledby="building-mobile-batch-status-title"', 'building batch action sheet component has a visible label');
includes('buildingMobileActionSheets', 'aria-label="关闭单元快速处理"', 'building quick action sheet component keeps a named close control');
includes('buildingMobileActionSheets', 'aria-label="关闭批量状态处理"', 'building batch action sheet component keeps a named close control');
includes('buildingMobileActionSheets', 'className="liquid-glass-control liquid-pressable inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-500"', 'building mobile action sheet close buttons use 44px touch targets');
includes('buildingMobileActionSheets', "const buildingMobileGhostButtonClass = 'liquid-glass-control liquid-pressable inline-flex min-h-11", 'building mobile action sheet ghost actions use 44px touch targets');
includes('buildingMobileActionSheetsTest', 'BuildingMobileQuickUnitSheet', 'building mobile action sheet render test covers quick action');
includes('buildingMobileActionSheetsTest', 'BuildingMobileBatchStatusSheet', 'building mobile action sheet render test covers batch action');
includes('buildingMobileActionSheetsTest', 'aria-labelledby="building-mobile-quick-unit-title"', 'building mobile action sheet render test covers quick title relationship');
includes('buildingMobileActionSheetsTest', 'aria-describedby="building-mobile-quick-unit-description"', 'building mobile action sheet render test covers quick description relationship');
includes('buildingMobileActionSheetsTest', 'id="building-mobile-quick-unit-description"', 'building mobile action sheet render test covers quick description id');
includes('buildingMobileActionSheetsTest', 'id="building-mobile-quick-unit-sheet"', 'building mobile action sheet render test covers quick stable id');
includes('buildingMobileActionSheetsTest', 'aria-labelledby="building-mobile-batch-status-title"', 'building mobile action sheet render test covers batch title relationship');
includes('buildingMobileActionSheetsTest', 'aria-describedby="building-mobile-batch-status-description"', 'building mobile action sheet render test covers batch description relationship');
includes('buildingMobileActionSheetsTest', 'id="building-mobile-batch-status-description"', 'building mobile action sheet render test covers batch description id');
includes('buildingMobileActionSheetsTest', 'id="building-mobile-batch-status-sheet"', 'building mobile action sheet render test covers batch stable id');
includes('buildingMobileActionSheetsTest', 'h-11 w-11', 'building mobile action sheet render test covers 44px close controls');
includes('buildingMobileActionSheetsTest', 'min-h-11', 'building mobile action sheet render test covers 44px footer actions');
includes('buildingMobileActionSheets', 'className="liquid-building-status inline-flex rounded-full px-2.5 py-1 text-xs font-black"', 'building quick action sheet status uses the explicit 12px text floor');
includes('buildingMobileActionSheets', 'className="rounded-full bg-white/70 px-2.5 py-1 text-xs font-black text-slate-700"', 'building batch selected unit chips use the explicit 12px text floor');
includesAtLeast('buildingManager', 'useMobileSheetFocus<HTMLButtonElement, HTMLButtonElement, HTMLElement>', 2, 'building mobile action sheets use the shared focus hook');
includes('buildingManager', 'mobileQuickTriggerRef.current = event.currentTarget', 'building quick action sheet records the tapped trigger for focus return');
includes('buildingManager', 'aria-expanded={mobileQuickUnitId === unit.id && isMobileQuickUnitSheetOpen}', 'building quick action trigger exposes expanded state');
includes('buildingManager', 'aria-controls="building-mobile-quick-unit-sheet"', 'building quick action trigger points to its sheet');
includes('buildingManager', 'sheetRef={mobileQuickSheetRef}', 'building quick action sheet receives the focus-trap ref');
includes('buildingManager', 'closeButtonRef={mobileQuickCloseButtonRef}', 'building quick action sheet receives the initial-focus ref');
includes('buildingManager', 'ref={mobileBatchTriggerRef}', 'building batch action sheet trigger is wired for focus return');
includes('buildingManager', 'aria-expanded={isMobileBatchSheetVisible}', 'building batch action trigger exposes expanded state');
includes('buildingManager', 'aria-controls="building-mobile-batch-status-sheet"', 'building batch action trigger points to its sheet');
includes('buildingManager', 'isMobileBatchSheetVisible', 'building batch action sheet only traps focus while visibly open');
includes('buildingManager', 'sheetRef={mobileBatchSheetRef}', 'building batch action sheet receives the focus-trap ref');
includes('buildingManager', 'closeButtonRef={mobileBatchCloseButtonRef}', 'building batch action sheet receives the initial-focus ref');
includes('buildingMobileActionSheets', 'ref={sheetRef}', 'building mobile action sheet panels wire the focus-trap ref');
includes('buildingMobileActionSheets', 'ref={closeButtonRef}', 'building mobile action sheet close buttons wire the initial-focus ref');
includes('buildingManager', 'closeMobileQuickUnitSheet', 'building quick action sheet uses a shared close path');
includes('buildingManager', 'closeMobileBatchSheet', 'building batch action sheet uses a shared close path');
includes('contentDoc', '楼宇移动 action sheet 触发器语义', 'content optimization document records building action sheet trigger semantics');
includes('glassDoc', '楼宇移动 action sheet 触发器语义', 'glass optimization document records building action sheet trigger semantics');
includes('buildingManager', 'mobileUnitRowsByFloor', 'building mobile unit cards remain grouped by floor');
includes('buildingManager', 'liquid-building-mobile-unit-main', 'building mobile unit cards keep a status-first primary area');
includes('buildingManager', 'className="liquid-building-mobile-action-pill mobile-pressable inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-black text-blue-700 disabled:pointer-events-none disabled:opacity-45"', 'building mobile batch-mode toggle uses an explicit 44px touch target');
includes('buildingManager', 'className="liquid-building-mobile-action-pill mobile-pressable min-h-11 rounded-2xl px-2 text-xs font-black text-slate-700 disabled:pointer-events-none disabled:opacity-45"', 'building mobile select-all action uses an explicit 44px touch target');
includes('buildingManager', 'className="liquid-building-mobile-action-pill mobile-pressable min-h-11 rounded-2xl px-2 text-xs font-black text-slate-700"', 'building mobile cancel batch action uses an explicit 44px touch target');
includes('buildingManager', 'className="liquid-action-strong liquid-pressable min-h-11 rounded-2xl px-2 text-xs font-black text-white disabled:pointer-events-none disabled:opacity-45"', 'building mobile process-selected action uses an explicit 44px touch target');
includes('buildingManager', 'className={`liquid-building-mobile-action-pill mobile-pressable inline-flex min-h-11 shrink-0 items-center rounded-full px-3 text-xs font-black disabled:pointer-events-none disabled:opacity-45 ${selectedForBatch ? \'text-blue-700\' : \'text-slate-600\'}`}', 'building mobile unit selection action uses an explicit 44px touch target');
includes('buildingManager', 'className="liquid-building-mobile-action-pill mobile-pressable inline-flex min-h-11 items-center gap-1 rounded-full px-3 text-xs font-black text-blue-700"', 'building mobile quick action trigger uses an explicit 44px touch target');
includes('buildingManager', 'className="liquid-building-mobile-action-pill mobile-pressable inline-flex min-h-11 items-center gap-1 rounded-full px-3 text-xs font-black text-slate-600"', 'building mobile edit action uses an explicit 44px touch target');
notMatches('buildingManager', /liquid-building-mobile-action-pill[^\n"]*min-h-(?:9|10)/, 'building mobile action pills do not rely on 36px or 40px source targets');
notMatches('buildingManager', /liquid-action-strong liquid-pressable min-h-10 rounded-2xl px-2 text-xs font-black text-white/, 'building mobile process-selected action does not use a 40px source target');
includes('buildingManager', 'className="mt-0.5 truncate text-xs font-bold tabular-nums text-slate-600"', 'building switcher area/unit summary uses readable 12px text');
includes('buildingManager', 'className="tabular-nums font-black text-slate-500">{item.count}</span>', 'building legend count avoids low-contrast helper text');
includes('buildingManager', 'className="ml-auto text-xs font-semibold text-slate-500">宽度按面积做近似表达，点击单元可编辑</span>', 'building plan helper copy uses readable 12px text');
includes('buildingManager', 'className="text-xs font-bold tabular-nums text-slate-500">{floorUnits.length} 间</span>', 'building floor unit count uses readable 12px text');
includes('buildingManager', 'className="shrink-0 text-xs font-bold tabular-nums text-slate-500">{unit.floor}F</span>', 'building mobile unit floor label avoids low-contrast helper text');
includes('buildingManager', 'liquid-building-table-head border-b border-slate-200/70 text-left text-xs font-bold', 'building list table head uses readable 12px text');
includes('buildingManager', 'className="liquid-building-status inline-flex rounded-full px-2.5 py-1 text-xs font-black">{statusLabel}</span>', 'building list status pills use readable 12px text');
includes('buildingManager', 'className="liquid-building-status inline-flex rounded-full px-2 py-0.5 text-xs font-black"', 'building mobile unit drawer status uses the explicit 12px text floor');
includes('buildingManager', 'className="mt-0.5 text-xs font-semibold text-slate-500"', 'building mobile unit drawer contract-lock helper uses readable 12px text');
includes('buildingManager', 'className="rounded-full bg-white/72 px-2.5 py-1 text-xs font-black text-slate-500">锁定</span>', 'building mobile unit drawer lock badge uses the explicit 12px text floor');
notMatches('dashboardAlerts', /text-\[(?:9|10|11)px\]|text-slate-400/, 'dashboard alert cards avoid sub-12px and low-contrast helper text');
includes('dashboardAlerts', 'className="liquid-glass-control shrink-0 rounded-full px-2.5 py-1 text-xs font-black text-rose-700"', 'dashboard invoice risk summary uses readable 12px text');
includes('dashboardAlerts', 'className="liquid-glass-control rounded-full px-2.5 py-1 text-xs font-bold text-blue-700">及时送上祝福</span>', 'dashboard current-month care badge uses readable 12px text');
includes('dashboardAlerts', 'className="liquid-glass-control flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold text-slate-600"', 'dashboard next-month care badge uses readable 12px text');
includes('dashboardAlerts', 'className="rounded-full bg-rose-100/80 px-2 py-0.5 text-xs font-bold text-rose-700"', 'dashboard birthday legal-rep badge uses readable 12px text');
includes('dashboardAlerts', 'className="rounded-full bg-amber-100/80 px-2 py-0.5 text-xs font-bold text-amber-700"', 'dashboard birthday contact badge uses readable 12px text');
includes('dashboardAlerts', 'className="liquid-glass-control shrink-0 rounded-full px-2 py-0.5 text-xs font-black text-slate-600"', 'dashboard alert card count badge uses readable 12px text');
includes('css', 'liquid-building-mobile-floor-section', 'building mobile floor grouping has a dedicated glass layer');
includes('buildingManager', 'aria-labelledby="building-prompt-title"', 'building prompt overlay has a visible title label');
includes('buildingManager', 'id="building-prompt-title"', 'building prompt overlay title remains visible');
includes('buildingManager', 'aria-label="关闭楼宇提示"', 'building prompt overlay has a named close control');
includes('buildingManager', 'dismissPrompt', 'building prompt overlay has a shared dismiss path');
matches(
  'buildingManager',
  /const BuildingPromptOverlay[\s\S]*?event\.key !== 'Escape'[\s\S]*?dismissPrompt\(\)/,
  'building prompt overlay closes on Escape through the dismiss path',
);
matches(
  'buildingManager',
  /building-prompt-title[\s\S]*?onClick=\{\(event\) => event\.stopPropagation\(\)\}/,
  'building prompt overlay keeps backdrop click separate from panel clicks',
);
includes('buildingManager', 'aria-labelledby="building-import-result-title"', 'building import result modal has a visible title label');
includes('buildingManager', 'id="building-import-result-title"', 'building import result modal title remains visible');
includes('buildingManager', 'aria-label="关闭导入结果"', 'building import result modal has a named close control');
includes('buildingManager', 'closeImportResult()', 'building import result modal uses a shared close path');
matches(
  'buildingManager',
  /showImportResult[\s\S]*?event\.key !== 'Escape'[\s\S]*?closeImportResult\(\)/,
  'building import result modal closes on Escape',
);
matches(
  'buildingManager',
  /building-import-result-title[\s\S]*?onClick=\{\(event\) => event\.stopPropagation\(\)\}/,
  'building import result modal keeps backdrop click separate from panel clicks',
);

includes('budgetManager', 'aria-labelledby="budget-row-detail-sheet-title"', 'budget row detail sheet has a visible title label');
includes('budgetManager', 'id="budget-row-detail-sheet-title"', 'budget row detail sheet title remains visible');
includes('budgetManager', 'aria-labelledby="budget-amount-adjust-sheet-title"', 'budget amount adjust sheet has a visible title label');
includes('budgetManager', 'id="budget-amount-adjust-sheet-title"', 'budget amount adjust sheet title remains visible');
matches(
  'budgetManager',
  /const BudgetRowDetailSheet[\s\S]*?event\.key === 'Escape'[\s\S]*?onClose\(\)/,
  'budget row detail sheet closes on Escape',
);
matches(
  'budgetManager',
  /const BudgetAmountAdjustSheet[\s\S]*?event\.key === 'Escape'[\s\S]*?onClose\(\)/,
  'budget amount adjust sheet closes on Escape',
);
matches(
  'budgetManager',
  /liquid-budget-mobile-card[\s\S]*?rounded-full bg-white\/72 px-2 py-0\.5 text-xs font-black text-slate-600/,
  'budget mobile month tags use the explicit 12px text floor',
);
includes(
  'budgetManager',
  'className="text-xs font-bold text-slate-500">无特殊标记</span>',
  'budget mobile empty tag copy uses readable 12px text',
);
matches(
  'budgetManager',
  /liquid-budget-mobile-card[\s\S]*?mt-0\.5 text-xs font-bold text-slate-500[\s\S]*?\{isExec \? `预算/,
  'budget mobile month helper values use the explicit 12px text floor',
);
matches(
  'budgetManager',
  /liquid-budget-mobile-card[\s\S]*?font-black text-slate-500">预算[\s\S]*?font-black text-slate-500">实收[\s\S]*?font-black text-slate-500">差额/,
  'budget mobile month metric labels use stronger readable text',
);
includes(
  'budgetManager',
  'className="text-xs font-black text-slate-500">{isExec ? \'累计实收\' : \'年度预算\'}</div>',
  'budget mobile row total label uses the explicit 12px text floor',
);
includes(
  'budgetManager',
  'const rowBudgetCardLabel = `${row.name}，${row.building || \'未分配楼宇\'} ${row.unitNames?.trim() || \'未分配房号\'}，年度预算 ${formatWan(rowTotalBudget, 1)}，累计实收 ${formatWan(rowTotalActual, 1)}，达成 ${rowTotalBudget > 0 ? formatPercent(completionRate, 0) : \'暂无预算\'}，点击查看预算行月度明细`;',
  'budget mobile row cards compose a full readable summary',
);
includes(
  'budgetManager',
  'aria-label={rowBudgetCardLabel}',
  'budget mobile row cards expose the full summary to assistive tech',
);
notMatches(
  'budgetManager',
  /text-xs font-semibold text-slate-400">本年暂无预算月份|block text-\[10px\] text-slate-400 mt-0\.5 tabular-nums|block text-\[10px\] text-sky-600 mt-0\.5 font-bold|block text-\[10px\] text-blue-600 mt-0\.5|text-\[11px\] leading-relaxed text-blue-900/,
  'budget mobile/tablet readable panels avoid old sub-12px and weak-gray copy',
);
includes(
  'budgetManager',
  'className="mt-0.5 block text-xs font-semibold tabular-nums text-slate-500"',
  'budget tablet vacancy forecast helper uses readable 12px text',
);
includes(
  'budgetManager',
  'className="liquid-glass-readable rounded-2xl px-3 py-2 text-xs font-semibold leading-relaxed text-blue-900"',
  'budget scenario inherited-assumption note uses readable 12px text',
);

includes('financeManager', 'aria-labelledby="finance-collect-modal-title"', 'finance collect modal has a visible title label');
includes('financeManager', 'id="finance-collect-modal-title"', 'finance collect modal title remains visible');
includes('financeManager', 'aria-labelledby="finance-batch-collect-title"', 'finance batch collect modal has a visible title label');
includes('financeManager', 'id="finance-batch-collect-title"', 'finance batch collect modal title remains visible');
includes('financeManager', 'aria-labelledby="finance-defer-modal-title"', 'finance defer modal has a visible title label');
includes('financeManager', 'id="finance-defer-modal-title"', 'finance defer modal title remains visible');
includes('financeManager', 'aria-label="关闭缓缴弹层"', 'finance defer modal has a named close control');
includes('financeManager', "event.key !== 'Escape'", 'finance collect modals listen for Escape');
includes('financeManager', 'setCollectModalDetail(null)', 'finance single collect modal can be closed from keyboard/backdrop');
includes('financeManager', 'setBatchPartialOpen(false)', 'finance batch collect modal can be closed from keyboard/backdrop');
includes('financeManager', 'setDeferModalTenant(null)', 'finance defer modal can be closed from keyboard/backdrop');
includes('financeManager', 'liquid-finance-tablet-master-detail', 'finance tablet master-detail layout remains rendered');
includes('financeManager', 'liquid-finance-tablet-preview', 'finance tablet preview remains rendered');
matches(
  'financeManager',
  /tabletPreviewPayments\.some\(\(payment\) => payment\.id === tabletPreviewPaymentId\)[\s\S]*?setTabletPreviewPaymentId\(tabletPreviewPayments\[0\]\.id\)/,
  'finance payment tablet preview resets when filters remove the selected payment',
);
matches(
  'financeManager',
  /tabletPreviewReceivables\.some\(\(item\) => receivableRowKey\(item\) === tabletPreviewReceivableKey\)[\s\S]*?setTabletPreviewReceivableKey\(receivableRowKey\(tabletPreviewReceivables\[0\]\)\)/,
  'finance receivable tablet preview resets when filters remove the selected receivable',
);
matches(
  'financeManager',
  /filteredSpecialBusinessTenants\.some\(\(tenant\) => tenant\.id === tabletPreviewSpecialBusinessTenantId\)[\s\S]*?setTabletPreviewSpecialBusinessTenantId\(filteredSpecialBusinessTenants\[0\]\.id\)/,
  'finance special-business tablet preview resets when filters remove the selected tenant',
);

includes('invoiceManager', 'aria-labelledby="invoice-defer-modal-title"', 'invoice defer modal has a visible title label');
includes('invoiceManager', 'id="invoice-defer-modal-title"', 'invoice defer modal title remains visible');
includes('invoiceManager', 'aria-label="关闭延期开票弹层"', 'invoice defer modal has a named close control');
includes('invoiceManager', "event.key === 'Escape'", 'invoice defer modal listens for Escape');
includes('invoiceManager', 'closeDeferModal', 'invoice defer modal has a shared close path');
includes('invoiceManager', 'liquid-invoice-tablet-master-detail', 'invoice tablet master-detail layout remains rendered');
includes('invoiceManager', 'liquid-invoice-tablet-preview', 'invoice tablet preview remains rendered');
includes('invoiceManager', 'disabled={isPlan}', 'invoice tablet/mobile forecast rows remain action-disabled');
matches(
  'invoiceManager',
  /liquid-invoice-tablet-status[^\n]*text-xs font-black/,
  'invoice tablet preview status uses the explicit 12px text floor',
);
matches(
  'invoiceManager',
  /liquid-invoice-tablet-metric[\s\S]*?text-xs font-black text-slate-500[\s\S]*?原计划应收日/,
  'invoice tablet preview metrics use readable 12px labels',
);
matches(
  'invoiceManager',
  /liquid-invoice-mobile-card[\s\S]*?liquid-invoice-plan-pill[^\n]*text-xs font-black/,
  'invoice mobile forecast pill uses the explicit 12px text floor',
);
matches(
  'invoiceManager',
  /liquid-invoice-table-row[\s\S]*?liquid-invoice-plan-pill[^\n]*text-xs font-black/,
  'invoice table forecast pill uses the explicit 12px text floor',
);
matches(
  'invoiceManager',
  /liquid-invoice-mobile-date[\s\S]*?font-black text-slate-500[\s\S]*?计划开票日/,
  'invoice mobile date labels use stronger readable text',
);
includes(
  'invoiceManager',
  'className="mt-1 text-xs font-semibold text-slate-500">{inv.invoicedAt.slice(0,10)}</div>',
  'invoice table invoiced date avoids low-contrast tiny text',
);
includes(
  'invoiceManager',
  'className="mt-2 text-xs font-semibold text-slate-500">开票时间：{inv.invoicedAt.slice(0,10)}</div>',
  'invoice mobile invoiced date avoids low-contrast helper text',
);
matches(
  'invoiceManager',
  /filteredInvoices\.some\(inv => inv\.id === tabletPreviewInvoiceId\)[\s\S]*?setTabletPreviewInvoiceId\(filteredInvoices\[0\]\.id\)/,
  'invoice tablet preview resets when filters remove the selected invoice',
);

includes('contractManager', 'ContractMobileEmptyState', 'contract mobile empty states remain componentized');
includes('contractManager', 'liquid-mobile-empty-state', 'contract mobile empty state uses the readable glass layer');
includes('contractManager', '当前筛选没有匹配合同，可以清除筛选或换个关键词。', 'contract mobile empty state explains filtered no-results');
includes('contractManager', '当前园区还没有在租合同，可先录入第一份签约。', 'contract mobile empty state explains true empty data');
includes('contractManager', '新增合同', 'contract mobile empty state keeps the safe next action');
includes('contractManager', '暂无历史退租记录', 'contract mobile history empty state remains explicit');
includes('financeManager', 'FinanceMobileEmptyState', 'finance mobile empty states remain componentized');
includes('financeManager', 'liquid-mobile-empty-state', 'finance mobile empty state uses the readable glass layer');
includes('financeManager', '当前关键词或款项类型下没有匹配流水，可以调整筛选条件。', 'finance payment empty state explains filtered no-results');
includes('financeManager', '暂无特殊业态客户', 'finance special business true empty state remains explicit');
includes('financeManager', '当前关键词或状态筛选下没有匹配账单，可以切换为全部查看。', 'finance receivable empty state explains filtered no-results');
includes('invoiceManager', 'InvoiceEmptyState', 'invoice mobile empty state remains componentized');
includes('invoiceManager', 'liquid-mobile-empty-state', 'invoice mobile empty state uses the readable glass layer');
includes('invoiceManager', '该月份无待开票计划', 'invoice mobile empty state remains explicit');
includes('invoiceManager', '没有匹配的待开票或已开票记录', 'invoice mobile empty state explains the current month has no matching plans');

includes('conflictDialog', 'role="dialog"', 'cloud save conflict dialog is exposed as a dialog');
includes('conflictDialog', 'aria-modal="true"', 'cloud save conflict dialog is modal');
includes('conflictDialog', 'aria-labelledby="cloud-save-conflict-dialog-title"', 'cloud save conflict dialog has a visible title label');
includes('conflictDialog', 'id="cloud-save-conflict-dialog-title"', 'cloud save conflict dialog title remains visible');
includes('conflictDialog', 'aria-label="关闭数据冲突弹窗"', 'cloud save conflict dialog has a named close control');
notMatches('conflictDialog', /text-\[(?:9|10|11)px\]|text-slate-400/, 'cloud save conflict dialog avoids sub-12px and low-contrast helper text');
includes('conflictDialog', 'className="text-xs font-semibold text-slate-500"', 'cloud save conflict dialog metadata uses readable 12px muted text');
includes('conflictDialog', 'className="liquid-conflict-field-pill rounded-full px-2 py-0.5 font-mono text-xs font-black"', 'cloud save conflict field pill uses readable 12px text');
includes('conflictDialog', 'className="text-xs font-black text-cyan-700">我的值（本地）</div>', 'cloud save conflict local-value label uses readable 12px text');
includes('conflictDialog', 'className="text-xs font-black text-blue-700">服务端最新值</div>', 'cloud save conflict server-value label uses readable 12px text');
notMatches('tenantMergeTool', /text-\[(?:9|10|11)px\]|text-slate-400/, 'tenant merge/name-link tool avoids sub-12px and low-contrast helper text');
includes('tenantMergeTool', 'className="mb-1.5 block text-xs font-black uppercase tracking-wide text-slate-500">预算年度</label>', 'tenant merge year label uses readable 12px text');
includes('tenantMergeTool', 'className="mb-2 text-xs font-black uppercase tracking-wide text-blue-700"', 'tenant merge contract-customer section label uses readable 12px text');
includes('tenantMergeTool', 'placeholder:text-slate-500', 'tenant merge search placeholder avoids low-contrast helper text');
includes('tenantMergeTool', 'className="font-mono text-xs font-semibold text-slate-500 sm:ml-2">{t.id}</span>', 'tenant merge candidate ids use readable 12px muted text');
includes('tenantMergeTool', 'className="text-xs font-black uppercase tracking-wide text-slate-500">预算行</div>', 'tenant merge saved budget-row label uses readable 12px text');
includes('tenantMergeTool', 'className="text-xs font-black uppercase tracking-wide text-blue-700">合同</div>', 'tenant merge saved contract label uses readable 12px text');
notMatches('tenantInsights', /text-\[(?:9|10|11)px\]|text-slate-400|text-slate-300/, 'tenant insights avoids sub-12px and weak-gray business text');
includes('tenantInsights', 'className="p-8 text-center text-xs font-semibold text-slate-500">未找到匹配客户</div>', 'tenant insights search empty state uses readable muted text');
includes('tenantInsights', 'className="liquid-glass-control rounded-full px-2.5 py-1 text-xs font-black text-slate-600">系统生成</span>', 'tenant insights auto-generated badge uses readable 12px text');
includes('tenantInsights', 'className="font-black text-slate-500">→</span>', 'tenant insights change arrows avoid very weak-gray separators');
includes('tenantInsights', 'className="liquid-glass-readable flex h-full flex-col items-center justify-center px-6 text-center text-sm font-semibold text-slate-500"', 'tenant insights unselected empty state remains readable');
notMatches('sourceAnalysisDashboard', /text-\[(?:9|10|11)px\]|text-slate-400/, 'source analysis dashboard avoids sub-12px and low-contrast helper text');
includes('sourceAnalysisDashboard', 'className="text-xs font-black uppercase tracking-widest text-slate-500">来源标注率</div>', 'source analysis KPI labels use readable muted text');
includes('sourceAnalysisDashboard', 'className="text-xs font-black uppercase tracking-wide text-slate-500">在租 / 退租</div>', 'source analysis mobile active/terminated label uses readable 12px text');
includes('sourceAnalysisDashboard', 'className="text-xs font-black uppercase tracking-wide text-slate-500">提前退租率</div>', 'source analysis mobile early-termination label uses readable 12px text');
includes('sourceAnalysisDashboard', 'className="mt-1 text-xs font-medium text-slate-500"', 'source analysis expanded tenant metadata uses readable 12px text');
includes('sourceAnalysisDashboard', 'className="px-4 py-10 text-center text-sm font-semibold text-slate-500"', 'source analysis desktop empty state avoids low-contrast helper text');
notMatches('charts', /text-\[(?:9|10|11)px\]|fontSize:\s*(?:10|11)|text-slate-400/, 'shared analysis charts avoid sub-12px labels and weak empty text');
includes('charts', 'rounded-full px-2.5 py-1 text-xs font-black text-blue-700', 'shared analysis chart status badge uses readable 12px text');
includes('charts', "tick={{fill: '#b45309', fontSize: 12, fontWeight: 700}}", 'shared revenue chart right axis uses readable 12px tick text');
notMatches('sourceAnalysisCharts', /text-\[(?:9|10|11)px\]|fontSize:\s*(?:10|11)|text-slate-400/, 'source analysis charts avoid sub-12px axis labels and weak empty text');
includes('sourceAnalysisCharts', "tick={{ fill: '#475569', fontSize: 12, fontWeight: 700 }}", 'source analysis chart axes use readable 12px muted text');
includes('sourceAnalysisCharts', 'className="flex h-full items-center justify-center text-sm font-semibold text-slate-500"', 'source analysis chart empty state uses readable muted text');
includes('sourceAnalysisCharts', 'className="w-full text-center text-sm font-semibold text-slate-500">暂无合同数据</div>', 'source analysis pie empty state uses readable muted text');
notMatches('sharedTables', /text-\[(?:9|10|11)px\]|text-slate-400/, 'workbench shared tables avoid sub-12px and low-contrast helper text');
includes('sharedTables', 'className="mt-1 text-xs font-semibold text-slate-500">仅展示最近 1 个月内签约（优先签约日，否则起租日）</p>', 'recent signings helper copy uses readable 12px text');
includes('sharedTables', 'className="mb-1 text-xs font-semibold text-slate-500">{daysLeft > 0 ? `剩 ${daysLeft} 天` : \'已过期\'}</div>', 'expiring-soon mobile remaining-days label uses readable 12px text');
includes('sharedTables', 'className="mt-1 text-xs font-semibold text-slate-500">数据源：生效预算方案（月度应收）</div>', 'budget execution source helper uses readable 12px text');
includes('sharedTables', 'className="text-xs font-semibold text-blue-700">预算收款</div>', 'budget execution mobile budget label uses readable 12px text');
includes('sharedTables', 'className="text-xs font-semibold text-cyan-700">实际收款</div>', 'budget execution mobile actual label uses readable 12px text');
includes('sharedTables', 'className="text-xs font-semibold text-slate-500">年初预算</div>', 'annual comparison initial-budget label uses readable 12px text');
notMatches('virtualizedTable', /text-slate-400/, 'virtualized table default empty state avoids weak-gray copy');
includes('virtualizedTable', 'py-12 text-sm font-semibold text-slate-500', 'virtualized table default empty state uses readable muted text');
notMatches('statsCards', /text-\[(?:9|10|11)px\]|text-slate-400|text-slate-300/, 'workbench stats cards avoid sub-12px and low-contrast helper text');
includes('statsCards', 'className="liquid-glass-control shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold text-blue-700">实时</span>', 'workbench monthly breakdown realtime badge uses readable 12px text');
includes('statsCards', 'className="liquid-workbench-segment flex shrink-0 rounded-full p-1 text-xs font-semibold"', 'workbench fee-scope segment uses readable 12px text');
includes('statsCards', 'className="text-xs font-black text-amber-700">年初预算</div>', 'workbench monthly initial-budget label uses readable 12px text');
includes('statsCards', 'className="text-xs font-black text-cyan-700">{scopeLabels.actualCol}</div>', 'workbench monthly actual label uses readable 12px text');
includes('statsCards', 'className="text-xs font-black text-slate-500">累计达成</div>', 'workbench cumulative label uses readable 12px text');
includes('statsCards', 'className="mt-0.5 text-xs font-semibold text-slate-500"', 'workbench arrears helper copy uses readable 12px text');
matches(
  'conflictDialog',
  /event\.key !== 'Escape'[\s\S]*?onClose\(\)/,
  'cloud save conflict dialog closes on Escape',
);
matches(
  'conflictDialog',
  /cloud-save-conflict-dialog-title[\s\S]*?onClick=\{\(event\) => event\.stopPropagation\(\)\}/,
  'cloud save conflict dialog keeps backdrop click separate from panel clicks',
);

includes('customFields', 'CUSTOM_DASHBOARD_FIELD_LIMIT = 5', 'dashboard custom fields stay capped at five');
includes('customFields', 'buildDashboardCustomFieldStorageKey', 'dashboard custom fields remain user-scoped');
includes('dashboardCustomFieldsComponent', '最多显示 {CUSTOM_DASHBOARD_FIELD_LIMIT} 个字段', 'custom field panel shows the five-field limit');
includes('dashboardCustomFieldsComponent', 'role="dialog"', 'custom field settings dialog is exposed as a dialog');
includes('dashboardCustomFieldsComponent', 'aria-modal="true"', 'custom field settings dialog is modal');
includes('dashboardCustomFieldsComponent', 'aria-labelledby="dashboard-custom-field-settings-title"', 'custom field settings dialog has a visible label');
includes('dashboardCustomFieldsComponent', 'aria-label="关闭自定义字段设置"', 'custom field settings dialog has a close label');
includes('dashboardCustomFieldsComponent', 'useMobileSheetFocus<HTMLElement, HTMLButtonElement, HTMLElement>', 'custom field settings dialog closes on Escape through the shared focus hook');
includes('dashboardCustomFieldsComponent', 'DEFAULT_CUSTOM_DASHBOARD_FIELD_IDS', 'custom field settings keep default restoration');
includes('dashboardCustomFieldsComponent', 'const fieldSummaryLabel = `${option.label} ${resolved.value}，${resolved.helper}`', 'mobile custom field cards build full summaries from existing resolver output');
includes('dashboardCustomFieldsComponent', 'aria-label={compact ? fieldSummaryLabel : undefined}', 'mobile custom field cards expose full summaries when truncated');
includes('dashboardCustomFieldsComponent', 'title={fieldSummaryLabel}', 'custom field cards keep a native full-summary affordance');
includes('dashboardCustomFieldsTest', 'aria-label="本年累计出租 0㎡，0 份合同起租"', 'custom field render test covers mobile card full summaries');

includes('arrears', 'buildTenantHistoricalArrears', 'tenant-level historical arrears uses a single service entry');
includes('arrears', '封账月 ${period} 缺少客户级应收明细', 'historical arrears refuses unreliable sealed-month splits');

includes('contentDoc', '视觉 QA 约束', 'content optimization document records visual QA constraints');
includes('contentDoc', '触控约束', 'content optimization document records touch constraints');
includes('contentDoc', '移动字号约束', 'content optimization document records mobile typography constraints');
includes('contentDoc', '移动弹层语义约束', 'content optimization document records mobile sheet accessibility constraints');
includes('glassDoc', 'prefers-color-scheme: dark', 'glass optimization document records dark material constraints');
includes('glassDoc', '移动字号守卫', 'glass optimization document records mobile typography guard constraints');
includes('glassDoc', '移动弹层语义', 'glass optimization document records mobile sheet dialog constraints');

const appLineCount = files.app.split('\n').length;
const cssLineCount = files.css.split('\n').length;
addWarning('App.tsx is approaching the extraction threshold', appLineCount < 9000, `current lines: ${appLineCount}`);
addWarning('index.css is approaching the tokenization threshold', cssLineCount < 5200, `current lines: ${cssLineCount}`);

const failed = checks.filter((check) => !check.ok);

console.log('Mobile UI guardrails');
console.log(`Checks: ${checks.length - failed.length}/${checks.length} passed`);
if (warnings.length) {
  console.log('\nWarnings:');
  for (const warning of warnings) {
    console.log(`  - ${warning.label}: ${warning.detail}`);
  }
}

if (failed.length) {
  console.error('\nFailed checks:');
  for (const failure of failed) {
    console.error(`  - ${failure.label}`);
    console.error(`    ${failure.detail}`);
  }
  process.exit(1);
}

console.log('All mobile UI guardrails passed.');
