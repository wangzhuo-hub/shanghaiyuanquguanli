
import React, { useState, useEffect, useMemo, Suspense } from 'react';
import { LayoutDashboard, Building2, Users, PieChart, Settings, Bell, Search, Menu, Sparkles, UserCircle, Download, Upload, X, Filter, Save, RotateCcw, Trash2, Calculator, Database, Lightbulb, Cloud, CloudCog, RefreshCw, AlertCircle, ExternalLink, Link, Info, Loader2, CheckCircle2, XCircle, History, FileClock, ChevronRight, ChevronDown, CloudUpload, LogOut, User, Calendar, ChevronLeft, FileInput, Table as TableIcon, FileText, Pencil, UserCog, Mail, LockKeyhole, ShieldCheck, MoreHorizontal } from 'lucide-react';
import { generateInitialData } from './services/mockData';
import { DashboardData, Building, Tenant, PaymentRecord, UnitStatus, MonthlyTrend, PaymentCycle, RentFreePeriod, BillingDetail, ParkingStatDetail, BudgetAssumption, BudgetAdjustment, BudgetAnalysisData, CloudConfig, AIConfig, CloudBackupMetadata, BudgetScenario, MonthlyInitData, ContractStatus, DepositStatus, InvoiceRecord, AuthUser, ParkInfo, UserRole } from './types';
import { StatsCards as StatsCardsBase } from './components/StatsCards';
import type { AnnualComparisonData } from './components/Tables';
import type { FinanceServerBillingDetails } from './components/FinanceManager';
import type { NewManagedUserForm } from './components/SystemSettingsPanel';
import type {
    MobileSearchBuildingOption,
    MobileSearchExpiryMonthOption,
    MobileSearchFilter,
} from './components/MobileTenantSearchPanel';
import { MobileNavigation, type MobileMoreItem, type MobileNavItem } from './components/MobileNavigation';
import { DashboardCustomFieldSettings, DashboardCustomFields } from './components/DashboardCustomFields';
import {
    checkConnection,
    getCloudHistory,
    fetchCloudBackup,
    initCloud,
    saveIncrementalToCloud,
    bumpCloudSaveVersion,
    readCloudSaveVersion,
    forceOverwriteCloudRecord,
    forceDeleteCloudRecord,
    loginCloudUser,
    logoutCloudUser,
    getCurrentCloudUser,
    refreshCloudAuthRecord,
    fetchAuthorizedParks,
    fetchCloudKpiSnapshot,
    setCloudLoadWindowSinceYear,
} from './services/cloudService';
import { getCurrentCloudAuthToken } from './services/cloudAuthToken';
import type { KpiSnapshotSummary, RecordMeta, IncrementalConflict, IncrementalApplied } from './services/cloudService';
import { formatIncrementalSaveDetails, formatIncrementalSaveAlertTitle, type IncrementalSaveDisplayOptions } from './services/cloudService';
import type { ManagedUserAccount, SignupRequestRecord } from './services/cloudAccountService';
import {
    DEFER_BILLING_NOTE_PREFIX,
    removeDeferBillingNoteByKey,
    applyBillingPeriodDeferNotes,
    partitionPaymentsRemovingAutoReceivableWriteOffs,
    parseSpecialBusinessReceivablesFromNotes,
    removeDeferBillingNotesFromNotes,
    rentCollectionRemarkKey,
    specialBusinessArDisplayTenantId,
} from './services/receivableListHelpers';
import type { DeferBillingNote } from './services/receivableListHelpers';
import {
    buildKpiSummaryFromProcessedData,
    normalizeScenarioForReceivable as normalizeScenarioForReceivableService,
    normalizeKpiSummaryWithMonthlyTrends,
    resolveAnnualInitialBudget,
    normalizeYearlyTargetsFromInitialization,
    type DashboardQuarter,
} from './services/dashboardMetricHelpers';
import { computeMetricsInWorker, isMetricsWorkerAvailable } from './services/metricsWorkerClient';
import { formatArea, formatCurrency, formatPercent, formatWan } from './services/numberFormat';
import { transitionContractStatuses } from './services/sharedUtils';
import { isManagementFeeBillingEnabled } from './services/parkBillingConfig';
import { normalizeReceivablePermissions, userRoleLabel } from './services/receivablePermissions';
import { DEFAULT_CLOUD_CONFIG, mergeStoredCloudConfig, cloudConfigForStorage } from './config/deploymentDefaults';
import { getIntegrationAppComputeRefreshUrl } from './config/urls';
import { DirtyTrackerProvider } from './services/dirtyTrackerContext';
import { DirtyTracker, type DirtyPayload } from './services/dirtyTracker';
import {
    dashboardDataToPbRecords,
    diffPbRecords,
    diffPbRecordsScoped,
    payloadCount,
    PB_RECORD_COLLECTIONS,
    type PbRecordMap,
} from './services/dataDiff';
import { DashboardCacheWriter } from './services/dashboardCacheWriter';
import { LastSavePayloadMemo, savePayloadCollectionsKey, savePayloadDataIdentityKey } from './services/savePayloadMemo';
import {
	hasPendingSaveDiff,
	shouldAttemptCloudSaveDuringAutoSave,
	shouldScheduleAutoSave,
	shouldWriteDashboardCacheDuringAutoSave,
	validateManualCloudSave,
} from './services/saveDiffState';
import {
    preserveRentFieldsInTenantPbMap,
    filterDirtyPayloadForRentMaskedUser,
} from './services/tenantRentFieldGuard';
import { scopeCachedDashboardData } from './services/dataScopeFilter';
import { mergeLocalDashboardCacheIntoCloud } from './services/localCloudMerge';
import {
    migrateShanghaiInitRow,
    resolveInitMonthInitialBudget,
    SHANGHAI_PARK_ID,
    shouldRunLocalInitialBudgetImportFallback,
    validateInitialBudgetImportServerItems,
} from './services/initDataBudget';
import { parkAreaMetricsFromDashboard } from './services/parkAreaMetricSnapshot';
import { cachePut, cacheGet } from './services/storageCache';
import {
    clearParkStorageFallbackIfMatches,
    putParkStorageFallback,
    readParkDataCache,
} from './services/parkStorageFallback';
import {
    isServerComputeEnabled,
    shouldRunLocalDashboardMetricsForCloudLoad,
    shouldRunLocalBillingFallback,
    shouldRunLocalDashboardMetricsFallback,
} from './services/computeFallbackPolicy';
import { getVirtualTenants } from './services/virtualTenants';
import { reconcileTenantAreasWithBuildings } from './services/tenantAreaReconciliation';
import {
    buildMobileTenantSearchIndex,
    countMobileTenantSearchResults,
    filterMobileTenantSearchIndex,
    selectMobileTenantSearchResults,
    shouldBuildMobileTenantSearchIndexForView,
    type MobileTenantSearchIndexEntry,
    type MobileTenantSearchArrearsFilter,
    type MobileTenantSearchPaymentFilter,
    type MobileTenantSearchReceivableFilter,
    type MobileTenantSearchResult,
} from './services/mobileTenantSearch';
import type { TenantHistoricalArrearsResult } from './services/tenantHistoricalArrears';
import {
    shouldBuildAnnualComparisonDataForView,
    shouldBuildDashboardBillingKeyForView,
    shouldBuildDashboardBillingDataForView,
    shouldRenderDesktopDashboardContent,
    shouldRunDashboardBillingEffectForView,
    shouldRunDashboardMetricsFilterEffectForView,
} from './services/dashboardViewGuards';
import { shouldRecalculateMetricsForDashboardPatch } from './services/dashboardMutationGuards';
import { shouldBuildFinanceBillingKeyForView, shouldRunFinanceBillingEffectForView } from './services/financeViewGuards';
import {
    billingEffectDataIdentityKey,
    hasBillingRelevantDirtyCollections,
} from './services/billingEffectIdentity';
import { dashboardBillingDisplayDataIdentityKey } from './services/dashboardBillingDisplayIdentity';
import {
    buildDashboardCustomFieldStorageKey,
    normalizeDashboardCustomFieldIds,
    readDashboardCustomFieldIds,
    writeDashboardCustomFieldIds,
    type DashboardCustomFieldId,
} from './services/dashboardCustomFields';
import {
    fetchCloudDashboardCustomFieldIds,
    writeCloudDashboardCustomFieldIds,
} from './services/dashboardCustomFieldCloudPreferences';
import { useMobileSheetFocus } from './components/useMobileSheetFocus';

const AIAssistantDialog = React.lazy(() =>
    import('./components/AIAssistantDialog').then((m) => ({ default: m.AIAssistantDialog }))
);
const AssistantPanel = React.lazy(() =>
    import('./components/AssistantPanel').then((m) => ({ default: m.AssistantPanel }))
);
const BillingTable = React.lazy(() =>
    import('./components/BillingTable').then((m) => ({ default: m.BillingTable }))
);
const AnnualMetricComparisonTable = React.lazy(() =>
    import('./components/Tables').then((m) => ({ default: m.AnnualMetricComparisonTable }))
);
const RecentActivityTable = React.lazy(() =>
    import('./components/Tables').then((m) => ({ default: m.RecentActivityTable }))
);
const DashboardAlerts = React.lazy(() =>
    import('./components/DashboardAlerts').then((m) => ({ default: m.DashboardAlerts }))
);
const BuildingManager = React.lazy(() =>
    import('./components/BuildingManager').then((m) => ({ default: m.BuildingManager }))
);
const ContractManager = React.lazy(() =>
    import('./components/ContractManager').then((m) => ({ default: m.ContractManager }))
);
const FinanceManager = React.lazy(() =>
    import('./components/FinanceManager').then((m) => ({ default: m.FinanceManager }))
);
const BudgetManager = React.lazy(() =>
    import('./components/BudgetManager').then((m) => ({ default: m.BudgetManager }))
);
const SystemSettingsPanel = React.lazy(() =>
    import('./components/SystemSettingsPanel').then((m) => ({ default: m.SystemSettingsPanel }))
);
const TenantBudgetNameLinkTool = React.lazy(() =>
    import('./components/TenantMergeTool').then((m) => ({ default: m.TenantBudgetNameLinkTool }))
);
const MobileTenantSearchPanel = React.lazy(() =>
    import('./components/MobileTenantSearchPanel').then((m) => ({ default: m.MobileTenantSearchPanel }))
);
const ConflictDialog = React.lazy(() =>
    import('./components/ConflictDialog').then((m) => ({ default: m.ConflictDialog }))
);

type DashboardMetricsModule = typeof import('./services/dashboardMetrics');
let dashboardMetricsModulePromise: Promise<DashboardMetricsModule> | null = null;
let dashboardMetricsModuleCache: DashboardMetricsModule | null = null;
type CloudComputeClientModule = typeof import('./services/cloudComputeClient');
type CloudDraftPayloadOptions = import('./services/cloudComputeClient').CloudDraftPayloadOptions;
let cloudComputeClientModulePromise: Promise<CloudComputeClientModule> | null = null;
type CloudAccountServiceModule = typeof import('./services/cloudAccountService');
let cloudAccountServiceModulePromise: Promise<CloudAccountServiceModule> | null = null;

const loadCloudComputeClient = (): Promise<CloudComputeClientModule> => {
    if (!cloudComputeClientModulePromise) {
        cloudComputeClientModulePromise = import('./services/cloudComputeClient');
    }
    return cloudComputeClientModulePromise;
};

const loadCloudAccountService = (): Promise<CloudAccountServiceModule> => {
    if (!cloudAccountServiceModulePromise) {
        cloudAccountServiceModulePromise = import('./services/cloudAccountService');
    }
    return cloudAccountServiceModulePromise;
};

const fetchCloudComputedDashboard = async (
    ...args: Parameters<CloudComputeClientModule['fetchCloudComputedDashboard']>
): Promise<Awaited<ReturnType<CloudComputeClientModule['fetchCloudComputedDashboard']>>> => {
    const module = await loadCloudComputeClient();
    return module.fetchCloudComputedDashboard(...args);
};

const fetchCloudDashboardBootstrap = async (
    ...args: Parameters<CloudComputeClientModule['fetchCloudDashboardBootstrap']>
): Promise<Awaited<ReturnType<CloudComputeClientModule['fetchCloudDashboardBootstrap']>>> => {
    const module = await loadCloudComputeClient();
    return module.fetchCloudDashboardBootstrap(...args);
};

const fetchCloudDraftComputedDashboard = async (
    ...args: Parameters<CloudComputeClientModule['fetchCloudDraftComputedDashboard']>
): Promise<Awaited<ReturnType<CloudComputeClientModule['fetchCloudDraftComputedDashboard']>>> => {
    const module = await loadCloudComputeClient();
    return module.fetchCloudDraftComputedDashboard(...args);
};

const fetchCloudComputedBilling = async (
    ...args: Parameters<CloudComputeClientModule['fetchCloudComputedBilling']>
): Promise<Awaited<ReturnType<CloudComputeClientModule['fetchCloudComputedBilling']>>> => {
    const module = await loadCloudComputeClient();
    return module.fetchCloudComputedBilling(...args);
};

const fetchCloudTenantHistoricalArrears = async (
    ...args: Parameters<CloudComputeClientModule['fetchCloudTenantHistoricalArrears']>
): Promise<Awaited<ReturnType<CloudComputeClientModule['fetchCloudTenantHistoricalArrears']>>> => {
    const module = await loadCloudComputeClient();
    return module.fetchCloudTenantHistoricalArrears(...args);
};

const fetchCloudDraftComputedBilling = async (
    ...args: Parameters<CloudComputeClientModule['fetchCloudDraftComputedBilling']>
): Promise<Awaited<ReturnType<CloudComputeClientModule['fetchCloudDraftComputedBilling']>>> => {
    const module = await loadCloudComputeClient();
    return module.fetchCloudDraftComputedBilling(...args);
};

const fetchCloudBudgetedBillsPreviewBatch = async (
    ...args: Parameters<CloudComputeClientModule['fetchCloudBudgetedBillsPreviewBatch']>
): Promise<Awaited<ReturnType<CloudComputeClientModule['fetchCloudBudgetedBillsPreviewBatch']>>> => {
    const module = await loadCloudComputeClient();
    return module.fetchCloudBudgetedBillsPreviewBatch(...args);
};

const changeOwnCloudPassword = async (
    ...args: Parameters<CloudAccountServiceModule['changeOwnCloudPassword']>
): Promise<Awaited<ReturnType<CloudAccountServiceModule['changeOwnCloudPassword']>>> => {
    const module = await loadCloudAccountService();
    return module.changeOwnCloudPassword(...args);
};

const fetchManagedCloudUsers = async (
    ...args: Parameters<CloudAccountServiceModule['fetchManagedCloudUsers']>
): Promise<Awaited<ReturnType<CloudAccountServiceModule['fetchManagedCloudUsers']>>> => {
    const module = await loadCloudAccountService();
    return module.fetchManagedCloudUsers(...args);
};

const createManagedCloudUser = async (
    ...args: Parameters<CloudAccountServiceModule['createManagedCloudUser']>
): Promise<Awaited<ReturnType<CloudAccountServiceModule['createManagedCloudUser']>>> => {
    const module = await loadCloudAccountService();
    return module.createManagedCloudUser(...args);
};

const updateManagedCloudUserEnabled = async (
    ...args: Parameters<CloudAccountServiceModule['updateManagedCloudUserEnabled']>
): Promise<Awaited<ReturnType<CloudAccountServiceModule['updateManagedCloudUserEnabled']>>> => {
    const module = await loadCloudAccountService();
    return module.updateManagedCloudUserEnabled(...args);
};

const updateManagedCloudUser = async (
    ...args: Parameters<CloudAccountServiceModule['updateManagedCloudUser']>
): Promise<Awaited<ReturnType<CloudAccountServiceModule['updateManagedCloudUser']>>> => {
    const module = await loadCloudAccountService();
    return module.updateManagedCloudUser(...args);
};

const deleteManagedCloudUser = async (
    ...args: Parameters<CloudAccountServiceModule['deleteManagedCloudUser']>
): Promise<Awaited<ReturnType<CloudAccountServiceModule['deleteManagedCloudUser']>>> => {
    const module = await loadCloudAccountService();
    return module.deleteManagedCloudUser(...args);
};

const deleteCloudSignupRequest = async (
    ...args: Parameters<CloudAccountServiceModule['deleteCloudSignupRequest']>
): Promise<Awaited<ReturnType<CloudAccountServiceModule['deleteCloudSignupRequest']>>> => {
    const module = await loadCloudAccountService();
    return module.deleteCloudSignupRequest(...args);
};

const fetchPublicCloudParks = async (
    ...args: Parameters<CloudAccountServiceModule['fetchPublicCloudParks']>
): Promise<Awaited<ReturnType<CloudAccountServiceModule['fetchPublicCloudParks']>>> => {
    const module = await loadCloudAccountService();
    return module.fetchPublicCloudParks(...args);
};

const submitCloudSignupRequest = async (
    ...args: Parameters<CloudAccountServiceModule['submitCloudSignupRequest']>
): Promise<Awaited<ReturnType<CloudAccountServiceModule['submitCloudSignupRequest']>>> => {
    const module = await loadCloudAccountService();
    return module.submitCloudSignupRequest(...args);
};

const fetchCloudSignupRequests = async (
    ...args: Parameters<CloudAccountServiceModule['fetchCloudSignupRequests']>
): Promise<Awaited<ReturnType<CloudAccountServiceModule['fetchCloudSignupRequests']>>> => {
    const module = await loadCloudAccountService();
    return module.fetchCloudSignupRequests(...args);
};

const approveCloudSignupRequest = async (
    ...args: Parameters<CloudAccountServiceModule['approveCloudSignupRequest']>
): Promise<Awaited<ReturnType<CloudAccountServiceModule['approveCloudSignupRequest']>>> => {
    const module = await loadCloudAccountService();
    return module.approveCloudSignupRequest(...args);
};

const rejectCloudSignupRequest = async (
    ...args: Parameters<CloudAccountServiceModule['rejectCloudSignupRequest']>
): Promise<Awaited<ReturnType<CloudAccountServiceModule['rejectCloudSignupRequest']>>> => {
    const module = await loadCloudAccountService();
    return module.rejectCloudSignupRequest(...args);
};

const loadDashboardMetricsModule = async (): Promise<DashboardMetricsModule> => {
    if (dashboardMetricsModuleCache) return dashboardMetricsModuleCache;
    if (!dashboardMetricsModulePromise) {
        dashboardMetricsModulePromise = import('./services/dashboardMetrics').then((module) => {
            dashboardMetricsModuleCache = module;
            return module;
        });
    }
    return dashboardMetricsModulePromise;
};

const getLoadedDashboardMetricsModule = (): DashboardMetricsModule | null => dashboardMetricsModuleCache;

const buildBillingDetailsForPeriodLocal = async (
    year: number,
    month: number,
    sourceData: DashboardData,
): Promise<BillingDetail[]> => {
    const module = await loadDashboardMetricsModule();
    return module.buildBillingDetailsForPeriod(
        year,
        month,
        sourceData,
        module.getOrCreateBillingCacheFor(sourceData),
    );
};

const STORAGE_KEY = 'kingdee_park_data_v1';
// 标准化交付：升级存储 key，避免历史环境把旧的内网 URL 自动带入新部署
const CLOUD_CONFIG_KEY = 'kingdee_park_cloud_config_v2';
const getParkStorageKey = (projectId: string) => `${STORAGE_KEY}:${projectId || 'unknown'}`;
type DashboardBillingLazyState = {
    key: string;
    rows: BillingDetail[];
    loading: boolean;
    error?: string;
};
const DASHBOARD_BILLING_ROWS_CACHE_MAX = 24;
const cloneBillingRows = (rows: BillingDetail[]): BillingDetail[] =>
    rows.map((row) => ({ ...row }));
const putBillingRowsCache = (
    cache: Map<string, BillingDetail[]>,
    key: string,
    rows: BillingDetail[],
): void => {
    if (!key) return;
    cache.set(key, cloneBillingRows(rows));
    while (cache.size > DASHBOARD_BILLING_ROWS_CACHE_MAX) {
        const firstKey = cache.keys().next().value;
        if (!firstKey) break;
        cache.delete(firstKey);
    }
};
type SavePayloadSliceDescriptor = {
    key: keyof DashboardData;
    collections: string[];
};
type DashboardDataLoadScope = { kind: 'full' } | { kind: 'year'; year: number };
type DashboardMruEntry = {
    data: DashboardData;
    year: number;
    quarter: DashboardQuarter;
    billingSelectedMonth: string;
    loadedAt: number;
};
const FULL_DASHBOARD_LOAD_SCOPE: DashboardDataLoadScope = { kind: 'full' };
const DASHBOARD_MRU_MAX_ENTRIES = 6;
const INITIAL_DASHBOARD_INCLUDE_PREV_YEAR_TRENDS = false;
const MOBILE_TENANT_SEARCH_PAGE_SIZE = 6;
type MobileTenantActionFocus = {
    tenantId: string;
    tenantName: string;
    requestId: number;
};
const PARK_SWITCH_BOOTSTRAP_PREVIEW_GRACE_MS = 180;
const backupOptionsForLoadScope = (
    scope: DashboardDataLoadScope
): { year?: number; sinceYear?: number } | undefined =>
    scope.kind === 'year' ? { year: scope.year } : undefined;
const normalizeComputedLoadScope = (
    scope: DashboardDataLoadScope | undefined,
    fallbackYear: number
): DashboardDataLoadScope =>
    scope?.kind === 'full'
        ? FULL_DASHBOARD_LOAD_SCOPE
        : scope?.kind === 'year' && Number.isFinite(scope.year)
        ? { kind: 'year', year: Math.floor(scope.year) }
        : { kind: 'year', year: fallbackYear };

const buildSavePayloadDataIdentityKey = (
    data: DashboardData,
    scopedCollections: string[],
    persistentSlices: SavePayloadSliceDescriptor[],
): string => {
    const selected = scopedCollections.length > 0 ? new Set(scopedCollections) : null;
    let parts = persistentSlices
        .filter((item) => !selected || item.collections.some((collection) => selected.has(collection)))
        .map((item): [string, unknown] => [String(item.key), data[item.key]]);
    if (selected && parts.length === 0) {
        parts = persistentSlices.map((item): [string, unknown] => [String(item.key), data[item.key]]);
    }
    return savePayloadDataIdentityKey(parts);
};
// 按年窗口加载（B3，默认关闭）：VITE_YEAR_WINDOW_LOAD=1 时只加载「当年+上一年」收款/发票，
// 历史欠款走 pb_sealed_months 封账快照。必须在封账回填完成后再开启，否则窗口外欠款会缺失。
// 同一模块级窗口驱动所有 fetchCloudBackup，data 与 baseline 口径天然一致（规避第二轮的错位风暴）。
if (import.meta.env?.VITE_YEAR_WINDOW_LOAD === '1') {
    setCloudLoadWindowSinceYear(new Date().getFullYear() - 1);
}

// 工作台首屏重组件用 React.memo 包裹（模块级，避免每次渲染重建）：
// data 引用未变（切 tab 命中结果缓存、无关 state 更新）时跳过整树重渲染。
const StatsCards = React.memo(StatsCardsBase);

const runWhenBrowserIdle = <T,>(task: () => T, timeout = 350): Promise<T> =>
    new Promise((resolve, reject) => {
        const run = () => {
            try {
                resolve(task());
            } catch (e) {
                reject(e);
            }
        };
        if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
            window.requestIdleCallback(run, { timeout });
        } else {
            window.setTimeout(run, 0);
        }
    });
const DASHBOARD_BOOTSTRAP_SOFT_TIMEOUT_MS = 2000;
const nowMs = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const bootMark = (name: string): void => {
    if (typeof performance !== 'undefined' && typeof performance.mark === 'function') {
        performance.mark(name);
    }
};
const bootLog = (name: string, startedAt: number, extra?: Record<string, unknown>): void => {
    const elapsed = Math.round(nowMs() - startedAt);
    console.info(`[boot] ${name} ${elapsed}ms`, extra || {});
};
const withSoftTimeout = async <T,>(
    promise: Promise<T>,
    timeoutMs: number,
    fallback: T,
): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<T>((resolve) => {
                timer = setTimeout(() => resolve(fallback), timeoutMs);
            }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
};
const hasMeaningfulDashboardPayload = (d: DashboardData): boolean =>
    (d.buildings?.length ?? 0) > 0 ||
    (d.tenants?.length ?? 0) > 0 ||
    (d.payments?.length ?? 0) > 0 ||
    (d.budgetScenarios?.length ?? 0) > 0 ||
    (d.invoices?.length ?? 0) > 0 ||
    (d.initializationData?.length ?? 0) > 0 ||
    (d.budgetAssumptions?.length ?? 0) > 0;
/** 校验 data 中的租户 projectId 是否与当前园区一致，防止跨园区数据覆盖 */
const validateDataProjectConsistency = (
    data: DashboardData,
    expectedProjectId: string,
): { consistent: boolean; mismatchCount: number; totalChecked: number } => {
    const tenants = data.tenants || [];
    if (tenants.length === 0) return { consistent: true, mismatchCount: 0, totalChecked: 0 };
    let mismatchCount = 0;
    for (let i = 0; i < tenants.length; i++) {
        if (tenants[i].projectId && tenants[i].projectId !== expectedProjectId) {
            mismatchCount++;
        }
    }
    return { consistent: mismatchCount === 0, mismatchCount, totalChecked: tenants.length };
};

/** 检测批量操作是否异常（大规模增/删），超阈值需用户确认 */
const BULK_OPERATION_THRESHOLD = 20;
const detectAnomalousBatch = (creates: number, deletes: number): string | null => {
    if (deletes > BULK_OPERATION_THRESHOLD) {
        return `检测到批量删除 ${deletes} 条记录，超过安全阈值(${BULK_OPERATION_THRESHOLD})`;
    }
    if (creates > BULK_OPERATION_THRESHOLD) {
        return `检测到批量新增 ${creates} 条记录，超过安全阈值(${BULK_OPERATION_THRESHOLD})`;
    }
    return null;
};


type SignupForm = {
    applicantName: string;
    email: string;
    password: string;
    requestedProjectIds: string[];
};

// 核心计算逻辑：确保这里使用的逻辑与预算表(BudgetManager)完全一致

/**
 * 把「特殊业态收入录入」的月度金额注入应收明细（与 services/dashboardMetrics.ts 中口径保持一致）。
 * - 显示行使用 `sbiz_ar_${tenantId}__${period}` 作为 tenantId，防止与系统账单/手工应收冲突；
 * - amountPaid 同时识别真实 tenantId 与 sbiz 显示 tenantId 的关联收款。
 */









interface SidebarItemProps {
  icon: React.ReactNode;
  label: string;
  isOpen: boolean;
  active: boolean;
  onClick: () => void;
}

const SidebarItem: React.FC<SidebarItemProps> = ({ icon, label, isOpen, active, onClick }) => (
  <button
    onClick={onClick}
    className={`
      liquid-pressable group relative flex w-full items-center gap-3 overflow-hidden px-5 py-2.5 transition-all duration-300 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-200/80 lg:mx-2.5 lg:h-14 lg:w-[calc(100%-1.25rem)] lg:justify-start lg:rounded-[20px] lg:px-2.5 lg:py-0
      ${active 
        ? 'liquid-nav-active font-semibold'
        : 'text-slate-600 hover:bg-white/36 hover:text-slate-950 hover:shadow-sm hover:shadow-slate-900/5'
      }
    `}
    title={label}
  >
    <div className={`
      liquid-icon-well relative z-10 flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[18px] transition-all duration-300
      ${active ? 'scale-105 text-blue-700' : 'group-hover:scale-105'}
    `}>
      {icon}
    </div>
    
    <span className={`
      relative z-10 whitespace-nowrap text-base font-semibold transition-all duration-300 origin-left lg:w-0 lg:-translate-x-2 lg:overflow-hidden lg:text-sm lg:opacity-0 lg:group-hover/sidebar:w-[7.5rem] lg:group-hover/sidebar:translate-x-0 lg:group-hover/sidebar:opacity-100 lg:group-focus-within/sidebar:w-[7.5rem] lg:group-focus-within/sidebar:translate-x-0 lg:group-focus-within/sidebar:opacity-100
      ${isOpen ? 'opacity-100 translate-x-0 w-auto' : 'opacity-0 -translate-x-4 w-0 overflow-hidden absolute md:static'}
    `}>
      {label}
    </span>
  </button>
);

const LazyPanelFallback = () => (
  <div className="flex min-h-[240px] items-center justify-center rounded-xl border border-slate-100 bg-white text-slate-500">
    <div className="flex items-center gap-2 text-sm">
      <Loader2 size={18} className="animate-spin text-sky-500" />
      正在加载模块...
    </div>
  </div>
);

type MobileDashboardMode = 'overview' | 'search';

const EMPTY_MOBILE_SEARCH_BUILDINGS: Building[] = [];
const EMPTY_MOBILE_SEARCH_TENANTS: Tenant[] = [];
const EMPTY_MOBILE_SEARCH_PAYMENTS: PaymentRecord[] = [];
const EMPTY_MOBILE_SEARCH_BILLING: BillingDetail[] = [];
const createUnavailableTenantHistoricalArrears = (unavailableReason: string): TenantHistoricalArrearsResult => ({
    available: false,
    byTenantId: new Map(),
    unavailableReason,
});
const canCurrentUserSeeHistoricalArrearsDetail = (
    detail: BillingDetail,
    user: AuthUser | null,
): boolean => {
    const permissions = normalizeReceivablePermissions(user?.receivablePermissions, user?.role);
    const feeKind = String(detail.feeKind || 'rent');
    if (feeKind === 'management_fee') return permissions.includes('mgmt_fee_receivable');
    return permissions.includes('rent_receivable');
};
const MOBILE_PARK_SNAPSHOT_CACHE_MS = 60_000;
const MOBILE_NAV_MEDIA_QUERY = '(max-width: 1023px)';

type MobileParkKpi = {
    projectId: string;
    parkName: string;
    revenueGoal: number;
    revenueCollected: number;
    revenueProgress: number;
    occupancyRate: number;
    occupancyTarget: number;
    totalArea: number;
    leasedArea: number;
    vacantArea: number;
    accumulatedArrears: number;
    tenantCount: number;
    source: 'current' | 'snapshot' | 'computed' | 'empty';
};

const EMPTY_MOBILE_PARK_KPIS: MobileParkKpi[] = [];

type MobileParkKpiSnapshotEntry = {
    summary: KpiSnapshotSummary;
    dataVersion?: number;
    year: number;
    source: 'snapshot' | 'computed';
    loadedAt?: number;
};

const isParkManagerRole = (role?: UserRole) =>
    role === 'platform_admin' || role === 'group_admin' || role === 'park_admin';

const MobileFocusCell: React.FC<{
    label: string;
    value: string;
    helper: string;
    tone: 'blue' | 'cyan' | 'amber' | 'rose';
}> = ({ label, value, helper, tone }) => {
    const toneClass = {
        blue: 'liquid-mobile-chip-blue',
        cyan: 'liquid-mobile-chip-cyan',
        amber: 'liquid-mobile-chip-amber',
        rose: 'liquid-mobile-chip-rose',
    }[tone];
    const fullLabel = `${label} ${value}，${helper}`;
    return (
        <div
            className="liquid-mobile-focus-cell mobile-card-enter min-w-0 rounded-[18px] border px-3 py-3"
            role="group"
            aria-label={fullLabel}
            title={fullLabel}
        >
            <div className="text-xs font-black text-slate-600">{label}</div>
            <div
                className="mt-1 truncate text-xl font-black tabular-nums tracking-normal text-slate-950"
                title={value}
            >
                {value}
            </div>
            <div
                className={`mt-1 inline-flex max-w-full rounded-full border px-2 py-0.5 text-xs font-black ${toneClass}`}
                title={helper}
            >
                <span className="truncate">{helper}</span>
            </div>
        </div>
    );
};

const MobileActionButton: React.FC<{
    icon: React.ReactNode;
    label: string;
    helper: string;
    tone: 'blue' | 'cyan' | 'amber' | 'slate';
    onClick: () => void;
}> = ({ icon, label, helper, tone, onClick }) => {
    const toneClass = {
        blue: 'liquid-mobile-action-blue',
        cyan: 'liquid-mobile-action-cyan',
        amber: 'liquid-mobile-action-amber',
        slate: 'liquid-mobile-action-slate',
    }[tone];
    const actionLabel = `${label}，${helper}`;
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label={actionLabel}
            title={actionLabel}
            className={`liquid-mobile-action mobile-pressable min-h-11 min-w-0 rounded-xl px-3 py-2.5 text-left ${toneClass}`}
        >
            <span className="flex items-center gap-1.5 text-sm font-black">
                {icon}
                <span className="truncate" title={label}>{label}</span>
            </span>
            <span className="liquid-mobile-action-helper mt-0.5 block truncate text-xs font-bold" title={helper}>{helper}</span>
        </button>
    );
};

const MobileTodoCard: React.FC<{
    icon: React.ReactNode;
    title: string;
    metric: string;
    helper: string;
    actionLabel: string;
    tone: 'blue' | 'cyan' | 'amber' | 'rose';
    onClick: () => void;
}> = ({ icon, title, metric, helper, actionLabel, tone, onClick }) => {
    const todoLabel = `${title}，${metric}，${helper}，${actionLabel}`;
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label={todoLabel}
            title={todoLabel}
            className={`liquid-mobile-task-card liquid-mobile-task-card--${tone} mobile-card-enter mobile-pressable flex min-h-[76px] w-full items-center gap-3 rounded-[22px] p-3 text-left transition`}
        >
            <span className="liquid-mobile-task-icon flex h-11 w-11 shrink-0 items-center justify-center rounded-[18px]">
                {icon}
            </span>
            <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-black text-slate-950" title={title}>{title}</span>
                    <span className="shrink-0 text-base font-black tabular-nums text-slate-950" title={metric}>{metric}</span>
                </span>
                <span className="mt-0.5 block truncate text-xs font-semibold text-slate-500" title={helper}>{helper}</span>
            </span>
            <span className="liquid-mobile-task-action shrink-0 rounded-full px-2.5 py-1 text-xs font-black">
                {actionLabel}
            </span>
        </button>
    );
};

type CustomFieldSyncState = 'local' | 'loading' | 'saving' | 'synced' | 'fallback';

const customFieldSyncCopy: Record<CustomFieldSyncState, { label: string; tone: 'blue' | 'cyan' | 'amber' | 'slate' }> = {
    local: { label: '本机偏好', tone: 'slate' },
    loading: { label: '读取账号偏好', tone: 'blue' },
    saving: { label: '同步中', tone: 'blue' },
    synced: { label: '已同步到账号', tone: 'cyan' },
    fallback: { label: '本机已保存', tone: 'amber' },
};

const useDashboardCustomFieldSelection = (authUser?: AuthUser | null) => {
    const customFieldStorageKey = React.useMemo(
        () => buildDashboardCustomFieldStorageKey(authUser),
        [authUser?.id, authUser?.email, authUser?.name],
    );
    const [customFieldIds, setCustomFieldIds] = React.useState<DashboardCustomFieldId[]>(() =>
        readDashboardCustomFieldIds(customFieldStorageKey)
    );
    const [syncState, setSyncState] = React.useState<CustomFieldSyncState>(() =>
        authUser?.enabled ? 'loading' : 'local'
    );
    const cloudLoadSeqRef = React.useRef(0);
    const localWriteSeqRef = React.useRef(0);

    React.useEffect(() => {
        const localFieldIds = readDashboardCustomFieldIds(customFieldStorageKey);
        setCustomFieldIds(localFieldIds);
        const loadSeq = ++cloudLoadSeqRef.current;
        const writeSeqAtStart = localWriteSeqRef.current;

        if (!authUser?.enabled) {
            setSyncState('local');
            return;
        }
        setSyncState('loading');

        let cancelled = false;
        void fetchCloudDashboardCustomFieldIds().then((result) => {
            if (
                cancelled ||
                loadSeq !== cloudLoadSeqRef.current ||
                writeSeqAtStart !== localWriteSeqRef.current
            ) {
                return;
            }
            if (!result.success) {
                setSyncState('fallback');
                return;
            }
            if (result.found !== true || !result.fieldIds) {
                setSyncState('local');
                return;
            }
            setCustomFieldIds(result.fieldIds);
            writeDashboardCustomFieldIds(customFieldStorageKey, result.fieldIds);
            setSyncState('synced');
        });

        return () => {
            cancelled = true;
        };
    }, [authUser?.enabled, customFieldStorageKey]);

    const saveCustomFieldIds = React.useCallback((fieldIds: DashboardCustomFieldId[]) => {
        const normalized = normalizeDashboardCustomFieldIds(fieldIds);
        localWriteSeqRef.current += 1;
        const writeSeq = localWriteSeqRef.current;
        setCustomFieldIds(normalized);
        writeDashboardCustomFieldIds(customFieldStorageKey, normalized);
        if (authUser?.enabled) {
            setSyncState('saving');
            void writeCloudDashboardCustomFieldIds(normalized).then((result) => {
                if (writeSeq !== localWriteSeqRef.current) return;
                setSyncState(result.success ? 'synced' : 'fallback');
            });
        } else {
            setSyncState('local');
        }
        return normalized;
    }, [authUser?.enabled, customFieldStorageKey]);

    return { customFieldIds, saveCustomFieldIds, customFieldSync: customFieldSyncCopy[syncState] };
};

const MobileDashboardFocus: React.FC<{
    data: DashboardData;
    selectedYear: number;
    projectId?: string;
    parkName: string;
    isCloudConnected: boolean;
    isSyncing: boolean;
    lastSaved: string;
    mode: MobileDashboardMode;
    isManagerView: boolean;
    isGlobalAdminView?: boolean;
    authUser?: AuthUser | null;
    managerKpi?: MobileParkKpi;
    isLoadingManagerKpis?: boolean;
    searchQuery: string;
    searchFilter: MobileSearchFilter;
    searchBuildingFilter: string;
    searchExpiryMonthFilter: string;
    searchPaymentFilter: MobileTenantSearchPaymentFilter;
    searchReceivableFilter: MobileTenantSearchReceivableFilter;
    searchArrearsFilter: MobileTenantSearchArrearsFilter;
    searchArrearsAvailable: boolean;
    searchArrearsUnavailableReason?: string;
    searchAdvancedActiveCount: number;
    searchBuildingOptions: MobileSearchBuildingOption[];
    searchExpiryMonthOptions: MobileSearchExpiryMonthOption[];
    searchResults: MobileTenantSearchResult[];
    searchResultCount: number;
    canCollapseSearchResults: boolean;
    onLoadMoreSearchResults: () => void;
    onCollapseSearchResults: () => void;
    onSearchQueryChange: (value: string) => void;
    onSearchFilterChange: (value: MobileSearchFilter) => void;
    onSearchBuildingFilterChange: (value: string) => void;
    onSearchExpiryMonthFilterChange: (value: string) => void;
    onSearchPaymentFilterChange: (value: MobileTenantSearchPaymentFilter) => void;
    onSearchReceivableFilterChange: (value: MobileTenantSearchReceivableFilter) => void;
    onSearchArrearsFilterChange: (value: MobileTenantSearchArrearsFilter) => void;
    onClearSearchFilters: () => void;
    onYearChange: (year: number) => void;
    onGoContracts: (item?: MobileTenantSearchResult) => void;
    onGoFinance: (item?: MobileTenantSearchResult) => void;
    onGoSearch: () => void;
    onBackToOverview: () => void;
}> = ({
    data,
    selectedYear,
    projectId,
    parkName,
    isCloudConnected,
    isSyncing,
    lastSaved,
    mode,
    isManagerView,
    isGlobalAdminView = false,
    authUser = null,
    managerKpi,
    isLoadingManagerKpis = false,
    searchQuery,
    searchFilter,
    searchBuildingFilter,
    searchExpiryMonthFilter,
    searchPaymentFilter,
    searchReceivableFilter,
    searchArrearsFilter,
    searchArrearsAvailable,
    searchArrearsUnavailableReason,
    searchAdvancedActiveCount,
    searchBuildingOptions,
    searchExpiryMonthOptions,
    searchResults,
    searchResultCount,
    canCollapseSearchResults,
    onLoadMoreSearchResults,
    onCollapseSearchResults,
    onSearchQueryChange,
    onSearchFilterChange,
    onSearchBuildingFilterChange,
    onSearchExpiryMonthFilterChange,
    onSearchPaymentFilterChange,
    onSearchReceivableFilterChange,
    onSearchArrearsFilterChange,
    onClearSearchFilters,
    onYearChange,
    onGoContracts,
    onGoFinance,
    onGoSearch,
    onBackToOverview,
}) => {
    const fallbackRevenueGoal =
        resolveAnnualInitialBudget(data.yearlyTargets, data.initializationData, selectedYear, projectId) ||
        data.annualRevenueTarget ||
        data.monthlyRevenueTarget ||
        0;
    const fallbackRevenueCollected = data.annualRevenueCollected || 0;
    const fallbackRevenueProgress =
        fallbackRevenueGoal > 0 ? (fallbackRevenueCollected / fallbackRevenueGoal) * 100 : data.collectionRate || 0;
    const activeContractCount = (data.tenants || []).filter((tenant) => tenant.status === ContractStatus.Active).length;
    const fallbackKpi: MobileParkKpi = {
        projectId: projectId || '',
        parkName: parkName || projectId || '当前园区',
        revenueGoal: fallbackRevenueGoal,
        revenueCollected: fallbackRevenueCollected,
        revenueProgress: fallbackRevenueProgress,
        occupancyRate: data.occupancyRate || 0,
        occupancyTarget: data.annualOccupancyTarget || 0,
        totalArea: data.totalArea || 0,
        leasedArea: data.leasedArea || 0,
        vacantArea: data.vacantArea || Math.max(0, (data.totalArea || 0) - (data.leasedArea || 0)),
        accumulatedArrears: data.accumulatedArrears || 0,
        tenantCount: activeContractCount,
        source: 'current',
    };
    const displayKpi = managerKpi || fallbackKpi;
    const kpiUnavailable = displayKpi.source === 'empty';
    const revenueGoal = displayKpi.revenueGoal || 0;
    const revenueCollected = displayKpi.revenueCollected || 0;
    const revenueProgress =
        displayKpi.revenueProgress || (revenueGoal > 0 ? (revenueCollected / revenueGoal) * 100 : 0);
    const progressWidth = kpiUnavailable ? '0%' : `${Math.max(0, Math.min(100, revenueProgress))}%`;
    const occupancyGap = (displayKpi.occupancyTarget || 0) - (displayKpi.occupancyRate || 0);
    const arrears = displayKpi.accumulatedArrears || 0;
    const arrearsTone = arrears > 100000 ? 'rose' : arrears > 0 ? 'amber' : 'cyan';
    const expiringCount = data.expiringSoon?.length || 0;
    const signingCount = data.recentSignings?.length || 0;
    const leasedArea = displayKpi.leasedArea || Math.max(0, (displayKpi.totalArea || 0) - (displayKpi.vacantArea || 0));
    const remainingRevenue = Math.max(0, revenueGoal - revenueCollected);
    const collectionGap = Math.max(0, 100 - revenueProgress);
    const mobileRemainingRevenueLabel = kpiUnavailable ? '--' : formatWan(remainingRevenue, 0);
    const mobileLeasedAreaLabel = kpiUnavailable ? '--' : formatArea(leasedArea);
    const mobileOccupancyTargetLabel = kpiUnavailable ? '--' : formatPercent(displayKpi.occupancyTarget || 0, 0);
    const resolvedTenantCount = displayKpi.tenantCount || activeContractCount || 0;
    const tenantCountValue = resolvedTenantCount > 0 ? `${resolvedTenantCount} 家` : '待同步';
    const tenantCountHelper = resolvedTenantCount > 0
        ? displayKpi.source === 'current'
            ? `近期签约 ${signingCount} 家`
            : '在租客户'
        : '客户明细同步中';
    const today = new Date();
    const currentMonthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    const pendingReceivableRows = (data.currentMonthBilling || []).filter(
        (item) => Math.max(0, (item.amountDue || 0) - (item.amountPaid || 0)) > 0.005
    );
    const pendingReceivableAmount = pendingReceivableRows.reduce(
        (sum, item) => sum + Math.max(0, (item.amountDue || 0) - (item.amountPaid || 0)),
        0
    );
    const pendingInvoiceRows = (data.invoices || []).filter(
        (invoice) => invoice.status === 'Pending' && (invoice.targetInvoiceDate || '').startsWith(currentMonthKey)
    );
    const pendingInvoiceAmount = pendingInvoiceRows.reduce((sum, invoice) => sum + (invoice.amount || 0), 0);
    const nextExpiringTenant = [...(data.expiringSoon || [])].sort((a, b) =>
        String(a.leaseEnd || '').localeCompare(String(b.leaseEnd || ''))
    )[0];
    const todoScopeLabel = displayKpi.parkName || parkName || '当前园区';
    const mobileTodoItems = [
        arrears > 0
            ? {
                key: 'arrears',
                icon: <AlertCircle size={18} />,
                title: '欠款跟进',
                metric: formatWan(arrears, 0),
                helper: '累计欠款需回收',
                actionLabel: isManagerView ? '查询' : '核销',
                tone: arrearsTone === 'rose' ? 'rose' as const : 'amber' as const,
                onClick: isManagerView ? onGoSearch : onGoFinance,
            }
            : null,
        pendingReceivableAmount > 0
            ? {
                key: 'receivable',
                icon: <CheckCircle2 size={18} />,
                title: '待核销收款',
                metric: `${pendingReceivableRows.length} 笔`,
                helper: `待收 ${formatWan(pendingReceivableAmount, 1)}`,
                actionLabel: isManagerView ? '查询' : '核销',
                tone: 'amber' as const,
                onClick: isManagerView ? onGoSearch : onGoFinance,
            }
            : null,
        pendingInvoiceRows.length > 0
            ? {
                key: 'invoice',
                icon: <FileText size={18} />,
                title: '本月开票风险',
                metric: `${pendingInvoiceRows.length} 笔`,
                helper: `待开 ${formatWan(pendingInvoiceAmount, 1)}`,
                actionLabel: '跟进',
                tone: 'rose' as const,
                onClick: onGoSearch,
            }
            : null,
        expiringCount > 0
            ? {
                key: 'expiring',
                icon: <Calendar size={18} />,
                title: '合同到期',
                metric: `${expiringCount} 家`,
                helper: nextExpiringTenant?.leaseEnd ? `${nextExpiringTenant.name} · ${nextExpiringTenant.leaseEnd}` : '需安排续签沟通',
                actionLabel: '合同',
                tone: 'amber' as const,
                onClick: onGoContracts,
            }
            : null,
    ].filter(Boolean).slice(0, 3) as Array<{
        key: string;
        icon: React.ReactNode;
        title: string;
        metric: string;
        helper: string;
        actionLabel: string;
        tone: 'blue' | 'cyan' | 'amber' | 'rose';
        onClick: () => void;
    }>;
    const mobileTodoSection = (
        <div className="liquid-mobile-readable liquid-mobile-dashboard-section border-t border-white/70 p-2.5">
            <div className="mb-2 flex items-center justify-between gap-2 px-0.5">
                <div className="min-w-0">
                    <div className="text-xs font-black text-blue-700">今日待办</div>
                    <div className="mt-0.5 truncate text-xs font-semibold text-slate-500">{todoScopeLabel}</div>
                </div>
                <span className="liquid-mobile-chip-blue shrink-0 rounded-full px-2.5 py-1 text-xs font-black">
                    {mobileTodoItems.length > 0 ? `${mobileTodoItems.length} 项` : '稳定'}
                </span>
            </div>
            {mobileTodoItems.length > 0 ? (
                <div className="grid gap-2">
                    {mobileTodoItems.map((item) => (
                        <MobileTodoCard
                            key={item.key}
                            icon={item.icon}
                            title={item.title}
                            metric={item.metric}
                            helper={item.helper}
                            actionLabel={item.actionLabel}
                            tone={item.tone}
                            onClick={item.onClick}
                        />
                    ))}
                </div>
            ) : (
                <div className="liquid-mobile-task-empty mobile-card-enter rounded-[22px] px-3.5 py-3">
                    <div className="flex items-center gap-3">
                        <span className="liquid-mobile-task-icon flex h-10 w-10 items-center justify-center rounded-[16px] text-cyan-700">
                            <CheckCircle2 size={18} />
                        </span>
                        <div className="min-w-0">
                            <div className="text-sm font-black text-slate-950">暂无急办事项</div>
                            <div className="mt-0.5 truncate text-xs font-semibold text-slate-500">欠款、到期与开票风险处于稳定状态</div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
    const [isMonthlyDetailOpen, setMonthlyDetailOpen] = React.useState(false);
    const [customFieldSettingsOpen, setCustomFieldSettingsOpen] = React.useState(false);
    const { customFieldIds, saveCustomFieldIds, customFieldSync } = useDashboardCustomFieldSelection(authUser);

    const handleSaveCustomFields = (fieldIds: DashboardCustomFieldId[]) => {
        saveCustomFieldIds(fieldIds);
        setCustomFieldSettingsOpen(false);
    };
    if (mode === 'search') {
        return (
            <Suspense fallback={(
                <section className="liquid-mobile-card mobile-card-enter lg:hidden rounded-[24px] px-4 py-8 text-center text-sm font-black text-slate-500">
                    正在加载客户查询...
                </section>
            )}>
                <MobileTenantSearchPanel
                    projectId={projectId}
                    parkName={parkName}
                    isManagerView={isManagerView}
                    searchQuery={searchQuery}
                    searchFilter={searchFilter}
                    searchBuildingFilter={searchBuildingFilter}
                    searchExpiryMonthFilter={searchExpiryMonthFilter}
                    searchPaymentFilter={searchPaymentFilter}
                    searchReceivableFilter={searchReceivableFilter}
                    searchArrearsFilter={searchArrearsFilter}
                    searchArrearsAvailable={searchArrearsAvailable}
                    searchArrearsUnavailableReason={searchArrearsUnavailableReason}
                    searchAdvancedActiveCount={searchAdvancedActiveCount}
                    searchBuildingOptions={searchBuildingOptions}
                    searchExpiryMonthOptions={searchExpiryMonthOptions}
                    searchResults={searchResults}
                    searchResultCount={searchResultCount}
                    canCollapseSearchResults={canCollapseSearchResults}
                    onLoadMoreSearchResults={onLoadMoreSearchResults}
                    onCollapseSearchResults={onCollapseSearchResults}
                    onSearchQueryChange={onSearchQueryChange}
                    onSearchFilterChange={onSearchFilterChange}
                    onSearchBuildingFilterChange={onSearchBuildingFilterChange}
                    onSearchExpiryMonthFilterChange={onSearchExpiryMonthFilterChange}
                    onSearchPaymentFilterChange={onSearchPaymentFilterChange}
                    onSearchReceivableFilterChange={onSearchReceivableFilterChange}
                    onSearchArrearsFilterChange={onSearchArrearsFilterChange}
                    onClearSearchFilters={onClearSearchFilters}
                    onGoContracts={onGoContracts}
                    onGoFinance={onGoFinance}
                    onBackToOverview={onBackToOverview}
                />
            </Suspense>
        );
    }

    if (!isManagerView) {
        return (
            <section className="liquid-mobile-card liquid-mobile-dashboard-shell mobile-card-enter lg:hidden overflow-hidden rounded-[24px]">
                <div className="liquid-mobile-hero liquid-mobile-dashboard-hero px-3.5 py-3">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <div className="truncate text-sm font-black text-slate-950">今日工作台</div>
                            <div className="mt-0.5 truncate text-xs font-bold text-slate-500">
                                {parkName || projectId || '当前园区'} · {isSyncing ? '同步中' : lastSaved ? `缓存 ${lastSaved}` : '数据就绪'}
                            </div>
                        </div>
                        <span
                            className={`liquid-mobile-control liquid-mobile-status-pill inline-flex min-h-8 shrink-0 items-center rounded-full px-3 py-1 text-xs font-black ${
                                isCloudConnected
                                    ? 'text-blue-700'
                                    : 'text-slate-600'
                            }`}
                        >
                            {isCloudConnected ? '在线' : '本地'}
                        </span>
                    </div>
                    <div className="mt-2.5 grid grid-cols-3 gap-2">
                        <MobileActionButton icon={<CheckCircle2 size={15} />} label="核销" helper="收款入账" tone="cyan" onClick={onGoFinance} />
                        <MobileActionButton icon={<FileText size={15} />} label="合同" helper="录入续签" tone="blue" onClick={onGoContracts} />
                        <MobileActionButton icon={<Search size={15} />} label="查询" helper="客户账款" tone="amber" onClick={onGoSearch} />
                    </div>
                </div>
		                <div className="liquid-mobile-focus-grid grid grid-cols-3 gap-1.5 p-2">
	                    <MobileFocusCell label="待跟进" value={formatWan(arrears, 0)} helper="欠款核销" tone={arrearsTone} />
	                    <MobileFocusCell label="在租合同" value={`${activeContractCount} 份`} helper="可录入变更" tone="blue" />
	                    <MobileFocusCell label="到期预警" value={`${expiringCount} 家`} helper={`新签 ${signingCount} 家`} tone={expiringCount > 0 ? 'amber' : 'cyan'} />
	                </div>
	                {mobileTodoSection}
	            </section>
	        );
	    }

    return (
        <>
        <section className="liquid-mobile-card liquid-mobile-dashboard-shell mobile-card-enter lg:hidden overflow-hidden rounded-[24px]">
            <div className="liquid-mobile-hero liquid-mobile-dashboard-hero px-3.5 py-3">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <div className="truncate text-sm font-black text-slate-950">{displayKpi.parkName || parkName || projectId || '当前园区'}</div>
                        <div className="mt-0.5 text-xs font-bold text-slate-500">
                            {kpiUnavailable
                                ? (isLoadingManagerKpis ? '正在同步快照' : '部分园区数据未就绪')
                                : isSyncing ? '正在同步数据' : lastSaved ? `本地缓存 ${lastSaved}` : '数据已就绪'}
                        </div>
                    </div>
                    <span
                            className={`liquid-mobile-control liquid-mobile-status-pill inline-flex min-h-8 shrink-0 items-center rounded-full px-3 py-1 text-xs font-black ${
                            isCloudConnected
                                ? 'text-blue-700'
                                : 'text-slate-600'
                        }`}
                    >
                        {isCloudConnected ? '后端在线' : '本地模式'}
                    </span>
                </div>

                <div className="mt-2.5 flex items-end justify-between gap-3">
                    <button
                        type="button"
                        onClick={() => setMonthlyDetailOpen(true)}
                        className="liquid-mobile-primary-metric mobile-pressable min-h-[96px] min-w-0 rounded-2xl px-3 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60"
                    >
                        <div className="liquid-mobile-primary-label text-xs font-black">年度收款达成</div>
                        <div className="mt-1 flex items-baseline gap-2">
                            <span className={`liquid-mobile-primary-value ${kpiUnavailable ? 'text-2xl' : 'text-[36px]'} font-black leading-none tabular-nums tracking-normal`}>
                                {kpiUnavailable ? '同步中' : formatPercent(revenueProgress, 0)}
                            </span>
                            {!kpiUnavailable && <span className="liquid-mobile-primary-badge rounded-full px-2.5 py-1 text-xs font-black">
                                缺口 {formatPercent(collectionGap, 0)}
                            </span>}
                        </div>
                        <div className="liquid-mobile-primary-helper mt-1.5 text-xs font-bold">点开月度明细</div>
                    </button>
                    <div className="flex shrink-0 flex-col items-end">
                        <div className="liquid-mobile-year-control flex items-center rounded-full p-0.5">
                            <button
                                type="button"
                                onClick={() => onYearChange(selectedYear - 1)}
                                className="liquid-mobile-year-step mobile-pressable flex h-11 w-11 items-center justify-center rounded-full text-blue-700"
                                aria-label="上一年"
                            >
                                <ChevronLeft size={13} />
                            </button>
                            <span className="px-2 text-sm font-black tabular-nums text-slate-950">{selectedYear}</span>
                            <button
                                type="button"
                                onClick={() => onYearChange(selectedYear + 1)}
                                className="liquid-mobile-year-step mobile-pressable flex h-11 w-11 items-center justify-center rounded-full text-blue-700"
                                aria-label="下一年"
                            >
                                <ChevronRight size={13} />
                            </button>
                        </div>
                    </div>
                </div>

                <div className="liquid-mobile-progress-track mt-2.5 h-1.5 overflow-hidden rounded-full">
                    <div className="liquid-mobile-progress-fill h-full rounded-full transition-all duration-700" style={{ width: progressWidth }} />
                </div>
                <div className="mt-1.5 flex items-center justify-between gap-2 text-xs font-bold text-slate-600">
                    <span className="truncate">已收 {kpiUnavailable ? '读取中' : formatWan(revenueCollected, 0)}</span>
                    <span className="shrink-0">目标 {kpiUnavailable ? '读取中' : revenueGoal > 0 ? formatWan(revenueGoal, 0) : '未设定'}</span>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-1.5">
                    <div className="liquid-mobile-micro-card rounded-xl px-2.5 py-2">
                        <div className="text-xs font-bold text-slate-500">收款缺口</div>
                        <div
                            className="mt-0.5 truncate text-sm font-black tabular-nums text-slate-950"
                            title={mobileRemainingRevenueLabel}
                            aria-label={`收款缺口 ${mobileRemainingRevenueLabel}`}
                        >
                            {mobileRemainingRevenueLabel}
                        </div>
                    </div>
                    <div className="liquid-mobile-micro-card rounded-xl px-2.5 py-2">
                        <div className="text-xs font-bold text-slate-500">已租面积</div>
                        <div
                            className="mt-0.5 truncate text-sm font-black tabular-nums text-slate-950"
                            title={mobileLeasedAreaLabel}
                            aria-label={`已租面积 ${mobileLeasedAreaLabel}`}
                        >
                            {mobileLeasedAreaLabel}
                        </div>
                    </div>
                    <div className="liquid-mobile-micro-card rounded-xl px-2.5 py-2">
                        <div className="text-xs font-bold text-slate-500">出租目标</div>
                        <div
                            className="mt-0.5 truncate text-sm font-black tabular-nums text-slate-950"
                            title={mobileOccupancyTargetLabel}
                            aria-label={`出租目标 ${mobileOccupancyTargetLabel}`}
                        >
                            {mobileOccupancyTargetLabel}
                        </div>
                    </div>
                </div>
            </div>

	            <div className="liquid-mobile-focus-grid grid grid-cols-3 gap-1.5 p-2">
                <MobileFocusCell
                    label="出租率"
                    value={kpiUnavailable ? '--' : formatPercent(displayKpi.occupancyRate || 0, 0)}
                    helper={kpiUnavailable ? '读取中' : occupancyGap > 0 ? `距目标 ${formatPercent(occupancyGap, 0)}` : '已达目标'}
                    tone={kpiUnavailable ? 'blue' : occupancyGap > 0 ? 'amber' : 'cyan'}
                />
                <MobileFocusCell
                    label="累计欠款"
                    value={kpiUnavailable ? '--' : formatWan(arrears, 0)}
                    helper={kpiUnavailable ? '读取中' : arrears > 0 ? '需跟进核销' : '账款健康'}
                    tone={kpiUnavailable ? 'blue' : arrearsTone}
                />
	                <MobileFocusCell
	                    label="客户数"
	                    value={kpiUnavailable ? '--' : tenantCountValue}
	                    helper={kpiUnavailable ? '读取中' : tenantCountHelper}
	                    tone={kpiUnavailable ? 'blue' : expiringCount > 0 && displayKpi.source === 'current' ? 'amber' : 'cyan'}
	                />
	            </div>
	            {mobileTodoSection}
            <DashboardCustomFields
                compact
                data={data}
                selectedYear={selectedYear}
                projectId={projectId}
                selectedFieldIds={customFieldIds}
                settingsOpen={customFieldSettingsOpen}
                syncLabel={customFieldSync.label}
                syncTone={customFieldSync.tone}
                onConfigure={() => setCustomFieldSettingsOpen(true)}
            />
        </section>
        <MonthlyCollectionDetail
            open={isMonthlyDetailOpen}
            onClose={() => setMonthlyDetailOpen(false)}
            data={data}
            selectedYear={selectedYear}
            projectId={projectId}
        />
        <DashboardCustomFieldSettings
            open={customFieldSettingsOpen}
            selectedFieldIds={customFieldIds}
            onClose={() => setCustomFieldSettingsOpen(false)}
            onSave={handleSaveCustomFields}
        />
        </>
    );
};

const waitForNextPaint = () =>
  new Promise<void>((resolve) => {
    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
      setTimeout(resolve, 0);
      return;
    }
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
  });

/** 与侧栏 `lg:` 断点一致：窄屏切换为底部导航和移动操作台 */
function useMobileNavLayout(): boolean {
  const [narrow, setNarrow] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(MOBILE_NAV_MEDIA_QUERY).matches : false
  );
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_NAV_MEDIA_QUERY);
    const sync = () => setNarrow(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  return narrow;
}

const buildMobileParkKpiFromSummary = (
    projectId: string,
    parkName: string,
    summary: Partial<KpiSnapshotSummary> | undefined,
    source: MobileParkKpi['source']
): MobileParkKpi => {
    const revenueGoal =
        summary?.annualInitialBudget ||
        summary?.annualRevenueTarget ||
        summary?.annualBudgetTarget ||
        summary?.annualContractReceivable ||
        0;
    const revenueCollected = summary?.annualRevenueCollected || 0;
    const totalArea = summary?.totalArea || 0;
    const leasedArea = summary?.leasedArea || Math.max(0, totalArea - (summary?.vacantArea || 0));
    const vacantArea = summary?.vacantArea ?? Math.max(0, totalArea - leasedArea);
    const revenueProgress =
        revenueGoal > 0
            ? (revenueCollected / revenueGoal) * 100
            : summary?.annualGoalCompletion || summary?.annualBudgetCompletion || 0;

    return {
        projectId,
        parkName,
        revenueGoal,
        revenueCollected,
        revenueProgress,
        occupancyRate: summary?.occupancyRate || (totalArea > 0 ? (leasedArea / totalArea) * 100 : 0),
        occupancyTarget: summary?.annualOccupancyTarget || 0,
        totalArea,
        leasedArea,
        vacantArea,
        accumulatedArrears: summary?.accumulatedArrears || 0,
        tenantCount: summary?.tenantCount || 0,
        source,
    };
};

const buildMobileParkKpiFromDashboard = (
    data: DashboardData,
    selectedYear: number,
    projectId: string,
    parkName: string
): MobileParkKpi => {
    const revenueGoal =
        resolveAnnualInitialBudget(data.yearlyTargets, data.initializationData, selectedYear, projectId) ||
        data.annualRevenueTarget ||
        data.monthlyRevenueTarget ||
        0;
    const revenueCollected = data.annualRevenueCollected || 0;
    const totalArea = data.totalArea || 0;
    const leasedArea = data.leasedArea || 0;
    const vacantArea = data.vacantArea || Math.max(0, totalArea - leasedArea);
    const tenantCount = (data.tenants || []).filter((tenant) => tenant.status === ContractStatus.Active).length;

    return {
        projectId,
        parkName,
        revenueGoal,
        revenueCollected,
        revenueProgress: revenueGoal > 0 ? (revenueCollected / revenueGoal) * 100 : data.collectionRate || 0,
        occupancyRate: data.occupancyRate || 0,
        occupancyTarget: data.annualOccupancyTarget || 0,
        totalArea,
        leasedArea,
        vacantArea,
        accumulatedArrears: data.accumulatedArrears || 0,
        tenantCount,
        source: 'current',
    };
};

type MonthlyCollectionRow = {
    month: number;
    monthName: string;
    initialBudget: number;
    contractReceivable: number;
    actual: number | null;
    prevActual: number;
    yoy: number | null;
    completionRate: number | null;
    cumulativeRate: number | null;
};

type MonthlyCollectionSummary = {
    rows: MonthlyCollectionRow[];
    totalInitialBudget: number;
    totalContractReceivable: number;
    totalActual: number;
    totalPrevActual: number;
    totalCompletionRate: number | null;
    totalCumulativeRate: number | null;
};

const buildMonthlyCollectionSummary = (
    data: DashboardData,
    selectedYear: number,
    projectId?: string
): MonthlyCollectionSummary => {
    const initRows = data.initializationData || [];
    const trends = data.monthlyTrends || [];
    const prevTrends = data.prevYearMonthlyTrends || [];
    const initialBudgets = Array.from({ length: 12 }, (_, index) => {
        const month = index + 1;
        const initRow = initRows.find((item) => item.year === selectedYear && item.month === month);
        return resolveInitMonthInitialBudget(initRow, projectId);
    });
    const totalInitialBudget =
        resolveAnnualInitialBudget(data.yearlyTargets, data.initializationData, selectedYear, projectId) ||
        initialBudgets.reduce((sum, value) => sum + value, 0);
    const totalContractReceivable = Array.from({ length: 12 }, (_, index) => {
        const trend = trends[index];
        return trend?.contractReceivable ?? trend?.revenueTarget ?? 0;
    }).reduce((sum, value) => sum + value, 0);
    const cumulativeDenominator = totalInitialBudget > 0 ? totalInitialBudget : totalContractReceivable;
    let cumulativeActual = 0;
    let actualMonthGoal = 0;

    const rows = Array.from({ length: 12 }, (_, index): MonthlyCollectionRow => {
        const month = index + 1;
        const trend = trends[index];
        const prevTrend = prevTrends[index];
        const initialBudget = initialBudgets[index] || 0;
        const contractReceivable = trend?.contractReceivable ?? trend?.revenueTarget ?? 0;
        const actual = trend?.revenueCollected ?? null;
        const prevActual = prevTrend?.revenueCollected ?? 0;
        const monthGoal = initialBudget > 0 ? initialBudget : contractReceivable;

        if (actual != null) {
            cumulativeActual += actual;
            actualMonthGoal += monthGoal;
        }

        return {
            month,
            monthName: trend?.month || `${month}月`,
            initialBudget,
            contractReceivable,
            actual,
            prevActual,
            yoy: actual != null && prevActual > 0 ? ((actual - prevActual) / prevActual) * 100 : null,
            completionRate: actual != null && monthGoal > 0 ? (actual / monthGoal) * 100 : null,
            cumulativeRate: actual != null && cumulativeDenominator > 0 ? (cumulativeActual / cumulativeDenominator) * 100 : null,
        };
    });

    const totalActual = rows.reduce((sum, row) => sum + (row.actual ?? 0), 0);
    const totalPrevActual = rows.reduce((sum, row) => sum + row.prevActual, 0);

    return {
        rows,
        totalInitialBudget,
        totalContractReceivable,
        totalActual,
        totalPrevActual,
        totalCompletionRate: actualMonthGoal > 0 ? (totalActual / actualMonthGoal) * 100 : null,
        totalCumulativeRate: cumulativeDenominator > 0 ? (totalActual / cumulativeDenominator) * 100 : null,
    };
};

const collectionRateTone = (rate: number | null | undefined): string => {
    if (rate == null) return 'bg-transparent text-slate-500';
    if (rate >= 100) return 'bg-sky-100/90 text-blue-700 ring-1 ring-sky-200/80';
    if (rate >= 80) return 'bg-blue-100/80 text-blue-700 ring-1 ring-blue-200/70';
    return 'bg-amber-100/80 text-amber-700 ring-1 ring-amber-200/70';
};

const MonthlyCollectionDetail: React.FC<{
    open: boolean;
    onClose: () => void;
    data: DashboardData;
    selectedYear: number;
    projectId?: string;
}> = ({ open, onClose, data, selectedYear, projectId }) => {
    const summary = useMemo(
        () => open ? buildMonthlyCollectionSummary(data, selectedYear, projectId) : null,
        [data, open, selectedYear, projectId]
    );
    const {
        triggerRef: monthlyDetailTriggerRef,
        initialFocusRef: monthlyDetailCloseButtonRef,
        sheetRef: monthlyDetailSheetRef,
    } = useMobileSheetFocus<HTMLElement, HTMLButtonElement, HTMLElement>({
        isOpen: open,
        onEscape: onClose,
    });

    useEffect(() => {
        if (!open) return;

        const activeElement = document.activeElement;
        if (activeElement instanceof HTMLElement && !monthlyDetailSheetRef.current?.contains(activeElement)) {
            monthlyDetailTriggerRef.current = activeElement;
        }
    }, [monthlyDetailSheetRef, monthlyDetailTriggerRef, open]);

    if (!open || !summary) return null;

    const monthlyDetailTotalActualLabel = summary.totalActual > 0 ? formatWan(summary.totalActual, 0) : '-';
    const monthlyDetailTotalCumulativeLabel = summary.totalCumulativeRate != null ? formatPercent(summary.totalCumulativeRate, 0) : '-';
    const monthlyDetailTotalInitialBudgetLabel = summary.totalInitialBudget > 0 ? formatWan(summary.totalInitialBudget, 0) : '-';
    const monthlyDetailTotalContractReceivableLabel = summary.totalContractReceivable > 0 ? formatWan(summary.totalContractReceivable, 0) : '-';
    const monthlyDetailTotalLabel = `合计，实际收款 ${monthlyDetailTotalActualLabel}，年度累计达成 ${monthlyDetailTotalCumulativeLabel}，年初预算 ${monthlyDetailTotalInitialBudgetLabel}，合同应收 ${monthlyDetailTotalContractReceivableLabel}`;

    return (
        <div className="monthly-detail-backdrop fixed inset-0 z-[70] flex items-end justify-center px-3 py-3 md:items-center md:py-6" onClick={onClose}>
            <section
                ref={monthlyDetailSheetRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="monthly-collection-detail-title"
                aria-describedby="monthly-collection-detail-description"
                onClick={(event) => event.stopPropagation()}
                className="monthly-detail-panel liquid-glass-panel flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-t-[28px] md:max-h-[88vh] md:rounded-[28px]"
            >
                <div className="flex flex-col gap-3 border-b border-slate-200/75 bg-white/82 px-4 py-4 md:flex-row md:items-center md:justify-between md:px-6">
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="liquid-action-strong inline-flex h-8 w-8 items-center justify-center rounded-full">
                                <Calendar size={17} />
                            </span>
                            <h3 id="monthly-collection-detail-title" className="text-xl font-black tracking-normal text-slate-950">
                                {selectedYear} 月度收款明细
                            </h3>
                            <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs font-black text-blue-700">
                                实时
                            </span>
                        </div>
                        <p id="monthly-collection-detail-description" className="mt-1 text-sm font-semibold text-slate-600">
                            年初预算、合同应收与实际收款按现有工作台口径汇总。
                        </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                        <div className="hidden rounded-[16px] border border-slate-200/80 bg-white/82 px-3 py-2 text-right text-xs shadow-sm md:block">
                            <div className="font-black text-slate-600">累计达成</div>
                            <div className="mt-0.5 text-lg font-black tabular-nums text-blue-700">
                                {summary.totalCumulativeRate != null ? formatPercent(summary.totalCumulativeRate, 0) : '-'}
                            </div>
                        </div>
                        <button
                            type="button"
                            ref={monthlyDetailCloseButtonRef}
                            onClick={onClose}
                            className="liquid-glass-control liquid-pressable inline-flex h-11 w-11 items-center justify-center rounded-full text-slate-700 transition hover:bg-white/80 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-200/80"
                            aria-label="关闭月度收款明细"
                        >
                            <X size={18} />
                        </button>
                    </div>
                </div>

                <div className="monthly-detail-mobile-list flex-1 space-y-2 overflow-auto p-3 lg:hidden">
                    {summary.rows.map((row) => {
                        const actualLabel = row.actual != null ? formatWan(row.actual, 0) : '-';
                        const contractReceivableLabel = row.contractReceivable > 0 ? formatWan(row.contractReceivable, 0) : '-';
                        const initialBudgetLabel = row.initialBudget > 0 ? formatWan(row.initialBudget, 0) : '-';
                        const prevActualLabel = row.prevActual > 0 ? formatWan(row.prevActual, 0) : '0万';
                        const completionRateLabel = row.completionRate != null ? formatPercent(row.completionRate, 0) : '-';
                        const cumulativeRateLabel = row.cumulativeRate != null ? formatPercent(row.cumulativeRate, 0) : '-';
                        const rowSummaryLabel = `${row.monthName}，完成率 ${completionRateLabel}，累计达成 ${cumulativeRateLabel}，实际收款 ${actualLabel}，合同应收 ${contractReceivableLabel}，年初预算 ${initialBudgetLabel}，去年同期 ${prevActualLabel}`;

                        return (
                            <div
                                key={row.month}
                                role="group"
                                aria-label={rowSummaryLabel}
                                title={rowSummaryLabel}
                                className="monthly-detail-mobile-card rounded-[20px] px-4 py-3"
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <div className="text-base font-black text-slate-950">{row.monthName}</div>
                                        <div className="mt-0.5 text-xs font-semibold text-slate-500">
                                            累计 {cumulativeRateLabel}
                                        </div>
                                    </div>
                                    <span
                                        className={`inline-flex min-w-[58px] justify-center rounded-full px-2.5 py-1 text-xs font-black ${collectionRateTone(row.completionRate)}`}
                                        title={`完成率 ${completionRateLabel}`}
                                    >
                                        {completionRateLabel}
                                    </span>
                                </div>
                                <div className="mt-3 grid grid-cols-2 gap-2">
                                    <div className="rounded-2xl bg-white/72 px-3 py-2">
                                        <div className="text-xs font-black text-slate-500">实际收款</div>
                                        <div className="mt-0.5 text-lg font-black tabular-nums text-slate-950" title={`实际收款 ${actualLabel}`}>
                                            {actualLabel}
                                        </div>
                                    </div>
                                    <div className="rounded-2xl bg-white/72 px-3 py-2">
                                        <div className="text-xs font-black text-slate-500">合同应收</div>
                                        <div className="mt-0.5 text-lg font-black tabular-nums text-blue-700" title={`合同应收 ${contractReceivableLabel}`}>
                                            {contractReceivableLabel}
                                        </div>
                                    </div>
                                    <div className="rounded-2xl bg-white/62 px-3 py-2">
                                        <div className="text-xs font-black text-slate-500">年初预算</div>
                                        <div className="mt-0.5 text-sm font-black tabular-nums text-amber-700" title={`年初预算 ${initialBudgetLabel}`}>
                                            {initialBudgetLabel}
                                        </div>
                                    </div>
                                    <div className="rounded-2xl bg-white/62 px-3 py-2">
                                        <div className="text-xs font-black text-slate-500">去年同期</div>
                                        <div className="mt-0.5 text-sm font-black tabular-nums text-slate-700" title={`去年同期 ${prevActualLabel}`}>
                                            {prevActualLabel}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                    <div
                        role="group"
                        aria-label={monthlyDetailTotalLabel}
                        title={monthlyDetailTotalLabel}
                        className="monthly-detail-mobile-total sticky bottom-0 rounded-[20px] px-4 py-3"
                    >
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <div className="text-sm font-black text-white">合计</div>
                                <div className="mt-0.5 text-xs font-semibold text-white/85">年度累计达成</div>
                            </div>
                            <div className="text-right">
                                <div className="text-xl font-black tabular-nums text-white">
                                    {monthlyDetailTotalActualLabel}
                                </div>
                                <div className="mt-0.5 text-xs font-black text-white/90">
                                    {monthlyDetailTotalCumulativeLabel}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="monthly-detail-table-shell hidden flex-1 overflow-auto lg:block">
                    <table className="w-full min-w-[840px] border-separate border-spacing-0 text-[15px]">
                        <thead>
                            <tr className="bg-white/88 text-xs font-black text-slate-700 shadow-[inset_0_-1px_0_rgba(148,163,184,0.24)]">
                                <th className="sticky left-0 z-10 bg-white/95 px-5 py-3.5 text-left backdrop-blur-xl">月份</th>
                                <th className="px-4 py-3.5 text-right text-amber-700">年初预算</th>
                                <th className="px-4 py-3.5 text-right text-blue-700">合同应收</th>
                                <th className="px-4 py-3.5 text-right text-blue-700">实际收款</th>
                                <th className="px-4 py-3.5 text-right text-slate-700">去年同期</th>
                                <th className="px-4 py-3.5 text-center text-slate-700">同比</th>
                                <th className="px-4 py-3.5 text-center text-slate-700">完成率</th>
                                <th className="px-5 py-3.5 text-right text-slate-700">累计达成</th>
                            </tr>
                        </thead>
                        <tbody>
                            {summary.rows.map((row) => (
                                <tr key={row.month} className="group">
                                    <td className="sticky left-0 z-10 border-t border-slate-200/75 bg-white/95 px-5 py-3.5 font-black text-slate-950 backdrop-blur-xl group-hover:bg-white">
                                        {row.monthName}
                                    </td>
                                    <td className="border-t border-slate-200/75 px-4 py-3.5 text-right font-semibold tabular-nums text-slate-700 group-hover:bg-blue-50/45">
                                        {row.initialBudget > 0 ? formatWan(row.initialBudget, 0) : '-'}
                                    </td>
                                    <td className="border-t border-slate-200/75 px-4 py-3.5 text-right font-semibold tabular-nums text-slate-800 group-hover:bg-blue-50/45">
                                        {row.contractReceivable > 0 ? formatWan(row.contractReceivable, 0) : '-'}
                                    </td>
                                    <td className="border-t border-slate-200/75 px-4 py-3.5 text-right font-black tabular-nums text-slate-950 group-hover:bg-blue-50/45">
                                        {row.actual != null ? formatWan(row.actual, 0) : <span className="text-slate-500">-</span>}
                                    </td>
                                    <td className="border-t border-slate-200/75 px-4 py-3.5 text-right font-semibold tabular-nums text-slate-600 group-hover:bg-blue-50/45">
                                        {row.prevActual > 0 ? formatWan(row.prevActual, 0) : '0万'}
                                    </td>
                                    <td className="border-t border-slate-200/75 px-4 py-3.5 text-center group-hover:bg-blue-50/45">
                                        {row.yoy != null ? (
                                            <span className={`text-xs font-bold ${row.yoy >= 0 ? 'text-blue-600' : 'text-rose-500'}`}>
                                                {row.yoy > 0 ? '+' : ''}{formatPercent(row.yoy, 0)}
                                            </span>
                                        ) : (
                                            <span className="font-bold text-slate-500">-</span>
                                        )}
                                    </td>
                                    <td className="border-t border-slate-200/75 px-4 py-3.5 text-center group-hover:bg-blue-50/45">
                                        <span className={`inline-flex min-w-[54px] justify-center rounded-full px-2 py-1 text-xs font-black ${collectionRateTone(row.completionRate)}`}>
                                            {row.completionRate != null ? formatPercent(row.completionRate, 0) : '-'}
                                        </span>
                                    </td>
                                    <td className="border-t border-slate-200/75 px-5 py-3.5 text-right group-hover:bg-blue-50/45">
                                        <span className="inline-flex min-w-[54px] justify-center rounded-full border border-slate-200 bg-white/88 px-2 py-0.5 text-xs font-black text-slate-700 shadow-sm">
                                            {row.cumulativeRate != null ? formatPercent(row.cumulativeRate, 0) : '-'}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot>
                            <tr className="bg-slate-950 text-white shadow-[0_-10px_24px_rgba(15,23,42,0.12)]">
                                <td className="sticky left-0 bg-slate-950 px-5 py-3.5 font-black backdrop-blur-xl">合计</td>
                                <td className="px-4 py-3.5 text-right font-black tabular-nums">{summary.totalInitialBudget > 0 ? formatWan(summary.totalInitialBudget, 0) : '-'}</td>
                                <td className="px-4 py-3.5 text-right font-black tabular-nums">{formatWan(summary.totalContractReceivable, 0)}</td>
                                <td className="px-4 py-3.5 text-right font-black tabular-nums text-sky-100">{formatWan(summary.totalActual, 0)}</td>
                                <td className="px-4 py-3.5 text-right font-semibold tabular-nums text-slate-200">{formatWan(summary.totalPrevActual, 0)}</td>
                                <td className="px-4 py-3.5 text-center font-bold text-slate-500">-</td>
                                <td className="px-4 py-3.5 text-center">
                                    <span className="inline-flex min-w-[54px] justify-center rounded-full bg-white/15 px-2 py-1 text-xs font-black text-white">
                                        {summary.totalCompletionRate != null ? formatPercent(summary.totalCompletionRate, 0) : '-'}
                                    </span>
                                </td>
                                <td className="px-5 py-3.5 text-right">
                                    <span className="inline-flex min-w-[54px] justify-center rounded-md bg-white/15 px-2 py-0.5 text-xs font-black text-white">
                                        {summary.totalCumulativeRate != null ? formatPercent(summary.totalCumulativeRate, 0) : '-'}
                                    </span>
                                </td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </section>
        </div>
    );
};

const FocusDashboardBase: React.FC<{
    data: DashboardData;
    selectedYear: number;
    projectId?: string;
    parkName: string;
    authUser?: AuthUser | null;
    isCloudConnected: boolean;
    isSyncing: boolean;
    onYearChange: (year: number) => void;
}> = ({
    data,
    selectedYear,
    projectId,
    parkName,
    authUser,
    isCloudConnected,
    isSyncing,
    onYearChange,
}) => {
    const [detailOpen, setDetailOpen] = React.useState(false);
    const [customFieldSettingsOpen, setCustomFieldSettingsOpen] = React.useState(false);
    const { customFieldIds, saveCustomFieldIds, customFieldSync } = useDashboardCustomFieldSelection(authUser);
    const openCustomFieldSettings = React.useCallback(() => {
        setCustomFieldSettingsOpen(true);
    }, []);
    const handleSaveCustomFields = (fieldIds: DashboardCustomFieldId[]) => {
        saveCustomFieldIds(fieldIds);
        setCustomFieldSettingsOpen(false);
    };
    const annualGoal = React.useMemo(
        () =>
            resolveAnnualInitialBudget(data.yearlyTargets, data.initializationData, selectedYear, projectId) ||
            data.annualRevenueTarget ||
            data.monthlyRevenueTarget ||
            0,
        [
            data.annualRevenueTarget,
            data.initializationData,
            data.monthlyRevenueTarget,
            data.yearlyTargets,
            projectId,
            selectedYear,
        ],
    );
    const collected = data.annualRevenueCollected || 0;
    const progress = annualGoal > 0 ? (collected / annualGoal) * 100 : data.collectionRate || 0;
    const boundedProgress = Math.max(0, Math.min(100, progress));
    const arrears = data.accumulatedArrears || 0;
    const expiringCount = data.expiringSoon?.length || 0;

    return (
        <section className="liquid-glass-panel relative flex min-h-[calc(100vh-9.5rem)] flex-col overflow-hidden rounded-[32px]">
            <div className="flex items-center justify-between gap-3 border-b border-white/50 bg-white/18 px-5 py-4">
                <div className="min-w-0">
                    <div className="flex items-center gap-2 text-xs font-bold text-blue-700">
                        <span className="h-2 w-2 rounded-full bg-blue-500" />
                        {isCloudConnected ? '后端在线' : '本地模式'}
                        {isSyncing && <span className="text-slate-500">同步中</span>}
                    </div>
                    <h2 className="mt-1 truncate text-xl font-black tracking-normal text-slate-950">
                        {parkName || projectId || '当前园区'}
                    </h2>
                </div>
                <div className="liquid-glass-readable flex shrink-0 items-center gap-2 rounded-full p-1">
                    <button type="button" onClick={() => onYearChange(selectedYear - 1)} className="liquid-pressable rounded-full p-2 text-slate-500 hover:bg-white/70 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-200/80" aria-label="上一年">
                        <ChevronLeft size={16} />
                    </button>
                    <span className="px-3 text-sm font-black tabular-nums text-slate-900">{selectedYear} 年度</span>
                    <button type="button" onClick={() => onYearChange(selectedYear + 1)} className="liquid-pressable rounded-full p-2 text-slate-500 hover:bg-white/70 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-200/80" aria-label="下一年">
                        <ChevronRight size={16} />
                    </button>
                </div>
            </div>

            <div className="flex flex-1 items-center justify-center px-6 py-8 md:px-10 md:py-10">
                <div className="flex min-w-0 flex-col items-center justify-center">
                    <button
                        type="button"
                        onClick={() => setDetailOpen(true)}
                        className="liquid-dial-button liquid-pressable group relative flex max-w-full items-center justify-center rounded-full outline-none focus-visible:ring-4 focus-visible:ring-blue-200/90"
                        style={{
                            width: 'min(50vh, 42vw, 560px)',
                            height: 'min(50vh, 42vw, 560px)',
                            minWidth: '360px',
                            minHeight: '360px',
                            '--dial-progress': `${boundedProgress * 3.6}deg`,
                        } as React.CSSProperties}
                        title="查看月度收款明细"
                    >
                        <div className="liquid-dial-track absolute inset-0 rounded-full" />
                        <div className="liquid-dial-progress absolute inset-0 rounded-full" />
                        <div className="liquid-dial-core absolute inset-[22px] rounded-full ring-1 ring-white/65" />
                        <div className="absolute inset-[46px] rounded-full border border-white/60 bg-white/18" />
                        <div className="liquid-dial-shine absolute inset-[22px] rounded-full" />
                        <div className="relative z-10 text-center">
                            <div className="text-sm font-black text-slate-600">年度收款达成</div>
                            <div className="mt-3 text-[92px] font-black leading-none tracking-normal text-blue-700 tabular-nums 2xl:text-[108px]">
                                {formatPercent(progress, 1)}
                            </div>
                            <div className="mt-5 text-sm font-semibold text-slate-500">
                                已收 {formatWan(collected, 0)} / 目标 {annualGoal > 0 ? formatWan(annualGoal, 0) : '未设定'}
                            </div>
                            <div className="liquid-glass-readable mt-5 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold text-blue-700 transition group-hover:bg-white/80">
                                点击查看月度明细 <ChevronRight size={14} />
                            </div>
                        </div>
                    </button>

                    <div className="liquid-glass-readable liquid-metric-strip mt-8 grid w-[min(72vw,920px)] max-w-full grid-cols-3 divide-x divide-slate-200/70 rounded-[22px]">
                        <div className="px-5 py-4 text-center">
                            <div className="text-xs font-bold text-slate-500">出租率</div>
                            <div className="mt-1 text-2xl font-black tabular-nums text-slate-950 2xl:text-3xl">{formatPercent(data.occupancyRate, 1)}</div>
                        </div>
                        <div className="px-5 py-4 text-center">
                            <div className="text-xs font-bold text-slate-500">累计欠款</div>
                            <div className={`mt-1 text-2xl font-black tabular-nums 2xl:text-3xl ${arrears > 0 ? 'text-orange-600' : 'text-blue-700'}`}>
                                {formatWan(arrears, 0)}
                            </div>
                        </div>
                        <div className="px-5 py-4 text-center">
                            <div className="text-xs font-bold text-slate-500">合同到期</div>
                            <div className="mt-1 text-2xl font-black tabular-nums text-slate-950 2xl:text-3xl">{expiringCount} 份</div>
                        </div>
                    </div>

                    <DashboardCustomFields
                        data={data}
                        selectedYear={selectedYear}
                        projectId={projectId}
                        selectedFieldIds={customFieldIds}
                        settingsOpen={customFieldSettingsOpen}
                        syncLabel={customFieldSync.label}
                        syncTone={customFieldSync.tone}
                        onConfigure={openCustomFieldSettings}
                    />
                </div>
            </div>

            <MonthlyCollectionDetail
                open={detailOpen}
                onClose={() => setDetailOpen(false)}
                data={data}
                selectedYear={selectedYear}
                projectId={projectId}
            />
            <DashboardCustomFieldSettings
                open={customFieldSettingsOpen}
                selectedFieldIds={customFieldIds}
                onClose={() => setCustomFieldSettingsOpen(false)}
                onSave={handleSaveCustomFields}
            />
        </section>
    );
};

const FocusDashboard = React.memo(FocusDashboardBase);

const buildIncrementalSaveDisplayOptions = (
    currentData?: DashboardData | null
): IncrementalSaveDisplayOptions | undefined => {
    if (!currentData) return undefined;
    return {
        labelFor: (collection, originalId) => {
            if (collection === 'pb_payments') {
                const payment = currentData.payments.find((item) => item.id === originalId);
                if (payment) {
                    const period = payment.period ? ` · 账期 ${payment.period}` : '';
                    return `${payment.tenantName} · ${payment.date}${period}`;
                }
            }
            if (collection === 'pb_tenants') {
                return currentData.tenants.find((item) => item.id === originalId)?.name;
            }
            return undefined;
        },
    };
};

type CloudSaveAlertResult = {
    ok: boolean;
    conflict?: boolean;
    conflictCount?: number;
    message?: string;
    partial?: boolean;
    alertTitle?: string;
};

type GlassPromptTone = 'blue' | 'cyan' | 'amber' | 'rose' | 'slate';

type GlassPromptState = {
    kind: 'notice' | 'confirm' | 'input';
    title: string;
    message?: string;
    tone?: GlassPromptTone;
    confirmText?: string;
    cancelText?: string;
    inputLabel?: string;
    inputPlaceholder?: string;
    defaultValue?: string;
    resolve?: (result?: boolean | string | null) => void;
};

const buildCloudSavePrompt = (res: CloudSaveAlertResult): Pick<GlassPromptState, 'title' | 'message' | 'tone'> => {
    if (res.conflict && (res.conflictCount || 0) > 0) {
        return {
            title: `检测到 ${res.conflictCount} 条冲突`,
            message: `请在冲突弹窗中处理。${res.message ? `\n\n${res.message}` : ''}`,
            tone: 'amber',
        };
    }
    const title =
        res.alertTitle || (res.ok ? '保存成功' : res.partial ? '部分保存成功' : '保存失败');
    return {
        title,
        message: res.message || '未知错误',
        tone: res.ok ? 'blue' : res.partial ? 'amber' : 'rose',
    };
};

// ── 保存互斥锁（模块级）──────────────────────────────────────────────
// 防止自动保存与手动保存并发执行，消除双写和 baseline 竞态。
// - acquireSaveLock() 返回 release 函数（闭包持有真实 holder ID）
// - tryAcquireSaveLock() 返回 release 函数或 null（获取失败）
// - 最长持有时间 30 秒，超时自动释放（防止死锁）

let _saveLock = false;
let _saveLockHolder: string | null = null;
let _saveLockSeq = 0;
const _saveWaiters: Array<{ resolve: (release: () => void) => void }> = [];

const _takeLock = (holderId: string): (() => void) => {
    _saveLock = true;
    _saveLockHolder = holderId;
    const timeout = setTimeout(() => {
        if (_saveLock && _saveLockHolder === holderId) {
            console.warn(`[save-mutex] ${holderId} 超时（30s），强制释放锁`);
            _releaseLock(holderId);
        }
    }, 30000);
    return () => {
        clearTimeout(timeout);
        _releaseLock(holderId);
    };
};

const _releaseLock = (holderId: string) => {
    if (_saveLockHolder !== holderId) return;
    _saveLock = false;
    _saveLockHolder = null;
    // 通知下一个等待者
    if (_saveWaiters.length > 0) {
        const waiter = _saveWaiters.shift()!;
        waiter.resolve(_takeLock(`waiter:${++_saveLockSeq}`));
    }
};

/** 获取保存锁（等待式）。返回 release 函数，调用方在 finally 中调用它。 */
const acquireSaveLock = (): Promise<() => void> => {
    if (!_saveLock) {
        return Promise.resolve(_takeLock(`direct:${++_saveLockSeq}`));
    }
    return new Promise((resolve) => {
        _saveWaiters.push({ resolve });
    });
};

/** 尝试获取保存锁（非等待）。返回 release 函数或 null。 */
const tryAcquireSaveLock = (): (() => void) | null => {
    if (!_saveLock) {
        return _takeLock(`auto:${++_saveLockSeq}`);
    }
    return null;
};

// ── 持久化缓存写入队列（IndexedDB 主，localStorage 失败兜底）────────────────
const dashboardCacheWriter = new DashboardCacheWriter({
    cachePut,
    fallbackPut: putParkStorageFallback,
    fallbackRemove: clearParkStorageFallbackIfMatches,
    retryFailedFlushDelayMs: 5000,
    maxFailedFlushRetries: 6,
    schedule: (flush) => {
        void runWhenBrowserIdle(() => {
            flush();
            return undefined;
        }, 500);
    },
});

/** 持久化 DashboardData 到缓存；序列化与写入由队列延后到浏览器空闲时段。 */
const parkDataPutObj = (key: string, obj: unknown) => {
    dashboardCacheWriter.putObject(key, obj);
};

const parkDataGet = async (key: string): Promise<string | null> => {
    return readParkDataCache(key, {
        cacheGet: (cacheKey) => cacheGet<string>(cacheKey),
        cachePut,
    });
};
const App: React.FC = () => {
  const [data, setData] = useState<DashboardData | null>(null);
  const [cloudConfig, setCloudConfig] = useState<CloudConfig>(() => ({
      ...DEFAULT_CLOUD_CONFIG,
  }));
  
  const [aiConfig, setAiConfig] = useState<AIConfig>({
      provider: 'none',
      enabled: false,
      qwenApiKey: '',
      qwenBaseUrl: 'https://coding.dashscope.aliyuncs.com/v1',
      openaiApiKey: '',
      openaiBaseUrl: ''
  });
  
	  const [isCloudConnected, setIsCloudConnected] = useState(false);
	  const [isSyncing, setIsSyncing] = useState(false);
	  const isSyncingRef = React.useRef(false);
	  React.useEffect(() => {
	      isSyncingRef.current = isSyncing;
	  }, [isSyncing]);
	  const [localComputeModuleRevision, setLocalComputeModuleRevision] = useState(0);
  const [isTestingCloud, setIsTestingCloud] = useState(false);
	  const [cloudConnectionMsg, setCloudConnectionMsg] = useState<{type: 'success' | 'error', text: string} | null>(null);
	  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
	  const serverComputeEnabled = isServerComputeEnabled({
	      cloudConnected: isCloudConnected,
	      authEnabled: !!authUser?.enabled,
	      authToken: getCurrentCloudAuthToken(),
	      projectId: cloudConfig.projectId,
	  });
  const [bootReady, setBootReady] = useState(false);
  const [authorizedParks, setAuthorizedParks] = useState<ParkInfo[]>([]);
  const [mobileKpiScope, setMobileKpiScope] = useState<string>('');
  const [mobileParkSnapshotMap, setMobileParkSnapshotMap] = useState<Record<string, MobileParkKpiSnapshotEntry>>({});
  const [isLoadingMobileParkKpis, setIsLoadingMobileParkKpis] = useState(false);
  const mobileParkSnapshotMapRef = React.useRef<Record<string, MobileParkKpiSnapshotEntry>>({});
  const mobileKpiLoadSeqRef = React.useRef(0);
  const projectSwitchSeqRef = React.useRef(0);
  const [loginForm, setLoginForm] = useState({
      email: '',
      password: '',
  });
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [publicParks, setPublicParks] = useState<ParkInfo[]>([]);
  const [isLoadingPublicParks, setIsLoadingPublicParks] = useState(false);
  const [signupForm, setSignupForm] = useState<SignupForm>({
      applicantName: '',
      email: '',
      password: '',
      requestedProjectIds: [],
  });
  const [isSubmittingSignup, setIsSubmittingSignup] = useState(false);
  const [signupMsg, setSignupMsg] = useState<string | null>(null);
  const [cloudHistory, setCloudHistory] = useState<CloudBackupMetadata[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [isSnapshotModalOpen, setIsSnapshotModalOpen] = useState(false);
  const [snapshotNote, setSnapshotNote] = useState('');
	  const [operatorName, setOperatorName] = useState('');
	  const [isSidebarOpen, setSidebarOpen] = useState(false);
	  const [isMobileMoreOpen, setMobileMoreOpen] = useState(false);
  const [isMobileParkPickerOpen, setMobileParkPickerOpen] = useState(false);
	  const [isAssistantOpen, setAssistantOpen] = useState(false);
  const [isAIDialogOpen, setAIDialogOpen] = useState(false);
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);
  const [changePasswordForm, setChangePasswordForm] = useState({
      oldPassword: '',
      newPassword: '',
      confirmPassword: '',
  });
  const [changePasswordSaving, setChangePasswordSaving] = useState(false);
  const [changePasswordError, setChangePasswordError] = useState<string | null>(null);
  const [isTargetModalOpen, setIsTargetModalOpen] = useState(false);
  const [targetModalType, setTargetModalType] = useState<'revenue' | 'occupancy'>('revenue');
  const [activeTab, setActiveTab] = useState<'dashboard' | 'buildings' | 'contracts' | 'finance' | 'budget' | 'initData' | 'settings'>('dashboard');
  const [mobileDashboardMode, setMobileDashboardMode] = useState<MobileDashboardMode>('overview');
  const [mobileSearchQuery, setMobileSearchQuery] = useState('');
  const [mobileSearchFilter, setMobileSearchFilter] = useState<MobileSearchFilter>('all');
  const [mobileSearchBuildingFilter, setMobileSearchBuildingFilter] = useState('all');
  const [mobileSearchExpiryMonthFilter, setMobileSearchExpiryMonthFilter] = useState('all');
  const [mobileSearchPaymentFilter, setMobileSearchPaymentFilter] = useState<MobileTenantSearchPaymentFilter>('all');
  const [mobileSearchReceivableFilter, setMobileSearchReceivableFilter] = useState<MobileTenantSearchReceivableFilter>('all');
  const [mobileSearchArrearsFilter, setMobileSearchArrearsFilter] = useState<MobileTenantSearchArrearsFilter>('all');
  const [mobileSearchResultLimit, setMobileSearchResultLimit] = useState(MOBILE_TENANT_SEARCH_PAGE_SIZE);
  const [mobileContractFocus, setMobileContractFocus] = useState<MobileTenantActionFocus | null>(null);
  const [mobileFinanceFocus, setMobileFinanceFocus] = useState<MobileTenantActionFocus | null>(null);
  const [mobileSearchHistoricalArrears, setMobileSearchHistoricalArrears] = useState<TenantHistoricalArrearsResult>(() =>
      createUnavailableTenantHistoricalArrears('客户查询未启用')
  );
  const mobileNavLayout = useMobileNavLayout();

  React.useEffect(() => {
      mobileParkSnapshotMapRef.current = mobileParkSnapshotMap;
  }, [mobileParkSnapshotMap]);

  React.useEffect(() => {
      if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
      const enhanceNumericInputs = () => {
          document.querySelectorAll<HTMLInputElement>('input[type="number"]').forEach((input) => {
              if (!input.getAttribute('inputmode')) {
                  input.setAttribute('inputmode', 'decimal');
              }
              if (!input.getAttribute('enterkeyhint')) {
                  input.setAttribute('enterkeyhint', 'done');
              }
          });
      };

      enhanceNumericInputs();
      const observer = new MutationObserver(enhanceNumericInputs);
      observer.observe(document.body, { childList: true, subtree: true });
      return () => observer.disconnect();
  }, []);

  const [lastSaved, setLastSaved] = useState<string>('');
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [selectedQuarter, setSelectedQuarter] = useState<'All' | 'Q1' | 'Q2' | 'Q3' | 'Q4'>('All');
  const [billingSelectedMonth, setBillingSelectedMonth] = useState<string>(new Date().toISOString().slice(0, 7));
	  const [dashboardBillingState, setDashboardBillingState] = useState<DashboardBillingLazyState>({
	      key: '',
	      rows: [],
	      loading: false,
	  });
	  const dashboardBillingRowsCacheRef = React.useRef<Map<string, BillingDetail[]>>(new Map());
	  const dashboardMruCacheRef = React.useRef<Map<string, DashboardMruEntry>>(new Map());
	  const dashboardPrefetchPromiseRef = React.useRef<Map<string, Promise<void>>>(new Map());
	  const prevYearTrendsBackfillRef = React.useRef<Set<string>>(new Set());
  const [financeReceivableMonth, setFinanceReceivableMonth] = useState<string>(new Date().toISOString().slice(0, 7));
  const [financeBillingState, setFinanceBillingState] = useState<DashboardBillingLazyState>({
      key: '',
      rows: [],
      loading: false,
  });
  const [targetForm, setTargetForm] = useState({ occupancy: 0 });

  const [isInitDataModalOpen, setIsInitDataModalOpen] = useState(false);
  const [initDataYear, setInitDataYear] = useState<number>(2024);
  const [tempInitData, setTempInitData] = useState<MonthlyInitData[]>([]);
  const [isImportingInitialBudget, setIsImportingInitialBudget] = useState(false);
  const [managedUsers, setManagedUsers] = useState<ManagedUserAccount[]>([]);
  const [isLoadingManagedUsers, setIsLoadingManagedUsers] = useState(false);
  const [managedUsersError, setManagedUsersError] = useState<string | null>(null);
  const [userManageTarget, setUserManageTarget] = useState<ManagedUserAccount | null>(null);
  const [userManageSaving, setUserManageSaving] = useState(false);
  const [userManageForm, setUserManageForm] = useState<{
      name: string;
      role: UserRole;
      projectId: string;
      allowedParkIds: string[];
      password: string;
      enabled: boolean;
  }>({
      name: '',
      role: 'park_user',
      projectId: '',
      allowedParkIds: [],
      password: '',
      enabled: true,
  });
  const [isCreatingUser, setIsCreatingUser] = useState(false);
  const [signupRequests, setSignupRequests] = useState<SignupRequestRecord[]>([]);
  const [isLoadingSignupRequests, setIsLoadingSignupRequests] = useState(false);
  const [signupRequestsError, setSignupRequestsError] = useState<string | null>(null);
  const [newUserForm, setNewUserForm] = useState<NewManagedUserForm>({
      email: '',
      name: '',
      password: '',
      projectId: '',
      role: 'park_user',
      enabled: false,
  });

  // New state for auto-restore prompt
  const [showRestorePrompt, setShowRestorePrompt] = useState(false);
  const [latestBackup, setLatestBackup] = useState<CloudBackupMetadata | null>(null);
  const [glassPrompt, setGlassPrompt] = useState<GlassPromptState | null>(null);
  const [glassPromptInput, setGlassPromptInput] = useState('');
  const showGlassNotice = React.useCallback((prompt: Omit<GlassPromptState, 'kind' | 'resolve'>) => (
      new Promise<void>((resolve) => {
          setGlassPrompt({
              kind: 'notice',
              confirmText: '知道了',
              tone: 'blue',
              ...prompt,
              resolve: () => resolve(),
          });
      })
  ), []);
  const showGlassConfirm = React.useCallback((prompt: Omit<GlassPromptState, 'kind' | 'resolve'>) => (
      new Promise<boolean>((resolve) => {
          setGlassPrompt({
              kind: 'confirm',
              confirmText: '确认',
              cancelText: '取消',
              tone: 'amber',
              ...prompt,
              resolve: (result) => resolve(result === true),
          });
      })
  ), []);
  const showGlassInput = React.useCallback((prompt: Omit<GlassPromptState, 'kind' | 'resolve'>) => (
      new Promise<string | null>((resolve) => {
          const defaultValue = prompt.defaultValue || '';
          setGlassPromptInput(defaultValue);
          setGlassPrompt({
              kind: 'input',
              confirmText: '确认',
              cancelText: '取消',
              tone: 'blue',
              ...prompt,
              defaultValue,
              resolve: (result) => resolve(typeof result === 'string' ? result : null),
          });
      })
  ), []);
  const closeGlassPrompt = React.useCallback((result?: boolean | string | null) => {
      setGlassPrompt((current) => {
          if (!current) return null;
          if (current.kind === 'input') {
              current.resolve?.(result === true ? glassPromptInput : null);
          } else {
              current.resolve?.(result);
          }
          return null;
      });
      setGlassPromptInput('');
  }, [glassPromptInput]);

  // ---- 增量保存相关 state ----
  // recordMeta：行级乐观锁基准，由 fetchCloudBackup 返回。每次保存成功后需重新拉取刷新。
  const [recordMeta, setRecordMeta] = useState<RecordMeta>({});
  const recordMetaRef = React.useRef<RecordMeta>({});
  React.useEffect(() => {
      recordMetaRef.current = recordMeta;
  }, [recordMeta]);
  // 单例 DirtyTracker：业务组件可以通过 Context 拿到它登记 create/update/delete
  // （目前业务组件还没主动登记；保存时通过 baselineSnapshotRef 自动 diff 兜底）
  const dirtyTrackerRef = React.useRef<DirtyTracker>(new DirtyTracker());
  /**
   * 保存基线快照：上次「从云端加载」时的 PocketBase 行级 record map。
   * 保存时与当前 data 做 diff，自动产生 creates/updates/deletes 的 DirtyPayload，
   * 实现「不需要业务组件主动登记 dirty」就能聚合增量保存。
   */
  const baselineSnapshotRef = React.useRef<PbRecordMap | null>(null);
  const dataLoadScopeRef = React.useRef<DashboardDataLoadScope>(FULL_DASHBOARD_LOAD_SCOPE);
  const dirtyPbCollectionsRef = React.useRef<Set<string>>(new Set());
  const dashboardCacheDirtyRef = React.useRef(false);
  const lastDiffTrackedDataRef = React.useRef<DashboardData | null>(null);
  const [hasSaveDiffHints, setHasSaveDiffHints] = useState(false);
  const isKpiPreviewRef = React.useRef(false);
  const [isKpiPreview, setIsKpiPreview] = useState(false);
  const applyDashboardPreviewData = React.useCallback((previewData: DashboardData) => {
      isKpiPreviewRef.current = true;
      setIsKpiPreview(true);
      setData(previewData);
  }, []);
  // 保存时收到的冲突清单；交给 ConflictDialog 处理
  const [pendingConflicts, setPendingConflicts] = useState<IncrementalConflict[]>([]);
  const savePayloadMemoRef = React.useRef(new LastSavePayloadMemo<DirtyPayload>());
  const saveBaselineRevisionRef = React.useRef(0);

  const clearSavePayloadMemo = React.useCallback(() => {
      savePayloadMemoRef.current.clear();
  }, []);

  const bumpSaveBaselineRevision = React.useCallback(() => {
      saveBaselineRevisionRef.current += 1;
      savePayloadMemoRef.current.clear();
  }, []);

  const resetSaveDiffHints = React.useCallback((trackedData?: DashboardData | null) => {
      dirtyPbCollectionsRef.current.clear();
      dashboardCacheDirtyRef.current = false;
      lastDiffTrackedDataRef.current = trackedData ?? null;
      dirtyTrackerRef.current.reset();
      clearSavePayloadMemo();
      setHasSaveDiffHints(false);
  }, [clearSavePayloadMemo]);

  const markAllSaveDiffCollections = React.useCallback(() => {
      dirtyPbCollectionsRef.current = new Set(PB_RECORD_COLLECTIONS);
      clearSavePayloadMemo();
      setHasSaveDiffHints(true);
  }, [clearSavePayloadMemo]);

  const getSaveDiffCollections = React.useCallback((): string[] => {
      return Array.from(dirtyPbCollectionsRef.current);
  }, []);

  const persistentSliceCollections = React.useMemo<SavePayloadSliceDescriptor[]>(() => [
      { key: 'buildings', collections: ['pb_buildings', 'pb_units'] },
      { key: 'tenants', collections: ['pb_tenants'] },
      { key: 'payments', collections: ['pb_payments'] },
      { key: 'invoices', collections: ['pb_invoices'] },
      { key: 'yearlyTargets', collections: ['pb_yearly_targets'] },
      { key: 'initializationData', collections: ['pb_monthly_init_data', 'pb_yearly_targets'] },
      { key: 'budgetAssumptions', collections: ['pb_budget_assumptions'] },
      { key: 'budgetAdjustments', collections: ['pb_budget_adjustments'] },
      { key: 'budgetScenarios', collections: ['pb_budget_scenarios'] },
      { key: 'billingPeriodNotes', collections: ['pb_billing_period_notes'] },
  ], []);

  useEffect(() => {
      if (!data) {
          dashboardCacheDirtyRef.current = false;
          resetSaveDiffHints(null);
          return;
      }
      const prev = lastDiffTrackedDataRef.current;
      if (!prev) {
          lastDiffTrackedDataRef.current = data;
          return;
      }
      if (prev !== data) {
          clearSavePayloadMemo();
          let cacheRelevantSliceChanged = false;
          for (const item of persistentSliceCollections) {
              if (prev[item.key] !== data[item.key]) {
                  cacheRelevantSliceChanged = true;
                  for (const collection of item.collections) {
                      dirtyPbCollectionsRef.current.add(collection);
                  }
              }
          }
          if (prev.cloudSaveVersion !== data.cloudSaveVersion) {
              cacheRelevantSliceChanged = true;
          }
          if (cacheRelevantSliceChanged) {
              dashboardCacheDirtyRef.current = true;
          }
          setHasSaveDiffHints(dirtyPbCollectionsRef.current.size > 0);
          lastDiffTrackedDataRef.current = data;
      }
  }, [clearSavePayloadMemo, data, persistentSliceCollections, resetSaveDiffHints]);

  useEffect(() => {
    if (window.innerWidth >= 1024) {
        setSidebarOpen(true);
    }
  }, []);

	  useEffect(() => {
	      const flushPendingDashboardCache = () => {
	          dashboardCacheWriter.flushFallbackSync();
	          void dashboardCacheWriter.flush();
	      };
      const flushWhenHidden = () => {
          if (document.visibilityState === 'hidden') flushPendingDashboardCache();
      };
      window.addEventListener('pagehide', flushPendingDashboardCache);
      document.addEventListener('visibilitychange', flushWhenHidden);
      return () => {
          window.removeEventListener('pagehide', flushPendingDashboardCache);
          document.removeEventListener('visibilitychange', flushWhenHidden);
      };
  }, []);

  useEffect(() => {
	    const bootstrapYear = new Date().getFullYear();
	    const loadData = async () => {
	      const bootStartedAt = nowMs();
	      bootMark('dashboard_boot_start');
	      let loadCloudConnected = false;
	      let loadAuthEnabled = false;
	      let loadProjectId: string | undefined = undefined;
	      let loadDashboardComputeAttempted = false;
	      let parsedData: DashboardData | null = null;
	      let hasPreview = false;
	      const loadHistoryInBackground = (configForHistory: CloudConfig) => {
	          void getCloudHistory(configForHistory)
	              .then((historyRes) => {
	                  if (historyRes.success && historyRes.data && historyRes.data.length > 0) {
	                      setCloudHistory(historyRes.data);
	                      setLatestBackup(historyRes.data[0]);
	                  }
	              })
	              .catch((e) => {
	                  console.error('[App] 加载备份历史失败:', e);
	              });
	      };
	      const applyCachedPreview = (
	          raw: string | null,
	          projectId: string | undefined,
	          user: AuthUser | null,
	      ): DashboardData | null => {
	          if (!raw) return null;
	          try {
	              const safeData = { ...generateInitialData(), ...JSON.parse(raw) };
	              const previewData = user?.enabled
	                  ? scopeCachedDashboardData(safeData, user, projectId || '')
	                  : safeData;
	              applyDashboardPreviewData(previewData);
	              setBootReady(true);
	              hasPreview = true;
	              bootMark('dashboard_boot_cache_preview');
	              bootLog('cache preview', bootStartedAt, {
	                  projectId,
	                  tenants: previewData.tenants?.length || 0,
	                  payments: previewData.payments?.length || 0,
	              });
	              return safeData;
	          } catch (e) {
	              console.warn('[App] 本地缓存读取失败:', e);
	              return null;
	          }
	      };
	      try {
	        let configToUse = mergeStoredCloudConfig(localStorage.getItem(CLOUD_CONFIG_KEY));
        
        const savedAIConfig = sessionStorage.getItem('ai_config');
        if (savedAIConfig) {
            try {
                const parsedAI = JSON.parse(savedAIConfig);
                setAiConfig(parsedAI);
            } catch (e) {
                console.error('[App] AI配置加载失败:', e);
            }
        }
        // 启动时先读取本地缓存预览，再与后端同步；避免网络检查/园区列表拖住首屏。
        await initCloud(configToUse);
        let currentUser = getCurrentCloudUser();
        if (currentUser?.enabled && currentUser.projectId) {
            const provisionalProjectId = resolveInitialProjectId(currentUser, [], configToUse.projectId);
            configToUse = { ...configToUse, projectId: provisionalProjectId };
        }
	        setCloudConfig(configToUse);
	        loadProjectId = configToUse.projectId;
	        loadAuthEnabled = !!currentUser?.enabled;

        const cachedRaw = await parkDataGet(getParkStorageKey(configToUse.projectId)).catch(() => null);
        parsedData = applyCachedPreview(cachedRaw, configToUse.projectId, currentUser);

        if (currentUser?.enabled && currentUser.projectId) {
            const [refreshed, parksRes] = await Promise.all([
                refreshCloudAuthRecord().catch(() => null),
                fetchAuthorizedParks().catch((e) => {
                    console.error('[App] 加载园区列表失败:', e);
                    return null;
                }),
            ]);
            if (refreshed?.success && refreshed.user) currentUser = refreshed.user;
            setAuthUser(currentUser);
            let parks: ParkInfo[] = [];
            if (parksRes) {
                if (parksRes.success) {
                    parks = parksRes.parks;
                    setAuthorizedParks(parksRes.parks);
                }
            }
            const selectedProjectId = resolveInitialProjectId(currentUser, parks, configToUse.projectId);
            if (selectedProjectId !== configToUse.projectId) {
                configToUse = { ...configToUse, projectId: selectedProjectId };
                setCloudConfig(configToUse);
                loadProjectId = configToUse.projectId;
                const selectedCachedRaw = await parkDataGet(getParkStorageKey(configToUse.projectId)).catch(() => null);
                parsedData = applyCachedPreview(selectedCachedRaw, configToUse.projectId, currentUser);
            }
        }

	        const connected = await checkConnection(configToUse);
	        loadCloudConnected = connected;
	        setIsCloudConnected(connected);
        bootLog('auth + connection ready', bootStartedAt, {
            connected,
            projectId: configToUse.projectId,
            authEnabled: !!currentUser?.enabled,
        });

        let cloudBaselineData: DashboardData | null = null;
        let cloudBaselineMeta: RecordMeta | undefined;
        let hasKpiPreview = false;

        if (connected) {
          try {
            const dashboardOptions = {
	                  year: bootstrapYear,
                  quarter: 'All',
                  billingSelectedMonth,
                  quickMode: activeTab !== 'dashboard',
                  includeCurrentMonthBilling: false,
                  includePrevYearTrends: INITIAL_DASHBOARD_INCLUDE_PREV_YEAR_TRENDS,
	            } as const;
	            const snapshotPromise = !hasPreview && currentUser?.enabled
	              ? fetchCloudKpiSnapshot(configToUse, bootstrapYear).catch(() => null)
	              : null;
	            const bootstrapPromise = currentUser?.enabled
	              ? fetchCloudDashboardBootstrap(configToUse, dashboardOptions).catch(() => null)
	              : null;
	            loadDashboardComputeAttempted = !!bootstrapPromise;
            const localSafe = parsedData && currentUser?.enabled
              ? scopeCachedDashboardData(
                  { ...generateInitialData(), ...parsedData },
                  currentUser,
                  configToUse.projectId,
                )
              : parsedData;

            const bootstrapRes = bootstrapPromise
              ? await withSoftTimeout(
                  bootstrapPromise,
                  DASHBOARD_BOOTSTRAP_SOFT_TIMEOUT_MS,
                  null,
                )
              : null;
            if (await applyComputedDashboardLoad({
              result: bootstrapRes,
              localData: localSafe,
              year: bootstrapYear,
              quarter: 'All',
              projectId: configToUse.projectId,
            })) {
              bootMark('dashboard_boot_bootstrap_loaded');
              bootLog('bootstrap loaded', bootStartedAt, {
                  source: bootstrapRes?.source,
                  stale: bootstrapRes?.stale,
                  projectId: configToUse.projectId,
              });
              loadHistoryInBackground(configToUse);
              return;
            }

            const snapshotRes = snapshotPromise ? await snapshotPromise : null;
            if (!hasPreview && currentUser?.enabled && snapshotRes?.success && snapshotRes.snapshot) {
              isKpiPreviewRef.current = true;
              setIsKpiPreview(true);
              hasKpiPreview = true;
              hasPreview = true;
              setData(buildDashboardDataFromKpiSnapshot(snapshotRes.snapshot));
              setBootReady(true);
            }

	            const computedPromise = currentUser?.enabled
	              ? fetchCloudComputedDashboard(configToUse, dashboardOptions).catch(() => null)
	              : null;
            const computedRes = computedPromise
              ? await withSoftTimeout(
                  computedPromise,
                  DASHBOARD_BOOTSTRAP_SOFT_TIMEOUT_MS,
                  null,
                )
              : null;
            if (await applyComputedDashboardLoad({
              result: computedRes,
              localData: localSafe,
              year: bootstrapYear,
              quarter: 'All',
              projectId: configToUse.projectId,
            })) {
              bootMark('dashboard_boot_compute_loaded');
              bootLog('computed dashboard loaded', bootStartedAt, { projectId: configToUse.projectId });
              loadHistoryInBackground(configToUse);
              return;
            }
            const latestRes = await fetchCloudBackup(configToUse, configToUse.projectId || '');
            if (latestRes.success && latestRes.data) {
              const safeCloudData = { ...generateInitialData(), ...latestRes.data };
              cloudBaselineData = safeCloudData;
              cloudBaselineMeta = latestRes.recordMeta;
              if (hasMeaningfulDashboardPayload(safeCloudData)) {
                const localSafe = parsedData
                  ? { ...generateInitialData(), ...parsedData }
                  : null;
	                const { data: displayData, recovered } = localSafe
	                  ? mergeLocalDashboardCacheIntoCloud(safeCloudData, localSafe)
	                  : { data: safeCloudData, recovered: false };
	                const allowLocalDashboardMetricsFallback = shouldRunLocalDashboardMetricsForCloudLoad({
	                  cloudConnected: connected,
	                  authEnabled: !!currentUser?.enabled,
	                  projectId: configToUse.projectId,
	                  serverAttempted: loadDashboardComputeAttempted,
	                });
	                  if (!allowLocalDashboardMetricsFallback) {
	                  captureBaselineFromCloud(safeCloudData, latestRes.recordMeta, configToUse.projectId);
	                  if (!hasKpiPreview && !hasPreview) {
	                    applyDashboardPreviewData(
	                      currentUser?.enabled
	                        ? scopeCachedDashboardData(displayData, currentUser, configToUse.projectId)
	                        : displayData
	                    );
	                  }
	                  setLastSaved(new Date().toLocaleTimeString());
	                  if (recovered) {
	                    console.warn(
	                      '[App] 已从本地缓存恢复尚未同步至云端的财务修改，但后台指标计算失败，当前保持预览只读状态。'
	                    );
	                  }
	                  loadHistoryInBackground(configToUse);
	                  return;
	                }
	                // Worker 已在后台线程算，无需再用 runWhenBrowserIdle 延后；直接 await 拿结果落本地缓存。
	                const processed = await recalculateMetrics(displayData, bootstrapYear, 'All');
                captureBaselineFromCloud(safeCloudData, latestRes.recordMeta, configToUse.projectId);
                rememberDashboardMru(configToUse.projectId, processed, bootstrapYear, 'All');
                parkDataPutObj(getParkStorageKey(configToUse.projectId), processed);
                setLastSaved(new Date().toLocaleTimeString());
                if (recovered) {
                  console.warn(
                    '[App] 已从本地缓存恢复尚未同步至云端的财务修改（特殊业态/收款等），请核对后点击保存。'
                  );
                }
                loadHistoryInBackground(configToUse);
                return;
              }
            }
          } catch (cloudLoadError) {
            console.error('[App] 启动时拉取云端最新数据失败:', cloudLoadError);
          }
        }

	        if (parsedData) {
	          const safeData = { ...generateInitialData(), ...parsedData };
	          if (cloudBaselineData) captureBaselineFromCloud(cloudBaselineData, cloudBaselineMeta, configToUse.projectId);
	          const allowLocalDashboardMetricsFallback = shouldRunLocalDashboardMetricsForCloudLoad({
	            cloudConnected: connected,
	            authEnabled: !!currentUser?.enabled,
	            projectId: configToUse.projectId,
	            serverAttempted: loadDashboardComputeAttempted,
	          });
	          if (allowLocalDashboardMetricsFallback && !hasPreview) {
	            recalculateMetrics(safeData, bootstrapYear, 'All');
	          } else if (!hasPreview) {
	            applyDashboardPreviewData(
	              currentUser?.enabled
	                ? scopeCachedDashboardData(safeData, currentUser, configToUse.projectId)
	                : safeData
	            );
	          }
	          setLastSaved(new Date().toLocaleTimeString());
	        } else if (!hasKpiPreview && !hasPreview) {
	          const initialData = generateInitialData();
	          const allowLocalDashboardMetricsFallback = shouldRunLocalDashboardMetricsForCloudLoad({
	            cloudConnected: connected,
	            authEnabled: !!currentUser?.enabled,
	            projectId: configToUse.projectId,
	            serverAttempted: loadDashboardComputeAttempted,
	          });
	          if (allowLocalDashboardMetricsFallback) {
	            recalculateMetrics(initialData, bootstrapYear, 'All');
	          } else {
	            applyDashboardPreviewData(initialData);
	          }
	        }
	      } catch (e) {
	        console.error("Failed to load data", e);
	        const initialData = generateInitialData();
	        if (!hasPreview && shouldRunLocalDashboardMetricsForCloudLoad({
	          cloudConnected: loadCloudConnected,
	          authEnabled: loadAuthEnabled,
	          projectId: loadProjectId,
	          serverAttempted: loadDashboardComputeAttempted,
	        })) {
	          recalculateMetrics(initialData, bootstrapYear, 'All');
	        } else if (!hasPreview) {
	          applyDashboardPreviewData(initialData);
	        }
	      } finally {
        bootMark('dashboard_boot_ready');
        bootLog('boot ready', bootStartedAt, { projectId: loadProjectId });
        setBootReady(true);
      }
    };
    loadData();
  }, []);

  // 防抖写入本地缓存 + 自动同步到 PocketBase
  // ⚠️ 跨园区竞态防护（曾经导致北京 pb_tenants 被深圳数据整批覆盖）：
  //   1. switchProject 是 async — setCloudConfig 后 await fetchCloudBackup 期间 React 会渲染一次，
  //      此时 cloudConfig.projectId = 新园区，但 data 还是旧园区。本 effect 会用旧 data + 新 projectId
  //      起一个 2 秒定时器；若 fetchCloudBackup > 2s，定时器先到，旧数据会被以 "新 projectId" 跨园区写入。
  //   2. 用 currentProjectIdRef 在定时器内做"projectId 仍然是 effect 启动时那个"的快速校验；
  //      不一致就放弃本次写入（switchProject 会触发下一轮带正确 data 的 effect）。
  //   3. baselineSnapshotRef.current = null 时禁止云端增量保存；本地缓存只有在非同步切换、
  //      项目仍一致且数据园区校验通过时才允许写入，避免污染目标园区缓存。
	  const autoSaveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
	  const currentProjectIdRef = React.useRef<string>(cloudConfig.projectId || '');
	  React.useEffect(() => {
	    currentProjectIdRef.current = cloudConfig.projectId || '';
	  }, [cloudConfig.projectId]);
	  const autoSaveRetryTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
	  const [autoSaveRetryToken, setAutoSaveRetryToken] = useState(0);
	  const clearAutoSaveRetry = React.useCallback(() => {
	      if (!autoSaveRetryTimerRef.current) return;
	      clearTimeout(autoSaveRetryTimerRef.current);
	      autoSaveRetryTimerRef.current = null;
	  }, []);
	  const scheduleAutoSaveRetry = React.useCallback((projectId: string) => {
	      const retryProjectId = (projectId || '').trim();
	      if (!retryProjectId || autoSaveRetryTimerRef.current) return;
	      autoSaveRetryTimerRef.current = setTimeout(() => {
	          autoSaveRetryTimerRef.current = null;
	          if (currentProjectIdRef.current === retryProjectId) {
	              setAutoSaveRetryToken((value) => value + 1);
	          }
	      }, 5000);
	  }, []);
	  React.useEffect(() => clearAutoSaveRetry, [clearAutoSaveRetry]);

  const savePayloadAuthScopeKey = React.useMemo(() => [
      authUser?.id || '',
      authUser?.role || '',
      authUser?.hideRentPricing ? 'hide-rent' : 'show-rent',
      [...(authUser?.receivablePermissions || [])].sort().join(','),
  ].join('|'), [authUser]);

  const buildSavePayloadFromData = React.useCallback((
      currentData: DashboardData,
      baseline: PbRecordMap,
      projectId: string,
      baseRecordMeta: RecordMeta,
  ) => {
      const scopedCollections = getSaveDiffCollections();
      const collectionsKey = savePayloadCollectionsKey(scopedCollections);
      const dataIdentityKey = buildSavePayloadDataIdentityKey(
          currentData,
          scopedCollections,
          persistentSliceCollections,
      );
      return savePayloadMemoRef.current.getOrCompute(
          {
              dataRef: currentData,
              dataIdentityKey,
              baselineRef: baseline,
              recordMetaRef: baseRecordMeta,
              projectId,
              baselineRevision: saveBaselineRevisionRef.current,
              collectionsKey,
              authScopeKey: savePayloadAuthScopeKey,
          },
          () => {
              const useScopedDiff = scopedCollections.length > 0;
              const nextSnapshot = dashboardDataToPbRecords(
                  currentData,
                  projectId,
                  useScopedDiff ? { collections: scopedCollections } : undefined,
              );
              const scopedSnapshot = preserveRentFieldsInTenantPbMap(
                  nextSnapshot,
                  baseline,
                  authUser,
              );
              const diffed = useScopedDiff
                  ? diffPbRecordsScoped(
                      baseline,
                      scopedSnapshot,
                      baseRecordMeta,
                      { collections: scopedCollections },
                  )
                  : diffPbRecords(baseline, scopedSnapshot, baseRecordMeta);
              return filterDirtyPayloadForRentMaskedUser(diffed, authUser);
          },
      );
  }, [authUser, getSaveDiffCollections, persistentSliceCollections, savePayloadAuthScopeKey]);

  const buildDraftPayloadForCompute = React.useCallback((currentData: DashboardData): CloudDraftPayloadOptions | undefined => {
      const baseline = baselineSnapshotRef.current;
      const projectId = (cloudConfig.projectId || currentData.tenants?.[0]?.projectId || '').trim();
      if (!baseline || !projectId) return undefined;
      const payload = buildSavePayloadFromData(
          currentData,
          baseline,
          projectId,
          recordMetaRef.current,
      );
      if (payloadCount(payload).total === 0) return undefined;
      return {
          dirtyPayload: payload,
          baseVersion: typeof currentData.cloudSaveVersion === 'number' ? currentData.cloudSaveVersion : null,
      };
  }, [buildSavePayloadFromData, cloudConfig.projectId]);

	  useEffect(() => {
	    if (!data) return;
	    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
	    const projectIdAtEffectStart = cloudConfig.projectId;
	    const saveDiffStateAtSchedule = {
	        dirtyCollectionCount: dirtyPbCollectionsRef.current.size,
	        lastTrackedData: lastDiffTrackedDataRef.current,
	        currentData: data,
	    };
	    if (!shouldScheduleAutoSave({
	        ...saveDiffStateAtSchedule,
	        dashboardCacheDirty: dashboardCacheDirtyRef.current,
	        cloudAutoSync: cloudConfig.autoSync,
	        cloudConnected: isCloudConnected,
	    })) {
	        clearAutoSaveRetry();
	        return;
	    }
		    autoSaveTimerRef.current = setTimeout(async () => {
	      try {
	          if (isKpiPreviewRef.current) return;
	          // 园区在 2 秒间被切走了（setCloudConfig 触发 effect 但 data 还没刷到目标园区）。
	          if (currentProjectIdRef.current !== projectIdAtEffectStart) return;
	          const saveDiffState = {
	              dirtyCollectionCount: dirtyPbCollectionsRef.current.size,
	              lastTrackedData: lastDiffTrackedDataRef.current,
	              currentData: data,
	          };
	          const consistencyCheck = validateDataProjectConsistency(data, projectIdAtEffectStart || '');
	          if (!consistencyCheck.consistent) {
	              console.error("[auto-save] 数据一致性校验失败:", consistencyCheck, "期望园区:", projectIdAtEffectStart);
	              return;
	          }
	          const baselineForDiff = baselineSnapshotRef.current;
	          const autoSaveExecutionState = {
	              ...saveDiffState,
	              dashboardCacheDirty: dashboardCacheDirtyRef.current,
	              cloudAutoSync: cloudConfig.autoSync,
	              cloudConnected: isCloudConnected,
	              isPreview: isKpiPreviewRef.current,
	              isSyncing: isSyncingRef.current,
	              hasBaseline: !!baselineForDiff,
	              currentProjectId: currentProjectIdRef.current,
	              scheduledProjectId: projectIdAtEffectStart || '',
	              dataProjectConsistent: consistencyCheck.consistent,
	          };
	          const shouldWriteLocalCache = shouldWriteDashboardCacheDuringAutoSave(autoSaveExecutionState);
	          if (shouldWriteLocalCache) {
	              parkDataPutObj(getParkStorageKey(projectIdAtEffectStart), data);
	              dashboardCacheDirtyRef.current = false;
	              setLastSaved(new Date().toLocaleTimeString());
	          }
	          const shouldRunCloudSave = shouldAttemptCloudSaveDuringAutoSave(autoSaveExecutionState);
		          if (shouldRunCloudSave) {
		              // 没有 PB 持久化切片变化时跳过保存锁与 full diff；版本号变化只需写本地缓存。
		              // 保存互斥：手动保存进行中则跳过本次自动同步（下次 timer 会再试）
		              const autoRelease = tryAcquireSaveLock();
		              if (!autoRelease) {
		                  console.log('[auto-save] 手动保存进行中，跳过本次自动同步');
	                  scheduleAutoSaveRetry(projectIdAtEffectStart || '');
	                  return;
		              }
	              try {
	                  // 快照构建 + diff 优先走 dirty collection scope；未知状态时回退完整 diff。
	                  if (!baselineForDiff) return;
	                  const payload = await runWhenBrowserIdle(() => {
	                      return buildSavePayloadFromData(
                          data,
                          baselineForDiff,
                          projectIdAtEffectStart || '',
                          recordMetaRef.current,
                      );
                  });
                  const summary = payloadCount(payload);
                  if (summary.total > 0) {
                      // 二次防御：写云之前再核对一次 projectId，避开 await 期间被切走的极端情况。
                      if (currentProjectIdRef.current !== projectIdAtEffectStart) return;
	                      const res = await saveIncrementalToCloud(payload, cloudConfig, recordMetaRef.current);
	                      if (res.errors.length > 0) console.warn('[auto-save] 部分失败:', res.errors);
	                      if (res.conflicts.length > 0) {
	                          console.warn('[auto-save] 冲突，已暂停自动写云:', res.conflicts.length);
	                          setPendingConflicts(res.conflicts);
	                          clearAutoSaveRetry();
	                      }
	                      if (res.applied.length > 0 && (res.errors.length > 0 || res.conflicts.length > 0)) {
	                          if (currentProjectIdRef.current === projectIdAtEffectStart) {
	                              applyPartialIncrementalSave(res.applied, data, projectIdAtEffectStart || '');
	                          }
	                      }
	                      if (res.errors.length > 0 && res.conflicts.length === 0) {
	                          scheduleAutoSaveRetry(projectIdAtEffectStart || '');
	                      }
	                      if (res.errors.length === 0 && res.conflicts.length === 0) {
	                          // 三次防御：刷新基线之前再确认 projectId 没变，防止把当前园区基线刷成上一园区。
	                          if (currentProjectIdRef.current === projectIdAtEffectStart) {
	                              clearAutoSaveRetry();
	                              await bumpVersionAfterSuccessfulWrite(data);
	                              await refreshAfterSave(data, res.applied);
	                              resetSaveDiffHints(data);
	                          }
	                      }
	                  } else {
	                      clearAutoSaveRetry();
	                      resetSaveDiffHints(data);
	                  }
	              } finally {
	                  autoRelease();
	              }
	          } else if (baselineForDiff && isCloudConnected && cloudConfig.autoSync) {
	              clearAutoSaveRetry();
	              resetSaveDiffHints(data);
	          }
		      } catch (e) {
	          console.error("Auto-save failed", e);
	          scheduleAutoSaveRetry(projectIdAtEffectStart || '');
	      }
	    }, 2000);
	    return () => { if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current); };
	  }, [data, cloudConfig.projectId, cloudConfig.autoSync, isCloudConnected, authUser, buildSavePayloadFromData, autoSaveRetryToken, clearAutoSaveRetry, scheduleAutoSaveRetry]);

	  const dataRef = React.useRef(data);
	  dataRef.current = data;
	  const commitDataWithoutMetrics = React.useCallback((nextData: DashboardData) => {
	      dataRef.current = nextData;
	      isKpiPreviewRef.current = false;
	      setIsKpiPreview(false);
	      setData(nextData);
	  }, []);
			  const hasLocalPendingChanges = React.useCallback((
		      currentData: DashboardData | null | undefined = dataRef.current,
		      projectId: string = cloudConfig.projectId || ''
		  ): Promise<boolean> => {
		      const baseline = baselineSnapshotRef.current;
		      return hasPendingSaveDiff({
		          hasBaseline: !!baseline,
		          currentData,
		          projectId,
		          dirtyCollectionCount: dirtyPbCollectionsRef.current.size,
		          lastTrackedData: lastDiffTrackedDataRef.current,
		          buildPayload: () => buildSavePayloadFromData(
		              currentData as DashboardData,
		              baseline as PbRecordMap,
		              projectId,
		              recordMetaRef.current,
		          ),
		          schedule: (task) => runWhenBrowserIdle(task, 250),
		      });
		  }, [buildSavePayloadFromData, cloudConfig.projectId]);

	  // C2 外部写入感知：轮询 dashboard_data_version（任一端写入成功即 +1）。变化时——
  // 本地无未保存改动 → 安全全量回拉刷新 data+baseline+recordMeta；有改动 → 仅提示横幅，
  // 不自动覆盖用户编辑（保存时行级乐观锁/冲突弹窗兜底）。轮询间隔即天然 debounce。
  const [remoteChangePending, setRemoteChangePending] = useState(false);
  const lastSeenVersionRef = React.useRef<number | null>(null);
  const pendingRemotePullRef = React.useRef(false);
  useEffect(() => {
      if (!isCloudConnected || !cloudConfig.autoSync) return;
      let cancelled = false;
      const POLL_MS = 45000;
      // 复位版本基线：切园区/年/季度后各园区有各自的 dashboard_data_version，
      // 不复位会沿用上一园区的旧版本号，导致新园区外部写入漏检（新版本号 < 旧值时永不触发）。
      lastSeenVersionRef.current = null;
      pendingRemotePullRef.current = false;
      // 尝试拉取远端更新：本地干净→保存锁内安全回拉并清待拉标记；本地有改动→只提示，保留待拉（下次重试）。
      const tryPullRemote = async () => {
          const baseline = baselineSnapshotRef.current;
          const cur = dataRef.current;
          if (!baseline || !cur) return;
		          if (await hasLocalPendingChanges(cur, cloudConfig.projectId || '')) {
		              setRemoteChangePending(true); // 有本地改动：提示，待保存后再拉
		              return;
		          }
          const release = tryAcquireSaveLock();
          if (!release) return; // 保存进行中，下次轮询再试
	          try {
	              const projectId = cloudConfig.projectId || '';
	              const dashboardOptions = {
	                  year: selectedYear,
	                  quarter: selectedQuarter,
	                  billingSelectedMonth,
	                  quickMode: activeTab !== 'dashboard',
	                  includeCurrentMonthBilling: false,
                  includePrevYearTrends: INITIAL_DASHBOARD_INCLUDE_PREV_YEAR_TRENDS,
	              } as const;
	              const bootstrap = await fetchCloudDashboardBootstrap(cloudConfig, dashboardOptions).catch(() => null);
	              if (await applyComputedDashboardLoad({
	                  result: bootstrap,
	                  localData: null,
	                  year: selectedYear,
	                  quarter: selectedQuarter,
	                  projectId,
	                  shouldApply: () => !cancelled,
	              })) {
	                  pendingRemotePullRef.current = false;
	                  setRemoteChangePending(false);
	                  return;
	              }
	              const computed = await fetchCloudComputedDashboard(cloudConfig, dashboardOptions).catch(() => null);
	              if (await applyComputedDashboardLoad({
	                  result: computed,
	                  localData: null,
	                  year: selectedYear,
	                  quarter: selectedQuarter,
	                  projectId,
	                  shouldApply: () => !cancelled,
	              })) {
	                  pendingRemotePullRef.current = false;
	                  setRemoteChangePending(false);
	                  return;
	              }
              const pullScope = dataLoadScopeRef.current;
              const res = await fetchCloudBackup(
                  cloudConfig,
                  projectId,
                  backupOptionsForLoadScope(pullScope)
              );
	              if (res.success && res.data) {
	                  const safeData = { ...generateInitialData(), ...res.data };
	                  captureBaselineFromCloud(safeData, res.recordMeta, projectId, pullScope);
	                  if (shouldRunLocalDashboardMetricsForCloudLoad({
	                      cloudConnected: isCloudConnected,
	                      authEnabled: !!authUser?.enabled,
	                      projectId,
	                      serverAttempted: true,
	                  })) {
	                      await recalculateMetrics(safeData, selectedYear, selectedQuarter);
	                  } else {
	                      applyDashboardPreviewData(safeData);
	                  }
	                  pendingRemotePullRef.current = false;
	                  setRemoteChangePending(false);
	              }
          } catch (e) {
              console.warn('[remote-sync] 外部更新回拉失败:', e);
          } finally {
              release();
          }
      };
      const tick = async () => {
          if (cancelled || isKpiPreviewRef.current || !baselineSnapshotRef.current) return;
          try {
              const v = await readCloudSaveVersion(cloudConfig);
              if (cancelled) return;
              const last = lastSeenVersionRef.current;
              if (last == null) { lastSeenVersionRef.current = v; return; }
              if (v > last) {
                  lastSeenVersionRef.current = v;
                  pendingRemotePullRef.current = true; // 有新版本待拉（含本端写入，回拉幂等无害）
              }
              // 有待拉更新时，只要本地干净就回拉；本地未净则保留待拉、下次再试
              if (pendingRemotePullRef.current) await tryPullRemote();
          } catch { /* 瞬时网络错误忽略，下次再试 */ }
      };
      const id = setInterval(tick, POLL_MS);
      return () => { cancelled = true; clearInterval(id); };
	  }, [isCloudConnected, cloudConfig.autoSync, cloudConfig.projectId, authUser, selectedYear, selectedQuarter, hasLocalPendingChanges]);
  /** 切 tab 结果缓存：数据/年/季度未变时跳过重算 */
  const metricsCacheRef = React.useRef<{ dataRef: DashboardData | null; year: number; quarter: string } | null>(null);
  /** 指标重算请求序号：Worker 异步回填时「最新者胜」，丢弃过期结果的 setData */
  const metricsReqSeqRef = React.useRef(0);
  /** KPI 快照预览请求序号：切换年份时避免旧快照覆盖新年份 */
  const kpiPreviewReqSeqRef = React.useRef(0);
  /** 启动/bootstrap 已算过指标时，跳过 effect 首次重复计算 */
  const metricsFilterEffectReadyRef = React.useRef(false);
  const shouldRunDashboardMetricsFilterEffect = shouldRunDashboardMetricsFilterEffectForView({ activeTab });
  useEffect(() => {
      if (!dataRef.current) return;
      if (!metricsFilterEffectReadyRef.current) {
          metricsFilterEffectReadyRef.current = true;
          return;
      }
      if (!shouldRunDashboardMetricsFilterEffect) return;
      if (isKpiPreviewRef.current) return;
      // 缓存命中：数据引用相同 + 年/季度相同 → 跳过
      const cache = metricsCacheRef.current;
      if (cache && cache.dataRef === dataRef.current && cache.year === selectedYear && cache.quarter === selectedQuarter) {
          return;
      }
      recalculateMetricsServerFirst(dataRef.current, selectedYear, selectedQuarter);
      metricsCacheRef.current = { dataRef: dataRef.current, year: selectedYear, quarter: selectedQuarter };
  }, [shouldRunDashboardMetricsFilterEffect, selectedYear, selectedQuarter]);

  /** 账单明细 DOM 最重，空闲后再挂载，让 KPI 区先可交互 */
  const [showDashboardBillingTable, setShowDashboardBillingTable] = useState(false);
  useEffect(() => {
      if (activeTab !== 'dashboard' || mobileNavLayout) {
          setShowDashboardBillingTable(false);
          return;
      }
      let cancelled = false;
      const reveal = () => {
          if (!cancelled) setShowDashboardBillingTable(true);
      };
      const idleId =
          typeof window.requestIdleCallback === 'function'
              ? window.requestIdleCallback(reveal, { timeout: 120 })
              : window.setTimeout(reveal, 0);
      return () => {
          cancelled = true;
          if (typeof window.cancelIdleCallback === 'function') {
              window.cancelIdleCallback(idleId as number);
          } else {
              window.clearTimeout(idleId as number);
          }
      };
  }, [activeTab, cloudConfig.projectId, billingSelectedMonth, selectedYear, mobileNavLayout]);

  const shouldBuildDashboardBillingKey = shouldBuildDashboardBillingKeyForView({
      activeTab,
      mobileNavLayout,
      showDashboardBillingTable,
  });
  const shouldRunDashboardBillingEffect = shouldRunDashboardBillingEffectForView({
      activeTab,
      mobileNavLayout,
      showDashboardBillingTable,
      dataReady: !!data,
  });
	  const dashboardBillingViewData = shouldRunDashboardBillingEffect ? data : null;
	  const dashboardBillingViewProjectId = shouldRunDashboardBillingEffect ? cloudConfig.projectId : '';
	  const dashboardBillingViewMonth = shouldRunDashboardBillingEffect ? billingSelectedMonth : '';
	  const dashboardBillingViewYear = shouldRunDashboardBillingEffect ? selectedYear : 0;
	  const dashboardBillingViewCloudConfig = shouldRunDashboardBillingEffect ? cloudConfig : null;
	  const dashboardBillingCloudConnected = shouldRunDashboardBillingEffect && isCloudConnected;
	  const dashboardBillingAuthEnabled = shouldRunDashboardBillingEffect && !!authUser?.enabled;
	  const dashboardBillingCloudScopeKey = shouldRunDashboardBillingEffect
	      ? [cloudConfig.pocketbaseUrl || '', cloudConfig.projectId || ''].join('|')
	      : '';
	  const dashboardBillingVersionKey = useMemo(() => {
	      const version = dashboardBillingViewData?.cloudSaveVersion;
	      return typeof version === 'number' && Number.isFinite(version)
	          ? `v:${Math.max(0, Math.floor(version))}`
	          : '';
	  }, [dashboardBillingViewData?.cloudSaveVersion]);
	  const dashboardBillingHasRelevantDirty =
	      shouldRunDashboardBillingEffect &&
	      hasSaveDiffHints &&
	      hasBillingRelevantDirtyCollections(dirtyPbCollectionsRef.current);
	  const dashboardBillingNeedsContentHash =
	      !!dashboardBillingViewData &&
	      (dashboardBillingHasRelevantDirty || !dashboardBillingVersionKey);
	  const dashboardBillingDataIdentityKey = useMemo(
	      () => {
	          if (!dashboardBillingViewData) return '';
	          if (!dashboardBillingNeedsContentHash && dashboardBillingVersionKey) {
	              return dashboardBillingVersionKey;
	          }
	          return `hash:${billingEffectDataIdentityKey(dashboardBillingViewData)}`;
	      },
	      [dashboardBillingNeedsContentHash, dashboardBillingVersionKey, dashboardBillingViewData]
	  );
	  const dashboardBillingLastTrackedDataIdentityKey = useMemo(
	      () => dashboardBillingNeedsContentHash
	          ? `hash:${billingEffectDataIdentityKey(lastDiffTrackedDataRef.current)}`
	          : '',
	      [dashboardBillingNeedsContentHash, dashboardBillingViewData]
	  );
	  const dashboardBillingRequiresDraft = useMemo(() => {
	      if (!dashboardBillingViewData) return false;
	      if (dashboardBillingHasRelevantDirty) return true;
	      if (!dashboardBillingNeedsContentHash) return false;
	      if (!lastDiffTrackedDataRef.current) return false;
	      return dashboardBillingLastTrackedDataIdentityKey !== dashboardBillingDataIdentityKey;
	  }, [
	      dashboardBillingDataIdentityKey,
	      dashboardBillingHasRelevantDirty,
	      dashboardBillingLastTrackedDataIdentityKey,
	      dashboardBillingNeedsContentHash,
	      dashboardBillingViewData,
	  ]);

	  const dashboardBillingKey = useMemo(() => {
	      if (!dashboardBillingViewData) return '';
      const projectId = dashboardBillingViewProjectId || dashboardBillingViewData.tenants?.[0]?.projectId || '';
      return [
          projectId,
	          dashboardBillingViewMonth,
	          dashboardBillingViewYear,
	          dashboardBillingDataIdentityKey,
	      ].join('|');
	  }, [dashboardBillingDataIdentityKey, dashboardBillingViewData, dashboardBillingViewMonth, dashboardBillingViewProjectId, dashboardBillingViewYear]);

	  useEffect(() => {
	      if (!dashboardBillingViewData) return;
      let cancelled = false;
      const key = dashboardBillingKey;
      const cachedRows = dashboardBillingRowsCacheRef.current.get(key);
      if (cachedRows) {
          setDashboardBillingState({ key, rows: cloneBillingRows(cachedRows), loading: false });
          return;
      }
      setDashboardBillingState((prev) => ({
          key,
          rows: prev.key === key ? prev.rows : [],
          loading: true,
      }));
      const compute = async () => {
          try {
              const [yearPart, monthPart] = dashboardBillingViewMonth.split('-');
              const year = Number.parseInt(yearPart, 10) || dashboardBillingViewYear;
              const month = Math.max(0, (Number.parseInt(monthPart, 10) || 1) - 1);
	              const hasLocalDirty = dashboardBillingRequiresDraft;
	              const canUseServerBilling =
	                  dashboardBillingCloudConnected &&
	                  dashboardBillingAuthEnabled &&
                  !!dashboardBillingViewCloudConfig?.projectId;
              let serverAttempted = false;
              let serverError = '';
              if (canUseServerBilling && dashboardBillingViewCloudConfig) {
                  serverAttempted = true;
                  if (hasLocalDirty) {
                      const server = await fetchCloudDraftComputedBilling(dashboardBillingViewCloudConfig, dashboardBillingViewData, {
                          year,
                          month: month + 1,
                      }, buildDraftPayloadForCompute(dashboardBillingViewData));
	                      const rows = server.success && server.billingDetails ? server.billingDetails : null;
	                      if (!cancelled && rows) {
	                          putBillingRowsCache(dashboardBillingRowsCacheRef.current, key, rows);
	                          setDashboardBillingState({ key, rows, loading: false });
	                          return;
	                      }
	                      serverError = server.message || '后台草稿应收计算失败';
                  } else {
                      const server = await fetchCloudComputedBilling(dashboardBillingViewCloudConfig, {
                          year,
                          month: month + 1,
	                      });
	                      if (!cancelled && server.success && server.billingDetails) {
	                          putBillingRowsCache(dashboardBillingRowsCacheRef.current, key, server.billingDetails);
	                          setDashboardBillingState({ key, rows: server.billingDetails, loading: false });
	                          return;
	                      }
                      serverError = server.message || '后台应收计算失败';
                  }
              }
              if (!shouldRunLocalBillingFallback({ canUseServer: canUseServerBilling, serverAttempted })) {
                  if (!cancelled) {
                      setDashboardBillingState({
                          key,
                          rows: [],
                          loading: false,
                          error: serverError || '后台应收计算失败，未执行前端本地计算',
                      });
                  }
                  return;
	              }
	              const rows = await buildBillingDetailsForPeriodLocal(year, month, dashboardBillingViewData);
	              if (!cancelled) {
	                  putBillingRowsCache(dashboardBillingRowsCacheRef.current, key, rows);
	                  setDashboardBillingState({ key, rows, loading: false });
	              }
          } catch (e) {
              console.error('[dashboard billing] lazy build failed:', e);
              if (!cancelled) {
                  setDashboardBillingState({
                      key,
                      rows: [],
                      loading: false,
                      error: e instanceof Error ? e.message : '账单明细计算失败',
                  });
              }
          }
      };
      const idleId =
          typeof window.requestIdleCallback === 'function'
              ? window.requestIdleCallback(compute, { timeout: 300 })
              : window.setTimeout(compute, 0);
      return () => {
          cancelled = true;
          if (typeof window.cancelIdleCallback === 'function') {
              window.cancelIdleCallback(idleId as number);
          } else {
              window.clearTimeout(idleId as number);
          }
      };
  }, [
	      dashboardBillingAuthEnabled,
	      dashboardBillingCloudConnected,
	      dashboardBillingCloudScopeKey,
	      dashboardBillingDataIdentityKey,
	      dashboardBillingKey,
	      dashboardBillingViewMonth,
	      dashboardBillingViewYear,
	      dashboardBillingRequiresDraft,
	      buildDraftPayloadForCompute,
	  ]);

  const shouldBuildFinanceBillingKey = shouldBuildFinanceBillingKeyForView({ activeTab });
  const shouldRunFinanceBillingEffect = shouldRunFinanceBillingEffectForView({
      activeTab,
      dataReady: !!data,
  });
  const financeBillingViewData = shouldRunFinanceBillingEffect ? data : null;
  const financeBillingViewMonth = shouldRunFinanceBillingEffect ? financeReceivableMonth : '';
  const financeBillingViewProjectId = shouldRunFinanceBillingEffect ? cloudConfig.projectId : '';
	  const financeBillingViewCloudConfig = shouldRunFinanceBillingEffect ? cloudConfig : null;
	  const financeBillingCloudConnected = shouldRunFinanceBillingEffect && isCloudConnected;
	  const financeBillingAuthEnabled = shouldRunFinanceBillingEffect && !!authUser?.enabled;
		  const financeBillingViewDataRef = React.useRef<DashboardData | null>(null);
		  financeBillingViewDataRef.current = financeBillingViewData;
		  const financeBillingViewCloudConfigRef = React.useRef<CloudConfig | null>(null);
		  financeBillingViewCloudConfigRef.current = financeBillingViewCloudConfig;
		  const financeServerBillingRequired =
		      shouldRunFinanceBillingEffect &&
		      financeBillingCloudConnected &&
		      financeBillingAuthEnabled &&
		      !!financeBillingViewCloudConfig?.projectId;
		  const financeBillingCloudScopeKey = shouldRunFinanceBillingEffect
		      ? [cloudConfig.pocketbaseUrl || '', cloudConfig.projectId || ''].join('|')
		      : '';
	  const financeBillingDataIdentityKey = useMemo(
	      () => billingEffectDataIdentityKey(financeBillingViewData),
	      [financeBillingViewData]
	  );
	  const financeBillingLastTrackedDataIdentityKey = shouldRunFinanceBillingEffect
	      ? billingEffectDataIdentityKey(lastDiffTrackedDataRef.current)
	      : '';
	  const hasBillingRelevantSaveDiffHints =
	      shouldRunFinanceBillingEffect && hasBillingRelevantDirtyCollections(dirtyPbCollectionsRef.current);

	  const localDataRequiresClientBilling = useMemo(() => {
	      if (!financeBillingViewData) return false;
	      if (hasBillingRelevantSaveDiffHints) return true;
	      if (!lastDiffTrackedDataRef.current) return false;
	      return financeBillingLastTrackedDataIdentityKey !== financeBillingDataIdentityKey;
	  }, [
	      financeBillingDataIdentityKey,
	      financeBillingLastTrackedDataIdentityKey,
	      financeBillingViewData,
	      hasBillingRelevantSaveDiffHints,
	  ]);

	  const financeBillingKey = useMemo(() => {
	      if (!financeBillingViewData) return '';
      const projectId = financeBillingViewProjectId || financeBillingViewData.tenants?.[0]?.projectId || '';
      return [
	          projectId,
	          financeBillingViewMonth,
	          financeBillingDataIdentityKey,
	      ].join('|');
	  }, [financeBillingDataIdentityKey, financeBillingViewData, financeBillingViewMonth, financeBillingViewProjectId]);

  useEffect(() => {
      if (!financeBillingViewData) return;
      if (!financeBillingCloudConnected || !financeBillingAuthEnabled || !financeBillingViewCloudConfig?.projectId) return;
      const [yearPart, monthPart] = financeBillingViewMonth.split('-');
      const year = Number.parseInt(yearPart, 10);
      const month = Number.parseInt(monthPart, 10);
      if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return;
      let cancelled = false;
      const key = financeBillingKey;
      setFinanceBillingState((prev) => ({
          key,
          rows: prev.key === key ? prev.rows : [],
          loading: true,
      }));
      const request = localDataRequiresClientBilling
          ? fetchCloudDraftComputedBilling(financeBillingViewCloudConfig, financeBillingViewData, {
              year,
              month,
          }, buildDraftPayloadForCompute(financeBillingViewData))
          : fetchCloudComputedBilling(financeBillingViewCloudConfig, { year, month });
      request
          .then((result) => {
              if (cancelled) return;
              if (result.success && result.billingDetails) {
                  setFinanceBillingState({ key, rows: result.billingDetails, loading: false });
              } else {
                  setFinanceBillingState({
                      key,
                      rows: [],
                      loading: false,
                      error: result.message || '后台应收计算失败',
                  });
              }
          })
          .catch((e) => {
              if (cancelled) return;
              setFinanceBillingState({
                  key,
                  rows: [],
                  loading: false,
                  error: e instanceof Error ? e.message : '后台应收计算失败',
              });
          });
      return () => { cancelled = true; };
	  }, [
		      financeBillingAuthEnabled,
		      financeBillingCloudConnected,
	      financeBillingCloudScopeKey,
	      financeBillingDataIdentityKey,
	      financeBillingKey,
		      financeBillingViewMonth,
		      localDataRequiresClientBilling,
		      buildDraftPayloadForCompute,
		  ]);

	  useEffect(() => {
	      if (!financeBillingViewData) return;
	      const canUseServerBilling =
	          financeBillingCloudConnected &&
	          financeBillingAuthEnabled &&
	          !!financeBillingViewCloudConfig?.projectId;
		      if (canUseServerBilling || getLoadedDashboardMetricsModule()) return;
	      let cancelled = false;
	      loadDashboardMetricsModule()
	          .then(() => {
	              if (!cancelled) setLocalComputeModuleRevision((v) => v + 1);
	          })
	          .catch((error) => {
	              console.warn('[finance billing] 本地应收模块加载失败:', error);
	          });
	      return () => { cancelled = true; };
		  }, [financeBillingAuthEnabled, financeBillingCloudConnected, financeBillingCloudScopeKey, shouldRunFinanceBillingEffect]);

  const financeServerBillingDetails = useMemo<FinanceServerBillingDetails | undefined>(() => {
      if (!shouldBuildFinanceBillingKey) return undefined;
      if (financeBillingState.key !== financeBillingKey) return undefined;
      if (financeBillingState.loading || financeBillingState.error) return undefined;
	      return {
	          periodYYYYMM: financeReceivableMonth,
	          rows: financeBillingState.rows,
	          ready: true,
	      };
	  }, [financeBillingKey, financeBillingState, financeReceivableMonth, shouldBuildFinanceBillingKey]);

	  const getFinanceBillingDetails = React.useCallback((year: number, month: number) => {
	      const sourceData = financeBillingViewDataRef.current;
	      if (!sourceData) return [];
	      const billingConfig = financeBillingViewCloudConfigRef.current;
	      const canUseServerBilling =
	          financeBillingCloudConnected &&
	          financeBillingAuthEnabled &&
	          !!billingConfig?.projectId;
		      if (
		          canUseServerBilling &&
		          (financeBillingState.key !== financeBillingKey || financeBillingState.loading || !!financeBillingState.error)
	      ) {
	          return [];
		      }
		      const metricsModule = getLoadedDashboardMetricsModule();
		      return metricsModule
		          ? metricsModule.buildBillingDetailsForPeriod(year, month, sourceData, metricsModule.getOrCreateBillingCacheFor(sourceData))
		          : [];
	  }, [
		      financeBillingAuthEnabled,
		      financeBillingCloudConnected,
	      financeBillingCloudScopeKey,
	      financeBillingDataIdentityKey,
	      financeBillingKey,
	      financeBillingState.error,
	      financeBillingState.key,
	      financeBillingState.loading,
		      localComputeModuleRevision,
		  ]);

	  const persistCloudConfig = (next: CloudConfig) => {
      localStorage.setItem(CLOUD_CONFIG_KEY, JSON.stringify(cloudConfigForStorage(next)));
  };

  const handleCloudConfigSave = async () => {
      setIsTestingCloud(true);
      setCloudConnectionMsg(null);
      await new Promise(r => setTimeout(r, 600));
      persistCloudConfig(cloudConfig);
      
      // 初始化云服务
      await initCloud(cloudConfig);
      
      const connected = await checkConnection(cloudConfig);
      setIsCloudConnected(connected);
      setIsTestingCloud(false);
      
      if(connected) {
          setCloudConnectionMsg({type: 'success', text: "连接成功！"});
          fetchCloudHistory(cloudConfig);
      } else {
          setCloudConnectionMsg({type: 'error', text: "连接失败，请检查网络。"});
      }
  };

  const loadAuthorizedParks = async () => {
      const parksRes = await fetchAuthorizedParks();
      if (parksRes.success) setAuthorizedParks(parksRes.parks);
      return parksRes;
  };

  const isGlobalAdmin = (user: AuthUser | null = authUser) =>
      user?.role === 'platform_admin' || user?.role === 'group_admin';
  const isPlatformAdmin = (user: AuthUser | null = authUser) =>
      user?.role === 'platform_admin';
  const isParkManagerOrAbove = (user: AuthUser | null = authUser) => isParkManagerRole(user?.role);
  const canAccessSystemSettings = isGlobalAdmin();

	  const resolveInitialProjectId = (user: AuthUser, parks: ParkInfo[], storedProjectId?: string) => {
	      const activeParkIds = parks.filter(park => park.enabled).map(park => park.projectId);
	      const allowed = user.role === 'platform_admin'
	          ? activeParkIds
	          : user.allowedProjectIds.length
            ? user.allowedProjectIds
            : [user.projectId];
	      if (storedProjectId && allowed.includes(storedProjectId)) return storedProjectId;
	      return user.projectId || allowed[0] || storedProjectId || DEFAULT_CLOUD_CONFIG.projectId;
	  };

	  const dashboardMruKey = React.useCallback((
	      projectId: string,
	      year: number = selectedYear,
	      quarter: DashboardQuarter = selectedQuarter,
	      month: string = billingSelectedMonth,
	  ) => [projectId || '', year, quarter, month].join('|'), [billingSelectedMonth, selectedQuarter, selectedYear]);

	  const rememberDashboardMru = React.useCallback((
	      projectId: string,
	      dataToRemember: DashboardData,
	      year: number = selectedYear,
	      quarter: DashboardQuarter = selectedQuarter,
	      month: string = billingSelectedMonth,
	  ) => {
	      if (!projectId || !hasMeaningfulDashboardPayload(dataToRemember)) return;
	      const key = dashboardMruKey(projectId, year, quarter, month);
	      dashboardMruCacheRef.current.set(key, {
	          data: dataToRemember,
	          year,
	          quarter,
	          billingSelectedMonth: month,
	          loadedAt: Date.now(),
	      });
	      while (dashboardMruCacheRef.current.size > DASHBOARD_MRU_MAX_ENTRIES) {
	          const firstKey = dashboardMruCacheRef.current.keys().next().value;
	          if (!firstKey) break;
	          dashboardMruCacheRef.current.delete(firstKey);
	      }
	  }, [billingSelectedMonth, dashboardMruKey, selectedQuarter, selectedYear]);

	  const queuePrevYearTrendsBackfill = React.useCallback((args: {
	      projectId: string;
	      year: number;
	      quarter: DashboardQuarter;
	      billingSelectedMonth: string;
	      shouldApply?: () => boolean;
	  }) => {
	      const projectId = args.projectId.trim();
	      if (INITIAL_DASHBOARD_INCLUDE_PREV_YEAR_TRENDS) return;
	      if (!serverComputeEnabled || activeTab !== 'dashboard' || !isCloudConnected || !authUser?.enabled || !projectId) return;
	      const shouldApply = args.shouldApply || (() => true);
	      const key = [projectId, args.year, args.quarter, args.billingSelectedMonth, 'prev-year'].join('|');
	      if (prevYearTrendsBackfillRef.current.has(key)) return;
	      prevYearTrendsBackfillRef.current.add(key);
	      const targetConfig = { ...cloudConfig, projectId };
	      void fetchCloudComputedDashboard(targetConfig, {
	          year: args.year,
	          quarter: args.quarter,
	          billingSelectedMonth: args.billingSelectedMonth,
	          quickMode: false,
	          includeCurrentMonthBilling: false,
	          includePrevYearTrends: true,
	      })
	          .then(async (res) => {
	              const trends = res?.processedData?.prevYearMonthlyTrends || [];
	              if (!res?.success || trends.length === 0 || !shouldApply()) return;
	              if (currentProjectIdRef.current !== projectId) return;
	              const current = dataRef.current;
	              if (!current || await hasLocalPendingChanges(current, projectId)) return;
	              const nextData = {
	                  ...current,
	                  prevYearMonthlyTrends: trends,
	              };
	              dataRef.current = nextData;
	              React.startTransition(() => {
	                  setData(nextData);
	              });
	              rememberDashboardMru(projectId, nextData, args.year, args.quarter, args.billingSelectedMonth);
	              parkDataPutObj(getParkStorageKey(projectId), nextData);
	          })
	          .catch((e) => {
	              console.warn('[dashboard] 去年同比趋势后台补算失败:', e);
	          })
	          .finally(() => {
	              prevYearTrendsBackfillRef.current.delete(key);
	          });
	  }, [
	      activeTab,
	      authUser,
	      cloudConfig,
	      hasLocalPendingChanges,
	      isCloudConnected,
	      rememberDashboardMru,
	      serverComputeEnabled,
	  ]);

	  const loadCloudHistoryInBackground = React.useCallback((
	      configForHistory: CloudConfig,
	      shouldApply: () => boolean = () => true,
	  ) => {
	      void getCloudHistory(configForHistory)
	          .then((historyRes) => {
	              if (!shouldApply()) return;
	              if (historyRes.success && historyRes.data && historyRes.data.length > 0) {
	                  setCloudHistory(historyRes.data);
	                  setLatestBackup(historyRes.data[0]);
	              }
	          })
	          .catch((e) => {
	              console.error('[App] 加载备份历史失败:', e);
	          });
	  }, []);

	  const prefetchParkDashboard = React.useCallback((projectId: string) => {
	      const targetProjectId = projectId.trim();
	      if (!targetProjectId || targetProjectId === cloudConfig.projectId) return;
	      if (!authUser?.enabled) return;
	      if (!isGlobalAdmin(authUser) && !authUser.allowedProjectIds.includes(targetProjectId)) return;
	      const key = dashboardMruKey(targetProjectId);
	      if (dashboardMruCacheRef.current.has(key) || dashboardPrefetchPromiseRef.current.has(key)) return;
	      const nextConfig = { ...cloudConfig, projectId: targetProjectId };
	      const dashboardOptions = {
	          year: selectedYear,
	          quarter: selectedQuarter,
	          billingSelectedMonth,
	          quickMode: activeTab !== 'dashboard',
	          includeCurrentMonthBilling: false,
                  includePrevYearTrends: INITIAL_DASHBOARD_INCLUDE_PREV_YEAR_TRENDS,
	      } as const;
	      const request = Promise.all([
	          fetchCloudKpiSnapshot(nextConfig, selectedYear).catch(() => null),
	          fetchCloudDashboardBootstrap(nextConfig, dashboardOptions).catch(() => null),
	      ])
	          .then(([, bootstrap]) => {
	              if (bootstrap?.success && bootstrap.processedData) {
	                  const scoped = scopeCachedDashboardData(
	                      { ...generateInitialData(), ...bootstrap.processedData },
	                      authUser,
	                      targetProjectId,
	                  );
	                  rememberDashboardMru(
	                      targetProjectId,
	                      scoped,
	                      selectedYear,
	                      selectedQuarter,
	                      billingSelectedMonth,
	                  );
	                  parkDataPutObj(getParkStorageKey(targetProjectId), scoped);
	              }
	          })
	          .catch((e) => {
	              console.warn('[park-prefetch] 预取园区看板失败:', e);
	          })
	          .finally(() => {
	              dashboardPrefetchPromiseRef.current.delete(key);
	          });
	      dashboardPrefetchPromiseRef.current.set(key, request);
	  }, [
	      activeTab,
	      authUser,
	      billingSelectedMonth,
	      cloudConfig,
	      dashboardMruKey,
	      isGlobalAdmin,
	      rememberDashboardMru,
	      selectedQuarter,
	      selectedYear,
	  ]);

	  const switchProject = async (projectId: string) => {
      const targetProjectId = projectId.trim();
      if (!targetProjectId || targetProjectId === cloudConfig.projectId) return;
      if (authUser && !isGlobalAdmin(authUser) && !authUser.allowedProjectIds.includes(targetProjectId)) {
          showGlassNotice({
              title: '无权访问园区',
              message: '当前账号未被授权访问该园区。',
              tone: 'amber',
          });
          return;
      }

      const switchSeq = ++projectSwitchSeqRef.current;
      const isLatestSwitch = () =>
          projectSwitchSeqRef.current === switchSeq &&
          currentProjectIdRef.current === targetProjectId;
      const nextConfig = { ...cloudConfig, projectId: targetProjectId };
      currentProjectIdRef.current = targetProjectId;
      setIsSyncing(true);
      React.startTransition(() => {
          setCloudConfig(nextConfig);
      });
      localStorage.setItem(CLOUD_CONFIG_KEY, JSON.stringify(cloudConfigForStorage(nextConfig)));
      setRecordMeta({});
      baselineSnapshotRef.current = null;
      bumpSaveBaselineRevision();
      dataLoadScopeRef.current = FULL_DASHBOARD_LOAD_SCOPE;
      resetSaveDiffHints(null);
	      setPendingConflicts([]);
	      try {
	          const connectionPromise = checkConnection(nextConfig).catch(() => false);
	          void connectionPromise.then((connected) => {
	              if (isLatestSwitch()) setIsCloudConnected(connected);
	          });
	          const mruEntry = dashboardMruCacheRef.current.get(
	              dashboardMruKey(targetProjectId, selectedYear, selectedQuarter, billingSelectedMonth),
	          );
	          const cachedPromise = mruEntry
	              ? Promise.resolve<string | null>(null)
	              : parkDataGet(getParkStorageKey(targetProjectId));
		          const snapshotPromise = fetchCloudKpiSnapshot(nextConfig, selectedYear).catch(() => null);
		          const dashboardOptions = {
		              year: selectedYear,
		              quarter: selectedQuarter,
	              billingSelectedMonth,
		              quickMode: activeTab !== 'dashboard',
		              includeCurrentMonthBilling: false,
                  includePrevYearTrends: INITIAL_DASHBOARD_INCLUDE_PREV_YEAR_TRENDS,
		          } as const;
		          const bootstrapPromise = fetchCloudDashboardBootstrap(nextConfig, dashboardOptions).catch(() => null);
		          let switchPreviewShown = false;

	          let cachedData: DashboardData | null = mruEntry
	              ? scopeCachedDashboardData(
	                  { ...generateInitialData(), ...mruEntry.data },
	                  authUser,
	                  targetProjectId,
	              )
	              : null;
	          const cached = await cachedPromise;
          if (!cachedData && cached) {
              try {
                  cachedData = scopeCachedDashboardData(
                      { ...generateInitialData(), ...JSON.parse(cached) },
                      authUser,
                      targetProjectId,
                  );
              } catch (e) {
                  console.warn('[App] 读取目标园区本地缓存失败:', e);
              }
          }
          if (cachedData && isLatestSwitch()) {
              React.startTransition(() => {
                  setIsKpiPreview(false);
                  setData(cachedData!);
              });
          }

	          const earlyBootstrapRes = await withSoftTimeout(
	              bootstrapPromise,
	              cachedData ? 0 : PARK_SWITCH_BOOTSTRAP_PREVIEW_GRACE_MS,
	              null,
	          );
	          if (await applyComputedDashboardLoad({
	              result: earlyBootstrapRes,
	              localData: cachedData,
	              year: selectedYear,
	              quarter: selectedQuarter,
	              projectId: targetProjectId,
	              shouldApply: isLatestSwitch,
	          })) {
	              if (isLatestSwitch()) loadCloudHistoryInBackground(nextConfig, isLatestSwitch);
	              return;
	          }

	          const snapshotRes = cachedData ? null : await snapshotPromise;
	          if (!cachedData && snapshotRes?.success && snapshotRes.snapshot && isLatestSwitch()) {
		              isKpiPreviewRef.current = true;
		              setIsKpiPreview(true);
		              switchPreviewShown = true;
	              React.startTransition(() => {
		                  setData(buildDashboardDataFromKpiSnapshot(snapshotRes.snapshot!));
		              });
          }
          const bootstrapRes = earlyBootstrapRes || await bootstrapPromise;
          if (await applyComputedDashboardLoad({
              result: bootstrapRes,
              localData: cachedData,
              year: selectedYear,
              quarter: selectedQuarter,
              projectId: targetProjectId,
              shouldApply: isLatestSwitch,
          })) {
              if (isLatestSwitch()) loadCloudHistoryInBackground(nextConfig, isLatestSwitch);
		              return;
	          }
	          const computedRes = await fetchCloudComputedDashboard(nextConfig, dashboardOptions).catch(() => null);
	          if (await applyComputedDashboardLoad({
	              result: computedRes,
	              localData: cachedData,
	              year: selectedYear,
	              quarter: selectedQuarter,
	              projectId: targetProjectId,
		              shouldApply: isLatestSwitch,
		          })) {
		              if (isLatestSwitch()) loadCloudHistoryInBackground(nextConfig, isLatestSwitch);
		              return;
		          }
		          const backupPromise = fetchCloudBackup(nextConfig, targetProjectId);
		          const [targetCloudConnected, res] = await Promise.all([connectionPromise, backupPromise]);
		          if (!isLatestSwitch()) return;
			          const allowLocalDashboardMetricsFallback = shouldRunLocalDashboardMetricsForCloudLoad({
			              cloudConnected: targetCloudConnected,
			              authEnabled: !!authUser?.enabled,
			              projectId: targetProjectId,
			              serverAttempted: true,
			          });
	          if (res.success && res.data) {
	              const safeCloudData = { ...generateInitialData(), ...res.data };
	              const displayData = cachedData
	                  ? mergeLocalDashboardCacheIntoCloud(safeCloudData, cachedData).data
	                  : safeCloudData;
	              captureBaselineFromCloud(safeCloudData, res.recordMeta, targetProjectId);
	              if (!allowLocalDashboardMetricsFallback) {
	                  if (!cachedData && !switchPreviewShown) {
	                      applyDashboardPreviewData(displayData);
	                  } else {
	                      isKpiPreviewRef.current = true;
	                      setIsKpiPreview(true);
	                  }
		              } else if (hasMeaningfulDashboardPayload(safeCloudData)) {
		                  const processed = await recalculateMetrics(displayData, selectedYear, selectedQuarter, isLatestSwitch);
		                  if (!isLatestSwitch()) return;
		                  rememberDashboardMru(targetProjectId, processed, selectedYear, selectedQuarter, billingSelectedMonth);
		                  parkDataPutObj(getParkStorageKey(targetProjectId), processed);
	              } else if (cached) {
	                  await recalculateMetrics(cachedData || generateInitialData(), selectedYear, selectedQuarter, isLatestSwitch);
	              } else {
	                  await recalculateMetrics(displayData, selectedYear, selectedQuarter, isLatestSwitch);
	              }
	          } else if (cachedData) {
	              if (!allowLocalDashboardMetricsFallback) {
	                  isKpiPreviewRef.current = true;
	                  setIsKpiPreview(true);
	              } else {
	                  await recalculateMetrics(cachedData, selectedYear, selectedQuarter, isLatestSwitch);
	              }
	          } else {
	              if (!allowLocalDashboardMetricsFallback) {
	                  applyDashboardPreviewData(generateInitialData());
	              } else {
	                  await recalculateMetrics(generateInitialData(), selectedYear, selectedQuarter, isLatestSwitch);
	              }
	          }
          if (isLatestSwitch()) {
              loadCloudHistoryInBackground(nextConfig, isLatestSwitch);
          }
      } catch (e) {
          if (!isLatestSwitch()) return;
          console.error('[App] 切换园区失败:', e);
          showGlassNotice({
              title: '切换园区失败',
              message: '请检查网络或权限后再试。',
              tone: 'rose',
          });
      } finally {
          if (isLatestSwitch()) setIsSyncing(false);
      }
  };

  const loadManagedUsers = async () => {
      if (!isPlatformAdmin()) return;
      setIsLoadingManagedUsers(true);
      setManagedUsersError(null);
      const res = await fetchManagedCloudUsers();
      if (res.success) {
          setManagedUsers(res.users);
          if (!newUserForm.projectId) {
              setNewUserForm(prev => ({ ...prev, projectId: cloudConfig.projectId || authUser?.projectId || '' }));
          }
      } else {
          setManagedUsersError(res.message || '登录人员列表加载失败');
      }
      setIsLoadingManagedUsers(false);
  };

  const loadSignupRequests = async () => {
      if (!isPlatformAdmin()) return;
      setIsLoadingSignupRequests(true);
      setSignupRequestsError(null);
      const res = await fetchCloudSignupRequests();
      if (res.success) {
          setSignupRequests(res.requests);
      } else {
          setSignupRequestsError(res.message || '注册申请加载失败');
      }
      setIsLoadingSignupRequests(false);
  };

  const loadPublicParkOptions = async () => {
      setIsLoadingPublicParks(true);
      const res = await fetchPublicCloudParks();
      if (res.success) {
          setPublicParks(res.parks);
      } else {
          setPublicParks([]);
      }
      setIsLoadingPublicParks(false);
  };

  const handleLogin = async (event?: React.FormEvent) => {
      event?.preventDefault();
      setIsLoggingIn(true);
      setLoginError(null);
      const nextConfig = {
          ...cloudConfig,
          pocketbaseUrl: cloudConfig.pocketbaseUrl || DEFAULT_CLOUD_CONFIG.pocketbaseUrl || '/api/pb',
          pocketbaseEmail: '',
          pocketbasePassword: '',
      };
      const res = await loginCloudUser(nextConfig, loginForm.email, loginForm.password);
      if (!res.success || !res.user) {
          setLoginError(res.message);
          setIsLoggingIn(false);
          return;
      }
      const parksRes = await fetchAuthorizedParks();
      if (parksRes.success) setAuthorizedParks(parksRes.parks);
      const projectId = resolveInitialProjectId(res.user, parksRes.success ? parksRes.parks : [], cloudConfig.projectId);
      const authedConfig = { ...nextConfig, projectId };
      setAuthUser(res.user);
      const loginUser = res.user;
      setCloudConfig(authedConfig);
      localStorage.setItem(CLOUD_CONFIG_KEY, JSON.stringify(cloudConfigForStorage(authedConfig)));
      const connected = await checkConnection(authedConfig);
      setIsCloudConnected(connected);
      setIsLoggingIn(false);
      setIsSyncing(true);
	      try {
	          const snapshotPromise = fetchCloudKpiSnapshot(authedConfig, selectedYear).catch(() => null);
		          const dashboardOptions = {
		              year: selectedYear,
		              quarter: selectedQuarter,
		              billingSelectedMonth,
		              quickMode: activeTab !== 'dashboard',
		              includeCurrentMonthBilling: false,
                  includePrevYearTrends: INITIAL_DASHBOARD_INCLUDE_PREV_YEAR_TRENDS,
		          } as const;
		          const bootstrapPromise = fetchCloudDashboardBootstrap(authedConfig, dashboardOptions).catch(() => null);
	          const allowLocalDashboardMetricsFallback = shouldRunLocalDashboardMetricsForCloudLoad({
	              cloudConnected: connected,
	              authEnabled: !!loginUser?.enabled,
	              projectId,
	              serverAttempted: true,
	          });
	          let loginPreviewShown = false;
	          const snapshotRes = await snapshotPromise;
	          if (snapshotRes?.success && snapshotRes.snapshot) {
	              isKpiPreviewRef.current = true;
	              setIsKpiPreview(true);
	              loginPreviewShown = true;
	              setData(buildDashboardDataFromKpiSnapshot(snapshotRes.snapshot));
	          }
          const cachedRaw = localStorage.getItem(getParkStorageKey(projectId));
          const cachedData = cachedRaw
              ? scopeCachedDashboardData(
                    { ...generateInitialData(), ...JSON.parse(cachedRaw) },
                    loginUser,
                    projectId,
                )
              : null;
	          const bootstrapRes = await bootstrapPromise;
	          if (await applyComputedDashboardLoad({
	              result: bootstrapRes,
	              localData: cachedData,
	              year: selectedYear,
	              quarter: selectedQuarter,
	              projectId,
	          })) {
	              await fetchCloudHistory(authedConfig);
	              return;
	          }
	          const computedRes = await fetchCloudComputedDashboard(authedConfig, dashboardOptions).catch(() => null);
	          if (await applyComputedDashboardLoad({
	              result: computedRes,
	              localData: cachedData,
	              year: selectedYear,
	              quarter: selectedQuarter,
	              projectId,
	          })) {
	              await fetchCloudHistory(authedConfig);
	              return;
	          }
          const backupRes = await fetchCloudBackup(authedConfig, projectId);
          if (backupRes.success && backupRes.data) {
              const safeCloudData = { ...generateInitialData(), ...backupRes.data };
	              const displayData = cachedData
	                  ? mergeLocalDashboardCacheIntoCloud(safeCloudData, cachedData).data
	                  : safeCloudData;
	              captureBaselineFromCloud(safeCloudData, backupRes.recordMeta, projectId);
	              if (!allowLocalDashboardMetricsFallback) {
	                  if (!loginPreviewShown) {
	                      applyDashboardPreviewData(displayData);
	                  }
		              } else if (hasMeaningfulDashboardPayload(safeCloudData)) {
		                  const processed = await recalculateMetrics(displayData, selectedYear, selectedQuarter);
		                  rememberDashboardMru(projectId, processed, selectedYear, selectedQuarter, billingSelectedMonth);
		                  parkDataPutObj(getParkStorageKey(projectId), processed);
	              } else {
                  if (cachedRaw) {
                      const cachedOnly = scopeCachedDashboardData(
                          { ...generateInitialData(), ...JSON.parse(cachedRaw) },
                          loginUser,
                          projectId,
                      );
                      await recalculateMetrics(cachedOnly, selectedYear, selectedQuarter);
                  } else {
                      await recalculateMetrics(displayData, selectedYear, selectedQuarter);
                  }
              }
              await fetchCloudHistory(authedConfig);
	          } else {
	              const cached = localStorage.getItem(getParkStorageKey(projectId));
	              if (cached) {
	                  const cachedData = scopeCachedDashboardData(
	                      { ...generateInitialData(), ...JSON.parse(cached) },
	                      loginUser,
	                      projectId,
	                  );
	                  if (allowLocalDashboardMetricsFallback) {
	                      recalculateMetrics(cachedData, selectedYear, selectedQuarter);
	                  } else {
	                      applyDashboardPreviewData(cachedData);
	                  }
	              } else {
	                  if (allowLocalDashboardMetricsFallback) {
	                      recalculateMetrics(generateInitialData(), selectedYear, selectedQuarter);
	                  } else if (!loginPreviewShown) {
	                      applyDashboardPreviewData(generateInitialData());
	                  }
	              }
	          }
      } finally {
          setIsSyncing(false);
      }
  };

  const handleSignupSubmit = async (event?: React.FormEvent) => {
      event?.preventDefault();
      setSignupMsg(null);
      const applicantName = signupForm.applicantName.trim();
      const email = signupForm.email.trim();
      const password = signupForm.password.trim();
      if (!applicantName || !email || !password || signupForm.requestedProjectIds.length === 0) {
          setSignupMsg('请填写姓名、账号、密码并至少选择一个园区。');
          return;
      }
      setIsSubmittingSignup(true);
      const res = await submitCloudSignupRequest(email, password, signupForm.requestedProjectIds, applicantName);
      setIsSubmittingSignup(false);
      setSignupMsg(res.message);
      if (res.success) {
          setSignupForm({ applicantName: '', email: '', password: '', requestedProjectIds: [] });
          setAuthMode('login');
      }
  };

  /** 已通过注册审批的申请，按申请园区归类（一人多园区则在多个园区下各显示一条） */
  const approvedSignupByPark = useMemo(() => {
      const approved = signupRequests.filter((r) => r.status === 'approved');
      const byPark = new Map<string, SignupRequestRecord[]>();
      for (const req of approved) {
          for (const pid of req.requestedProjectIds) {
              if (!byPark.has(pid)) byPark.set(pid, []);
              byPark.get(pid)!.push(req);
          }
      }
      for (const list of byPark.values()) {
          list.sort((a, b) => String(b.approvedAt || '').localeCompare(String(a.approvedAt || '')));
      }
      const parkOrder: string[] = [];
      for (const p of authorizedParks) {
          if (byPark.has(p.projectId)) parkOrder.push(p.projectId);
      }
      for (const pid of Array.from(byPark.keys()).sort()) {
          if (!parkOrder.includes(pid)) parkOrder.push(pid);
      }
      return { byPark, parkOrder };
  }, [signupRequests, authorizedParks]);

  const handleLogout = () => {
      logoutCloudUser();
      setAuthUser(null);
      setAuthorizedParks([]);
      setRecordMeta({});
      baselineSnapshotRef.current = null;
      bumpSaveBaselineRevision();
      dataLoadScopeRef.current = FULL_DASHBOARD_LOAD_SCOPE;
      resetSaveDiffHints(null);
      setPendingConflicts([]);
  };

  const openChangePasswordModal = () => {
      setChangePasswordForm({ oldPassword: '', newPassword: '', confirmPassword: '' });
      setChangePasswordError(null);
      setIsChangePasswordOpen(true);
  };

  const closeChangePasswordModal = () => {
      if (changePasswordSaving) return;
      setIsChangePasswordOpen(false);
      setChangePasswordError(null);
  };

  const handleChangePasswordSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      const oldPassword = changePasswordForm.oldPassword.trim();
      const newPassword = changePasswordForm.newPassword.trim();
      const confirmPassword = changePasswordForm.confirmPassword.trim();
      if (!oldPassword || !newPassword) {
          setChangePasswordError('请填写当前密码和新密码');
          return;
      }
      if (newPassword.length < 8) {
          setChangePasswordError('新密码长度至少 8 位');
          return;
      }
      if (newPassword !== confirmPassword) {
          setChangePasswordError('两次输入的新密码不一致');
          return;
      }
      setChangePasswordSaving(true);
      setChangePasswordError(null);
      const res = await changeOwnCloudPassword(oldPassword, newPassword);
      setChangePasswordSaving(false);
      if (!res.success) {
          setChangePasswordError(res.message || '改密失败');
          return;
      }
      if (res.user) setAuthUser(res.user);
      setIsChangePasswordOpen(false);
      setChangePasswordForm({ oldPassword: '', newPassword: '', confirmPassword: '' });
      showGlassNotice({
          title: '密码已更新',
          message: '下次登录请使用新密码。',
          tone: 'blue',
      });
  };

  const displayUserName = authUser?.name?.trim() || authUser?.email || '用户';

  const fetchCloudHistory = async (config = cloudConfig) => {
      setIsLoadingHistory(true);
      const res = await getCloudHistory(config);
      setIsLoadingHistory(false);
      if (res.success && res.data) setCloudHistory(res.data);
      return res;
  };

	  const bumpVersionAfterSuccessfulWrite = async (
	      current: DashboardData,
	      options?: { syncLocalVersion?: boolean }
	  ): Promise<number | null> => {
	      try {
	          const v = await bumpCloudSaveVersion(cloudConfig);
	          if (typeof v === 'number' && options?.syncLocalVersion === true) {
	              commitDataWithoutMetrics({ ...current, cloudSaveVersion: v });
	          }
	          return v;
      } catch (e) {
          console.warn('[App] 版本号递增失败（非关键）:', e);
          return null;
      }
  };

  /** 版本冲突：提示用户并可选从 PocketBase 重新拉取 */
  const handleCloudSaveConflict = async (): Promise<boolean> => {
      const confirmed = await showGlassConfirm({
          title: '云端数据已更新',
          message:
              '云端数据已被他人更新（或您在其他窗口已保存过）。\n\n若继续保留当前界面上的编辑，请先不要保存；建议加载服务器最新数据后再继续编辑。\n\n加载后当前未同步修改将被放弃。',
          tone: 'amber',
          confirmText: '加载最新数据',
          cancelText: '暂不处理',
      });
      if (!confirmed) {
          return false;
      }
	      const dashboardOptions = {
	          year: selectedYear,
	          quarter: selectedQuarter,
	          billingSelectedMonth,
	          quickMode: activeTab !== 'dashboard',
	          includeCurrentMonthBilling: false,
                  includePrevYearTrends: INITIAL_DASHBOARD_INCLUDE_PREV_YEAR_TRENDS,
	      } as const;
	      const bootstrap = await fetchCloudDashboardBootstrap(cloudConfig, dashboardOptions).catch(() => null);
	      if (await applyComputedDashboardLoad({
	          result: bootstrap,
	          localData: null,
	          year: selectedYear,
	          quarter: selectedQuarter,
	          projectId: cloudConfig.projectId || '',
	      })) {
          await showGlassNotice({
              title: '已加载最新数据',
              message: '服务器上的最新数据已加载，版本号已更新。您可在此基础上继续编辑。',
              tone: 'blue',
	          });
	          return true;
	      }
	      const computed = await fetchCloudComputedDashboard(cloudConfig, dashboardOptions).catch(() => null);
	      if (await applyComputedDashboardLoad({
	          result: computed,
	          localData: null,
	          year: selectedYear,
	          quarter: selectedQuarter,
	          projectId: cloudConfig.projectId || '',
	      })) {
	          await showGlassNotice({
	              title: '已加载最新数据',
	              message: '服务器上的最新数据已加载，版本号已更新。您可在此基础上继续编辑。',
	              tone: 'blue',
	          });
	          return true;
	      }
	      const conflictRefreshScope = dataLoadScopeRef.current;
      const res = await fetchCloudBackup(
          cloudConfig,
          cloudConfig.projectId || '',
          backupOptionsForLoadScope(conflictRefreshScope)
      );
	      if (res.success && res.data) {
	          const safeData = { ...generateInitialData(), ...res.data };
	          captureBaselineFromCloud(safeData, res.recordMeta, cloudConfig.projectId, conflictRefreshScope);
	          if (shouldRunLocalDashboardMetricsForCloudLoad({
	              cloudConnected: isCloudConnected,
	              authEnabled: !!authUser?.enabled,
	              projectId: cloudConfig.projectId,
	              serverAttempted: true,
	          })) {
	              await recalculateMetrics(safeData, selectedYear, selectedQuarter);
	              await showGlassNotice({
	                  title: '已加载最新数据',
	                  message: '服务器上的最新数据已加载，版本号已更新。您可在此基础上继续编辑。',
	                  tone: 'blue',
	              });
	          } else {
	              applyDashboardPreviewData(safeData);
	              await showGlassNotice({
	                  title: '已加载业务数据',
	                  message: '已加载服务器上的最新业务数据，但后台指标计算失败；当前保持只读预览状态，请后台恢复后再编辑或保存。',
	                  tone: 'amber',
	              });
	          }
	          return true;
	      }
      await showGlassNotice({
          title: '加载最新数据失败',
          message: res.message || '未知错误',
          tone: 'rose',
      });
      return false;
  };

  const getManualCloudSaveGuard = React.useCallback((currentData: DashboardData | null | undefined) => {
      const targetProjectId = cloudConfig.projectId || '';
      const consistencyCheck = currentData
          ? validateDataProjectConsistency(currentData, targetProjectId)
          : { consistent: false, mismatchCount: 0, totalChecked: 0 };
      return validateManualCloudSave({
          currentData,
          isPreview: isKpiPreviewRef.current,
          cloudConnected: isCloudConnected,
          currentProjectId: targetProjectId,
          dataProjectConsistent: consistencyCheck.consistent,
      });
  }, [cloudConfig.projectId, isCloudConnected]);

  const openSnapshotModal = () => {
      const saveGuard = getManualCloudSaveGuard(dataRef.current);
      if (!saveGuard.allowed) {
          showGlassNotice({
              title: '暂不能保存',
              message: saveGuard.message,
              tone: 'amber',
          });
          return;
      }
      setSnapshotNote('');
      setIsSnapshotModalOpen(true);
  };

  /**
   * 「云端加载完成」后的统一收尾：
   *   - 更新 recordMeta（行级乐观锁基准）
   *   - 用刚加载的 data 生成 baseline 快照（用于下次保存的自动 diff）
   *   - 清空 dirtyTracker（避免上一轮残留登记）
   *
   * 调用方：fetchCloudBackup 成功后；以及保存成功后再次 fetch 后。
   */
  const captureBaselineFromCloud = (
      cloudData: DashboardData,
      meta?: RecordMeta,
      projectId = cloudConfig.projectId,
      loadScope: DashboardDataLoadScope = FULL_DASHBOARD_LOAD_SCOPE,
  ) => {
      dataLoadScopeRef.current = loadScope;
      if (meta) setRecordMeta(meta);
      try {
          baselineSnapshotRef.current = dashboardDataToPbRecords(
              cloudData,
              projectId || ''
          );
      } catch (e) {
          console.warn('[captureBaselineFromCloud] 生成 baseline 失败，后续保存将要求先刷新云端数据', e);
          baselineSnapshotRef.current = null;
          dataLoadScopeRef.current = FULL_DASHBOARD_LOAD_SCOPE;
      }
      bumpSaveBaselineRevision();
      resetSaveDiffHints(cloudData);
  };

  /**
   * 增量保存部分成功时，仅把已落库的行同步进 baseline / recordMeta。
   * 避免 refreshAfterSave 用「不含失败项」的云端快照覆盖基线，导致刷新页面后本地修改丢失。
   */
  const applyPartialIncrementalSave = (
      applied: IncrementalApplied[],
      currentData: DashboardData,
      projectId: string
  ) => {
      if (!applied.length) return;
      const baseline = baselineSnapshotRef.current;
      if (!baseline) return;
      const nextSnapshot = dashboardDataToPbRecords(currentData, projectId);
      const nextMeta: RecordMeta = { ...recordMetaRef.current };
      for (const row of applied) {
          if (row.newUpdated) {
              if (!nextMeta[row.collection]) nextMeta[row.collection] = {};
              nextMeta[row.collection][row.originalId] = row.newUpdated;
          }
          if (row.op === 'delete') {
              if (baseline[row.collection]) delete baseline[row.collection][row.originalId];
              continue;
          }
          const pbRow = nextSnapshot[row.collection]?.[row.originalId];
          if (!pbRow) continue;
          if (!baseline[row.collection]) baseline[row.collection] = {};
          baseline[row.collection][row.originalId] = pbRow;
      }
      setRecordMeta(nextMeta);
      bumpSaveBaselineRevision();
  };

  /**
   * 保存成功后刷新基线。
   *
   * - 自动保存路径：增量更新 baselineSnapshot + recordMeta（不拉全量）
   * - 手动/全量路径：拉取云端最新数据重建基线
   * - 后台刷新：每 10 次保存或手动保存时触发服务端重算
   */
  const fullRefreshCounterRef = React.useRef(0);

  const refreshAfterSave = async (
      currentData: DashboardData | null,
      applied?: IncrementalApplied[],
      options?: { forceRefreshServerSnapshots?: boolean }
  ) => {
      const snapshotProjectId = (cloudConfig.projectId || '').trim();

      // 增量路径：用 applied 更新 baseline/recordMeta（无需全量拉取）
      if (applied && applied.length > 0) {
          applyPartialIncrementalSave(applied, currentData || data!, snapshotProjectId);
      }

      // 服务端 compute/refresh 是 KPI 与集成快照的唯一作者；前端只触发后台刷新。
      const isManualSave = options?.forceRefreshServerSnapshots === true || (!applied && !!currentData);
      fullRefreshCounterRef.current++;
      const shouldRefreshServerSnapshots = isManualSave || fullRefreshCounterRef.current % 10 === 0;

      // 云端拉取校准：仅手动保存或每 10 次自动保存，范围与当前加载窗口保持一致。
      if (shouldRefreshServerSnapshots) {
          const refreshScope = dataLoadScopeRef.current;
          fetchCloudBackup(
              cloudConfig,
              cloudConfig.projectId || '',
              backupOptionsForLoadScope(refreshScope)
          ).then(res => {
              if (res.success && res.data) {
                  const safeData = { ...generateInitialData(), ...res.data };
                  captureBaselineFromCloud(safeData, res.recordMeta, cloudConfig.projectId, refreshScope);
              } else if (res.recordMeta) {
                  setRecordMeta(res.recordMeta);
                  resetSaveDiffHints(dataRef.current);
              }
          }).catch(e => {
              console.warn('[refreshAfterSave] 后台拉取最新数据失败（可忽略）', e);
          });
      }

      // 通知服务端重算 KPI 与集成快照
      if (shouldRefreshServerSnapshots) {
          triggerServerComputeRefresh(cloudConfig, selectedYear);
      }
  };

  /** 通知集成网关重新计算并回写 KPI / 集成快照（fire-and-forget，不阻塞保存流程） */
  const triggerServerComputeRefresh = (config: CloudConfig, year: number) => {
      const projectId = (config.projectId || '').trim();
      if (!projectId) return;
      const userToken = getCurrentCloudAuthToken();
      if (!userToken) {
          console.warn('[compute/refresh] 当前用户 token 不可用，跳过服务端快照重算');
          return;
      }
      const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userToken}`,
      };
      fetch(getIntegrationAppComputeRefreshUrl(), {
          method: 'POST',
          headers,
          body: JSON.stringify({ project_id: projectId, year }),
      }).catch(() => {
          // 网关不可用时静默失败，不影响前端正常使用
      });
  };

  /**
   * 统一的「保存到云端」入口。
   *
   * 保存策略：
   *   - 正常业务保存只允许自动 diff(baseline, current) 生成 DirtyPayload → 增量保存。
   *   - baseline 缺失时先即时读取当前园区云端快照建立基线；读取失败才拒绝保存。
   *
   * baseline 在每次 fetchCloudBackup / 保存成功后由 captureBaselineFromCloud 刷新。
   *
   * 返回值：
   *   - { ok: true } 表示已成功（或部分成功），调用方可弹出"保存成功"提示
   *   - { ok: false, conflict: true } 表示有冲突等待用户决策；本函数已 setPendingConflicts
   *   - { ok: false, message } 表示彻底失败
   */
  const runCloudSave = async (
      currentData: DashboardData,
      note: string
  ): Promise<{ ok: boolean; conflict?: boolean; conflictCount?: number; message?: string; newVersion?: number; partial?: boolean; alertTitle?: string }> => {
      const saveGuard = getManualCloudSaveGuard(currentData);
      if (!saveGuard.allowed) return { ok: false, message: saveGuard.message };
      // 保存互斥：等待获取锁（自动保存会先释放）
      const manualRelease = await acquireSaveLock();
      try {
      let baseline = baselineSnapshotRef.current;
      let baseRecordMeta = recordMeta;
      const currentLoadScope = dataLoadScopeRef.current;

      if (!baseline) {
          try {
              const baselineRes = await fetchCloudBackup(
                  cloudConfig,
                  cloudConfig.projectId || '',
                  backupOptionsForLoadScope(currentLoadScope)
              );
              if (!baselineRes.success || !baselineRes.data) {
                  return {
                      ok: false,
                      message: `当前页面缺少云端基线，且无法读取后端数据，已阻止全量覆盖保存。请确认 PocketBase 连接正常后重试。${baselineRes.message ? `\n\n后端返回：${baselineRes.message}` : ''}`,
                  };
              }
              const cloudBaseline = { ...generateInitialData(), ...baselineRes.data };
              baseline = dashboardDataToPbRecords(cloudBaseline, cloudConfig.projectId || '');
              baseRecordMeta = baselineRes.recordMeta || {};
              baselineSnapshotRef.current = baseline;
              bumpSaveBaselineRevision();
              dataLoadScopeRef.current = currentLoadScope;
              setRecordMeta(baseRecordMeta);
              resetSaveDiffHints(currentData);
          } catch (baselineError: any) {
              return {
                  ok: false,
                  message: `当前页面缺少云端基线，且读取后端数据失败，已阻止全量覆盖保存。请确认 PocketBase 连接正常后重试。\n\n错误：${baselineError?.message || '未知错误'}`,
              };
          }
      }

      // ---- 增量保存（优先 scoped diff；无 hint 时回退完整 diff）----
      const payload = buildSavePayloadFromData(
          currentData,
          baseline,
          cloudConfig.projectId || '',
          baseRecordMeta,
      );
      const summary = payloadCount(payload);

      if (summary.total === 0) {
          // 没有任何改动 —— 不打扰服务器，直接成功
          console.log('[runCloudSave] 无改动，跳过保存');
          resetSaveDiffHints(currentData);
          return { ok: true, message: '无改动，无需保存' };
      }

      // 数据一致性校验：防止跨园区数据覆盖
      const consistencyCheck = validateDataProjectConsistency(currentData, cloudConfig.projectId || '');
      if (!consistencyCheck.consistent) {
          console.error("[runCloudSave] 数据一致性校验失败:", consistencyCheck, "期望园区:", cloudConfig.projectId);
          return { ok: false, message: "数据一致性校验失败：当前页面数据不属于目标园区，已阻止保存。请切换园区后重新操作。" };
      }
      // 批量操作检测：大规模增/删需用户确认，展示详细信息
      const batchWarning = detectAnomalousBatch(summary.creates, summary.deletes);
      if (batchWarning) {
          const detailLines = [batchWarning];
          // 收集将被删除的租户名称
          const deletes = payload.pb_tenants?.deletes || [];
          if (deletes.length > 0) {
              detailLines.push(`\n即将删除 ${deletes.length} 个租户：`);
              for (const d of deletes.slice(0, 5)) {
                  const name = currentData.tenants?.find(t => t.id === d.originalId)?.name || d.originalId;
                  detailLines.push(`  - ${name}`);
              }
              if (deletes.length > 5) detailLines.push(`  ... 及其他 ${deletes.length - 5} 个`);
          }
          // 收集将被创建的租户名称
          const creates = payload.pb_tenants?.creates || [];
          if (creates.length > 0) {
              detailLines.push(`\n即将新增 ${creates.length} 个租户：`);
              for (const c of creates.slice(0, 5)) {
                  const name = c.data?.name || c.originalId;
                  detailLines.push(`  - ${name}`);
              }
              if (creates.length > 5) detailLines.push(`  ... 及其他 ${creates.length - 5} 个`);
          }
          detailLines.push(`\n汇总：新增 ${summary.creates} 条、更新 ${summary.updates} 条、删除 ${summary.deletes} 条`);
          detailLines.push(`目标园区：${cloudConfig.projectId}`);
          detailLines.push("\n建议先检查数据是否正确。\n\n确定要继续吗？");
          const confirmed = await showGlassConfirm({
              title: '检测到大规模数据变更',
              message: detailLines.join("\n"),
              tone: 'amber',
              confirmText: '继续保存',
              cancelText: '取消',
          });
          if (!confirmed) {
              return { ok: false, message: "用户取消了批量操作" };
          }
      }

      console.log(
          `[runCloudSave] 增量保存：creates=${summary.creates} updates=${summary.updates} deletes=${summary.deletes}`,
          payload
      );

      const res = await saveIncrementalToCloud(payload, cloudConfig, baseRecordMeta);
      const projectId = cloudConfig.projectId || '';
      const saveDisplayOpts = buildIncrementalSaveDisplayOptions(currentData);
      if (res.errors.length > 0) {
          console.warn('[runCloudSave] 增量保存出现 errors（不阻塞 conflicts 流程）', res.errors);
      }
      if (res.applied.length > 0 && res.errors.length > 0 && res.conflicts.length === 0) {
          applyPartialIncrementalSave(res.applied, currentData, projectId);
      }
      if (res.conflicts.length > 0) {
          setPendingConflicts(res.conflicts);
          await refreshAfterSave(currentData, res.applied);
          return {
              ok: false,
              conflict: true,
              conflictCount: res.conflicts.length,
              message: formatIncrementalSaveDetails(res, saveDisplayOpts),
              alertTitle: formatIncrementalSaveAlertTitle(res),
          };
      }
      if (res.errors.length > 0) {
          return {
              ok: false,
              partial: res.applied.length > 0,
              message: formatIncrementalSaveDetails(res, saveDisplayOpts),
              alertTitle: formatIncrementalSaveAlertTitle(res),
          };
      }
      // 全部成功 —— bump dashboard_data_version，用于其他客户端感知与服务端计算缓存失效
      await bumpVersionAfterSuccessfulWrite(currentData, { syncLocalVersion: true });
      await refreshAfterSave(currentData, res.applied, { forceRefreshServerSnapshots: true });
      resetSaveDiffHints(currentData);
      return { ok: true, message: res.message };
      } finally {
          manualRelease();
      }
  };

  const confirmCloudSave = async () => {
      if (!data) return;
      if (!operatorName.trim()) {
          showGlassNotice({
              title: '请填写操作人员',
              message: '保存到云端需要记录本次操作人员，便于后续审计和回溯。',
              tone: 'amber',
          });
          return;
      }
      const saveGuard = getManualCloudSaveGuard(data);
      if (!saveGuard.allowed) {
          showGlassNotice({
              title: '暂不能保存',
              message: saveGuard.message,
              tone: 'amber',
          });
          setIsSnapshotModalOpen(false);
          return;
      }
      setIsSyncing(true);
      setIsSnapshotModalOpen(false);
      try {
          const timestamp = new Date().toLocaleString();
          const finalNote = `${operatorName} ${timestamp} ${snapshotNote ? `(${snapshotNote})` : ''}`;
          const res = await runCloudSave(data, finalNote);
          if (res.ok) {
              showGlassNotice({
                  title: '云端备份成功',
                  message: '本次数据已写入云端历史版本，可在系统与备份中查看或恢复。',
                  tone: 'blue',
              });
              fetchCloudHistory();
          } else if (res.conflict) {
              // 增量保存的冲突已经被 runCloudSave 写入 pendingConflicts；
              // 旧整包覆写的 conflict 仍走原弹窗
              if ((res.conflictCount || 0) === 0) {
                  await handleCloudSaveConflict();
              } else {
                  showGlassNotice({
                      title: `检测到 ${res.conflictCount} 条冲突`,
                      message: '请在冲突弹窗中处理后再继续保存。',
                      tone: 'amber',
                  });
              }
          } else {
              showGlassNotice(buildCloudSavePrompt(res));
          }
      } finally {
          setIsSyncing(false);
      }
  };

  const handleSaveBudgetToCloud = async (scenarioName: string, operator: string) => {
      if (!data) return;
      const saveGuard = getManualCloudSaveGuard(data);
      if (!saveGuard.allowed) {
          showGlassNotice({
              title: '暂不能保存预算方案',
              message: saveGuard.message,
              tone: 'amber',
          });
          return;
      }
      setIsSyncing(true);
      try {
          const timestamp = new Date().toLocaleString();
          const finalNote = `[预算方案] ${operator} ${timestamp} - ${scenarioName}`;
          const res = await runCloudSave(data, finalNote);
          if (res.ok) {
              showGlassNotice({
                  title: '预算方案已保存',
                  message: '预算方案已写入云端，其他端刷新后即可读取最新口径。',
                  tone: 'blue',
              });
          } else if (res.conflict) {
              if ((res.conflictCount || 0) === 0) {
                  await handleCloudSaveConflict();
              } else {
                  showGlassNotice({
                      title: `检测到 ${res.conflictCount} 条冲突`,
                      message: '请在冲突弹窗中处理后再继续保存预算方案。',
                      tone: 'amber',
                  });
              }
          } else {
              showGlassNotice(buildCloudSavePrompt(res));
          }
      } finally {
          setIsSyncing(false);
      }
  };

  const handleQuickCloudSave = async () => {
      if (!isCloudConnected) {
          const confirmed = await showGlassConfirm({
              title: '后端未连接',
              message: '当前无法直接保存到云端。可以前往系统设置检查 PocketBase 连接与园区配置。',
              tone: 'amber',
              confirmText: '前往设置',
              cancelText: '稍后再说',
          });
          if (confirmed) {
              setActiveTab(canAccessSystemSettings ? 'settings' : 'initData');
              handleCloudConfigSave();
          }
          return;
      }
      openSnapshotModal();
  };

  /** 将当前数据写入 PocketBase（无中间云端层） */
  const handleSaveToBackend = async () => {
      if (!data) return;
      const saveGuard = getManualCloudSaveGuard(data);
      if (!saveGuard.allowed) {
          showGlassNotice({
              title: '暂不能保存',
              message: saveGuard.message,
              tone: 'amber',
          });
          if (!isCloudConnected) {
              setActiveTab(canAccessSystemSettings ? 'settings' : 'initData');
	          }
	          return;
	      }
      setIsSyncing(true);
      try {
          const res = await runCloudSave(data, '手动保存');
          if (res.ok) {
              setLastSaved(new Date().toLocaleTimeString());
              await fetchCloudHistory();
          } else if (res.conflict) {
              if ((res.conflictCount || 0) === 0) {
                  await handleCloudSaveConflict();
              }
              // pendingConflicts 已设置时由 ConflictDialog（步骤 4）接管
      } else {
          showGlassNotice(buildCloudSavePrompt(res));
      }
      } finally {
          setIsSyncing(false);
      }
  };

  /**
   * 强制把本地某条记录覆盖到服务端（用户在 ConflictDialog 选择「用我的值」时调用）。
   * 步骤 4 的 ConflictDialog 会调用本回调；这里集中处理重试逻辑。
   */
  const handleResolveConflict = async (
      decisions: Array<{
          conflict: IncrementalConflict;
          action: 'mine' | 'theirs' | 'skip';
      }>
  ): Promise<void> => {
      const overwrites = decisions.filter((d) => d.action === 'mine');
      const acceptServer = decisions.filter((d) => d.action === 'theirs');
      const overwriteFailures: string[] = [];

      // 「用我的值」 → forceOverwrite
      for (const d of overwrites) {
          const label =
              d.conflict.collection === 'pb_billing_period_notes'
                  ? '账期备注'
                  : d.conflict.collection;
          if (!d.conflict.localChanges) {
              const deleteRes = await forceDeleteCloudRecord(
                  cloudConfig,
                  d.conflict.collection,
                  d.conflict.originalId
              );
              if (!deleteRes.success) {
                  overwriteFailures.push(
                      `${label}/${d.conflict.originalId}: ${deleteRes.message || '未知错误'}`
                  );
              }
              continue;
          }
          const overwriteRes = await forceOverwriteCloudRecord(
              cloudConfig,
              d.conflict.collection,
              d.conflict.originalId,
              d.conflict.localChanges
          );
          if (!overwriteRes.success) {
              overwriteFailures.push(
                  `${label}/${d.conflict.originalId}: ${overwriteRes.message || '未知错误'}`
              );
          }
      }
      // 「用服务端值」 → 不需要写入服务端，但本地需要刷新数据
      void acceptServer;

      if (overwriteFailures.length > 0) {
          showGlassNotice({
              title: '部分冲突未能覆盖',
              message: `以下冲突未能成功覆盖到服务端，本地数据已保留，请稍后重试：\n\n${overwriteFailures.join('\n')}`,
              tone: 'rose',
          });
          return;
      }

	      // 用户处理完所有冲突 → 清空冲突列表 + 重新拉取
	      setPendingConflicts([]);
	      const projectId = cloudConfig.projectId || '';
	      const dashboardOptions = {
	          year: selectedYear,
	          quarter: selectedQuarter,
	          billingSelectedMonth,
	          quickMode: activeTab !== 'dashboard',
	          includeCurrentMonthBilling: false,
                  includePrevYearTrends: INITIAL_DASHBOARD_INCLUDE_PREV_YEAR_TRENDS,
	      } as const;
	      const bootstrap = await fetchCloudDashboardBootstrap(cloudConfig, dashboardOptions).catch(() => null);
	      if (await applyComputedDashboardLoad({
	          result: bootstrap,
	          localData: null,
	          year: selectedYear,
	          quarter: selectedQuarter,
	          projectId,
	      })) {
	          return;
	      }
	      const computed = await fetchCloudComputedDashboard(cloudConfig, dashboardOptions).catch(() => null);
	      if (await applyComputedDashboardLoad({
	          result: computed,
	          localData: null,
	          year: selectedYear,
	          quarter: selectedQuarter,
	          projectId,
	      })) {
	          return;
	      }
	      const res = await fetchCloudBackup(cloudConfig, projectId);
	      if (res.success && res.data) {
	          const safeData = { ...generateInitialData(), ...res.data };
	          captureBaselineFromCloud(safeData, res.recordMeta, projectId);
	          if (shouldRunLocalDashboardMetricsForCloudLoad({
	              cloudConnected: isCloudConnected,
	              authEnabled: !!authUser?.enabled,
	              projectId,
	              serverAttempted: true,
	          })) {
	              recalculateMetrics(safeData, selectedYear, selectedQuarter);
	          } else {
	              applyDashboardPreviewData(safeData);
	          }
	      }
	  };

	  const handleConfirmRestoreLatest = async () => {
	      if (!latestBackup) return;
	      setIsSyncing(true);
	      try {
	          const projectId = cloudConfig.projectId || '';
	          const dashboardOptions = {
	              year: selectedYear,
	              quarter: selectedQuarter,
	              billingSelectedMonth,
	              quickMode: activeTab !== 'dashboard',
	              includeCurrentMonthBilling: false,
                  includePrevYearTrends: INITIAL_DASHBOARD_INCLUDE_PREV_YEAR_TRENDS,
	          } as const;
	          const bootstrap = await fetchCloudDashboardBootstrap(cloudConfig, dashboardOptions).catch(() => null);
	          if (await applyComputedDashboardLoad({
	              result: bootstrap,
	              localData: null,
	              year: selectedYear,
	              quarter: selectedQuarter,
	              projectId,
	          })) {
	              setShowRestorePrompt(false);
	              return;
	          }
	          const computed = await fetchCloudComputedDashboard(cloudConfig, dashboardOptions).catch(() => null);
	          if (await applyComputedDashboardLoad({
	              result: computed,
	              localData: null,
	              year: selectedYear,
	              quarter: selectedQuarter,
	              projectId,
	          })) {
	              setShowRestorePrompt(false);
	              return;
	          }
	          const res = await fetchCloudBackup(cloudConfig, latestBackup.id);
	          if (res.success && res.data) {
	              const safeData = { ...generateInitialData(), ...res.data };
	              captureBaselineFromCloud(safeData, res.recordMeta, projectId);
	              if (shouldRunLocalDashboardMetricsForCloudLoad({
	                  cloudConnected: isCloudConnected,
	                  authEnabled: !!authUser?.enabled,
	                  projectId,
	                  serverAttempted: true,
	              })) {
	                  recalculateMetrics(safeData, selectedYear, selectedQuarter);
	                  parkDataPutObj(getParkStorageKey(cloudConfig.projectId), safeData);
	              } else {
	                  applyDashboardPreviewData(safeData);
	              }
	              setShowRestorePrompt(false);
	          } else {
              showGlassNotice({
                  title: '同步失败',
                  message: res.message || '未知错误',
                  tone: 'rose',
              });
          }
      } catch (e) {
          console.error(e);
          showGlassNotice({
              title: '同步过程中发生错误',
              message: e instanceof Error ? e.message : '未知错误',
              tone: 'rose',
          });
      } finally {
          setIsSyncing(false);
      }
  };

  const handleDownloadCloudBackup = async (backupId: string, note?: string) => {
      setRestoringId(backupId);
      await new Promise(resolve => setTimeout(resolve, 300));
      try {
        const res = await fetchCloudBackup(cloudConfig, backupId);
        if (res.success && res.data) {
            const { createDashboardBackupEnvelope } = await import('./services/backupArchive');
            const dataStr = JSON.stringify(createDashboardBackupEnvelope(res.data, {
                projectId: cloudConfig.projectId,
                parkName: getCurrentParkName(),
                exportedBy: authUser?.email,
            }), null, 2);
            const blob = new Blob([dataStr], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `cloud_backup_${cloudConfig.projectId}_${note ? note.replace(/\s+/g, '_') : 'snapshot'}_${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        } else {
            showGlassNotice({
                title: '下载失败',
                message: res.message || '未知错误',
                tone: 'rose',
            });
        }
      } catch (e) {
          showGlassNotice({
              title: '下载过程中发生意外错误',
              message: e instanceof Error ? e.message : '未知错误',
              tone: 'rose',
          });
      } finally {
          setRestoringId(null);
      }
  };

  const handleRestoreCloudBackup = async (backupId: string) => {
      const confirmed = await showGlassConfirm({
          title: '确认恢复历史备份',
          message: '确定要将此历史备份恢复到当前系统吗？\n\n当前本地的所有数据将被此备份完全覆盖且无法撤销。\n\n恢复成功后页面将自动刷新。',
          tone: 'rose',
          confirmText: '确认恢复',
          cancelText: '取消',
      });
      if (!confirmed) return;
      setRestoringId(backupId);
      await new Promise(resolve => setTimeout(resolve, 500));
      try {
          const res = await fetchCloudBackup(cloudConfig, backupId);
          if (res.success && res.data) {
              const safeData = { ...generateInitialData(), ...res.data };
              parkDataPutObj(getParkStorageKey(cloudConfig.projectId), safeData);
              await showGlassNotice({
                  title: '恢复成功',
                  message: '历史备份已恢复到本地，页面即将刷新以载入最新状态。',
                  tone: 'blue',
              });
              window.location.reload();
          } else {
              showGlassNotice({
                  title: '恢复失败',
                  message: res.message || '未知错误',
                  tone: 'rose',
              });
          }
      } catch (e) {
          showGlassNotice({
              title: '恢复过程中发生未知错误',
              message: e instanceof Error ? e.message : '未知错误',
              tone: 'rose',
          });
      } finally {
          setRestoringId(null);
      }
  };


  // Internal helper to avoid closure issues in calculateTrends




  // 指标重算：优先走 Web Worker（off-main-thread），不可用/出错时回退主线程同步计算。
  // 返回 Promise<DashboardData>：boot/切园区等需要拿结果落本地缓存的调用方应 await；
  // update* 等只要副作用的调用方可直接 fire-and-forget（结果就绪后自动 setData）。
  const recalculateMetrics = async (
    currentData: DashboardData,
    year: number = selectedYear,
    quarter: DashboardQuarter = selectedQuarter,
    shouldApply: () => boolean = () => true,
  ): Promise<DashboardData> => {
    // 根据当前日期修正合同状态：已到期合同自动 Expired，Pending 合同到期后自动 Active
    const autoTenants = transitionContractStatuses(currentData.tenants || []);
    if (autoTenants !== currentData.tenants) {
        currentData = { ...currentData, tenants: autoTenants };
    }
    // 同步更新 dataRef，作为后续重算/编辑的最新输入源
    dataRef.current = currentData;
    const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const isDashboard = activeTab === 'dashboard';
    const projectId = currentData.tenants?.[0]?.projectId || cloudConfig.projectId || '';
    const metricsInput: DashboardData = {
        ...currentData,
        yearlyTargets: normalizeYearlyTargetsFromInitialization(
            currentData.yearlyTargets,
            currentData.initializationData,
            projectId
        ),
    };
    const options = {
        year,
        quarter,
        billingSelectedMonth,
        quickMode: !isDashboard,
        includeCurrentMonthBilling: false,
                  includePrevYearTrends: INITIAL_DASHBOARD_INCLUDE_PREV_YEAR_TRENDS,
    };
    const myReq = ++metricsReqSeqRef.current;
    let processedData: DashboardData;
	    const runLocalMetricsCompute = async (): Promise<DashboardData> => {
	        if (isMetricsWorkerAvailable()) {
	            return (await computeMetricsInWorker(metricsInput, options)).processedData;
	        }
	        const metricsModule = await loadDashboardMetricsModule();
	        return metricsModule.calculateDashboardMetrics(metricsInput, options).processedData;
	    };
    let canUseServerDraftCompute = false;
    let serverAttempted = false;
    try {
        canUseServerDraftCompute = serverComputeEnabled;
        if (canUseServerDraftCompute) {
            serverAttempted = true;
            const server = await fetchCloudDraftComputedDashboard(
                cloudConfig,
                metricsInput,
                options,
                buildDraftPayloadForCompute(currentData),
            );
            if (server.success && server.processedData) {
                processedData = server.processedData;
            } else if (shouldRunLocalDashboardMetricsFallback({ canUseServer: canUseServerDraftCompute, serverAttempted })) {
                processedData = await runLocalMetricsCompute();
            } else {
                console.warn('[metrics] 后台草稿指标计算失败，未执行前端本地重算:', server.message);
                processedData = metricsInput;
            }
        } else if (shouldRunLocalDashboardMetricsFallback({ canUseServer: canUseServerDraftCompute, serverAttempted })) {
            processedData = await runLocalMetricsCompute();
        } else {
            console.warn('[metrics] 后台草稿指标计算不可用，未执行前端本地重算。');
            processedData = metricsInput;
        }
    } catch (error) {
        if (!shouldRunLocalDashboardMetricsFallback({ canUseServer: canUseServerDraftCompute, serverAttempted })) {
            console.warn('[metrics] 后台草稿指标计算异常，未执行前端本地重算:', error);
            processedData = metricsInput;
	        } else {
	            // Worker 出错 → 同步兜底，保证本地模式仍有结果
	            const metricsModule = await loadDashboardMetricsModule();
	            processedData = metricsModule.calculateDashboardMetrics(metricsInput, options).processedData;
	        }
    }
    const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt;
    if (elapsed > 80) {
        console.info(`[metrics] recalculate ${Math.round(elapsed)}ms`, {
            tenants: currentData.tenants?.length || 0,
            payments: currentData.payments?.length || 0,
            buildings: currentData.buildings?.length || 0,
        });
    }
    // 最新者胜：仅当本请求仍是最新时才回填，避免过期 Worker 结果覆盖新数据
    if (myReq === metricsReqSeqRef.current && shouldApply()) {
        isKpiPreviewRef.current = false;
        setIsKpiPreview(false);
        setData(processedData);
    }
    return processedData;
  };

  const applyComputedDashboardLoad = async (args: {
      result: Awaited<ReturnType<typeof fetchCloudComputedDashboard>> | null | undefined;
      localData?: DashboardData | null;
      year: number;
      quarter: DashboardQuarter;
      projectId: string;
      shouldApply?: () => boolean;
  }): Promise<boolean> => {
      const shouldApply = args.shouldApply || (() => true);
      const result = args.result;
      if (!result?.success || !result.processedData || !result.baselineData) return false;

      const safeCloudData = { ...generateInitialData(), ...result.baselineData };
      if (!hasMeaningfulDashboardPayload(safeCloudData)) return false;
      const loadScope = normalizeComputedLoadScope(result.loadScope, args.year);

      let processedData = { ...generateInitialData(), ...result.processedData };
      let recovered = false;
      if (args.localData) {
          const merged = mergeLocalDashboardCacheIntoCloud(safeCloudData, args.localData);
          recovered = merged.recovered;
          if (recovered) {
              processedData = await recalculateMetrics(merged.data, args.year, args.quarter, shouldApply);
          }
      }

      if (!shouldApply()) return true;
      captureBaselineFromCloud(safeCloudData, result.recordMeta, args.projectId, loadScope);
      if (!recovered) {
          isKpiPreviewRef.current = false;
          setIsKpiPreview(false);
          dataRef.current = processedData;
          setData(processedData);
          resetSaveDiffHints(processedData);
      } else {
          markAllSaveDiffCollections();
      }
      rememberDashboardMru(args.projectId, processedData, args.year, args.quarter);
      parkDataPutObj(getParkStorageKey(args.projectId), processedData);
      if (!recovered && (processedData.prevYearMonthlyTrends || []).length === 0) {
          queuePrevYearTrendsBackfill({
              projectId: args.projectId,
              year: args.year,
              quarter: args.quarter,
              billingSelectedMonth,
              shouldApply,
          });
      }
      setLastSaved(new Date().toLocaleTimeString());
      if (recovered) {
          console.warn(
              '[App] 已从本地缓存恢复尚未同步至云端的财务修改（特殊业态/收款等），请核对后点击保存。'
          );
      }
      return true;
  };

	  const recalculateMetricsServerFirst = async (
      currentData: DashboardData,
      year: number = selectedYear,
      quarter: DashboardQuarter = selectedQuarter,
      shouldApply: () => boolean = () => true,
  ): Promise<DashboardData> => {
	      const projectId = (cloudConfig.projectId || '').trim();
		      const canUseServerBase =
		          serverComputeEnabled &&
		          !!projectId &&
		          !isKpiPreviewRef.current;
	      const canUseServer =
	          canUseServerBase &&
	          !(await hasLocalPendingChanges(currentData, projectId));

	      if (canUseServer) {
	          const dashboardOptions = {
	              year,
	              quarter,
	              billingSelectedMonth,
	              quickMode: activeTab !== 'dashboard',
	              includeCurrentMonthBilling: false,
                  includePrevYearTrends: INITIAL_DASHBOARD_INCLUDE_PREV_YEAR_TRENDS,
	          } as const;
	          const bootstrap = await fetchCloudDashboardBootstrap(cloudConfig, dashboardOptions).catch(() => null);
	          if (await applyComputedDashboardLoad({
	              result: bootstrap,
	              localData: null,
	              year,
	              quarter,
	              projectId,
	              shouldApply,
	          })) {
	              return { ...generateInitialData(), ...(bootstrap?.processedData || currentData) };
	          }
	          const computed = await fetchCloudComputedDashboard(cloudConfig, dashboardOptions).catch(() => null);
	          if (await applyComputedDashboardLoad({
	              result: computed,
	              localData: null,
	              year,
	              quarter,
	              projectId,
	              shouldApply,
	          })) {
	              return { ...generateInitialData(), ...(computed?.processedData || currentData) };
	          }
	      }

      return recalculateMetrics(currentData, year, quarter, shouldApply);
  };

  const updateBuildings = (newBuildings: Building[]) => {
      if (!data) return;
      recalculateMetrics({ ...data, buildings: newBuildings, tenants: reconcileTenantAreasWithBuildings(newBuildings, data.tenants) });
  };

  /** 同时提交楼宇与租户（例如单元跨楼迁移后同步 unitIds / buildingId） */
  const commitBuildingsTenants = (newBuildings: Building[], newTenants: Tenant[]) => {
      if (!data) return;
      recalculateMetrics({ ...data, buildings: newBuildings, tenants: reconcileTenantAreasWithBuildings(newBuildings, newTenants) });
  };

	  const handleBatchUpdate = (updates: Partial<DashboardData>) => {
      if (!data) return;
      const cleanUpdates: Partial<DashboardData> = {};
      (Object.keys(updates) as Array<keyof DashboardData>).forEach(key => { if (updates[key] !== undefined) { cleanUpdates[key] = updates[key] as any; } });
      const changedKeys = Object.keys(cleanUpdates) as Array<keyof DashboardData>;
      if (changedKeys.length === 0) return;
      const mergedData = { ...data, ...cleanUpdates };
      if (shouldRecalculateMetricsForDashboardPatch(changedKeys)) {
          recalculateMetrics(mergedData);
      } else {
          commitDataWithoutMetrics(mergedData);
      }
  };

  /** 租金账期跟进备注（纯展示字段，不参与 KPI/应收重算） */
  const remarkSaveTimersRef = React.useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const updateRentCollectionRemark = React.useCallback((tenantId: string, periodYYYYMM: string, text: string) => {
      const key = rentCollectionRemarkKey(tenantId, periodYYYYMM);
      const timerKey = `${tenantId}|${periodYYYYMM}`;
      const existing = remarkSaveTimersRef.current[timerKey];
      if (existing) clearTimeout(existing);
      remarkSaveTimersRef.current[timerKey] = setTimeout(() => {
          delete remarkSaveTimersRef.current[timerKey];
          setData((prev) => {
              if (!prev) return prev;
              const next = { ...(prev.billingPeriodNotes || {}) };
              if (!text.trim()) delete next[key];
              else next[key] = text;
              return { ...prev, billingPeriodNotes: next };
          });
      }, 400);
  }, []);

	  const getBillingDetailsServerFirst = React.useCallback(async (
	      year: number,
	      month: number,
	      sourceData: DashboardData,
	  ): Promise<BillingDetail[]> => {
		      const canUseServer = serverComputeEnabled;
	      let serverAttempted = false;
	      if (canUseServer) {
	          serverAttempted = true;
	          try {
	              const hasLocalDirty =
	                  dirtyPbCollectionsRef.current.size > 0 ||
	                  lastDiffTrackedDataRef.current !== sourceData;
	              const server = hasLocalDirty
	                  ? await fetchCloudDraftComputedBilling(cloudConfig, sourceData, {
	                      year,
	                      month: month + 1,
	                  }, buildDraftPayloadForCompute(sourceData))
	                  : await fetchCloudComputedBilling(cloudConfig, {
	                      year,
	                      month: month + 1,
	                  });
	              if (server.success && server.billingDetails) {
	                  return server.billingDetails;
	              }
	              console.warn('[billing] 后台应收计算失败，未执行前端本地重算:', server.message);
	          } catch (error) {
	              console.warn('[billing] 后台应收计算异常，未执行前端本地重算:', error);
	          }
	      }
	      if (!shouldRunLocalBillingFallback({ canUseServer, serverAttempted })) {
	          return [];
	      }
	      return buildBillingDetailsForPeriodLocal(year, month, sourceData);
	  }, [cloudConfig, serverComputeEnabled, buildDraftPayloadForCompute]);

  const handleDeferPayment = async (tenantId: string, fromYear: number, fromMonth: number, toYear: number, toMonth: number) => {
      if (!data) return;
      const tenant = data.tenants.find((t) => t.id === tenantId);
      if (!tenant) return;
      if (fromYear === toYear && fromMonth === toMonth) {
          await showGlassNotice({
              title: '账期未变更',
              message: '目标账期不能与原账期相同。',
              tone: 'amber',
          });
          return;
      }

      const details = await getBillingDetailsServerFirst(fromYear, fromMonth, data);
      const row = details.find((d) => d.tenantId === tenantId);
      const amountToDefer = Math.max(0, (row?.amountDue ?? 0) - (row?.amountPaid ?? 0));

      if (amountToDefer <= 0) {
          await showGlassNotice({
              title: '无可缓缴应收',
              message: '该月份无可缓缴应收：可能已结清、已暂缓或待收余额为 0。',
              tone: 'amber',
          });
          return;
      }
      const key = `${DEFER_BILLING_NOTE_PREFIX}${tenantId}_${fromYear}_${fromMonth}_${toYear}_${toMonth}_${Date.now()}`;
      const note: DeferBillingNote = {
          tenantId,
          fromYear,
          fromMonth,
          toYear,
          toMonth,
          amount: amountToDefer,
      };
      const newNotes = { ...(data.billingPeriodNotes || {}), [key]: JSON.stringify(note) };
      recalculateMetrics({ ...data, billingPeriodNotes: newNotes });
      const fromLabel = `${fromYear}-${String(fromMonth + 1).padStart(2, '0')}`;
      const toLabel = `${toYear}-${String(toMonth + 1).padStart(2, '0')}`;
      await showGlassNotice({
          title: '缓缴已应用',
          message: `仅影响应收/执行视图，不修改预算表基准。\n客户：${tenant.name}\n金额：${formatCurrency(amountToDefer)}\n原账期：${fromLabel}\n调整至：${toLabel}`,
          tone: 'blue',
      });
  };

  /** 撤销单条缓缴（调入行消失，金额回到原账期应收） */
  const handleRevokeDeferBillingNote = async (noteKey: string) => {
      if (!data) return;
      const cur = data.billingPeriodNotes?.[noteKey];
      let summary = '';
      try {
          const j = JSON.parse(cur || '{}') as { tenantId?: string; fromYear?: number; fromMonth?: number; toYear?: number; toMonth?: number; amount?: number };
          if (j?.tenantId != null && Number.isFinite(j.fromYear) && Number.isFinite(j.fromMonth)) {
              const fromL = `${j.fromYear}-${String((j.fromMonth ?? 0) + 1).padStart(2, '0')}`;
              const toL =
                  Number.isFinite(j.toYear) && Number.isFinite(j.toMonth)
                      ? `${j.toYear}-${String((j.toMonth ?? 0) + 1).padStart(2, '0')}`
                      : '';
              summary = `\n原账期: ${fromL}${toL ? `\n调入: ${toL}` : ''}\n金额: ${typeof j.amount === 'number' ? formatCurrency(j.amount) : '—'}`;
          }
      } catch (e) {
          console.warn('[App] 支付转移明细解析失败:', e);
      }
      const confirmed = await showGlassConfirm({
          title: '撤销缓缴',
          message: `调入账期行将删除，金额回到原账期。\n\n不影响收款明细已有流水；若曾核销本调入行，请核对关联账期。${summary}`,
          tone: 'amber',
          confirmText: '撤销缓缴',
          cancelText: '取消',
      });
      if (!confirmed) {
          return;
      }
      const { next, removed } = removeDeferBillingNoteByKey(data.billingPeriodNotes, noteKey);
      if (!removed) {
          await showGlassNotice({
              title: '缓缴记录不存在',
              message: '未找到对应的缓缴记录，可能已被撤销或键无效。',
              tone: 'rose',
          });
          return;
      }
      recalculateMetrics({ ...data, billingPeriodNotes: next });
  };

  /** 应收核销：一键撤回全部缓缴 + 本界面生成的核销流水（不误删收款明细手工记账） */
  const handleResetReceivableApplications = async () => {
      if (!data) return;
      const { next: nextNotes, removed: deferRemoved } = removeDeferBillingNotesFromNotes(data.billingPeriodNotes || {});
      const { kept: nextPayments, removedCount: payRemoved } = partitionPaymentsRemovingAutoReceivableWriteOffs(
          data.payments || [],
      );
      if (deferRemoved === 0 && payRemoved === 0) {
          await showGlassNotice({
              title: '没有可撤回记录',
              message: '当前没有可撤回的缓缴记录，也没有通过「应收核销」收款或批量核销生成的租金流水。\n\n「收款明细」中的手工记账不受影响。',
              tone: 'slate',
          });
          return;
      }
      const confirmed = await showGlassConfirm({
          title: '一键撤回应收核销',
          message:
              `此操作不可撤销。\n\n` +
              `清除全部缓缴申请：${deferRemoved} 条（所有账期）\n` +
              `删除应收核销自动生成的收款流水：${payRemoved} 笔（单笔收款、批量核销）\n\n` +
              `不含「收款明细」手工录入的流水；跟进备注、预算与合同数据不会改变。`,
          tone: 'rose',
          confirmText: '确认撤回',
          cancelText: '取消',
      });
      if (!confirmed) {
          return;
      }
      recalculateMetrics({ ...data, billingPeriodNotes: nextNotes, payments: nextPayments });
  };

  const updateBudgetScenarios = (newScenarios: BudgetScenario[]) => {
      if (!data) return;
      // 必须走重算：应收专用方案、工作台账单、财务报表与本页根级 budgetAssumptions 均依赖 normalize + 生效方案假设
      recalculateMetrics({
          ...data,
          budgetScenarios: newScenarios,
      });
  };

  const handleRenameScenario = (id: string, newName: string) => {
      if (!data || !data.budgetScenarios) return;
      const updated = data.budgetScenarios.map(s => s.id === id ? {...s, name: newName} : s);
      setData({
          ...data,
          budgetScenarios: normalizeScenarioForReceivableService(updated, data.tenants || [], data.buildings || []),
      });
  };

  const handleActivateScenario = (scenario: BudgetScenario) => {
      if (!data) return;
      const scenarioList = data.budgetScenarios || [];
      const updatedScenarios = scenarioList.map(s => ({
          ...s,
          isActive: s.budgetYear === scenario.budgetYear ? s.id === scenario.id : s.isActive
      }));
      recalculateMetrics({
          ...data,
          budgetScenarios: normalizeScenarioForReceivableService(updatedScenarios, data.tenants || [], data.buildings || []),
      });
  };

  const updateTenants = (newTenants: Tenant[]) => { if (!data) return; recalculateMetrics({ ...data, tenants: newTenants }); };
  const updatePayments = (newPayments: PaymentRecord[]) => { if (!data) return; recalculateMetrics({ ...data, payments: newPayments }); };
  const updateBudgetAssumptions = (newAssumptions: BudgetAssumption[]) => { if (!data) return; recalculateMetrics({ ...data, budgetAssumptions: newAssumptions }); };
  const updateBudgetAdjustments = (newAdjustments: BudgetAdjustment[]) => { if (!data) return; recalculateMetrics({ ...data, budgetAdjustments: newAdjustments }); };
  const updateBudgetAnalysis = (newAnalysis: BudgetAnalysisData) => { if (!data) return; commitDataWithoutMetrics({ ...data, budgetAnalysis: newAnalysis }); };
  const updateInvoices = (newInvoices: InvoiceRecord[]) => { if (!data) return; commitDataWithoutMetrics({ ...data, invoices: newInvoices }); };

  const openTargetModal = React.useCallback((type: 'revenue' | 'occupancy') => {
      if (!data) return;
      setTargetModalType(type);
      const existingTarget = (data.yearlyTargets || {})[selectedYear] || { revenue: 0, occupancy: 0, initialBudget: 0 };
      setTargetForm({
          occupancy: existingTarget.occupancy || data.annualOccupancyTarget,
      });
      setIsTargetModalOpen(true);
  }, [data, selectedYear]);

  const saveTargets = () => {
      if (!data) return;
      const projectId = data.tenants?.[0]?.projectId || cloudConfig.projectId || '';
      const initialFromInit = resolveAnnualInitialBudget(
          data.yearlyTargets,
          data.initializationData,
          selectedYear,
          projectId
      );
      const newTargets = { ...data.yearlyTargets };
      newTargets[selectedYear] = {
          revenue: 0,
          occupancy: Number(targetForm.occupancy),
          initialBudget: initialFromInit,
      };
      recalculateMetrics({ ...data, yearlyTargets: newTargets }); 
      setIsTargetModalOpen(false); 
  };
  
  const handleResetData = async () => {
      const confirmed = await showGlassConfirm({
          title: '清空当前园区本地缓存',
          message: '确定要清空当前园区的本地缓存并恢复出厂设置吗？\n\n所有未保存至后端的本地修改都将丢失。',
          tone: 'rose',
          confirmText: '确认清空',
          cancelText: '取消',
      });
      if (!confirmed) return;
      localStorage.removeItem(getParkStorageKey(cloudConfig.projectId));
      const initial = generateInitialData();
      recalculateMetrics(initial, currentYear, 'All');
      showGlassNotice({
          title: '本地缓存已重置',
          message: '当前园区本地缓存已恢复为初始状态。',
          tone: 'blue',
      });
  };

  const getCurrentParkName = () => {
      return authorizedParks.find(park => park.projectId === cloudConfig.projectId)?.name || cloudConfig.projectId;
  };

  const handleExport = async () => {
      if (!data) return;
      const projectId = (cloudConfig.projectId || '').trim();
      if (!projectId) {
          showGlassNotice({
              title: '不能导出备份',
              message: '当前未选择园区，不能导出备份。',
              tone: 'amber',
          });
          return;
      }
      const { createDashboardBackupEnvelope } = await import('./services/backupArchive');
      const exportData = createDashboardBackupEnvelope(data, {
          projectId,
          parkName: getCurrentParkName(),
          exportedBy: authUser?.email,
      });
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `park_data_${projectId}_${new Date().toISOString().split('T')[0]}.json`;
      link.click();
      URL.revokeObjectURL(url);
  };

  const handleImport = (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;

      const targetProjectId = (cloudConfig.projectId || '').trim();
      const allowedProjectIds = authUser?.allowedProjectIds?.length ? authUser.allowedProjectIds : [targetProjectId];
      const reader = new FileReader();
      reader.onload = async (e) => {
          try {
              const raw = JSON.parse(e.target?.result as string);
              const {
                  formatBackupSummary,
                  parseDashboardBackup,
                  sanitizeImportedDashboardData,
                  validateBackupTarget,
              } = await import('./services/backupArchive');
              const parsed = parseDashboardBackup(raw);
              const validation = validateBackupTarget(parsed, targetProjectId, allowedProjectIds);
              if (!validation.ok) {
                  showGlassNotice({
                      title: '备份文件不能导入',
                      message: validation.message,
                      tone: 'rose',
                  });
                  return;
              }

              const warnings = validation.warnings.length ? `\n\n风险提示：\n${validation.warnings.join('\n')}` : '';
              const sourceProject = parsed.projectId || '旧格式未声明';
              const confirmText = [
                  `目标园区：${getCurrentParkName()} (${targetProjectId})`,
                  `文件园区：${sourceProject}`,
                  parsed.exportedAt ? `导出时间：${new Date(parsed.exportedAt).toLocaleString()}` : '',
                  parsed.exportedBy ? `导出人员：${parsed.exportedBy}` : '',
                  '',
                  '数据摘要：',
                  formatBackupSummary(parsed.summary),
                  warnings,
                  '',
                  '确认后仅会恢复到当前园区的本地状态；如需写入后端，请再点击右上角「保存」。',
                  '是否继续？',
              ].filter(Boolean).join('\n');

              const confirmed = await showGlassConfirm({
                  title: '确认恢复备份到当前园区',
                  message: confirmText,
                  tone: validation.warnings.length > 0 ? 'amber' : 'blue',
                  confirmText: '确认恢复到本地',
                  cancelText: '取消导入',
              });
              if (!confirmed) return;

              // 预算方案的 baseDataSnapshot 是预算生成时点快照，旧版预算表依赖它复原静态口径。
              const sanitizedData = sanitizeImportedDashboardData(parsed.data || {});
              const rawObj = (raw && typeof raw === 'object') ? (raw as any) : {};
              const rawPayload = rawObj.backup_type === 'park_dashboard_backup' && rawObj.data && typeof rawObj.data === 'object'
                  ? rawObj.data
                  : rawObj;
              const effectiveBudgetTablesRaw = Array.isArray(rawPayload.effectiveBudgetTables)
                  ? rawPayload.effectiveBudgetTables
                  : [];

              let mergedData = { ...generateInitialData(), ...sanitizedData } as DashboardData;
              const restoredBudgetYears: number[] = [];
              if (effectiveBudgetTablesRaw.length > 0) {
                  const {
                      mergeBudgetTotalsIntoInitData,
                      normalizeEffectiveBudgetTableFromBackup,
                      writeImportedBudgetTable,
                  } = await import('./services/budgetTableImport');
                  let nextInitData = mergedData.initializationData || [];
                  let nextNotes = mergedData.billingPeriodNotes || {};
                  for (const table of effectiveBudgetTablesRaw) {
                      const restored = normalizeEffectiveBudgetTableFromBackup(table);
                      if (!restored) continue;
                      nextInitData = mergeBudgetTotalsIntoInitData(
                          nextInitData,
                          restored.year,
                          restored.snapshot.monthlyTotals,
                          cloudConfig.projectId
                      );
                      nextNotes = writeImportedBudgetTable(nextNotes, restored.year, restored.snapshot);
                      restoredBudgetYears.push(restored.year);
                  }
                  mergedData = {
                      ...mergedData,
                      initializationData: nextInitData,
                      billingPeriodNotes: nextNotes,
                  };
              }
              setSelectedYear(new Date().getFullYear());
              setSelectedQuarter('All');
              setRecordMeta({});
              baselineSnapshotRef.current = null;
              bumpSaveBaselineRevision();
              dataLoadScopeRef.current = FULL_DASHBOARD_LOAD_SCOPE;
              resetSaveDiffHints(null);
              setPendingConflicts([]);
              parkDataPutObj(getParkStorageKey(targetProjectId), mergedData);
              let canSaveIncrementally = false;
              try {
                  const baselineRes = await fetchCloudBackup({ ...cloudConfig, projectId: targetProjectId }, targetProjectId);
                  if (baselineRes.success && baselineRes.data) {
                      const cloudBaseline = { ...generateInitialData(), ...baselineRes.data };
                      captureBaselineFromCloud(cloudBaseline, baselineRes.recordMeta, targetProjectId);
                      canSaveIncrementally = true;
                  }
              } catch (baselineError) {
                  console.warn('[handleImport] 导入后读取云端 baseline 失败', baselineError);
              }
              recalculateMetrics(mergedData, new Date().getFullYear(), 'All');
              markAllSaveDiffCollections();
              const budgetRestoreNote = restoredBudgetYears.length > 0
                  ? `\n\n已按备份内 effectiveBudgetTables 回填预算执行目标：${Array.from(new Set(restoredBudgetYears)).sort((a, b) => a - b).join('、')} 年。`
                  : '';
              showGlassNotice({
                  title: canSaveIncrementally ? '备份已恢复到本地' : '备份已恢复，但缺少云端基线',
                  message: canSaveIncrementally
                      ? `数据已恢复到当前园区本地状态，并已建立云端增量保存基线。请检查无误后点击右上角「保存」写入后端。${budgetRestoreNote}`
                      : `数据已恢复到当前园区本地状态，但暂未读取到云端保存基线。请先确认后端连接正常，再刷新/重新登录后保存。${budgetRestoreNote}`,
                  tone: canSaveIncrementally ? 'blue' : 'amber',
              });
          } catch (err: any) {
              showGlassNotice({
                  title: '解析或校验备份失败',
                  message: err?.message || '未知错误',
                  tone: 'rose',
              });
          }
      };
      reader.readAsText(file);
  };

  const handleYearChange = async (year: number) => {
      setSelectedYear(year);
      if (isKpiPreviewRef.current) {
          const reqSeq = ++kpiPreviewReqSeqRef.current;
          const snapshotRes = isCloudConnected
              ? await fetchCloudKpiSnapshot(cloudConfig, year).catch(() => null)
              : null;
          if (reqSeq !== kpiPreviewReqSeqRef.current || !isKpiPreviewRef.current) return;
          if (snapshotRes?.success && snapshotRes.snapshot) {
              isKpiPreviewRef.current = true;
              setIsKpiPreview(true);
              setData(buildDashboardDataFromKpiSnapshot(snapshotRes.snapshot));
          } else {
              const emptyPreview = generateInitialData();
              isKpiPreviewRef.current = true;
              setIsKpiPreview(true);
              setData({ ...emptyPreview, cloudSaveVersion: dataRef.current?.cloudSaveVersion || 0 });
          }
          return;
      }
      if (data) recalculateMetricsServerFirst(data, year, selectedQuarter);
  };
  
  const loadTempInitData = (year: number) => {
      if (!data) return;
      const existing = data.initializationData || [];
      const isShanghai = cloudConfig.projectId === SHANGHAI_PARK_ID;
      const rows: MonthlyInitData[] = [];
      for (let m = 1; m <= 12; m++) {
          const found = existing.find(d => d.year === year && d.month === m);
          const base = found
              ? { ...found }
              : { year, month: m, revenueTarget: 0, revenueCollected: 0, occupancyRate: 0 };
          rows.push(isShanghai ? migrateShanghaiInitRow(base) : base);
      }
      setTempInitData(rows);
  };

  const openInitDataModal = () => {
      if (!data) return;
      const y = new Date().getFullYear();
      const defaultYear = y >= 2023 && y <= 2026 ? y : 2026;
      setInitDataYear(defaultYear);
      loadTempInitData(defaultYear);
      setIsInitDataModalOpen(true);
  };

  const handleInitYearChange = (year: number) => {
      setInitDataYear(year);
      loadTempInitData(year);
  };

  const updateTempInitData = (month: number, field: keyof MonthlyInitData, value: number) => {
      setTempInitData(prev => prev.map(row => row.month === month ? { ...row, [field]: value } : row));
  };

  const handleImportInitialBudgetFromActiveScenario = async () => {
      if (!data || isImportingInitialBudget) return;
      const activeScenario = (data.budgetScenarios || []).find(
          s => s.isActive && (s.budgetYear || new Date().getFullYear()) === initDataYear
      );
      if (!activeScenario) {
          showGlassNotice({
              title: '未找到生效预算方案',
              message: `未找到 ${initDataYear} 年的生效预算方案，请先在预算管理中激活方案。`,
              tone: 'amber',
          });
          return;
      }

      const snapshotTenants = activeScenario.baseDataSnapshot?.tenants || data.tenants || [];
      const snapshotBuildings = activeScenario.baseDataSnapshot?.buildings || data.buildings || [];
      const assumptions = activeScenario.assumptions || [];
      const adjustments = activeScenario.adjustments || [];
      const startDate = new Date(initDataYear - 1, 0, 1);
      const endDate = new Date(initDataYear + 1, 11, 31);
      const virtualTenants = getVirtualTenants(snapshotTenants, snapshotBuildings, assumptions);
      const allTenants = [...snapshotTenants, ...virtualTenants].filter(t => !t.isSpecialBusiness);
	      const canUseServer = serverComputeEnabled;
      let serverAttempted = false;

      const applyBillsToInitRows = (billGroups: Array<{ bills: { date: Date; amount: number }[] }>) => {
          const monthlyTotals = new Array(12).fill(0);
          billGroups.forEach(({ bills }) => {
              bills.forEach((bill) => {
                  const billDate = bill.date instanceof Date ? bill.date : new Date(bill.date);
                  if (!Number.isFinite(billDate.getTime())) return;
                  if (billDate.getFullYear() !== initDataYear) return;
                  const monthIndex = billDate.getMonth();
                  if (monthIndex >= 0 && monthIndex < 12) monthlyTotals[monthIndex] += bill.amount;
              });
          });
          setTempInitData(prev => prev.map(row => ({
              ...row,
              initialBudget: Math.round(monthlyTotals[row.month - 1] || 0),
          })));
      };

      const localFallback = async () => {
          const { generateBudgetedBills } = await import('./services/billingService');
          applyBillsToInitRows(allTenants.map(t => ({
              bills: generateBudgetedBills(t, assumptions, adjustments, startDate, endDate),
          })));
      };

      setIsImportingInitialBudget(true);
      try {
          if (canUseServer && allTenants.length > 0) {
              try {
                  serverAttempted = true;
                  const requestItems = allTenants.map((tenant, index) => ({
                      id: `${tenant.id || 'tenant'}:${index}`,
                      tenant,
                      assumptions,
                      adjustments,
                      startDate,
                      endDate,
                  }));
                  const result = await fetchCloudBudgetedBillsPreviewBatch(cloudConfig, {
                      items: requestItems,
                  });
                  if (result.success && result.items) {
                      const itemError = validateInitialBudgetImportServerItems(
                          requestItems.map((item) => item.id),
                          result.items.map((item) => item.id),
                      );
                      if (itemError) {
                          showGlassNotice({
                              title: '年初预算未写入',
                              message: `${itemError}，未写入不完整年初预算。请稍后重试后台计算。`,
                              tone: 'amber',
                          });
                          return;
                      }
                      applyBillsToInitRows(result.items);
                      showGlassNotice({
                          title: '年初预算已导入',
                          message: `已按 ${initDataYear} 年生效预算方案回填 12 个月年初预算，请检查后保存配置。`,
                          tone: 'blue',
                      });
                      return;
                  }
                  console.warn('[init-budget-import] 后台批量账单计算失败，未执行前端批量兜底:', result.message);
              } catch (error) {
                  if (!shouldRunLocalInitialBudgetImportFallback({
                      canUseServer,
                      tenantCount: allTenants.length,
                      serverAttempted,
                  })) {
                      console.warn('[init-budget-import] 后台批量账单计算异常，未执行前端批量兜底:', error);
                      showGlassNotice({
                          title: '后台计算异常',
                          message: '后台批量账单计算异常，未执行前端本地批量计算。请检查后台服务后重试。',
                          tone: 'rose',
                      });
                      return;
                  }
                  console.warn('[init-budget-import] 后台批量账单计算异常，准备使用本地兜底:', error);
              }
          }
          if (!shouldRunLocalInitialBudgetImportFallback({
              canUseServer,
              tenantCount: allTenants.length,
              serverAttempted,
          })) {
              showGlassNotice({
                  title: '后台计算失败',
                  message: '后台批量账单计算失败，未执行前端本地批量计算。请检查后台服务后重试。',
                  tone: 'rose',
              });
              return;
          }
          try {
              await localFallback();
              showGlassNotice({
                  title: '年初预算已导入',
                  message: `已使用本地账单引擎按 ${initDataYear} 年生效预算方案回填年初预算，请检查后保存配置。`,
                  tone: 'blue',
              });
          } catch (fallbackError) {
              console.warn('[init-budget-import] 本地批量账单计算失败:', fallbackError);
              showGlassNotice({
                  title: '本地账单生成失败',
                  message: '本地账单生成模块加载失败，请刷新页面后重试。',
                  tone: 'rose',
              });
              return;
          }
      } finally {
          setIsImportingInitialBudget(false);
      }
  };

  const saveInitData = () => {
      if (!data) return;
      const otherData = (data.initializationData || []).filter(d => d.year !== initDataYear);
      const yearRows =
          cloudConfig.projectId === SHANGHAI_PARK_ID
              ? tempInitData.map(migrateShanghaiInitRow)
              : tempInitData;
      const newData = [...otherData, ...yearRows];
      // 同步月度年初预算合计到 yearlyTargets（看板「年初预算」列与后端 yearly 行一致）
      const monthInitialTotal = yearRows.reduce((sum, r) => sum + (r.initialBudget || 0), 0);
      const newTargets = { ...data.yearlyTargets };
      const existing = newTargets[initDataYear] || { revenue: 0, occupancy: 0 };
      newTargets[initDataYear] = { ...existing, revenue: 0, initialBudget: monthInitialTotal };
      const updatedData = { ...data, initializationData: newData, yearlyTargets: newTargets };
      setData(updatedData);
      recalculateMetrics(updatedData);
      setIsInitDataModalOpen(false);
  };

  const handleCreateManagedUser = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!isPlatformAdmin()) {
          showGlassNotice({
              title: '权限不足',
              message: '仅平台管理员可新增登录人员。',
              tone: 'amber',
          });
          return;
      }
      if (!newUserForm.email.trim() || !newUserForm.password.trim() || !newUserForm.projectId.trim()) {
          showGlassNotice({
              title: '请补全账号信息',
              message: '请填写邮箱、初始密码和默认园区。',
              tone: 'amber',
          });
          return;
      }
      setIsCreatingUser(true);
      const res = await createManagedCloudUser({
          email: newUserForm.email,
          password: newUserForm.password,
          name: newUserForm.name,
          role: newUserForm.role,
          projectId: newUserForm.projectId,
          allowedProjectIds: [newUserForm.projectId],
          enabled: newUserForm.enabled,
      });
      setIsCreatingUser(false);
      if (!res.success) {
          showGlassNotice({
              title: '新增登录人员失败',
              message: res.message || '未知错误',
              tone: 'rose',
          });
          return;
      }
      setNewUserForm(prev => ({
          ...prev,
          email: '',
          name: '',
          password: '',
          role: 'park_user',
      }));
      await loadManagedUsers();
      showGlassNotice({
          title: '登录人员已新增',
          message: newUserForm.enabled ? '登录人员已新增并启用。' : '登录人员已新增，等待管理员审批启用。',
          tone: 'blue',
      });
  };

  const handleApproveManagedUser = async (user: ManagedUserAccount, enabled: boolean) => {
      if (!isPlatformAdmin()) {
          showGlassNotice({
              title: '权限不足',
              message: '仅平台管理员可审批登录人员。',
              tone: 'amber',
          });
          return;
      }
      const res = await updateManagedCloudUserEnabled(user.id, enabled);
      if (!res.success) {
          showGlassNotice({
              title: '操作失败',
              message: res.message || '未知错误',
              tone: 'rose',
          });
          return;
      }
      await loadManagedUsers();
      showGlassNotice({
          title: enabled ? '登录人员已启用' : '登录人员已停用',
          message: `${user.email} 的登录状态已更新。`,
          tone: enabled ? 'blue' : 'amber',
      });
  };

  const handleApproveSignupRequest = async (req: SignupRequestRecord) => {
      if (!isPlatformAdmin()) {
          showGlassNotice({
              title: '权限不足',
              message: '仅平台管理员可审批注册申请。',
              tone: 'amber',
          });
          return;
      }
      const res = await approveCloudSignupRequest(req.id);
      if (!res.success) {
          showGlassNotice({
              title: '审批失败',
              message: res.message || '未知错误',
              tone: 'rose',
          });
          return;
      }
      await Promise.all([loadSignupRequests(), loadManagedUsers()]);
      showGlassNotice({
          title: '审批完成',
          message: res.message || '申请人账号已可登录。',
          tone: 'blue',
      });
  };

  const handleRejectSignupRequest = async (req: SignupRequestRecord) => {
      if (!isPlatformAdmin()) {
          showGlassNotice({
              title: '权限不足',
              message: '仅平台管理员可退回注册申请。',
              tone: 'amber',
          });
          return;
      }
      const note = await showGlassInput({
          title: '退回注册申请',
          message: `请输入退回「${req.email}」的原因，可留空。`,
          inputLabel: '退回原因',
          defaultValue: '申请园区或账号信息不符合要求',
          tone: 'amber',
          confirmText: '确认退回',
          cancelText: '取消',
      });
      if (note === null) return;
      const res = await rejectCloudSignupRequest(req.id, note.trim());
      if (!res.success) {
          showGlassNotice({
              title: '退回失败',
              message: res.message || '未知错误',
              tone: 'rose',
          });
          return;
      }
      await loadSignupRequests();
      showGlassNotice({
          title: '注册申请已退回',
          message: res.message || '已退回注册申请。',
          tone: 'blue',
      });
  };

  const openUserManageModal = (u: ManagedUserAccount) => {
      setUserManageTarget(u);
      const pid = u.projectId || u.allowedProjectIds[0] || '';
      const allowed = u.allowedProjectIds.length ? [...u.allowedProjectIds] : pid ? [pid] : [];
      setUserManageForm({
          name: u.name || '',
          role: u.role,
          projectId: pid,
          allowedParkIds: allowed,
          password: '',
          enabled: u.enabled,
      });
  };

  const toggleUserManagePark = (projectId: string, checked: boolean) => {
      setUserManageForm((prev) => {
          const set = new Set(prev.allowedParkIds);
          if (checked) set.add(projectId);
          else set.delete(projectId);
          return { ...prev, allowedParkIds: Array.from(set) };
      });
  };

  const handleSaveUserManageModal = async () => {
      if (!userManageTarget || !isPlatformAdmin()) return;
      const pid = userManageForm.projectId.trim();
      if (!pid) {
          showGlassNotice({
              title: '请填写默认园区',
              message: '请填写默认园区 project_id。',
              tone: 'amber',
          });
          return;
      }
      setUserManageSaving(true);
      const allowed = Array.from(new Set([pid, ...userManageForm.allowedParkIds.map((x) => x.trim()).filter(Boolean)]));
      const nextPassword = userManageForm.password.trim();
      const res = await updateManagedCloudUser({
          userId: userManageTarget.id,
          name: userManageForm.name.trim() || undefined,
          role: userManageForm.role,
          projectId: pid,
          allowedProjectIds: allowed,
          enabled: userManageForm.enabled,
          password: nextPassword || undefined,
      });
      setUserManageSaving(false);
      if (!res.success) {
          showGlassNotice({
              title: '账号保存失败',
              message: res.message || '保存失败',
              tone: 'rose',
          });
          return;
      }
      setUserManageTarget(null);
      await Promise.all([loadManagedUsers(), loadSignupRequests()]);
      showGlassNotice({
          title: '账号已保存',
          message: '登录人员信息已更新。',
          tone: 'blue',
      });
  };

  const handleDeleteUserManageModal = async () => {
      if (!userManageTarget || !isPlatformAdmin()) return;
      const confirmed = await showGlassConfirm({
          title: '删除登录账号',
          message: `确定删除登录账号「${userManageTarget.email}」？此操作不可恢复。`,
          tone: 'rose',
          confirmText: '确认删除',
          cancelText: '取消',
      });
      if (!confirmed) return;
      setUserManageSaving(true);
      const res = await deleteManagedCloudUser(userManageTarget.id, authUser?.id);
      setUserManageSaving(false);
      if (!res.success) {
          showGlassNotice({
              title: '删除失败',
              message: res.message || '删除失败',
              tone: 'rose',
          });
          return;
      }
      setUserManageTarget(null);
      await Promise.all([loadManagedUsers(), loadSignupRequests()]);
      showGlassNotice({
          title: '账号已删除',
          message: res.message || '已删除账号。',
          tone: 'blue',
      });
  };

  const handleDeleteSignupRequest = async (req: SignupRequestRecord) => {
      if (!isPlatformAdmin()) {
          showGlassNotice({
              title: '权限不足',
              message: '仅平台管理员可清理审批记录。',
              tone: 'amber',
          });
          return;
      }
      const confirmed = await showGlassConfirm({
          title: '清理审批记录',
          message: `确认清理审批记录「${req.email}」？\n\n注意：此操作仅删除审批/申请记录，不影响已创建账号的登录状态。`,
          tone: 'amber',
          confirmText: '确认清理',
          cancelText: '取消',
      });
      if (!confirmed) {
          return;
      }
      const res = await deleteCloudSignupRequest(req.id);
      if (!res.success) {
          showGlassNotice({
              title: '清理失败',
              message: res.message || '清理失败',
              tone: 'rose',
          });
          return;
      }
      await loadSignupRequests();
      showGlassNotice({
          title: '审批记录已清理',
          message: res.message || '已清理审批记录。',
          tone: 'blue',
      });
  };

  const buildDashboardDataFromKpiSnapshot = (snapshot: { summary: KpiSnapshotSummary; monthlyTrends?: MonthlyTrend[]; dataVersion?: number }): DashboardData => {
      const summary = normalizeKpiSummaryWithMonthlyTrends(snapshot.summary, snapshot.monthlyTrends || []);
      return {
          ...generateInitialData(),
          annualRevenueTarget: summary.annualRevenueTarget,
          annualRevenueCollected: summary.annualRevenueCollected,
          annualOccupancyTarget: summary.annualOccupancyTarget,
          occupancyRate: summary.occupancyRate,
          totalArea: summary.totalArea,
          leasedArea: summary.leasedArea ?? 0,
          vacantArea: summary.vacantArea ?? Math.max(0, (summary.totalArea || 0) - (summary.leasedArea || 0)),
          accumulatedArrears: summary.accumulatedArrears || 0,
          monthlyRevenueTarget: summary.annualBudgetTarget,
          monthlyRevenueCollected: summary.annualRevenueCollected,
          collectionRate: summary.annualBudgetCompletion,
          monthlyTrends: snapshot.monthlyTrends || [],
          cloudSaveVersion: snapshot.dataVersion || 0,
      };
  };

  const mobileAuthorizedParks = useMemo(() => {
      if (!mobileNavLayout || !authUser) return [];
      const enabledParks = authorizedParks.filter((park) => park.enabled);
      if (isGlobalAdmin(authUser)) return enabledParks;
      const allowedProjectIds = authUser.allowedProjectIds.length
          ? authUser.allowedProjectIds
          : [authUser.projectId];
      const allowedSet = new Set(allowedProjectIds.filter(Boolean));
      return enabledParks.filter((park) => allowedSet.has(park.projectId));
  }, [authorizedParks, authUser, mobileNavLayout]);

  useEffect(() => {
      if (!mobileNavLayout || !authUser) return;
      const currentMobileScope =
          cloudConfig.projectId ||
          authUser.projectId ||
          mobileAuthorizedParks[0]?.projectId ||
          '';
      if (currentMobileScope && mobileKpiScope !== currentMobileScope) {
          setMobileKpiScope(currentMobileScope);
      }
  }, [mobileNavLayout, authUser?.id, authUser?.role, authUser?.projectId, cloudConfig.projectId, mobileKpiScope, mobileAuthorizedParks]);

  useEffect(() => {
      if (!mobileNavLayout || !isParkManagerOrAbove() || mobileAuthorizedParks.length === 0) {
          setIsLoadingMobileParkKpis(false);
          return;
      }
      let cancelled = false;
      const loadSeq = ++mobileKpiLoadSeqRef.current;
      const targetYear = selectedYear;
      const activeProjectId = cloudConfig.projectId || '';
      const now = Date.now();
      const cachedEntries = mobileParkSnapshotMapRef.current;
      const parksNeedingSnapshot = mobileAuthorizedParks.filter((park) => {
          if (park.projectId === activeProjectId) return false;
          const entry = cachedEntries[park.projectId];
          return !entry || entry.year !== targetYear || now - (entry.loadedAt || 0) > MOBILE_PARK_SNAPSHOT_CACHE_MS;
      });
      if (parksNeedingSnapshot.length === 0) {
          setIsLoadingMobileParkKpis(false);
          return;
      }
      setIsLoadingMobileParkKpis(true);
      setMobileParkSnapshotMap((prev) => {
          const next = { ...prev };
          for (const park of mobileAuthorizedParks) {
              const entry = next[park.projectId];
              if (entry && entry.year !== targetYear) delete next[park.projectId];
          }
          return next;
      });
      const hasUsableMobileSummary = (summary: Partial<KpiSnapshotSummary> | undefined): boolean =>
          !!summary &&
          (
              Math.abs(Number(summary.annualRevenueCollected || 0)) > 0.005 ||
              Math.abs(Number(summary.annualInitialBudget || summary.annualRevenueTarget || summary.annualBudgetTarget || 0)) > 0.005 ||
              Math.abs(Number(summary.totalArea || 0)) > 0.005 ||
              Math.abs(Number(summary.tenantCount || 0)) > 0.005
          );
      void (async () => {
          const entries = await Promise.all(
              parksNeedingSnapshot.map(async (park) => {
                  const parkConfig = { ...cloudConfig, projectId: park.projectId };
                  const [snapshotRes, serverVersion] = await Promise.all([
                      fetchCloudKpiSnapshot(parkConfig, targetYear).catch(() => null),
                      readCloudSaveVersion(parkConfig).catch(() => 0),
                  ]);
                  const snapshot = snapshotRes?.success ? snapshotRes.snapshot : undefined;
                  const snapshotFresh =
                      !!snapshot &&
                      snapshot.year === targetYear &&
                      (serverVersion <= 0 || (snapshot.dataVersion || 0) >= serverVersion);
                  if (snapshotFresh && snapshot) {
                      return {
                          projectId: park.projectId,
                          summary: normalizeKpiSummaryWithMonthlyTrends(
                              snapshot.summary,
                              snapshot.monthlyTrends || []
                          ),
                          dataVersion: snapshot.dataVersion,
                          year: targetYear,
                          loadedAt: Date.now(),
                          source: 'snapshot' as const,
                      };
                  }

                  if (!snapshotFresh) {
                      triggerServerComputeRefresh(parkConfig, targetYear);
                  }

                  if (snapshot && hasUsableMobileSummary(snapshot.summary)) {
                      console.warn('[mobile-kpi] 快照过期，已触发服务端重算，先展示旧 KPI', {
                          projectId: park.projectId,
                          snapshotVersion: snapshot.dataVersion,
                          serverVersion,
                          year: targetYear,
                      });
                      return {
                          projectId: park.projectId,
                          summary: normalizeKpiSummaryWithMonthlyTrends(
                              snapshot.summary,
                              snapshot.monthlyTrends || []
                          ),
                          dataVersion: snapshot.dataVersion,
                          year: targetYear,
                          loadedAt: Date.now(),
                          source: 'snapshot' as const,
                      };
                  }

                  const computed = await fetchCloudComputedDashboard(parkConfig, {
                      year: targetYear,
                      quarter: 'All',
                      billingSelectedMonth,
                      quickMode: false,
                      includeCurrentMonthBilling: false,
                      includePrevYearTrends: false,
                  }).catch(() => null);
                  if (computed?.success && computed.processedData) {
                      return {
                          projectId: park.projectId,
                          summary: buildKpiSummaryFromProcessedData(computed.processedData, targetYear),
                          dataVersion: computed.dataVersion,
                          year: targetYear,
                          loadedAt: Date.now(),
                          source: 'computed' as const,
                      };
                  }
                  return {
                      projectId: park.projectId,
                      summary: undefined,
                      year: targetYear,
                      loadedAt: Date.now(),
                  };
              })
          );
          if (cancelled || mobileKpiLoadSeqRef.current !== loadSeq) return;
          setMobileParkSnapshotMap((prev) => {
              const next = { ...prev };
              entries.forEach((entry) => {
                  if (!entry) return;
                  if (!entry.summary) {
                      delete next[entry.projectId];
                      return;
                  }
                  next[entry.projectId] = {
                      summary: entry.summary,
                      dataVersion: entry.dataVersion,
                      year: entry.year,
                      source: entry.source,
                      loadedAt: entry.loadedAt,
                  };
              });
              return next;
          });
          setIsLoadingMobileParkKpis(false);
      })();
      return () => {
          cancelled = true;
      };
  }, [mobileNavLayout, authUser?.id, authUser?.role, selectedYear, billingSelectedMonth, cloudConfig.pocketbaseUrl, cloudConfig.projectId, mobileAuthorizedParks]);

  const mobileCurrentParkKpi = useMemo(() => {
      if (!mobileNavLayout || !data) return null;
      return buildMobileParkKpiFromDashboard(
          data,
          selectedYear,
          cloudConfig.projectId || data.tenants?.[0]?.projectId || '',
          getCurrentParkName()
      );
  }, [data, selectedYear, cloudConfig.projectId, authorizedParks, mobileNavLayout]);

  const mobileParkKpis = useMemo(() => {
      if (!mobileNavLayout) return EMPTY_MOBILE_PARK_KPIS;
      return mobileAuthorizedParks.map((park) => {
          if (mobileCurrentParkKpi && park.projectId === cloudConfig.projectId) {
              return {
                  ...mobileCurrentParkKpi,
                  parkName: park.name,
              };
          }
          const snapshotEntry = mobileParkSnapshotMap[park.projectId];
          const snapshot = snapshotEntry?.year === selectedYear ? snapshotEntry.summary : undefined;
          return buildMobileParkKpiFromSummary(
              park.projectId,
              park.name,
              snapshot,
              snapshot ? snapshotEntry.source : 'empty'
          );
      });
  }, [mobileAuthorizedParks, mobileCurrentParkKpi, cloudConfig.projectId, mobileNavLayout, mobileParkSnapshotMap, selectedYear]);

  const mobileSelectedManagerKpi = useMemo(() => {
      if (!mobileNavLayout) return undefined;
      if (!isParkManagerOrAbove()) return mobileCurrentParkKpi || undefined;
      return (
          mobileParkKpis.find((item) => item.projectId === (mobileKpiScope || cloudConfig.projectId)) ||
          mobileCurrentParkKpi ||
          undefined
      );
  }, [mobileNavLayout, mobileKpiScope, mobileParkKpis, mobileCurrentParkKpi, cloudConfig.projectId, authUser?.role]);

  useEffect(() => {
      if (!canAccessSystemSettings && activeTab === 'settings') {
          setActiveTab('dashboard');
      }
  }, [canAccessSystemSettings, activeTab]);

  useEffect(() => {
      if (!mobileNavLayout) {
          setMobileMoreOpen(false);
          setMobileParkPickerOpen(false);
          return;
      }
      setSidebarOpen(false);
      if (activeTab === 'finance' && isParkManagerOrAbove()) {
          setActiveTab('dashboard');
          setMobileDashboardMode('search');
      }
  }, [mobileNavLayout, activeTab, authUser?.role]);

  useEffect(() => {
      if (!mobileNavLayout || mobileAuthorizedParks.length <= 1) {
          setMobileParkPickerOpen(false);
      }
  }, [mobileNavLayout, mobileAuthorizedParks.length]);

  useEffect(() => {
      if (activeTab === 'settings' && isPlatformAdmin()) {
          loadManagedUsers();
          loadSignupRequests();
      }
  }, [activeTab, authUser?.id, cloudConfig.projectId]);

  useEffect(() => {
      if (!authUser) {
          loadPublicParkOptions();
      }
  }, [authUser, cloudConfig.pocketbaseUrl]);

  const shouldRenderDesktopDashboard = shouldRenderDesktopDashboardContent({
      activeTab,
      mobileNavLayout,
  });

  const annualComparisonData: AnnualComparisonData[] = useMemo(() => {
      if (!shouldBuildAnnualComparisonDataForView({ activeTab, mobileNavLayout }) || !data) return [];

      const currentSystemYear = new Date().getFullYear();
      const years = [currentSystemYear - 2, currentSystemYear - 1, currentSystemYear];
      const BUDGET_EXECUTION_FROM_YEAR = 2026;
      const projectId = cloudConfig.projectId || data.tenants?.[0]?.projectId || '';
      const mgmtEnabled = isManagementFeeBillingEnabled(projectId);

      const sumMgmtFromTrends = (trends: MonthlyTrend[] | undefined) =>
          (trends || []).reduce((sum, t) => sum + (t.managementFeeCollected || 0), 0);
      const sumMgmtContractFromTrends = (trends: MonthlyTrend[] | undefined) =>
          (trends || []).reduce((sum, t) => sum + (t.managementFeeContractReceivable || 0), 0);

      const result: AnnualComparisonData[] = [];

      years.forEach((year, i) => {
          const initRows = data.initializationData?.filter(d => d.year === year) || [];

          // 年初预算：与预算执行表 / StatsCards 同源，来自初始化数据
          const yearlyInitialBudget = resolveAnnualInitialBudget(
              data.yearlyTargets,
              data.initializationData,
              year,
              cloudConfig.projectId || data.tenants?.[0]?.projectId
          );

          // 实际收款：2026 前从初始化数据；2026 起与上方预算执行表合计一致
          let yearlyActual = 0;
          if (year < BUDGET_EXECUTION_FROM_YEAR) {
              yearlyActual = initRows.reduce((sum, r) => sum + (r.revenueCollected || 0), 0);
          } else if (year === selectedYear) {
              yearlyActual = (data.monthlyTrends || []).reduce(
                  (sum, t) => sum + (t.revenueCollected != null ? t.revenueCollected : 0),
                  0
              );
          } else {
              yearlyActual = initRows.reduce((sum, r) => sum + (r.revenueCollected || 0), 0);
          }

          let occupancy = 0;
          if (year < BUDGET_EXECUTION_FROM_YEAR) {
              const latestInit = [...initRows].sort((a, b) => b.month - a.month)[0];
              occupancy = latestInit?.occupancyRate || 0;
          } else {
              const decInit = initRows.find(d => d.month === 12);
              if (decInit) {
                  occupancy = decInit.occupancyRate;
              } else if (year === selectedYear) {
                  occupancy = data.occupancyRate;
              } else if (year === selectedYear - 1 && data.prevYearMonthlyTrends && data.prevYearMonthlyTrends.length > 0) {
                  occupancy = data.prevYearMonthlyTrends[data.prevYearMonthlyTrends.length - 1].occupancyRate;
              }
          }

          let revenueYoY: number | null = null;
          let occupancyYoY: number | null = null;

          if (i > 0) {
              const prev = result[i - 1];
              if (prev.revenueActual > 0) {
                  revenueYoY = ((yearlyActual - prev.revenueActual) / prev.revenueActual) * 100;
              }
              occupancyYoY = occupancy - prev.occupancyRate;
          }

          let managementFeeActual = 0;
          let managementFeeContractReceivable = 0;
          if (mgmtEnabled) {
              if (year === selectedYear) {
                  managementFeeActual = sumMgmtFromTrends(data.monthlyTrends);
                  managementFeeContractReceivable = sumMgmtContractFromTrends(data.monthlyTrends);
              } else if (year === selectedYear - 1) {
                  managementFeeActual = sumMgmtFromTrends(data.prevYearMonthlyTrends);
                  managementFeeContractReceivable = sumMgmtContractFromTrends(data.prevYearMonthlyTrends);
              }
          }

          result.push({
              year,
              revenueTarget: yearlyInitialBudget,
              revenueActual: yearlyActual,
              revenueCompletionRate: yearlyInitialBudget > 0 ? (yearlyActual / yearlyInitialBudget) * 100 : 0,
              revenueYoY,
              occupancyRate: occupancy,
              occupancyYoY,
              managementFeeActual: mgmtEnabled ? managementFeeActual : undefined,
              managementFeeContractReceivable: mgmtEnabled ? managementFeeContractReceivable : undefined,
              managementFeeCompletionRate:
                  mgmtEnabled && managementFeeContractReceivable > 0
                      ? (managementFeeActual / managementFeeContractReceivable) * 100
                      : undefined,
              combinedActual: mgmtEnabled ? yearlyActual + managementFeeActual : undefined,
              combinedCompletionRate:
                  mgmtEnabled && yearlyInitialBudget + managementFeeContractReceivable > 0
                      ? ((yearlyActual + managementFeeActual) / (yearlyInitialBudget + managementFeeContractReceivable)) * 100
                      : undefined,
          });
      });

      return result;
  }, [activeTab, data, mobileNavLayout, selectedYear, cloudConfig.projectId]);

  const dashboardBillingError =
      shouldBuildDashboardBillingKey && dashboardBillingState.key === dashboardBillingKey
          ? dashboardBillingState.error
          : undefined;
  const dashboardBillingReady =
      shouldBuildDashboardBillingKey &&
      dashboardBillingState.key === dashboardBillingKey &&
      !dashboardBillingState.loading &&
      !dashboardBillingError;
  const dashboardBillingDataMemoRef = React.useRef<{ key: string; value: DashboardData } | null>(null);
  const dashboardBillingData = useMemo(() => {
      const shouldBuildBillingData = shouldBuildDashboardBillingDataForView({
          activeTab,
          mobileNavLayout,
          showDashboardBillingTable,
          dashboardBillingReady,
      });
      if (!shouldBuildBillingData || !data) {
          dashboardBillingDataMemoRef.current = null;
          return null;
      }
      const displayDataKey = dashboardBillingDisplayDataIdentityKey(data, dashboardBillingState.rows);
      const cached = dashboardBillingDataMemoRef.current;
      if (cached?.key === displayDataKey) return cached.value;
      const value = {
          ...data,
          currentMonthBilling: dashboardBillingState.rows,
      };
      dashboardBillingDataMemoRef.current = { key: displayDataKey, value };
      return value;
  }, [activeTab, data, dashboardBillingReady, dashboardBillingState.rows, mobileNavLayout, showDashboardBillingTable]);

  const deferredMobileSearchQuery = React.useDeferredValue(mobileSearchQuery);
  const shouldBuildMobileTenantSearchIndex = shouldBuildMobileTenantSearchIndexForView({
      mobileNavLayout,
      activeTab,
      mobileDashboardMode,
  });

  const mobileSearchBuildings = shouldBuildMobileTenantSearchIndex
      ? data?.buildings || EMPTY_MOBILE_SEARCH_BUILDINGS
      : EMPTY_MOBILE_SEARCH_BUILDINGS;
  const mobileSearchTenants = shouldBuildMobileTenantSearchIndex
      ? data?.tenants || EMPTY_MOBILE_SEARCH_TENANTS
      : EMPTY_MOBILE_SEARCH_TENANTS;
  const mobileSearchPayments = shouldBuildMobileTenantSearchIndex
      ? data?.payments || EMPTY_MOBILE_SEARCH_PAYMENTS
      : EMPTY_MOBILE_SEARCH_PAYMENTS;
  const mobileSearchBillingRows = shouldBuildMobileTenantSearchIndex
      ? dashboardBillingData?.currentMonthBilling || data?.currentMonthBilling || EMPTY_MOBILE_SEARCH_BILLING
      : EMPTY_MOBILE_SEARCH_BILLING;
  useEffect(() => {
      let cancelled = false;
      if (!shouldBuildMobileTenantSearchIndex || !data) {
          setMobileSearchHistoricalArrears(createUnavailableTenantHistoricalArrears('客户查询未启用'));
          return () => {
              cancelled = true;
          };
      }

      setMobileSearchHistoricalArrears(createUnavailableTenantHistoricalArrears('正在计算客户历史欠费…'));
      const projectId = (cloudConfig.projectId || '').trim();
      const loadLocalHistoricalArrears = async () => {
          const { buildTenantHistoricalArrears } = await import('./services/tenantHistoricalArrears');
          return buildTenantHistoricalArrears({
              data,
              includeBillingDetail: (detail) => canCurrentUserSeeHistoricalArrearsDetail(detail, authUser),
          });
      };
      const loadHistoricalArrears = async () => {
          const canUseCloud =
              serverComputeEnabled &&
              isCloudConnected &&
              !!authUser?.enabled &&
              !!projectId &&
              !(await hasLocalPendingChanges(data, projectId).catch(() => true));
          if (canUseCloud) {
              const cloud = await fetchCloudTenantHistoricalArrears(cloudConfig).catch(() => null);
              if (cancelled) return;
              if (cloud?.success) {
                  if (cloud.available === false) {
                      setMobileSearchHistoricalArrears(
                          createUnavailableTenantHistoricalArrears(
                              cloud.unavailableReason || cloud.message || '客户历史欠费暂不可用'
                          )
                      );
                      return;
                  }
                  if (cloud.available && cloud.byTenantId) {
                      setMobileSearchHistoricalArrears({
                          available: true,
                          byTenantId: cloud.byTenantId,
                          startPeriod: cloud.startPeriod,
                          endPeriod: cloud.endPeriod,
                      });
                      return;
                  }
              }
          }

          const local = await loadLocalHistoricalArrears();
          if (cancelled) return;
          setMobileSearchHistoricalArrears(local);
      };
      loadHistoricalArrears().catch((error) => {
          if (cancelled) return;
          setMobileSearchHistoricalArrears(
              createUnavailableTenantHistoricalArrears(
                  error instanceof Error ? error.message : '客户历史欠费计算加载失败'
              )
          );
      });

      return () => {
          cancelled = true;
      };
  }, [
      authUser?.enabled,
      authUser?.receivablePermissions,
      authUser?.role,
      cloudConfig,
      data,
      hasLocalPendingChanges,
      isCloudConnected,
      serverComputeEnabled,
      shouldBuildMobileTenantSearchIndex,
  ]);
  const mobileSearchBuildingOptions = useMemo<MobileSearchBuildingOption[]>(() => {
      return (data?.buildings || [])
          .filter((building) => !!building.id)
          .map((building) => ({ id: building.id, name: building.name || building.id }));
  }, [data?.buildings]);

  useEffect(() => {
      if (
          mobileSearchBuildingFilter !== 'all' &&
          !mobileSearchBuildingOptions.some((option) => option.id === mobileSearchBuildingFilter)
      ) {
          setMobileSearchBuildingFilter('all');
      }
  }, [mobileSearchBuildingFilter, mobileSearchBuildingOptions]);

  const mobileTenantSearchIndex = useMemo<MobileTenantSearchIndexEntry[]>(() => {
      if (!shouldBuildMobileTenantSearchIndex) return [];
      return buildMobileTenantSearchIndex({
          buildings: mobileSearchBuildings,
          tenants: mobileSearchTenants,
          payments: mobileSearchPayments,
          billingDetails: mobileSearchBillingRows,
          historicalArrearsByTenantId: mobileSearchHistoricalArrears.available ? mobileSearchHistoricalArrears.byTenantId : undefined,
      });
  }, [
      mobileSearchBillingRows,
      mobileSearchBuildings,
      mobileSearchHistoricalArrears.available,
      mobileSearchHistoricalArrears.byTenantId,
      mobileSearchPayments,
      mobileSearchTenants,
      shouldBuildMobileTenantSearchIndex,
  ]);

  const mobileSearchExpiryMonthOptions = useMemo<MobileSearchExpiryMonthOption[]>(() => {
      const countByMonth = new Map<string, number>();
      mobileTenantSearchIndex.forEach((item) => {
          if (!item.leaseEndMonth || item.status === ContractStatus.Terminated) return;
          countByMonth.set(item.leaseEndMonth, (countByMonth.get(item.leaseEndMonth) || 0) + 1);
      });
      return Array.from(countByMonth.entries())
          .sort(([a], [b]) => a.localeCompare(b))
          .slice(0, 12)
          .map(([key, count]) => {
              const [year, month] = key.split('-');
              return { key, count, label: `${year}年${Number(month)}月` };
          });
  }, [mobileTenantSearchIndex]);

  useEffect(() => {
      if (
          mobileSearchExpiryMonthFilter !== 'all' &&
          !mobileSearchExpiryMonthOptions.some((option) => option.key === mobileSearchExpiryMonthFilter)
      ) {
          setMobileSearchExpiryMonthFilter('all');
      }
  }, [mobileSearchExpiryMonthFilter, mobileSearchExpiryMonthOptions]);

  useEffect(() => {
      if (!mobileSearchHistoricalArrears.available && mobileSearchArrearsFilter !== 'all') {
          setMobileSearchArrearsFilter('all');
      }
  }, [mobileSearchArrearsFilter, mobileSearchHistoricalArrears.available]);

  const mobileFilteredTenantSearchIndex = useMemo<MobileTenantSearchIndexEntry[]>(() => {
      if (!shouldBuildMobileTenantSearchIndex) return [];
      const statusFilter =
          mobileSearchFilter === 'active'
              ? ContractStatus.Active
              : mobileSearchFilter === 'expiring'
                ? ContractStatus.Expiring
                : mobileSearchFilter === 'pending'
                  ? ContractStatus.Pending
                  : undefined;
      return filterMobileTenantSearchIndex(mobileTenantSearchIndex, {
          status: statusFilter,
          buildingId: mobileSearchBuildingFilter === 'all' ? undefined : mobileSearchBuildingFilter,
          leaseEndMonth: mobileSearchExpiryMonthFilter === 'all' ? undefined : mobileSearchExpiryMonthFilter,
          paymentFilter: mobileSearchPaymentFilter,
          receivableFilter: mobileSearchReceivableFilter,
          arrearsFilter: mobileSearchHistoricalArrears.available ? mobileSearchArrearsFilter : 'all',
      });
  }, [
      mobileSearchArrearsFilter,
      mobileSearchBuildingFilter,
      mobileSearchExpiryMonthFilter,
      mobileSearchFilter,
      mobileSearchHistoricalArrears.available,
      mobileSearchPaymentFilter,
      mobileSearchReceivableFilter,
      mobileTenantSearchIndex,
      shouldBuildMobileTenantSearchIndex,
  ]);

  const mobileSearchAdvancedActiveCount =
      (mobileSearchBuildingFilter !== 'all' ? 1 : 0) +
      (mobileSearchExpiryMonthFilter !== 'all' ? 1 : 0) +
      (mobileSearchPaymentFilter !== 'all' ? 1 : 0) +
      (mobileSearchReceivableFilter !== 'all' ? 1 : 0) +
      (mobileSearchHistoricalArrears.available && mobileSearchArrearsFilter !== 'all' ? 1 : 0);

  const clearMobileSearchFilters = () => {
      setMobileSearchQuery('');
      setMobileSearchFilter('all');
      setMobileSearchBuildingFilter('all');
      setMobileSearchExpiryMonthFilter('all');
      setMobileSearchPaymentFilter('all');
      setMobileSearchReceivableFilter('all');
      setMobileSearchArrearsFilter('all');
      setMobileSearchResultLimit(MOBILE_TENANT_SEARCH_PAGE_SIZE);
  };

  React.useEffect(() => {
      setMobileSearchResultLimit(MOBILE_TENANT_SEARCH_PAGE_SIZE);
  }, [
      deferredMobileSearchQuery,
      mobileSearchArrearsFilter,
      mobileSearchBuildingFilter,
      mobileSearchExpiryMonthFilter,
      mobileSearchFilter,
      mobileSearchHistoricalArrears.available,
      mobileSearchPaymentFilter,
      mobileSearchReceivableFilter,
  ]);

  const mobileSearchResultCount = useMemo(() => {
      if (!shouldBuildMobileTenantSearchIndex) return 0;
      return countMobileTenantSearchResults(mobileFilteredTenantSearchIndex, deferredMobileSearchQuery);
  }, [deferredMobileSearchQuery, mobileFilteredTenantSearchIndex, shouldBuildMobileTenantSearchIndex]);

  const mobileSearchResults = useMemo<MobileTenantSearchResult[]>(() => {
      if (!shouldBuildMobileTenantSearchIndex) return [];
      return selectMobileTenantSearchResults(mobileFilteredTenantSearchIndex, deferredMobileSearchQuery, mobileSearchResultLimit);
  }, [deferredMobileSearchQuery, mobileFilteredTenantSearchIndex, mobileSearchResultLimit, shouldBuildMobileTenantSearchIndex]);

  const canCollapseMobileSearchResults =
      mobileSearchResultLimit > MOBILE_TENANT_SEARCH_PAGE_SIZE &&
      mobileSearchResultCount > MOBILE_TENANT_SEARCH_PAGE_SIZE;

  const loadMoreMobileSearchResults = React.useCallback(() => {
      setMobileSearchResultLimit((current) => Math.min(current + MOBILE_TENANT_SEARCH_PAGE_SIZE, Math.max(MOBILE_TENANT_SEARCH_PAGE_SIZE, mobileSearchResultCount)));
  }, [mobileSearchResultCount]);

  const collapseMobileSearchResults = React.useCallback(() => {
      setMobileSearchResultLimit(MOBILE_TENANT_SEARCH_PAGE_SIZE);
  }, []);

  if (!bootReady) {
      return (
	          <div className="flex min-h-screen min-h-[100dvh] items-center justify-center bg-slate-50">
              <div className="flex flex-col items-center gap-2">
                  <Loader2 size={32} className="text-blue-500 animate-spin" />
                  <div className="text-slate-500">正在连接后端…</div>
              </div>
          </div>
      );
  }

	  if (!authUser) {
	      return (
		          <div className="ios-liquid-app relative flex min-h-screen min-h-[100dvh] items-center justify-center overflow-hidden px-4 py-8 text-slate-950 sm:px-6">
	              <div className="pointer-events-none absolute inset-x-4 top-4 h-24 rounded-[36px] bg-white/28 blur-3xl md:inset-x-20 md:top-8" />
	              <form
	                  onSubmit={authMode === 'login' ? handleLogin : handleSignupSubmit}
	                  aria-labelledby="auth-form-title"
	                  aria-describedby="auth-form-description"
	                  className="liquid-auth-panel relative z-10 grid w-full max-w-5xl gap-0 overflow-hidden rounded-[32px] p-4 md:grid-cols-[0.92fr_1.08fr] md:p-5"
	              >
	                  <div className="hidden min-h-[560px] flex-col justify-between rounded-[26px] border border-white/60 bg-white/36 p-8 shadow-inner md:flex">
	                      <div>
	                          <div className="flex items-center gap-3">
	                              <div className="liquid-icon-well flex h-12 w-12 items-center justify-center rounded-2xl text-blue-700">
	                                  <Building2 size={24} />
	                              </div>
	                              <div>
	                                  <p className="text-xs font-black uppercase text-blue-700/80">Kingdee Park</p>
	                                  <h1 className="text-2xl font-black tracking-normal text-slate-950">招商管理系统</h1>
	                              </div>
	                          </div>
	                          <div className="mt-12 space-y-4">
	                              <div className="liquid-glass-readable rounded-3xl p-5">
	                                  <div className="flex items-center gap-2 text-sm font-black text-blue-700">
	                                      <ShieldCheck size={18} />
	                                      <span>账号权限随园区加载</span>
	                                  </div>
	                                  <p className="mt-3 text-sm leading-6 text-slate-600">
	                                      登录后自动读取可访问园区、角色权限和字段展示设置，进入后保持原有经营指标计算口径。
	                                  </p>
	                              </div>
	                              <div className="grid grid-cols-2 gap-3">
	                                  <div className="liquid-glass-subtle rounded-3xl p-4">
	                                      <p className="text-xs font-bold text-slate-500">权限</p>
	                                      <p className="mt-2 text-lg font-black text-slate-950">按人员</p>
	                                  </div>
	                                  <div className="liquid-glass-subtle rounded-3xl p-4">
	                                      <p className="text-xs font-bold text-slate-500">数据</p>
	                                      <p className="mt-2 text-lg font-black text-slate-950">按园区</p>
	                                  </div>
	                              </div>
	                          </div>
	                      </div>
	                      <div className="flex items-center gap-2 text-xs font-bold text-slate-500">
	                          <Sparkles size={14} className="text-blue-500" />
	                          <span>透明毛玻璃界面，关键数据使用高可读层承载。</span>
	                      </div>
	                  </div>

		                  <div className="flex min-h-[calc(100dvh-96px)] flex-col justify-center px-1 py-3 md:min-h-[560px] md:px-9 md:py-8">
	                      <div className="mx-auto w-full max-w-[430px]">
	                          <div className="mb-7 text-center md:text-left">
	                              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-[22px] border border-white/70 bg-white/58 text-blue-700 shadow-lg shadow-blue-900/5 md:mx-0">
	                                  <Cloud size={26} />
	                              </div>
	                              <p className="text-xs font-black uppercase tracking-[0.18em] text-blue-700/75">
	                                  {authMode === 'login' ? 'Welcome Back' : 'Access Request'}
	                              </p>
	                              <h2 id="auth-form-title" className="mt-2 text-2xl font-black tracking-normal text-slate-950 md:text-3xl">
	                                  {authMode === 'login' ? '登录工作台' : '提交注册申请'}
	                              </h2>
	                              <p id="auth-form-description" className="mt-2 text-sm font-semibold leading-6 text-slate-500">
	                                  {authMode === 'login' ? '验证后加载园区数据、个人字段和当前权限。' : '管理员审批后即可按授权园区登录。'}
	                              </p>
	                          </div>

	                          <div className="liquid-auth-segment mb-5 grid grid-cols-2 rounded-full p-1.5" role="group" aria-label="登录方式">
	                              <button
	                                  type="button"
	                                  aria-pressed={authMode === 'login'}
	                                  onClick={() => { setAuthMode('login'); setSignupMsg(null); }}
	                                  className={`liquid-pressable rounded-full px-4 py-2.5 text-sm font-black transition ${authMode === 'login' ? 'liquid-action-strong' : 'text-slate-500 hover:text-slate-900'}`}
	                              >
	                                  登录
	                              </button>
	                              <button
	                                  type="button"
	                                  aria-pressed={authMode === 'register'}
	                                  onClick={() => { setAuthMode('register'); setLoginError(null); }}
	                                  className={`liquid-pressable rounded-full px-4 py-2.5 text-sm font-black transition ${authMode === 'register' ? 'liquid-action-strong' : 'text-slate-500 hover:text-slate-900'}`}
	                              >
	                                  注册申请
	                              </button>
	                          </div>

	                          <div className="space-y-4">
	                              <div>
	                                  <label htmlFor="auth-email" className="mb-1.5 block text-xs font-black text-slate-500">邮箱</label>
	                                  <div className="relative">
	                                      <Mail className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={17} />
	                                      <input
	                                          id="auth-email"
	                                          type="email"
	                                          inputMode="email"
	                                          enterKeyHint="next"
	                                          className="liquid-auth-field w-full rounded-2xl py-3 pl-11 pr-4 text-sm font-semibold text-slate-900 outline-none transition placeholder:text-slate-500 focus:border-blue-300 focus:ring-4 focus:ring-blue-500/10"
	                                          value={authMode === 'login' ? loginForm.email : signupForm.email}
	                                          onChange={e => authMode === 'login' ? setLoginForm({ ...loginForm, email: e.target.value }) : setSignupForm(prev => ({ ...prev, email: e.target.value }))}
	                                          placeholder="user@example.com"
	                                          autoComplete={authMode === 'login' ? 'username' : 'email'}
	                                          autoCapitalize="none"
	                                          spellCheck={false}
	                                      />
	                                  </div>
	                              </div>
	                              {authMode === 'register' && (
	                                  <div>
	                                      <label htmlFor="auth-applicant-name" className="mb-1.5 block text-xs font-black text-slate-500">姓名</label>
	                                      <div className="relative">
	                                          <User className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={17} />
	                                          <input
	                                              id="auth-applicant-name"
	                                              type="text"
	                                              inputMode="text"
	                                              enterKeyHint="next"
	                                              className="liquid-auth-field w-full rounded-2xl py-3 pl-11 pr-4 text-sm font-semibold text-slate-900 outline-none transition placeholder:text-slate-500 focus:border-blue-300 focus:ring-4 focus:ring-blue-500/10"
	                                              value={signupForm.applicantName}
	                                              onChange={(e) => setSignupForm((prev) => ({ ...prev, applicantName: e.target.value }))}
	                                              placeholder="真实姓名"
	                                              autoComplete="name"
	                                          />
	                                      </div>
	                                  </div>
	                              )}
	                              <div>
	                                  <label htmlFor="auth-password" className="mb-1.5 block text-xs font-black text-slate-500">密码</label>
	                                  <div className="relative">
	                                      <LockKeyhole className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={17} />
	                                      <input
	                                          id="auth-password"
	                                          type="password"
	                                          enterKeyHint={authMode === 'login' ? 'go' : 'done'}
	                                          className="liquid-auth-field w-full rounded-2xl py-3 pl-11 pr-4 text-sm font-semibold text-slate-900 outline-none transition placeholder:text-slate-500 focus:border-blue-300 focus:ring-4 focus:ring-blue-500/10"
	                                          value={authMode === 'login' ? loginForm.password : signupForm.password}
	                                          onChange={e => authMode === 'login' ? setLoginForm({ ...loginForm, password: e.target.value }) : setSignupForm(prev => ({ ...prev, password: e.target.value }))}
	                                          placeholder="请输入密码"
	                                          autoComplete={authMode === 'login' ? 'current-password' : 'new-password'}
	                                      />
	                                  </div>
	                              </div>
	                              {authMode === 'register' && (
	                                  <div>
	                                      <div className="mb-2 flex items-center justify-between gap-3">
	                                          <div id="auth-park-options-label" className="text-xs font-black text-slate-500">申请园区（可多选）</div>
	                                          <div aria-live="polite" aria-atomic="true" className="rounded-full bg-white/54 px-2.5 py-1 text-xs font-black text-blue-700">
	                                              已选 {signupForm.requestedProjectIds.length}
	                                          </div>
	                                      </div>
	                                      <div className="liquid-auth-field max-h-44 space-y-2 overflow-y-auto rounded-3xl p-2" role="group" aria-labelledby="auth-park-options-label" aria-busy={isLoadingPublicParks}>
	                                          {isLoadingPublicParks ? (
	                                              <div role="status" aria-live="polite" className="px-3 py-3 text-xs font-bold text-slate-500">正在加载园区...</div>
	                                          ) : publicParks.length === 0 ? (
	                                              <div role="status" aria-live="polite" className="px-3 py-3 text-xs font-bold text-slate-500">暂无可选园区，请联系管理员</div>
	                                          ) : (
	                                              publicParks.map((park, parkIndex) => {
	                                                  const checked = signupForm.requestedProjectIds.includes(park.projectId);
	                                                  const parkMetaId = `auth-park-option-meta-${parkIndex}`;
	                                                  return (
	                                                      <label key={park.projectId} className={`liquid-auth-park-option liquid-pressable flex cursor-pointer items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-bold transition ${checked ? 'border-blue-300 bg-blue-500/10 text-blue-800' : 'border-transparent text-slate-700 hover:bg-white/70'}`}>
	                                                          <input
	                                                              type="checkbox"
	                                                              aria-describedby={parkMetaId}
	                                                              className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500/20"
	                                                              checked={checked}
	                                                              onChange={(e) => {
	                                                                  const nextIds = e.target.checked
	                                                                      ? Array.from(new Set([...signupForm.requestedProjectIds, park.projectId]))
	                                                                      : signupForm.requestedProjectIds.filter(pid => pid !== park.projectId);
	                                                                  setSignupForm(prev => ({ ...prev, requestedProjectIds: nextIds }));
	                                                              }}
	                                                          />
	                                                          <span className="min-w-0 flex-1 truncate">{park.name}</span>
	                                                          <span id={parkMetaId} className="sr-only">园区编号 {park.projectId}</span>
	                                                          <span aria-hidden="true" className="hidden shrink-0 text-xs font-black text-slate-500 sm:inline">{park.projectId}</span>
	                                                      </label>
	                                                  );
	                                              })
	                                          )}
	                                      </div>
	                                  </div>
	                              )}
	                          </div>

	                          {loginError && (
	                              <div role="alert" aria-live="assertive" className="mt-4 rounded-2xl border border-rose-200 bg-rose-50/80 px-4 py-3 text-sm font-bold text-rose-700">
	                                  {loginError}
	                              </div>
	                          )}
	                          {signupMsg && (
	                              <div
	                                  role={signupMsg.includes('失败') || signupMsg.includes('请') ? 'alert' : 'status'}
	                                  aria-live={signupMsg.includes('失败') || signupMsg.includes('请') ? 'assertive' : 'polite'}
	                                  className={`mt-4 rounded-2xl border px-4 py-3 text-sm font-bold ${signupMsg.includes('失败') || signupMsg.includes('请') ? 'border-rose-200 bg-rose-50/80 text-rose-700' : 'border-blue-200 bg-blue-50/80 text-blue-800'}`}
	                              >
	                                  {signupMsg}
	                              </div>
	                          )}

	                          <button
	                              type="submit"
	                              disabled={authMode === 'login' ? isLoggingIn : isSubmittingSignup}
	                              aria-busy={authMode === 'login' ? isLoggingIn : isSubmittingSignup}
	                              className="liquid-action-strong liquid-pressable mt-5 flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-black shadow-lg shadow-blue-900/10 disabled:cursor-not-allowed disabled:opacity-60"
	                          >
	                              {(authMode === 'login' ? isLoggingIn : isSubmittingSignup) ? <Loader2 size={16} className="animate-spin" /> : <Cloud size={16} />}
	                              {authMode === 'login' ? '登录并加载园区数据' : '提交注册申请'}
	                          </button>
	                      </div>
	                  </div>
	              </form>
	          </div>
	      );
	  }

  if (!data) {
      return (
	      <div className="flex min-h-screen min-h-[100dvh] items-center justify-center bg-slate-50">
              <div className="flex flex-col items-center gap-2">
                  <Loader2 size={32} className="text-blue-500 animate-spin" />
                  <div className="text-slate-500">Loading Dashboard...</div>
              </div>
          </div>
      );
  }

  const pageTitle =
      activeTab === 'dashboard' ? '金蝶地产——招商管理系统' :
      activeTab === 'buildings' ? '楼宇资产管理' :
      activeTab === 'contracts' ? (mobileNavLayout && isParkManagerOrAbove() ? '合同查询' : mobileNavLayout ? '合同录入' : '客户合同中心') :
      activeTab === 'finance' ? (mobileNavLayout && isParkManagerOrAbove() ? '客户收款查询' : mobileNavLayout ? '收款核销' : '财务收款报表') :
      activeTab === 'budget' ? '招商预算管理' :
      activeTab === 'initData' ? '初始化数据' :
      '系统设置';
  const mobilePageTitle =
      activeTab === 'dashboard' ? (mobileDashboardMode === 'search' ? (isParkManagerOrAbove() ? '收款查询' : '快速查询') : '招商工作台') :
      activeTab === 'contracts' ? (isParkManagerOrAbove() ? '合同查询' : '合同录入') :
      activeTab === 'finance' ? (isParkManagerOrAbove() ? '收款查询' : '收款核销') :
      pageTitle;
  const currentParkDisplayName = getCurrentParkName();
  const mobileCanSwitchParks = mobileNavLayout && mobileAuthorizedParks.length > 1;
  const handleMobileTopParkSelect = (projectId: string) => {
      setMobileParkPickerOpen(false);
      if (!projectId) return;
      setMobileKpiScope(projectId);
      void switchProject(projectId);
  };
  const mobilePageContext =
      activeTab === 'dashboard'
        ? mobileDashboardMode === 'search'
          ? `${currentParkDisplayName} · ${billingSelectedMonth} 账期 · 客户查询`
          : `${currentParkDisplayName} · ${selectedYear} 年度 · 今日待办`
        : activeTab === 'finance'
          ? `${currentParkDisplayName} · ${financeReceivableMonth} 账期 · 应收核销`
          : activeTab === 'contracts'
            ? `${currentParkDisplayName} · ${selectedYear} 年度 · 合同轻管理`
            : activeTab === 'budget'
              ? `${currentParkDisplayName} · ${selectedYear} 年度 · 预算执行`
              : activeTab === 'initData'
                ? `${currentParkDisplayName} · ${selectedYear} 年度 · 口径维护`
                : activeTab === 'buildings'
                  ? `${currentParkDisplayName} · 房源与面积 · 轻管理`
                  : `${currentParkDisplayName} · 权限与备份`;
  const isManagerMobileView = isParkManagerOrAbove();
  const managerMobileNav = mobileNavLayout && isManagerMobileView;
  const isFullDataPending = isKpiPreview;
	  const goMobileOverview = () => {
	      setActiveTab('dashboard');
	      setMobileDashboardMode('overview');
	      setSidebarOpen(false);
	      setMobileMoreOpen(false);
	  };
	  const toMobileTenantActionFocus = (item: unknown): MobileTenantActionFocus | null => {
	      const candidate = item as Partial<MobileTenantSearchResult> | null | undefined;
	      if (!candidate || typeof candidate.id !== 'string' || typeof candidate.name !== 'string') return null;
	      return {
	          tenantId: candidate.id,
	          tenantName: candidate.name,
	          requestId: Date.now(),
	      };
	  };
	  const goMobileContracts = (item?: MobileTenantSearchResult) => {
	      const focus = toMobileTenantActionFocus(item);
	      if (focus) {
	          setMobileContractFocus(focus);
	      } else {
	          setMobileContractFocus(null);
	      }
	      setActiveTab('contracts');
	      setMobileDashboardMode('overview');
	      setSidebarOpen(false);
	      setMobileMoreOpen(false);
	  };
	  const goMobileFinance = (item?: MobileTenantSearchResult) => {
	      if (managerMobileNav) {
	          setActiveTab('dashboard');
	          setMobileDashboardMode('search');
	          setSidebarOpen(false);
	          setMobileMoreOpen(false);
	          return;
	      }
	      const focus = toMobileTenantActionFocus(item);
	      if (focus) {
	          setMobileFinanceFocus(focus);
	      } else {
	          setMobileFinanceFocus(null);
	      }
	      setActiveTab('finance');
	      setMobileDashboardMode('overview');
	      setSidebarOpen(false);
	      setMobileMoreOpen(false);
	  };
	  const goMobileSearch = () => {
	      setActiveTab('dashboard');
	      setMobileDashboardMode('search');
	      setSidebarOpen(false);
	      setMobileMoreOpen(false);
	  };
	  const openMobileManagedTab = (tab: typeof activeTab) => {
	      setActiveTab(tab);
	      setMobileDashboardMode('overview');
	      setSidebarOpen(false);
	      setMobileMoreOpen(false);
	  };
	  const mobileMoreActive = ['buildings', 'budget', 'initData', 'settings'].includes(activeTab);
		  const mobileMoreItems: MobileMoreItem[] = [
	      {
	          key: 'buildings',
	          label: '楼宇资管',
	          description: '房源、面积与平面管理',
	          icon: <Building2 size={18} />,
	          active: activeTab === 'buildings',
	          disabled: isFullDataPending,
	          onClick: () => openMobileManagedTab('buildings'),
	      },
	      {
	          key: 'budget',
	          label: '预算管理',
	          description: '方案、预算表与执行跟踪',
	          icon: <Calculator size={18} />,
	          active: activeTab === 'budget',
	          disabled: isFullDataPending,
	          onClick: () => openMobileManagedTab('budget'),
	      },
	      {
	          key: 'initData',
	          label: '初始化数据',
	          description: '年度基准、历史实收与预算导入',
	          icon: <TableIcon size={18} />,
	          active: activeTab === 'initData',
	          disabled: isFullDataPending,
	          onClick: () => openMobileManagedTab('initData'),
	      },
	      ...(canAccessSystemSettings ? [{
	          key: 'settings',
	          label: '系统与备份',
	          description: '账号、备份与云端配置',
	          icon: <Settings size={18} />,
	          active: activeTab === 'settings',
	          disabled: false,
	          onClick: () => openMobileManagedTab('settings'),
	      }] : []),
	  ];
		  const mobileMoreNavItem: MobileNavItem = {
	      key: 'more',
	      label: '更多',
	      icon: <MoreHorizontal size={18} />,
	      active: mobileMoreActive || isMobileMoreOpen,
	      onClick: () => setMobileMoreOpen((open) => !open),
	  };
		  const mobileBottomNavItems: MobileNavItem[] = managerMobileNav ? [
	      {
	          key: 'overview',
	          label: '工作台',
          icon: <LayoutDashboard size={18} />,
          active: activeTab === 'dashboard' && mobileDashboardMode === 'overview',
          onClick: goMobileOverview,
      },
      {
          key: 'contracts',
          label: '合同',
          icon: <FileText size={18} />,
          active: activeTab === 'contracts',
          onClick: goMobileContracts,
      },
      {
          key: 'search',
          label: '收款',
          icon: <Search size={18} />,
	          active: activeTab === 'dashboard' && mobileDashboardMode === 'search',
	          onClick: goMobileSearch,
	      },
	      mobileMoreNavItem,
	  ] : [
	      {
	          key: 'overview',
          label: '工作台',
          icon: <LayoutDashboard size={18} />,
          active: activeTab === 'dashboard' && mobileDashboardMode === 'overview',
          onClick: goMobileOverview,
      },
      {
          key: 'contracts',
          label: '合同',
          icon: <FileText size={18} />,
          active: activeTab === 'contracts',
          onClick: goMobileContracts,
      },
      {
          key: 'finance',
          label: '核销',
          icon: <CheckCircle2 size={18} />,
          active: activeTab === 'finance',
          onClick: goMobileFinance,
      },
      {
          key: 'search',
          label: '查询',
          icon: <Search size={18} />,
	          active: activeTab === 'dashboard' && mobileDashboardMode === 'search',
	          onClick: goMobileSearch,
	      },
	      mobileMoreNavItem,
	  ];

  return (
    <DirtyTrackerProvider recordMeta={recordMeta} tracker={dirtyTrackerRef.current}>
		    <div className={`ios-liquid-app flex min-h-screen min-h-[100dvh] font-sans text-slate-900 ${mobileNavLayout ? 'mobile-typography-guard' : ''}`}>
      <div className={`fixed inset-0 bg-black/50 z-30 lg:hidden transition-opacity duration-300 ${isSidebarOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} onClick={() => setSidebarOpen(false)} />
      
      <aside className={`liquid-glass-sidebar group/sidebar fixed inset-y-0 left-0 z-40 flex h-screen w-64 flex-col overflow-hidden transition-[transform,width,box-shadow,background-color] duration-300 ease-out lg:w-24 lg:hover:w-60 lg:hover:shadow-[0_26px_92px_rgba(15,23,42,0.14)] lg:focus-within:w-60 ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
        <div className="z-10 flex h-[4.5rem] items-center justify-start border-b border-white/45 bg-white/10 px-4 lg:h-20 lg:justify-center lg:px-2 lg:group-hover/sidebar:justify-start lg:group-hover/sidebar:px-4 lg:group-focus-within/sidebar:justify-start lg:group-focus-within/sidebar:px-4">
            <div className="flex min-w-0 items-center gap-2">
                <div className="flex min-w-0 flex-col lg:items-center lg:group-hover/sidebar:items-start lg:group-focus-within/sidebar:items-start">
                  <div className="flex items-center gap-1.5">
                      <span className="text-2xl font-bold italic text-blue-700 tracking-tight leading-none drop-shadow-sm transition-all duration-300 lg:text-xl lg:group-hover/sidebar:text-2xl" style={{ fontFamily: 'sans-serif' }}>Kingdee</span>
                      <span className="liquid-glass-subtle overflow-hidden rounded-full px-1.5 py-0.5 text-xs font-bold leading-none text-blue-700 transition-all duration-300 lg:w-0 lg:scale-95 lg:px-0 lg:opacity-0 lg:group-hover/sidebar:w-auto lg:group-hover/sidebar:scale-100 lg:group-hover/sidebar:px-1.5 lg:group-hover/sidebar:opacity-100">V4.0</span>
                  </div>
                  <span className="origin-left overflow-hidden text-xs uppercase tracking-[0.16em] text-slate-500 transition-all duration-300 lg:max-h-0 lg:opacity-0 lg:group-hover/sidebar:max-h-4 lg:group-hover/sidebar:opacity-100">Software Park</span>
                </div>
            </div>
            <button onClick={() => setSidebarOpen(false)} className="absolute right-4 top-5 text-slate-500 lg:hidden"><X size={20}/></button>
        </div>

        <nav className="flex-1 space-y-1.5 overflow-y-auto py-3 scrollbar-hide">
          <SidebarItem icon={<LayoutDashboard size={24} />} label="工作台" isOpen={true} active={activeTab === 'dashboard' && (!mobileNavLayout || mobileDashboardMode === 'overview')} onClick={() => { setActiveTab('dashboard'); setMobileDashboardMode('overview'); if(window.innerWidth < 1024) setSidebarOpen(false); }} />
          {mobileNavLayout ? (
            managerMobileNav ? (
              <>
                <SidebarItem icon={<Users size={24} />} label="合同查询" isOpen={true} active={activeTab === 'contracts'} onClick={goMobileContracts} />
                <SidebarItem icon={<Search size={24} />} label="收款查询" isOpen={true} active={activeTab === 'dashboard' && mobileDashboardMode === 'search'} onClick={goMobileSearch} />
              </>
            ) : (
              <>
                <SidebarItem icon={<Users size={24} />} label="合同录入" isOpen={true} active={activeTab === 'contracts'} onClick={goMobileContracts} />
                <SidebarItem icon={<PieChart size={24} />} label="收款核销" isOpen={true} active={activeTab === 'finance'} onClick={goMobileFinance} />
                <SidebarItem icon={<Search size={24} />} label="快速查询" isOpen={true} active={activeTab === 'dashboard' && mobileDashboardMode === 'search'} onClick={goMobileSearch} />
              </>
            )
          ) : (
            <>
              <SidebarItem icon={<Building2 size={24} />} label="楼宇资管" isOpen={true} active={activeTab === 'buildings'} onClick={() => { setActiveTab('buildings'); if(window.innerWidth < 1024) setSidebarOpen(false); }} />
              <SidebarItem icon={<Users size={24} />} label="客户管理" isOpen={true} active={activeTab === 'contracts'} onClick={() => { setActiveTab('contracts'); if(window.innerWidth < 1024) setSidebarOpen(false); }} />
              <SidebarItem icon={<PieChart size={24} />} label="财务报表" isOpen={true} active={activeTab === 'finance'} onClick={() => { setActiveTab('finance'); if(window.innerWidth < 1024) setSidebarOpen(false); }} />
              <SidebarItem icon={<Calculator size={24} />} label="预算管理" isOpen={true} active={activeTab === 'budget'} onClick={() => { setActiveTab('budget'); if(window.innerWidth < 1024) setSidebarOpen(false); }} />
              <SidebarItem icon={<TableIcon size={24} />} label="初始化数据" isOpen={true} active={activeTab === 'initData'} onClick={() => { setActiveTab('initData'); if(window.innerWidth < 1024) setSidebarOpen(false); }} />
              <div className="mx-4 my-2 h-px bg-white/50" />
              {canAccessSystemSettings && (
                <SidebarItem icon={<Settings size={24} />} label="系统与备份" isOpen={true} active={activeTab === 'settings'} onClick={() => { setActiveTab('settings'); if(window.innerWidth < 1024) setSidebarOpen(false); }} />
              )}
            </>
          )}
        </nav>
      </aside>

      <main className="flex-1 transition-all duration-300 w-full min-w-0 flex flex-col lg:pl-24">
        <header className="sticky top-0 z-30 px-3 py-2 sm:px-4 lg:px-5">
          <div className="liquid-glass-toolbar liquid-mobile-toolbar-shell flex min-h-12 items-center justify-between gap-2 rounded-[24px] px-3 py-2 lg:min-h-14 lg:px-4">
          <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
            <div className="flex min-w-0 items-center gap-2 sm:gap-3">
              <button
                onClick={() => setSidebarOpen(true)}
                className={`liquid-glass-control liquid-pressable -ml-1 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-600 lg:hidden ${mobileNavLayout ? 'hidden' : ''}`}
              >
                <Menu size={20} />
              </button>
              <h1
                className="liquid-mobile-toolbar-title min-w-0 truncate text-base font-black text-slate-950 lg:text-lg"
                aria-label={mobileNavLayout ? mobilePageTitle : pageTitle}
                title={mobileNavLayout ? mobilePageTitle : pageTitle}
              >
                <span className="hidden sm:inline">{pageTitle}</span>
                <span className="sm:hidden">{mobilePageTitle}</span>
              </h1>
              {mobileCanSwitchParks ? (
                <button
                  type="button"
                  onClick={() => setMobileParkPickerOpen((open) => !open)}
                  className="liquid-mobile-top-pill liquid-mobile-park-trigger liquid-pressable inline-flex min-h-8 max-w-[42vw] items-center gap-1.5 rounded-full px-3 text-xs font-black text-blue-700 sm:hidden"
                  aria-label={`当前园区：${currentParkDisplayName}，点击切换园区`}
                  aria-haspopup="dialog"
                  aria-expanded={isMobileParkPickerOpen}
                  title={currentParkDisplayName}
                >
                  <span className="min-w-0 truncate">{currentParkDisplayName}</span>
                  <ChevronDown size={13} className={`shrink-0 transition ${isMobileParkPickerOpen ? 'rotate-180' : ''}`} />
                </button>
              ) : (
                <span
                  className="liquid-mobile-top-pill inline-flex min-h-8 max-w-[42vw] items-center rounded-full px-3 text-xs font-black text-blue-700 sm:hidden"
                  aria-label={`当前园区：${currentParkDisplayName}`}
                  title={currentParkDisplayName}
                >
                  {currentParkDisplayName}
                </span>
              )}
            </div>
            <div
              className="liquid-mobile-context-line min-w-0 truncate rounded-full px-2.5 py-1 text-xs font-black sm:hidden"
              aria-label={`当前移动端上下文：${mobilePageContext}`}
              title={mobilePageContext}
            >
              {mobilePageContext}
            </div>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0 flex-wrap justify-end">
             <button
               type="button"
               onClick={openChangePasswordModal}
               className="liquid-glass-control liquid-pressable hidden md:flex cursor-pointer items-center gap-2 rounded-full px-2.5 py-1.5 text-xs transition hover:bg-white/65 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-200/80"
               title={`${displayUserName}${authUser.email ? ` · ${authUser.email}` : ''} · 点击修改密码`}
             >
                 <User size={14} className="text-slate-500" />
                 <span className="text-slate-600 max-w-[120px] truncate">{displayUserName}</span>
             </button>
             {isGlobalAdmin() && authorizedParks.length > 1 ? (
               <div className="liquid-glass-readable hidden sm:flex items-center gap-1 rounded-full p-1" title="切换授权园区">
                 {authorizedParks.map(park => (
	                   <button
	                     key={park.projectId}
	                     type="button"
	                     onMouseEnter={() => prefetchParkDashboard(park.projectId)}
	                     onFocus={() => prefetchParkDashboard(park.projectId)}
	                     onClick={() => switchProject(park.projectId)}
	                     disabled={isSyncing || park.projectId === cloudConfig.projectId}
                     className={`liquid-pressable rounded-lg px-3 py-1.5 text-xs font-semibold transition-all focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-200/80 ${
                       park.projectId === cloudConfig.projectId
                         ? 'bg-blue-600/90 text-white shadow-sm ring-1 ring-white/55'
                         : 'text-slate-600 hover:bg-white/65 hover:text-blue-700'
                     } disabled:cursor-default`}
                   >
                     {park.name}
                   </button>
                 ))}
               </div>
             ) : (
               <span className="liquid-glass-control hidden sm:inline-flex rounded-full px-2.5 py-1.5 text-xs text-slate-600">
                 {currentParkDisplayName}
               </span>
             )}
             <button
	               type="button"
	               onClick={handleSaveToBackend}
	               disabled={!data || isSyncing || isFullDataPending}
		               className="liquid-glass-control liquid-action liquid-pressable hidden min-h-10 items-center gap-1.5 rounded-full px-3 py-2 text-sm font-semibold transition hover:bg-white/65 disabled:cursor-not-allowed disabled:opacity-50 sm:flex"
		               title={isFullDataPending ? '全量业务数据同步或后台计算完成后才能保存' : lastSaved ? `上次本地缓存 ${lastSaved}` : '保存到 PocketBase'}
	             >
               {isSyncing ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
               <span className="hidden sm:inline">保存</span>
             </button>
             {activeTab === 'dashboard' && (
               <button 
                 onClick={() => setAIDialogOpen(true)}
                 className="liquid-glass-control liquid-action-strong liquid-pressable hidden items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition hover:brightness-[1.03] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-200/80 md:flex"
               >
                 <Sparkles size={16} />
                 <span>AI 智能助手</span>
               </button>
             )}
             <div className={`liquid-glass-control hidden md:flex items-center gap-1 rounded-full px-2.5 py-1 text-xs ${isCloudConnected ? 'text-blue-700' : 'text-slate-500'}`} title={isCloudConnected ? '已连接 PocketBase 后端' : '未连接后端，仅本地缓存'}>
                 {isCloudConnected ? <CheckCircle2 size={12} className="text-sky-500"/> : <Cloud size={12} />}
                 <span>{isCloudConnected ? '后端在线' : '仅本地'}</span>
             </div>
	             <button
	               type="button"
	               onClick={handleLogout}
	               className="liquid-glass-control liquid-pressable inline-flex h-10 w-10 items-center justify-center rounded-full text-slate-500 transition hover:text-rose-500 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-200/80"
               title="退出登录"
             >
               <LogOut size={16} />
             </button>
          </div>
          </div>
        </header>

        {mobileCanSwitchParks && isMobileParkPickerOpen && (
          <div className="fixed inset-0 z-40 px-3 pt-[calc(env(safe-area-inset-top)+4.5rem)] sm:hidden" onClick={() => setMobileParkPickerOpen(false)}>
            <div className="absolute inset-0 bg-slate-950/10 backdrop-blur-[2px]" />
            <section
              className="liquid-mobile-park-picker mobile-card-enter relative mx-auto max-w-[420px] rounded-[26px] p-2"
              role="dialog"
              aria-modal="true"
              aria-label="切换园区"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-3 px-2 pb-2 pt-1">
                <div className="min-w-0">
                  <div className="text-xs font-black text-slate-500">当前工作台园区</div>
                  <div className="truncate text-sm font-black text-slate-950">{currentParkDisplayName}</div>
                </div>
                {isLoadingMobileParkKpis && (
                  <span className="liquid-mobile-chip-blue shrink-0 rounded-full px-2 py-1 text-xs font-black">同步中</span>
                )}
              </div>
              <div className="grid gap-1.5">
                {mobileAuthorizedParks.map((park) => {
                  const selected = park.projectId === cloudConfig.projectId;
                  return (
                    <button
                      key={park.projectId}
                      type="button"
                      onMouseEnter={() => prefetchParkDashboard(park.projectId)}
                      onFocus={() => prefetchParkDashboard(park.projectId)}
                      onClick={() => handleMobileTopParkSelect(park.projectId)}
                      disabled={isSyncing && !selected}
                      aria-current={selected ? 'true' : undefined}
                      className={`liquid-mobile-park-option mobile-pressable flex min-h-12 items-center justify-between gap-3 rounded-[18px] px-3 py-2 text-left transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-200/80 ${
                        selected ? 'liquid-mobile-park-option-active' : ''
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-black text-slate-950">{park.name}</span>
                        <span className="mt-0.5 block truncate text-xs font-semibold text-slate-500">{park.projectId}</span>
                      </span>
                      {selected ? (
                        <CheckCircle2 size={18} className="shrink-0 text-blue-600" />
                      ) : (
                        <ChevronRight size={16} className="shrink-0 text-slate-400" />
                      )}
                    </button>
                  );
                })}
              </div>
            </section>
          </div>
        )}

        <div className="mx-auto w-full max-w-[1500px] min-w-0 px-3 pb-20 pt-3 md:px-6 md:pb-24 md:pt-6 lg:p-6">
          {isFullDataPending && (
            <div className="liquid-alert mb-4 rounded-[18px] px-4 py-3 text-sm text-amber-800">
	              当前展示的是后台快照或缓存预览，系统正在同步或等待后台计算全量业务数据；完成前仅支持查看工作台指标，暂不保存或编辑明细。
            </div>
	          )}
	          {isFullDataPending && activeTab !== 'dashboard' && (
	            <div className="rounded-xl border border-slate-100 bg-white p-10 text-center shadow-sm">
	              <Loader2 size={28} className="mx-auto mb-3 animate-spin text-sky-500" />
	              <div className="font-semibold text-slate-700">正在同步全量业务数据</div>
	              <div className="mt-1 text-sm text-slate-500">合同、收款、楼宇和预算明细同步完成后即可进入该模块。</div>
	            </div>
	          )}
	          {activeTab === 'dashboard' && (
	            <div className="space-y-4 md:space-y-6">
	              {mobileNavLayout && (
	                <MobileDashboardFocus
	                  data={data}
	                  selectedYear={selectedYear}
	                  projectId={cloudConfig.projectId}
	                  parkName={currentParkDisplayName}
	                  isCloudConnected={isCloudConnected}
	                  isSyncing={isSyncing}
	                  lastSaved={lastSaved}
	                  mode={mobileDashboardMode}
		                  isManagerView={isManagerMobileView}
		                  isGlobalAdminView={isGlobalAdmin()}
		                  authUser={authUser}
		                  managerKpi={mobileSelectedManagerKpi}
		                  isLoadingManagerKpis={isLoadingMobileParkKpis}
			                  searchQuery={mobileSearchQuery}
			                  searchFilter={mobileSearchFilter}
			                  searchBuildingFilter={mobileSearchBuildingFilter}
			                  searchExpiryMonthFilter={mobileSearchExpiryMonthFilter}
				                  searchPaymentFilter={mobileSearchPaymentFilter}
				                  searchReceivableFilter={mobileSearchReceivableFilter}
				                  searchArrearsFilter={mobileSearchArrearsFilter}
				                  searchArrearsAvailable={mobileSearchHistoricalArrears.available}
				                  searchArrearsUnavailableReason={mobileSearchHistoricalArrears.unavailableReason}
				                  searchAdvancedActiveCount={mobileSearchAdvancedActiveCount}
			                  searchBuildingOptions={mobileSearchBuildingOptions}
			                  searchExpiryMonthOptions={mobileSearchExpiryMonthOptions}
			                  searchResultCount={mobileSearchResultCount}
			                  searchResults={mobileSearchResults}
			                  canCollapseSearchResults={canCollapseMobileSearchResults}
			                  onLoadMoreSearchResults={loadMoreMobileSearchResults}
			                  onCollapseSearchResults={collapseMobileSearchResults}
			                  onSearchQueryChange={setMobileSearchQuery}
			                  onSearchFilterChange={setMobileSearchFilter}
			                  onSearchBuildingFilterChange={setMobileSearchBuildingFilter}
			                  onSearchExpiryMonthFilterChange={setMobileSearchExpiryMonthFilter}
				                  onSearchPaymentFilterChange={setMobileSearchPaymentFilter}
				                  onSearchReceivableFilterChange={setMobileSearchReceivableFilter}
				                  onSearchArrearsFilterChange={setMobileSearchArrearsFilter}
			                  onClearSearchFilters={clearMobileSearchFilters}
		                  onYearChange={handleYearChange}
	                  onGoContracts={goMobileContracts}
	                  onGoFinance={goMobileFinance}
	                  onGoSearch={goMobileSearch}
	                  onBackToOverview={goMobileOverview}
	                />
	              )}
	              {shouldRenderDesktopDashboard && (
	                <div className="hidden lg:block">
	                  <FocusDashboard
	                    data={data}
	                    selectedYear={selectedYear}
	                    projectId={cloudConfig.projectId}
		                    parkName={currentParkDisplayName}
		                    authUser={authUser}
		                    isCloudConnected={isCloudConnected}
		                    isSyncing={isSyncing}
		                    onYearChange={handleYearChange}
		                  />
	                </div>
	              )}
	            </div>
	          )}

	          {!isFullDataPending && activeTab === 'buildings' && (
            <Suspense fallback={<LazyPanelFallback />}>
              <div className="animate-in fade-in zoom-in-50 duration-300"><BuildingManager buildings={data.buildings} tenants={data.tenants} parkAreaMetrics={parkAreaMetricsFromDashboard(data)} onUpdateBuildings={updateBuildings} onCommitBuildingsTenants={commitBuildingsTenants} /></div>
            </Suspense>
          )}
	          {!isFullDataPending && activeTab === 'contracts' && (
            <Suspense fallback={<LazyPanelFallback />}>
	              <div className="animate-in fade-in zoom-in-50 duration-300"><ContractManager tenants={data.tenants} buildings={data.buildings} onUpdateTenants={updateTenants} dashboardData={data} payments={data.payments} onUpdatePayments={updatePayments} budgetAdjustments={data.budgetAdjustments} onUpdateAdjustments={updateBudgetAdjustments} mobileEntryMode={mobileNavLayout} mobileQueryOnly={managerMobileNav} authUser={authUser} projectId={cloudConfig.projectId} cloudConfig={cloudConfig} serverComputeEnabled={serverComputeEnabled} mobileFocusTenantId={mobileContractFocus?.tenantId} mobileFocusTenantName={mobileContractFocus?.tenantName} mobileFocusRequestId={mobileContractFocus?.requestId} /></div>
            </Suspense>
          )}
	          {!isFullDataPending && activeTab === 'finance' && (
            <Suspense fallback={<LazyPanelFallback />}>
              <div className="animate-in fade-in zoom-in-50 duration-300">
                  <FinanceManager
                      payments={data.payments}
                      tenants={data.tenants}
                      invoices={data.invoices || []}
                      billingPeriodNotes={data.billingPeriodNotes || {}}
                      onUpdatePayments={updatePayments}
                      onUpdateTenants={updateTenants}
                      onUpdateInvoices={updateInvoices}
                      onBatchUpdate={handleBatchUpdate}
		                      getBillingDetails={getFinanceBillingDetails}
	                      serverBillingDetails={financeServerBillingDetails}
	                      serverBillingRequired={financeServerBillingRequired}
	                      onReceivableMonthChange={setFinanceReceivableMonth}
                      onDeferPayment={handleDeferPayment}
                      onRevokeDeferBillingNote={handleRevokeDeferBillingNote}
                      onResetReceivableApplications={handleResetReceivableApplications}
                      onUpdateRentRemark={updateRentCollectionRemark}
                      buildings={data.buildings}
                      budgetAssumptions={data.budgetAssumptions}
                      budgetAdjustments={data.budgetAdjustments}
                      mobileReceivableOnly={mobileNavLayout}
                      authUser={authUser}
                      projectId={cloudConfig.projectId}
                      cloudConfig={cloudConfig}
	                      serverComputeEnabled={serverComputeEnabled}
                      mobileFocusTenantId={mobileFinanceFocus?.tenantId}
                      mobileFocusTenantName={mobileFinanceFocus?.tenantName}
                      mobileFocusRequestId={mobileFinanceFocus?.requestId}
                  />
              </div>
            </Suspense>
          )}
	          {!isFullDataPending && activeTab === 'budget' && (
            <Suspense fallback={<LazyPanelFallback />}>
	              <div className="animate-in fade-in zoom-in-50 duration-300"><BudgetManager buildings={data.buildings} tenants={data.tenants} budgetAssumptions={data.budgetAssumptions} onUpdateAssumptions={updateBudgetAssumptions} budgetAdjustments={data.budgetAdjustments} onUpdateAdjustments={updateBudgetAdjustments} budgetAnalysis={data.budgetAnalysis} onUpdateAnalysis={updateBudgetAnalysis} payments={data.payments} scenarios={data.budgetScenarios || []} onUpdateScenarios={updateBudgetScenarios} onRenameScenario={handleRenameScenario} onActivateScenario={handleActivateScenario} onSaveBudgetToCloud={handleSaveBudgetToCloud} initializationData={data.initializationData} billingPeriodNotes={data.billingPeriodNotes} onBatchUpdate={handleBatchUpdate} cloudConfig={cloudConfig} serverComputeEnabled={serverComputeEnabled} /></div>
            </Suspense>
          )}
	          {!isFullDataPending && activeTab === 'initData' && (
            <div className="animate-in fade-in zoom-in-50 duration-300 mx-auto max-w-3xl space-y-4">
                <div className="liquid-init-shell overflow-hidden rounded-[28px]">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/70 p-4 md:p-6">
                        <div className="flex items-center gap-3">
                            <span className="liquid-icon-well flex h-10 w-10 items-center justify-center rounded-2xl text-blue-700">
                                <TableIcon size={20} />
                            </span>
                            <div>
                                <h2 className="text-lg md:text-xl font-black text-slate-950">初始化数据</h2>
                                <p className="text-xs font-semibold text-slate-500">年度 KPI 分母、历史实收与出租率口径维护</p>
                            </div>
                        </div>
                        <span className="liquid-glass-control rounded-full px-3 py-1.5 text-xs font-bold text-blue-700">字段口径保护</span>
                    </div>
                    <div className="p-4 md:p-6">
                        <div className="liquid-glass-readable rounded-[24px] p-4 md:p-5">
                            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                                <div className="min-w-0 flex-1">
                                    <div className="mb-2 flex items-center gap-2">
                                        <span className="liquid-icon-well flex h-8 w-8 items-center justify-center rounded-xl text-blue-700">
                                            <FileInput size={16} />
                                        </span>
                                        <h3 className="font-black text-slate-900">系统初始化数据 (2023-2026)</h3>
                                    </div>
                                    <p className="text-sm leading-relaxed text-slate-600">
                                        手动录入历史年初预算、实收及出租率数据，用于看板展示；当某月「年初预算」大于 0 时，首页「预算执行」该月预算收款优先取此值，为 0 时回退到预算表/生效方案。2025 年 12 月支持录入累计欠款。
                                    </p>
                                    <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold">
                                        <span className="rounded-full bg-blue-50 px-2.5 py-1 text-blue-700">年初预算优先</span>
                                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600">历史实收回填</span>
                                        <span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-700">2025 累计欠款</span>
                                    </div>
                                </div>
                                <button onClick={openInitDataModal} className="liquid-action-strong liquid-pressable flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-black">
                                    <FileInput size={16} /> 录入/编辑
                                </button>
                            </div>
                        </div>
                    </div>
                    <div className="px-4 pb-4 md:px-6 md:pb-6">
                        <Suspense fallback={<LazyPanelFallback />}>
                            <TenantBudgetNameLinkTool
                                tenants={data.tenants}
                                billingPeriodNotes={data.billingPeriodNotes}
                                onBatchUpdate={handleBatchUpdate}
                            />
                        </Suspense>
                    </div>
                </div>
            </div>
          )}
	          {!isFullDataPending && activeTab === 'settings' && (
            <Suspense fallback={<LazyPanelFallback />}>
              <SystemSettingsPanel
                  isCloudConnected={isCloudConnected}
                  cloudConfig={cloudConfig}
                  onCloudConfigChange={setCloudConfig}
                  onPersistCloudConfig={persistCloudConfig}
                  pocketbaseUrl={cloudConfig.pocketbaseUrl || DEFAULT_CLOUD_CONFIG.pocketbaseUrl || '/api/pb'}
                  currentParkName={
                      authorizedParks.find((park) => park.projectId === cloudConfig.projectId)?.name ||
                      cloudConfig.projectId
                  }
                  authorizedParks={authorizedParks}
                  isPlatformAdmin={isPlatformAdmin()}
                  canManageUsers={canAccessSystemSettings}
                  cloudConnectionMsg={cloudConnectionMsg}
                  newUserForm={newUserForm}
                  onNewUserFormChange={(patch) => setNewUserForm((prev) => ({ ...prev, ...patch }))}
                  onCreateManagedUser={handleCreateManagedUser}
                  isCreatingUser={isCreatingUser}
                  onRefreshUsers={() => void Promise.all([loadManagedUsers(), loadSignupRequests()])}
                  managedUsers={managedUsers}
                  managedUsersError={managedUsersError}
                  isLoadingManagedUsers={isLoadingManagedUsers}
                  onApproveManagedUser={(u, enabled) => void handleApproveManagedUser(u, enabled)}
                  onOpenUserManage={openUserManageModal}
                  onDeleteManagedUser={(u) => {
                      void (async () => {
                          const confirmed = await showGlassConfirm({
                              title: '删除登录账号',
                              message: `确定删除登录账号「${u.email}」？\n\n该账号将无法登录，关联申请记录也会一并清理。`,
                              tone: 'rose',
                              confirmText: '确认删除',
                              cancelText: '取消',
                          });
                          if (!confirmed) return;
                          const res = await deleteManagedCloudUser(u.id, authUser?.id);
                          if (!res.success) {
                              showGlassNotice({
                                  title: '删除失败',
                                  message: res.message || '删除失败',
                                  tone: 'rose',
                              });
                              return;
                          }
                          await Promise.all([loadManagedUsers(), loadSignupRequests()]);
                          showGlassNotice({
                              title: '账号已删除',
                              message: res.message || '已删除账号。',
                              tone: 'blue',
                          });
                      })();
                  }}
                  signupRequests={signupRequests}
                  signupRequestsError={signupRequestsError}
                  isLoadingSignupRequests={isLoadingSignupRequests}
                  onApproveSignupRequest={(req) => void handleApproveSignupRequest(req)}
                  onRejectSignupRequest={(req) => void handleRejectSignupRequest(req)}
                  onDeleteSignupRequest={(req) => void handleDeleteSignupRequest(req)}
                  approvedSignupByPark={approvedSignupByPark}
                  userManageTarget={userManageTarget}
                  userManageForm={userManageForm}
                  onUserManageFormChange={(patch) => setUserManageForm((prev) => ({ ...prev, ...patch }))}
                  onCloseUserManage={() => setUserManageTarget(null)}
                  onSaveUserManage={() => void handleSaveUserManageModal()}
                  onDeleteUserManage={() => void handleDeleteUserManageModal()}
                  userManageSaving={userManageSaving}
                  aiConfig={aiConfig}
                  onAiConfigChange={setAiConfig}
                  onSaveAiConfig={() => {
                      sessionStorage.setItem('ai_config', JSON.stringify(aiConfig));
                      showGlassNotice({
                          title: 'AI 配置已保存',
                          message: '请刷新页面使配置生效。',
                          tone: 'blue',
                      });
                  }}
                  cloudHistory={cloudHistory}
                  isLoadingHistory={isLoadingHistory}
                  onRefreshHistory={() => fetchCloudHistory()}
                  onOpenSnapshot={openSnapshotModal}
                  onRestoreBackup={(id) => handleRestoreCloudBackup(id)}
                  onDownloadBackup={(id, note) => handleDownloadCloudBackup(id, note)}
                  restoringId={restoringId}
                  onExport={handleExport}
                  onImport={handleImport}
                  onResetData={handleResetData}
              />
            </Suspense>
          )}

        </div>
      </main>

		      {mobileNavLayout && (
		        <MobileNavigation
		          bottomItems={mobileBottomNavItems}
		          moreItems={mobileMoreItems}
		          isMoreOpen={isMobileMoreOpen}
		          parkName={currentParkDisplayName}
		          selectedYear={selectedYear}
		          onCloseMore={() => setMobileMoreOpen(false)}
		        />
		      )}

	      {isAssistantOpen && (
	        <Suspense fallback={null}>
	          <AssistantPanel isOpen={isAssistantOpen} onClose={() => setAssistantOpen(false)} data={data} />
	        </Suspense>
	      )}
      {isAIDialogOpen && (
        <Suspense fallback={null}>
          <AIAssistantDialog
            isOpen={isAIDialogOpen}
            onClose={() => setAIDialogOpen(false)}
            dashboardData={data}
            aiConfig={aiConfig}
          />
        </Suspense>
      )}

      {isChangePasswordOpen && authUser && (
          <div className="monthly-detail-backdrop fixed inset-0 z-[80] flex items-center justify-center p-4">
              <form
                  onSubmit={(e) => void handleChangePasswordSubmit(e)}
                  className="liquid-elevated-card w-full max-w-md overflow-hidden rounded-[28px]"
              >
                  <div className="liquid-elevated-header flex items-start justify-between gap-2 border-b border-white/60 px-5 py-4">
                      <div>
                          <h4 className="text-sm font-black text-slate-950">修改密码</h4>
                          <p className="mt-0.5 text-xs font-semibold text-slate-500">
                              {displayUserName}
                              {authUser.email ? ` · ${authUser.email}` : ''}
                          </p>
                      </div>
                      <button
                          type="button"
                          aria-label="关闭"
                          className="liquid-glass-control liquid-pressable rounded-full p-2 text-slate-500 hover:bg-white/75 hover:text-slate-950"
                          onClick={closeChangePasswordModal}
                          disabled={changePasswordSaving}
                      >
                          <X size={18} />
                      </button>
                  </div>
                  <div className="space-y-3 px-5 py-4">
                      <div>
                          <label className="mb-1.5 block text-xs font-black text-slate-500">当前密码</label>
                          <input
                              type="password"
                              className="liquid-elevated-field w-full rounded-2xl px-3.5 py-3 text-sm font-semibold text-slate-900 outline-none focus-visible:ring-4 focus-visible:ring-blue-500/10"
                              value={changePasswordForm.oldPassword}
                              onChange={(e) => setChangePasswordForm((prev) => ({ ...prev, oldPassword: e.target.value }))}
                              autoComplete="current-password"
                              disabled={changePasswordSaving}
                          />
                      </div>
                      <div>
                          <label className="mb-1.5 block text-xs font-black text-slate-500">新密码</label>
                          <input
                              type="password"
                              className="liquid-elevated-field w-full rounded-2xl px-3.5 py-3 text-sm font-semibold text-slate-900 outline-none focus-visible:ring-4 focus-visible:ring-blue-500/10"
                              value={changePasswordForm.newPassword}
                              onChange={(e) => setChangePasswordForm((prev) => ({ ...prev, newPassword: e.target.value }))}
                              placeholder="至少 8 位"
                              autoComplete="new-password"
                              disabled={changePasswordSaving}
                          />
                      </div>
                      <div>
                          <label className="mb-1.5 block text-xs font-black text-slate-500">确认新密码</label>
                          <input
                              type="password"
                              className="liquid-elevated-field w-full rounded-2xl px-3.5 py-3 text-sm font-semibold text-slate-900 outline-none focus-visible:ring-4 focus-visible:ring-blue-500/10"
                              value={changePasswordForm.confirmPassword}
                              onChange={(e) => setChangePasswordForm((prev) => ({ ...prev, confirmPassword: e.target.value }))}
                              autoComplete="new-password"
                              disabled={changePasswordSaving}
                          />
                      </div>
                      {changePasswordError && (
                          <div className="liquid-glass-readable rounded-2xl border border-rose-200/80 px-3 py-2 text-xs font-semibold text-rose-700">
                              {changePasswordError}
                          </div>
                      )}
                  </div>
                  <div className="liquid-elevated-footer flex justify-end gap-2 border-t border-white/60 px-5 py-4">
                      <button
                          type="button"
                          onClick={closeChangePasswordModal}
                          disabled={changePasswordSaving}
                          className="liquid-glass-control liquid-pressable rounded-2xl px-4 py-2.5 text-sm font-bold text-slate-600 hover:bg-white/75 disabled:opacity-50"
                      >
                          取消
                      </button>
                      <button
                          type="submit"
                          disabled={changePasswordSaving}
                          className="liquid-action-strong liquid-pressable rounded-2xl px-5 py-2.5 text-sm font-black text-white disabled:opacity-50"
                      >
                          {changePasswordSaving ? '保存中…' : '保存'}
                      </button>
                  </div>
              </form>
          </div>
      )}
      
      {isTargetModalOpen && data && (
          <div className="monthly-detail-backdrop fixed inset-0 z-50 flex items-center justify-center p-4">
              <div className="liquid-elevated-card w-full max-w-sm overflow-hidden rounded-[28px] animate-in zoom-in-50 duration-200">
                  <div className="liquid-elevated-header border-b border-white/60 px-5 py-4">
                      <h3 className="text-lg font-black text-slate-950">设定 {selectedYear}年度 {targetModalType === 'revenue' ? '营收' : '出租率'}目标</h3>
                  </div>
                  <div className="space-y-4 px-5 py-4">
                      {targetModalType === 'revenue' ? (
                          <p className="liquid-glass-readable rounded-2xl px-4 py-3 text-sm font-semibold leading-relaxed text-slate-600">年度营收目标已停用，请在「初始化数据」维护各月年初目标；看板「营收达成」将自动按初始化数据合计。</p>
                      ) : (
                          <div><label className="mb-1.5 block text-xs font-black text-slate-500">年度出租率目标 (%)</label><input type="number" inputMode="decimal" enterKeyHint="done" className="liquid-elevated-field w-full rounded-2xl px-3.5 py-3 text-lg font-black text-slate-950 outline-none focus-visible:ring-4 focus-visible:ring-blue-500/10" value={targetForm.occupancy} onChange={e => setTargetForm({...targetForm, occupancy: Number(e.target.value)})} /></div>
                      )}
                      <div className="space-y-1">
                        <label className="block text-xs font-black text-slate-500">年初目标</label>
                        <div className="liquid-glass-readable w-full rounded-2xl px-3.5 py-3 text-lg font-black text-slate-950">
                          {formatCurrency(
                              resolveAnnualInitialBudget(
                                  data.yearlyTargets,
                                  data.initializationData,
                                  selectedYear,
                                  data.tenants?.[0]?.projectId || cloudConfig.projectId
                              )
                          )}
                        </div>
                        <p className="text-xs font-semibold leading-relaxed text-slate-500">
                          自动汇总「初始化数据」中 {selectedYear} 年各月年初预算，不可在此修改。请前往「初始化数据」维护。
                        </p>
                      </div>
                  </div>
                  <div className="liquid-elevated-footer flex justify-end gap-2 border-t border-white/60 px-5 py-4"><button onClick={() => setIsTargetModalOpen(false)} className="liquid-glass-control liquid-pressable rounded-2xl px-4 py-2.5 text-sm font-bold text-slate-600 hover:bg-white/75">取消</button><button onClick={saveTargets} className="liquid-action-strong liquid-pressable rounded-2xl px-5 py-2.5 text-sm font-black text-white">保存</button></div>
              </div>
          </div>
      )}

      {isSnapshotModalOpen && (
          <div className="monthly-detail-backdrop fixed inset-0 z-50 flex items-center justify-center p-4">
              <div className="liquid-elevated-card w-full max-w-sm overflow-hidden rounded-[28px] animate-in zoom-in-50 duration-200">
                  <div className="liquid-elevated-header flex items-center justify-between gap-3 border-b border-white/60 px-5 py-4"><h3 className="text-lg font-black text-slate-950">保存到云端</h3><button onClick={() => setIsSnapshotModalOpen(false)} className="liquid-glass-control liquid-pressable rounded-full p-2 text-slate-500 hover:bg-white/75 hover:text-slate-950"><X size={20}/></button></div>
                  <div className="space-y-4 px-5 py-4">
                      <div><label className="mb-1.5 block text-xs font-black text-slate-500">操作人员 (必填) <span className="text-rose-500">*</span></label><div className="relative"><User size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500"/><input type="text" className="liquid-elevated-field w-full rounded-2xl py-3 pl-9 pr-3.5 text-sm font-semibold text-slate-900 outline-none placeholder:text-slate-500 focus-visible:ring-4 focus-visible:ring-blue-500/10" placeholder="请输入您的姓名" value={operatorName} onChange={e => setOperatorName(e.target.value)}/></div></div>
                      <div><label className="mb-1.5 block text-xs font-black text-slate-500">备份备注 (选填)</label><input type="text" className="liquid-elevated-field w-full rounded-2xl px-3.5 py-3 text-sm font-semibold text-slate-900 outline-none placeholder:text-slate-500 focus-visible:ring-4 focus-visible:ring-blue-500/10" placeholder="例如: 10月份月结后备份" value={snapshotNote} onChange={e => setSnapshotNote(e.target.value)}/></div>
                      <div className="liquid-glass-readable flex items-start gap-2 rounded-2xl px-3.5 py-3 text-xs font-semibold leading-relaxed text-blue-700"><Info size={14} className="mt-0.5 flex-shrink-0" /><p>保存后，系统将生成带时间戳的历史版本，您可以在“系统与备份”中随时查看或恢复。</p></div>
                  </div>
                  <div className="liquid-elevated-footer flex justify-end gap-2 border-t border-white/60 px-5 py-4"><button onClick={() => setIsSnapshotModalOpen(false)} className="liquid-glass-control liquid-pressable rounded-2xl px-4 py-2.5 text-sm font-bold text-slate-600 hover:bg-white/75">取消</button><button onClick={confirmCloudSave} disabled={!operatorName.trim() || isSyncing || isFullDataPending} className="liquid-action-strong liquid-pressable flex items-center gap-1 rounded-2xl px-5 py-2.5 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-50">{isSyncing ? <Loader2 size={14} className="animate-spin" /> : <CloudUpload size={14} />} 确认保存</button></div>
              </div>
          </div>
      )}

      {/* Auto Restore Prompt Modal */}
      {showRestorePrompt && latestBackup && (
          <div className="monthly-detail-backdrop fixed inset-0 z-[100] flex items-center justify-center p-4 animate-in fade-in duration-300">
              <div className="liquid-elevated-card relative w-full max-w-md overflow-hidden rounded-[28px]">
                  <div className="absolute left-0 top-0 h-1 w-full bg-gradient-to-r from-blue-500 to-cyan-500"></div>
                  <div className="liquid-elevated-header flex items-start justify-between gap-3 border-b border-white/60 px-5 py-4">
                      <div className="flex items-center gap-3">
                          <div className="liquid-icon-well flex h-11 w-11 items-center justify-center rounded-2xl text-blue-700">
                              <CloudUpload size={24} />
                          </div>
                          <div>
                              <h3 className="text-lg font-black text-slate-950">发现云端备份</h3>
                              <p className="text-xs font-semibold text-slate-500">检测到可用的云端数据存档</p>
                          </div>
                      </div>
                      <button onClick={() => setShowRestorePrompt(false)} className="liquid-glass-control liquid-pressable rounded-full p-2 text-slate-500 transition hover:bg-white/75 hover:text-slate-950">
                          <X size={20} />
                      </button>
                  </div>
                  
                  <div className="px-5 py-4">
                  <div className="liquid-glass-readable mb-4 rounded-2xl p-4">
                      <div className="flex justify-between items-center mb-2">
                          <span className="text-xs font-black uppercase tracking-wider text-slate-500">最新备份信息</span>
                          <span className="rounded-full border border-blue-100 bg-blue-50 px-2 py-0.5 text-xs font-black text-blue-700">Latest</span>
                      </div>
                      <div className="mb-1 text-sm font-black text-slate-900">{latestBackup.note || '无备注信息'}</div>
                      <div className="flex items-center gap-1 text-xs font-semibold text-slate-500">
                          <FileClock size={12} />
                          {new Date(latestBackup.created_at).toLocaleString()}
                      </div>
                  </div>

                  <p className="mb-2 text-sm font-semibold leading-relaxed text-slate-600">
                      是否立即将此备份恢复到当前系统？<br/>
                      <span className="text-xs font-black text-amber-600">注意：这将覆盖当前本地的所有临时修改。</span>
                  </p>
                  </div>

                  <div className="liquid-elevated-footer flex gap-3 border-t border-white/60 px-5 py-4">
                      <button 
                          onClick={() => setShowRestorePrompt(false)} 
                          className="liquid-glass-control liquid-pressable flex-1 rounded-2xl py-2.5 text-sm font-bold text-slate-700 transition hover:bg-white/75"
                      >
                          暂不恢复
                      </button>
                      <button 
                          onClick={handleConfirmRestoreLatest} 
                          disabled={isSyncing}
                          className="liquid-action-strong liquid-pressable flex flex-1 items-center justify-center gap-2 rounded-2xl py-2.5 text-sm font-black text-white disabled:opacity-50"
                      >
                          {isSyncing ? <Loader2 size={16} className="animate-spin" /> : <RotateCcw size={16} />}
                          确认同步恢复
                      </button>
                  </div>
              </div>
          </div>
      )}

      {/* Init Data Modal */}
      {isInitDataModalOpen && (
          <div className="monthly-detail-backdrop fixed inset-0 z-50 flex items-end justify-center p-2 sm:p-3 md:items-center md:p-4">
              <div className="liquid-init-dialog flex max-h-[92vh] w-full max-w-5xl flex-col rounded-[26px] animate-in zoom-in-50 duration-200 md:max-h-[90vh] md:rounded-[28px]">
                  <div className="flex flex-col gap-4 border-b border-white/70 px-4 py-4 md:flex-row md:items-start md:justify-between md:px-6">
                      <div className="min-w-0 flex-1">
                          <div className="mb-3 flex items-center gap-3">
                              <span className="liquid-icon-well flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl text-blue-700">
                                  <TableIcon size={20} />
                              </span>
                              <div>
                                  <h3 className="text-xl font-black text-slate-950">系统数据初始化录入</h3>
                                  <p className="text-xs font-semibold text-slate-500">字段写入后会参与工作台、预算执行和财务口径展示</p>
                              </div>
                          </div>
                          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                              <div className="liquid-init-year-segment grid grid-cols-4 gap-1 rounded-[20px] p-1 sm:flex sm:rounded-full">
                                  {[2023, 2024, 2025, 2026].map((year) => (
                                      <button key={year} onClick={() => handleInitYearChange(year)} className={`liquid-pressable min-h-[36px] rounded-full px-3 py-1.5 text-sm font-black transition-all ${initDataYear === year ? 'bg-slate-900 text-white shadow' : 'text-slate-600 hover:bg-white/60'}`}>{year}年</button>
                                  ))}
                              </div>
                              <button
                                  onClick={handleImportInitialBudgetFromActiveScenario}
                                  disabled={isImportingInitialBudget}
                                  className="liquid-glass-control liquid-pressable inline-flex min-h-[38px] items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-black text-amber-700 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                  {isImportingInitialBudget && <Loader2 size={12} className="animate-spin" />}
                                  {isImportingInitialBudget ? '后台计算中...' : '从生效预算方案导入年初预算'}
                              </button>
                          </div>
                      </div>
                      <button onClick={() => setIsInitDataModalOpen(false)} className="liquid-glass-control liquid-pressable rounded-full p-2 text-slate-500 hover:text-slate-800" aria-label="关闭初始化数据录入">
                          <X size={20}/>
                      </button>
                  </div>

                  <div className="flex-1 overflow-auto px-4 py-4 md:px-6">
                      <div className="space-y-3 md:hidden">
                          {tempInitData.map((row) => (
                              <article key={row.month} className="liquid-init-mobile-card rounded-[22px] p-4">
                                  <div className="mb-3 flex items-center justify-between gap-3">
                                      <div>
                                          <div className="text-lg font-black tabular-nums text-slate-950">{row.month}月</div>
                                          <div className="text-xs font-semibold text-slate-500">
                                              {initDataYear} 年初始化口径
                                          </div>
                                      </div>
                                      {initDataYear === 2025 && row.month === 12 ? (
                                          <span className="rounded-full border border-amber-200/80 bg-amber-50/80 px-2.5 py-1 text-xs font-black text-amber-700">
                                              欠款口径
                                          </span>
                                      ) : null}
                                  </div>
                                  <div className="grid gap-3">
                                      <label className="block">
                                          <span className="mb-1.5 block text-xs font-black text-blue-700">年初预算 (￥)</span>
                                          <div className="relative">
                                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-blue-500">￥</span>
                                              <input
                                                  type="number"
                                                  inputMode="decimal"
                                                  enterKeyHint="done"
                                                  className="liquid-init-field w-full rounded-2xl py-2.5 pl-7 pr-3 text-base font-black tabular-nums text-slate-950 outline-none focus-visible:ring-4 focus-visible:ring-blue-200/80"
                                                  value={row.initialBudget || ''}
                                                  onChange={(e) => updateTempInitData(row.month, 'initialBudget', Number(e.target.value))}
                                                  placeholder="0.00"
                                              />
                                          </div>
                                      </label>
                                      <label className="block">
                                          <span className="mb-1.5 block text-xs font-black text-slate-500">月度实收 (￥)</span>
                                          <div className="relative">
                                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-500">￥</span>
                                              <input
                                                  type="number"
                                                  inputMode="decimal"
                                                  enterKeyHint="done"
                                                  className="liquid-init-field w-full rounded-2xl py-2.5 pl-7 pr-3 text-base font-black tabular-nums text-slate-950 outline-none focus-visible:ring-4 focus-visible:ring-blue-200/80"
                                                  value={row.revenueCollected || ''}
                                                  onChange={(e) => updateTempInitData(row.month, 'revenueCollected', Number(e.target.value))}
                                                  placeholder="0.00"
                                              />
                                          </div>
                                      </label>
                                      <label className="block">
                                          <span className="mb-1.5 block text-xs font-black text-slate-500">月末出租率 (%)</span>
                                          <div className="relative">
                                              <input
                                                  type="number"
                                                  inputMode="decimal"
                                                  enterKeyHint="done"
                                                  className="liquid-init-field w-full rounded-2xl py-2.5 pl-3 pr-8 text-base font-black tabular-nums text-slate-950 outline-none focus-visible:ring-4 focus-visible:ring-blue-200/80"
                                                  value={row.occupancyRate || ''}
                                                  onChange={(e) => updateTempInitData(row.month, 'occupancyRate', Number(e.target.value))}
                                                  placeholder="0.0"
                                                  step="0.1"
                                                  max="100"
                                              />
                                              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-500">%</span>
                                          </div>
                                      </label>
                                      {initDataYear === 2025 && (
                                          <label className="block">
                                              <span className="mb-1.5 block text-xs font-black text-amber-700">累计欠款 (￥)</span>
                                              <div className="relative">
                                                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-amber-600">￥</span>
                                                  <input
                                                      type="number"
                                                      inputMode="decimal"
                                                      enterKeyHint="done"
                                                      className="liquid-init-field w-full rounded-2xl py-2.5 pl-7 pr-3 text-base font-black tabular-nums text-slate-950 outline-none focus-visible:ring-4 focus-visible:ring-amber-200/80 disabled:text-slate-400"
                                                      value={row.accumulatedArrears || ''}
                                                      onChange={(e) => updateTempInitData(row.month, 'accumulatedArrears', Number(e.target.value))}
                                                      placeholder="仅 12 月填写"
                                                      disabled={row.month !== 12}
                                                  />
                                              </div>
                                              {row.month === 12 ? (
                                                  <span className="mt-1.5 block text-xs font-bold text-amber-700">2025 年及之前累计欠款</span>
                                              ) : null}
                                          </label>
                                      )}
                                  </div>
                              </article>
                          ))}
                      </div>

                      <div className="liquid-init-table hidden min-w-[760px] overflow-hidden rounded-[22px] border border-white/70 md:block">
                          <table className="w-full text-left text-sm">
                              <thead className="text-xs font-black text-slate-600">
                                  <tr>
                                      <th className="liquid-init-sticky sticky top-0 z-10 w-24 border-b border-slate-200/80 p-4">月份</th>
                                      <th className="liquid-init-sticky sticky top-0 z-10 min-w-[180px] border-b border-slate-200/80 p-4 text-blue-700">年初预算 (￥)</th>
                                      <th className="liquid-init-sticky sticky top-0 z-10 min-w-[180px] border-b border-slate-200/80 p-4">月度实收</th>
                                      <th className="liquid-init-sticky sticky top-0 z-10 min-w-[160px] border-b border-slate-200/80 p-4">月末出租率 (%)</th>
                                      {initDataYear === 2025 && (
                                          <th className="liquid-init-sticky sticky top-0 z-10 min-w-[190px] border-b border-slate-200/80 p-4 text-amber-700">累计欠款 (￥)</th>
                                      )}
                                  </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100/90">
                                  {tempInitData.map((row) => (
                                      <tr key={row.month} className="transition-colors hover:bg-blue-50/40">
                                          <td className="p-4 text-center font-black text-slate-800">{row.month}月</td>
                                          <td className="bg-blue-50/28 p-4">
                                              <div className="relative">
                                                  <span className="absolute left-3 top-2.5 text-xs font-bold text-blue-500">￥</span>
                                                  <input
                                                      type="number"
                                                      inputMode="decimal"
                                                      enterKeyHint="done"
                                                      className="w-full rounded-xl border border-blue-100/90 bg-white/90 py-2 pl-7 pr-3 font-mono text-slate-950 outline-none focus-visible:ring-4 focus-visible:ring-blue-200/80"
                                                      value={row.initialBudget || ''}
                                                      onChange={(e) => updateTempInitData(row.month, 'initialBudget', Number(e.target.value))}
                                                      placeholder="0.00"
                                                  />
                                              </div>
                                          </td>
                                          <td className="p-4">
                                              <div className="relative">
                                                  <span className="absolute left-3 top-2.5 text-xs font-bold text-slate-500">￥</span>
                                                  <input
                                                      type="number"
                                                      inputMode="decimal"
                                                      enterKeyHint="done"
                                                      className="w-full rounded-xl border border-slate-200/90 bg-white/90 py-2 pl-7 pr-3 font-mono text-slate-950 outline-none focus-visible:ring-4 focus-visible:ring-blue-200/80"
                                                      value={row.revenueCollected || ''}
                                                      onChange={(e) => updateTempInitData(row.month, 'revenueCollected', Number(e.target.value))}
                                                      placeholder="0.00"
                                                  />
                                              </div>
                                          </td>
                                          <td className="p-4">
                                              <div className="relative">
                                                  <input
                                                      type="number"
                                                      inputMode="decimal"
                                                      enterKeyHint="done"
                                                      className="w-full rounded-xl border border-slate-200/90 bg-white/90 py-2 pl-3 pr-8 font-mono text-slate-950 outline-none focus-visible:ring-4 focus-visible:ring-blue-200/80"
                                                      value={row.occupancyRate || ''}
                                                      onChange={(e) => updateTempInitData(row.month, 'occupancyRate', Number(e.target.value))}
                                                      placeholder="0.0"
                                                      step="0.1"
                                                      max="100"
                                                  />
                                                  <span className="absolute right-3 top-2.5 text-xs font-bold text-slate-500">%</span>
                                              </div>
                                          </td>
                                          {initDataYear === 2025 && (
                                              <td className="bg-amber-50/42 p-4">
                                                  <div className="relative">
                                                      <span className="absolute left-3 top-2.5 text-xs font-bold text-amber-600">￥</span>
                                                      <input
                                                          type="number"
                                                          inputMode="decimal"
                                                          enterKeyHint="done"
                                                          className="w-full rounded-xl border border-amber-200/90 bg-white/90 py-2 pl-7 pr-3 font-mono text-slate-950 outline-none focus-visible:ring-4 focus-visible:ring-amber-200/80 disabled:bg-slate-100/80 disabled:text-slate-400"
                                                          value={row.accumulatedArrears || ''}
                                                          onChange={(e) => updateTempInitData(row.month, 'accumulatedArrears', Number(e.target.value))}
                                                          placeholder="仅 12 月填写"
                                                          disabled={row.month !== 12}
                                                      />
                                                      {row.month === 12 && (
                                                          <div className="mt-1 text-xs font-bold text-amber-700">
                                                              2025 年及之前累计欠款
                                                          </div>
                                                      )}
                                                  </div>
                                              </td>
                                          )}
                                      </tr>
                                  ))}
                              </tbody>
                          </table>
                      </div>
                  </div>
                  
                  <div className="flex flex-col gap-3 border-t border-white/70 px-4 py-4 md:flex-row md:items-center md:justify-between md:px-6">
                      <div className="liquid-glass-readable flex items-start gap-2 rounded-2xl px-3 py-2 text-xs font-semibold leading-relaxed text-slate-600 md:items-center">
                          <Info size={14} className="shrink-0 text-blue-600"/>
                          说明：录入数据将覆盖该年度看板对应的年初预算、历史实收、出租率及 2025 年累计欠款口径。
                      </div>
                      <div className="grid grid-cols-2 gap-2 md:flex md:justify-end md:gap-3">
                          <button onClick={() => setIsInitDataModalOpen(false)} className="liquid-glass-control liquid-pressable rounded-full px-6 py-2.5 text-sm font-bold text-slate-700">取消</button>
                          <button onClick={saveInitData} className="liquid-action-strong liquid-pressable rounded-full px-6 py-2.5 text-sm font-black md:px-8">保存配置</button>
                      </div>
                  </div>
              </div>
          </div>
      )}

	      {pendingConflicts.length > 0 && (
	        <Suspense fallback={null}>
	          <ConflictDialog
	            open={true}
	            conflicts={pendingConflicts}
	            onClose={() => setPendingConflicts([])}
	            onResolve={async (decisions) => {
	                await handleResolveConflict(decisions);
	            }}
	          />
	        </Suspense>
      )}
      {glassPrompt && (() => {
          const tone = glassPrompt.tone || 'blue';
          const toneClass =
              tone === 'rose'
                  ? 'border-rose-200/80 text-rose-700'
                  : tone === 'amber'
                    ? 'border-amber-200/80 text-amber-700'
                    : tone === 'cyan'
                      ? 'border-cyan-200/80 text-cyan-700'
                      : tone === 'slate'
                        ? 'border-slate-200/80 text-slate-700'
                        : 'border-blue-200/80 text-blue-700';
          const iconBg =
              tone === 'rose'
                  ? 'text-rose-700'
                  : tone === 'amber'
                    ? 'text-amber-700'
                    : tone === 'cyan'
                      ? 'text-cyan-700'
                      : tone === 'slate'
                        ? 'text-slate-700'
                        : 'text-blue-700';
          const Icon = tone === 'rose' ? XCircle : tone === 'amber' ? AlertCircle : CheckCircle2;
          return (
              <div className="monthly-detail-backdrop fixed inset-0 z-[120] flex items-center justify-center p-4">
                  <div
                      role="dialog"
                      aria-modal="true"
                      className="liquid-elevated-card w-full max-w-lg overflow-hidden rounded-[28px] animate-in fade-in zoom-in-95 duration-200"
                  >
                      <div className="liquid-elevated-header flex items-start justify-between gap-3 border-b border-white/60 px-5 py-4">
                          <div className="flex min-w-0 items-start gap-3">
                              <span className={`liquid-icon-well flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${iconBg}`}>
                                  <Icon size={22} />
                              </span>
                              <div className="min-w-0">
                                  <h3 className="text-lg font-black text-slate-950">{glassPrompt.title}</h3>
                                  <p className="mt-0.5 text-xs font-semibold text-slate-500">
                                      {glassPrompt.kind === 'confirm' ? '请确认后继续' : '系统提示'}
                                  </p>
                              </div>
                          </div>
                          <button
                              type="button"
                              onClick={() => closeGlassPrompt(false)}
                              className="liquid-glass-control liquid-pressable rounded-full p-2 text-slate-500 hover:bg-white/75 hover:text-slate-950"
                              aria-label="关闭提示"
                          >
                              <X size={18} />
                          </button>
                      </div>
                      {glassPrompt.message && (
                          <div className="px-5 py-4">
                              <div className={`liquid-glass-readable max-h-[54vh] overflow-auto whitespace-pre-line rounded-2xl border px-4 py-3 text-sm font-semibold leading-relaxed ${toneClass}`}>
                                  {glassPrompt.message}
                              </div>
                          </div>
                      )}
                      {glassPrompt.kind === 'input' && (
                          <div className={`px-5 ${glassPrompt.message ? 'pb-4' : 'py-4'}`}>
                              <label className="mb-1.5 block text-xs font-black text-slate-500">
                                  {glassPrompt.inputLabel || '请输入内容'}
                              </label>
                              <textarea
                                  className="liquid-elevated-field min-h-24 w-full resize-none rounded-2xl px-3.5 py-3 text-sm font-semibold leading-relaxed text-slate-900 outline-none focus-visible:ring-4 focus-visible:ring-blue-500/10"
                                  value={glassPromptInput}
                                  onChange={(e) => setGlassPromptInput(e.target.value)}
                                  placeholder={glassPrompt.inputPlaceholder}
                                  autoFocus
                              />
                          </div>
                      )}
                      <div className="liquid-elevated-footer flex justify-end gap-2 border-t border-white/60 px-5 py-4">
                          {glassPrompt.kind !== 'notice' && (
                              <button
                                  type="button"
                                  onClick={() => closeGlassPrompt(false)}
                                  className="liquid-glass-control liquid-pressable rounded-2xl px-4 py-2.5 text-sm font-bold text-slate-600 hover:bg-white/75"
                              >
                                  {glassPrompt.cancelText || '取消'}
                              </button>
                          )}
                          <button
                              type="button"
                              onClick={() => closeGlassPrompt(true)}
                              className="liquid-action-strong liquid-pressable rounded-2xl px-5 py-2.5 text-sm font-black text-white"
                          >
                              {glassPrompt.confirmText || (glassPrompt.kind === 'confirm' ? '确认' : '知道了')}
                          </button>
                      </div>
                  </div>
              </div>
          );
      })()}
      {/* C2 外部写入感知：本地有未保存改动时检测到其他端更新，提示用户（保存后会自动同步远端） */}
      {remoteChangePending && (
        <div className="liquid-glass-readable fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+5.4rem)] z-50 flex items-start gap-3 rounded-[22px] border border-amber-200/80 px-4 py-3 text-sm text-slate-800 shadow-[0_18px_50px_rgba(15,23,42,0.14)] animate-in fade-in slide-in-from-bottom-2 md:inset-x-auto md:right-4 md:bottom-4 md:max-w-sm">
          <span className="liquid-icon-well mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl text-amber-700">
            <AlertCircle size={17} />
          </span>
          <div className="flex-1">
            <div className="font-black text-slate-950">检测到其他端更新了数据</div>
            <div className="mt-0.5 text-xs font-semibold leading-relaxed text-amber-700">你有未保存的本地修改。保存后系统会做行级冲突校验并自动同步远端最新数据。</div>
          </div>
          <button onClick={() => setRemoteChangePending(false)} className="liquid-glass-control liquid-pressable shrink-0 rounded-full p-1.5 text-slate-500 hover:bg-white/75 hover:text-slate-950" title="忽略" aria-label="忽略其他端更新提示"><X size={15} /></button>
        </div>
      )}
    </div>
    </DirtyTrackerProvider>
  );
};

export default App;
