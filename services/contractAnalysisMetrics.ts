import { ContractStatus, type Tenant } from '../types';

export type ContractAnalysisPeriod = 'Year' | 'Quarter' | 'Month';

export type ContractAnalysisMetrics = {
    metrics: {
        signedCount: number;
        signedArea: number;
        terminatedCount: number;
        terminatedArea: number;
        netArea: number;
    };
    mom: { area: number; count: number };
    yoy: { area: number; count: number };
    reasons: Array<{ name: string; value: number }>;
    earlyRate: number;
    trend: Array<{ month: string; newArea: number; lostArea: number; netArea: number }>;
    terminationStats: {
        all: number;
        year: number;
        quarter: number;
        month: number;
        earlyCount: number;
        normalCount: number;
    };
    terminationTypeData: Array<{ name: string; value: number }>;
};

type PeriodParts = {
    year: number;
    month: number;
    quarter: number;
};

type PeriodTarget = {
    period: ContractAnalysisPeriod;
    year: number;
    month?: number;
    quarter?: number;
};

type MutablePeriodMetrics = {
    signedCount: number;
    signedArea: number;
    terminatedCount: number;
    terminatedArea: number;
};

type MutableTrendRow = {
    month: string;
    newArea: number;
    lostArea: number;
    netArea: number;
};

export const EMPTY_CONTRACT_ANALYSIS_METRICS: ContractAnalysisMetrics = {
    metrics: {
        signedCount: 0,
        signedArea: 0,
        terminatedCount: 0,
        terminatedArea: 0,
        netArea: 0,
    },
    mom: { area: 0, count: 0 },
    yoy: { area: 0, count: 0 },
    reasons: [],
    earlyRate: 0,
    trend: [],
    terminationStats: {
        all: 0,
        year: 0,
        quarter: 0,
        month: 0,
        earlyCount: 0,
        normalCount: 0,
    },
    terminationTypeData: [],
};

const emptyMutableMetrics = (): MutablePeriodMetrics => ({
    signedCount: 0,
    signedArea: 0,
    terminatedCount: 0,
    terminatedArea: 0,
});

const parsePeriodParts = (dateStr?: string): PeriodParts | null => {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    return {
        year: d.getFullYear(),
        month: d.getMonth(),
        quarter: Math.floor(d.getMonth() / 3),
    };
};

const resolveTargetPeriod = (
    nowParts: PeriodParts,
    period: ContractAnalysisPeriod,
    offsetYear = 0,
    offsetPeriod = 0,
): PeriodTarget => {
    let targetYear = nowParts.year + offsetYear;

    if (period === 'Year') {
        return { period, year: targetYear };
    }

    if (period === 'Quarter') {
        let targetQuarter = nowParts.quarter + offsetPeriod;
        while (targetQuarter < 0) {
            targetQuarter += 4;
            targetYear -= 1;
        }
        while (targetQuarter > 3) {
            targetQuarter -= 4;
            targetYear += 1;
        }
        return { period, year: targetYear, quarter: targetQuarter };
    }

    let targetMonth = nowParts.month + offsetPeriod;
    while (targetMonth < 0) {
        targetMonth += 12;
        targetYear -= 1;
    }
    while (targetMonth > 11) {
        targetMonth -= 12;
        targetYear += 1;
    }
    return { period, year: targetYear, month: targetMonth };
};

const matchesTarget = (parts: PeriodParts | null, target: PeriodTarget): boolean => {
    if (!parts || parts.year !== target.year) return false;
    if (target.period === 'Year') return true;
    if (target.period === 'Quarter') return parts.quarter === target.quarter;
    return parts.month === target.month;
};

const monthKey = (parts: PeriodParts | null): string => {
    if (!parts) return '';
    return `${parts.year}-${String(parts.month + 1).padStart(2, '0')}`;
};

const finalizeMetrics = (metrics: MutablePeriodMetrics): ContractAnalysisMetrics['metrics'] => {
    const signedArea = Math.round(metrics.signedArea);
    const terminatedArea = Math.round(metrics.terminatedArea);
    return {
        signedCount: metrics.signedCount,
        signedArea,
        terminatedCount: metrics.terminatedCount,
        terminatedArea,
        netArea: Math.round(metrics.signedArea - metrics.terminatedArea),
    };
};

const getChange = (curr: number, prev: number): number => {
    if (prev === 0) return curr > 0 ? 100 : 0;
    return ((curr - prev) / prev) * 100;
};

const addSigned = (metrics: MutablePeriodMetrics, area: number): void => {
    metrics.signedCount += 1;
    metrics.signedArea += area;
};

const addTerminated = (metrics: MutablePeriodMetrics, area: number): void => {
    metrics.terminatedCount += 1;
    metrics.terminatedArea += area;
};

export function buildContractAnalysisMetrics(
    tenants: Tenant[],
    analysisPeriod: ContractAnalysisPeriod,
    now: Date = new Date(),
): ContractAnalysisMetrics {
    if (tenants.length === 0) return EMPTY_CONTRACT_ANALYSIS_METRICS;

    const nowParts: PeriodParts = {
        year: now.getFullYear(),
        month: now.getMonth(),
        quarter: Math.floor(now.getMonth() / 3),
    };

    const currentTarget = resolveTargetPeriod(nowParts, analysisPeriod);
    const prevPeriodTarget = resolveTargetPeriod(
        nowParts,
        analysisPeriod,
        analysisPeriod === 'Year' ? -1 : 0,
        analysisPeriod === 'Year' ? 0 : -1,
    );
    const prevYearTarget = resolveTargetPeriod(nowParts, analysisPeriod, -1, 0);
    const yearTarget = resolveTargetPeriod(nowParts, 'Year');
    const quarterTarget = resolveTargetPeriod(nowParts, 'Quarter');
    const monthTarget = resolveTargetPeriod(nowParts, 'Month');

    const current = emptyMutableMetrics();
    const prevPeriod = emptyMutableMetrics();
    const prevYear = emptyMutableMetrics();
    const reasonMap: Record<string, number> = {};
    const trendRows: MutableTrendRow[] = [];
    const trendByMonth = new Map<string, MutableTrendRow>();

    for (let i = 11; i >= 0; i -= 1) {
        const d = new Date(nowParts.year, nowParts.month - i, 1);
        const label = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const row = { month: label, newArea: 0, lostArea: 0, netArea: 0 };
        trendRows.push(row);
        trendByMonth.set(label, row);
    }

    let terminatedAll = 0;
    let terminatedYear = 0;
    let terminatedQuarter = 0;
    let terminatedMonth = 0;
    let earlyCount = 0;

    for (const tenant of tenants) {
        const area = tenant.totalArea;
        const signedParts = parsePeriodParts(tenant.signingDate || tenant.leaseStart);

        if (matchesTarget(signedParts, currentTarget)) addSigned(current, area);
        if (matchesTarget(signedParts, prevPeriodTarget)) addSigned(prevPeriod, area);
        if (matchesTarget(signedParts, prevYearTarget)) addSigned(prevYear, area);

        const signedTrend = trendByMonth.get(monthKey(signedParts));
        if (signedTrend) signedTrend.newArea += area;

        if (tenant.status !== ContractStatus.Terminated) continue;

        const terminatedParts = parsePeriodParts(tenant.terminationDate || tenant.leaseEnd);
        terminatedAll += 1;

        if (matchesTarget(terminatedParts, currentTarget)) addTerminated(current, area);
        if (matchesTarget(terminatedParts, prevPeriodTarget)) addTerminated(prevPeriod, area);
        if (matchesTarget(terminatedParts, prevYearTarget)) addTerminated(prevYear, area);
        if (matchesTarget(terminatedParts, yearTarget)) terminatedYear += 1;
        if (matchesTarget(terminatedParts, quarterTarget)) terminatedQuarter += 1;
        if (matchesTarget(terminatedParts, monthTarget)) terminatedMonth += 1;

        const terminatedTrend = trendByMonth.get(monthKey(terminatedParts));
        if (terminatedTrend) terminatedTrend.lostArea += area;

        const reason = tenant.terminationReason || '未填写原因';
        reasonMap[reason] = (reasonMap[reason] || 0) + 1;
        if (tenant.terminationType === 'Early') earlyCount += 1;
    }

    const currentMetrics = finalizeMetrics(current);
    const prevPeriodMetrics = finalizeMetrics(prevPeriod);
    const prevYearMetrics = finalizeMetrics(prevYear);
    const reasonData = Object.entries(reasonMap).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
    const earlyRate = terminatedAll > 0 ? Math.round((earlyCount / terminatedAll) * 100) : 0;
    const terminationTypeData = [
        { name: '正常退租', value: terminatedAll - earlyCount },
        { name: '提前退租', value: earlyCount },
    ].filter((item) => item.value > 0);

    return {
        metrics: currentMetrics,
        mom: {
            area: getChange(currentMetrics.signedArea, prevPeriodMetrics.signedArea),
            count: getChange(currentMetrics.signedCount, prevPeriodMetrics.signedCount),
        },
        yoy: {
            area: getChange(currentMetrics.signedArea, prevYearMetrics.signedArea),
            count: getChange(currentMetrics.signedCount, prevYearMetrics.signedCount),
        },
        reasons: reasonData,
        earlyRate,
        trend: trendRows.map((row) => ({
            month: row.month,
            newArea: Math.round(row.newArea),
            lostArea: Math.round(row.lostArea),
            netArea: Math.round(row.newArea - row.lostArea),
        })),
        terminationStats: {
            all: terminatedAll,
            year: terminatedYear,
            quarter: terminatedQuarter,
            month: terminatedMonth,
            earlyCount,
            normalCount: terminatedAll - earlyCount,
        },
        terminationTypeData,
    };
}
