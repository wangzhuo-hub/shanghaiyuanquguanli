import { ContractStatus, type Tenant } from '../types';

export type ContractListTab = 'List' | 'Terminated' | 'Analysis' | 'SourceAnalysis' | 'Expiring';

export type ContractListFilterOptions = {
    activeTab: ContractListTab;
    searchTerm: string;
    filterBuilding: string;
    filterStatus: string;
    filterPaymentCycle: string;
};

export type ExpiringContractSummary = {
    count: number;
    overdue: number;
    thisMonth: number;
    nextMonth: number;
    monthlyRent: number;
};

export type ExpiringContractQuarterGroup = {
    label: string;
    range: [Date, Date];
    tenants: Tenant[];
};

export type ExpiringContractView = {
    summary: ExpiringContractSummary;
    expiringTenants: Tenant[];
    byQuarter: ExpiringContractQuarterGroup[];
};

export const shouldBuildContractListRows = (activeTab: ContractListTab): boolean =>
    activeTab === 'List' || activeTab === 'Terminated';

export const shouldBuildContractAssetLookup = (activeTab: ContractListTab): boolean =>
    shouldBuildContractListRows(activeTab) || activeTab === 'Expiring';

export function filterContractListTenants(
    tenants: Tenant[],
    options: ContractListFilterOptions,
): Tenant[] {
    if (!shouldBuildContractListRows(options.activeTab)) return [];

    const search = options.searchTerm.trim().toLowerCase();
    const result: Tenant[] = [];

    for (const tenant of tenants) {
        const isTerminated = tenant.status === ContractStatus.Terminated;
        const isExpired = tenant.status === ContractStatus.Expired;
        if (options.activeTab === 'List' && (isTerminated || isExpired)) continue;
        if (options.activeTab === 'Terminated' && !isTerminated) continue;

        if (search && !(tenant.name || '').toLowerCase().includes(search)) continue;
        if (options.filterBuilding !== 'all' && tenant.buildingId !== options.filterBuilding) continue;
        if (options.filterStatus === 'risk') {
            if (tenant.isRisk !== true) continue;
        } else if (options.filterStatus === 'special') {
            if (tenant.isSpecialBusiness !== true) continue;
        } else if (options.filterStatus !== 'all' && tenant.status !== options.filterStatus) {
            continue;
        }
        if (options.filterPaymentCycle !== 'all' && tenant.paymentCycle !== options.filterPaymentCycle) continue;
        result.push(tenant);
    }

    return result.sort((a, b) => new Date(b.leaseStart).getTime() - new Date(a.leaseStart).getTime());
}

const EMPTY_EXPIRING_SUMMARY: ExpiringContractSummary = {
    count: 0,
    overdue: 0,
    thisMonth: 0,
    nextMonth: 0,
    monthlyRent: 0,
};

const expiringQuarterRanges = (year: number): Array<{ label: string; range: [Date, Date] }> => [
    { label: '第一季度 (1-3月)', range: [new Date(year, 0, 1), new Date(year, 2, 31)] },
    { label: '第二季度 (4-6月)', range: [new Date(year, 3, 1), new Date(year, 5, 30)] },
    { label: '第三季度 (7-9月)', range: [new Date(year, 6, 1), new Date(year, 8, 30)] },
    { label: '第四季度 (10-12月)', range: [new Date(year, 9, 1), new Date(year, 11, 31)] },
];

export function buildExpiringContractView(
    tenants: Tenant[],
    options: {
        year: number;
        now?: Date;
        includeGroups?: boolean;
    },
): ExpiringContractView {
    const now = options.now || new Date();
    const year = options.year;
    const today = new Date(year, now.getMonth(), now.getDate());
    const sixMonthsLater = new Date(year, now.getMonth() + 6, now.getDate());
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const nextMonthEnd = new Date(now.getFullYear(), now.getMonth() + 2, 0);
    const summary: ExpiringContractSummary = { ...EMPTY_EXPIRING_SUMMARY };
    const entries: Array<{ tenant: Tenant; endDate: Date; endTime: number }> = [];

    for (const tenant of tenants) {
        if (!tenant.leaseEnd) continue;
        if (tenant.status === ContractStatus.Terminated) continue;
        const endDate = new Date(tenant.leaseEnd);
        const endTime = endDate.getTime();
        if (Number.isNaN(endTime)) continue;
        const inExpiryWindow =
            endDate.getFullYear() === year ||
            (endDate >= today && endDate <= sixMonthsLater);
        if (!inExpiryWindow) continue;

        summary.count += 1;
        summary.monthlyRent += tenant.monthlyRent || 0;
        if (endDate < now) summary.overdue += 1;
        else if (endDate >= thisMonthStart && endDate < nextMonthStart) summary.thisMonth += 1;
        else if (endDate >= nextMonthStart && endDate <= nextMonthEnd) summary.nextMonth += 1;
        if (options.includeGroups) entries.push({ tenant, endDate, endTime });
    }

    if (!options.includeGroups) {
        return { summary, expiringTenants: [], byQuarter: [] };
    }

    entries.sort((a, b) => a.endTime - b.endTime);
    const quarters = expiringQuarterRanges(year).map((quarter) => ({
        ...quarter,
        tenants: [] as Tenant[],
    }));
    for (const entry of entries) {
        for (const quarter of quarters) {
            if (entry.endDate >= quarter.range[0] && entry.endDate <= quarter.range[1]) {
                quarter.tenants.push(entry.tenant);
                break;
            }
        }
    }

    return {
        summary,
        expiringTenants: entries.map((entry) => entry.tenant),
        byQuarter: quarters.filter((quarter) => quarter.tenants.length > 0),
    };
}
