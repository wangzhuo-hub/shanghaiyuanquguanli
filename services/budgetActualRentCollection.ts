import type { PaymentRecord, Tenant } from '../types';
import { normalizeBudgetRowKeyPart } from './budgetRowKey';

type BudgetActualRentEntry = {
    id: string;
    amount: number;
};

export type BudgetActualRentCollectionIndex = {
    tenantById: Map<string, Tenant>;
    direct: Map<string, BudgetActualRentEntry[]>;
    root: Map<string, BudgetActualRentEntry[]>;
    name: Map<string, BudgetActualRentEntry[]>;
    resolved: Map<string, number>;
};

const indexKey = (identity: string, periodYYYYMM: string): string => `${identity}###${periodYYYYMM}`;

export function parseBudgetActualPaymentPeriods(periodRaw?: string): string[] {
    if (!periodRaw) return [];
    return Array.from(new Set(
        periodRaw
            .split(/[,\n;，；\s]+/)
            .map((s) => s.trim())
            .filter(Boolean)
            .filter((s) => /^\d{4}-\d{2}$/.test(s))
    ));
}

const addEntry = (
    map: Map<string, BudgetActualRentEntry[]>,
    identity: string,
    periodYYYYMM: string,
    entry: BudgetActualRentEntry,
): void => {
    if (!identity) return;
    const key = indexKey(identity, periodYYYYMM);
    const list = map.get(key);
    if (list) list.push(entry);
    else map.set(key, [entry]);
};

export function buildBudgetActualRentCollectionIndex(
    payments: PaymentRecord[],
    allTenants: Tenant[],
): BudgetActualRentCollectionIndex {
    const tenantById = new Map<string, Tenant>();
    for (const tenant of allTenants) tenantById.set(tenant.id, tenant);

    const index: BudgetActualRentCollectionIndex = {
        tenantById,
        direct: new Map(),
        root: new Map(),
        name: new Map(),
        resolved: new Map(),
    };

    payments.forEach((payment, paymentIndex) => {
        if (payment.type !== 'Rent' && payment.type !== 'DepositToRent') return;
        const tenantId = String(payment.tenantId || '');
        if (!tenantId) return;
        const periods = parseBudgetActualPaymentPeriods(payment.period);
        const targetPeriods = periods.length > 0 ? periods : payment.date ? [payment.date.slice(0, 7)] : [];
        if (targetPeriods.length === 0) return;

        const paymentTenant = tenantById.get(tenantId);
        const paymentRoot = paymentTenant ? (paymentTenant.rootId || paymentTenant.id) : '';
        const paymentTenantNameKey = paymentTenant ? normalizeBudgetRowKeyPart(paymentTenant.name) : '';
        const paymentRecordNameKey = normalizeBudgetRowKeyPart(payment.tenantName);
        const amountPerPeriod = periods.length > 0 ? payment.amount / periods.length : payment.amount;

        targetPeriods.forEach((periodYYYYMM) => {
            if (!/^\d{4}-\d{2}$/.test(periodYYYYMM)) return;
            const entry = {
                id: `${payment.id || `${tenantId}:${payment.date}:${payment.amount}`}:${paymentIndex}`,
                amount: amountPerPeriod,
            };
            addEntry(index.direct, tenantId, periodYYYYMM, entry);
            if (paymentRoot) addEntry(index.root, paymentRoot, periodYYYYMM, entry);
            if (paymentTenantNameKey) addEntry(index.name, paymentTenantNameKey, periodYYYYMM, entry);
            if (paymentRecordNameKey) addEntry(index.name, paymentRecordNameKey, periodYYYYMM, entry);
        });
    });

    return index;
}

const collectEntries = (
    source: Map<string, BudgetActualRentEntry[]>,
    identity: string,
    periodYYYYMM: string,
    seen: Set<string>,
): number => {
    const list = source.get(indexKey(identity, periodYYYYMM));
    if (!list) return 0;
    let sum = 0;
    for (const entry of list) {
        if (seen.has(entry.id)) continue;
        seen.add(entry.id);
        sum += entry.amount;
    }
    return sum;
};

export function sumBudgetActualRentCollectionForTenantPeriod(
    index: BudgetActualRentCollectionIndex,
    tenant: Tenant,
    periodYYYYMM: string,
): number {
    if (!tenant?.id || !periodYYYYMM) return 0;
    const tenantNameKey = normalizeBudgetRowKeyPart(tenant.name);
    const tenantRoot = tenant.rootId || tenant.id;
    const cacheKey = `${tenant.id}###${tenantRoot}###${tenantNameKey}###${periodYYYYMM}`;
    const cached = index.resolved.get(cacheKey);
    if (cached != null) return cached;

    const seen = new Set<string>();
    let sum = 0;
    sum += collectEntries(index.direct, tenant.id, periodYYYYMM, seen);
    sum += collectEntries(index.root, tenantRoot, periodYYYYMM, seen);
    sum += collectEntries(index.name, tenantNameKey, periodYYYYMM, seen);
    index.resolved.set(cacheKey, sum);
    return sum;
}
