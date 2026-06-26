import type { KpiSnapshotSummary } from './pocketbaseService';
import type {
    BudgetAdjustment,
    BudgetAssumption,
    BudgetScenario,
    Building,
    DashboardData,
    MonthlyInitData,
    MonthlyTrend,
    Tenant,
} from '../types';
import { resolveInitMonthInitialBudget } from './initDataBudget';

export type DashboardQuarter = 'All' | 'Q1' | 'Q2' | 'Q3' | 'Q4';

export const RECEIVABLE_DEDICATED_SCENARIO_ID_PREFIX = 'invoice_dedicated_';

export const getActiveScenarioForBudgetYear = (
    scenarios: BudgetScenario[] | undefined,
    year: number
): BudgetScenario | undefined => {
    const fallbackYear = year;
    return (scenarios || []).find((s) => s.isActive && (s.budgetYear || fallbackYear) === year);
};

export const isReceivableDedicatedScenarioId = (id: string | undefined): boolean =>
    String(id || '').startsWith(RECEIVABLE_DEDICATED_SCENARIO_ID_PREFIX);

export const isReceivableDedicatedScenario = (scenario: BudgetScenario): boolean => {
    const s = scenario as BudgetScenario & { isReceivableActive?: boolean };
    if (s.isReceivableActive) return true;
    const id = String(scenario.id || '').toLowerCase();
    const name = String(scenario.name || '');
    return isReceivableDedicatedScenarioId(String(scenario.id)) || id.includes('invoice_dedicated') || /应收.*专用|发票专用/.test(name);
};

export const getReceivableScenarioForYear = (
    scenarios: BudgetScenario[] | undefined,
    year: number
): BudgetScenario | undefined => {
    const fallbackYear = year;
    const list = scenarios || [];
    const byYear = (s: BudgetScenario) => (s.budgetYear || fallbackYear) === year;
    return list.find((s) => byYear(s) && isReceivableDedicatedScenario(s)) || list.find((s) => byYear(s) && s.isActive);
};

export const mergeAssumptionsForReceivable = (
    scenarioAssumptions: BudgetAssumption[] | undefined,
    liveAssumptions: BudgetAssumption[] | undefined
): BudgetAssumption[] => {
    const key = (a: BudgetAssumption) => `${a.targetType}:${a.targetId}`;
    const map = new Map<string, BudgetAssumption>();
    for (const a of scenarioAssumptions || []) {
        if (a.targetType === 'Existing' || a.targetType === 'Vacancy') map.set(key(a), a);
    }
    for (const a of liveAssumptions || []) {
        if (a.targetType === 'Existing' || a.targetType === 'Vacancy') map.set(key(a), a);
    }
    return [...map.values()];
};

export const mergeAdjustmentsForReceivable = (
    scenarioAdjustments: BudgetAdjustment[] | undefined,
    liveAdjustments: BudgetAdjustment[] | undefined
): BudgetAdjustment[] => {
    const map = new Map<string, BudgetAdjustment>();
    for (const a of scenarioAdjustments || []) map.set(a.id, a);
    for (const a of liveAdjustments || []) map.set(a.id, a);
    return [...map.values()];
};

const remapSnapshotTenantIdsToLive = (
    snapshotTenants: Tenant[] | undefined,
    liveTenants: Tenant[],
): Tenant[] => {
    if (!snapshotTenants || snapshotTenants.length === 0) return snapshotTenants || [];
    const liveById = new Set(liveTenants.map((t) => t.id));
    const liveByNameStart = new Map<string, string>();
    for (const t of liveTenants) {
        if (!t?.name || !t?.leaseStart) continue;
        const key = `${t.name}|${t.leaseStart}`;
        if (!liveByNameStart.has(key)) liveByNameStart.set(key, t.id);
    }
    return snapshotTenants.map((s) => {
        if (!s?.id) return s;
        if (liveById.has(s.id)) return s;
        const key = `${s.name}|${s.leaseStart}`;
        const liveId = liveByNameStart.get(key);
        if (!liveId) return s;
        return { ...s, id: liveId };
    });
};

export const buildReceivableContextForScenario = (
    scenario: BudgetScenario | undefined,
    liveTenants: Tenant[],
    liveBuildings: Building[],
    rootBudgetAssumptions: BudgetAssumption[] | undefined,
    rootBudgetAdjustments: BudgetAdjustment[] | undefined,
): {
    tenants: Tenant[];
    buildings: Building[];
    assumptions: BudgetAssumption[];
    adjustments: BudgetAdjustment[];
} => {
    if (!scenario) {
        return {
            tenants: liveTenants,
            buildings: liveBuildings,
            assumptions: rootBudgetAssumptions || [],
            adjustments: rootBudgetAdjustments || [],
        };
    }
    const remappedSnapshotTenants = remapSnapshotTenantIdsToLive(
        scenario.baseDataSnapshot?.tenants,
        liveTenants,
    );
    return {
        tenants: remappedSnapshotTenants.length > 0 ? remappedSnapshotTenants : liveTenants,
        buildings: scenario.baseDataSnapshot?.buildings || liveBuildings,
        assumptions: mergeAssumptionsForReceivable(scenario.assumptions, rootBudgetAssumptions),
        adjustments: mergeAdjustmentsForReceivable(scenario.adjustments, rootBudgetAdjustments),
    };
};

const normalizeReceivableScenarioByYear = (scenarios: BudgetScenario[] | undefined): BudgetScenario[] => {
    const list = [...(scenarios || [])];
    if (list.length === 0) return list;
    const fallbackYear = new Date().getFullYear();
    const years = Array.from(new Set(list.map((s) => s.budgetYear || fallbackYear)));
    years.forEach((year) => {
        const sameYear = list.filter((s) => (s.budgetYear || fallbackYear) === year);
        const dedicated = sameYear.filter((s) => !!s.isReceivableActive);
        if (dedicated.length === 0) {
            const active = sameYear.find((s) => s.isActive);
            if (active) {
                const idx = list.findIndex((s) => (s.budgetYear || fallbackYear) === year && s.id === active.id);
                if (idx >= 0) list[idx] = { ...list[idx], isReceivableActive: true };
            }
            return;
        }
        const keepId = dedicated[0].id;
        for (let i = 0; i < list.length; i++) {
            const s = list[i];
            if ((s.budgetYear || fallbackYear) === year && s.id !== keepId && s.isReceivableActive) {
                list[i] = { ...s, isReceivableActive: false };
            }
        }
    });
    return list;
};

const ensureDedicatedReceivableScenarios = (
    scenarios: BudgetScenario[] | undefined,
    fallbackTenants: Tenant[],
    fallbackBuildings: Building[]
): BudgetScenario[] => {
    const list = [...(scenarios || [])];
    if (list.length === 0) return list;
    const fallbackYear = new Date().getFullYear();
    const years = Array.from(new Set(list.map((s) => s.budgetYear || fallbackYear)));

    years.forEach((year) => {
        const active = list.find((s) => s.isActive && (s.budgetYear || fallbackYear) === year);
        if (!active) return;

        const userPickedReceivable = list.find(
            (s) =>
                (s.budgetYear || fallbackYear) === year &&
                s.isReceivableActive &&
                !isReceivableDedicatedScenarioId(s.id),
        );
        if (userPickedReceivable) {
            const dedicatedId = `${RECEIVABLE_DEDICATED_SCENARIO_ID_PREFIX}${year}`;
            const dedicatedIdx = list.findIndex((s) => s.id === dedicatedId);
            if (dedicatedIdx >= 0) {
                list[dedicatedIdx] = { ...list[dedicatedIdx], isReceivableActive: false } as BudgetScenario;
            }
            return;
        }

        const dedicatedId = `${RECEIVABLE_DEDICATED_SCENARIO_ID_PREFIX}${year}`;
        const activeTenants = active.baseDataSnapshot?.tenants || fallbackTenants;
        const activeBuildings = active.baseDataSnapshot?.buildings || fallbackBuildings;
        const dedicatedPayload: Partial<BudgetScenario> = {
            name: `${year}应收款专用方案`,
            budgetYear: year,
            description: `系统常驻：自动同步 ${active.name}（${year}生效方案）`,
            assumptions: [...(active.assumptions || [])],
            adjustments: [...(active.adjustments || [])],
            isReceivableActive: true,
            baseDataSnapshot: {
                tenants: structuredClone(activeTenants),
                buildings: structuredClone(activeBuildings),
            },
        };

        const idx = list.findIndex((s) => s.id === dedicatedId);
        if (idx >= 0) {
            list[idx] = {
                ...list[idx],
                ...dedicatedPayload,
                id: dedicatedId,
                createdAt: list[idx].createdAt || new Date().toISOString(),
                isActive: false,
            } as BudgetScenario;
        } else {
            list.push({
                id: dedicatedId,
                createdAt: new Date().toISOString(),
                isActive: false,
                ...dedicatedPayload,
            } as BudgetScenario);
        }

        for (let i = 0; i < list.length; i++) {
            const s = list[i];
            if ((s.budgetYear || fallbackYear) !== year) continue;
            if (s.id !== dedicatedId && s.isReceivableActive) {
                list[i] = { ...s, isReceivableActive: false };
            }
        }
    });

    return list;
};

export const syncInvoiceDedicatedSnapshotsFromLive = (
    scenarios: BudgetScenario[] | undefined,
    liveTenants: Tenant[],
    liveBuildings: Building[],
): BudgetScenario[] => {
    if (!scenarios?.length || !liveTenants.length) return scenarios || [];
    return scenarios.map((s) => {
        if (!isReceivableDedicatedScenarioId(s.id)) return s;
        const tenantsForSnapshot = liveTenants.map((t) => {
            const { keyMoments, nameHistory, paymentCycleChanges, ...core } = t;
            return core;
        });
        return {
            ...s,
            baseDataSnapshot: {
                tenants: tenantsForSnapshot,
                buildings: structuredClone(liveBuildings),
            },
        };
    });
};

export const normalizeScenarioForReceivable = (
    scenarios: BudgetScenario[] | undefined,
    fallbackTenants: Tenant[],
    fallbackBuildings: Building[]
): BudgetScenario[] => {
    const withDedicated = ensureDedicatedReceivableScenarios(scenarios, fallbackTenants, fallbackBuildings);
    const syncedDedicated = syncInvoiceDedicatedSnapshotsFromLive(
        withDedicated,
        fallbackTenants,
        fallbackBuildings,
    );
    return normalizeReceivableScenarioByYear(syncedDedicated);
};

export const resolveAnnualInitialBudget = (
    yearlyTargets: DashboardData['yearlyTargets'],
    initializationData: MonthlyInitData[] | undefined,
    year: number,
    projectId?: string
): number => {
    const yearTarget = (yearlyTargets || {})[year] || {};
    const annualFromYearly = Number((yearTarget as { initialBudget?: number }).initialBudget) || 0;

    const byMonth = new Map<number, number>();
    for (const d of initializationData || []) {
        if (d.year !== year) continue;
        const monthBudget = resolveInitMonthInitialBudget(d, projectId);
        if (monthBudget <= 0.005) continue;
        byMonth.set(d.month, monthBudget);
    }
    if (byMonth.size === 0) return annualFromYearly;

    let sum = 0;
    for (let m = 1; m <= 12; m++) sum += byMonth.get(m) ?? 0;
    return sum;
};

export const normalizeYearlyTargetsFromInitialization = (
    yearlyTargets: DashboardData['yearlyTargets'],
    initializationData: MonthlyInitData[] | undefined,
    projectId?: string
): DashboardData['yearlyTargets'] => {
    const out: NonNullable<DashboardData['yearlyTargets']> = { ...(yearlyTargets || {}) };
    const years = new Set<number>([
        ...Object.keys(out).map((y) => Number(y)),
        ...(initializationData || []).map((d) => d.year),
    ]);
    for (const year of years) {
        if (!Number.isFinite(year)) continue;
        const existing = out[year] || { revenue: 0, occupancy: 0, initialBudget: 0 };
        const initial = resolveAnnualInitialBudget(out, initializationData, year, projectId);
        out[year] = {
            ...existing,
            revenue: 0,
            initialBudget: initial > 0 ? initial : existing.initialBudget || 0,
        };
    }
    return out;
};

export const buildKpiSummaryFromProcessedData = (processedData: DashboardData, statsYear?: number): KpiSnapshotSummary => {
    const trends = processedData.monthlyTrends || [];
    const annualBudgetTarget = trends.reduce((sum, trend) => sum + (trend.revenueTarget || 0), 0);
    const annualContractReceivable = trends.reduce((sum, trend) => sum + (trend.contractReceivable || 0), 0);
    const annualRevenueCollected = processedData.annualRevenueCollected || 0;
    const year = statsYear || new Date().getFullYear();
    const annualInitialBudget = resolveAnnualInitialBudget(
        processedData.yearlyTargets,
        processedData.initializationData,
        year,
        processedData.tenants?.[0]?.projectId
    );
    const annualRevenueTarget =
        annualInitialBudget > 0
            ? annualInitialBudget
            : annualBudgetTarget > 0
              ? annualBudgetTarget
              : processedData.annualRevenueTarget || processedData.monthlyRevenueTarget || 0;
    const annualGoalCompletion =
        annualContractReceivable > 0.005
            ? Math.min(100, (annualRevenueCollected / annualContractReceivable) * 100)
            : annualRevenueTarget > 0
                ? Math.min(100, (annualRevenueCollected / annualRevenueTarget) * 100)
                : 0;

    return {
        annualRevenueTarget,
        annualRevenueCollected,
        annualInitialBudget,
        annualBudgetTarget,
        annualContractReceivable,
        annualGoalCompletion,
        annualBudgetCompletion:
            annualBudgetTarget > 0
                ? Math.min(100, (annualRevenueCollected / annualBudgetTarget) * 100)
                : 0,
        occupancyRate: processedData.occupancyRate || 0,
        annualOccupancyTarget: processedData.annualOccupancyTarget || 0,
        tenantCount: processedData.tenants?.length || 0,
        totalArea: processedData.totalArea || 0,
        leasedArea: processedData.leasedArea || 0,
        vacantArea: processedData.vacantArea || 0,
        accumulatedArrears: processedData.accumulatedArrears || 0,
    };
};

export const normalizeKpiSummaryWithMonthlyTrends = (
    summary: KpiSnapshotSummary,
    monthlyTrends: MonthlyTrend[]
): KpiSnapshotSummary => {
    const sumFromTrends = (monthlyTrends || []).reduce((sum, t) => sum + (t.revenueTarget || 0), 0);
    const annualBudgetTarget = sumFromTrends > 0 ? sumFromTrends : summary.annualBudgetTarget || 0;
    const contractSumFromTrends = (monthlyTrends || []).reduce((sum, t) => sum + (t.contractReceivable || 0), 0);
    const annualContractReceivableResolved =
        contractSumFromTrends > 0 ? contractSumFromTrends : summary.annualContractReceivable || 0;
    const annualInitialFromSummary = summary.annualInitialBudget || 0;
    const annualRevenueTarget =
        annualInitialFromSummary > 0
            ? annualInitialFromSummary
            : annualBudgetTarget > 0
              ? annualBudgetTarget
              : summary.annualRevenueTarget || 0;
    const collected = summary.annualRevenueCollected || 0;
    const revenueTargetDenom = annualRevenueTarget;

    const annualGoalCompletion =
        annualContractReceivableResolved > 0.005
            ? Math.min(100, (collected / annualContractReceivableResolved) * 100)
            : revenueTargetDenom > 0
                ? Math.min(100, (collected / revenueTargetDenom) * 100)
                : summary.annualGoalCompletion || 0;

    return {
        ...summary,
        annualBudgetTarget,
        annualRevenueTarget,
        annualContractReceivable: annualContractReceivableResolved,
        annualGoalCompletion,
        annualBudgetCompletion:
            annualBudgetTarget > 0 ? Math.min(100, (collected / annualBudgetTarget) * 100) : 0,
    };
};
