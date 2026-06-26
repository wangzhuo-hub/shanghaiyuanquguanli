import {
    BillingDetail,
    BudgetAdjustment,
    BudgetAssumption,
    BudgetScenario,
    Building,
    CloudConfig,
    DashboardData,
    MonthlyInitData,
    PaymentRecord,
    Tenant,
} from '../types';
import type { BudgetedBill, GenerateBudgetedBillsOptions } from './billingService';
import type { BigScreenData } from './bigScreenMetrics';
import type { ContractAnalysisMetrics, ContractAnalysisPeriod } from './contractAnalysisMetrics';
import type { DirtyPayload } from './dirtyTracker';
import type { RecordMeta } from './pocketbaseService';
import type { SourceAnalysisPeriod, SourceAnalysisSummary } from './sourceAgentMetrics';
import type { TenantHistoricalArrearsSummary } from './tenantHistoricalArrears';
import {
    getIntegrationAppBigScreenUrl,
    getIntegrationAppBillingComputeUrl,
    getIntegrationAppBillingDraftComputeUrl,
    getIntegrationAppBudgetedBillsPreviewBatchUrl,
    getIntegrationAppBudgetedBillsPreviewUrl,
    getIntegrationAppContractAnalysisMetricsUrl,
    getIntegrationAppContractReceivableMonthlyUrl,
    getIntegrationAppDashboardBootstrapUrl,
    getIntegrationAppDashboardComputeUrl,
    getIntegrationAppDashboardDraftComputeUrl,
    getIntegrationAppSourceAgentMetricsUrl,
    getIntegrationAppTenantHistoricalArrearsUrl,
} from '../config/urls';
import { getCurrentCloudAuthToken } from './cloudAuthToken';
import { collectionIdentityKey, objectIdentityKey } from './requestIdentityKey';

export type CloudComputedDashboardResult = {
    success: boolean;
    processedData?: DashboardData;
    baselineData?: DashboardData;
    recordMeta?: RecordMeta;
    loadScope?: { kind: 'full' } | { kind: 'year'; year: number };
    fullYearMonthlyTrends?: DashboardData['monthlyTrends'];
    dataVersion?: number;
    computedAt?: string;
    source?: string;
    stale?: boolean;
    message: string;
};

export type CloudComputedDraftDashboardResult = {
    success: boolean;
    processedData?: DashboardData;
    fullYearMonthlyTrends?: DashboardData['monthlyTrends'];
    dataVersion?: number;
    computedAt?: string;
    message: string;
};

export type CloudDraftPayloadOptions = {
    dirtyPayload?: DirtyPayload | null;
    baseVersion?: number | null;
    identityKey?: string;
};

export type CloudComputedBillingResult = {
    success: boolean;
    billingDetails?: BillingDetail[];
    totalDue?: number;
    totalPaid?: number;
    unpaidCount?: number;
    dataVersion?: number;
    computedAt?: string;
    message: string;
};

export type CloudBudgetedBillsPreviewInput = {
    tenant: Tenant;
    assumptions?: BudgetAssumption[];
    adjustments?: BudgetAdjustment[];
    startDate: string | Date;
    endDate: string | Date;
    options?: GenerateBudgetedBillsOptions;
};

export type CloudBudgetedBillsPreviewResult = {
    success: boolean;
    bills?: BudgetedBill[];
    count?: number;
    computedAt?: string;
    message?: string;
};

export type CloudBudgetedBillsPreviewBatchInput = {
    items: Array<CloudBudgetedBillsPreviewInput & { id?: string }>;
};

export type CloudBudgetedBillsPreviewBatchResult = {
    success: boolean;
    items?: Array<{
        id: string;
        bills: BudgetedBill[];
        count: number;
    }>;
    count?: number;
    computedAt?: string;
    message?: string;
};

export type CloudContractReceivableMonthlyInput = {
    year: number;
    tenants: Tenant[];
    buildings: Building[];
    payments?: PaymentRecord[];
    initializationData?: MonthlyInitData[];
    budgetAssumptions?: BudgetAssumption[];
    budgetAdjustments?: BudgetAdjustment[];
    budgetScenarios?: BudgetScenario[];
};

export type CloudContractReceivableMonthlyResult = {
    success: boolean;
    months?: Array<{
        month: number;
        totalAmountDue: number;
        byTenantId: Array<{ tenantId: string; amount: number }>;
    }>;
    computedAt?: string;
    message?: string;
};

export type CloudSourceAgentMetricsInput = {
    tenants: Tenant[];
    period: SourceAnalysisPeriod;
    referenceDate?: string | Date;
};

export type CloudSourceAgentMetricsResult = {
    success: boolean;
    summary?: SourceAnalysisSummary;
    computedAt?: string;
    message: string;
};

export type CloudContractAnalysisMetricsInput = {
    tenants: Tenant[];
    period: ContractAnalysisPeriod;
    referenceDate?: string | Date;
};

export type CloudContractAnalysisMetricsResult = {
    success: boolean;
    metrics?: ContractAnalysisMetrics;
    computedAt?: string;
    message: string;
};

export type CloudTenantHistoricalArrearsItem = TenantHistoricalArrearsSummary & {
    tenantId: string;
};

export type CloudTenantHistoricalArrearsResult = {
    success: boolean;
    available?: boolean;
    byTenantId?: Map<string, TenantHistoricalArrearsSummary>;
    items?: CloudTenantHistoricalArrearsItem[];
    startPeriod?: string;
    endPeriod?: string;
    unavailableReason?: string;
    dataVersion?: number;
    computedAt?: string;
    message: string;
};

const inFlightComputedDashboards = new Map<string, Promise<CloudComputedDashboardResult>>();
const inFlightDashboardBootstraps = new Map<string, Promise<CloudComputedDashboardResult>>();
const inFlightDraftComputedDashboards = new Map<string, Promise<CloudComputedDraftDashboardResult>>();
const inFlightComputedBillings = new Map<string, Promise<CloudComputedBillingResult>>();
const inFlightDraftComputedBillings = new Map<string, Promise<CloudComputedBillingResult>>();
const inFlightBudgetedBillsPreviews = new Map<string, Promise<CloudBudgetedBillsPreviewResult>>();
const inFlightBudgetedBillsPreviewBatches = new Map<string, Promise<CloudBudgetedBillsPreviewBatchResult>>();
const inFlightContractReceivableMonthlies = new Map<string, Promise<CloudContractReceivableMonthlyResult>>();
const inFlightSourceAgentMetrics = new Map<string, Promise<CloudSourceAgentMetricsResult>>();
const inFlightContractAnalysisMetrics = new Map<string, Promise<CloudContractAnalysisMetricsResult>>();
const inFlightTenantHistoricalArrears = new Map<string, Promise<CloudTenantHistoricalArrearsResult>>();
const inFlightBigScreenData = new Map<string, Promise<{ success: boolean; data?: BigScreenData; message: string }>>();

const authHeaders = (): { headers?: Record<string, string>; error?: string } => {
    const token = getCurrentCloudAuthToken();
    if (!token) return { error: '当前用户 token 不可用' };
    return {
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
    };
};

const projectIdFrom = (config: CloudConfig): string => (config.projectId || '').trim();

const dashboardDraftScalarIdentityKey = (data: DashboardData): string => [
    data.totalArea,
    data.leasedArea,
    data.occupancyRate,
    data.campusTotalArea,
    data.selfUseArea,
    data.vacantArea,
    data.leasableUnits,
    data.leasedUnits,
    data.vacantUnits,
    data.annualRevenueTarget,
    data.annualRevenueCollected,
    data.annualManagementFeeContractReceivable,
    data.annualManagementFeeCollected,
    data.annualOccupancyTarget,
    data.monthlyRevenueTarget,
    data.monthlyRevenueCollected,
    data.collectionRate,
    data.accumulatedArrears,
    data.newContractsCount,
    data.newContractsArea,
    data.terminatedContractsCount,
    data.terminatedContractsArea,
    data.netIncreaseArea,
    data.expiringSoonCount,
    data.cloudSaveVersion,
].map((value) => String(value ?? '')).join(',');

const dashboardDraftIdentityKey = (data: DashboardData): string => [
    collectionIdentityKey(data.buildings),
    collectionIdentityKey(data.tenants),
    collectionIdentityKey(data.payments),
    collectionIdentityKey(data.invoices),
    collectionIdentityKey(data.initializationData),
    collectionIdentityKey(data.budgetAssumptions),
    collectionIdentityKey(data.budgetAdjustments),
    collectionIdentityKey(data.budgetScenarios),
    collectionIdentityKey(data.sealedMonths),
    collectionIdentityKey(data.monthlyTrends),
    collectionIdentityKey(data.prevYearMonthlyTrends),
    collectionIdentityKey(data.currentMonthBilling),
    collectionIdentityKey(data.recentSignings),
    collectionIdentityKey(data.expiringSoon),
    objectIdentityKey(data.billingPeriodNotes),
    objectIdentityKey(data.yearlyTargets),
    objectIdentityKey(data.budgetAnalysis),
    objectIdentityKey(data.parkingStats),
    objectIdentityKey(data.leaseStats),
    dashboardDraftScalarIdentityKey(data),
].join('::');

const dirtyPayloadHasChanges = (payload: DirtyPayload | null | undefined): payload is DirtyPayload =>
    !!payload &&
    Object.values(payload).some((bucket) =>
        (bucket.creates?.length || 0) > 0 ||
        (bucket.updates?.length || 0) > 0 ||
        (bucket.deletes?.length || 0) > 0,
    );

const dirtyPayloadIdentityKey = (payload: DirtyPayload, explicitKey?: string): string => {
    if (explicitKey) return explicitKey;
    return JSON.stringify(payload);
};

const serializePreviewDate = (value: string | Date): string =>
    value instanceof Date ? value.toISOString() : String(value || '');

const referenceDateDayKey = (value: string | Date | undefined): string => {
    if (!value) return '';
    const date = value instanceof Date ? value : new Date(String(value));
    if (!Number.isFinite(date.getTime())) return String(value);
    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0'),
    ].join('-');
};

const parsePreviewBillDate = (value: unknown): Date | undefined => {
    if (!value) return undefined;
    const date = value instanceof Date ? new Date(value) : new Date(String(value));
    return Number.isFinite(date.getTime()) ? date : undefined;
};

const parsePreviewBills = (bills: unknown): BudgetedBill[] => {
    if (!Array.isArray(bills)) return [];
    return bills.map((bill) => {
        const raw = (bill || {}) as Record<string, unknown>;
        return {
            ...raw,
            date: parsePreviewBillDate(raw.date) || new Date('Invalid Date'),
            originalDate: parsePreviewBillDate(raw.originalDate || raw.original_date),
            coverageStart: parsePreviewBillDate(raw.coverageStart || raw.coverage_start),
            coverageEnd: parsePreviewBillDate(raw.coverageEnd || raw.coverage_end),
        } as BudgetedBill;
    });
};

export const fetchCloudDashboardBootstrap = async (
    config: CloudConfig,
    options: {
        year: number;
        quarter: 'All' | 'Q1' | 'Q2' | 'Q3' | 'Q4';
        billingSelectedMonth: string;
        quickMode?: boolean;
        includeCurrentMonthBilling?: boolean;
        includePrevYearTrends?: boolean;
    },
): Promise<CloudComputedDashboardResult> => {
    const projectId = projectIdFrom(config);
    if (!projectId) return { success: false, message: '缺少 project_id' };
    const auth = authHeaders();
    if (auth.error) return { success: false, message: auth.error };

    const key = [
        config.pocketbaseUrl || '',
        projectId,
        options.year,
        options.quarter,
        options.billingSelectedMonth,
        'bootstrap',
        options.includePrevYearTrends === false ? 'without-prev-year' : 'with-prev-year',
    ].join('|');
    const existing = inFlightDashboardBootstraps.get(key);
    if (existing) return existing;

    const request = fetch(getIntegrationAppDashboardBootstrapUrl(), {
        method: 'POST',
        headers: auth.headers,
        body: JSON.stringify({
            project_id: projectId,
            year: options.year,
            quarter: options.quarter,
            billing_selected_month: options.billingSelectedMonth,
            quick_mode: options.quickMode === true,
            include_current_month_billing: options.includeCurrentMonthBilling === true,
            include_prev_year_trends: options.includePrevYearTrends !== false,
        }),
    })
        .then(async (res): Promise<CloudComputedDashboardResult> => {
            const body = await res.json().catch(() => null) as {
                success?: boolean;
                data?: {
                    ok?: boolean;
                    processed_data?: DashboardData;
                    baseline_data?: DashboardData;
                    record_meta?: RecordMeta;
                    load_scope?: { kind?: string; year?: number };
                    full_year_monthly_trends?: DashboardData['monthlyTrends'];
                    data_version?: number;
                    computed_at?: string;
                    source?: string;
                    stale?: boolean;
                    message?: string;
                };
                error?: { message?: string };
            } | null;
            const payload = body?.data;
            if (!res.ok || body?.success === false || payload?.ok === false || !payload?.processed_data || !payload?.baseline_data) {
                return {
                    success: false,
                    source: payload?.source,
                    stale: payload?.stale,
                    message: payload?.message || body?.error?.message || `启动快照加载失败 HTTP ${res.status}`,
                };
            }
            return {
                success: true,
                processedData: payload.processed_data,
                baselineData: payload.baseline_data,
                recordMeta: payload.record_meta || {},
                loadScope:
                    payload.load_scope?.kind === 'full'
                        ? { kind: 'full' }
                        : payload.load_scope?.kind === 'year' && typeof payload.load_scope.year === 'number'
                            ? { kind: 'year', year: payload.load_scope.year }
                            : undefined,
                fullYearMonthlyTrends: payload.full_year_monthly_trends || [],
                dataVersion: payload.data_version,
                computedAt: payload.computed_at,
                source: payload.source,
                stale: payload.stale === true,
                message: payload.stale ? '启动快照已加载（后台刷新中）' : '启动快照加载成功',
            };
        })
        .catch((e: unknown) => ({
            success: false,
            message: e instanceof Error ? e.message : '启动快照请求失败',
        }))
        .finally(() => {
            inFlightDashboardBootstraps.delete(key);
        });
    inFlightDashboardBootstraps.set(key, request);
    return request;
};

export const fetchCloudComputedDashboard = async (
    config: CloudConfig,
    options: {
        year: number;
        quarter: 'All' | 'Q1' | 'Q2' | 'Q3' | 'Q4';
        billingSelectedMonth: string;
        quickMode?: boolean;
        includeCurrentMonthBilling?: boolean;
        includePrevYearTrends?: boolean;
    },
): Promise<CloudComputedDashboardResult> => {
    const projectId = projectIdFrom(config);
    if (!projectId) return { success: false, message: '缺少 project_id' };
    const auth = authHeaders();
    if (auth.error) return { success: false, message: auth.error };

    const key = [
        config.pocketbaseUrl || '',
        projectId,
        options.year,
        options.quarter,
        options.billingSelectedMonth,
        options.quickMode ? 'quick' : 'full',
        options.includeCurrentMonthBilling ? 'billing' : 'no-billing',
        options.includePrevYearTrends === false ? 'without-prev-year' : 'with-prev-year',
    ].join('|');
    const existing = inFlightComputedDashboards.get(key);
    if (existing) return existing;

    const request = fetch(getIntegrationAppDashboardComputeUrl(), {
        method: 'POST',
        headers: auth.headers,
        body: JSON.stringify({
            project_id: projectId,
            year: options.year,
            quarter: options.quarter,
            billing_selected_month: options.billingSelectedMonth,
            quick_mode: options.quickMode === true,
            include_current_month_billing: options.includeCurrentMonthBilling === true,
            include_prev_year_trends: options.includePrevYearTrends !== false,
        }),
    })
        .then(async (res): Promise<CloudComputedDashboardResult> => {
            const body = await res.json().catch(() => null) as {
                success?: boolean;
                data?: {
                    ok?: boolean;
                    processed_data?: DashboardData;
                    baseline_data?: DashboardData;
                    record_meta?: RecordMeta;
                    load_scope?: { kind?: string; year?: number };
                    full_year_monthly_trends?: DashboardData['monthlyTrends'];
                    data_version?: number;
                    computed_at?: string;
                    message?: string;
                };
                error?: { message?: string };
            } | null;
            const payload = body?.data;
            if (!res.ok || body?.success === false || payload?.ok === false || !payload?.processed_data || !payload?.baseline_data) {
                return {
                    success: false,
                    message: payload?.message || body?.error?.message || `后台计算失败 HTTP ${res.status}`,
                };
            }
            return {
                success: true,
                processedData: payload.processed_data,
                baselineData: payload.baseline_data,
                recordMeta: payload.record_meta || {},
                loadScope:
                    payload.load_scope?.kind === 'full'
                        ? { kind: 'full' }
                        : payload.load_scope?.kind === 'year' && typeof payload.load_scope.year === 'number'
                            ? { kind: 'year', year: payload.load_scope.year }
                            : undefined,
                fullYearMonthlyTrends: payload.full_year_monthly_trends || [],
                dataVersion: payload.data_version,
                computedAt: payload.computed_at,
                message: '计算成功',
            };
        })
        .catch((e: unknown) => ({
            success: false,
            message: e instanceof Error ? e.message : '后台计算请求失败',
        }))
        .finally(() => {
            inFlightComputedDashboards.delete(key);
        });
    inFlightComputedDashboards.set(key, request);
    return request;
};

export const fetchCloudDraftComputedDashboard = async (
    config: CloudConfig,
    data: DashboardData,
    options: {
        year: number;
        quarter: 'All' | 'Q1' | 'Q2' | 'Q3' | 'Q4';
        billingSelectedMonth: string;
        quickMode?: boolean;
        includeCurrentMonthBilling?: boolean;
        includePrevYearTrends?: boolean;
    },
    draftPayloadOptions?: CloudDraftPayloadOptions,
): Promise<CloudComputedDraftDashboardResult> => {
    const projectId = projectIdFrom(config);
    if (!projectId) return { success: false, message: '缺少 project_id' };
    const auth = authHeaders();
    if (auth.error) return { success: false, message: auth.error };

    const dirtyPayload = dirtyPayloadHasChanges(draftPayloadOptions?.dirtyPayload)
        ? draftPayloadOptions.dirtyPayload
        : null;
    const draftIdentity = dirtyPayload
        ? [
            'dirty',
            draftPayloadOptions?.baseVersion ?? '',
            dirtyPayloadIdentityKey(dirtyPayload, draftPayloadOptions?.identityKey),
        ].join(':')
        : dashboardDraftIdentityKey(data);

    const key = [
        config.pocketbaseUrl || '',
        projectId,
        options.year,
        options.quarter,
        options.billingSelectedMonth,
        options.quickMode ? 'quick' : 'full',
        options.includeCurrentMonthBilling ? 'billing' : 'no-billing',
        options.includePrevYearTrends === false ? 'without-prev-year' : 'with-prev-year',
        draftIdentity,
    ].join('|');
    const existing = inFlightDraftComputedDashboards.get(key);
    if (existing) return existing;

    const request = fetch(getIntegrationAppDashboardDraftComputeUrl(), {
        method: 'POST',
        headers: auth.headers,
        body: JSON.stringify({
            project_id: projectId,
            year: options.year,
            quarter: options.quarter,
            billing_selected_month: options.billingSelectedMonth,
            quick_mode: options.quickMode === true,
            include_current_month_billing: options.includeCurrentMonthBilling === true,
            include_prev_year_trends: options.includePrevYearTrends !== false,
            ...(dirtyPayload
                ? {
                    draft_payload: dirtyPayload,
                    draft_base_version: draftPayloadOptions?.baseVersion ?? data.cloudSaveVersion ?? null,
                }
                : { draft_data: data }),
        }),
    })
        .then(async (res): Promise<CloudComputedDraftDashboardResult> => {
            const body = await res.json().catch(() => null) as {
                success?: boolean;
                data?: {
                    ok?: boolean;
                    processed_data?: DashboardData;
                    full_year_monthly_trends?: DashboardData['monthlyTrends'];
                    data_version?: number;
                    computed_at?: string;
                    message?: string;
                };
                error?: { message?: string };
            } | null;
            const payload = body?.data;
            if (!res.ok || body?.success === false || payload?.ok === false || !payload?.processed_data) {
                return {
                    success: false,
                    message: payload?.message || body?.error?.message || `后台草稿计算失败 HTTP ${res.status}`,
                };
            }
            return {
                success: true,
                processedData: payload.processed_data,
                fullYearMonthlyTrends: payload.full_year_monthly_trends || [],
                dataVersion: payload.data_version,
                computedAt: payload.computed_at,
                message: '计算成功',
            };
        })
        .catch((e: unknown) => ({
            success: false,
            message: e instanceof Error ? e.message : '后台草稿计算请求失败',
        }))
        .finally(() => {
            inFlightDraftComputedDashboards.delete(key);
        });
    inFlightDraftComputedDashboards.set(key, request);
    return request;
};

export const fetchCloudDraftComputedBilling = async (
    config: CloudConfig,
    data: DashboardData,
    options: { year: number; month: number },
    draftPayloadOptions?: CloudDraftPayloadOptions,
): Promise<CloudComputedBillingResult> => {
    const projectId = projectIdFrom(config);
    if (!projectId) return { success: false, message: '缺少 project_id' };
    const auth = authHeaders();
    if (auth.error) return { success: false, message: auth.error };

    const month = Math.max(1, Math.min(12, Math.floor(Number(options.month) || 1)));
    const year = Math.floor(Number(options.year) || new Date().getFullYear());
    const dirtyPayload = dirtyPayloadHasChanges(draftPayloadOptions?.dirtyPayload)
        ? draftPayloadOptions.dirtyPayload
        : null;
    const draftIdentity = dirtyPayload
        ? [
            'dirty',
            draftPayloadOptions?.baseVersion ?? '',
            dirtyPayloadIdentityKey(dirtyPayload, draftPayloadOptions?.identityKey),
        ].join(':')
        : dashboardDraftIdentityKey(data);
    const key = [config.pocketbaseUrl || '', projectId, year, month, draftIdentity].join('|');
    const existing = inFlightDraftComputedBillings.get(key);
    if (existing) return existing;

    const request = fetch(getIntegrationAppBillingDraftComputeUrl(), {
        method: 'POST',
        headers: auth.headers,
        body: JSON.stringify({
            project_id: projectId,
            year,
            month,
            ...(dirtyPayload
                ? {
                    draft_payload: dirtyPayload,
                    draft_base_version: draftPayloadOptions?.baseVersion ?? data.cloudSaveVersion ?? null,
                }
                : { draft_data: data }),
        }),
    })
        .then(async (res): Promise<CloudComputedBillingResult> => {
            const body = await res.json().catch(() => null) as {
                success?: boolean;
                data?: {
                    ok?: boolean;
                    billingDetails?: BillingDetail[];
                    billing_details?: BillingDetail[];
                    totalDue?: number;
                    total_due?: number;
                    totalPaid?: number;
                    total_paid?: number;
                    unpaidCount?: number;
                    unpaid_count?: number;
                    dataVersion?: number;
                    data_version?: number;
                    computedAt?: string;
                    computed_at?: string;
                    message?: string;
                };
                error?: { message?: string };
            } | null;
            const payload = body?.data;
            const billingDetails = payload?.billingDetails || payload?.billing_details;
            if (!res.ok || body?.success === false || payload?.ok === false || !billingDetails) {
                return {
                    success: false,
                    message: payload?.message || body?.error?.message || `后台草稿应收计算失败 HTTP ${res.status}`,
                };
            }
            return {
                success: true,
                billingDetails,
                totalDue: payload?.totalDue ?? payload?.total_due,
                totalPaid: payload?.totalPaid ?? payload?.total_paid,
                unpaidCount: payload?.unpaidCount ?? payload?.unpaid_count,
                dataVersion: payload?.dataVersion ?? payload?.data_version,
                computedAt: payload?.computedAt ?? payload?.computed_at,
                message: '计算成功',
            };
        })
        .catch((e: unknown) => ({
            success: false,
            message: e instanceof Error ? e.message : '后台草稿应收计算请求失败',
        }))
        .finally(() => {
            inFlightDraftComputedBillings.delete(key);
        });
    inFlightDraftComputedBillings.set(key, request);
    return request;
};

export const fetchCloudBudgetedBillsPreview = async (
    config: CloudConfig,
    input: CloudBudgetedBillsPreviewInput,
): Promise<CloudBudgetedBillsPreviewResult> => {
    const projectId = projectIdFrom(config);
    if (!projectId) return { success: false, message: '缺少 project_id' };
    const auth = authHeaders();
    if (auth.error) return { success: false, message: auth.error };

    const startDate = serializePreviewDate(input.startDate);
    const endDate = serializePreviewDate(input.endDate);
    const key = [
        config.pocketbaseUrl || '',
        projectId,
        objectIdentityKey(input.tenant),
        collectionIdentityKey(input.assumptions),
        collectionIdentityKey(input.adjustments),
        startDate,
        endDate,
        objectIdentityKey(input.options),
    ].join('|');
    const existing = inFlightBudgetedBillsPreviews.get(key);
    if (existing) return existing;

    const request = fetch(getIntegrationAppBudgetedBillsPreviewUrl(), {
        method: 'POST',
        headers: auth.headers,
        body: JSON.stringify({
            project_id: projectId,
            tenant: input.tenant,
            assumptions: input.assumptions || [],
            adjustments: input.adjustments || [],
            start_date: startDate,
            end_date: endDate,
            options: input.options,
        }),
    })
        .then(async (res): Promise<CloudBudgetedBillsPreviewResult> => {
            const body = await res.json().catch(() => null) as {
                success?: boolean;
                data?: {
                    ok?: boolean;
                    bills?: unknown;
                    count?: number;
                    computedAt?: string;
                    computed_at?: string;
                    message?: string;
                };
                error?: { message?: string };
            } | null;
            const payload = body?.data;
            const bills = parsePreviewBills(payload?.bills);
            if (!res.ok || body?.success === false || payload?.ok === false || !payload || !Array.isArray(payload.bills)) {
                return {
                    success: false,
                    message: payload?.message || body?.error?.message || `后台账单预览计算失败 HTTP ${res.status}`,
                };
            }
            return {
                success: true,
                bills,
                count: payload.count ?? bills.length,
                computedAt: payload.computedAt ?? payload.computed_at,
                message: '计算成功',
            };
        })
        .catch((e: unknown) => ({
            success: false,
            message: e instanceof Error ? e.message : '后台账单预览计算请求失败',
        }))
        .finally(() => {
            inFlightBudgetedBillsPreviews.delete(key);
        });
    inFlightBudgetedBillsPreviews.set(key, request);
    return request;
};

export const fetchCloudBudgetedBillsPreviewBatch = async (
    config: CloudConfig,
    input: CloudBudgetedBillsPreviewBatchInput,
): Promise<CloudBudgetedBillsPreviewBatchResult> => {
    const projectId = projectIdFrom(config);
    if (!projectId) return { success: false, message: '缺少 project_id' };
    const auth = authHeaders();
    if (auth.error) return { success: false, message: auth.error };
    if (!Array.isArray(input.items) || input.items.length === 0) return { success: false, message: '缺少 items' };

    const payload = {
        project_id: projectId,
        items: input.items.map((item, index) => ({
            id: item.id || item.tenant.id || String(index),
            tenant: item.tenant,
            assumptions: item.assumptions || [],
            adjustments: item.adjustments || [],
            start_date: serializePreviewDate(item.startDate),
            end_date: serializePreviewDate(item.endDate),
            options: item.options,
        })),
    };
    const key = [
        config.pocketbaseUrl || '',
        projectId,
        input.items.map((item, index) => [
            item.id || item.tenant.id || String(index),
            objectIdentityKey(item.tenant),
            collectionIdentityKey(item.assumptions),
            collectionIdentityKey(item.adjustments),
            serializePreviewDate(item.startDate),
            serializePreviewDate(item.endDate),
            objectIdentityKey(item.options),
        ].join(':')).join('|'),
    ].join('|');
    const existing = inFlightBudgetedBillsPreviewBatches.get(key);
    if (existing) return existing;

    const request = fetch(getIntegrationAppBudgetedBillsPreviewBatchUrl(), {
        method: 'POST',
        headers: auth.headers,
        body: JSON.stringify(payload),
    })
        .then(async (res): Promise<CloudBudgetedBillsPreviewBatchResult> => {
            const body = await res.json().catch(() => null) as {
                success?: boolean;
                data?: {
                    ok?: boolean;
                    items?: Array<{ id?: string; bills?: unknown; count?: number }>;
                    count?: number;
                    computedAt?: string;
                    computed_at?: string;
                    message?: string;
                };
                error?: { message?: string };
            } | null;
            const payload = body?.data;
            if (!res.ok || body?.success === false || payload?.ok === false || !payload || !Array.isArray(payload.items)) {
                return {
                    success: false,
                    message: payload?.message || body?.error?.message || `后台批量账单预览计算失败 HTTP ${res.status}`,
                };
            }
            const items = payload.items.map((item, index) => {
                const bills = parsePreviewBills(item.bills);
                return { id: String(item.id || index), bills, count: item.count ?? bills.length };
            });
            return {
                success: true,
                items,
                count: payload.count ?? items.length,
                computedAt: payload.computedAt ?? payload.computed_at,
                message: '计算成功',
            };
        })
        .catch((e: unknown) => ({
            success: false,
            message: e instanceof Error ? e.message : '后台批量账单预览计算请求失败',
        }))
        .finally(() => {
            inFlightBudgetedBillsPreviewBatches.delete(key);
        });
    inFlightBudgetedBillsPreviewBatches.set(key, request);
    return request;
};

export const fetchCloudContractReceivableMonthly = async (
    config: CloudConfig,
    input: CloudContractReceivableMonthlyInput,
): Promise<CloudContractReceivableMonthlyResult> => {
    const projectId = projectIdFrom(config);
    if (!projectId) return { success: false, message: '缺少 project_id' };
    const auth = authHeaders();
    if (auth.error) return { success: false, message: auth.error };

    const year = Math.floor(Number(input.year) || new Date().getFullYear());
    const key = [
        config.pocketbaseUrl || '',
        projectId,
        year,
        collectionIdentityKey(input.tenants),
        collectionIdentityKey(input.buildings),
        collectionIdentityKey(input.payments),
        collectionIdentityKey(input.initializationData),
        collectionIdentityKey(input.budgetAssumptions),
        collectionIdentityKey(input.budgetAdjustments),
        collectionIdentityKey(input.budgetScenarios),
    ].join('|');
    const existing = inFlightContractReceivableMonthlies.get(key);
    if (existing) return existing;

    const request = fetch(getIntegrationAppContractReceivableMonthlyUrl(), {
        method: 'POST',
        headers: auth.headers,
        body: JSON.stringify({
            project_id: projectId,
            year,
            tenants: input.tenants || [],
            buildings: input.buildings || [],
            payments: input.payments || [],
            initialization_data: input.initializationData || [],
            budget_assumptions: input.budgetAssumptions || [],
            budget_adjustments: input.budgetAdjustments || [],
            budget_scenarios: input.budgetScenarios || [],
        }),
    })
        .then(async (res): Promise<CloudContractReceivableMonthlyResult> => {
            const body = await res.json().catch(() => null) as {
                success?: boolean;
                data?: {
                    ok?: boolean;
                    months?: Array<{
                        month?: number;
                        totalAmountDue?: number;
                        total_amount_due?: number;
                        byTenantId?: Array<{ tenantId?: string; tenant_id?: string; amount?: number }>;
                        by_tenant_id?: Array<{ tenantId?: string; tenant_id?: string; amount?: number }>;
                    }>;
                    computedAt?: string;
                    computed_at?: string;
                    message?: string;
                };
                error?: { message?: string };
            } | null;
            const payload = body?.data;
            if (!res.ok || body?.success === false || payload?.ok === false || !payload || !Array.isArray(payload.months)) {
                return {
                    success: false,
                    message: payload?.message || body?.error?.message || `后台合同应收月度汇总失败 HTTP ${res.status}`,
                };
            }
            return {
                success: true,
                months: payload.months.map((month) => ({
                    month: Math.max(1, Math.min(12, Math.floor(Number(month.month) || 1))),
                    totalAmountDue: Number(month.totalAmountDue ?? month.total_amount_due ?? 0),
                    byTenantId: (month.byTenantId || month.by_tenant_id || []).map((item) => ({
                        tenantId: String(item.tenantId || item.tenant_id || ''),
                        amount: Number(item.amount || 0),
                    })).filter((item) => item.tenantId),
                })),
                computedAt: payload.computedAt ?? payload.computed_at,
                message: '计算成功',
            };
        })
        .catch((e: unknown) => ({
            success: false,
            message: e instanceof Error ? e.message : '后台合同应收月度汇总请求失败',
        }))
        .finally(() => {
            inFlightContractReceivableMonthlies.delete(key);
        });
    inFlightContractReceivableMonthlies.set(key, request);
    return request;
};

export const fetchCloudSourceAgentMetrics = async (
    config: CloudConfig,
    input: CloudSourceAgentMetricsInput,
): Promise<CloudSourceAgentMetricsResult> => {
    const projectId = projectIdFrom(config);
    if (!projectId) return { success: false, message: '缺少 project_id' };
    const auth = authHeaders();
    if (auth.error) return { success: false, message: auth.error };

    const period = input.period || 'All';
    const referenceKey = referenceDateDayKey(input.referenceDate);
    const key = [config.pocketbaseUrl || '', projectId, period, referenceKey, collectionIdentityKey(input.tenants)].join('|');
    const existing = inFlightSourceAgentMetrics.get(key);
    if (existing) return existing;

    const request = fetch(getIntegrationAppSourceAgentMetricsUrl(), {
        method: 'POST',
        headers: auth.headers,
        body: JSON.stringify({
            project_id: projectId,
            tenants: input.tenants || [],
            period,
            reference_date: input.referenceDate ? serializePreviewDate(input.referenceDate) : undefined,
        }),
    })
        .then(async (res): Promise<CloudSourceAgentMetricsResult> => {
            const body = await res.json().catch(() => null) as {
                success?: boolean;
                data?: {
                    ok?: boolean;
                    summary?: SourceAnalysisSummary;
                    computedAt?: string;
                    computed_at?: string;
                    message?: string;
                };
                error?: { message?: string };
            } | null;
            const payload = body?.data;
            if (!res.ok || body?.success === false || payload?.ok === false || !payload?.summary) {
                return {
                    success: false,
                    message: payload?.message || body?.error?.message || `后台来源分析计算失败 HTTP ${res.status}`,
                };
            }
            return {
                success: true,
                summary: payload.summary,
                computedAt: payload.computedAt ?? payload.computed_at,
                message: '计算成功',
            };
        })
        .catch((e: unknown) => ({
            success: false,
            message: e instanceof Error ? e.message : '后台来源分析计算请求失败',
        }))
        .finally(() => {
            inFlightSourceAgentMetrics.delete(key);
        });
    inFlightSourceAgentMetrics.set(key, request);
    return request;
};

export const fetchCloudContractAnalysisMetrics = async (
    config: CloudConfig,
    input: CloudContractAnalysisMetricsInput,
): Promise<CloudContractAnalysisMetricsResult> => {
    const projectId = projectIdFrom(config);
    if (!projectId) return { success: false, message: '缺少 project_id' };
    const auth = authHeaders();
    if (auth.error) return { success: false, message: auth.error };

    const period = input.period || 'Year';
    const referenceKey = referenceDateDayKey(input.referenceDate);
    const key = [config.pocketbaseUrl || '', projectId, period, referenceKey, collectionIdentityKey(input.tenants)].join('|');
    const existing = inFlightContractAnalysisMetrics.get(key);
    if (existing) return existing;

    const request = fetch(getIntegrationAppContractAnalysisMetricsUrl(), {
        method: 'POST',
        headers: auth.headers,
        body: JSON.stringify({
            project_id: projectId,
            tenants: input.tenants || [],
            period,
            reference_date: input.referenceDate ? serializePreviewDate(input.referenceDate) : undefined,
        }),
    })
        .then(async (res): Promise<CloudContractAnalysisMetricsResult> => {
            const body = await res.json().catch(() => null) as {
                success?: boolean;
                data?: {
                    ok?: boolean;
                    metrics?: ContractAnalysisMetrics;
                    computedAt?: string;
                    computed_at?: string;
                    message?: string;
                };
                error?: { message?: string };
            } | null;
            const payload = body?.data;
            if (!res.ok || body?.success === false || payload?.ok === false || !payload?.metrics) {
                return {
                    success: false,
                    message: payload?.message || body?.error?.message || `后台合同分析计算失败 HTTP ${res.status}`,
                };
            }
            return {
                success: true,
                metrics: payload.metrics,
                computedAt: payload.computedAt ?? payload.computed_at,
                message: '计算成功',
            };
        })
        .catch((e: unknown) => ({
            success: false,
            message: e instanceof Error ? e.message : '后台合同分析计算请求失败',
        }))
        .finally(() => {
            inFlightContractAnalysisMetrics.delete(key);
        });
    inFlightContractAnalysisMetrics.set(key, request);
    return request;
};

export const fetchCloudTenantHistoricalArrears = async (
    config: CloudConfig,
    input: { referenceDate?: string | Date } = {},
): Promise<CloudTenantHistoricalArrearsResult> => {
    const projectId = projectIdFrom(config);
    if (!projectId) return { success: false, message: '缺少 project_id' };
    const auth = authHeaders();
    if (auth.error) return { success: false, message: auth.error };

    const referenceKey = referenceDateDayKey(input.referenceDate);
    const key = [config.pocketbaseUrl || '', projectId, referenceKey].join('|');
    const existing = inFlightTenantHistoricalArrears.get(key);
    if (existing) return existing;

    const request = fetch(getIntegrationAppTenantHistoricalArrearsUrl(), {
        method: 'POST',
        headers: auth.headers,
        body: JSON.stringify({
            project_id: projectId,
            reference_date: input.referenceDate ? serializePreviewDate(input.referenceDate) : undefined,
        }),
    })
        .then(async (res): Promise<CloudTenantHistoricalArrearsResult> => {
            const body = await res.json().catch(() => null) as {
                success?: boolean;
                data?: {
                    ok?: boolean;
                    available?: boolean;
                    items?: Array<{
                        tenantId?: string;
                        tenant_id?: string;
                        amount?: number;
                        months?: number;
                        latestPeriod?: string;
                        latest_period?: string;
                    }>;
                    startPeriod?: string;
                    start_period?: string;
                    endPeriod?: string;
                    end_period?: string;
                    unavailableReason?: string;
                    unavailable_reason?: string;
                    dataVersion?: number;
                    data_version?: number;
                    computedAt?: string;
                    computed_at?: string;
                    message?: string;
                };
                error?: { message?: string };
            } | null;
            const payload = body?.data;
            if (!res.ok || body?.success === false || payload?.ok === false || !payload) {
                return {
                    success: false,
                    message: payload?.message || body?.error?.message || `后台客户历史欠费计算失败 HTTP ${res.status}`,
                };
            }

            const startPeriod = payload.startPeriod ?? payload.start_period;
            const endPeriod = payload.endPeriod ?? payload.end_period;
            const unavailableReason = payload.unavailableReason ?? payload.unavailable_reason;
            const computedAt = payload.computedAt ?? payload.computed_at;
            const dataVersion = payload.dataVersion ?? payload.data_version;

            if (payload.available === false) {
                return {
                    success: true,
                    available: false,
                    byTenantId: new Map(),
                    items: [],
                    startPeriod,
                    endPeriod,
                    unavailableReason,
                    dataVersion,
                    computedAt,
                    message: payload.message || unavailableReason || '客户历史欠费暂不可用',
                };
            }

            if (!Array.isArray(payload.items)) {
                return {
                    success: false,
                    available: false,
                    message: payload.message || '后台客户历史欠费缺少 items',
                };
            }

            const items = payload.items
                .map((item) => ({
                    tenantId: String(item.tenantId || item.tenant_id || ''),
                    amount: Number(item.amount || 0),
                    months: Math.max(0, Math.floor(Number(item.months) || 0)),
                    latestPeriod: item.latestPeriod || item.latest_period,
                }))
                .filter((item) => item.tenantId);
            const byTenantId = new Map<string, TenantHistoricalArrearsSummary>();
            items.forEach((item) => {
                byTenantId.set(item.tenantId, {
                    amount: item.amount,
                    months: item.months,
                    latestPeriod: item.latestPeriod,
                });
            });
            return {
                success: true,
                available: true,
                byTenantId,
                items,
                startPeriod,
                endPeriod,
                dataVersion,
                computedAt,
                message: '计算成功',
            };
        })
        .catch((e: unknown) => ({
            success: false,
            message: e instanceof Error ? e.message : '后台客户历史欠费计算请求失败',
        }))
        .finally(() => {
            inFlightTenantHistoricalArrears.delete(key);
        });
    inFlightTenantHistoricalArrears.set(key, request);
    return request;
};

export const fetchCloudComputedBilling = async (
    config: CloudConfig,
    options: { year: number; month: number },
): Promise<CloudComputedBillingResult> => {
    const projectId = projectIdFrom(config);
    if (!projectId) return { success: false, message: '缺少 project_id' };
    const auth = authHeaders();
    if (auth.error) return { success: false, message: auth.error };

    const month = Math.max(1, Math.min(12, Math.floor(Number(options.month) || 1)));
    const key = [config.pocketbaseUrl || '', projectId, Math.floor(Number(options.year) || new Date().getFullYear()), month].join('|');
    const existing = inFlightComputedBillings.get(key);
    if (existing) return existing;

    const request = fetch(getIntegrationAppBillingComputeUrl(), {
        method: 'POST',
        headers: auth.headers,
        body: JSON.stringify({ project_id: projectId, year: options.year, month }),
    })
        .then(async (res): Promise<CloudComputedBillingResult> => {
            const body = await res.json().catch(() => null) as {
                success?: boolean;
                data?: {
                    ok?: boolean;
                    billingDetails?: BillingDetail[];
                    billing_details?: BillingDetail[];
                    totalDue?: number;
                    total_due?: number;
                    totalPaid?: number;
                    total_paid?: number;
                    unpaidCount?: number;
                    unpaid_count?: number;
                    dataVersion?: number;
                    data_version?: number;
                    computedAt?: string;
                    computed_at?: string;
                    message?: string;
                };
                error?: { message?: string };
            } | null;
            const payload = body?.data;
            const billingDetails = payload?.billingDetails || payload?.billing_details;
            if (!res.ok || body?.success === false || payload?.ok === false || !Array.isArray(billingDetails)) {
                return {
                    success: false,
                    message: payload?.message || body?.error?.message || `后台应收计算失败 HTTP ${res.status}`,
                };
            }
            return {
                success: true,
                billingDetails,
                totalDue: payload?.totalDue ?? payload?.total_due,
                totalPaid: payload?.totalPaid ?? payload?.total_paid,
                unpaidCount: payload?.unpaidCount ?? payload?.unpaid_count,
                dataVersion: payload?.dataVersion ?? payload?.data_version,
                computedAt: payload?.computedAt ?? payload?.computed_at,
                message: '计算成功',
            };
        })
        .catch((e: unknown) => ({
            success: false,
            message: e instanceof Error ? e.message : '后台应收计算请求失败',
        }))
        .finally(() => {
            inFlightComputedBillings.delete(key);
        });
    inFlightComputedBillings.set(key, request);
    return request;
};

export const fetchCloudBigScreenData = async (
    config: CloudConfig,
    options: { year: number; billingMonth: string; parkIds?: string[] },
): Promise<{ success: boolean; data?: BigScreenData; message: string }> => {
    const auth = authHeaders();
    if (auth.error) return { success: false, message: auth.error };
    const parkIds = [...new Set((options.parkIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
    const key = [config.pocketbaseUrl || '', options.year, options.billingMonth, parkIds.join(',')].join('|');
    const existing = inFlightBigScreenData.get(key);
    if (existing) return existing;

    const request = fetch(getIntegrationAppBigScreenUrl(), {
        method: 'POST',
        headers: auth.headers,
        body: JSON.stringify({
            year: options.year,
            billing_month: options.billingMonth,
            park_ids: parkIds,
        }),
    })
        .then(async (res): Promise<{ success: boolean; data?: BigScreenData; message: string }> => {
            const body = await res.json().catch(() => null) as {
                success?: boolean;
                data?: {
                    ok?: boolean;
                    big_screen_data?: BigScreenData;
                    requested_park_count?: number;
                    skipped_park_count?: number;
                    message?: string;
                };
                error?: { message?: string };
            } | null;
            const payload = body?.data;
            if (!res.ok || body?.success === false || payload?.ok === false || !payload?.big_screen_data) {
                return {
                    success: false,
                    message: payload?.message || body?.error?.message || `大屏数据计算失败 HTTP ${res.status}`,
                };
            }
            const requestedCount = Number(payload.requested_park_count || 0);
            const skippedCount = Number(payload.skipped_park_count || 0);
            if (requestedCount > 0 && skippedCount > 0) {
                return {
                    success: false,
                    message: payload.message || '部分园区大屏数据计算失败，已回退逐园区数据源',
                };
            }
            return { success: true, data: payload.big_screen_data, message: '加载成功' };
        })
        .catch((e: unknown) => ({
            success: false,
            message: e instanceof Error ? e.message : '大屏数据请求失败',
        }))
        .finally(() => {
            inFlightBigScreenData.delete(key);
        });
    inFlightBigScreenData.set(key, request);
    return request;
};
