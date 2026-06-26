/**
 * 计算引擎 —— 服务端运行与前端完全相同的计费/指标计算逻辑。
 *
 * 用途：
 *   - 集成网关 (integration-gateway) 调用本模块的函数，为 OpenClaw / 外部系统
 *     提供与前端看板口径完全一致的 KPI、应收明细、趋势数据。
 *   - 前端也可以调用（通过 API），避免浏览器重复跑计费引擎。
 *
 * 运行方式：npx tsx scripts/compute-engine.ts（或作为模块被 import）
 *
 * 环境变量：
 *   PB_URL         PocketBase 地址（默认 http://127.0.0.1:8090）
 *   PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD  管理员凭证
 */

import { initPocketBase, authenticatePocketBase, fetchPocketBaseBackup, readCloudSaveVersion } from '../services/pocketbaseService';
import type { RecordMeta } from '../services/pocketbaseService';
import {
    buildContractOnlyReceivableForPeriod,
    calculateDashboardMetrics,
    buildKpiSummaryFromProcessedData,
    createBillingCache,
    normalizeKpiSummaryWithMonthlyTrends,
    normalizeYearlyTargetsFromInitialization,
    type DashboardMetricOptions,
} from '../services/dashboardMetrics';
import { generateInitialData } from '../services/mockData';
import {
    normalizeReceivableRemaining,
    parsePaymentPeriodYYYYMMs,
    paymentTenantMatchesBillingTenant,
    receivableBudgetDisplay,
} from '../services/receivableListHelpers';
import { roundMoney2 } from '../services/numberFormat';
import { transitionContractStatuses } from '../services/sharedUtils';
import {
    generateBudgetedBills,
    type BudgetedBill,
    type GenerateBudgetedBillsOptions,
} from '../services/billingService';
import {
    computeSourceAgentMetrics,
    type SourceAnalysisPeriod,
    type SourceAnalysisSummary,
} from '../services/sourceAgentMetrics';
import {
    buildContractAnalysisMetrics,
    type ContractAnalysisMetrics,
    type ContractAnalysisPeriod,
} from '../services/contractAnalysisMetrics';
import {
    buildTenantHistoricalArrears,
    type TenantHistoricalArrearsSummary,
} from '../services/tenantHistoricalArrears';
import type { ReceivablePermission } from '../services/receivablePermissions';
import type {
    BudgetAdjustment,
    BudgetAssumption,
    BudgetScenario,
    Building,
    DashboardData,
    MonthlyInitData,
    MonthlyTrend,
    BillingDetail,
    PaymentRecord,
    Tenant,
} from '../types';
import type { KpiSnapshotSummary } from '../services/pocketbaseService';

// ── 配置 ──

const PB_URL = process.env.PB_URL || 'http://127.0.0.1:8090';
const ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL || '';
const ADMIN_PASSWORD = process.env.PB_ADMIN_PASSWORD || '';

let initialized = false;

const DEFAULT_COMPUTE_CACHE_TTL_MS = 30 * 60_000;
const BILLING_CACHE_TTL_MS = Math.max(0, Number(process.env.COMPUTE_BILLING_CACHE_TTL_MS || DEFAULT_COMPUTE_CACHE_TTL_MS));
const BILLING_CACHE_MAX_ENTRIES = Math.max(12, Number(process.env.COMPUTE_BILLING_CACHE_MAX_ENTRIES || 120));
const DASHBOARD_CACHE_TTL_MS = Math.max(0, Number(process.env.COMPUTE_DASHBOARD_CACHE_TTL_MS || DEFAULT_COMPUTE_CACHE_TTL_MS));
const DASHBOARD_CACHE_MAX_ENTRIES = Math.max(12, Number(process.env.COMPUTE_DASHBOARD_CACHE_MAX_ENTRIES || 60));
const COMPUTE_VERSION_CACHE_TTL_MS = Math.max(0, Number(process.env.COMPUTE_VERSION_CACHE_TTL_MS || 2_000));
const COMPUTE_VERSION_CACHE_MAX_ENTRIES = Math.max(6, Number(process.env.COMPUTE_VERSION_CACHE_MAX_ENTRIES || 24));

type BillingCacheEntry = {
    expiresAt: number;
    result: ComputeBillingResult;
};

type DashboardCacheEntry = {
    expiresAt: number;
    result: ComputeDashboardDataResult;
};

type ComputeVersionCacheEntry = {
    expiresAt: number;
    promise?: Promise<number>;
    version?: number;
};

const billingComputeCache = new Map<string, BillingCacheEntry>();
const dashboardComputeCache = new Map<string, DashboardCacheEntry>();
const computeVersionCache = new Map<string, ComputeVersionCacheEntry>();
let computeVersionCacheEpoch = 0;
const COMPUTE_CACHE_LOG_ENABLED = process.env.COMPUTE_CACHE_LOG_ENABLED !== '0';

const billingCacheKey = (
    projectId: string,
    year: number,
    month: number,
    version: number,
): string => `${projectId}|${year}|${month}|v${version}`;

const dashboardCacheKey = (
    projectId: string,
    year: number,
    quarter: DashboardMetricOptions['quarter'],
    billingSelectedMonth: string,
    quickMode: boolean | undefined,
    includeCurrentMonthBilling: boolean | undefined,
    includePrevYearTrends: boolean | undefined,
    loadScope: ComputeDashboardLoadScope,
    version: number,
): string => [
    projectId,
    year,
    quarter,
    billingSelectedMonth,
    quickMode ? 'quick' : 'full',
    includeCurrentMonthBilling ? 'with-billing' : 'without-billing',
    includePrevYearTrends === false ? 'without-prev-year' : 'with-prev-year',
    loadScope.kind === 'full' ? 'scope:full' : `scope:year:${loadScope.year}`,
    `v${version}`,
].join('|');

function logComputeCache(
    kind: 'dashboard' | 'billing',
    status: 'hit' | 'miss' | 'expired' | 'store' | 'skip',
    key: string,
): void {
    if (!COMPUTE_CACHE_LOG_ENABLED) return;
    console.info(`[compute-cache] ${kind} ${status}`, { key });
}

const cloneComputeBillingResult = (result: ComputeBillingResult): ComputeBillingResult => ({
    ...result,
    billingDetails: result.billingDetails.map((row) => ({ ...row })),
    financeSummary: result.financeSummary ? { ...result.financeSummary } : undefined,
});

const cloneJson = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const cloneComputeDashboardDataResult = (result: ComputeDashboardDataResult): ComputeDashboardDataResult => ({
    ...result,
    loadScope: { ...result.loadScope },
    processedData: cloneJson(result.processedData),
    baselineData: cloneJson(result.baselineData),
    recordMeta: result.recordMeta ? cloneJson(result.recordMeta) : undefined,
    fullYearMonthlyTrends: result.fullYearMonthlyTrends.map((row) => ({ ...row })),
});

export function clearComputeCaches(projectId?: string): void {
    if (!projectId) {
        billingComputeCache.clear();
        dashboardComputeCache.clear();
        computeVersionCache.clear();
        computeVersionCacheEpoch++;
        return;
    }
    const prefix = `${projectId}|`;
    for (const key of [...billingComputeCache.keys()]) {
        if (key.startsWith(prefix)) billingComputeCache.delete(key);
    }
    for (const key of [...dashboardComputeCache.keys()]) {
        if (key.startsWith(prefix)) dashboardComputeCache.delete(key);
    }
    computeVersionCache.delete(projectId);
    computeVersionCacheEpoch++;
}

function putBillingCache(key: string, result: ComputeBillingResult, version: number): void {
    if (BILLING_CACHE_TTL_MS <= 0 || version <= 0) return;
    billingComputeCache.set(key, {
        expiresAt: Date.now() + BILLING_CACHE_TTL_MS,
        result: cloneComputeBillingResult(result),
    });
    while (billingComputeCache.size > BILLING_CACHE_MAX_ENTRIES) {
        const first = billingComputeCache.keys().next().value;
        if (!first) break;
        billingComputeCache.delete(first);
    }
}

function putDashboardCache(key: string, result: ComputeDashboardDataResult, version: number): void {
    if (DASHBOARD_CACHE_TTL_MS <= 0 || version <= 0) return;
    dashboardComputeCache.set(key, {
        expiresAt: Date.now() + DASHBOARD_CACHE_TTL_MS,
        result: cloneComputeDashboardDataResult(result),
    });
    while (dashboardComputeCache.size > DASHBOARD_CACHE_MAX_ENTRIES) {
        const first = dashboardComputeCache.keys().next().value;
        if (!first) break;
        dashboardComputeCache.delete(first);
    }
}

function trimComputeVersionCache(): void {
    while (computeVersionCache.size > COMPUTE_VERSION_CACHE_MAX_ENTRIES) {
        const first = computeVersionCache.keys().next().value;
        if (!first) break;
        computeVersionCache.delete(first);
    }
}

export async function readComputeDataVersion(projectId: string): Promise<number> {
    if (!initialized) {
        await ensureInit();
    }
    if (COMPUTE_VERSION_CACHE_TTL_MS > 0) {
        const cached = computeVersionCache.get(projectId);
        if (cached && cached.expiresAt > Date.now()) {
            if (cached.promise) return cached.promise;
            if (typeof cached.version === 'number') return cached.version;
        }
        if (cached) computeVersionCache.delete(projectId);
    }

    try {
        const cacheEpoch = computeVersionCacheEpoch;
        const readPromise = readCloudSaveVersion(projectId)
            .then((version) => {
                const safeVersion = Number.isFinite(version) ? Math.max(0, Math.floor(version)) : 0;
                if (COMPUTE_VERSION_CACHE_TTL_MS > 0 && cacheEpoch === computeVersionCacheEpoch) {
                    computeVersionCache.set(projectId, {
                        version: safeVersion,
                        expiresAt: Date.now() + COMPUTE_VERSION_CACHE_TTL_MS,
                    });
                    trimComputeVersionCache();
                }
                return safeVersion;
            })
            .catch((e) => {
                if (cacheEpoch === computeVersionCacheEpoch) computeVersionCache.delete(projectId);
                throw e;
            });
        if (COMPUTE_VERSION_CACHE_TTL_MS > 0) {
            computeVersionCache.set(projectId, {
                promise: readPromise,
                expiresAt: Date.now() + COMPUTE_VERSION_CACHE_TTL_MS,
            });
            trimComputeVersionCache();
        }
        return await readPromise;
    } catch {
        return -1;
    }
}

/** 初始化 PocketBase 连接（幂等） */
export async function ensureInit(): Promise<void> {
    if (initialized) return;
    if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
        throw new Error('缺少 PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD 环境变量');
    }
    initPocketBase(PB_URL);
    await authenticatePocketBase(ADMIN_EMAIL, ADMIN_PASSWORD);
    initialized = true;
}

// ── 核心计算函数 ──

export interface ComputeKpiResult {
    ok: boolean;
    projectId: string;
    year: number;
    summary: KpiSnapshotSummary;
    monthlyTrends: MonthlyTrend[];
    fullYearTrends: MonthlyTrend[];
    computedAt: string;
    dataVersion: number;
    message?: string;
}

/** 为指定园区 + 年度计算完整 KPI（与前端 recalculateMetrics 口径一致） */
export async function computeKpi(
    projectId: string,
    year: number,
): Promise<ComputeKpiResult> {
    await ensureInit();

    const fetchRes = await fetchPocketBaseBackup(projectId, { year });
    if (!fetchRes.success || !fetchRes.data) {
        console.error('[compute-engine] fetchPocketBaseBackup failed:', fetchRes.message);
        return {
            ok: false,
            projectId,
            year,
            summary: {} as KpiSnapshotSummary,
            monthlyTrends: [],
            fullYearTrends: [],
            computedAt: new Date().toISOString(),
            dataVersion: 0,
            message: fetchRes.message || '无法拉取园区数据',
        };
    }

    const rawData = fetchRes.data;

    // 与 App.tsx 中 recalculateMetrics 调用完全一致
    const options: DashboardMetricOptions = {
        year,
        quarter: 'All',
        billingSelectedMonth: new Date().toISOString().slice(0, 7),
        includePrevYearTrends: false,
    };

    const { processedData, fullYearMonthlyTrends } = calculateDashboardMetrics(rawData, options);
    const summary = buildKpiSummaryFromProcessedData(processedData, year);
    const normalized = normalizeKpiSummaryWithMonthlyTrends(summary, fullYearMonthlyTrends);

    // 提取季度趋势（与前端 selectedQuarter='All' 一致）
    const monthlyTrends = fullYearMonthlyTrends.slice(0, 12);

    return {
        ok: true,
        projectId,
        year,
        summary: normalized,
        monthlyTrends,
        fullYearTrends: fullYearMonthlyTrends,
        computedAt: new Date().toISOString(),
        dataVersion: rawData.cloudSaveVersion ?? 0,
    };
}

export interface ComputeDashboardDataResult {
    ok: boolean;
    projectId: string;
    year: number;
    quarter: DashboardMetricOptions['quarter'];
    loadScope: ComputeDashboardLoadScope;
    processedData: DashboardData;
    baselineData: DashboardData;
    recordMeta?: RecordMeta;
    fullYearMonthlyTrends: MonthlyTrend[];
    computedAt: string;
    dataVersion: number;
    message?: string;
}

export type ComputeDashboardLoadScope = { kind: 'full' } | { kind: 'year'; year: number };

export interface ComputeDashboardDraftResult {
    ok: boolean;
    projectId: string;
    year: number;
    quarter: DashboardMetricOptions['quarter'];
    processedData: DashboardData;
    fullYearMonthlyTrends: MonthlyTrend[];
    computedAt: string;
    dataVersion: number;
    message?: string;
}

export function buildComputeKpiResultFromDashboardData(
    dashboard: ComputeDashboardDataResult,
): ComputeKpiResult {
    if (!dashboard.ok) {
        return {
            ok: false,
            projectId: dashboard.projectId,
            year: dashboard.year,
            summary: {} as KpiSnapshotSummary,
            monthlyTrends: [],
            fullYearTrends: [],
            computedAt: dashboard.computedAt,
            dataVersion: dashboard.dataVersion,
            message: dashboard.message || '无法计算 KPI',
        };
    }
    const summary = buildKpiSummaryFromProcessedData(dashboard.processedData, dashboard.year);
    const normalized = normalizeKpiSummaryWithMonthlyTrends(summary, dashboard.fullYearMonthlyTrends);
    return {
        ok: true,
        projectId: dashboard.projectId,
        year: dashboard.year,
        summary: normalized,
        monthlyTrends: dashboard.fullYearMonthlyTrends.slice(0, 12),
        fullYearTrends: dashboard.fullYearMonthlyTrends,
        computedAt: dashboard.computedAt,
        dataVersion: dashboard.dataVersion,
    };
}

export async function computeDashboardDraft(
    projectId: string,
    draftData: DashboardData,
    options: {
        year: number;
        quarter?: DashboardMetricOptions['quarter'];
        billingSelectedMonth?: string;
        quickMode?: boolean;
        includeCurrentMonthBilling?: boolean;
        includePrevYearTrends?: boolean;
    },
): Promise<ComputeDashboardDraftResult> {
    const year = options.year;
    const quarter = options.quarter || 'All';
    const billingSelectedMonth = options.billingSelectedMonth || new Date().toISOString().slice(0, 7);
    let metricsInput: DashboardData = { ...generateInitialData(), ...draftData };
    const autoTenants = transitionContractStatuses(metricsInput.tenants || []);
    if (autoTenants !== metricsInput.tenants) {
        metricsInput = { ...metricsInput, tenants: autoTenants };
    }
    metricsInput = {
        ...metricsInput,
        yearlyTargets: normalizeYearlyTargetsFromInitialization(
            metricsInput.yearlyTargets,
            metricsInput.initializationData,
            projectId,
        ),
    };

    const metricOptions: DashboardMetricOptions = {
        year,
        quarter,
        billingSelectedMonth,
        quickMode: options.quickMode,
        includeCurrentMonthBilling: options.includeCurrentMonthBilling,
        includePrevYearTrends: options.includePrevYearTrends,
    };
    const { processedData, fullYearMonthlyTrends } = calculateDashboardMetrics(metricsInput, metricOptions);
    const dataVersion =
        typeof metricsInput.cloudSaveVersion === 'number' && Number.isFinite(metricsInput.cloudSaveVersion)
            ? Math.max(0, Math.floor(metricsInput.cloudSaveVersion))
            : 0;

    return {
        ok: true,
        projectId,
        year,
        quarter,
        processedData,
        fullYearMonthlyTrends,
        computedAt: new Date().toISOString(),
        dataVersion,
    };
}

export async function computeDashboardData(
    projectId: string,
    options: {
        year: number;
        quarter?: DashboardMetricOptions['quarter'];
        billingSelectedMonth?: string;
        quickMode?: boolean;
        includeCurrentMonthBilling?: boolean;
        includePrevYearTrends?: boolean;
        loadScope?: ComputeDashboardLoadScope;
    },
): Promise<ComputeDashboardDataResult> {
    await ensureInit();

    const year = options.year;
    const quarter = options.quarter || 'All';
    const scopedYear =
        options.loadScope?.kind === 'year' && Number.isFinite(options.loadScope.year)
            ? Math.floor(options.loadScope.year)
            : year;
    const shouldLoadFullForPrevYearTrends = options.includePrevYearTrends !== false && options.quickMode !== true;
    const loadScope: ComputeDashboardLoadScope =
        options.loadScope?.kind === 'full'
            ? { kind: 'full' }
            : { kind: 'year', year: scopedYear };
    const resolvedLoadScope: ComputeDashboardLoadScope =
        options.loadScope
            ? loadScope
            : shouldLoadFullForPrevYearTrends
              ? { kind: 'full' }
              : loadScope;
    const billingSelectedMonth = options.billingSelectedMonth || new Date().toISOString().slice(0, 7);
    const cacheVersion = await readComputeDataVersion(projectId);
    const cacheKey = dashboardCacheKey(
        projectId,
        year,
        quarter,
        billingSelectedMonth,
        options.quickMode,
        options.includeCurrentMonthBilling,
        options.includePrevYearTrends,
        resolvedLoadScope,
        cacheVersion,
    );
    if (DASHBOARD_CACHE_TTL_MS > 0 && cacheVersion > 0) {
        const cached = dashboardComputeCache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) {
            logComputeCache('dashboard', 'hit', cacheKey);
            return cloneComputeDashboardDataResult(cached.result);
        }
        if (cached) {
            logComputeCache('dashboard', 'expired', cacheKey);
            dashboardComputeCache.delete(cacheKey);
        } else {
            logComputeCache('dashboard', 'miss', cacheKey);
        }
    } else {
        logComputeCache('dashboard', 'skip', cacheKey);
    }

    const fetchRes = await fetchPocketBaseBackup(
        projectId,
        resolvedLoadScope.kind === 'year' ? { year: resolvedLoadScope.year } : undefined,
    );
    if (!fetchRes.success || !fetchRes.data) {
        return {
            ok: false,
            projectId,
            year,
            quarter,
            loadScope: resolvedLoadScope,
            processedData: generateInitialData(),
            baselineData: generateInitialData(),
            fullYearMonthlyTrends: [],
            computedAt: new Date().toISOString(),
            dataVersion: 0,
            message: fetchRes.message || '无法拉取园区数据',
        };
    }

    const baselineData: DashboardData = { ...generateInitialData(), ...fetchRes.data };
    let metricsInput: DashboardData = baselineData;
    const autoTenants = transitionContractStatuses(metricsInput.tenants || []);
    if (autoTenants !== metricsInput.tenants) {
        metricsInput = { ...metricsInput, tenants: autoTenants };
    }
    metricsInput = {
        ...metricsInput,
        yearlyTargets: normalizeYearlyTargetsFromInitialization(
            metricsInput.yearlyTargets,
            metricsInput.initializationData,
            projectId,
        ),
    };

    const metricOptions: DashboardMetricOptions = {
        year,
        quarter,
        billingSelectedMonth,
        quickMode: options.quickMode,
        includeCurrentMonthBilling: options.includeCurrentMonthBilling,
        includePrevYearTrends: options.includePrevYearTrends,
    };
    const { processedData, fullYearMonthlyTrends } = calculateDashboardMetrics(metricsInput, metricOptions);

    const rawDataVersion =
        typeof baselineData.cloudSaveVersion === 'number' && Number.isFinite(baselineData.cloudSaveVersion)
            ? Math.max(0, Math.floor(baselineData.cloudSaveVersion))
            : null;
    const dataVersion = rawDataVersion ?? (cacheVersion >= 0 ? cacheVersion : 0);
    const result: ComputeDashboardDataResult = {
        ok: true,
        projectId,
        year,
        quarter,
        loadScope: resolvedLoadScope,
        processedData,
        baselineData,
        recordMeta: fetchRes.recordMeta,
        fullYearMonthlyTrends,
        computedAt: new Date().toISOString(),
        dataVersion,
    };
    if (DASHBOARD_CACHE_TTL_MS > 0 && dataVersion > 0) {
        putDashboardCache(
            dashboardCacheKey(
                projectId,
                year,
                quarter,
                billingSelectedMonth,
                options.quickMode,
                options.includeCurrentMonthBilling,
                options.includePrevYearTrends,
                resolvedLoadScope,
                dataVersion,
            ),
            result,
            dataVersion,
        );
        logComputeCache(
            'dashboard',
            'store',
            dashboardCacheKey(
                projectId,
                year,
                quarter,
                billingSelectedMonth,
                options.quickMode,
                options.includeCurrentMonthBilling,
                options.includePrevYearTrends,
                resolvedLoadScope,
                dataVersion,
            ),
        );
    }
    return result;
}

export interface ComputeTenantHistoricalArrearsResult {
    ok: boolean;
    projectId: string;
    available: boolean;
    items: Array<TenantHistoricalArrearsSummary & { tenantId: string }>;
    startPeriod?: string;
    endPeriod?: string;
    unavailableReason?: string;
    computedAt: string;
    dataVersion: number;
    message?: string;
}

const parseComputeReferenceDate = (value: string | Date | undefined): Date | undefined => {
    if (!value) return undefined;
    const date = value instanceof Date ? new Date(value) : new Date(String(value));
    return Number.isFinite(date.getTime()) ? date : undefined;
};

const formatComputeMonthKey = (date: Date): string =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

function receivableScopeAllowsBillingDetail(
    detail: BillingDetail,
    receivablePermissions: Array<ReceivablePermission | string> | undefined,
): boolean {
    const permissions = receivablePermissions?.length
        ? receivablePermissions
        : ['rent_receivable', 'mgmt_fee_receivable'];
    const feeKind = String(detail.feeKind || 'rent');
    if (feeKind === 'management_fee') return permissions.includes('mgmt_fee_receivable');
    return permissions.includes('rent_receivable');
}

export async function computeTenantHistoricalArrears(
    projectId: string,
    options: {
        referenceDate?: string | Date;
        receivablePermissions?: Array<ReceivablePermission | string>;
    } = {},
): Promise<ComputeTenantHistoricalArrearsResult> {
    const referenceDate = parseComputeReferenceDate(options.referenceDate) || new Date();
    const year = referenceDate.getFullYear();
    const dashboard = await computeDashboardData(projectId, {
        year,
        quarter: 'All',
        billingSelectedMonth: formatComputeMonthKey(referenceDate),
        quickMode: true,
        includeCurrentMonthBilling: false,
        includePrevYearTrends: false,
        loadScope: { kind: 'full' },
    });

    if (!dashboard.ok) {
        return {
            ok: false,
            projectId,
            available: false,
            items: [],
            computedAt: dashboard.computedAt,
            dataVersion: dashboard.dataVersion,
            message: dashboard.message || '无法拉取园区数据',
        };
    }

    const result = buildTenantHistoricalArrears({
        data: dashboard.processedData,
        referenceDate,
        includeBillingDetail: (detail) =>
            receivableScopeAllowsBillingDetail(detail, options.receivablePermissions),
    });
    const items = Array.from(result.byTenantId.entries()).map(([tenantId, summary]) => ({
        tenantId,
        ...summary,
    }));

    return {
        ok: true,
        projectId,
        available: result.available,
        items,
        startPeriod: result.startPeriod,
        endPeriod: result.endPeriod,
        unavailableReason: result.unavailableReason,
        computedAt: new Date().toISOString(),
        dataVersion: dashboard.dataVersion,
        message: result.available
            ? '计算成功'
            : result.unavailableReason || '客户历史欠费暂不可用',
    };
}

export interface ComputeBillingResult {
    ok: boolean;
    projectId: string;
    year: number;
    /** Natural month number, 1-12. */
    month: number;
    /** Internal JS month index, 0-11. */
    monthIndex?: number;
    billingDetails: BillingDetail[];
    totalDue: number;
    totalPaid: number;
    unpaidCount: number;
    financeSummary?: {
        /** 与前端「本月应收租金」同口径：系统账单 + 手工应收，含缓缴还原。 */
        budgetReceivable: number;
        /** 与前端「本月实收租金」同口径：应收 - 待收。 */
        actualReceived: number;
        /** 与前端「本月待收租金」同口径：各行待收余额合计，含尾差归零。 */
        pendingCollection: number;
        /** 合同滚动纯口径。 */
        contractReceivableTotal: number;
    };
    computedAt: string;
    dataVersion: number;
}

function paymentAmountForPeriod(
    tenantId: string,
    periodYYYYMM: string,
    payments: PaymentRecord[],
    tenants: Tenant[],
): number {
    return roundMoney2(payments
        .filter((p) => {
            if (p.type !== 'Rent' && p.type !== 'DepositToRent') return false;
            if (!paymentTenantMatchesBillingTenant(p.tenantId, tenantId, tenants, p.tenantName)) return false;
            const periods = parsePaymentPeriodYYYYMMs(p.period);
            if (periods.length > 0) return periods.includes(periodYYYYMM);
            return p.date.startsWith(periodYYYYMM);
        })
        .reduce((sum, p) => sum + p.amount, 0));
}

function deferredTargetCollection(
    detail: BillingDetail,
    payments: PaymentRecord[],
    tenants: Tenant[],
): number {
    const deferredAmount = detail.deferredAmount ?? 0;
    const targetPeriod = detail.deferredToPeriod;
    if (deferredAmount <= 0.005 || !targetPeriod) return 0;
    return Math.min(deferredAmount, paymentAmountForPeriod(detail.tenantId, targetPeriod, payments, tenants));
}

function buildFinanceSummary(details: BillingDetail[], data: DashboardData) {
    const payments = data.payments || [];
    const tenants = data.tenants || [];
    const budgetReceivable = roundMoney2(details.reduce((sum, r) => sum + receivableBudgetDisplay(r), 0));
    const pendingCollection = roundMoney2(details.reduce((sum, r) => {
        const effectivePaid = roundMoney2((r.amountPaid ?? 0) + deferredTargetCollection(r, payments, tenants));
        return sum + normalizeReceivableRemaining(receivableBudgetDisplay(r) - effectivePaid);
    }, 0));
    const actualReceived = roundMoney2(Math.max(0, budgetReceivable - pendingCollection));
    const contractReceivableTotal = roundMoney2(details.reduce((sum, r) => sum + (r.contractAmountDue ?? 0), 0));
    return { budgetReceivable, actualReceived, pendingCollection, contractReceivableTotal };
}

/** 为指定月份计算应收明细 */
export async function computeBilling(
    projectId: string,
    year: number,
    month: number, // 0-11
): Promise<ComputeBillingResult> {
    await ensureInit();

    const cacheVersion = await readComputeDataVersion(projectId);
    const cacheKey = billingCacheKey(projectId, year, month, cacheVersion);
    if (BILLING_CACHE_TTL_MS > 0 && cacheVersion > 0) {
        const cached = billingComputeCache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) {
            logComputeCache('billing', 'hit', cacheKey);
            return cloneComputeBillingResult(cached.result);
        }
        if (cached) {
            logComputeCache('billing', 'expired', cacheKey);
            billingComputeCache.delete(cacheKey);
        } else {
            logComputeCache('billing', 'miss', cacheKey);
        }
    } else {
        logComputeCache('billing', 'skip', cacheKey);
    }

    const fetchRes = await fetchPocketBaseBackup(projectId, { year });
    if (!fetchRes.success || !fetchRes.data) {
        return {
            ok: false,
            projectId,
            year,
            month: month + 1,
            monthIndex: month,
            billingDetails: [],
            totalDue: 0,
            totalPaid: 0,
            unpaidCount: 0,
            computedAt: new Date().toISOString(),
            dataVersion: 0,
        };
    }

    const rawData = fetchRes.data;
    const dataVersion =
        typeof rawData.cloudSaveVersion === 'number' && Number.isFinite(rawData.cloudSaveVersion)
            ? Math.max(0, Math.floor(rawData.cloudSaveVersion))
            : cacheVersion;
    const options: DashboardMetricOptions = {
        year,
        quarter: 'All',
        billingSelectedMonth: `${year}-${String(month + 1).padStart(2, '0')}`,
    };

    const { processedData } = calculateDashboardMetrics(rawData, options);
    const details = processedData.currentMonthBilling || [];

    const totalDue = details.reduce((s, d) => s + d.amountDue, 0);
    const totalPaid = details.reduce((s, d) => s + d.amountPaid, 0);
    const unpaidCount = details.filter((d) => d.status === 'Unpaid' || d.status === 'Partial' || d.status === 'Overdue').length;
    const financeSummary = buildFinanceSummary(details, rawData);

    const result: ComputeBillingResult = {
        ok: true,
        projectId,
        year,
        month: month + 1,
        monthIndex: month,
        billingDetails: details,
        totalDue: Math.round(totalDue * 100) / 100,
        totalPaid: Math.round(totalPaid * 100) / 100,
        unpaidCount,
        financeSummary,
        computedAt: new Date().toISOString(),
        dataVersion,
    };
    if (BILLING_CACHE_TTL_MS > 0 && dataVersion > 0) {
        const writeKey = billingCacheKey(projectId, year, month, dataVersion);
        putBillingCache(writeKey, result, dataVersion);
        logComputeCache('billing', 'store', writeKey);
    }
    return result;
}

export async function computeBillingDraft(
    projectId: string,
    draftData: DashboardData,
    year: number,
    month: number, // 0-11
): Promise<ComputeBillingResult> {
    const rawData: DashboardData = { ...generateInitialData(), ...draftData };
    const dataVersion =
        typeof rawData.cloudSaveVersion === 'number' && Number.isFinite(rawData.cloudSaveVersion)
            ? Math.max(0, Math.floor(rawData.cloudSaveVersion))
            : 0;
    const options: DashboardMetricOptions = {
        year,
        quarter: 'All',
        billingSelectedMonth: `${year}-${String(month + 1).padStart(2, '0')}`,
        includeCurrentMonthBilling: true,
    };

    const { processedData } = calculateDashboardMetrics(rawData, options);
    const details = processedData.currentMonthBilling || [];
    const totalDue = details.reduce((s, d) => s + d.amountDue, 0);
    const totalPaid = details.reduce((s, d) => s + d.amountPaid, 0);
    const unpaidCount = details.filter((d) => d.status === 'Unpaid' || d.status === 'Partial' || d.status === 'Overdue').length;
    const financeSummary = buildFinanceSummary(details, rawData);

    return {
        ok: true,
        projectId,
        year,
        month: month + 1,
        monthIndex: month,
        billingDetails: details,
        totalDue: Math.round(totalDue * 100) / 100,
        totalPaid: Math.round(totalPaid * 100) / 100,
        unpaidCount,
        financeSummary,
        computedAt: new Date().toISOString(),
        dataVersion,
    };
}

export interface ComputeBudgetedBillsPreviewInput {
    tenant: Tenant;
    assumptions?: BudgetAssumption[];
    adjustments?: BudgetAdjustment[];
    startDate: string | Date;
    endDate: string | Date;
    options?: GenerateBudgetedBillsOptions;
}

export interface ComputeBudgetedBillsPreviewResult {
    ok: boolean;
    projectId: string;
    bills: BudgetedBill[];
    count: number;
    computedAt: string;
}

export interface ComputeBudgetedBillsPreviewBatchItem extends ComputeBudgetedBillsPreviewInput {
    id?: string;
}

export interface ComputeBudgetedBillsPreviewBatchResult {
    ok: boolean;
    projectId: string;
    items: Array<{
        id: string;
        bills: BudgetedBill[];
        count: number;
    }>;
    count: number;
    computedAt: string;
}

function parsePreviewDate(value: string | Date, fieldName: string): Date {
    const date = value instanceof Date ? new Date(value) : new Date(String(value || ''));
    if (!Number.isFinite(date.getTime())) {
        throw new Error(`无效的 ${fieldName}`);
    }
    return date;
}

export async function computeBudgetedBillsPreview(
    projectId: string,
    input: ComputeBudgetedBillsPreviewInput,
): Promise<ComputeBudgetedBillsPreviewResult> {
    if (!input?.tenant || typeof input.tenant !== 'object') {
        throw new Error('缺少 tenant');
    }
    const start = parsePreviewDate(input.startDate, 'startDate');
    const end = parsePreviewDate(input.endDate, 'endDate');
    if (end < start) {
        throw new Error('endDate 不能早于 startDate');
    }

    const bills = generateBudgetedBills(
        input.tenant,
        Array.isArray(input.assumptions) ? input.assumptions : [],
        Array.isArray(input.adjustments) ? input.adjustments : [],
        start,
        end,
        input.options,
    );

    return {
        ok: true,
        projectId,
        bills,
        count: bills.length,
        computedAt: new Date().toISOString(),
    };
}

export async function computeBudgetedBillsPreviewBatch(
    projectId: string,
    items: ComputeBudgetedBillsPreviewBatchItem[],
): Promise<ComputeBudgetedBillsPreviewBatchResult> {
    if (!Array.isArray(items) || items.length === 0) {
        throw new Error('缺少 items');
    }

    const computedAt = new Date().toISOString();
    const results = await Promise.all(items.map(async (item, index) => {
        const result = await computeBudgetedBillsPreview(projectId, item);
        return {
            id: String(item.id || item.tenant?.id || index),
            bills: result.bills,
            count: result.count,
        };
    }));

    return {
        ok: true,
        projectId,
        items: results,
        count: results.length,
        computedAt,
    };
}

export interface ComputeContractReceivableMonthlyInput {
    year: number;
    tenants?: Tenant[];
    buildings?: Building[];
    payments?: PaymentRecord[];
    initializationData?: MonthlyInitData[];
    budgetAssumptions?: BudgetAssumption[];
    budgetAdjustments?: BudgetAdjustment[];
    budgetScenarios?: BudgetScenario[];
}

export interface ComputeContractReceivableMonthlyResult {
    ok: boolean;
    projectId: string;
    year: number;
    months: Array<{
        month: number;
        totalAmountDue: number;
        byTenantId: Array<{ tenantId: string; amount: number }>;
    }>;
    computedAt: string;
}

export interface ComputeSourceAgentMetricsInput {
    tenants?: Tenant[];
    period?: SourceAnalysisPeriod;
    referenceDate?: string | Date;
}

export interface ComputeSourceAgentMetricsResult {
    ok: boolean;
    projectId: string;
    summary: SourceAnalysisSummary;
    computedAt: string;
}

export interface ComputeContractAnalysisMetricsInput {
    tenants?: Tenant[];
    period?: ContractAnalysisPeriod;
    referenceDate?: string | Date;
}

export interface ComputeContractAnalysisMetricsResult {
    ok: boolean;
    projectId: string;
    metrics: ContractAnalysisMetrics;
    computedAt: string;
}

const normalizeSourceAnalysisPeriod = (period: unknown): SourceAnalysisPeriod => {
    const value = String(period || 'All');
    return value === 'Year' || value === 'Quarter' || value === 'Month' ? value : 'All';
};

const normalizeContractAnalysisPeriod = (period: unknown): ContractAnalysisPeriod => {
    const value = String(period || 'Year');
    return value === 'Year' || value === 'Quarter' || value === 'Month' ? value : 'Year';
};

const parseOptionalReferenceDate = (value: unknown): Date => {
    if (!value) return new Date();
    const date = value instanceof Date ? new Date(value) : new Date(String(value));
    return Number.isFinite(date.getTime()) ? date : new Date();
};

export async function computeSourceAgentMetricsPreview(
    projectId: string,
    input: ComputeSourceAgentMetricsInput,
): Promise<ComputeSourceAgentMetricsResult> {
    const tenants = Array.isArray(input?.tenants) ? input.tenants : [];
    const period = normalizeSourceAnalysisPeriod(input?.period);
    const referenceDate = parseOptionalReferenceDate(input?.referenceDate);
    return {
        ok: true,
        projectId,
        summary: computeSourceAgentMetrics(tenants, period, referenceDate),
        computedAt: new Date().toISOString(),
    };
}

export async function computeContractAnalysisMetricsPreview(
    projectId: string,
    input: ComputeContractAnalysisMetricsInput,
): Promise<ComputeContractAnalysisMetricsResult> {
    const tenants = Array.isArray(input?.tenants) ? input.tenants : [];
    const period = normalizeContractAnalysisPeriod(input?.period);
    const referenceDate = parseOptionalReferenceDate(input?.referenceDate);
    return {
        ok: true,
        projectId,
        metrics: buildContractAnalysisMetrics(tenants, period, referenceDate),
        computedAt: new Date().toISOString(),
    };
}

export async function computeContractReceivableMonthly(
    projectId: string,
    input: ComputeContractReceivableMonthlyInput,
): Promise<ComputeContractReceivableMonthlyResult> {
    const year = Math.floor(Number(input?.year) || new Date().getFullYear());
    const tenants = Array.isArray(input?.tenants) ? input.tenants : [];
    const buildings = Array.isArray(input?.buildings) ? input.buildings : [];
    const payments = Array.isArray(input?.payments) ? input.payments : [];
    const initializationData = Array.isArray(input?.initializationData) ? input.initializationData : [];
    const budgetAssumptions = Array.isArray(input?.budgetAssumptions) ? input.budgetAssumptions : [];
    const budgetAdjustments = Array.isArray(input?.budgetAdjustments) ? input.budgetAdjustments : [];
    const budgetScenarios = Array.isArray(input?.budgetScenarios) ? input.budgetScenarios : [];
    const cache = createBillingCache(buildings, payments, initializationData);
    const ctx = {
        tenants,
        buildings,
        payments,
        initializationData,
        budgetAssumptions,
        budgetAdjustments,
        budgetScenarios,
    };

    const months = Array.from({ length: 12 }, (_, monthIndex) => {
        const result = buildContractOnlyReceivableForPeriod(year, monthIndex, ctx, cache);
        return {
            month: monthIndex + 1,
            totalAmountDue: result.totalAmountDue,
            byTenantId: Array.from(result.byTenantId.entries()).map(([tenantId, amount]) => ({
                tenantId,
                amount,
            })),
        };
    });

    return {
        ok: true,
        projectId,
        year,
        months,
        computedAt: new Date().toISOString(),
    };
}

// ── 月度封账 ──

export interface SealMonthResult {
    ok: boolean;
    projectId: string;
    year: number;
    /** 自然月 1-12 */
    month: number;
    /** 当月应收合计 */
    receivableTotal: number;
    /** 当月未收（与欠款增量同口径） */
    unpaidSum: number;
    /** 当月新增欠款：Unpaid 行全额 amountDue + Partial 行余额(amountDue-amountPaid)，与前端欠款循环一致 */
    arrearsIncrement: number;
    billingDetails: BillingDetail[];
    dataVersion: number;
    computedAt: string;
    message?: string;
}

/**
 * 计算（不落库）指定月份的封账数据。
 * 复用 computeBilling 拿当月 BillingDetail[]，再按「前端欠款循环」口径算当月新增欠款。
 * 落库（含累计欠款链）由 integration-gateway 负责，与 pb_kpi_snapshots 的「compute 算、gateway 写」模式一致。
 */
export async function sealMonth(
    projectId: string,
    year: number,
    month: number, // 0-11
): Promise<SealMonthResult> {
    await ensureInit();
    const billing = await computeBilling(projectId, year, month);
    if (!billing.ok) {
        return {
            ok: false, projectId, year, month: month + 1,
            receivableTotal: 0, unpaidSum: 0, arrearsIncrement: 0,
            billingDetails: [], dataVersion: 0,
            computedAt: new Date().toISOString(), message: '无法拉取园区数据',
        };
    }
    const details = billing.billingDetails;
    let arrearsIncrement = 0;
    for (const d of details) {
        // 与 dashboardMetrics 欠款循环完全一致
        if (d.status === 'Unpaid') arrearsIncrement += d.amountDue;
        else if (d.status === 'Partial') arrearsIncrement += d.amountDue - d.amountPaid;
    }
    arrearsIncrement = roundMoney2(arrearsIncrement);
    return {
        ok: true, projectId, year, month: month + 1,
        receivableTotal: roundMoney2(billing.totalDue),
        unpaidSum: arrearsIncrement,
        arrearsIncrement,
        billingDetails: details,
        dataVersion: billing.dataVersion,
        computedAt: new Date().toISOString(),
    };
}

// ── CLI entry point ──

import * as fs from 'fs';

interface CliArgs {
    projectId?: string;
    year?: number;
    output?: string;
    url?: string;
}

function parseCliArgs(): CliArgs {
    const args = process.argv.slice(2);
    const result: CliArgs = {};
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--project' && args[i + 1]) result.projectId = args[++i];
        else if (args[i] === '--year' && args[i + 1]) result.year = parseInt(args[++i], 10);
        else if (args[i] === '--output' && args[i + 1]) result.output = args[++i];
        else if (args[i] === '--url' && args[i + 1]) result.url = args[++i];
    }
    return result;
}

async function main() {
    const cli = parseCliArgs();
    const url = cli.url || process.env.PB_URL || 'http://127.0.0.1:8090';
    const projectId = cli.projectId || process.env.PB_PROJECT_ID || 'shanghai_park';
    const year = cli.year || new Date().getFullYear();

    console.error(`[compute-engine] PB_URL=${url}`);
    console.error(`[compute-engine] projectId=${projectId} year=${year}`);

    // 确保 ensureInit 使用正确的 URL
    process.env.PB_URL = url;
    await ensureInit();

    const start = performance.now();
    const result = await computeKpi(projectId, year);
    const elapsed = ((performance.now() - start) / 1000).toFixed(2);

    const output: any = {
        projectId: result.projectId,
        year: result.year,
        ok: result.ok,
        computedAt: result.computedAt,
        elapsedSec: parseFloat(elapsed),
        dataVersion: result.dataVersion,
        summary: result.summary,
    };

    if (cli.output) {
        fs.writeFileSync(cli.output, JSON.stringify(output, null, 2), 'utf-8');
        console.error(`[compute-engine] 已写入: ${cli.output}`);
    }

    console.log(JSON.stringify(output, null, 2));
}

// Only run CLI if called directly
const isMainModule = process.argv[1]?.includes('compute-engine');
if (isMainModule) {
    main().catch((e) => {
        console.error('[compute-engine] Fatal:', e);
        process.exit(1);
    });
}
