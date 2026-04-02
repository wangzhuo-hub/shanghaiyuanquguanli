import type { DashboardData, MonthlyTrend } from '../types';

/**
 * 与看板「预算执行 / 年度指标」同源口径的快照，供 OpenClaw 等每日只读拉取。
 * 月度累计达成率算法与 components/StatsCards.tsx 中 monthlyBreakdown 一致。
 */
export type OpenClawKpiSnapshot = {
    schema_version: 1;
    generated_at: string;
    project_id: string;
    /** 看板当前统计年度（与界面「统计年度」一致） */
    stats_year: number;
    /** 生成快照时的公历年、月（用于解读「当月」指标） */
    calendar_year: number;
    calendar_month: number;

    /** 年度营收目标（元），来自 pb_yearly_targets / yearlyTargets */
    annual_revenue_goal_yuan: number;
    annual_occupancy_goal_pct: number;

    /** 12 个月度预算收入之和（元），与预算执行表预算列合计一致 */
    annual_budget_revenue_sum_yuan: number;
    /** 全年实收合计（元）；未到月或未来月份按 0 计入（与 App 内 reduce 一致） */
    annual_revenue_collected_yuan: number;

    /** 相对「年度营收目标」：实收/目标，同右栏「营收达成」 */
    annual_goal_completion_rate_pct: number;
    /** 相对「月度预算之和」：全年实收/全年月度预算合计 */
    annual_budget_completion_rate_pct: number;

    /** 截至公历当月（含）在 stats_year 内的预算与实收；历史年为全年 */
    ytd_budget_revenue_yuan: number;
    ytd_revenue_collected_yuan: number;
    ytd_completion_rate_pct: number;

    /** 公历「当月」在统计年内时的月份 1–12，否则为 null */
    current_month_index: number | null;
    current_month_budget_yuan: number | null;
    current_month_collected_yuan: number | null;
    /** 当月收缴率：当月实收/当月预算（无实收数据时为 null） */
    current_month_collection_rate_pct: number | null;

    occupancy_rate_current_pct: number;
    accumulated_arrears_yuan: number;
    cloud_save_version: number;

    monthly: Array<{
        month_index: number;
        month_label: string;
        revenue_target_yuan: number;
        revenue_collected_yuan: number | null;
        monthly_completion_rate_pct: number | null;
        cumulative_collected_yuan: number;
        cumulative_budget_yuan: number;
        cumulative_completion_rate_pct: number;
    }>;
};

export function buildOpenClawKpiSnapshot(
    dashboard: DashboardData,
    fullYearMonthlyTrends: MonthlyTrend[],
    context: { statsYear: number; projectId: string; generatedAt?: Date }
): OpenClawKpiSnapshot {
    const generatedAt = (context.generatedAt ?? new Date()).toISOString();
    const wall = context.generatedAt ?? new Date();
    const calYear = wall.getFullYear();
    const calMonth = wall.getMonth() + 1;

    const annualRevenueGoalYuan = dashboard.annualRevenueTarget;
    const annualOccupancyGoalPct = dashboard.annualOccupancyTarget;

    const trends: MonthlyTrend[] = fullYearMonthlyTrends.slice(0, 12);
    while (trends.length < 12) {
        const m = trends.length + 1;
        trends.push({
            month: `${m}月`,
            occupancyRate: 0,
            revenueTarget: 0,
            revenueCollected: null,
            avgUnitPrice: 0,
            collectionRate: null,
        });
    }

    let cumulativeCollected = 0;
    let cumulativeBudget = 0;
    const monthly: OpenClawKpiSnapshot['monthly'] = [];

    for (let i = 0; i < 12; i++) {
        const trend = trends[i];
        const budget = trend?.revenueTarget ?? 0;
        const actual = trend?.revenueCollected;
        const hasActual = actual !== null && actual !== undefined;

        if (hasActual) cumulativeCollected += actual as number;
        cumulativeBudget += budget;

        const monthlyRate =
            budget > 0 && hasActual ? Math.round(((actual as number) / budget) * 1000) / 10 : null;
        const cumulativeProgress =
            cumulativeBudget > 0 ? Math.round((cumulativeCollected / cumulativeBudget) * 10000) / 100 : 0;

        monthly.push({
            month_index: i + 1,
            month_label: trend?.month ?? `${i + 1}月`,
            revenue_target_yuan: budget,
            revenue_collected_yuan: hasActual ? (actual as number) : null,
            monthly_completion_rate_pct: monthlyRate,
            cumulative_collected_yuan: cumulativeCollected,
            cumulative_budget_yuan: cumulativeBudget,
            cumulative_completion_rate_pct: cumulativeProgress,
        });
    }

    const annualBudgetSumYuan = trends.reduce((s, t) => s + (t?.revenueTarget ?? 0), 0);
    const annualCollectedYuan = trends.reduce((s, t) => s + (t?.revenueCollected ?? 0), 0);

    const annualGoalCompletionPct =
        annualRevenueGoalYuan > 0
            ? Math.min(100, Math.round((annualCollectedYuan / annualRevenueGoalYuan) * 1000) / 10)
            : 0;
    const annualBudgetCompletionPct =
        annualBudgetSumYuan > 0
            ? Math.min(100, Math.round((annualCollectedYuan / annualBudgetSumYuan) * 1000) / 10)
            : 0;

    let ytdEndMonth = 12;
    if (context.statsYear > calYear) ytdEndMonth = 0;
    else if (context.statsYear === calYear) ytdEndMonth = calMonth;

    let ytdBudget = 0;
    let ytdCollected = 0;
    for (let i = 0; i < ytdEndMonth; i++) {
        const tr = trends[i];
        ytdBudget += tr?.revenueTarget ?? 0;
        const a = tr?.revenueCollected;
        if (a !== null && a !== undefined) ytdCollected += a;
    }
    const ytdCompletionPct =
        ytdBudget > 0 ? Math.min(100, Math.round((ytdCollected / ytdBudget) * 10000) / 100) : 0;

    let currentMonthBudget: number | null = null;
    let currentMonthCollected: number | null = null;
    let currentMonthRate: number | null = null;
    if (context.statsYear === calYear && calMonth >= 1 && calMonth <= 12) {
        const tr = trends[calMonth - 1];
        currentMonthBudget = tr?.revenueTarget ?? 0;
        const a = tr?.revenueCollected;
        if (a !== null && a !== undefined) {
            currentMonthCollected = a;
            currentMonthRate =
                currentMonthBudget > 0 ? Math.round((a / currentMonthBudget) * 1000) / 10 : 0;
        }
    }

    return {
        schema_version: 1,
        generated_at: generatedAt,
        project_id: context.projectId,
        stats_year: context.statsYear,
        calendar_year: calYear,
        calendar_month: calMonth,
        annual_revenue_goal_yuan: annualRevenueGoalYuan,
        annual_occupancy_goal_pct: annualOccupancyGoalPct,
        annual_budget_revenue_sum_yuan: annualBudgetSumYuan,
        annual_revenue_collected_yuan: annualCollectedYuan,
        annual_goal_completion_rate_pct: annualGoalCompletionPct,
        annual_budget_completion_rate_pct: annualBudgetCompletionPct,
        ytd_budget_revenue_yuan: ytdBudget,
        ytd_revenue_collected_yuan: ytdCollected,
        ytd_completion_rate_pct: ytdCompletionPct,
        current_month_index: context.statsYear === calYear ? calMonth : null,
        current_month_budget_yuan: currentMonthBudget,
        current_month_collected_yuan: currentMonthCollected,
        current_month_collection_rate_pct: currentMonthRate,
        occupancy_rate_current_pct: dashboard.occupancyRate,
        accumulated_arrears_yuan: dashboard.accumulatedArrears,
        cloud_save_version: dashboard.cloudSaveVersion ?? 0,
        monthly,
    };
}
