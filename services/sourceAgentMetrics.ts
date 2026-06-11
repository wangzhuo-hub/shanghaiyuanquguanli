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

export function computeSourceAgentMetrics(
    tenants: Tenant[],
    period: SourceAnalysisPeriod = 'All',
    referenceDate = new Date(),
): SourceAnalysisSummary {
    const scoped = tenants.filter((t) => {
        const signedAt = getSigningDate(t);
        return signedAt ? isInPeriod(signedAt, period, referenceDate) : period === 'All';
    });

    const totalContracts = scoped.length;
    const labeledContracts = scoped.filter((t) => normalizeSourceAgentName(t.sourceAgentName) !== UNLABELED_SOURCE).length;
    const unlabeledCount = totalContracts - labeledContracts;

    const bySource = new Map<string, Tenant[]>();
    scoped.forEach((t) => {
        const source = normalizeSourceAgentName(t.sourceAgentName);
        const list = bySource.get(source) || [];
        list.push(t);
        bySource.set(source, list);
    });

    const rows: SourceAgentRow[] = Array.from(bySource.entries()).map(([sourceName, list]) => {
        const active = list.filter((t) => ACTIVE_STATUSES.has(t.status));
        const terminated = list.filter((t) => t.status === ContractStatus.Terminated);
        const earlyTerminated = terminated.filter((t) => t.terminationType === 'Early');
        const clientCount = new Set(list.map(getChainKey)).size;
        const signedArea = list.reduce((sum, t) => sum + (t.totalArea || 0), 0);
        const activeArea = active.reduce((sum, t) => sum + (t.totalArea || 0), 0);
        const terminatedArea = terminated.reduce((sum, t) => sum + (t.totalArea || 0), 0);
        const contractCount = list.length;
        const churnRate = contractCount > 0 ? (terminated.length / contractCount) * 100 : 0;
        const earlyTerminationRate =
            terminated.length > 0 ? (earlyTerminated.length / terminated.length) * 100 : 0;
        const avgTenureMonths =
            list.length > 0
                ? list.reduce((sum, t) => sum + computeTenureMonths(t, referenceDate), 0) / list.length
                : 0;

        return {
            sourceName,
            contractCount,
            clientCount,
            activeCount: active.length,
            terminatedCount: terminated.length,
            signedArea: Math.round(signedArea),
            activeArea: Math.round(activeArea),
            terminatedArea: Math.round(terminatedArea),
            churnRate: Math.round(churnRate * 10) / 10,
            earlyTerminationRate: Math.round(earlyTerminationRate * 10) / 10,
            renewalCount: countRenewals(list),
            avgTenureMonths: Math.round(avgTenureMonths * 10) / 10,
            stabilityScore: computeStabilityScore(churnRate, earlyTerminationRate, avgTenureMonths),
            tenantIds: list.map((t) => t.id),
        };
    });

    rows.sort((a, b) => b.stabilityScore - a.stabilityScore || b.signedArea - a.signedArea);

    const eligibleStable = rows.filter((r) => r.contractCount >= 2 && r.sourceName !== UNLABELED_SOURCE);
    const topBySignedArea =
        rows.filter((r) => r.sourceName !== UNLABELED_SOURCE).sort((a, b) => b.signedArea - a.signedArea)[0] ||
        rows[0] ||
        null;
    const mostStable = eligibleStable[0] || null;

    const signingTrend: SourceAnalysisSummary['signingTrend'] = [];
    const now = referenceDate;
    for (let i = 11; i >= 0; i -= 1) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const label = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const monthTenants = tenants.filter((t) => {
            const signedAt = getSigningDate(t);
            return signedAt && signedAt.getFullYear() === d.getFullYear() && signedAt.getMonth() === d.getMonth();
        });
        signingTrend.push({
            month: label,
            totalArea: Math.round(monthTenants.reduce((sum, t) => sum + (t.totalArea || 0), 0)),
            totalCount: monthTenants.length,
        });
    }

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
        signingTrend,
    };
}
