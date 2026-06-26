import { ContractStatus } from '../types';
import type { BillingDetail, Building, PaymentRecord, Tenant } from '../types';
import { formatArea, formatWan } from './numberFormat';
import type { TenantHistoricalArrearsSummary } from './tenantHistoricalArrears';

export type MobileTenantSearchResult = {
    id: string;
    name: string;
    location: string;
    statusLabel: string;
    helper: string;
    paymentSummary?: string;
    receivableSummary?: string;
    historicalArrearsSummary?: string;
};

export type MobileTenantSearchIndexEntry = MobileTenantSearchResult & {
    status: ContractStatus;
    buildingId?: string;
    buildingName?: string;
    leaseEnd?: string;
    leaseEndMonth?: string;
    hasPaymentRecord: boolean;
    hasCurrentReceivableDue: boolean;
    currentReceivableDueAmount: number;
    hasHistoricalArrears: boolean;
    historicalArrearsAmount: number;
    searchText: string;
};

export type MobileTenantSearchPaymentFilter = 'all' | 'paid' | 'none';
export type MobileTenantSearchReceivableFilter = 'all' | 'due' | 'clear';
export type MobileTenantSearchArrearsFilter = 'all' | 'historical_due' | 'historical_clear';

export type MobileTenantSearchFilterOptions = {
    status?: ContractStatus;
    buildingId?: string;
    leaseEndMonth?: string;
    paymentFilter?: MobileTenantSearchPaymentFilter;
    receivableFilter?: MobileTenantSearchReceivableFilter;
    arrearsFilter?: MobileTenantSearchArrearsFilter;
};

const toYearMonth = (value?: string): string | undefined => {
    const match = String(value || '').trim().match(/^(\d{4})-(\d{2})/);
    return match ? `${match[1]}-${match[2]}` : undefined;
};

export function shouldBuildMobileTenantSearchIndexForView(options: {
    mobileNavLayout: boolean;
    activeTab: string;
    mobileDashboardMode: string;
}): boolean {
    return options.mobileNavLayout && options.activeTab === 'dashboard' && options.mobileDashboardMode === 'search';
}

type MobileTenantPaymentSummary = {
    seenPaymentIds: Set<string>;
    total: number;
    latestDate?: string;
};

type MobileTenantReceivableSummary = {
    seenBillingKeys: Set<string>;
    dueAmount: number;
};

const MOBILE_TENANT_STATUS_RANK: Record<ContractStatus, number> = {
    [ContractStatus.Active]: 0,
    [ContractStatus.Expiring]: 1,
    [ContractStatus.Pending]: 2,
    [ContractStatus.Expired]: 3,
    [ContractStatus.Terminated]: 4,
};

export const mobileContractStatusText = (status: ContractStatus): string => {
    switch (status) {
        case ContractStatus.Active:
            return '履约中';
        case ContractStatus.Expiring:
            return '即将到期';
        case ContractStatus.Pending:
            return '签约中';
        case ContractStatus.Expired:
            return '已到期';
        case ContractStatus.Terminated:
            return '已退租';
        default:
            return status;
    }
};

export function buildMobileTenantSearchIndex(input: {
    buildings: Building[];
    tenants: Tenant[];
    payments: PaymentRecord[];
    billingDetails?: BillingDetail[];
    historicalArrearsByTenantId?: Map<string, TenantHistoricalArrearsSummary>;
}): MobileTenantSearchIndexEntry[] {
    const buildingNameById = new Map<string, string>();
    const unitNameById = new Map<string, string>();
    for (const building of input.buildings || []) {
        buildingNameById.set(building.id, building.name || building.id);
        for (const unit of building.units || []) {
            unitNameById.set(unit.id, unit.name || unit.id);
        }
    }

    const tenantIds = new Set<string>();
    const tenantIdsByName = new Map<string, string[]>();
    for (const tenant of input.tenants || []) {
        if (!tenant.id) continue;
        tenantIds.add(tenant.id);
        if (tenant.name) {
            const existing = tenantIdsByName.get(tenant.name) || [];
            existing.push(tenant.id);
            tenantIdsByName.set(tenant.name, existing);
        }
    }

    const paymentSummaryByTenantId = new Map<string, MobileTenantPaymentSummary>();
    const addPaymentToTenant = (tenantId: string, payment: PaymentRecord) => {
        const paymentId = payment.id || `${payment.tenantId || payment.tenantName || tenantId}:${payment.date}:${payment.amount}`;
        const summary = paymentSummaryByTenantId.get(tenantId) || {
            seenPaymentIds: new Set<string>(),
            total: 0,
            latestDate: undefined,
        };
        if (summary.seenPaymentIds.has(paymentId)) return;
        summary.seenPaymentIds.add(paymentId);
        summary.total += payment.amount || 0;
        if (payment.date && (!summary.latestDate || payment.date.localeCompare(summary.latestDate) > 0)) {
            summary.latestDate = payment.date;
        }
        paymentSummaryByTenantId.set(tenantId, summary);
    };

    for (const payment of input.payments || []) {
        if (payment.status !== 'Received') continue;
        if (payment.tenantId && tenantIds.has(payment.tenantId)) {
            addPaymentToTenant(payment.tenantId, payment);
        }
        const matchedTenantIds = payment.tenantName ? tenantIdsByName.get(payment.tenantName) : undefined;
        if (matchedTenantIds) {
            for (const tenantId of matchedTenantIds) addPaymentToTenant(tenantId, payment);
        }
    }

    const receivableSummaryByTenantId = new Map<string, MobileTenantReceivableSummary>();
    const addBillingToTenant = (tenantId: string, billing: BillingDetail) => {
        const dueAmount = Math.max(0, (billing.amountDue || 0) - (billing.amountPaid || 0));
        if (dueAmount <= 0.005) return;
        const billingKey = [
            billing.tenantId || billing.tenantName || tenantId,
            billing.feeKind || 'rent',
            billing.amountDue || 0,
            billing.amountPaid || 0,
            billing.deferredFromPeriod || '',
            billing.deferredToPeriod || '',
        ].join('|');
        const summary = receivableSummaryByTenantId.get(tenantId) || {
            seenBillingKeys: new Set<string>(),
            dueAmount: 0,
        };
        if (summary.seenBillingKeys.has(billingKey)) return;
        summary.seenBillingKeys.add(billingKey);
        summary.dueAmount += dueAmount;
        receivableSummaryByTenantId.set(tenantId, summary);
    };

    for (const billing of input.billingDetails || []) {
        if (billing.tenantId && tenantIds.has(billing.tenantId)) {
            addBillingToTenant(billing.tenantId, billing);
        }
        const matchedTenantIds = billing.tenantName ? tenantIdsByName.get(billing.tenantName) : undefined;
        if (matchedTenantIds) {
            for (const tenantId of matchedTenantIds) addBillingToTenant(tenantId, billing);
        }
    }

    const rankedTenants = [...(input.tenants || [])].sort((a, b) => {
        const rankDiff = (MOBILE_TENANT_STATUS_RANK[a.status] ?? 9) - (MOBILE_TENANT_STATUS_RANK[b.status] ?? 9);
        if (rankDiff !== 0) return rankDiff;
        return (a.leaseEnd || '').localeCompare(b.leaseEnd || '');
    });

    return rankedTenants.map((tenant) => {
        const buildingName = tenant.buildingId ? buildingNameById.get(tenant.buildingId) || '' : '';
        const allUnitNames = (tenant.unitIds || []).map((unitId) => unitNameById.get(unitId) || unitId);
        const unitNames = allUnitNames.slice(0, 2);
        const location = [buildingName, unitNames.join('/')].filter(Boolean).join(' · ') || formatArea(tenant.totalArea || 0);
        const paymentSummaryData = paymentSummaryByTenantId.get(tenant.id);
        const hasPaymentRecord = !!paymentSummaryData && paymentSummaryData.total > 0;
        const paymentSummary = paymentSummaryData && paymentSummaryData.total > 0
            ? `已收 ${formatWan(paymentSummaryData.total, 1)}${paymentSummaryData.latestDate ? ` · 最近 ${paymentSummaryData.latestDate}` : ''}`
            : '暂无收款记录';
        const receivableSummaryData = receivableSummaryByTenantId.get(tenant.id);
        const currentReceivableDueAmount = receivableSummaryData?.dueAmount || 0;
        const hasCurrentReceivableDue = currentReceivableDueAmount > 0.005;
        const receivableSummary = hasCurrentReceivableDue
            ? `当前账期未收 ${formatWan(currentReceivableDueAmount, 1)}`
            : '当前账期无未收';
        const historicalArrearsData = input.historicalArrearsByTenantId?.get(tenant.id);
        const historicalArrearsAmount = historicalArrearsData?.amount || 0;
        const hasHistoricalArrears = historicalArrearsAmount > 0.005;
        const historicalArrearsSummary = hasHistoricalArrears
            ? `历史欠费 ${formatWan(historicalArrearsAmount, 1)}${historicalArrearsData?.latestPeriod ? ` · 最近 ${historicalArrearsData.latestPeriod}` : ''}`
            : '无历史欠费';
        const helper = tenant.contactName
            ? `联系人 ${tenant.contactName}`
            : tenant.leaseEnd
              ? `租期至 ${tenant.leaseEnd}`
              : tenant.industry || '暂无联系人';
        const leaseEndMonth = toYearMonth(tenant.leaseEnd);

        return {
            id: tenant.id,
            name: tenant.name,
            location,
            status: tenant.status,
            buildingId: tenant.buildingId,
            buildingName,
            leaseEnd: tenant.leaseEnd,
            leaseEndMonth,
            hasPaymentRecord,
            hasCurrentReceivableDue,
            currentReceivableDueAmount,
            hasHistoricalArrears,
            historicalArrearsAmount,
            statusLabel: mobileContractStatusText(tenant.status),
            helper,
            paymentSummary,
            receivableSummary,
            historicalArrearsSummary,
            searchText: [
                tenant.name,
                tenant.contactName,
                tenant.legalRepName,
                tenant.contactInfo,
                tenant.industry,
                buildingName,
                allUnitNames.join(' '),
            ].filter(Boolean).join(' ').toLowerCase(),
        };
    });
}

export function filterMobileTenantSearchIndex(
    index: MobileTenantSearchIndexEntry[],
    options: MobileTenantSearchFilterOptions = {},
): MobileTenantSearchIndexEntry[] {
    return index.filter((item) => {
        if (options.status && item.status !== options.status) return false;
        if (options.buildingId && item.buildingId !== options.buildingId) return false;
        if (options.leaseEndMonth && item.leaseEndMonth !== options.leaseEndMonth) return false;
        if (options.paymentFilter === 'paid' && !item.hasPaymentRecord) return false;
        if (options.paymentFilter === 'none' && item.hasPaymentRecord) return false;
        if (options.receivableFilter === 'due' && !item.hasCurrentReceivableDue) return false;
        if (options.receivableFilter === 'clear' && item.hasCurrentReceivableDue) return false;
        if (options.arrearsFilter === 'historical_due' && !item.hasHistoricalArrears) return false;
        if (options.arrearsFilter === 'historical_clear' && item.hasHistoricalArrears) return false;
        return true;
    });
}

export function selectMobileTenantSearchResults(
    index: MobileTenantSearchIndexEntry[],
    query: string,
    limit = 4,
): MobileTenantSearchResult[] {
    if (limit <= 0) return [];
    const normalizedQuery = query.trim().toLowerCase();
    const results: MobileTenantSearchResult[] = [];
    for (const item of index) {
        if (normalizedQuery ? !item.searchText.includes(normalizedQuery) : item.status === ContractStatus.Terminated) {
            continue;
        }
        const {
            status,
            buildingId,
            buildingName,
            leaseEnd,
            leaseEndMonth,
            hasPaymentRecord,
            hasCurrentReceivableDue,
            currentReceivableDueAmount,
            hasHistoricalArrears,
            historicalArrearsAmount,
            searchText,
            ...result
        } = item;
        void status;
        void buildingId;
        void buildingName;
        void leaseEnd;
        void leaseEndMonth;
        void hasPaymentRecord;
        void hasCurrentReceivableDue;
        void currentReceivableDueAmount;
        void hasHistoricalArrears;
        void historicalArrearsAmount;
        void searchText;
        results.push(result);
        if (results.length >= limit) break;
    }
    return results;
}

export function countMobileTenantSearchResults(index: MobileTenantSearchIndexEntry[], query: string): number {
    const normalizedQuery = query.trim().toLowerCase();
    return index.filter((item) =>
        normalizedQuery ? item.searchText.includes(normalizedQuery) : item.status !== ContractStatus.Terminated
    ).length;
}
