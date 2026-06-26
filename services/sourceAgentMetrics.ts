import { ContractStatus, Tenant } from '../types';

export type SourceAnalysisPeriod = 'All' | 'Year' | 'Quarter' | 'Month';

export type SourceAgentRow = {
    sourceName: string;
    contractCount: number;
    clientCount: number;
    activeCount: number;
    terminatedCount: number;
    signedArea: number;
    activeArea: number;
    terminatedArea: number;
    churnRate: number;
    earlyTerminationRate: number;
    renewalCount: number;
    avgTenureMonths: number;
    stabilityScore: number;
    tenantIds: string[];
};

export type SourceAnalysisSummary = {
    period: SourceAnalysisPeriod;
    totalContracts: number;
    labeledContracts: number;
    labeledRate: number;
    unlabeledCount: number;
    sourceCount: number;
    rows: SourceAgentRow[];
    topBySignedArea: SourceAgentRow | null;
    mostStable: SourceAgentRow | null;
    signingTrend: Array<{ month: string; totalArea: number; totalCount: number }>;
};

const ACTIVE_STATUSES = new Set<ContractStatus>([
    ContractStatus.Active,
    ContractStatus.Expiring,
    ContractStatus.Pending,
]);

export const UNLABELED_SOURCE = '未标注来源';

export function normalizeSourceAgentName(name?: string | null): string {
    const trimmed = (name || '').trim();
    return trimmed || UNLABELED_SOURCE;
}

function parseLocalDate(dateStr?: string): Date | null {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    return Number.isNaN(d.getTime()) ? null : d;
}

function monthsBetween(start: Date, end: Date): number {
    const years = end.getFullYear() - start.getFullYear();
    const months = end.getMonth() - start.getMonth();
    const days = end.getDate() - start.getDate();
    let total = years * 12 + months;
    if (days < 0) total -= 1;
    return Math.max(0, total + days / 30);
}

function getSigningDate(t: Tenant): Date | null {
    return parseLocalDate(t.signingDate || t.leaseStart);
}

function isInPeriod(date: Date, period: SourceAnalysisPeriod, now = new Date()): boolean {
    if (period === 'All') return true;
    const year = now.getFullYear();
    const month = now.getMonth();
    const quarter = Math.floor(month / 3);
    if (period === 'Year') return date.getFullYear() === year;
    if (period === 'Quarter') {
        return date.getFullYear() === year && Math.floor(date.getMonth() / 3) === quarter;
    }
    return date.getFullYear() === year && date.getMonth() === month;
}

function getChainKey(t: Tenant): string {
    return (t.rootId || t.id || '').trim() || t.id;
}

function computeTenureMonths(t: Tenant, referenceDate = new Date()): number {
    const start = parseLocalDate(t.leaseStart);
    if (!start) return 0;
    if (t.status === ContractStatus.Terminated) {
        const end = parseLocalDate(t.terminationDate || t.leaseEnd) || referenceDate;
        return monthsBetween(start, end);
    }
    const end = referenceDate < (parseLocalDate(t.leaseEnd) || referenceDate)
        ? referenceDate
        : (parseLocalDate(t.leaseEnd) || referenceDate);
    return monthsBetween(start, end);
}

function computeStabilityScore(
    churnRate: number,
    earlyTerminationRate: number,
    avgTenureMonths: number,
): number {
    const churnScore = Math.max(0, 100 - churnRate);
    const earlyScore = Math.max(0, 100 - earlyTerminationRate);
    const tenureScore = Math.min(100, avgTenureMonths * 4);
    return Math.round(churnScore * 0.35 + earlyScore * 0.35 + tenureScore * 0.3);
}

function countRenewals(tenants: Tenant[]): number {
    const chains = new Map<string, Tenant[]>();
    tenants.forEach((t) => {
        const key = getChainKey(t);
        const list = chains.get(key) || [];
        list.push(t);
        chains.set(key, list);
    });
    let renewals = 0;
    chains.forEach((list) => {
        if (list.length > 1) renewals += list.length - 1;
    });
    return renewals;
}

type SourceAccumulator = {
    sourceName: string;
    contractCount: number;
    activeCount: number;
    terminatedCount: number;
    earlyTerminatedCount: number;
    signedArea: number;
    activeArea: number;
    terminatedArea: number;
    tenureMonthsTotal: number;
    tenantIds: string[];
    clientKeys: Set<string>;
    chainCounts: Map<string, number>;
};

const emptySourceAccumulator = (sourceName: string): SourceAccumulator => ({
    sourceName,
    contractCount: 0,
    activeCount: 0,
    terminatedCount: 0,
    earlyTerminatedCount: 0,
    signedArea: 0,
    activeArea: 0,
    terminatedArea: 0,
    tenureMonthsTotal: 0,
    tenantIds: [],
    clientKeys: new Set(),
    chainCounts: new Map(),
});

const addTrend = (
    trendByMonth: Map<string, { month: string; totalArea: number; totalCount: number }>,
    signedAt: Date | null,
    tenant: Tenant,
) => {
    if (!signedAt) return;
    const key = `${signedAt.getFullYear()}-${String(signedAt.getMonth() + 1).padStart(2, '0')}`;
    const row = trendByMonth.get(key);
    if (!row) return;
    row.totalArea += tenant.totalArea || 0;
    row.totalCount += 1;
};

const finalizeSourceRow = (acc: SourceAccumulator, referenceDate: Date): SourceAgentRow => {
    const churnRate = acc.contractCount > 0 ? (acc.terminatedCount / acc.contractCount) * 100 : 0;
    const earlyTerminationRate =
        acc.terminatedCount > 0 ? (acc.earlyTerminatedCount / acc.terminatedCount) * 100 : 0;
    const avgTenureMonths =
        acc.contractCount > 0 ? acc.tenureMonthsTotal / acc.contractCount : 0;
    let renewalCount = 0;
    acc.chainCounts.forEach((count) => {
        if (count > 1) renewalCount += count - 1;
    });

    return {
        sourceName: acc.sourceName,
        contractCount: acc.contractCount,
        clientCount: acc.clientKeys.size,
        activeCount: acc.activeCount,
        terminatedCount: acc.terminatedCount,
        signedArea: Math.round(acc.signedArea),
        activeArea: Math.round(acc.activeArea),
        terminatedArea: Math.round(acc.terminatedArea),
        churnRate: Math.round(churnRate * 10) / 10,
        earlyTerminationRate: Math.round(earlyTerminationRate * 10) / 10,
        renewalCount,
        avgTenureMonths: Math.round(avgTenureMonths * 10) / 10,
        stabilityScore: computeStabilityScore(churnRate, earlyTerminationRate, avgTenureMonths),
        tenantIds: acc.tenantIds,
    };
};

export function computeSourceAgentMetrics(
    tenants: Tenant[],
    period: SourceAnalysisPeriod = 'All',
    referenceDate = new Date(),
): SourceAnalysisSummary {
    const signingTrend: SourceAnalysisSummary['signingTrend'] = [];
    const trendByMonth = new Map<string, SourceAnalysisSummary['signingTrend'][number]>();
    const now = referenceDate;
    for (let i = 11; i >= 0; i -= 1) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const label = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const row = { month: label, totalArea: 0, totalCount: 0 };
        signingTrend.push(row);
        trendByMonth.set(label, row);
    }

    let totalContracts = 0;
    let labeledContracts = 0;
    const bySource = new Map<string, SourceAccumulator>();

    for (const tenant of tenants) {
        const signedAt = getSigningDate(tenant);
        addTrend(trendByMonth, signedAt, tenant);
        if (!(signedAt ? isInPeriod(signedAt, period, referenceDate) : period === 'All')) continue;

        totalContracts += 1;
        const sourceName = normalizeSourceAgentName(tenant.sourceAgentName);
        if (sourceName !== UNLABELED_SOURCE) labeledContracts += 1;
        const acc = bySource.get(sourceName) || emptySourceAccumulator(sourceName);
        bySource.set(sourceName, acc);

        const area = tenant.totalArea || 0;
        const chainKey = getChainKey(tenant);
        acc.contractCount += 1;
        acc.signedArea += area;
        acc.tenureMonthsTotal += computeTenureMonths(tenant, referenceDate);
        acc.tenantIds.push(tenant.id);
        acc.clientKeys.add(chainKey);
        acc.chainCounts.set(chainKey, (acc.chainCounts.get(chainKey) || 0) + 1);

        if (ACTIVE_STATUSES.has(tenant.status)) {
            acc.activeCount += 1;
            acc.activeArea += area;
        }
        if (tenant.status === ContractStatus.Terminated) {
            acc.terminatedCount += 1;
            acc.terminatedArea += area;
            if (tenant.terminationType === 'Early') acc.earlyTerminatedCount += 1;
        }
    }

    const unlabeledCount = totalContracts - labeledContracts;
    const rows = Array.from(bySource.values()).map((acc) => finalizeSourceRow(acc, referenceDate));
    rows.sort((a, b) => b.stabilityScore - a.stabilityScore || b.signedArea - a.signedArea);

    const eligibleStable = rows.filter((r) => r.contractCount >= 2 && r.sourceName !== UNLABELED_SOURCE);
    const topBySignedArea =
        rows.filter((r) => r.sourceName !== UNLABELED_SOURCE).sort((a, b) => b.signedArea - a.signedArea)[0] ||
        rows[0] ||
        null;
    const mostStable = eligibleStable[0] || null;

    return {
        period,
        totalContracts,
        labeledContracts,
        labeledRate: totalContracts > 0 ? Math.round((labeledContracts / totalContracts) * 1000) / 10 : 0,
        unlabeledCount,
        sourceCount: rows.length,
        rows,
        topBySignedArea,
        mostStable,
        signingTrend: signingTrend.map((row) => ({
            month: row.month,
            totalArea: Math.round(row.totalArea),
            totalCount: row.totalCount,
        })),
    };
}
