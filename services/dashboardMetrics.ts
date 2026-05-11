import type { KpiSnapshotSummary } from './pocketbaseService';
import {
    BillingDetail,
    BudgetAdjustment,
    BudgetAssumption,
    BudgetScenario,
    Building,
    ContractStatus,
    DashboardData,
    MonthlyInitData,
    MonthlyTrend,
    ParkingStatDetail,
    PaymentRecord,
    Tenant,
    UnitStatus,
} from '../types';
import { BudgetedBill, buildVacancyBudgetAlignmentNote, FAR_FUTURE_DATE, generateBudgetedBills, getVirtualTenants } from './billingService';
import {
    importedBudgetRowKey,
    readBudgetCustomerNameLinks,
    readImportedBudgetTable,
    tenantImportedBudgetRowKey,
} from './budgetTableImport';
import { toFixedNumber, roundMoney2 } from './numberFormat';
import {
    applyBillingPeriodDeferNotes,
    parseSpecialBusinessReceivablesFromNotes,
    receivableBudgetMonthForBill,
    specialBusinessArDisplayTenantId,
    sumRentPaymentsAllocatedToBillingTenant,
} from './receivableListHelpers';

export type DashboardQuarter = 'All' | 'Q1' | 'Q2' | 'Q3' | 'Q4';

export type DashboardMetricResult = {
    processedData: DashboardData;
    fullYearMonthlyTrends: MonthlyTrend[];
};

export type DashboardMetricOptions = {
    year: number;
    quarter: DashboardQuarter;
    billingSelectedMonth: string;
    /** 轻量模式：跳过欠款循环、趋势计算等重运算（非仪表盘页面使用） */
    quickMode?: boolean;
};

export const RECEIVABLE_DEDICATED_SCENARIO_ID_PREFIX = 'invoice_dedicated_';

type BillingCache = {
    buildingById: Map<string, Building>;
    paymentsByTenantId: Map<string, PaymentRecord[]>;
    rentParkingByMonth: Map<string, number>;
    initByYearMonth: Map<string, MonthlyInitData>;
    generatedBillsByTenantYear: Map<string, BudgetedBill[]>;
    detailsByKey: Map<string, BillingDetail[]>;
    contextSeq: WeakMap<object, number>;
    nextContextId: number;
};

const createBillingCache = (
    buildings: Building[],
    payments: PaymentRecord[],
    initializationData: MonthlyInitData[]
): BillingCache => {
    const buildingById = new Map(buildings.map((b) => [b.id, b]));
    const paymentsByTenantId = new Map<string, PaymentRecord[]>();
    const rentParkingByMonth = new Map<string, number>();
    const initByYearMonth = new Map<string, MonthlyInitData>();

    for (const payment of payments) {
        const list = paymentsByTenantId.get(payment.tenantId) || [];
        list.push(payment);
        paymentsByTenantId.set(payment.tenantId, list);

        if (payment.date && (payment.type === 'Rent' || payment.type === 'ParkingFee')) {
            const monthKey = payment.date.slice(0, 7);
            rentParkingByMonth.set(monthKey, (rentParkingByMonth.get(monthKey) || 0) + (payment.amount || 0));
        }
    }

    for (const row of initializationData) {
        initByYearMonth.set(`${row.year}_${row.month}`, row);
    }

    return {
        buildingById,
        paymentsByTenantId,
        rentParkingByMonth,
        initByYearMonth,
        generatedBillsByTenantYear: new Map(),
        detailsByKey: new Map(),
        contextSeq: new WeakMap(),
        nextContextId: 1,
    };
};

const getContextId = (cache: BillingCache, value: object | undefined): number => {
    if (!value) return 0;
    const existing = cache.contextSeq.get(value);
    if (existing) return existing;
    const next = cache.nextContextId++;
    cache.contextSeq.set(value, next);
    return next;
};

export const getActiveScenarioForBudgetYear = (
    scenarios: BudgetScenario[] | undefined,
    year: number
): BudgetScenario | undefined => {
    const fallbackYear = new Date().getFullYear();
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
    const fallbackYear = new Date().getFullYear();
    const list = scenarios || [];
    const byYear = (s: BudgetScenario) => (s.budgetYear || fallbackYear) === year;
    return list.find((s) => byYear(s) && isReceivableDedicatedScenario(s)) || list.find((s) => byYear(s) && s.isActive);
};

/**
 * 应收专用方案内的 assumptions 为创建/同步时的拷贝；用户在「预算管理」里改的账期偏移、单价假设等
 * 只更新根级 `budgetAssumptions`。合并时同 target 以根级为准，避免核销月与合同概要/预算表不一致。
 */
const mergeAssumptionsForReceivable = (
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

/** 同上：预算调整以根级 `budgetAdjustments` 覆盖同 id，避免专用方案内旧数组挡住新调账。 */
const mergeAdjustmentsForReceivable = (
    scenarioAdjustments: BudgetAdjustment[] | undefined,
    liveAdjustments: BudgetAdjustment[] | undefined
): BudgetAdjustment[] => {
    const map = new Map<string, BudgetAdjustment>();
    for (const a of scenarioAdjustments || []) map.set(a.id, a);
    for (const a of liveAdjustments || []) map.set(a.id, a);
    return [...map.values()];
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

export const normalizeScenarioForReceivable = (
    scenarios: BudgetScenario[] | undefined,
    fallbackTenants: Tenant[],
    fallbackBuildings: Building[]
): BudgetScenario[] => {
    const withDedicated = ensureDedicatedReceivableScenarios(scenarios, fallbackTenants, fallbackBuildings);
    return normalizeReceivableScenarioByYear(withDedicated);
};

const billingStatusFromAmounts = (amountDue: number, amountPaid: number): BillingDetail['status'] => {
    if (amountPaid >= amountDue && amountDue > 0) return 'Paid';
    if (amountPaid > 0 && amountPaid < amountDue) return 'Partial';
    if (amountDue === 0 && amountPaid > 0) return 'Paid';
    return 'Unpaid';
};

const applyImportedBudgetRowsToBillingDetails = (
    details: BillingDetail[],
    year: number,
    month: number,
    tenants: Tenant[],
    buildings: Building[],
    cache: BillingCache,
    billingPeriodNotes: Record<string, string> | undefined,
    paymentMatchTenants: Tenant[]
): BillingDetail[] => {
    const imported = readImportedBudgetTable(billingPeriodNotes, year);
    if (!imported?.rows?.length) return details;

    const importedByKey = new Map(imported.rows.map((row) => [importedBudgetRowKey(row.customer, row.unit, row.building), row] as const));
    if (importedByKey.size === 0) return details;

    const buildingById = cache.buildingById.size > 0 ? cache.buildingById : new Map(buildings.map((b) => [b.id, b]));
    const nameLinks = readBudgetCustomerNameLinks(billingPeriodNotes, year);
    const importKeyByTenantId = new Map(nameLinks.map((l) => [l.tenantId, l.importKey] as const));
    const result = details.map((detail) => ({ ...detail }));
    const detailIndexByTenantId = new Map(result.map((detail, index) => [detail.tenantId, index] as const));
    const periodPrefix = `${year}-${String(month + 1).padStart(2, '0')}`;

    for (const tenant of tenants) {
        // 特殊业态：合同 / 导入预算表都不再生成应收，金额由「财务报表 → 特殊业态收入录入」按月手工录入
        if (tenant.isSpecialBusiness) continue;
        let importedRow = importedByKey.get(tenantImportedBudgetRowKey(tenant, buildingById));
        if (!importedRow) {
            const linkedKey = importKeyByTenantId.get(tenant.id);
            if (linkedKey) importedRow = importedByKey.get(linkedKey);
        }
        if (!importedRow) continue;

        const importedCell = Math.round(Number(importedRow.months?.[month] || 0));
        const existingIndex = detailIndexByTenantId.get(tenant.id);
        const amountPaid =
            existingIndex !== undefined
                ? result[existingIndex].amountPaid
                : sumRentPaymentsAllocatedToBillingTenant(
                      tenant.id,
                      periodPrefix,
                      paymentMatchTenants,
                      cache.paymentsByTenantId
                  );

        if (existingIndex !== undefined) {
            // 导入单元格为 0 / 空：视为「未填写该月覆盖」，保留应收专用方案+合同滚动推算金额。
            // 否则易与「合同详情 → 应收预览」不一致，且核销表会整行消失。
            const contractDue = result[existingIndex].amountDue;
            // 仅当合同推算本月已有应收时，才用导入金额覆盖；避免 Excel 误填月（如季付应在 3/6/9 却在 1 月填数）制造幽灵核销行。
            if (importedCell > 0.005 && contractDue > 0.005) {
                result[existingIndex].amountDue = importedCell;
                result[existingIndex].status = billingStatusFromAmounts(importedCell, amountPaid);
            }
            if (!result[existingIndex].billingTermsTenant) {
                result[existingIndex].billingTermsTenant = tenant;
            }
            continue;
        }

        // 合同推算本月未生成明细且本无收款时：不因导入表单独金额插入行（与合同概要「当前账期无对应账单」一致）。
        if (importedCell > 0.005 && amountPaid <= 0.005) {
            continue;
        }

        if (importedCell > 0.005 || amountPaid > 0.005) {
            result.push({
                tenantId: tenant.id,
                tenantName: tenant.name,
                unitIds: tenant.unitIds,
                amountDue: importedCell,
                amountPaid,
                status: billingStatusFromAmounts(importedCell, amountPaid),
                billingTermsTenant: tenant,
            });
        }
    }

    return result.filter((detail) => detail.amountDue > 0.005 || detail.amountPaid > 0.005);
};

const getGeneratedBillsForTenantYear = (
    tenant: Tenant,
    year: number,
    assumptions: BudgetAssumption[],
    adjustments: BudgetAdjustment[],
    cache: BillingCache,
    contextKey: string
) => {
    const key = `${tenant.id}|${year}|${contextKey}`;
    const cached = cache.generatedBillsByTenantYear.get(key);
    if (cached) return cached;

    const genStart = new Date(year - 2, 0, 1);
    const genEnd = new Date(year + 2, 11, 31);
    const bills = generateBudgetedBills(tenant, assumptions, adjustments, genStart, genEnd);
    cache.generatedBillsByTenantYear.set(key, bills);
    return bills;
};

const billAttributedToReceivablePeriod = (bill: BudgetedBill, tenant: Tenant, periodStart: Date): boolean => {
    const { year: y, monthIndex: m } = receivableBudgetMonthForBill(bill, tenant);
    return y === periodStart.getFullYear() && m === periodStart.getMonth();
};

const calculateBudgetedReceivableForTenant = (
    tenant: Tenant,
    periodStart: Date,
    periodEnd: Date,
    selfUseUnitIds: Set<string>,
    assumptions: BudgetAssumption[],
    adjustments: BudgetAdjustment[],
    cache: BillingCache,
    contextKey: string
): number => {
    const isSelfUse = tenant.unitIds.some((uid) => selfUseUnitIds.has(uid));
    if (isSelfUse) return 0;
    const bills = getGeneratedBillsForTenantYear(tenant, periodStart.getFullYear(), assumptions, adjustments, cache, contextKey);
    let total = 0;
    for (const bill of bills) {
        if (billAttributedToReceivablePeriod(bill, tenant, periodStart)) {
            total += bill.amount;
        }
    }
    return Math.round(total);
};

const getBillingDetailsForPeriodInternal = (
    year: number,
    month: number,
    allTenants: Tenant[],
    virtualTenants: Tenant[],
    selfUseUnitIds: Set<string>,
    assumptions: BudgetAssumption[],
    adjustments: BudgetAdjustment[],
    cache: BillingCache,
    contextKey: string,
    paymentMatchTenants: Tenant[]
): BillingDetail[] => {
    const periodStart = new Date(year, month, 1);
    const periodEnd = new Date(year, month + 1, 0);
    const periodPrefix = `${year}-${String(month + 1).padStart(2, '0')}`;
    const details: BillingDetail[] = [];
    const combinedTenants = [...allTenants, ...virtualTenants];

    const earlyTerminationBreakdownInPeriod = (
        tenant: Tenant,
        y: number,
        m: number
    ): string | undefined => {
        if (tenant.terminationType !== 'Early') return undefined;
        const bills = getGeneratedBillsForTenantYear(tenant, y, assumptions, adjustments, cache, contextKey);
        const ps = new Date(y, m, 1);
        const pe = new Date(y, m + 1, 0);
        const parts: string[] = [];
        for (const b of bills) {
            if (b.date < ps || b.date > pe) continue;
            const d = b.earlyTerminationExtraDetail;
            if (!d || !(b.earlyTerminationExtraAmount && Math.abs(b.earlyTerminationExtraAmount) > 0.005)) continue;
            const bits: string[] = [];
            if (d.clawback) bits.push(`免租扣回 ${d.clawback}`);
            if (d.deposit) bits.push(`押金扣款 ${d.deposit}`);
            if (d.other) bits.push(`其它 ${d.other}`);
            if (bits.length) parts.push(bits.join('，'));
        }
        return parts.length ? `提前退租结算（已计入应收）：${parts.join('；')}` : undefined;
    };

    for (const tenant of combinedTenants) {
        const isSelfUse = tenant.unitIds.some((uid) => selfUseUnitIds.has(uid));
        if (isSelfUse) continue;
        // 特殊业态：合同不滚动账单，应收由「财务报表 → 特殊业态收入录入」按月手工录入注入
        if (tenant.isSpecialBusiness) continue;

        const amountDue = calculateBudgetedReceivableForTenant(
            tenant,
            periodStart,
            periodEnd,
            selfUseUnitIds,
            assumptions,
            adjustments,
            cache,
            contextKey
        );

        const amountPaid = sumRentPaymentsAllocatedToBillingTenant(
            tenant.id,
            periodPrefix,
            paymentMatchTenants,
            cache.paymentsByTenantId
        );

        if (tenant.status === 'Terminated' && !tenant.id.startsWith('virt_')) {
            if (amountDue <= 0.005 && amountPaid <= 0.005) continue;
        }

        if (amountDue > 0 || amountPaid > 0) {
            let status: BillingDetail['status'] = 'Unpaid';
            if (amountPaid >= amountDue && amountDue > 0) status = 'Paid';
            else if (amountPaid > 0 && amountPaid < amountDue) status = 'Partial';
            else if (amountDue === 0 && amountPaid > 0) status = 'Paid';
            const earlyTerminationBreakdown = earlyTerminationBreakdownInPeriod(tenant, year, month);
            details.push({
                tenantId: tenant.id,
                tenantName: tenant.name,
                unitIds: tenant.unitIds,
                amountDue,
                amountPaid,
                status,
                earlyTerminationBreakdown,
                billingTermsTenant: tenant,
            });
        }
    }

    return details;
};

const attachVacancyBudgetAlignmentNotes = (
    details: BillingDetail[],
    tenants: Tenant[],
    allAssumptions: BudgetAssumption[],
): BillingDetail[] => {
    const tenantById = new Map(tenants.map((t) => [t.id, t]));
    return details.map((d) => {
        if (d.tenantId.startsWith('virt_')) return d;
        const t = tenantById.get(d.tenantId);
        const budgetAlignmentNote = buildVacancyBudgetAlignmentNote(t, allAssumptions);
        if (!budgetAlignmentNote) return d;
        return { ...d, budgetAlignmentNote };
    });
};

export const buildBillingDetailsForPeriod = (
    year: number,
    month: number,
    ctx: DashboardData,
    cache?: BillingCache
): BillingDetail[] => {
    const localCache = cache || createBillingCache(ctx.buildings || [], ctx.payments || [], ctx.initializationData || []);
    const cacheKey = `details|${year}|${month}|${getContextId(localCache, ctx)}|${getContextId(localCache, ctx.budgetScenarios || [])}|${getContextId(localCache, ctx.billingPeriodNotes || {})}`;
    const cached = localCache.detailsByKey.get(cacheKey);
    if (cached) return cached;

    const receivableScenario = getReceivableScenarioForYear(ctx.budgetScenarios, year);
    const scenarioTenants = receivableScenario?.baseDataSnapshot?.tenants || ctx.tenants;
    const scenarioBuildings = receivableScenario?.baseDataSnapshot?.buildings || ctx.buildings;
    const receivableAdjustments = mergeAdjustmentsForReceivable(
        receivableScenario?.adjustments,
        ctx.budgetAdjustments
    );
    const receivableAssumptions = mergeAssumptionsForReceivable(
        receivableScenario?.assumptions,
        ctx.budgetAssumptions
    );

    const liveTenantMap = new Map((ctx.tenants || []).map((t) => [t.id, t]));
    const periodStart = new Date(year, month, 1);
    const hasContractChanged = (snapshot: Tenant, live: Tenant): boolean =>
        snapshot.status !== live.status ||
        snapshot.terminationDate !== live.terminationDate ||
        snapshot.paymentCycle !== live.paymentCycle ||
        snapshot.paymentCycleMonths !== live.paymentCycleMonths ||
        snapshot.firstPaymentDate !== live.firstPaymentDate ||
        snapshot.firstPaymentMonths !== live.firstPaymentMonths ||
        snapshot.leaseStart !== live.leaseStart ||
        snapshot.leaseEnd !== live.leaseEnd ||
        snapshot.monthlyRent !== live.monthlyRent ||
        snapshot.unitPrice !== live.unitPrice ||
        snapshot.freeRentHandling !== live.freeRentHandling ||
        JSON.stringify(snapshot.rentFreePeriods || []) !== JSON.stringify(live.rentFreePeriods || []) ||
        JSON.stringify(snapshot.unitTerms || snapshot.paymentTerms || []) !== JSON.stringify(live.unitTerms || live.paymentTerms || []) ||
        snapshot.earlyTerminationFreeRentClawbackOverride !== live.earlyTerminationFreeRentClawbackOverride ||
        snapshot.earlyTerminationDepositDeduction !== live.earlyTerminationDepositDeduction ||
        snapshot.earlyTerminationOtherAdjustment !== live.earlyTerminationOtherAdjustment;
    /** 合同条款变更的「最早生效」自然月首日：取各候选日期的最早值，便于免租新增等场景在对应月及之后走实时合同。 */
    const inferContractChangeDate = (snapshot: Tenant, live: Tenant): Date | null => {
        const candidates: string[] = [];
        if (snapshot.terminationDate !== live.terminationDate && live.terminationDate) candidates.push(live.terminationDate);
        if (snapshot.firstPaymentDate !== live.firstPaymentDate && live.firstPaymentDate) candidates.push(live.firstPaymentDate);
        if (snapshot.signingDate !== live.signingDate && live.signingDate) candidates.push(live.signingDate);
        if (snapshot.leaseStart !== live.leaseStart && live.leaseStart) candidates.push(live.leaseStart);
        if (JSON.stringify(snapshot.rentFreePeriods || []) !== JSON.stringify(live.rentFreePeriods || [])) {
            for (const r of live.rentFreePeriods || []) {
                if (r?.start) candidates.push(r.start);
            }
        }
        let best: Date | null = null;
        for (const c of candidates) {
            const d = new Date(c);
            if (Number.isNaN(d.getTime())) continue;
            if (!best || d.getTime() < best.getTime()) best = d;
        }
        return best;
    };

    const mergedTenants = (scenarioTenants || []).map((snapshot) => {
        const live = liveTenantMap.get(snapshot.id);
        // 「特殊业态」是 UI 层的标注（不是合同条款变更），无论是否使用快照都应同步最新值，
        // 否则即使在合同中心点选了「特殊业态」，应收专用方案下的旧快照仍会按合同滚动账单。
        const overlaySpecial = (t: Tenant): Tenant =>
            live ? { ...t, isSpecialBusiness: !!live.isSpecialBusiness } : t;
        if (!live) return snapshot;
        if (!hasContractChanged(snapshot, live)) return overlaySpecial(snapshot);
        const changeDate = inferContractChangeDate(snapshot, live);
        if (changeDate && periodStart < new Date(changeDate.getFullYear(), changeDate.getMonth(), 1)) {
            return overlaySpecial(snapshot);
        }
        return overlaySpecial(live);
    });
    const scenarioTenantIds = new Set(mergedTenants.map((t) => t.id));
    const actualSignedThisYear = (ctx.tenants || []).filter((t) => {
        const signStr = t.signingDate || t.leaseStart;
        if (!signStr) return false;
        const d = new Date(signStr);
        return !Number.isNaN(d.getTime()) && d.getFullYear() === year;
    });
    const mergedWithSignedTenants = [...mergedTenants];
    actualSignedThisYear.forEach((t) => {
        if (!scenarioTenantIds.has(t.id)) mergedWithSignedTenants.push(t);
    });

    const selfUseUnitIds = new Set<string>();
    (scenarioBuildings || []).forEach((b) => b.units.forEach((u) => u.isSelfUse && selfUseUnitIds.add(u.id)));
    const contextKey = `receivable|${getContextId(localCache, receivableAssumptions)}|${getContextId(localCache, receivableAdjustments)}`;
    const internal = getBillingDetailsForPeriodInternal(
        year,
        month,
        mergedWithSignedTenants,
        [],
        selfUseUnitIds,
        receivableAssumptions,
        receivableAdjustments,
        localCache,
        contextKey,
        ctx.tenants || []
    );
    const importedAligned = applyImportedBudgetRowsToBillingDetails(
        internal,
        year,
        month,
        mergedWithSignedTenants,
        scenarioBuildings || [],
        localCache,
        ctx.billingPeriodNotes,
        ctx.tenants || []
    );
    const withDefer = applyBillingPeriodDeferNotes(importedAligned, year, month, ctx.billingPeriodNotes, ctx.tenants);
    const result = applySpecialBusinessReceivables(withDefer, year, month, ctx.billingPeriodNotes, ctx.tenants, ctx.payments || []);
    const assumptionsForVacancyNotes = receivableScenario?.assumptions ?? ctx.budgetAssumptions ?? [];
    const withVacancyNotes = attachVacancyBudgetAlignmentNotes(result, ctx.tenants || [], assumptionsForVacancyNotes);
    localCache.detailsByKey.set(cacheKey, withVacancyNotes);
    return withVacancyNotes;
};

/**
 * 把「特殊业态收入录入」的月度金额注入应收明细：
 * - 同一 (tenantId, period) 在表中以单独一行展示，便于核销/开票分开操作；
 * - amountPaid 来自匹配 (special-ar tenantId 或真实 tenantId) + period 的真实收款；
 * - 不再生成合同账单，因此与系统账单不会重复。
 */
const applySpecialBusinessReceivables = (
    details: BillingDetail[],
    year: number,
    month: number,
    notes: Record<string, string> | undefined,
    allTenants: Tenant[],
    payments: PaymentRecord[]
): BillingDetail[] => {
    const periodPrefix = `${year}-${String(month + 1).padStart(2, '0')}`;
    const all = parseSpecialBusinessReceivablesFromNotes(notes);
    const forPeriod = all.filter((r) => r.periodYYYYMM === periodPrefix);
    if (forPeriod.length === 0) return details;

    const tenantById = new Map(allTenants.map((t) => [t.id, t]));
    const out = [...details];
    for (const row of forPeriod) {
        const tenant = tenantById.get(row.tenantId);
        if (!tenant) continue;
        if (!tenant.isSpecialBusiness) continue;
        const displayTenantId = specialBusinessArDisplayTenantId(row.tenantId, periodPrefix);
        const amountDue = roundMoney2(row.amount);
        if (!Number.isFinite(amountDue) || amountDue <= 0.005) continue;

        const matchesTenant = (paymentTenantId: string): boolean => {
            if (!paymentTenantId) return false;
            if (paymentTenantId === displayTenantId) return true;
            if (paymentTenantId === row.tenantId) return true;
            return false;
        };
        const matchesPeriod = (p: PaymentRecord): boolean => {
            const list = (p.period || '')
                .split(/[,\n;，；\s]+/)
                .map((s) => s.trim())
                .filter(Boolean)
                .filter((s) => /^\d{4}-\d{2}$/.test(s));
            if (list.length > 0) return list.includes(periodPrefix);
            return p.date.startsWith(periodPrefix);
        };

        const amountPaid = roundMoney2(
            payments
                .filter((p) => (p.type === 'Rent' || p.type === 'DepositToRent') && matchesTenant(p.tenantId) && matchesPeriod(p))
                .reduce((sum, p) => sum + (p.amount || 0), 0)
        );
        let status: BillingDetail['status'] = 'Unpaid';
        if (amountPaid >= amountDue && amountDue > 0) status = 'Paid';
        else if (amountPaid > 0 && amountPaid < amountDue) status = 'Partial';
        else if (amountDue === 0 && amountPaid > 0) status = 'Paid';

        out.push({
            tenantId: displayTenantId,
            tenantName: tenant.name,
            unitIds: tenant.unitIds || [],
            amountDue,
            amountPaid,
            status,
            billingTermsTenant: tenant,
        });
    }
    return out;
};

const calculateTrends = (
    tenants: Tenant[],
    virtualTenants: Tenant[],
    payments: PaymentRecord[],
    totalLeasableArea: number,
    selfUseUnitIds: Set<string>,
    year: number,
    quarter: DashboardQuarter,
    assumptions: BudgetAssumption[],
    adjustments: BudgetAdjustment[],
    initializationData: MonthlyInitData[] = [],
    buildings: Building[] = [],
    budgetContext: { tenants: Tenant[]; buildings: Building[]; assumptions: BudgetAssumption[]; adjustments: BudgetAdjustment[] } | undefined,
    cache: BillingCache,
    billingPeriodNotes?: Record<string, string>
): MonthlyTrend[] => {
    const trends: MonthlyTrend[] = [];
    const now = new Date();
    const currentSystemYear = now.getFullYear();
    const currentSystemMonth = now.getMonth();
    const buildingMap = cache.buildingById.size > 0 ? cache.buildingById : new Map(buildings.map((b) => [b.id, b]));
    const importedBudgetTable = readImportedBudgetTable(billingPeriodNotes, year);

    let startMonth = 0;
    let endMonth = 11;
    if (quarter === 'Q1') endMonth = 2;
    else if (quarter === 'Q2') {
        startMonth = 3;
        endMonth = 5;
    } else if (quarter === 'Q3') {
        startMonth = 6;
        endMonth = 8;
    } else if (quarter === 'Q4') {
        startMonth = 9;
        endMonth = 11;
    }

    const targetCtx = budgetContext || { tenants, buildings, assumptions, adjustments };
    const targetSelfUseUnitIds = new Set<string>();
    targetCtx.buildings.forEach((b) => b.units.forEach((u) => u.isSelfUse && targetSelfUseUnitIds.add(u.id)));
    const targetVirtualTenants = getVirtualTenants(targetCtx.tenants, targetCtx.buildings, targetCtx.assumptions);
    const contextKey = `trend|${getContextId(cache, targetCtx.tenants)}|${getContextId(cache, targetCtx.assumptions)}|${getContextId(cache, targetCtx.adjustments)}`;

    for (let month = startMonth; month <= endMonth; month++) {
        const monthLabel = `${month + 1}月`;
        const initEntry = cache.initByYearMonth.get(`${year}_${month + 1}`) || initializationData.find((d) => d.year === year && d.month === month + 1);
        const startDate = new Date(year, month, 1);
        const endDate = new Date(year, month + 1, 0);
        const isFutureMonth = year > currentSystemYear || (year === currentSystemYear && month > currentSystemMonth);

        let leasedAreaInMonth = 0;
        let totalRentInMonth = 0;
        let physicalTenantAreaForPrice = 0;
        for (const tenant of tenants) {
            const building = buildingMap.get(tenant.buildingId);
            if (building && building.type === 'Site') continue;
            const isSelfUse = tenant.unitIds.some((uid) => selfUseUnitIds.has(uid));
            if (isSelfUse) continue;

            const achievedDate = tenant.signingDate ? new Date(tenant.signingDate) : new Date(tenant.leaseStart);
            const leaseEnd = tenant.leaseEnd ? new Date(tenant.leaseEnd) : new Date(FAR_FUTURE_DATE);
            const terminationDate = tenant.terminationDate ? new Date(tenant.terminationDate) : null;
            const effectiveEnd = terminationDate && terminationDate < leaseEnd ? terminationDate : leaseEnd;
            if (achievedDate <= endDate && effectiveEnd > endDate) leasedAreaInMonth += tenant.totalArea;

            const physicalLeaseStart = new Date(tenant.leaseStart);
            if (physicalLeaseStart <= endDate && effectiveEnd >= startDate) {
                let price = tenant.unitPrice;
                if (!price && tenant.totalArea > 0) price = (tenant.monthlyRent / tenant.totalArea) * 12 / 365;
                totalRentInMonth += (price || 0) * tenant.totalArea;
                physicalTenantAreaForPrice += tenant.totalArea;
            }
        }

        let occupancyRate = totalLeasableArea > 0 ? toFixedNumber((leasedAreaInMonth / totalLeasableArea) * 100) : 0;
        const avgUnitPrice = physicalTenantAreaForPrice > 0 ? Number((totalRentInMonth / physicalTenantAreaForPrice).toFixed(2)) : 0;
        const monthlyBillingDetails = getBillingDetailsForPeriodInternal(
            year,
            month,
            targetCtx.tenants,
            targetVirtualTenants,
            targetSelfUseUnitIds,
            targetCtx.assumptions,
            targetCtx.adjustments,
            cache,
            contextKey,
            tenants
        );
        const monthlyTargetBilled = monthlyBillingDetails.reduce((sum, d) => sum + d.amountDue, 0);
        // 合同应收：仅含真实履约合同（排除预算虚拟租户），按条款（免租期、收款周期等）滚动计算
        const realOnlyDetails = getBillingDetailsForPeriodInternal(
            year, month,
            targetCtx.tenants, [],
            targetSelfUseUnitIds,
            targetCtx.assumptions, targetCtx.adjustments,
            cache, contextKey + '|real', tenants
        );
        const contractReceivable = realOnlyDetails.reduce((sum, d) => sum + d.amountDue, 0);
        const periodPrefix = `${year}-${String(month + 1).padStart(2, '0')}`;
        // 工作台预算执行的实际收款按真实入账日期归集，不按关联账期分摊。
        const actualFromPaymentDetails = payments
            .filter((p) => p.date && p.date.startsWith(periodPrefix) && (p.type === 'Rent' || p.type === 'DepositToRent'))
            .reduce((sum, p) => sum + p.amount, 0);

        // 预算收款：优先使用初始化中的月度年度任务（revenueTarget）；若为 0 或未填写则回退到预算表（导入）或生效方案滚动应收
        const budgetFromTableOrScenario = importedBudgetTable
            ? Math.round(Number(importedBudgetTable.monthlyTotals?.[month] || 0))
            : monthlyTargetBilled;
        let revenueTarget = budgetFromTableOrScenario;
        let revenueCollected: number | null = actualFromPaymentDetails;
        let collectionRate: number | null = revenueTarget > 0 ? toFixedNumber((revenueCollected / revenueTarget) * 100) : 0;

        if (initEntry) {
            occupancyRate = initEntry.occupancyRate;
            if (Math.abs(Number(revenueCollected || 0)) < 0.005 && Math.abs(Number(initEntry.revenueCollected || 0)) > 0.005) {
                revenueCollected = initEntry.revenueCollected;
            }
            const initRt = Number(initEntry.revenueTarget);
            if (Number.isFinite(initRt) && initRt > 0.005) {
                revenueTarget = Math.round(initRt);
            }
            collectionRate = revenueTarget > 0 ? toFixedNumber((revenueCollected / revenueTarget) * 100) : 0;
        }

        if (isFutureMonth) {
            revenueCollected = null;
            collectionRate = null;
        }

        trends.push({ month: monthLabel, occupancyRate, revenueTarget, revenueCollected, avgUnitPrice, collectionRate, contractReceivable });
    }

    return trends;
};

export const calculateDashboardMetrics = (
    currentData: DashboardData,
    options: DashboardMetricOptions
): DashboardMetricResult => {
    const { year, quarter, billingSelectedMonth, quickMode = false } = options;
    const tenants = currentData.tenants || [];
    const buildings = currentData.buildings || [];
    const payments = currentData.payments || [];
    const assumptions = currentData.budgetAssumptions || [];
    const adjustments = currentData.budgetAdjustments || [];
    const initData = currentData.initializationData || [];
    const invoices = currentData.invoices || [];
    const cache = createBillingCache(buildings, payments, initData);
    const yearlyTargetsMap = currentData.yearlyTargets || {};
    const yearTargets = yearlyTargetsMap[year] || { revenue: 0, occupancy: 0 };

    let periodStart = new Date(year, 0, 1);
    let periodEnd = new Date(year, 11, 31);
    if (quarter === 'Q1') periodEnd = new Date(year, 2, 31);
    else if (quarter === 'Q2') {
        periodStart = new Date(year, 3, 1);
        periodEnd = new Date(year, 5, 30);
    } else if (quarter === 'Q3') {
        periodStart = new Date(year, 6, 1);
        periodEnd = new Date(year, 8, 30);
    } else if (quarter === 'Q4') {
        periodStart = new Date(year, 9, 1);
        periodEnd = new Date(year, 11, 31);
    }

    const activeTenantByUnitId = new Map<string, Tenant>();
    for (const tenant of tenants) {
        if (!(tenant.status === 'Active' || tenant.status === 'Expiring' || tenant.status === 'Pending')) continue;
        for (const unitId of tenant.unitIds) activeTenantByUnitId.set(unitId, tenant);
    }

    const selfUseUnitIds = new Set<string>();
    const syncedBuildings = buildings.map((building) => ({
        ...building,
        units: building.units.map((unit) => {
            if (unit.isSelfUse) selfUseUnitIds.add(unit.id);
            const activeTenant = activeTenantByUnitId.get(unit.id);
            let newStatus = unit.status;
            if (activeTenant) newStatus = UnitStatus.Occupied;
            else if (unit.status === UnitStatus.Occupied && !unit.isSelfUse) newStatus = UnitStatus.Vacant;
            return { ...unit, status: newStatus };
        }),
    }));

    let totalLeasableArea = 0;
    syncedBuildings.forEach((building) => {
        if (building.type === 'Site') return;
        building.units.forEach((unit) => {
            if (!unit.isSelfUse) totalLeasableArea += unit.area;
        });
    });

    /** 先规范化应收专用方案，再取当年「生效」方案上的假设/调整，与预算管理预算表（非空置行）同源 */
    const normalizedScenarios = normalizeScenarioForReceivable(currentData.budgetScenarios, tenants, syncedBuildings);
    const activeScenarioForYear = getActiveScenarioForBudgetYear(normalizedScenarios, year);
    const activeScenarioForPrevYear = getActiveScenarioForBudgetYear(normalizedScenarios, year - 1);
    const workingAssumptions =
        activeScenarioForYear != null && activeScenarioForYear.assumptions != null
            ? [...activeScenarioForYear.assumptions]
            : assumptions;
    const workingAdjustments =
        activeScenarioForYear != null && activeScenarioForYear.adjustments != null
            ? [...activeScenarioForYear.adjustments]
            : adjustments;

    const virtualTenants = getVirtualTenants(tenants, syncedBuildings, workingAssumptions);
    const budgetContextForYear = activeScenarioForYear
        ? {
              tenants: activeScenarioForYear.baseDataSnapshot?.tenants || tenants,
              buildings: activeScenarioForYear.baseDataSnapshot?.buildings || syncedBuildings,
              assumptions: workingAssumptions,
              adjustments: workingAdjustments,
          }
        : undefined;
    const budgetContextForPrevYear = activeScenarioForPrevYear
        ? {
              tenants: activeScenarioForPrevYear.baseDataSnapshot?.tenants || tenants,
              buildings: activeScenarioForPrevYear.baseDataSnapshot?.buildings || syncedBuildings,
              assumptions:
                  activeScenarioForPrevYear.assumptions != null
                      ? [...activeScenarioForPrevYear.assumptions]
                      : assumptions,
              adjustments:
                  activeScenarioForPrevYear.adjustments != null
                      ? [...activeScenarioForPrevYear.adjustments]
                      : adjustments,
          }
        : undefined;

    const fullYearMonthlyTrends = quickMode ? [] : calculateTrends(
        tenants,
        virtualTenants,
        payments,
        totalLeasableArea,
        selfUseUnitIds,
        year,
        'All',
        workingAssumptions,
        workingAdjustments,
        initData,
        buildings,
        budgetContextForYear,
        cache,
        currentData.billingPeriodNotes,
    );
    const monthlyTrends = quickMode ? [] : calculateTrends(
        tenants,
        virtualTenants,
        payments,
        totalLeasableArea,
        selfUseUnitIds,
        year,
        quarter,
        workingAssumptions,
        workingAdjustments,
        initData,
        buildings,
        budgetContextForYear,
        cache,
        currentData.billingPeriodNotes,
    );
    const prevYearMonthlyTrends = quickMode ? [] : calculateTrends(
        tenants,
        virtualTenants,
        payments,
        totalLeasableArea,
        selfUseUnitIds,
        year - 1,
        'All',
        workingAssumptions,
        workingAdjustments,
        initData,
        buildings,
        budgetContextForPrevYear,
        cache,
        currentData.billingPeriodNotes,
    );

    const annualRevenueCollected = monthlyTrends.reduce((sum, t) => sum + (t.revenueCollected || 0), 0);
    const annualRevenueTarget = monthlyTrends.reduce((sum, t) => sum + t.revenueTarget, 0);
    const monthlyRevenueTarget = annualRevenueTarget;
    const monthlyRevenueCollected = annualRevenueCollected;

    const now = new Date();
    let snapshotTotalLeasable = 0;
    let snapshotLeased = 0;
    syncedBuildings.forEach((building) => {
        if (building.type === 'Site') return;
        building.units.forEach((unit) => {
            if (!unit.isSelfUse) snapshotTotalLeasable += unit.area;
        });
    });
    tenants.forEach((tenant) => {
        if (tenant.status === 'Expired') return;
        const building = cache.buildingById.get(tenant.buildingId);
        if (building && building.type === 'Site') return;
        const achievedDate = tenant.signingDate ? new Date(tenant.signingDate) : new Date(tenant.leaseStart);
        const terminated = tenant.terminationDate ? new Date(tenant.terminationDate) : null;
        if (achievedDate <= now && (!terminated || terminated > now)) snapshotLeased += tenant.totalArea;
    });
    const realTimeOccupancyRate = snapshotTotalLeasable > 0 ? toFixedNumber((snapshotLeased / snapshotTotalLeasable) * 100) : 0;
    const collectionRate = annualRevenueTarget > 0 ? Math.min(100, toFixedNumber((annualRevenueCollected / annualRevenueTarget) * 100)) : 0;

    const initDecEntries = initData
        .filter((d) => d.month === 12 && Number.isFinite(d.year))
        .sort((a, b) => a.year - b.year);
    const earliestInitDec = initDecEntries[0];
    // 欠款从最早有初始化数据的年份起算（默认不早于 2026）
    // 优化：复用同一 data 上下文避免重复构建 data 对象，让 BillingCache 生效
    // 轻量模式跳过欠款循环（最重的计算）
    let accumulatedArrears = 0;
    if (!quickMode) {
    // 欠款从 2026年1月起算（应用启用日期）
    const arrearsStartYear = 2026;
    const nowYear = now.getFullYear();
    const nowMonth = now.getMonth();
    const arrearsDataContext: DashboardData = {
        ...currentData,
        buildings: syncedBuildings,
        tenants,
        payments,
        budgetAssumptions: workingAssumptions,
        budgetAdjustments: workingAdjustments,
        budgetScenarios: normalizedScenarios,
    };
    for (let arrearsYear = arrearsStartYear; arrearsYear <= nowYear; arrearsYear++) {
        const endMonth = arrearsYear === nowYear ? nowMonth : 11;
        for (let month = 0; month <= endMonth; month++) {
            const billingDetails = buildBillingDetailsForPeriod(arrearsYear, month, arrearsDataContext, cache);
            billingDetails.forEach((detail) => {
                if (detail.status === 'Unpaid') accumulatedArrears += detail.amountDue;
                else if (detail.status === 'Partial') accumulatedArrears += detail.amountDue - detail.amountPaid;
            });
        }
    }
    } // end if (!quickMode)

    let leasedArea = 0;
    tenants.forEach((tenant) => {
        const building = cache.buildingById.get(tenant.buildingId);
        if (building && building.type === 'Site') return;
        const isSelfUse = tenant.unitIds.some((uid) => selfUseUnitIds.has(uid));
        if (isSelfUse) return;
        const achievedDate = tenant.signingDate ? new Date(tenant.signingDate) : new Date(tenant.leaseStart);
        const terminated = tenant.terminationDate ? new Date(tenant.terminationDate) : null;
        if (achievedDate <= periodEnd && (!terminated || terminated > periodEnd)) leasedArea += tenant.totalArea;
    });

    const recentSigningsWindowEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    const recentSigningsWindowStart = new Date(now);
    recentSigningsWindowStart.setMonth(recentSigningsWindowStart.getMonth() - 1);
    recentSigningsWindowStart.setHours(0, 0, 0, 0);
    const recentSignings = tenants
        .filter((tenant) => {
            if (tenant.status === 'Expired') return false;
            const signStr = tenant.signingDate || tenant.leaseStart;
            if (!signStr) return false;
            const signDate = new Date(signStr);
            return !Number.isNaN(signDate.getTime()) && signDate >= recentSigningsWindowStart && signDate <= recentSigningsWindowEnd;
        })
        .sort((a, b) => new Date(b.signingDate || b.leaseStart).getTime() - new Date(a.signingDate || a.leaseStart).getTime())
        .slice(0, 15);

    const expiringSoon = tenants.filter((tenant) => {
        if (tenant.status === 'Expired' || tenant.status === 'Terminated') return false;
        const end = new Date(tenant.leaseEnd);
        return end >= periodStart && end <= periodEnd;
    });

    const newSigningsInMonth = tenants.filter(
        (tenant) => tenant.status !== 'Expired' && tenant.status !== 'Terminated' && tenant.signingDate && tenant.signingDate.startsWith(billingSelectedMonth)
    );
    const newContractsCount = newSigningsInMonth.length;
    const newContractsAreaMonth = newSigningsInMonth.reduce((sum, tenant) => sum + (tenant.totalArea || 0), 0);
    const newSigningsInYear = tenants.filter((tenant) => tenant.signingDate && tenant.signingDate.startsWith(String(year)));
    const newContractsArea = newSigningsInYear.reduce((sum, tenant) => sum + (tenant.totalArea || 0), 0);
    const terminatedInMonth = tenants.filter(
        (tenant) => tenant.status === ContractStatus.Terminated && tenant.terminationDate && tenant.terminationDate.startsWith(billingSelectedMonth)
    );
    const terminatedContractsCount = terminatedInMonth.length;
    const terminatedContractsArea = terminatedInMonth.reduce((sum, tenant) => sum + (tenant.totalArea || 0), 0);
    const netIncreaseArea = newContractsAreaMonth - terminatedContractsArea;

    let billingYear = new Date().getFullYear();
    let billingMonth = new Date().getMonth();
    if (billingSelectedMonth) {
        const parts = billingSelectedMonth.split('-');
        if (parts.length === 2) {
            billingYear = parseInt(parts[0], 10);
            billingMonth = parseInt(parts[1], 10) - 1;
        }
    }

    const currentMonthBilling = quickMode ? [] : buildBillingDetailsForPeriod(billingYear, billingMonth, {
        ...currentData,
        buildings: syncedBuildings,
        tenants,
        payments,
        budgetAssumptions: workingAssumptions,
        budgetAdjustments: workingAdjustments,
        budgetScenarios: normalizedScenarios,
    }, cache);

    const parkingRevenueInPeriod = payments
        .filter((p) => {
            const pDate = new Date(p.date);
            return pDate >= periodStart && pDate <= periodEnd && p.type === 'ParkingFee';
        })
        .reduce((sum, p) => sum + p.amount, 0);
    const parkingDetails: ParkingStatDetail[] = [];
    let totalContractSpaces = 0;
    let totalActualSpaces = 0;
    tenants.forEach((tenant) => {
        if (tenant.status === 'Expired' || tenant.status === 'Terminated') return;
        const contractCount = tenant.contractParkingSpaces !== undefined ? tenant.contractParkingSpaces : tenant.parkingSpaces || 0;
        const actualCount = tenant.actualParkingSpaces !== undefined ? tenant.actualParkingSpaces : tenant.parkingSpaces || 0;
        if (contractCount > 0 || actualCount > 0) {
            totalContractSpaces += contractCount;
            totalActualSpaces += actualCount;
            parkingDetails.push({ tenantId: tenant.id, tenantName: tenant.name, contractCount, actualCount });
        }
    });

    const processedData: DashboardData = {
        ...currentData,
        buildings: syncedBuildings,
        tenants,
        payments,
        totalArea: totalLeasableArea,
        leasedArea,
        occupancyRate: realTimeOccupancyRate,
        annualRevenueTarget: yearTargets.revenue,
        annualOccupancyTarget: yearTargets.occupancy,
        annualRevenueCollected,
        monthlyRevenueTarget,
        monthlyRevenueCollected,
        collectionRate,
        accumulatedArrears,
        newContractsCount,
        newContractsArea,
        terminatedContractsCount,
        terminatedContractsArea,
        netIncreaseArea,
        recentSignings,
        expiringSoon,
        monthlyTrends,
        prevYearMonthlyTrends,
        currentMonthBilling,
        parkingStats: {
            totalContractSpaces,
            totalActualSpaces,
            totalMonthlyRevenue: parkingRevenueInPeriod,
            details: parkingDetails,
        },
        budgetAssumptions: workingAssumptions,
        budgetAdjustments: workingAdjustments,
        budgetAnalysis: currentData.budgetAnalysis || { occupancy: '', revenue: '' },
        budgetScenarios: normalizedScenarios,
        initializationData: initData,
        invoices,
        billingPeriodNotes: currentData.billingPeriodNotes || {},
    };

    return { processedData, fullYearMonthlyTrends };
};

/**
 * KPI 汇总：`annualRevenueTarget` 在仪表盘主流程里来自 yearlyTargets（手工年度指标），
 * `monthlyTrends` 汇总则是预算引擎滚动的应收目标。若未维护年度指标但月度预算存在，
 * 管理员「所有园区经营汇总」会出现财务列为 0、预算分母却含该园区的不一致。
 * 口径：年度指标优先；未填时回退为月度汇总（与 annualBudgetTarget 一致）。
 */
export const buildKpiSummaryFromProcessedData = (processedData: DashboardData, statsYear?: number): KpiSnapshotSummary => {
    const trends = processedData.monthlyTrends || [];
    // 实际合同应收 = 预算引擎滚动汇总（与预算收款同一口径）
    const annualBudgetTarget = trends.reduce((sum, trend) => sum + (trend.revenueTarget || 0), 0);
    // 实际合同应收 = 预算引擎滚动汇总（口径对齐预算收款）；无预算数据时回落手动年度目标
    const annualRevenueTarget = annualBudgetTarget > 0
        ? annualBudgetTarget
        : (processedData.annualRevenueTarget || processedData.monthlyRevenueTarget || 0);
    const annualRevenueCollected = processedData.annualRevenueCollected || 0;
    // 年初预算：从 yearlyTargets[year].initialBudget 读取
    const year = statsYear || new Date().getFullYear();
    const yearlyTargets = processedData.yearlyTargets || {};
    const yearTarget = yearlyTargets[year] || {};
    const annualInitialBudget = yearTarget.initialBudget || 0;

    return {
        annualRevenueTarget,
        annualRevenueCollected,
        annualInitialBudget,
        annualBudgetTarget,
        annualGoalCompletion:
            annualRevenueTarget > 0
                ? Math.min(100, (annualRevenueCollected / annualRevenueTarget) * 100)
                : 0,
        annualBudgetCompletion:
            annualBudgetTarget > 0
                ? Math.min(100, (annualRevenueCollected / annualBudgetTarget) * 100)
                : 0,
        occupancyRate: processedData.occupancyRate || 0,
        annualOccupancyTarget: processedData.annualOccupancyTarget || 0,
        tenantCount: processedData.tenants?.length || 0,
        totalArea: processedData.totalArea || 0,
    };
};

/** 从 PocketBase 读取的 KPI 快照：用 monthly_trends 重算预算分母，并对齐年度目标回退逻辑（兼容旧快照）。 */
export const normalizeKpiSummaryWithMonthlyTrends = (
    summary: KpiSnapshotSummary,
    monthlyTrends: MonthlyTrend[]
): KpiSnapshotSummary => {
    const sumFromTrends = (monthlyTrends || []).reduce((sum, t) => sum + (t.revenueTarget || 0), 0);
    const annualBudgetTarget = sumFromTrends > 0 ? sumFromTrends : summary.annualBudgetTarget || 0;
    // 年度应收目标：保留快照中原有的值（可能是人工设定的 yearlyTargets），
    // 仅在原有值为 0/空时回退到预算滚动的月度汇总。
    const existingTarget = summary.annualRevenueTarget;
    const annualRevenueTarget = (existingTarget != null && existingTarget > 0)
        ? existingTarget
        : annualBudgetTarget;
    const collected = summary.annualRevenueCollected || 0;

    return {
        ...summary,
        annualBudgetTarget,
        annualRevenueTarget,
        annualGoalCompletion:
            annualRevenueTarget > 0 ? Math.min(100, (collected / annualRevenueTarget) * 100) : 0,
        annualBudgetCompletion:
            annualBudgetTarget > 0 ? Math.min(100, (collected / annualBudgetTarget) * 100) : 0,
    };
};
