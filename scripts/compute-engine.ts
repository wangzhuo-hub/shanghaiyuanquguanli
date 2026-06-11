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

import { initPocketBase, authenticatePocketBase, fetchPocketBaseBackup } from '../services/pocketbaseService';
import type { RecordMeta } from '../services/pocketbaseService';
import {
    calculateDashboardMetrics,
    buildKpiSummaryFromProcessedData,
    normalizeKpiSummaryWithMonthlyTrends,
    type DashboardMetricOptions,
} from '../services/dashboardMetrics';
import {
    normalizeReceivableRemaining,
    parsePaymentPeriodYYYYMMs,
    paymentTenantMatchesBillingTenant,
    receivableBudgetDisplay,
} from '../services/receivableListHelpers';
import { roundMoney2 } from '../services/numberFormat';
import type { DashboardData, MonthlyTrend, BillingDetail, PaymentRecord, Tenant } from '../types';
import type { KpiSnapshotSummary } from '../services/pocketbaseService';

// ── 配置 ──

const PB_URL = process.env.PB_URL || 'http://127.0.0.1:8090';
const ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL || '';
const ADMIN_PASSWORD = process.env.PB_ADMIN_PASSWORD || '';

let initialized = false;

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
        };
    }

    const rawData = fetchRes.data;
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
