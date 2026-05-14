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
import type { DashboardData, MonthlyTrend, BillingDetail } from '../types';
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

    const fetchRes = await fetchPocketBaseBackup(projectId);
    if (!fetchRes.success || !fetchRes.data) {
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
    month: number;
    billingDetails: BillingDetail[];
    totalDue: number;
    totalPaid: number;
    unpaidCount: number;
    computedAt: string;
}

/** 为指定月份计算应收明细 */
export async function computeBilling(
    projectId: string,
    year: number,
    month: number, // 0-11
): Promise<ComputeBillingResult> {
    await ensureInit();

    const fetchRes = await fetchPocketBaseBackup(projectId);
    if (!fetchRes.success || !fetchRes.data) {
        return {
            ok: false,
            projectId,
            year,
            month,
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

    return {
        ok: true,
        projectId,
        year,
        month,
        billingDetails: details,
        totalDue: Math.round(totalDue * 100) / 100,
        totalPaid: Math.round(totalPaid * 100) / 100,
        unpaidCount,
        computedAt: new Date().toISOString(),
    };
}
