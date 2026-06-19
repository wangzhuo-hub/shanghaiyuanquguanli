
import React, { useState, useEffect, useMemo, Suspense } from 'react';
import { LayoutDashboard, Building2, Users, PieChart, Settings, Bell, Search, Menu, Sparkles, UserCircle, Download, Upload, X, Check, Filter, Save, RotateCcw, Trash2, Calculator, Database, Lightbulb, Cloud, CloudCog, RefreshCw, AlertCircle, ExternalLink, Link, Info, Loader2, CheckCircle2, XCircle, History, FileClock, ChevronRight, ChevronDown, CloudUpload, LogOut, User, Calendar, ChevronLeft, FileInput, Table as TableIcon, FileText, Pencil, UserCog } from 'lucide-react';
import { generateInitialData } from './services/mockData';
import { DashboardData, Building, Tenant, PaymentRecord, UnitStatus, MonthlyTrend, PaymentCycle, RentFreePeriod, BillingDetail, ParkingStatDetail, BudgetAssumption, BudgetAdjustment, BudgetAnalysisData, CloudConfig, AIConfig, CloudBackupMetadata, BudgetScenario, MonthlyInitData, ContractStatus, DepositStatus, InvoiceRecord, AuthUser, ParkInfo, UserRole } from './types';
import { StatsCards as StatsCardsBase } from './components/StatsCards';
import { RecentActivityTable as RecentActivityTableBase, AnnualMetricComparisonTable as AnnualMetricComparisonTableBase, AnnualComparisonData } from './components/Tables';
import { BillingTable as BillingTableBase } from './components/BillingTable';
import { AssistantPanel } from './components/AssistantPanel';
import { TenantBudgetNameLinkTool } from './components/TenantMergeTool';
import { TenantInsights } from './components/TenantInsights';
import { DashboardAlerts as DashboardAlertsBase } from './components/DashboardAlerts';
import type { NewManagedUserForm } from './components/SystemSettingsPanel';
import { ConflictDialog } from './components/ConflictDialog';
import {
    checkConnection,
    getCloudHistory,
    fetchCloudBackup,
    initCloud,
    SaveToCloudResult,
    scheduleUpsertIntegrationFullSnapshot,
    saveIncrementalToCloud,
    bumpCloudSaveVersion,
    readCloudSaveVersion,
    forceOverwriteCloudRecord,
    loginCloudUser,
    logoutCloudUser,
    getCurrentCloudUser,
    refreshCloudAuthRecord,
    changeOwnCloudPassword,
    fetchAuthorizedParks,
    fetchManagedCloudUsers,
    createManagedCloudUser,
    updateManagedCloudUserEnabled,
    updateManagedCloudUser,
    deleteManagedCloudUser,
    deleteCloudSignupRequest,
    fetchPublicCloudParks,
    submitCloudSignupRequest,
    fetchCloudSignupRequests,
    approveCloudSignupRequest,
    rejectCloudSignupRequest,
    fetchCloudKpiSnapshot,
} from './services/cloudService';
import type { KpiSnapshotSummary, RecordMeta, IncrementalConflict, IncrementalApplied } from './services/cloudService';
import { formatIncrementalSaveDetails, formatIncrementalSaveAlertTitle, type IncrementalSaveDisplayOptions } from './services/cloudService';
import type { ManagedUserAccount } from './services/cloudService';
import type { SignupRequestRecord } from './services/cloudService';
import { buildIntegrationFullSnapshotV1 } from './services/integrationSnapshot';
import { FAR_FUTURE_DATE, generateBudgetedBills, getVirtualTenants } from './services/billingService';
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
    buildBillingDetailsForPeriod as buildBillingDetailsForPeriodService,
    getOrCreateBillingCacheFor,
    calculateDashboardMetrics as calculateDashboardMetricsService,
    normalizeScenarioForReceivable as normalizeScenarioForReceivableService,
    normalizeKpiSummaryWithMonthlyTrends,
    resolveAnnualInitialBudget,
    normalizeYearlyTargetsFromInitialization,
    type DashboardQuarter,
} from './services/dashboardMetrics';
import { computeMetricsInWorker, isMetricsWorkerAvailable } from './services/metricsWorkerClient';
import { setLoadWindowSinceYear } from './services/pocketbaseService';
import { formatArea, formatCurrency, formatPercent, formatWan } from './services/numberFormat';
import { transitionContractStatuses } from './services/sharedUtils';
import { isManagementFeeBillingEnabled } from './services/parkBillingConfig';
import { userRoleLabel } from './services/receivablePermissions';
import { DEFAULT_CLOUD_CONFIG, mergeStoredCloudConfig, cloudConfigForStorage } from './config/deploymentDefaults';
import { getIntegrationComputeRefreshUrl, getIntegrationInternalToken } from './config/urls';
import { DirtyTrackerProvider } from './services/dirtyTrackerContext';
import { DirtyTracker } from './services/dirtyTracker';
import {
    dashboardDataToPbRecords,
    diffPbRecords,
    payloadCount,
    type PbRecordMap,
} from './services/dataDiff';
import {
    createDashboardBackupEnvelope,
    formatBackupSummary,
    parseDashboardBackup,
    sanitizeImportedDashboardData,
    validateBackupTarget,
} from './services/backupArchive';
import {
    mergeBudgetTotalsIntoInitData,
    normalizeEffectiveBudgetTableFromBackup,
    readImportedBudgetTable,
    writeImportedBudgetTable,
} from './services/budgetTableImport';
import {
    preserveRentFieldsInTenantPbMap,
    filterDirtyPayloadForRentMaskedUser,
} from './services/tenantRentFieldGuard';
import { scopeCachedDashboardData } from './services/dataScopeFilter';
import { mergeLocalDashboardCacheIntoCloud } from './services/localCloudMerge';
import { migrateShanghaiInitRow, SHANGHAI_PARK_ID } from './services/initDataBudget';
import { parkAreaMetricsFromDashboard } from './services/parkAreaMetrics';
import { cachePut, cacheGet } from './services/storageCache';

const AIAssistantDialog = React.lazy(() =>
    import('./components/AIAssistantDialog').then((m) => ({ default: m.AIAssistantDialog }))
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
// 按年窗口加载（B3，默认关闭）：VITE_YEAR_WINDOW_LOAD=1 时只加载「当年+上一年」收款/发票，
// 历史欠款走 pb_sealed_months 封账快照。必须在封账回填完成后再开启，否则窗口外欠款会缺失。
// 同一模块级窗口驱动所有 fetchCloudBackup，data 与 baseline 口径天然一致（规避第二轮的错位风暴）。
if (import.meta.env?.VITE_YEAR_WINDOW_LOAD === '1') {
    setLoadWindowSinceYear(new Date().getFullYear() - 1);
}

// 工作台首屏重组件用 React.memo 包裹（模块级，避免每次渲染重建）：
// data 引用未变（切 tab 命中结果缓存、无关 state 更新）时跳过整树重渲染。
const StatsCards = React.memo(StatsCardsBase);
const RecentActivityTable = React.memo(RecentActivityTableBase);
const AnnualMetricComparisonTable = React.memo(AnnualMetricComparisonTableBase);
const BillingTable = React.memo(BillingTableBase);
const DashboardAlerts = React.memo(DashboardAlertsBase);

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
      relative w-full flex items-center gap-3 px-5 py-2.5 transition-all duration-300 group overflow-hidden
      ${active 
        ? 'bg-sky-50 text-sky-700 font-medium border-r-4 border-sky-600'
        : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-all duration-200'
      }
    `}
    title={!isOpen ? label : ''}
  >
    <div className={`
      relative z-10 transition-transform duration-300 flex-shrink-0
      ${active ? 'scale-110' : 'group-hover:scale-110'}
    `}>
      {icon}
    </div>
    
    <span className={`
      relative z-10 text-base font-semibold whitespace-nowrap transition-all duration-300 origin-left
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

type MobileTenantSearchResult = {
    id: string;
    name: string;
    location: string;
    statusLabel: string;
    helper: string;
    paymentSummary?: string;
};

const MOBILE_TOTAL_SCOPE = '__total__';
const MOBILE_PARK_SNAPSHOT_CACHE_MS = 60_000;
const PROJECT_SWITCH_DEBOUNCE_MS = 160;

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
    source: 'current' | 'snapshot' | 'computed' | 'total' | 'empty';
};

type MobileParkKpiSnapshotEntry = {
    summary: KpiSnapshotSummary;
    dataVersion?: number;
    year: number;
    source: 'snapshot' | 'computed';
    loadedAt?: number;
};

const isParkManagerRole = (role?: UserRole) =>
    role === 'platform_admin' || role === 'group_admin' || role === 'park_admin';

const contractStatusText = (status: ContractStatus) => {
    switch (status) {
        case ContractStatus.Active:
            return '履约中';
        case ContractStatus.Expiring:
            return '即将到期';
        case ContractStatus.Pending:
            return '签约中';
        case ContractStatus.Expired:
            return '已到期';
        case ContractStatus.Terminated:
            return '已退租';
        default:
            return status;
    }
};

const MobileFocusCell: React.FC<{
    label: string;
    value: string;
    helper: string;
    tone: 'blue' | 'emerald' | 'amber' | 'rose';
}> = ({ label, value, helper, tone }) => {
    const toneClass = {
        blue: 'text-sky-700 bg-sky-50 border-sky-100',
        emerald: 'text-emerald-700 bg-emerald-50 border-emerald-100',
        amber: 'text-amber-700 bg-amber-50 border-amber-100',
        rose: 'text-rose-700 bg-rose-50 border-rose-100',
    }[tone];
    return (
        <div className="mobile-card-enter min-w-0 px-3 py-2.5">
            <div className="text-[10px] font-semibold text-slate-500">{label}</div>
            <div className="mt-0.5 truncate text-base font-black tabular-nums tracking-normal text-slate-900">
                {value}
            </div>
            <div className={`mt-0.5 inline-flex max-w-full rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${toneClass}`}>
                <span className="truncate">{helper}</span>
            </div>
        </div>
    );
};

const MobileActionButton: React.FC<{
    icon: React.ReactNode;
    label: string;
    helper: string;
    tone: 'blue' | 'emerald' | 'amber' | 'slate';
    onClick: () => void;
}> = ({ icon, label, helper, tone, onClick }) => {
    const toneClass = {
        blue: 'bg-gradient-to-br from-sky-500 to-blue-600 text-white shadow-sky-500/20',
        emerald: 'bg-gradient-to-br from-emerald-400 to-teal-500 text-white shadow-emerald-500/20',
        amber: 'bg-gradient-to-br from-amber-300 to-orange-400 text-slate-950 shadow-amber-400/20',
        slate: 'bg-white text-slate-900 border border-sky-100',
    }[tone];
    return (
        <button
            type="button"
            onClick={onClick}
            className={`mobile-pressable min-w-0 rounded-xl px-2.5 py-2 text-left shadow-sm ${toneClass}`}
        >
            <span className="flex items-center gap-1.5 text-sm font-black">
                {icon}
                <span className="truncate">{label}</span>
            </span>
            <span className="mt-0.5 block truncate text-[10px] font-semibold opacity-80">{helper}</span>
        </button>
    );
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
    managerKpi?: MobileParkKpi;
    managerParkKpis?: MobileParkKpi[];
    managerKpiScope?: string;
    isLoadingManagerKpis?: boolean;
    searchQuery: string;
    searchResults: MobileTenantSearchResult[];
    onSearchQueryChange: (value: string) => void;
    onYearChange: (year: number) => void;
    onGoContracts: () => void;
    onGoFinance: () => void;
    onGoSearch: () => void;
    onBackToOverview: () => void;
    onManagerKpiScopeChange?: (scope: string) => void;
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
    managerKpi,
    managerParkKpis = [],
    managerKpiScope,
    isLoadingManagerKpis = false,
    searchQuery,
    searchResults,
    onSearchQueryChange,
    onYearChange,
    onGoContracts,
    onGoFinance,
    onGoSearch,
    onBackToOverview,
    onManagerKpiScopeChange,
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
    const arrearsTone = arrears > 100000 ? 'rose' : arrears > 0 ? 'amber' : 'emerald';
    const expiringCount = data.expiringSoon?.length || 0;
    const signingCount = data.recentSignings?.length || 0;
    const leasedArea = displayKpi.leasedArea || Math.max(0, (displayKpi.totalArea || 0) - (displayKpi.vacantArea || 0));
    const remainingRevenue = Math.max(0, revenueGoal - revenueCollected);
    const collectionGap = Math.max(0, 100 - revenueProgress);
    const resolvedTenantCount = displayKpi.tenantCount || activeContractCount || 0;
    const tenantCountValue = resolvedTenantCount > 0 ? `${resolvedTenantCount} 家` : '待同步';
    const tenantCountHelper = resolvedTenantCount > 0
        ? displayKpi.source === 'total'
            ? '汇总在租客户'
            : displayKpi.source === 'current'
                ? `近期签约 ${signingCount} 家`
                : '在租客户'
        : '客户明细同步中';
    const searchInputRef = React.useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        if (mode !== 'search') return;
        const focusTimer = window.setTimeout(() => searchInputRef.current?.focus(), 80);
        return () => window.clearTimeout(focusTimer);
    }, [mode]);

    if (mode === 'search') {
        return (
            <section className="mobile-card-enter md:hidden overflow-hidden rounded-2xl border border-sky-100 bg-white shadow-sm shadow-sky-100/60">
                <div className="bg-gradient-to-br from-sky-500 via-cyan-500 to-emerald-400 px-3.5 py-3 text-white">
                    <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                            <div className="truncate text-sm font-bold">{isManagerView ? '客户收款查询' : '快速查询'}</div>
                            <div className="mt-0.5 text-[11px] text-white/80">{parkName || projectId || '当前园区'}</div>
                        </div>
                        <button
                            type="button"
                            onClick={onBackToOverview}
                            className="mobile-pressable rounded-full bg-white/20 px-3 py-1 text-[11px] font-bold text-white shadow-sm ring-1 ring-white/20"
                        >
                            指标
                        </button>
                    </div>
                    <label className="mt-2.5 flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-slate-900">
                        <Search size={16} className="shrink-0 text-slate-400" />
                        <input
                            ref={searchInputRef}
                            value={searchQuery}
                            onChange={(event) => onSearchQueryChange(event.target.value)}
                            placeholder={isManagerView ? '搜客户、收款、房号' : '搜客户、联系人、房号'}
                            className="min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none placeholder:text-slate-400"
                        />
                    </label>
                </div>
                <div className="divide-y divide-slate-100">
                    {searchResults.length > 0 ? searchResults.map((item) => (
                        <div key={item.id} className="mobile-card-enter flex items-center justify-between gap-3 px-3 py-2">
                            <div className="min-w-0">
                                <div className="truncate text-sm font-black text-slate-900">{item.name}</div>
                                <div className="mt-0.5 truncate text-[11px] font-semibold text-slate-500">
                                    {item.location} · {item.statusLabel}
                                </div>
                                <div className={`mt-0.5 truncate text-[10px] ${isManagerView ? 'font-bold text-blue-600' : 'text-slate-400'}`}>
                                    {isManagerView ? (item.paymentSummary || '暂无收款记录') : item.helper}
                                </div>
                            </div>
                            <div className="flex shrink-0 items-center gap-1">
                                <button type="button" onClick={onGoContracts} className="mobile-pressable rounded-lg bg-sky-50 px-2 py-1 text-[11px] font-bold text-sky-700 ring-1 ring-sky-100">
                                    合同
                                </button>
                                {!isManagerView && (
                                    <button type="button" onClick={onGoFinance} className="mobile-pressable rounded-lg bg-gradient-to-r from-sky-500 to-blue-600 px-2 py-1 text-[11px] font-bold text-white shadow-sm">
                                        核销
                                    </button>
                                )}
                            </div>
                        </div>
                    )) : (
                        <div className="px-4 py-8 text-center text-sm font-semibold text-slate-400">未找到匹配客户</div>
                    )}
                </div>
            </section>
        );
    }

    if (!isManagerView) {
        return (
            <section className="mobile-card-enter md:hidden overflow-hidden rounded-2xl border border-sky-100 bg-white shadow-sm shadow-sky-100/60">
                <div className="bg-gradient-to-br from-sky-500 via-cyan-500 to-emerald-400 px-3.5 py-3 text-white">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <div className="truncate text-sm font-bold">今日工作台</div>
                            <div className="mt-0.5 truncate text-[11px] text-white/80">
                                {parkName || projectId || '当前园区'} · {isSyncing ? '同步中' : lastSaved ? `缓存 ${lastSaved}` : '数据就绪'}
                            </div>
                        </div>
                        <span
                            className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                                isCloudConnected
                                    ? 'border-white/30 bg-white/20 text-white'
                                    : 'border-white/25 bg-white/10 text-white/80'
                            }`}
                        >
                            {isCloudConnected ? '在线' : '本地'}
                        </span>
                    </div>
                    <div className="mt-2.5 grid grid-cols-3 gap-2">
                        <MobileActionButton icon={<CheckCircle2 size={15} />} label="核销" helper="收款入账" tone="emerald" onClick={onGoFinance} />
                        <MobileActionButton icon={<FileText size={15} />} label="合同" helper="录入续签" tone="blue" onClick={onGoContracts} />
                        <MobileActionButton icon={<Search size={15} />} label="查询" helper="客户账款" tone="amber" onClick={onGoSearch} />
                    </div>
                </div>
                <div className="grid grid-cols-3 divide-x divide-slate-100">
                    <MobileFocusCell label="待跟进" value={formatWan(arrears, 0)} helper="欠款核销" tone={arrearsTone} />
                    <MobileFocusCell label="在租合同" value={`${activeContractCount} 份`} helper="可录入变更" tone="blue" />
                    <MobileFocusCell label="到期预警" value={`${expiringCount} 家`} helper={`新签 ${signingCount} 家`} tone={expiringCount > 0 ? 'amber' : 'emerald'} />
                </div>
            </section>
        );
    }

    return (
        <section className="mobile-card-enter md:hidden overflow-hidden rounded-2xl border border-sky-100 bg-white shadow-sm shadow-sky-100/60">
            <div className="bg-gradient-to-br from-sky-500 via-cyan-500 to-emerald-400 px-3.5 py-3 text-white">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <div className="truncate text-sm font-bold">{displayKpi.parkName || parkName || projectId || '当前园区'}</div>
                        <div className="mt-0.5 text-[11px] text-white/80">
                            {kpiUnavailable
                                ? (isLoadingManagerKpis ? '正在同步快照' : '部分园区数据未就绪')
                                : isSyncing ? '正在同步数据' : lastSaved ? `本地缓存 ${lastSaved}` : '数据已就绪'}
                        </div>
                    </div>
                    <span
                        className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                            isCloudConnected
                                ? 'border-white/30 bg-white/20 text-white'
                                : 'border-white/25 bg-white/10 text-white/80'
                        }`}
                    >
                        {isCloudConnected ? '后端在线' : '本地模式'}
                    </span>
                </div>

                <div className="mt-2.5 flex items-end justify-between gap-3">
                    <div>
                        <div className="text-[11px] font-semibold text-white/80">年度收款达成</div>
                        <div className="mt-1 flex items-baseline gap-2">
                            <span className="text-[36px] font-black leading-none tabular-nums tracking-normal">
                                {kpiUnavailable ? '...' : formatPercent(revenueProgress, 0)}
                            </span>
                            {!kpiUnavailable && <span className="rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-black text-white ring-1 ring-white/20">
                                缺口 {formatPercent(collectionGap, 0)}
                            </span>}
                        </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end">
                        <div className="flex items-center rounded-full border border-white/30 bg-white/20 p-0.5 shadow-sm backdrop-blur">
                            <button
                                type="button"
                                onClick={() => onYearChange(selectedYear - 1)}
                                className="mobile-pressable rounded-full p-1 text-white hover:bg-white/20"
                                aria-label="上一年"
                            >
                                <ChevronLeft size={13} />
                            </button>
                            <span className="px-2 text-xs font-black tabular-nums text-white">{selectedYear}</span>
                            <button
                                type="button"
                                onClick={() => onYearChange(selectedYear + 1)}
                                className="mobile-pressable rounded-full p-1 text-white hover:bg-white/20"
                                aria-label="下一年"
                            >
                                <ChevronRight size={13} />
                            </button>
                        </div>
                    </div>
                </div>

                <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-white/25">
                    <div className="h-full rounded-full bg-white shadow-[0_0_14px_rgba(255,255,255,0.65)] transition-all duration-700" style={{ width: progressWidth }} />
                </div>
                <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-white/90">
                    <span className="truncate">已收 {kpiUnavailable ? '读取中' : formatWan(revenueCollected, 0)}</span>
                    <span className="shrink-0">目标 {kpiUnavailable ? '读取中' : revenueGoal > 0 ? formatWan(revenueGoal, 0) : '未设定'}</span>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-1.5">
                    <div className="rounded-xl bg-white/18 px-2 py-1.5 ring-1 ring-white/20">
                        <div className="text-[9px] font-bold text-white/75">收款缺口</div>
                        <div className="mt-0.5 truncate text-[11px] font-black tabular-nums">{kpiUnavailable ? '--' : formatWan(remainingRevenue, 0)}</div>
                    </div>
                    <div className="rounded-xl bg-white/18 px-2 py-1.5 ring-1 ring-white/20">
                        <div className="text-[9px] font-bold text-white/75">已租面积</div>
                        <div className="mt-0.5 truncate text-[11px] font-black tabular-nums">{kpiUnavailable ? '--' : formatArea(leasedArea)}</div>
                    </div>
                    <div className="rounded-xl bg-white/18 px-2 py-1.5 ring-1 ring-white/20">
                        <div className="text-[9px] font-bold text-white/75">出租目标</div>
                        <div className="mt-0.5 truncate text-[11px] font-black tabular-nums">{kpiUnavailable ? '--' : formatPercent(displayKpi.occupancyTarget || 0, 0)}</div>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-2 divide-x divide-y divide-slate-100">
                <MobileFocusCell
                    label="出租率"
                    value={kpiUnavailable ? '--' : formatPercent(displayKpi.occupancyRate || 0, 0)}
                    helper={kpiUnavailable ? '读取中' : occupancyGap > 0 ? `距目标 ${formatPercent(occupancyGap, 0)}` : '已达目标'}
                    tone={kpiUnavailable ? 'blue' : occupancyGap > 0 ? 'amber' : 'emerald'}
                />
                <MobileFocusCell
                    label="累计欠款"
                    value={kpiUnavailable ? '--' : formatWan(arrears, 0)}
                    helper={kpiUnavailable ? '读取中' : arrears > 0 ? '需跟进核销' : '账款健康'}
                    tone={kpiUnavailable ? 'blue' : arrearsTone}
                />
                <MobileFocusCell
                    label="空置面积"
                    value={kpiUnavailable ? '--' : formatArea(displayKpi.vacantArea || Math.max(0, (displayKpi.totalArea || 0) - (displayKpi.leasedArea || 0)))}
                    helper={kpiUnavailable ? '读取中' : `总面积 ${formatArea(displayKpi.totalArea || 0)}`}
                    tone="blue"
                />
                <MobileFocusCell
                    label="客户数"
                    value={kpiUnavailable ? '--' : tenantCountValue}
                    helper={kpiUnavailable ? '读取中' : tenantCountHelper}
                    tone={kpiUnavailable ? 'blue' : expiringCount > 0 && displayKpi.source === 'current' ? 'amber' : 'emerald'}
                />
                <MobileFocusCell
                    label="已租面积"
                    value={kpiUnavailable ? '--' : formatArea(leasedArea)}
                    helper={kpiUnavailable ? '读取中' : `出租 ${formatPercent(displayKpi.occupancyRate || 0, 0)}`}
                    tone="emerald"
                />
                <MobileFocusCell
                    label="收款缺口"
                    value={kpiUnavailable ? '--' : formatWan(remainingRevenue, 0)}
                    helper={kpiUnavailable ? '读取中' : `待达成 ${formatPercent(collectionGap, 0)}`}
                    tone={kpiUnavailable ? 'blue' : remainingRevenue > 0 ? 'amber' : 'emerald'}
                />
            </div>
            {managerParkKpis.length > 1 && (
                <div className="border-t border-sky-50 bg-gradient-to-b from-sky-50/80 to-white p-2.5">
                    <div className="mb-2 flex items-center justify-between px-0.5 text-[10px] font-bold text-sky-700">
                        <span>{isGlobalAdminView ? '园区汇总与切换' : '园区切换'}</span>
                        {isLoadingManagerKpis && <span>刷新中...</span>}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        {managerParkKpis.map((item, index) => {
                            const selected = managerKpiScope
                                ? item.projectId === managerKpiScope
                                : item.projectId === displayKpi.projectId;
                            const itemUnavailable = item.source === 'empty';
                            return (
                                <button
                                    key={item.projectId}
                                    type="button"
                                    onClick={() => onManagerKpiScopeChange?.(item.projectId)}
                                    style={{ animationDelay: `${index * 35}ms` }}
                                    className={`mobile-card-enter mobile-pressable min-w-0 rounded-xl border px-2.5 py-2 text-left ${
                                        selected
                                            ? 'border-cyan-300 bg-gradient-to-br from-sky-500 to-emerald-400 text-white shadow-md shadow-sky-300/30'
                                            : 'border-sky-100 bg-white text-slate-700 shadow-sm shadow-sky-100/70'
                                    }`}
                                >
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="truncate text-xs font-black">{item.parkName}</span>
                                        <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-black ${
                                            selected ? 'bg-white/20 text-white ring-1 ring-white/20' : 'bg-sky-50 text-sky-700'
                                        }`}>
                                            {itemUnavailable ? (isLoadingManagerKpis ? '...' : '暂无') : formatPercent(item.revenueProgress, 0)}
                                        </span>
                                    </div>
                                    <div className={`mt-1 grid grid-cols-2 gap-x-1 gap-y-0.5 text-[10px] font-semibold ${
                                        selected ? 'text-white/85' : 'text-slate-500'
                                    }`}>
                                        {itemUnavailable ? (
                                            <span className="col-span-2 truncate">
                                                {isLoadingManagerKpis ? '同步快照中' : '暂无可用快照'}
                                            </span>
                                        ) : (
                                            <>
                                                <span className="truncate">已收 {formatWan(item.revenueCollected, 0)}</span>
                                                <span className="shrink-0 text-right">出租 {formatPercent(item.occupancyRate, 0)}</span>
                                                <span className="col-span-2 truncate">欠款 {formatWan(item.accumulatedArrears, 0)}</span>
                                            </>
                                        )}
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}
        </section>
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
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 1023px)').matches : false
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023px)');
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

const buildMobileTotalParkKpi = (items: MobileParkKpi[]): MobileParkKpi => {
    const readyItems = items.filter((item) => item.source !== 'empty');
    if (readyItems.length === 0) {
        return {
            projectId: MOBILE_TOTAL_SCOPE,
            parkName: '全部园区',
            revenueGoal: 0,
            revenueCollected: 0,
            revenueProgress: 0,
            occupancyRate: 0,
            occupancyTarget: 0,
            totalArea: 0,
            leasedArea: 0,
            vacantArea: 0,
            accumulatedArrears: 0,
            tenantCount: 0,
            source: 'empty',
        };
    }
    const revenueGoal = readyItems.reduce((sum, item) => sum + (item.revenueGoal || 0), 0);
    const revenueCollected = readyItems.reduce((sum, item) => sum + (item.revenueCollected || 0), 0);
    const totalArea = readyItems.reduce((sum, item) => sum + (item.totalArea || 0), 0);
    const leasedArea = readyItems.reduce((sum, item) => sum + (item.leasedArea || 0), 0);
    const occupancyTargetArea = readyItems.reduce(
        (sum, item) => sum + ((item.occupancyTarget || 0) / 100) * (item.totalArea || 0),
        0
    );

    return {
        projectId: MOBILE_TOTAL_SCOPE,
        parkName: '全部园区',
        revenueGoal,
        revenueCollected,
        revenueProgress: revenueGoal > 0 ? (revenueCollected / revenueGoal) * 100 : 0,
        occupancyRate: totalArea > 0 ? (leasedArea / totalArea) * 100 : 0,
        occupancyTarget: totalArea > 0 ? (occupancyTargetArea / totalArea) * 100 : 0,
        totalArea,
        leasedArea,
        vacantArea: readyItems.reduce((sum, item) => sum + (item.vacantArea || 0), 0),
        accumulatedArrears: readyItems.reduce((sum, item) => sum + (item.accumulatedArrears || 0), 0),
        tenantCount: readyItems.reduce((sum, item) => sum + (item.tenantCount || 0), 0),
        source: 'total',
    };
};

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

const alertCloudSaveResult = (res: CloudSaveAlertResult) => {
    if (res.conflict && (res.conflictCount || 0) > 0) {
        alert(
            `检测到 ${res.conflictCount} 条冲突，请在冲突弹窗中处理。${
                res.message ? `\n\n${res.message}` : ''
            }`
        );
        return;
    }
    const title =
        res.alertTitle || (res.ok ? '保存成功' : res.partial ? '部分保存成功' : '保存失败');
    alert(`${title}\n\n${res.message || '未知错误'}`);
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

// ── 持久化缓存双写辅助（IndexedDB 主，localStorage 兜底）────────────────
/** 缓存前剔除派生字段，减少序列化体积 50-80% */
const DERIVED_KEYS = [
    'monthlyTrends', 'prevYearMonthlyTrends', 'currentMonthBilling',
    'recentSignings', 'expiringSoon', 'parkingStats', 'budgetAnalysis',
    'parkAreaMetrics',
];

const stripDerivedFields = (data: unknown): unknown => {
    if (!data || typeof data !== 'object') return data;
    const copy = { ...(data as Record<string, unknown>) };
    for (const key of DERIVED_KEYS) delete copy[key];
    return copy;
};

const parkDataPut = (key: string, jsonStr: string) => {
    // IndexedDB 异步主路径（不阻塞）
    cachePut(key, jsonStr).then(ok => {
        if (!ok) console.warn('[cache] IndexedDB write failed for', key);
    });
    // localStorage 同步兜底（容量不够时静默失败，下次从 IndexedDB 读）
    try {
        localStorage.setItem(key, jsonStr);
    } catch {
        // QuotaExceeded — 不能依赖 localStorage，IndexedDB 是主路径
    }
};

/** 持久化 DashboardData 到缓存（自动剔除派生字段） */
const parkDataPutObj = (key: string, obj: unknown) => {
    const stripped = stripDerivedFields(obj);
    parkDataPut(key, JSON.stringify(stripped));
};

const parkDataGet = async (key: string): Promise<string | null> => {
    // 优先 IndexedDB
    const cached = await cacheGet<string>(key);
    if (cached) return cached;
    // 回退到 localStorage，并迁移到 IndexedDB
    try {
        const legacy = localStorage.getItem(key);
        if (legacy) {
            cachePut(key, legacy); // 异步迁移
            return legacy;
        }
    } catch { /* ignore */ }
    return null;
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
  const [isTestingCloud, setIsTestingCloud] = useState(false);
  const [cloudConnectionMsg, setCloudConnectionMsg] = useState<{type: 'success' | 'error', text: string} | null>(null);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [bootReady, setBootReady] = useState(false);
  const [authorizedParks, setAuthorizedParks] = useState<ParkInfo[]>([]);
  const [mobileKpiScope, setMobileKpiScope] = useState<string>(MOBILE_TOTAL_SCOPE);
  const [mobileParkSnapshotMap, setMobileParkSnapshotMap] = useState<Record<string, MobileParkKpiSnapshotEntry>>({});
  const [isLoadingMobileParkKpis, setIsLoadingMobileParkKpis] = useState(false);
  const mobileParkSnapshotMapRef = React.useRef<Record<string, MobileParkKpiSnapshotEntry>>({});
  const mobileKpiLoadSeqRef = React.useRef(0);
  const projectSwitchSeqRef = React.useRef(0);
  const projectSwitchTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
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
  const mobileNavLayout = useMobileNavLayout();

  React.useEffect(() => {
      mobileParkSnapshotMapRef.current = mobileParkSnapshotMap;
  }, [mobileParkSnapshotMap]);

  React.useEffect(() => {
      return () => {
          if (projectSwitchTimerRef.current) window.clearTimeout(projectSwitchTimerRef.current);
      };
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
  const [targetForm, setTargetForm] = useState({ occupancy: 0 });

  const [isInitDataModalOpen, setIsInitDataModalOpen] = useState(false);
  const [initDataYear, setInitDataYear] = useState<number>(2024);
  const [tempInitData, setTempInitData] = useState<MonthlyInitData[]>([]);
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
  const isKpiPreviewRef = React.useRef(false);
  // 保存时收到的冲突清单；交给 ConflictDialog 处理
  const [pendingConflicts, setPendingConflicts] = useState<IncrementalConflict[]>([]);

  useEffect(() => {
    if (window.innerWidth >= 1024) {
        setSidebarOpen(true);
    }
  }, []);

  useEffect(() => {
    const bootstrapYear = new Date().getFullYear();
    const loadData = async () => {
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
        // 启动时自动连接后端；连通时始终从 PocketBase 拉取一次结构化数据（后端优先），保证局域网各端一致
        await initCloud(configToUse);
        let currentUser = getCurrentCloudUser();
        if (currentUser?.enabled && currentUser.projectId) {
            const refreshed = await refreshCloudAuthRecord();
            if (refreshed.success && refreshed.user) {
                currentUser = refreshed.user;
            }
            setAuthUser(currentUser);
            let parks: ParkInfo[] = [];
            try {
                const parksRes = await fetchAuthorizedParks();
                if (parksRes.success) {
                    parks = parksRes.parks;
                    setAuthorizedParks(parksRes.parks);
                }
            } catch (e) {
                console.error('[App] 加载园区列表失败:', e);
            }
            const selectedProjectId = resolveInitialProjectId(currentUser, parks, configToUse.projectId);
            configToUse = { ...configToUse, projectId: selectedProjectId };
        }
        setCloudConfig(configToUse);

        const connected = await checkConnection(configToUse);
        setIsCloudConnected(connected);

        const savedData = await parkDataGet(getParkStorageKey(configToUse.projectId));
        let parsedData: DashboardData | null = null;
        if (savedData) parsedData = JSON.parse(savedData);

        let cloudBaselineData: DashboardData | null = null;
        let cloudBaselineMeta: RecordMeta | undefined;
        let hasKpiPreview = false;

        if (connected) {
          try {
            const snapshotPromise = fetchCloudKpiSnapshot(configToUse, bootstrapYear).catch(() => null);
            const backupPromise = fetchCloudBackup(configToUse, configToUse.projectId || '');
            const snapshotRes = await snapshotPromise;
            if (currentUser?.enabled && snapshotRes?.success && snapshotRes.snapshot) {
              isKpiPreviewRef.current = true;
              hasKpiPreview = true;
              // 快照仅作备份拉取失败时的兜底，不在全量数据就绪前展示（避免 161万→971万 闪烁）
              setData(buildDashboardDataFromKpiSnapshot(snapshotRes.snapshot));
            } else if (currentUser?.enabled && parsedData) {
              const cachedPreview = scopeCachedDashboardData(
                { ...generateInitialData(), ...parsedData },
                currentUser,
                configToUse.projectId,
              );
              isKpiPreviewRef.current = true;
              hasKpiPreview = true;
              setData(cachedPreview);
            }
            const latestRes = await backupPromise;
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
                // Worker 已在后台线程算，无需再用 runWhenBrowserIdle 延后；直接 await 拿结果落本地缓存。
                const processed = await recalculateMetrics(displayData, bootstrapYear, 'All');
                captureBaselineFromCloud(safeCloudData, latestRes.recordMeta, configToUse.projectId);
                parkDataPutObj(getParkStorageKey(configToUse.projectId), processed);
                setLastSaved(new Date().toLocaleTimeString());
                if (recovered) {
                  console.warn(
                    '[App] 已从本地缓存恢复尚未同步至云端的财务修改（特殊业态/收款等），请核对后点击保存。'
                  );
                }
                try {
                  const historyRes = await getCloudHistory(configToUse);
                  if (historyRes.success && historyRes.data && historyRes.data.length > 0) {
                    setCloudHistory(historyRes.data);
                    setLatestBackup(historyRes.data[0]);
                  }
                } catch (e) {
                  console.error('[App] 加载备份历史失败:', e);
                }
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
          recalculateMetrics(safeData, bootstrapYear, 'All');
          setLastSaved(new Date().toLocaleTimeString());
        } else if (!hasKpiPreview) {
          const initialData = generateInitialData();
          recalculateMetrics(initialData, bootstrapYear, 'All');
        }
      } catch (e) {
        console.error("Failed to load data", e);
        const initialData = generateInitialData();
        recalculateMetrics(initialData, bootstrapYear, 'All');
      } finally {
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
  //   3. baselineSnapshotRef.current = null 表示 switchProject 正在拉数据（baseline 尚未捕获），
  //      此时既不写 localStorage 也不写云端，避免污染目标园区本地缓存。
  const autoSaveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentProjectIdRef = React.useRef<string>(cloudConfig.projectId || '');
  React.useEffect(() => {
    currentProjectIdRef.current = cloudConfig.projectId || '';
  }, [cloudConfig.projectId]);
  useEffect(() => {
    if (!data) return;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    const projectIdAtEffectStart = cloudConfig.projectId;
    autoSaveTimerRef.current = setTimeout(async () => {
      try {
          if (isKpiPreviewRef.current) return;
          // 园区切换中（baseline 还没拉回来）— 这一刻 data 一定是上一园区的，绝不能写本园区。
          if (!baselineSnapshotRef.current) return;
          // 园区在 2 秒间被切走了（setCloudConfig 触发 effect 但 data 还没刷到目标园区）。
          if (currentProjectIdRef.current !== projectIdAtEffectStart) return;
          parkDataPutObj(getParkStorageKey(projectIdAtEffectStart), data);
          setLastSaved(new Date().toLocaleTimeString());
          if (isCloudConnected && cloudConfig.autoSync) {
              // 保存互斥：手动保存进行中则跳过本次自动同步（下次 timer 会再试）
              const autoRelease = tryAcquireSaveLock();
              if (!autoRelease) {
                  console.log('[auto-save] 手动保存进行中，跳过本次自动同步');
                  return;
              }
              try {
                  const consistencyCheck = validateDataProjectConsistency(data, projectIdAtEffectStart || '');
                  if (!consistencyCheck.consistent) {
                      console.error("[auto-save] 数据一致性校验失败:", consistencyCheck, "期望园区:", projectIdAtEffectStart);
                      return;
                  }
                  // 快照构建 + 全量 diff 是 O(全部行) 的 CPU 重活，挪进浏览器空闲时段，避免阻塞主线程。
                  const baselineForDiff = baselineSnapshotRef.current;
                  if (!baselineForDiff) return;
                  const payload = await runWhenBrowserIdle(() => {
                      const nextSnapshot = dashboardDataToPbRecords(data, projectIdAtEffectStart || '');
                      const scopedSnapshot = preserveRentFieldsInTenantPbMap(
                          nextSnapshot,
                          baselineForDiff,
                          authUser,
                      );
                      const diffed = diffPbRecords(baselineForDiff, scopedSnapshot, recordMetaRef.current);
                      return filterDirtyPayloadForRentMaskedUser(diffed, authUser);
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
                      }
                      if (res.applied.length > 0 && (res.errors.length > 0 || res.conflicts.length > 0)) {
                          if (currentProjectIdRef.current === projectIdAtEffectStart) {
                              applyPartialIncrementalSave(res.applied, data, projectIdAtEffectStart || '');
                          }
                      }
                      if (res.errors.length === 0 && res.conflicts.length === 0) {
                          // 三次防御：刷新基线之前再确认 projectId 没变，防止把当前园区基线刷成上一园区。
                          if (currentProjectIdRef.current === projectIdAtEffectStart) {
                              await refreshAfterSave(data, res.applied);
                          }
                      }
                  }
              } finally {
                  autoRelease();
              }
          }
      } catch (e) {
          console.error("Auto-save failed", e);
      }
    }, 2000);
    return () => { if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current); };
  }, [data, cloudConfig.projectId, cloudConfig.autoSync, isCloudConnected, authUser]);

  const dataRef = React.useRef(data);
  dataRef.current = data;

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
          const snap = dashboardDataToPbRecords(cur, cloudConfig.projectId || '');
          const payload = diffPbRecords(baseline, snap, recordMetaRef.current);
          if (payloadCount(payload).total > 0) {
              setRemoteChangePending(true); // 有本地改动：提示，待保存后再拉
              return;
          }
          const release = tryAcquireSaveLock();
          if (!release) return; // 保存进行中，下次轮询再试
          try {
              const res = await fetchCloudBackup(cloudConfig, cloudConfig.projectId || '');
              if (res.success && res.data) {
                  captureBaselineFromCloud(res.data, res.recordMeta, cloudConfig.projectId || '');
                  await recalculateMetrics(res.data, selectedYear, selectedQuarter);
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
  }, [isCloudConnected, cloudConfig.autoSync, cloudConfig.projectId, authUser, selectedYear, selectedQuarter]);
  /** 切 tab 结果缓存：数据/年/季度未变时跳过重算 */
  const metricsCacheRef = React.useRef<{ dataRef: DashboardData | null; year: number; quarter: string } | null>(null);
  /** 指标重算请求序号：Worker 异步回填时「最新者胜」，丢弃过期结果的 setData */
  const metricsReqSeqRef = React.useRef(0);
  /** 启动/bootstrap 已算过指标时，跳过 effect 首次重复计算 */
  const metricsFilterEffectReadyRef = React.useRef(false);
  useEffect(() => {
      if (!dataRef.current) return;
      if (!metricsFilterEffectReadyRef.current) {
          metricsFilterEffectReadyRef.current = true;
          return;
      }
      // 缓存命中：数据引用相同 + 年/季度相同 → 跳过
      const cache = metricsCacheRef.current;
      if (cache && cache.dataRef === dataRef.current && cache.year === selectedYear && cache.quarter === selectedQuarter) {
          return;
      }
      recalculateMetrics(dataRef.current, selectedYear, selectedQuarter);
      metricsCacheRef.current = { dataRef: dataRef.current, year: selectedYear, quarter: selectedQuarter };
  }, [activeTab, selectedYear, selectedQuarter]);

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

  const dashboardBillingKey = useMemo(() => {
      if (!data) return '';
      const projectId = cloudConfig.projectId || data.tenants?.[0]?.projectId || '';
      return [
          projectId,
          billingSelectedMonth,
          selectedYear,
          data.cloudSaveVersion ?? 0,
          data.tenants?.length ?? 0,
          data.payments?.length ?? 0,
          data.buildings?.length ?? 0,
          data.budgetAssumptions?.length ?? 0,
          data.budgetAdjustments?.length ?? 0,
          data.budgetScenarios?.length ?? 0,
          Object.keys(data.billingPeriodNotes || {}).length,
      ].join('|');
  }, [data, cloudConfig.projectId, billingSelectedMonth, selectedYear]);

  useEffect(() => {
      if (activeTab !== 'dashboard' || !showDashboardBillingTable || !data) return;
      let cancelled = false;
      const key = dashboardBillingKey;
      setDashboardBillingState((prev) => ({
          key,
          rows: prev.key === key ? prev.rows : [],
          loading: true,
      }));
      const compute = () => {
          try {
              const [yearPart, monthPart] = billingSelectedMonth.split('-');
              const year = Number.parseInt(yearPart, 10) || selectedYear;
              const month = Math.max(0, (Number.parseInt(monthPart, 10) || 1) - 1);
              const rows = buildBillingDetailsForPeriodService(year, month, data, getOrCreateBillingCacheFor(data));
              if (!cancelled) {
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
      activeTab,
      showDashboardBillingTable,
      data,
      dashboardBillingKey,
      billingSelectedMonth,
      selectedYear,
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

  const switchProject = async (projectId: string) => {
      const targetProjectId = projectId.trim();
      if (!targetProjectId || targetProjectId === cloudConfig.projectId) return;
      if (authUser && !isGlobalAdmin(authUser) && !authUser.allowedProjectIds.includes(targetProjectId)) {
          alert('当前账号未被授权访问该园区。');
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
      dirtyTrackerRef.current.reset();
      setPendingConflicts([]);
      try {
          const cachedPromise = parkDataGet(getParkStorageKey(targetProjectId));
          const snapshotPromise = fetchCloudKpiSnapshot(nextConfig, selectedYear).catch(() => null);
          const backupPromise = fetchCloudBackup(nextConfig, targetProjectId);

          const cached = await cachedPromise;
          let cachedData: DashboardData | null = null;
          if (cached) {
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
                  setData(cachedData!);
              });
          }

          const snapshotRes = await snapshotPromise;
          const hasSnapshotPreview = !!(snapshotRes?.success && snapshotRes.snapshot);
          if (!cachedData && snapshotRes?.success && snapshotRes.snapshot && isLatestSwitch()) {
              isKpiPreviewRef.current = true;
              React.startTransition(() => {
                  setData(buildDashboardDataFromKpiSnapshot(snapshotRes.snapshot!));
              });
          }
          const res = await backupPromise;
          if (!isLatestSwitch()) return;
          if (res.success && res.data) {
              const safeCloudData = { ...generateInitialData(), ...res.data };
              const displayData = cachedData
                  ? mergeLocalDashboardCacheIntoCloud(safeCloudData, cachedData).data
                  : safeCloudData;
              captureBaselineFromCloud(safeCloudData, res.recordMeta, targetProjectId);
              if (hasMeaningfulDashboardPayload(safeCloudData)) {
                  const processed = await recalculateMetrics(displayData, selectedYear, selectedQuarter, isLatestSwitch);
                  if (!isLatestSwitch()) return;
                  parkDataPutObj(getParkStorageKey(targetProjectId), processed);
              } else if (cached) {
                  await recalculateMetrics(cachedData || generateInitialData(), selectedYear, selectedQuarter, isLatestSwitch);
              } else {
                  await recalculateMetrics(displayData, selectedYear, selectedQuarter, isLatestSwitch);
              }
          } else if (cachedData) {
              await recalculateMetrics(cachedData, selectedYear, selectedQuarter, isLatestSwitch);
          } else {
              await recalculateMetrics(generateInitialData(), selectedYear, selectedQuarter, isLatestSwitch);
          }
          if (isLatestSwitch()) {
              await fetchCloudHistory(nextConfig);
          }
      } catch (e) {
          if (!isLatestSwitch()) return;
          console.error('[App] 切换园区失败:', e);
          alert('切换园区失败，请检查网络或权限。');
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
          const backupPromise = fetchCloudBackup(authedConfig, projectId);
          const snapshotRes = await snapshotPromise;
          const hasSnapshotPreview = !!(snapshotRes?.success && snapshotRes.snapshot);
          if (snapshotRes?.success && snapshotRes.snapshot) {
              isKpiPreviewRef.current = true;
              setData(buildDashboardDataFromKpiSnapshot(snapshotRes.snapshot));
          }
          const backupRes = await backupPromise;
          if (backupRes.success && backupRes.data) {
              const safeCloudData = { ...generateInitialData(), ...backupRes.data };
              const cachedRaw = localStorage.getItem(getParkStorageKey(projectId));
              const cachedData = cachedRaw
                  ? scopeCachedDashboardData(
                        { ...generateInitialData(), ...JSON.parse(cachedRaw) },
                        loginUser,
                        projectId,
                    )
                  : null;
              const displayData = cachedData
                  ? mergeLocalDashboardCacheIntoCloud(safeCloudData, cachedData).data
                  : safeCloudData;
              captureBaselineFromCloud(safeCloudData, backupRes.recordMeta, projectId);
              if (hasMeaningfulDashboardPayload(safeCloudData)) {
                  const processed = await recalculateMetrics(displayData, selectedYear, selectedQuarter);
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
                  recalculateMetrics(cachedData, selectedYear, selectedQuarter);
              } else {
                  recalculateMetrics(generateInitialData(), selectedYear, selectedQuarter);
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
      dirtyTrackerRef.current.reset();
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
      alert('密码已更新');
  };

  const displayUserName = authUser?.name?.trim() || authUser?.email || '用户';

  const fetchCloudHistory = async (config = cloudConfig) => {
      setIsLoadingHistory(true);
      const res = await getCloudHistory(config);
      setIsLoadingHistory(false);
      if (res.success && res.data) setCloudHistory(res.data);
      return res;
  };

  /** 保存成功后把本地记录的云端版本号与服务器对齐 */
  const applyCloudSaveSuccess = (current: DashboardData, res: SaveToCloudResult) => {
      if (typeof res.newVersion === 'number' && Number.isFinite(res.newVersion)) {
          recalculateMetrics({ ...current, cloudSaveVersion: res.newVersion });
      } else {
          recalculateMetrics(current);
      }
  };

  /** 版本冲突：提示用户并可选从 PocketBase 重新拉取 */
  const handleCloudSaveConflict = async (): Promise<boolean> => {
      if (
          !window.confirm(
              '云端数据已被他人更新（或您在其他窗口已保存过）。\n\n若继续保留当前界面上的编辑，请先不要保存；建议点击「确定」放弃当前未同步的修改，并从服务器加载最新数据。\n\n确定要加载最新数据吗？'
          )
      ) {
          return false;
      }
      const res = await fetchCloudBackup(cloudConfig, cloudConfig.projectId || '');
      if (res.success && res.data) {
          const safeData = { ...generateInitialData(), ...res.data };
          recalculateMetrics(safeData, selectedYear, selectedQuarter);
          captureBaselineFromCloud(safeData, res.recordMeta);
          alert('已加载服务器上的最新数据，版本号已更新。您可在此基础上继续编辑。');
          return true;
      }
      alert('加载最新数据失败：' + (res.message || '未知错误'));
      return false;
  };

  const openSnapshotModal = () => {
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
  const captureBaselineFromCloud = (cloudData: DashboardData, meta?: RecordMeta, projectId = cloudConfig.projectId) => {
      if (meta) setRecordMeta(meta);
      try {
          baselineSnapshotRef.current = dashboardDataToPbRecords(
              cloudData,
              projectId || ''
          );
      } catch (e) {
          console.warn('[captureBaselineFromCloud] 生成 baseline 失败，后续保存将要求先刷新云端数据', e);
          baselineSnapshotRef.current = null;
      }
      dirtyTrackerRef.current.reset();
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
  };

  /**
   * 保存成功后刷新基线。
   *
   * - 自动保存路径：增量更新 baselineSnapshot + recordMeta（不拉全量）
   * - 手动/全量路径：拉取云端最新数据重建基线
   * - KPI 快照：每 10 次保存或手动保存时才上传
   */
  const fullRefreshCounterRef = React.useRef(0);
  const kpiSnapshotDebounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshAfterSave = async (currentData: DashboardData | null, applied?: IncrementalApplied[]) => {
      const snapshotProjectId = (cloudConfig.projectId || '').trim();

      // 增量路径：用 applied 更新 baseline/recordMeta（无需全量拉取）
      if (applied && applied.length > 0) {
          applyPartialIncrementalSave(applied, currentData || data!, snapshotProjectId);
      }

      // KPI 快照：debounce 上传（仅手动保存或每 10 次自动保存触发）
      const isManualSave = !applied && currentData;
      fullRefreshCounterRef.current++;
      const shouldUploadSnapshot = isManualSave || fullRefreshCounterRef.current % 10 === 0;

      // KPI 快照已收敛为服务端 compute/refresh 单一作者，前端不再上传到 pb_kpi_snapshots
      if (snapshotProjectId && currentData && shouldUploadSnapshot) {
          try {
              const { processedData: fullMetrics, fullYearMonthlyTrends: fullTrends } =
                  calculateDashboardMetricsService(currentData, {
                      year: selectedYear,
                      quarter: 'All',
                      billingSelectedMonth,
                      quickMode: false,
                  });
              const fullSnapshot = buildIntegrationFullSnapshotV1(fullMetrics, fullTrends, {
                  statsYear: selectedYear,
                  projectId: snapshotProjectId,
              });
              scheduleUpsertIntegrationFullSnapshot(snapshotProjectId, fullSnapshot);
              // upsertCloudKpiSnapshot 已删除 —— KPI 快照唯一作者是服务端 compute/refresh
          } catch (e) {
              console.warn('[refreshAfterSave] 快照构建失败（可忽略）', e);
          }
      }

      // 全量拉取校准：仅手动保存或每 10 次自动保存
      if (shouldUploadSnapshot) {
          fetchCloudBackup(cloudConfig, cloudConfig.projectId || '').then(res => {
              if (res.success && res.data) {
                  const safeData = { ...generateInitialData(), ...res.data };
                  captureBaselineFromCloud(safeData, res.recordMeta);
              } else if (res.recordMeta) {
                  setRecordMeta(res.recordMeta);
                  dirtyTrackerRef.current.reset();
              }
          }).catch(e => {
              console.warn('[refreshAfterSave] 后台拉取最新数据失败（可忽略）', e);
          });
      }

      // 通知服务端重算 KPI 快照
      if (shouldUploadSnapshot) {
          triggerServerComputeRefresh(cloudConfig, selectedYear);
      }
  };

  /** 通知集成网关重新计算并回写 KPI 快照（fire-and-forget，不阻塞保存流程） */
  const triggerServerComputeRefresh = (config: CloudConfig, year: number) => {
      const projectId = (config.projectId || '').trim();
      if (!projectId) return;
      const internalToken = getIntegrationInternalToken();
      if (!internalToken) {
          console.warn('[compute/refresh] 未配置 VITE_INTEGRATION_INTERNAL_TOKEN，跳过服务端 KPI 重算');
          return;
      }
      const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'X-Integration-Internal-Token': internalToken,
      };
      fetch(getIntegrationComputeRefreshUrl(), {
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
      // 保存互斥：等待获取锁（自动保存会先释放）
      const manualRelease = await acquireSaveLock();
      try {
      let baseline = baselineSnapshotRef.current;
      let baseRecordMeta = recordMeta;

      if (!baseline) {
          try {
              const baselineRes = await fetchCloudBackup(cloudConfig, cloudConfig.projectId || '');
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
              setRecordMeta(baseRecordMeta);
              dirtyTrackerRef.current.reset();
          } catch (baselineError: any) {
              return {
                  ok: false,
                  message: `当前页面缺少云端基线，且读取后端数据失败，已阻止全量覆盖保存。请确认 PocketBase 连接正常后重试。\n\n错误：${baselineError?.message || '未知错误'}`,
              };
          }
      }

      // ---- 增量保存（自动 diff baseline ↔ current）----
      const nextSnapshot = dashboardDataToPbRecords(currentData, cloudConfig.projectId || '');
      const scopedSnapshot = preserveRentFieldsInTenantPbMap(
          nextSnapshot,
          baseline,
          authUser,
      );
      let payload = diffPbRecords(baseline, scopedSnapshot, baseRecordMeta);
      payload = filterDirtyPayloadForRentMaskedUser(payload, authUser);
      const summary = payloadCount(payload);

      if (summary.total === 0) {
          // 没有任何改动 —— 不打扰服务器，直接成功
          console.log('[runCloudSave] 无改动，跳过保存');
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
          if (!confirm(detailLines.join("\n"))) {
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
      if (res.applied.length > 0 && (res.errors.length > 0 || res.conflicts.length > 0)) {
          applyPartialIncrementalSave(res.applied, currentData, projectId);
      }
      if (res.conflicts.length > 0) {
          setPendingConflicts(res.conflicts);
          await refreshAfterSave(currentData);
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
      // 全部成功 —— bump 一下 dashboard_data_version 用于审计
      try {
          const v = await bumpCloudSaveVersion(cloudConfig);
          if (typeof v === 'number') {
              applyCloudSaveSuccess(currentData, { success: true, message: '', newVersion: v });
          }
      } catch (e) {
          console.warn('[App] 版本号递增失败（非关键）:', e);
      }
      await refreshAfterSave(currentData);
      return { ok: true, message: res.message };
      } finally {
          manualRelease();
      }
  };

  const confirmCloudSave = async () => {
      if (!data) return;
      if (!operatorName.trim()) {
          alert("请填写操作人员姓名");
          return;
      }
      setIsSyncing(true);
      setIsSnapshotModalOpen(false);
      const timestamp = new Date().toLocaleString();
      const finalNote = `${operatorName} ${timestamp} ${snapshotNote ? `(${snapshotNote})` : ''}`;
      const res = await runCloudSave(data, finalNote);
      setIsSyncing(false);
      if (res.ok) {
          alert("✅ 云端备份成功！");
          fetchCloudHistory();
      } else if (res.conflict) {
          // 增量保存的冲突已经被 runCloudSave 写入 pendingConflicts；
          // 旧整包覆写的 conflict 仍走原弹窗
          if ((res.conflictCount || 0) === 0) {
              await handleCloudSaveConflict();
          } else {
              alert(`检测到 ${res.conflictCount} 条冲突，请在冲突弹窗中处理。`);
          }
      } else {
          alertCloudSaveResult(res);
      }
  };

  const handleSaveBudgetToCloud = async (scenarioName: string, operator: string) => {
      if (!data) return;
      setIsSyncing(true);
      const timestamp = new Date().toLocaleString();
      const finalNote = `[预算方案] ${operator} ${timestamp} - ${scenarioName}`;
      const res = await runCloudSave(data, finalNote);
      setIsSyncing(false);
      if (res.ok) {
          alert("✅ 预算方案已保存至云端！");
      } else if (res.conflict) {
          if ((res.conflictCount || 0) === 0) {
              await handleCloudSaveConflict();
          } else {
              alert(`检测到 ${res.conflictCount} 条冲突，请在冲突弹窗中处理。`);
          }
      } else {
          alertCloudSaveResult(res);
      }
  };

  const handleQuickCloudSave = async () => {
      if (!isCloudConnected) {
          if (confirm("后端未连接。是否前往系统设置？")) {
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
      if (!isCloudConnected) {
          alert('未连接 PocketBase。请到「系统与备份」填写地址并点击「保存配置」。');
          setActiveTab(canAccessSystemSettings ? 'settings' : 'initData');
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
          alertCloudSaveResult(res);
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
          if (!d.conflict.localChanges) {
              // delete 类型的"用我的值" → 仍然要执行删除（暂未单独实现强制 delete API）
              console.warn('[handleResolveConflict] 强制删除尚未实现，跳过', d.conflict);
              continue;
          }
          const overwriteRes = await forceOverwriteCloudRecord(
              cloudConfig,
              d.conflict.collection,
              d.conflict.originalId,
              d.conflict.localChanges
          );
          if (!overwriteRes.success) {
              const label =
                  d.conflict.collection === 'pb_billing_period_notes'
                      ? '账期备注'
                      : d.conflict.collection;
              overwriteFailures.push(
                  `${label}/${d.conflict.originalId}: ${overwriteRes.message || '未知错误'}`
              );
          }
      }
      // 「用服务端值」 → 不需要写入服务端，但本地需要刷新数据
      void acceptServer;

      if (overwriteFailures.length > 0) {
          alert(
              `以下冲突未能成功覆盖到服务端，本地数据已保留，请稍后重试：\n\n${overwriteFailures.join('\n')}`
          );
          return;
      }

      // 用户处理完所有冲突 → 清空冲突列表 + 重新拉取
      setPendingConflicts([]);
      const res = await fetchCloudBackup(cloudConfig, cloudConfig.projectId || '');
      if (res.success && res.data) {
          const safeData = { ...generateInitialData(), ...res.data };
          recalculateMetrics(safeData, selectedYear, selectedQuarter);
          captureBaselineFromCloud(safeData, res.recordMeta);
      }
  };

  const handleConfirmRestoreLatest = async () => {
      if (!latestBackup) return;
      setIsSyncing(true);
      try {
          const res = await fetchCloudBackup(cloudConfig, latestBackup.id);
          if (res.success && res.data) {
              const safeData = { ...generateInitialData(), ...res.data };
              recalculateMetrics(safeData, selectedYear, selectedQuarter);
              captureBaselineFromCloud(safeData, res.recordMeta);
              parkDataPutObj(getParkStorageKey(cloudConfig.projectId), safeData);
              setShowRestorePrompt(false);
              // alert("✅ 系统已同步至最新云端版本");
          } else {
              alert("同步失败: " + res.message);
          }
      } catch (e) {
          console.error(e);
          alert("同步过程中发生错误");
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
        } else alert("下载失败: " + res.message);
      } catch (e) {
          alert("下载过程中发生意外错误");
      } finally {
          setRestoringId(null);
      }
  };

  const handleRestoreCloudBackup = async (backupId: string) => {
      if (!window.confirm("⚠️ 警告：覆盖操作\n\n确定要将此历史备份恢复到当前系统吗？\n当前本地的所有数据将被此备份完全覆盖且无法撤销。\n\n恢复后页面将自动刷新。")) return;
      setRestoringId(backupId);
      await new Promise(resolve => setTimeout(resolve, 500));
      try {
          const res = await fetchCloudBackup(cloudConfig, backupId);
          if (res.success && res.data) {
              const safeData = { ...generateInitialData(), ...res.data };
              parkDataPutObj(getParkStorageKey(cloudConfig.projectId), safeData);
              alert("✅ 恢复成功！系统正在刷新...");
              window.location.reload();
          } else alert("恢复失败: " + res.message);
      } catch (e) {
          alert("恢复过程中发生未知错误");
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
    };
    const myReq = ++metricsReqSeqRef.current;
    let processedData: DashboardData;
    try {
        if (isMetricsWorkerAvailable()) {
            processedData = (await computeMetricsInWorker(metricsInput, options)).processedData;
        } else {
            processedData = calculateDashboardMetricsService(metricsInput, options).processedData;
        }
    } catch {
        // Worker 出错 → 同步兜底，保证一定有结果
        processedData = calculateDashboardMetricsService(metricsInput, options).processedData;
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
        setData(processedData);
    }
    return processedData;
  };

  const reconcileTenantAreasWithBuildings = (newBuildings: Building[], tenants: Tenant[]): Tenant[] =>
      tenants.map(t => {
          let newTotalArea = 0;
          t.unitIds.forEach(uid => { for (const b of newBuildings) { const unit = b.units.find(u => u.id === uid); if (unit) { newTotalArea += unit.area; break; } } });
          newTotalArea = parseFloat(newTotalArea.toFixed(2));
          if (Math.abs(newTotalArea - t.totalArea) < 0.01) return t;
          let price = t.unitPrice;
          if ((price === undefined || price === 0) && t.totalArea > 0) { price = (t.monthlyRent * 12) / (t.totalArea * 365); }
          price = price || 0;
          const newMonthlyRent = Math.round(price * (365 / 12) * newTotalArea * 100) / 100;
          return { ...t, totalArea: newTotalArea, monthlyRent: newMonthlyRent, unitPrice: price };
      });

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
      const mergedData = { ...data, ...cleanUpdates };
      recalculateMetrics(mergedData);
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

  const handleDeferPayment = (tenantId: string, fromYear: number, fromMonth: number, toYear: number, toMonth: number) => {
      if (!data) return;
      const tenant = data.tenants.find((t) => t.id === tenantId);
      if (!tenant) return;
      if (fromYear === toYear && fromMonth === toMonth) {
          alert('目标账期不能与原账期相同。');
          return;
      }

      const details = buildBillingDetailsForPeriodService(fromYear, fromMonth, data, getOrCreateBillingCacheFor(data));
      const row = details.find((d) => d.tenantId === tenantId);
      const amountToDefer = Math.max(0, (row?.amountDue ?? 0) - (row?.amountPaid ?? 0));

      if (amountToDefer <= 0) {
          alert('该月份无可缓缴应收（已结清、已暂缓或待收余额为 0）。');
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
      alert(
          `已申请缓缴（仅影响应收/执行视图，不修改预算表基准）。\n客户: ${tenant.name}\n金额: ${formatCurrency(amountToDefer)}\n原账期: ${fromLabel}\n调整至: ${toLabel}`
      );
  };

  /** 撤销单条缓缴（调入行消失，金额回到原账期应收） */
  const handleRevokeDeferBillingNote = (noteKey: string) => {
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
      if (
          !window.confirm(
              `确定撤销该笔缓缴？调入账期行将删除，金额回到原账期（不影响收款明细已有流水；若曾核销本调入行，请核对关联账期）。${summary}`,
          )
      ) {
          return;
      }
      const { next, removed } = removeDeferBillingNoteByKey(data.billingPeriodNotes, noteKey);
      if (!removed) {
          alert('未找到对应的缓缴记录，可能已被撤销或键无效。');
          return;
      }
      recalculateMetrics({ ...data, billingPeriodNotes: next });
  };

  /** 应收核销：一键撤回全部缓缴 + 本界面生成的核销流水（不误删收款明细手工记账） */
  const handleResetReceivableApplications = () => {
      if (!data) return;
      const { next: nextNotes, removed: deferRemoved } = removeDeferBillingNotesFromNotes(data.billingPeriodNotes || {});
      const { kept: nextPayments, removedCount: payRemoved } = partitionPaymentsRemovingAutoReceivableWriteOffs(
          data.payments || [],
      );
      if (deferRemoved === 0 && payRemoved === 0) {
          alert(
              '当前没有可撤回的缓缴记录，也没有通过「应收核销」收款或批量核销生成的租金流水（「收款明细」中的手工记账不受影响）。',
          );
          return;
      }
      if (
          !window.confirm(
              `确定一键撤回以下操作？此操作不可撤销。\n\n` +
                  `· 清除全部缓缴申请：${deferRemoved} 条（所有账期）\n` +
                  `· 删除应收核销自动生成的收款流水：${payRemoved} 笔（单笔收款、批量核销）\n\n` +
                  `不含「收款明细」手工录入的流水；跟进备注、预算与合同数据不会改变。`,
          )
      ) {
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
  const updateBudgetAnalysis = (newAnalysis: BudgetAnalysisData) => { if (!data) return; recalculateMetrics({ ...data, budgetAnalysis: newAnalysis }); };
  const updateInvoices = (newInvoices: InvoiceRecord[]) => { if (!data) return; recalculateMetrics({ ...data, invoices: newInvoices }); };

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
  
  const handleResetData = () => { if (window.confirm("危险操作！\n\n确定要清空当前园区的本地缓存并恢复出厂设置吗？所有未保存至后端的本地修改都将丢失。")) { localStorage.removeItem(getParkStorageKey(cloudConfig.projectId)); const initial = generateInitialData(); recalculateMetrics(initial, currentYear, 'All'); alert("当前园区本地缓存已重置。"); } };

  const getCurrentParkName = () => {
      return authorizedParks.find(park => park.projectId === cloudConfig.projectId)?.name || cloudConfig.projectId;
  };

  const handleExport = () => {
      if (!data) return;
      const projectId = (cloudConfig.projectId || '').trim();
      if (!projectId) {
          alert('当前未选择园区，不能导出备份。');
          return;
      }
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
              const parsed = parseDashboardBackup(raw);
              const validation = validateBackupTarget(parsed, targetProjectId, allowedProjectIds);
              if (!validation.ok) {
                  alert(validation.message);
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

              if (!window.confirm(confirmText)) return;

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
              dirtyTrackerRef.current.reset();
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
              const budgetRestoreNote = restoredBudgetYears.length > 0
                  ? `\n\n已按备份内 effectiveBudgetTables 回填预算执行目标：${Array.from(new Set(restoredBudgetYears)).sort((a, b) => a - b).join('、')} 年。`
                  : '';
              alert(canSaveIncrementally
                  ? `数据已恢复到当前园区本地状态，并已建立云端增量保存基线。请检查无误后点击右上角「保存」写入后端。${budgetRestoreNote}`
                  : `数据已恢复到当前园区本地状态，但暂未读取到云端保存基线。请先确认后端连接正常，再刷新/重新登录后保存。${budgetRestoreNote}`
              );
          } catch (err: any) {
              alert(`解析或校验备份失败：${err?.message || '未知错误'}`);
          }
      };
      reader.readAsText(file);
  };

  const handleYearChange = (year: number) => {
      setSelectedYear(year);
      if (data) recalculateMetrics(data, year, selectedQuarter);
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
          alert('仅平台管理员可新增登录人员。');
          return;
      }
      if (!newUserForm.email.trim() || !newUserForm.password.trim() || !newUserForm.projectId.trim()) {
          alert('请填写邮箱、初始密码和默认园区。');
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
          alert(`新增失败：${res.message || '未知错误'}`);
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
      alert(newUserForm.enabled ? '登录人员已新增并启用。' : '登录人员已新增，等待管理员审批启用。');
  };

  const handleApproveManagedUser = async (user: ManagedUserAccount, enabled: boolean) => {
      if (!isPlatformAdmin()) {
          alert('仅平台管理员可审批登录人员。');
          return;
      }
      const res = await updateManagedCloudUserEnabled(user.id, enabled);
      if (!res.success) {
          alert(`操作失败：${res.message || '未知错误'}`);
          return;
      }
      await loadManagedUsers();
  };

  const handleApproveSignupRequest = async (req: SignupRequestRecord) => {
      if (!isPlatformAdmin()) {
          alert('仅平台管理员可审批注册申请。');
          return;
      }
      const res = await approveCloudSignupRequest(req.id);
      if (!res.success) {
          alert(`审批失败：${res.message || '未知错误'}`);
          return;
      }
      await Promise.all([loadSignupRequests(), loadManagedUsers()]);
      alert(res.message || '审批完成，申请人账号已可登录。');
  };

  const handleRejectSignupRequest = async (req: SignupRequestRecord) => {
      if (!isPlatformAdmin()) {
          alert('仅平台管理员可退回注册申请。');
          return;
      }
      const note = window.prompt(
          `请输入退回「${req.email}」的原因（可留空）：`,
          '申请园区或账号信息不符合要求'
      );
      if (note === null) return;
      const res = await rejectCloudSignupRequest(req.id, note.trim());
      if (!res.success) {
          alert(`退回失败：${res.message || '未知错误'}`);
          return;
      }
      await loadSignupRequests();
      alert(res.message || '已退回注册申请');
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
          alert('请填写默认园区 project_id');
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
          alert(res.message || '保存失败');
          return;
      }
      setUserManageTarget(null);
      await Promise.all([loadManagedUsers(), loadSignupRequests()]);
      alert('已保存');
  };

  const handleDeleteUserManageModal = async () => {
      if (!userManageTarget || !isPlatformAdmin()) return;
      if (!window.confirm(`确定删除登录账号「${userManageTarget.email}」？此操作不可恢复。`)) return;
      setUserManageSaving(true);
      const res = await deleteManagedCloudUser(userManageTarget.id, authUser?.id);
      setUserManageSaving(false);
      if (!res.success) {
          alert(res.message || '删除失败');
          return;
      }
      setUserManageTarget(null);
      await Promise.all([loadManagedUsers(), loadSignupRequests()]);
      alert(res.message || '已删除账号');
  };

  const handleDeleteSignupRequest = async (req: SignupRequestRecord) => {
      if (!isPlatformAdmin()) {
          alert('仅平台管理员可清理审批记录。');
          return;
      }
      if (!window.confirm(`确认清理审批记录「${req.email}」？\n注意：此操作仅删除审批/申请记录，不影响已创建账号的登录状态。`)) {
          return;
      }
      const res = await deleteCloudSignupRequest(req.id);
      if (!res.success) {
          alert(res.message || '清理失败');
          return;
      }
      await loadSignupRequests();
      alert(res.message || '已清理审批记录');
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
      if (!authUser) return [];
      const enabledParks = authorizedParks.filter((park) => park.enabled);
      if (isGlobalAdmin(authUser)) return enabledParks;
      const allowedProjectIds = authUser.allowedProjectIds.length
          ? authUser.allowedProjectIds
          : [authUser.projectId];
      const allowedSet = new Set(allowedProjectIds.filter(Boolean));
      return enabledParks.filter((park) => allowedSet.has(park.projectId));
  }, [authorizedParks, authUser]);

  useEffect(() => {
      if (!mobileNavLayout || !authUser) return;
      if (!isGlobalAdmin(authUser)) {
          setMobileKpiScope(cloudConfig.projectId || authUser.projectId || '');
      } else if (!mobileKpiScope) {
          setMobileKpiScope(MOBILE_TOTAL_SCOPE);
      }
  }, [mobileNavLayout, authUser?.id, authUser?.role, cloudConfig.projectId, mobileKpiScope]);

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

                  if (snapshot) {
                      console.warn('[mobile-kpi] 快照过期，已触发服务端重算，暂不展示旧 KPI', {
                          projectId: park.projectId,
                          snapshotVersion: snapshot.dataVersion,
                          serverVersion,
                          year: targetYear,
                      });
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
  }, [mobileNavLayout, authUser?.id, authUser?.role, selectedYear, cloudConfig.pocketbaseUrl, cloudConfig.projectId, mobileAuthorizedParks]);

  const mobileCurrentParkKpi = useMemo(() => {
      if (!data) return null;
      return buildMobileParkKpiFromDashboard(
          data,
          selectedYear,
          cloudConfig.projectId || data.tenants?.[0]?.projectId || '',
          getCurrentParkName()
      );
  }, [data, selectedYear, cloudConfig.projectId, authorizedParks]);

  const mobileParkKpis = useMemo(() => {
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
  }, [mobileAuthorizedParks, mobileCurrentParkKpi, cloudConfig.projectId, mobileParkSnapshotMap, selectedYear]);

  const mobileTotalParkKpi = useMemo(() => buildMobileTotalParkKpi(mobileParkKpis), [mobileParkKpis]);

  const mobileManagerParkKpis = useMemo(() => {
      if (!isGlobalAdmin()) return mobileParkKpis;
      return [mobileTotalParkKpi, ...mobileParkKpis];
  }, [mobileParkKpis, mobileTotalParkKpi, authUser?.role]);

  const mobileSelectedManagerKpi = useMemo(() => {
      if (!isParkManagerOrAbove()) return mobileCurrentParkKpi || undefined;
      if (isGlobalAdmin()) {
          if (mobileKpiScope === MOBILE_TOTAL_SCOPE) return mobileTotalParkKpi;
          return mobileParkKpis.find((item) => item.projectId === mobileKpiScope) || mobileTotalParkKpi;
      }
      return (
          mobileParkKpis.find((item) => item.projectId === (mobileKpiScope || cloudConfig.projectId)) ||
          mobileCurrentParkKpi ||
          undefined
      );
  }, [mobileKpiScope, mobileTotalParkKpi, mobileParkKpis, mobileCurrentParkKpi, cloudConfig.projectId, authUser?.role]);

  useEffect(() => {
      if (!canAccessSystemSettings && activeTab === 'settings') {
          setActiveTab('dashboard');
      }
  }, [canAccessSystemSettings, activeTab]);

  useEffect(() => {
      if (!mobileNavLayout) return;
      setSidebarOpen(false);
      if (
          activeTab === 'buildings' ||
          activeTab === 'budget' ||
          activeTab === 'initData' ||
          activeTab === 'settings'
      ) {
          setActiveTab('dashboard');
      }
      if (activeTab === 'finance' && isParkManagerOrAbove()) {
          setActiveTab('dashboard');
          setMobileDashboardMode('search');
      }
  }, [mobileNavLayout, activeTab, authUser?.role]);

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

  const annualComparisonData: AnnualComparisonData[] = useMemo(() => {
      if (!data) return [];

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
  }, [data, selectedYear, cloudConfig.projectId]);

  const dashboardBillingError =
      dashboardBillingState.key === dashboardBillingKey ? dashboardBillingState.error : undefined;
  const dashboardBillingReady =
      dashboardBillingState.key === dashboardBillingKey &&
      !dashboardBillingState.loading &&
      !dashboardBillingError;
  const dashboardBillingData = useMemo(() => {
      if (!data) return null;
      return {
          ...data,
          currentMonthBilling: dashboardBillingReady ? dashboardBillingState.rows : [],
      };
  }, [data, dashboardBillingReady, dashboardBillingState.rows]);

  const mobileSearchResults = useMemo<MobileTenantSearchResult[]>(() => {
      if (!data) return [];
      const normalizedQuery = mobileSearchQuery.trim().toLowerCase();
      const statusRank: Record<ContractStatus, number> = {
          [ContractStatus.Active]: 0,
          [ContractStatus.Expiring]: 1,
          [ContractStatus.Pending]: 2,
          [ContractStatus.Expired]: 3,
          [ContractStatus.Terminated]: 4,
      };
      const findUnitName = (unitId: string) => {
          for (const building of data.buildings || []) {
              const unit = building.units.find((item) => item.id === unitId);
              if (unit) return unit.name;
          }
          return unitId;
      };
      const rankedTenants = [...(data.tenants || [])].sort((a, b) => {
          const rankDiff = (statusRank[a.status] ?? 9) - (statusRank[b.status] ?? 9);
          if (rankDiff !== 0) return rankDiff;
          return (a.leaseEnd || '').localeCompare(b.leaseEnd || '');
      });
      return rankedTenants
          .filter((tenant) => {
              if (!normalizedQuery) return tenant.status !== ContractStatus.Terminated;
              const buildingName = (data.buildings || []).find((building) => building.id === tenant.buildingId)?.name || '';
              const unitText = (tenant.unitIds || []).map(findUnitName).join(' ');
              return [
                  tenant.name,
                  tenant.contactName,
                  tenant.legalRepName,
                  tenant.contactInfo,
                  tenant.industry,
                  buildingName,
                  unitText,
              ]
                  .filter(Boolean)
                  .some((value) => String(value).toLowerCase().includes(normalizedQuery));
          })
          .slice(0, 4)
          .map((tenant) => {
              const buildingName = (data.buildings || []).find((building) => building.id === tenant.buildingId)?.name || '';
              const unitNames = (tenant.unitIds || []).map(findUnitName).slice(0, 2);
              const location = [buildingName, unitNames.join('/')].filter(Boolean).join(' · ') || formatArea(tenant.totalArea || 0);
              const tenantPayments = (data.payments || [])
                  .filter((payment) =>
                      payment.status === 'Received' &&
                      (payment.tenantId === tenant.id || payment.tenantName === tenant.name)
                  )
                  .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
              const paymentTotal = tenantPayments.reduce((sum, payment) => sum + (payment.amount || 0), 0);
              const latestPaymentDate = tenantPayments[0]?.date;
              const paymentSummary = paymentTotal > 0
                  ? `已收 ${formatWan(paymentTotal, 1)}${latestPaymentDate ? ` · 最近 ${latestPaymentDate}` : ''}`
                  : '暂无收款记录';
              const helper = tenant.contactName
                  ? `联系人 ${tenant.contactName}`
                  : tenant.leaseEnd
                    ? `租期至 ${tenant.leaseEnd}`
                    : tenant.industry || '暂无联系人';
              return {
                  id: tenant.id,
                  name: tenant.name,
                  location,
                  statusLabel: contractStatusText(tenant.status),
                  helper,
                  paymentSummary,
              };
          });
  }, [data, mobileSearchQuery]);

  if (!bootReady) {
      return (
          <div className="min-h-screen flex items-center justify-center bg-slate-50">
              <div className="flex flex-col items-center gap-2">
                  <Loader2 size={32} className="text-blue-500 animate-spin" />
                  <div className="text-slate-400">正在连接后端…</div>
              </div>
          </div>
      );
  }

  if (!authUser) {
      return (
          <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
              <form onSubmit={authMode === 'login' ? handleLogin : handleSignupSubmit} className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-200 p-6 space-y-5">
                  <div>
                      <h1 className="text-xl font-bold text-slate-800 text-center">金蝶招商管理系统</h1>
                  </div>

                  <div className="grid grid-cols-2 rounded-lg bg-slate-100 p-1">
                      <button type="button" onClick={() => { setAuthMode('login'); setSignupMsg(null); }} className={`py-1.5 rounded text-sm font-medium ${authMode === 'login' ? 'bg-white shadow-sm text-sky-700' : 'text-slate-500'}`}>登录</button>
                      <button type="button" onClick={() => { setAuthMode('register'); setLoginError(null); }} className={`py-1.5 rounded text-sm font-medium ${authMode === 'register' ? 'bg-white shadow-sm text-sky-700' : 'text-slate-500'}`}>注册申请</button>
                  </div>

                  <div className="space-y-3">
                      <div>
                          <label className="block text-xs font-medium text-slate-500 mb-1">邮箱</label>
                          <input
                              type="email"
                              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-100 focus:border-sky-300"
                              value={authMode === 'login' ? loginForm.email : signupForm.email}
                              onChange={e => authMode === 'login' ? setLoginForm({ ...loginForm, email: e.target.value }) : setSignupForm(prev => ({ ...prev, email: e.target.value }))}
                              placeholder="user@example.com"
                              autoComplete={authMode === 'login' ? 'username' : 'email'}
                          />
                      </div>
                      {authMode === 'register' && (
                          <div>
                              <label className="block text-xs font-medium text-slate-500 mb-1">姓名</label>
                              <input
                                  type="text"
                                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-100 focus:border-sky-300"
                                  value={signupForm.applicantName}
                                  onChange={(e) => setSignupForm((prev) => ({ ...prev, applicantName: e.target.value }))}
                                  placeholder="真实姓名"
                                  autoComplete="name"
                              />
                          </div>
                      )}
                      <div>
                          <label className="block text-xs font-medium text-slate-500 mb-1">密码</label>
                          <input
                              type="password"
                              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-100 focus:border-sky-300"
                              value={authMode === 'login' ? loginForm.password : signupForm.password}
                              onChange={e => authMode === 'login' ? setLoginForm({ ...loginForm, password: e.target.value }) : setSignupForm(prev => ({ ...prev, password: e.target.value }))}
                              placeholder="请输入密码"
                              autoComplete={authMode === 'login' ? 'current-password' : 'new-password'}
                          />
                      </div>
                      {authMode === 'register' && (
                          <div>
                              <div className="block text-xs font-medium text-slate-500 mb-2">申请园区（可多选）</div>
                              <div className="max-h-36 overflow-y-auto bg-slate-50 border border-slate-200 rounded-lg p-2 space-y-1">
                                  {isLoadingPublicParks ? (
                                      <div className="text-xs text-slate-500 px-2 py-1">正在加载园区...</div>
                                  ) : publicParks.length === 0 ? (
                                      <div className="text-xs text-slate-500 px-2 py-1">暂无可选园区，请联系管理员</div>
                                  ) : (
                                      publicParks.map(park => {
                                          const checked = signupForm.requestedProjectIds.includes(park.projectId);
                                          return (
                                              <label key={park.projectId} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-white text-sm text-slate-700">
                                                  <input
                                                      type="checkbox"
                                                      checked={checked}
                                                      onChange={(e) => {
                                                          const nextIds = e.target.checked
                                                              ? Array.from(new Set([...signupForm.requestedProjectIds, park.projectId]))
                                                              : signupForm.requestedProjectIds.filter(pid => pid !== park.projectId);
                                                          setSignupForm(prev => ({ ...prev, requestedProjectIds: nextIds }));
                                                      }}
                                                  />
                                                  <span>{park.name} ({park.projectId})</span>
                                              </label>
                                          );
                                      })
                                  )}
                              </div>
                          </div>
                      )}
                  </div>

                  {loginError && (
                      <div className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">
                          {loginError}
                      </div>
                  )}
                  {signupMsg && (
                      <div className={`text-sm rounded-lg px-3 py-2 border ${signupMsg.includes('失败') || signupMsg.includes('请') ? 'text-rose-600 bg-rose-50 border-rose-100' : 'text-emerald-700 bg-emerald-50 border-emerald-100'}`}>
                          {signupMsg}
                      </div>
                  )}

                  <button
                      type="submit"
                      disabled={authMode === 'login' ? isLoggingIn : isSubmittingSignup}
                      className="w-full bg-sky-600 text-white rounded-lg py-2.5 font-medium hover:bg-sky-700 disabled:opacity-60 flex items-center justify-center gap-2"
                  >
                      {(authMode === 'login' ? isLoggingIn : isSubmittingSignup) ? <Loader2 size={16} className="animate-spin" /> : <Cloud size={16} />}
                      {authMode === 'login' ? '登录并加载园区数据' : '提交注册申请'}
                  </button>
              </form>
          </div>
      );
  }

  if (!data) {
      return (
          <div className="min-h-screen flex items-center justify-center bg-slate-50">
              <div className="flex flex-col items-center gap-2">
                  <Loader2 size={32} className="text-blue-500 animate-spin" />
                  <div className="text-slate-400">Loading Dashboard...</div>
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
  const isManagerMobileView = isParkManagerOrAbove();
  const managerMobileNav = mobileNavLayout && isManagerMobileView;
  const goMobileOverview = () => {
      setActiveTab('dashboard');
      setMobileDashboardMode('overview');
      setSidebarOpen(false);
  };
  const goMobileContracts = () => {
      setActiveTab('contracts');
      setMobileDashboardMode('overview');
      setSidebarOpen(false);
  };
  const goMobileFinance = () => {
      if (managerMobileNav) {
          setActiveTab('dashboard');
          setMobileDashboardMode('search');
          setSidebarOpen(false);
          return;
      }
      setActiveTab('finance');
      setMobileDashboardMode('overview');
      setSidebarOpen(false);
  };
  const goMobileSearch = () => {
      setActiveTab('dashboard');
      setMobileDashboardMode('search');
      setSidebarOpen(false);
  };
  const handleMobileKpiScopeChange = (scope: string) => {
      React.startTransition(() => {
          setMobileKpiScope(scope);
          setActiveTab('dashboard');
          setMobileDashboardMode('overview');
          setSidebarOpen(false);
      });
      if (projectSwitchTimerRef.current) {
          clearTimeout(projectSwitchTimerRef.current);
          projectSwitchTimerRef.current = null;
      }
      if (scope !== MOBILE_TOTAL_SCOPE) {
          projectSwitchTimerRef.current = setTimeout(() => {
              projectSwitchTimerRef.current = null;
              void switchProject(scope);
          }, PROJECT_SWITCH_DEBOUNCE_MS);
      }
  };
  const mobileBottomNavItems = managerMobileNav ? [
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
  ];

  return (
    <DirtyTrackerProvider recordMeta={recordMeta} tracker={dirtyTrackerRef.current}>
    <div className="min-h-screen bg-gradient-to-b from-sky-50 via-slate-50 to-emerald-50 md:bg-none md:bg-slate-50 flex font-sans text-slate-900">
      <div className={`fixed inset-0 bg-black/50 z-30 lg:hidden transition-opacity duration-300 ${isSidebarOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} onClick={() => setSidebarOpen(false)} />
      
      <aside className={`fixed inset-y-0 left-0 z-40 bg-white border-r border-slate-200 transition-transform duration-300 flex flex-col h-screen shadow-xl w-64 ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0 lg:w-64'}`}>
        <div className="h-16 flex items-center justify-center border-b border-slate-100 bg-white z-10">
            <div className="flex items-center gap-2">
                <div className="flex flex-col">
                  <div className="flex items-center gap-1.5">
                      <span className="text-2xl font-bold italic text-sky-600 tracking-tight leading-none" style={{ fontFamily: 'sans-serif' }}>Kingdee</span>
                      <span className="text-[10px] font-bold text-sky-700 bg-sky-100 px-1.5 py-0.5 rounded-md leading-none border border-sky-200">V4.0</span>
                  </div>
                  <span className="text-[10px] text-slate-400 uppercase tracking-widest scale-90 origin-left">Software Park</span>
                </div>
            </div>
            <button onClick={() => setSidebarOpen(false)} className="absolute right-4 top-5 text-slate-400 lg:hidden"><X size={20}/></button>
        </div>

        <nav className="flex-1 py-3 space-y-0.5 overflow-y-auto scrollbar-hide">
          <SidebarItem icon={<LayoutDashboard size={22} />} label="工作台" isOpen={true} active={activeTab === 'dashboard' && (!mobileNavLayout || mobileDashboardMode === 'overview')} onClick={() => { setActiveTab('dashboard'); setMobileDashboardMode('overview'); if(window.innerWidth < 1024) setSidebarOpen(false); }} />
          {mobileNavLayout ? (
            managerMobileNav ? (
              <>
                <SidebarItem icon={<Users size={22} />} label="合同查询" isOpen={true} active={activeTab === 'contracts'} onClick={goMobileContracts} />
                <SidebarItem icon={<Search size={22} />} label="收款查询" isOpen={true} active={activeTab === 'dashboard' && mobileDashboardMode === 'search'} onClick={goMobileSearch} />
              </>
            ) : (
              <>
                <SidebarItem icon={<Users size={22} />} label="合同录入" isOpen={true} active={activeTab === 'contracts'} onClick={goMobileContracts} />
                <SidebarItem icon={<PieChart size={22} />} label="收款核销" isOpen={true} active={activeTab === 'finance'} onClick={goMobileFinance} />
                <SidebarItem icon={<Search size={22} />} label="快速查询" isOpen={true} active={activeTab === 'dashboard' && mobileDashboardMode === 'search'} onClick={goMobileSearch} />
              </>
            )
          ) : (
            <>
              <SidebarItem icon={<Building2 size={22} />} label="楼宇资管" isOpen={true} active={activeTab === 'buildings'} onClick={() => { setActiveTab('buildings'); if(window.innerWidth < 1024) setSidebarOpen(false); }} />
              <SidebarItem icon={<Users size={22} />} label="客户管理" isOpen={true} active={activeTab === 'contracts'} onClick={() => { setActiveTab('contracts'); if(window.innerWidth < 1024) setSidebarOpen(false); }} />
              <SidebarItem icon={<PieChart size={22} />} label="财务报表" isOpen={true} active={activeTab === 'finance'} onClick={() => { setActiveTab('finance'); if(window.innerWidth < 1024) setSidebarOpen(false); }} />
              <SidebarItem icon={<Calculator size={22} />} label="预算管理" isOpen={true} active={activeTab === 'budget'} onClick={() => { setActiveTab('budget'); if(window.innerWidth < 1024) setSidebarOpen(false); }} />
              <SidebarItem icon={<TableIcon size={22} />} label="初始化数据" isOpen={true} active={activeTab === 'initData'} onClick={() => { setActiveTab('initData'); if(window.innerWidth < 1024) setSidebarOpen(false); }} />
              <div className="my-2 h-px bg-slate-100 mx-4" />
              {canAccessSystemSettings && (
                <SidebarItem icon={<Settings size={22} />} label="系统与备份" isOpen={true} active={activeTab === 'settings'} onClick={() => { setActiveTab('settings'); if(window.innerWidth < 1024) setSidebarOpen(false); }} />
              )}
            </>
          )}
        </nav>
      </aside>

      <main className="flex-1 transition-all duration-300 w-full min-w-0 flex flex-col lg:pl-64">
        <header className="min-h-14 lg:min-h-16 bg-white border-b border-slate-200 sticky top-0 z-20 px-3 sm:px-4 py-2 lg:py-0 flex items-center justify-between gap-2 shadow-sm">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
            <button
              onClick={() => setSidebarOpen(true)}
              className={`p-2 -ml-2 hover:bg-slate-100 rounded-lg text-slate-600 lg:hidden shrink-0 ${mobileNavLayout ? 'hidden' : ''}`}
            >
              <Menu size={20} />
            </button>
            <h1 className="min-w-0 truncate text-base font-black text-slate-900 sm:text-base lg:text-xl">
              <span className="hidden sm:inline">{pageTitle}</span>
              <span className="sm:hidden">{mobilePageTitle}</span>
            </h1>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0 flex-wrap justify-end">
             <button
               type="button"
               onClick={openChangePasswordModal}
               className="hidden md:flex items-center gap-2 text-xs bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 hover:bg-slate-100 hover:border-slate-300 transition-colors cursor-pointer"
               title={`${displayUserName}${authUser.email ? ` · ${authUser.email}` : ''} · 点击修改密码`}
             >
                 <User size={14} className="text-slate-400" />
                 <span className="text-slate-600 max-w-[120px] truncate">{displayUserName}</span>
             </button>
             {isGlobalAdmin() && authorizedParks.length > 1 ? (
               <div className="hidden sm:flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1" title="切换授权园区">
                 {authorizedParks.map(park => (
                   <button
                     key={park.projectId}
                     type="button"
                     onClick={() => switchProject(park.projectId)}
                     disabled={isSyncing || park.projectId === cloudConfig.projectId}
                     className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                       park.projectId === cloudConfig.projectId
                         ? 'bg-sky-600 text-white shadow-sm ring-1 ring-sky-500'
                         : 'text-slate-600 hover:bg-white hover:text-sky-700'
                     } disabled:cursor-default`}
                   >
                     {park.name}
                   </button>
                 ))}
               </div>
             ) : (
               <span className="hidden sm:inline-flex text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5">
                 {currentParkDisplayName}
               </span>
             )}
             <button
               type="button"
               onClick={handleSaveToBackend}
               disabled={!data || isSyncing}
               className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
               title={lastSaved ? `上次本地缓存 ${lastSaved}` : '保存到 PocketBase'}
             >
               {isSyncing ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
               <span className="hidden sm:inline">保存</span>
             </button>
             {activeTab === 'dashboard' && (
               <button 
                 onClick={() => setAIDialogOpen(true)}
                 className="hidden md:flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-lg hover:from-blue-700 hover:to-indigo-700 transition-all shadow-md hover:shadow-lg font-medium text-sm"
               >
                 <Sparkles size={16} />
                 <span>AI 智能助手</span>
               </button>
             )}
             <div className={`hidden md:flex items-center gap-1 text-xs px-2 py-1 rounded-full border ${isCloudConnected ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-50 text-slate-500 border-slate-200'}`} title={isCloudConnected ? '已连接 PocketBase 后端' : '未连接后端，仅本地缓存'}>
                 {isCloudConnected ? <CheckCircle2 size={12} className="text-emerald-500"/> : <Cloud size={12} />}
                 <span>{isCloudConnected ? '后端在线' : '仅本地'}</span>
             </div>
             <button
               type="button"
               onClick={handleLogout}
               className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg"
               title="退出登录"
             >
               <LogOut size={16} />
             </button>
          </div>
        </header>

        <div className="mx-auto w-full max-w-7xl min-w-0 px-3 pb-20 pt-3 md:px-6 md:pb-24 md:pt-6 lg:p-6">
          {activeTab === 'dashboard' && (
            <div className="space-y-4 md:space-y-6">
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
                  managerKpi={mobileSelectedManagerKpi}
                  managerParkKpis={mobileManagerParkKpis}
                  managerKpiScope={mobileKpiScope}
                  isLoadingManagerKpis={isLoadingMobileParkKpis}
                  searchQuery={mobileSearchQuery}
                  searchResults={mobileSearchResults}
                  onSearchQueryChange={setMobileSearchQuery}
                  onYearChange={handleYearChange}
                  onGoContracts={goMobileContracts}
                  onGoFinance={goMobileFinance}
                  onGoSearch={goMobileSearch}
                  onBackToOverview={goMobileOverview}
                  onManagerKpiScopeChange={handleMobileKpiScopeChange}
               />
               <div className="hidden space-y-6 md:block">
                   <DashboardAlerts tenants={data.tenants} invoices={data.invoices} />
                   <div className="hidden md:flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between bg-white p-3 rounded-xl border border-slate-100 shadow-sm min-w-0">
                       <div className="flex items-center gap-2 min-w-0">
                           <Calendar className="text-blue-500 shrink-0" size={18}/>
                           <span className="font-bold text-slate-700 text-sm md:text-base truncate">统计年度: {selectedYear}</span>
                       </div>
                       <div className="flex items-center justify-center sm:justify-end bg-slate-50 rounded-lg p-1 border border-slate-200 shrink-0 self-stretch sm:self-auto">
                           <button onClick={() => handleYearChange(selectedYear - 1)} className="p-1.5 hover:bg-white hover:shadow-sm rounded transition-all text-slate-600"><ChevronLeft size={16}/></button>
                           <span className="px-3 font-mono font-medium text-slate-800">{selectedYear}</span>
                           <button onClick={() => handleYearChange(selectedYear + 1)} className="p-1.5 hover:bg-white hover:shadow-sm rounded transition-all text-slate-600"><ChevronRight size={16}/></button>
                       </div>
                   </div>

                   <StatsCards
                      data={data}
                      selectedYear={selectedYear}
                      onEditTargets={openTargetModal}
                      tenants={data.tenants}
                      projectId={cloudConfig.projectId}
                      authUser={authUser}
                   />
                   <AnnualMetricComparisonTable
                      data={annualComparisonData}
                      showManagementFee={isManagementFeeBillingEnabled(cloudConfig.projectId || data.tenants?.[0]?.projectId)}
                   />
                   <RecentActivityTable data={data} />
                   {showDashboardBillingTable && dashboardBillingReady && dashboardBillingData ? (
                       <BillingTable
                          data={dashboardBillingData}
                          selectedMonth={billingSelectedMonth}
                          onMonthChange={setBillingSelectedMonth}
                          onUpdateRentRemark={updateRentCollectionRemark}
                          projectId={cloudConfig.projectId}
                          authUser={authUser}
                       />
                   ) : dashboardBillingError ? (
                       <div className="bg-white rounded-xl shadow-sm border border-rose-100 p-8 text-center text-sm text-rose-500">
                           账单明细计算失败：{dashboardBillingError}
                       </div>
                   ) : (
                       <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-8 text-center text-sm text-slate-400">
                           账单明细加载中…
                       </div>
                   )}
               </div>
            </div>
          )}

          {activeTab === 'buildings' && (
            <Suspense fallback={<LazyPanelFallback />}>
              <div className="animate-in fade-in zoom-in-50 duration-300"><BuildingManager buildings={data.buildings} tenants={data.tenants} parkAreaMetrics={parkAreaMetricsFromDashboard(data)} onUpdateBuildings={updateBuildings} onCommitBuildingsTenants={commitBuildingsTenants} /></div>
            </Suspense>
          )}
          {activeTab === 'contracts' && (
            <Suspense fallback={<LazyPanelFallback />}>
              <div className="animate-in fade-in zoom-in-50 duration-300"><ContractManager tenants={data.tenants} buildings={data.buildings} onUpdateTenants={updateTenants} dashboardData={data} payments={data.payments} onUpdatePayments={updatePayments} budgetAdjustments={data.budgetAdjustments} onUpdateAdjustments={updateBudgetAdjustments} mobileEntryMode={mobileNavLayout} mobileQueryOnly={managerMobileNav} authUser={authUser} projectId={cloudConfig.projectId} /></div>
            </Suspense>
          )}
          {activeTab === 'finance' && (
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
                      getBillingDetails={(year: number, month: number) => buildBillingDetailsForPeriodService(year, month, data, getOrCreateBillingCacheFor(data))}
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
                  />
              </div>
            </Suspense>
          )}
          {activeTab === 'budget' && (
            <Suspense fallback={<LazyPanelFallback />}>
              <div className="animate-in fade-in zoom-in-50 duration-300"><BudgetManager buildings={data.buildings} tenants={data.tenants} budgetAssumptions={data.budgetAssumptions} onUpdateAssumptions={updateBudgetAssumptions} budgetAdjustments={data.budgetAdjustments} onUpdateAdjustments={updateBudgetAdjustments} budgetAnalysis={data.budgetAnalysis} onUpdateAnalysis={updateBudgetAnalysis} payments={data.payments} scenarios={data.budgetScenarios || []} onUpdateScenarios={updateBudgetScenarios} onRenameScenario={handleRenameScenario} onActivateScenario={handleActivateScenario} onSaveBudgetToCloud={handleSaveBudgetToCloud} initializationData={data.initializationData} billingPeriodNotes={data.billingPeriodNotes} onBatchUpdate={handleBatchUpdate} /></div>
            </Suspense>
          )}
          {activeTab === 'initData' && (
            <div className="animate-in fade-in zoom-in-50 duration-300 max-w-2xl mx-auto space-y-4">
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    <div className="p-4 md:p-6 border-b border-slate-200"><h2 className="text-lg md:text-xl font-bold text-slate-800 flex items-center gap-2"><TableIcon className="text-indigo-500" /> 初始化数据</h2></div>
                    <div className="p-4 md:p-6 border-b border-slate-200 bg-indigo-50/30">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="p-2 bg-white rounded-lg text-indigo-600 shadow-sm border border-indigo-100"><TableIcon size={24} /></div>
                            <div>
                                <h3 className="font-bold text-slate-700">系统初始化数据 (2023-2026)</h3>
                                <div className="text-sm text-slate-500 mt-1">手动录入历史年初预算、实收及出租率数据，用于看板展示；当某月「年初预算」大于 0 时，首页「预算执行」该月预算收款优先取此值，为 0 时回退到预算表/生效方案。2025年12月支持录入累计欠款。</div>
                            </div>
                        </div>
                        <div className="bg-white p-4 rounded-lg border border-slate-200">
                            <button onClick={openInitDataModal} className="w-full py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium flex items-center justify-center gap-2">
                                <FileInput size={16} /> 录入/编辑 初始化数据
                            </button>
                        </div>
                    </div>
                    <TenantBudgetNameLinkTool
                        tenants={data.tenants}
                        billingPeriodNotes={data.billingPeriodNotes}
                        onBatchUpdate={handleBatchUpdate}
                    />
                </div>
            </div>
          )}
          {activeTab === 'settings' && (
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
                      if (
                          !window.confirm(
                              `确定删除登录账号「${u.email}」？\n该账号将无法登录，关联申请记录也会一并清理。`
                          )
                      ) {
                          return;
                      }
                      void (async () => {
                          const res = await deleteManagedCloudUser(u.id, authUser?.id);
                          if (!res.success) {
                              alert(res.message || '删除失败');
                              return;
                          }
                          await Promise.all([loadManagedUsers(), loadSignupRequests()]);
                          alert(res.message || '已删除账号');
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
                      alert('配置已保存！请刷新页面使配置生效。');
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
        <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 px-2 pb-[calc(env(safe-area-inset-bottom)+0.3rem)] pt-1 shadow-[0_-8px_24px_rgba(15,23,42,0.08)] backdrop-blur lg:hidden">
          <div className={`mx-auto grid max-w-md gap-1 ${mobileBottomNavItems.length === 3 ? 'grid-cols-3' : 'grid-cols-4'}`}>
            {mobileBottomNavItems.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={item.onClick}
                className={`mobile-pressable flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-xl text-[11px] font-black ${
                  item.active
                    ? 'bg-gradient-to-r from-sky-500 to-emerald-400 text-white shadow-lg shadow-sky-300/30'
                    : 'text-slate-500 hover:bg-sky-50 hover:text-sky-700'
                }`}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        </nav>
      )}

      <AssistantPanel isOpen={isAssistantOpen} onClose={() => setAssistantOpen(false)} data={data} />
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
          <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4">
              <form
                  onSubmit={(e) => void handleChangePasswordSubmit(e)}
                  className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl"
              >
                  <div className="mb-4 flex items-start justify-between gap-2">
                      <div>
                          <h4 className="text-sm font-bold text-slate-800">修改密码</h4>
                          <p className="mt-0.5 text-xs text-slate-500">
                              {displayUserName}
                              {authUser.email ? ` · ${authUser.email}` : ''}
                          </p>
                      </div>
                      <button
                          type="button"
                          aria-label="关闭"
                          className="rounded p-1 text-slate-500 hover:bg-slate-100"
                          onClick={closeChangePasswordModal}
                          disabled={changePasswordSaving}
                      >
                          <X size={18} />
                      </button>
                  </div>
                  <div className="space-y-3">
                      <div>
                          <label className="mb-1 block text-xs font-medium text-slate-600">当前密码</label>
                          <input
                              type="password"
                              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                              value={changePasswordForm.oldPassword}
                              onChange={(e) => setChangePasswordForm((prev) => ({ ...prev, oldPassword: e.target.value }))}
                              autoComplete="current-password"
                              disabled={changePasswordSaving}
                          />
                      </div>
                      <div>
                          <label className="mb-1 block text-xs font-medium text-slate-600">新密码</label>
                          <input
                              type="password"
                              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                              value={changePasswordForm.newPassword}
                              onChange={(e) => setChangePasswordForm((prev) => ({ ...prev, newPassword: e.target.value }))}
                              placeholder="至少 8 位"
                              autoComplete="new-password"
                              disabled={changePasswordSaving}
                          />
                      </div>
                      <div>
                          <label className="mb-1 block text-xs font-medium text-slate-600">确认新密码</label>
                          <input
                              type="password"
                              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                              value={changePasswordForm.confirmPassword}
                              onChange={(e) => setChangePasswordForm((prev) => ({ ...prev, confirmPassword: e.target.value }))}
                              autoComplete="new-password"
                              disabled={changePasswordSaving}
                          />
                      </div>
                      {changePasswordError && (
                          <div className="rounded-lg border border-rose-100 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                              {changePasswordError}
                          </div>
                      )}
                  </div>
                  <div className="mt-5 flex justify-end gap-2">
                      <button
                          type="button"
                          onClick={closeChangePasswordModal}
                          disabled={changePasswordSaving}
                          className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                      >
                          取消
                      </button>
                      <button
                          type="submit"
                          disabled={changePasswordSaving}
                          className="rounded-lg bg-sky-600 px-3 py-2 text-sm text-white hover:bg-sky-700 disabled:opacity-50"
                      >
                          {changePasswordSaving ? '保存中…' : '保存'}
                      </button>
                  </div>
              </form>
          </div>
      )}
      
      {isTargetModalOpen && data && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
              <div className="bg-white rounded-xl shadow-xl w-full max-sm p-6 animate-in zoom-in-50 duration-200">
                  <h3 className="text-lg font-bold mb-4 text-slate-800">设定 {selectedYear}年度 {targetModalType === 'revenue' ? '营收' : '出租率'}目标</h3>
                  <div className="space-y-4">
                      {targetModalType === 'revenue' ? (
                          <p className="text-sm text-slate-600">年度营收目标已停用，请在「初始化数据」维护各月年初目标；看板「营收达成」将自动按初始化数据合计。</p>
                      ) : (
                          <div><label className="block text-sm text-slate-600 mb-1">年度出租率目标 (%)</label><input type="number" className="w-full border rounded-lg p-2 text-lg font-semibold" value={targetForm.occupancy} onChange={e => setTargetForm({...targetForm, occupancy: Number(e.target.value)})} /></div>
                      )}
                      <div className="space-y-1">
                        <label className="block text-sm text-slate-600">年初目标</label>
                        <div className="w-full border border-slate-200 rounded-lg p-2 text-lg font-semibold bg-slate-50 text-slate-800">
                          {formatCurrency(
                              resolveAnnualInitialBudget(
                                  data.yearlyTargets,
                                  data.initializationData,
                                  selectedYear,
                                  data.tenants?.[0]?.projectId || cloudConfig.projectId
                              )
                          )}
                        </div>
                        <p className="text-xs text-slate-400">
                          自动汇总「初始化数据」中 {selectedYear} 年各月年初预算，不可在此修改。请前往「初始化数据」维护。
                        </p>
                      </div>
                      <div className="flex justify-end gap-2 pt-2"><button onClick={() => setIsTargetModalOpen(false)} className="px-4 py-2 border rounded-lg text-slate-600 hover:bg-slate-50">取消</button><button onClick={saveTargets} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">保存</button></div>
                  </div>
              </div>
          </div>
      )}

      {isSnapshotModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
              <div className="bg-white rounded-xl shadow-xl w-full max-sm p-6 animate-in zoom-in-50 duration-200">
                  <div className="flex justify-between items-center mb-4"><h3 className="text-lg font-bold text-slate-800">保存到云端</h3><button onClick={() => setIsSnapshotModalOpen(false)}><X size={20} className="text-slate-400 hover:text-slate-600"/></button></div>
                  <div className="space-y-4">
                      <div><label className="block text-sm font-medium text-slate-700 mb-1">操作人员 (必填) <span className="text-red-500">*</span></label><div className="relative"><User size={14} className="absolute left-3 top-3 text-slate-400"/><input type="text" className="w-full border rounded-lg pl-9 pr-3 py-2 text-sm focus:ring-2 focus:ring-sky-100 outline-none border-slate-200" placeholder="请输入您的姓名" value={operatorName} onChange={e => setOperatorName(e.target.value)}/></div></div>
                      <div><label className="block text-sm font-medium text-slate-700 mb-1">备份备注 (选填)</label><input type="text" className="w-full border rounded-lg p-2 text-sm border-slate-200" placeholder="例如: 10月份月结后备份" value={snapshotNote} onChange={e => setSnapshotNote(e.target.value)}/></div>
                      <div className="bg-sky-50 p-3 rounded-lg text-xs text-sky-700 flex items-start gap-2"><Info size={14} className="mt-0.5 flex-shrink-0" /><p>保存后，系统将生成带时间戳的历史版本，您可以在“系统与备份”中随时查看或恢复。</p></div>
                      <div className="flex justify-end gap-2 pt-2"><button onClick={() => setIsSnapshotModalOpen(false)} className="px-4 py-2 border rounded text-slate-600 hover:bg-slate-50">取消</button><button onClick={confirmCloudSave} disabled={!operatorName.trim()} className="px-4 py-2 bg-sky-600 text-white rounded-lg hover:bg-sky-700 flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed">{isSyncing ? <Loader2 size={14} className="animate-spin" /> : <CloudUpload size={14} />} 确认保存</button></div>
                  </div>
              </div>
          </div>
      )}

      {/* Auto Restore Prompt Modal */}
      {showRestorePrompt && latestBackup && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-300">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 relative overflow-hidden">
                  <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 to-indigo-600"></div>
                  <div className="flex justify-between items-start mb-4">
                      <div className="flex items-center gap-3">
                          <div className="p-2 bg-blue-100 text-blue-600 rounded-full">
                              <CloudUpload size={24} />
                          </div>
                          <div>
                              <h3 className="text-lg font-bold text-slate-800">发现云端备份</h3>
                              <p className="text-xs text-slate-500">检测到可用的云端数据存档</p>
                          </div>
                      </div>
                      <button onClick={() => setShowRestorePrompt(false)} className="text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-100 transition-colors">
                          <X size={20} />
                      </button>
                  </div>
                  
                  <div className="bg-slate-50 rounded-xl p-4 mb-6 border border-slate-100">
                      <div className="flex justify-between items-center mb-2">
                          <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">最新备份信息</span>
                          <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">Latest</span>
                      </div>
                      <div className="text-sm font-medium text-slate-800 mb-1">{latestBackup.note || '无备注信息'}</div>
                      <div className="flex items-center gap-1 text-xs text-slate-500">
                          <FileClock size={12} />
                          {new Date(latestBackup.created_at).toLocaleString()}
                      </div>
                  </div>

                  <p className="text-sm text-slate-600 mb-6 leading-relaxed">
                      是否立即将此备份恢复到当前系统？<br/>
                      <span className="text-xs text-orange-500">注意：这将覆盖当前本地的所有临时修改。</span>
                  </p>

                  <div className="flex gap-3">
                      <button 
                          onClick={() => setShowRestorePrompt(false)} 
                          className="flex-1 py-2.5 border border-slate-300 text-slate-700 rounded-xl font-medium hover:bg-slate-50 transition-colors text-sm"
                      >
                          暂不恢复
                      </button>
                      <button 
                          onClick={handleConfirmRestoreLatest} 
                          disabled={isSyncing}
                          className="flex-1 py-2.5 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-colors shadow-lg shadow-blue-200 text-sm flex items-center justify-center gap-2"
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
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
              <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl p-6 animate-in zoom-in-50 duration-200 flex flex-col max-h-[90vh]">
                  <div className="flex justify-between items-center mb-6 pb-4 border-b border-slate-100">
                      <div className="flex items-center gap-4 flex-wrap">
                          <h3 className="text-xl font-bold text-slate-800">系统数据初始化录入</h3>
                          <div className="flex bg-slate-100 rounded-lg p-1">
                              <button onClick={() => handleInitYearChange(2023)} className={`px-4 py-1.5 rounded-md text-sm font-bold transition-all ${initDataYear === 2023 ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}>2023年</button>
                              <button onClick={() => handleInitYearChange(2024)} className={`px-4 py-1.5 rounded-md text-sm font-bold transition-all ${initDataYear === 2024 ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}>2024年</button>
                              <button onClick={() => handleInitYearChange(2025)} className={`px-4 py-1.5 rounded-md text-sm font-bold transition-all ${initDataYear === 2025 ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}>2025年</button>
                              <button onClick={() => handleInitYearChange(2026)} className={`px-4 py-1.5 rounded-md text-sm font-bold transition-all ${initDataYear === 2026 ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}>2026年</button>
                          </div>
                          <button
                              onClick={() => {
                                  if (!data) return;
                                  const activeScenario = (data.budgetScenarios || []).find(s => s.isActive && (s.budgetYear || new Date().getFullYear()) === initDataYear);
                                  if (!activeScenario) { alert(`未找到 ${initDataYear} 年的生效预算方案，请先在预算管理中激活方案。`); return; }
                                  // 使用预算方案快照中的租户/楼宇数据（与仪表盘口径一致）
                                  const snapshotTenants = activeScenario.baseDataSnapshot?.tenants || data.tenants || [];
                                  const snapshotBuildings = activeScenario.baseDataSnapshot?.buildings || data.buildings || [];
                                  const assumptions = activeScenario.assumptions || [];
                                  const adjustments = activeScenario.adjustments || [];
                                  const virtualTenants = getVirtualTenants(snapshotTenants, snapshotBuildings, assumptions);
                                  const allTenants = [...snapshotTenants, ...virtualTenants];
                                  // 按月汇总，填入 tempInitData
                                  const updated = tempInitData.map(row => ({ ...row }));
                                  for (let m = 1; m <= 12; m++) {
                                      const monthStart = new Date(initDataYear, m - 1, 1);
                                      const monthEnd = new Date(initDataYear, m, 0);
                                      let monthTotal = 0;
                                      allTenants.forEach(t => {
                                          if (t.isSpecialBusiness) return;
                                          const bills = generateBudgetedBills(t, assumptions, adjustments, new Date(initDataYear - 1, 0, 1), new Date(initDataYear + 1, 11, 31));
                                          bills.forEach(b => {
                                              if (b.date >= monthStart && b.date <= monthEnd) monthTotal += b.amount;
                                          });
                                      });
                                      const entry = updated.find(r => r.month === m);
                                      if (entry) entry.initialBudget = Math.round(monthTotal);
                                  }
                                  setTempInitData(updated);
                              }}
                              className="px-3 py-1.5 bg-amber-100 text-amber-700 rounded-lg text-xs hover:bg-amber-200 whitespace-nowrap font-medium"
                          >
                              从生效预算方案导入年初预算
                          </button>
                      </div>
                      <button onClick={() => setIsInitDataModalOpen(false)}><X size={24} className="text-slate-400 hover:text-slate-600"/></button>
                  </div>

                  <div className="flex-1 overflow-y-auto">
                      <table className="w-full text-sm text-left">
                          <thead className="bg-slate-50 text-slate-600 font-bold">
                              <tr>
                                  <th className="p-4 border-b border-slate-200 w-20">月份</th>
                                  <th className="p-4 border-b border-slate-200 bg-amber-50/50">年初预算 (￥)</th>
                                  <th className="p-4 border-b border-slate-200">月度实收 (Actual Revenue)</th>
                                  <th className="p-4 border-b border-slate-200">月末出租率 (%)</th>
                                  {initDataYear === 2025 && (
                                      <th className="p-4 border-b border-slate-200 bg-amber-50">累计欠款 (￥)</th>
                                  )}
                              </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                              {tempInitData.map((row) => (
                                  <tr key={row.month} className="hover:bg-slate-50">
                                      <td className="p-4 font-bold text-slate-700 text-center">{row.month}月</td>
                                      <td className="p-4 bg-amber-50/20">
                                          <div className="relative">
                                              <span className="absolute left-3 top-2.5 text-amber-500 text-xs">¥</span>
                                              <input
                                                  type="number"
                                                  className="w-full pl-6 pr-3 py-2 border border-amber-200 rounded-lg focus:ring-2 focus:ring-amber-100 outline-none font-mono"
                                                  value={row.initialBudget || ''}
                                                  onChange={(e) => updateTempInitData(row.month, 'initialBudget', Number(e.target.value))}
                                                  placeholder="0.00"
                                              />
                                          </div>
                                      </td>
                                      <td className="p-4">
                                          <div className="relative">
                                              <span className="absolute left-3 top-2.5 text-slate-400 text-xs">¥</span>
                                              <input 
                                                  type="number" 
                                                  className="w-full pl-6 pr-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-100 outline-none font-mono"
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
                                                  className="w-full pl-3 pr-8 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-100 outline-none font-mono"
                                                  value={row.occupancyRate || ''}
                                                  onChange={(e) => updateTempInitData(row.month, 'occupancyRate', Number(e.target.value))}
                                                  placeholder="0.0"
                                                  step="0.1"
                                                  max="100"
                                              />
                                              <span className="absolute right-3 top-2.5 text-slate-400 text-xs">%</span>
                                          </div>
                                      </td>
                                      {initDataYear === 2025 && (
                                          <td className="p-4 bg-amber-50/30">
                                              <div className="relative">
                                                  <span className="absolute left-3 top-2.5 text-amber-600 text-xs">￥</span>
                                                  <input 
                                                      type="number" 
                                                      className="w-full pl-6 pr-3 py-2 border-2 border-amber-200 rounded-lg focus:ring-2 focus:ring-amber-200 outline-none font-mono bg-white"
                                                      value={row.accumulatedArrears || ''}
                                                      onChange={(e) => updateTempInitData(row.month, 'accumulatedArrears', Number(e.target.value))}
                                                      placeholder="只塢12月填写"
                                                      disabled={row.month !== 12}
                                                  />
                                                  {row.month === 12 && (
                                                      <div className="text-xs text-amber-600 mt-1">
                                                          2025年及之前累计欠款
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
                  
                  <div className="mt-6 pt-4 border-t border-slate-100 flex justify-between items-center">
                      <div className="text-xs text-slate-500 bg-blue-50 px-3 py-2 rounded-lg flex items-center gap-2">
                          <Info size={14} className="text-blue-500"/>
                          说明：录入的数据将 directly cover the corresponding indicators in the dashboard for that year.
                      </div>
                      <div className="flex gap-3">
                          <button onClick={() => setIsInitDataModalOpen(false)} className="px-6 py-2.5 border rounded-lg text-slate-600 hover:bg-slate-50 font-medium">取消</button>
                          <button onClick={saveInitData} className="px-8 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-bold shadow-md">保存配置</button>
                      </div>
                  </div>
              </div>
          </div>
      )}

      <ConflictDialog
        open={pendingConflicts.length > 0}
        conflicts={pendingConflicts}
        onClose={() => setPendingConflicts([])}
        onResolve={async (decisions) => {
            await handleResolveConflict(decisions);
        }}
      />
      {/* C2 外部写入感知：本地有未保存改动时检测到其他端更新，提示用户（保存后会自动同步远端） */}
      {remoteChangePending && (
        <div className="fixed bottom-4 right-4 z-50 max-w-sm bg-amber-50 border border-amber-300 text-amber-900 rounded-lg shadow-lg px-4 py-3 text-sm flex items-start gap-2 animate-in fade-in slide-in-from-bottom-2">
          <span className="mt-0.5">⚠️</span>
          <div className="flex-1">
            <div className="font-semibold">检测到其他端更新了数据</div>
            <div className="text-amber-700 mt-0.5">你有未保存的本地修改。保存后系统会做行级冲突校验并自动同步远端最新数据。</div>
          </div>
          <button onClick={() => setRemoteChangePending(false)} className="text-amber-500 hover:text-amber-700 shrink-0" title="忽略">✕</button>
        </div>
      )}
    </div>
    </DirtyTrackerProvider>
  );
};

export default App;
