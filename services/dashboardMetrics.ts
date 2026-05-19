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
import { BudgetedBill, buildVacancyBudgetAlignmentNote, FAR_FUTURE_DATE, generateBudgetedBills, getVirtualTenants, parseDateLocal } from './billingService';
import {
    importedBudgetRowKey,
    readBudgetCustomerNameLinks,
    readImportedBudgetTable,
    tenantImportedBudgetRowKey,
} from './budgetTableImport';
import { resolveInitMonthInitialBudget, resolveInitMonthRevenueTarget } from './initDataBudget';
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
    // fallbackYear 必须等于查询年份。早先用 new Date().getFullYear() 会让「未设
    // budgetYear 的方案」永远只匹配当年——查看 2025 数据时永远命中不到这些方案。
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
    // 同上：fallbackYear 用查询年，避免历史方案在查看历年数据时永远匹配不到。
    const fallbackYear = year;
    const list = scenarios || [];
    const byYear = (s: BudgetScenario) => (s.budgetYear || fallbackYear) === year;
    return list.find((s) => byYear(s) && isReceivableDedicatedScenario(s)) || list.find((s) => byYear(s) && s.isActive);
};

/**
 * 应收专用方案内的 assumptions 为创建/同步时的拷贝；用户在「预算管理」里改的账期偏移、单价假设等
 * 只更新根级 `budgetAssumptions`。合并时同 target 以根级为准，避免核销月与合同概要/预算表不一致。
 *
 * 导出供「预算管理 → 预算表」在浏览非 Live 方案时复用，确保
 * 工作台/财务报表/预算表三处展示同一口径的「实际合同应收」。
 */
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

/** 同上：预算调整以根级 `budgetAdjustments` 覆盖同 id，避免专用方案内旧数组挡住新调账。 */
export const mergeAdjustmentsForReceivable = (
    scenarioAdjustments: BudgetAdjustment[] | undefined,
    liveAdjustments: BudgetAdjustment[] | undefined
): BudgetAdjustment[] => {
    const map = new Map<string, BudgetAdjustment>();
    for (const a of scenarioAdjustments || []) map.set(a.id, a);
    for (const a of liveAdjustments || []) map.set(a.id, a);
    return [...map.values()];
};

/**
 * 数据迁移后，旧 snapshot 内的合同 ID（如 `t1764124057542`）与当前 PocketBase
 * 原生 ID（如 `77yn75aw4qucg6h`）对不上，导致预算计算/调整按 ID 匹配 0 命中。
 * 此函数尝试把 snapshot 合同的 id 重映射到 live 合同的 id：先按 id 找；找不到
 * 再按 name + leaseStart 找；都没命中则保留原 snapshot（视为已删除的历史合同）。
 *
 * **不会**修改 snapshot 内合同的金额/起租等业务字段，只重写 id。
 */
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

/**
 * 给定应收专用方案 + **持久化根级** `budgetAssumptions` / `budgetAdjustments`，返回「实际合同口径」上下文。
 *
 * 合并规则（与 `mergeAssumptionsForReceivable` 一致）：以方案内 Existing/Vacancy 为底，
 * 同 target / 同 id 以根级为准——用户在预算页改的账期偏移等应体现在核销/应收明细。
 *
 * ⚠️ 调用方必须传入 **DashboardData 根级** 假设与调整，勿传入当年「生效方案」的
 * `workingAssumptions`，否则会把年初预算方案等的付款转移叠进应收上下文（历史上曾造成
 * 工作台/财务与「实际合同口径」预算表约 88 万级偏差）。
 */
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

        // 用户手动指定了某个方案为「应收专用」时，**优先尊重用户选择**：不再自动创建合成
        // 「invoice_dedicated_*」方案、也不再把用户的方案 isReceivableActive 强制设为 false。
        // 这是用户截图反映「实际合同口径」与工作台不一致的根因之一：合成方案会复制 active 的
        // 数据并劫持「应收口径」，让用户精心维护的「发票/实收专用方案」失去权威。
        const userPickedReceivable = list.find(
            (s) =>
                (s.budgetYear || fallbackYear) === year &&
                s.isReceivableActive &&
                !isReceivableDedicatedScenarioId(s.id),
        );
        if (userPickedReceivable) {
            // 清理可能残留的同年合成方案（避免双重 isReceivableActive 导致 getReceivableScenarioForYear 选错）
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

/**
 * 将系统合成的 `invoice_dedicated_<year>` 应收专用方案快照与当前实时合同/楼宇对齐。
 * 合同中心保存后会触发 `recalculateMetrics` → `normalizeScenarioForReceivable`，从而避免
 * 核销仍按旧免租/账期快照计费（如顺江：快照 3 月免租、档案已 6–7 月）。
 * 不改动用户手动指定的非合成应收专用方案，也不动 assumptions / adjustments。
 */
export const syncInvoiceDedicatedSnapshotsFromLive = (
    scenarios: BudgetScenario[] | undefined,
    liveTenants: Tenant[],
    liveBuildings: Building[],
): BudgetScenario[] => {
    if (!scenarios?.length || !liveTenants.length) return scenarios || [];
    return scenarios.map((s) => {
        if (!isReceivableDedicatedScenarioId(s.id)) return s;
        return {
            ...s,
            baseDataSnapshot: {
                tenants: structuredClone(liveTenants),
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
    return roundMoney2(total);
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

/**
 * 应收滚动 / 核销明细 / 合同应收汇总共用的租户名单：以方案快照为底按「变更月」叠实时根级合同，
 * 并补上当年签约但尚未进入方案快照的客户（与 `buildBillingDetailsForPeriod` 完全一致）。
 */
export const mergeTenantsForReceivablePeriod = (
    year: number,
    month: number,
    liveTenants: Tenant[] | undefined,
    scenarioTenants: Tenant[],
): Tenant[] => {
    const liveTenantMap = new Map((liveTenants || []).map((t) => [t.id, t]));
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
            const d = parseDateLocal(c);
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
    const actualSignedThisYear = (liveTenants || []).filter((t) => {
        const signStr = t.signingDate || t.leaseStart;
        if (!signStr) return false;
        const d = parseDateLocal(signStr);
        return !Number.isNaN(d.getTime()) && d.getFullYear() === year;
    });
    const mergedWithSignedTenants = [...mergedTenants];
    actualSignedThisYear.forEach((t) => {
        if (!scenarioTenantIds.has(t.id)) mergedWithSignedTenants.push(t);
    });
    return mergedWithSignedTenants;
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
    // 应收专用方案为底，同 target 的 Existing/Vacancy 以 ctx 根级 budgetAssumptions 覆盖；
    // calculateDashboardMetrics 侧须传入根级而非当年生效方案假设，避免年初预算方案叠入应收上下文。
    const receivableCtx = buildReceivableContextForScenario(
        receivableScenario,
        ctx.tenants || [],
        ctx.buildings || [],
        ctx.budgetAssumptions,
        ctx.budgetAdjustments,
    );
    const scenarioTenants = receivableCtx.tenants;
    const scenarioBuildings = receivableCtx.buildings;
    const receivableAdjustments = receivableCtx.adjustments;
    const receivableAssumptions = receivableCtx.assumptions;

    const mergedWithSignedTenants = mergeTenantsForReceivablePeriod(year, month, ctx.tenants, scenarioTenants);

    const selfUseUnitIds = new Set<string>();
    (scenarioBuildings || []).forEach((b) => b.units.forEach((u) => u.isSelfUse && selfUseUnitIds.add(u.id)));
    const contextKey = `receivable|${getContextId(localCache, receivableAssumptions)}|${getContextId(localCache, receivableAdjustments)}`;

    // 与下方核销管线第一步完全一致：同一租户合并名单 + 同一套假设/调整，生成「导入/缓缴/特殊业态前」的纯合同滚动月应收；
    // `contractAmountDue` 由本步 `internal` 按 tenantId 贴回，与「应收核销」列同源，无缓缴/导入时两列应一致。
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
    const contractRollByTenantId = new Map<string, number>();
    for (const d of internal) {
        contractRollByTenantId.set(d.tenantId, roundMoney2(d.amountDue));
    }

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
    const assumptionsForVacancyNotes = receivableAssumptions;
    const withVacancyNotes = attachVacancyBudgetAlignmentNotes(result, ctx.tenants || [], assumptionsForVacancyNotes);
    // 合同应收 = 与核销表同一套「纯滚动」第一步金额；合成行 tenantId 不在 internal 中则回落 0。
    const withContractOnly = withVacancyNotes.map((detail) => ({
        ...detail,
        contractAmountDue: contractRollByTenantId.get(detail.tenantId) ?? 0,
    }));
    localCache.detailsByKey.set(cacheKey, withContractOnly);
    return withContractOnly;
};

/**
 * 「合同应收」纯口径单月汇总 — **工作台 / 财务报表 / 预算管理 三处共用的唯一入口**。
 *
 * 调用链：
 *   getReceivableScenarioForYear → buildReceivableContextForScenario
 *     → mergeTenantsForReceivablePeriod（与财务报表核销管线同一套名单）
 *     → getBillingDetailsForPeriodInternal → calculateBudgetedReceivableForTenant → …
 *
 * 不做任何后处理（缓缴 / 导入预算覆盖 / 特殊业态手工录入 / 手工应收行），后处理仅在
 * `buildBillingDetailsForPeriod.amountDue` 中呈现。
 *
 * 入参放宽为最小字段子集（不要求传完整 DashboardData），便于 BudgetManager 用
 * effectiveData 直接构造一个临时 ctx 调用 — 这样：
 *   · BudgetManager 「当前合同履约 (Live)」 effectiveData = 实时根级数据  → 与 Dashboard / Finance 完全一致
 *   · BudgetManager 切到具体方案时 effectiveData = 方案快照合并后的数据 → 自然得到方案视角的快照应收
 */
type ContractOnlyReceivableCtx = {
    tenants: Tenant[];
    buildings: Building[];
    payments?: PaymentRecord[];
    initializationData?: MonthlyInitData[];
    budgetAssumptions?: BudgetAssumption[];
    budgetAdjustments?: BudgetAdjustment[];
    budgetScenarios?: BudgetScenario[];
};

export const buildContractOnlyReceivableForPeriod = (
    year: number,
    month: number,
    ctx: ContractOnlyReceivableCtx,
    cache?: BillingCache
): { totalAmountDue: number; byTenantId: Map<string, number> } => {
    const localCache = cache || createBillingCache(ctx.buildings || [], ctx.payments || [], ctx.initializationData || []);
    const receivableScenario = getReceivableScenarioForYear(ctx.budgetScenarios, year);
    const receivableCtx = buildReceivableContextForScenario(
        receivableScenario,
        ctx.tenants || [],
        ctx.buildings || [],
        ctx.budgetAssumptions,
        ctx.budgetAdjustments,
    );
    const selfUseUnitIds = new Set<string>();
    (receivableCtx.buildings || []).forEach((b) => b.units.forEach((u) => u.isSelfUse && selfUseUnitIds.add(u.id)));
    const mergedForContractOnly = mergeTenantsForReceivablePeriod(year, month, ctx.tenants, receivableCtx.tenants || []);
    // 与 buildBillingDetailsForPeriod 第一步共用 contextKey，便于命中同一套 getBillingDetailsForPeriodInternal 缓存。
    const contextKey = `receivable|${getContextId(localCache, receivableCtx.assumptions)}|${getContextId(localCache, receivableCtx.adjustments)}`;
    const details = getBillingDetailsForPeriodInternal(
        year,
        month,
        mergedForContractOnly,
        [],
        selfUseUnitIds,
        receivableCtx.assumptions,
        receivableCtx.adjustments,
        localCache,
        contextKey,
        ctx.tenants || []
    );
    const byTenantId = new Map<string, number>();
    for (const d of details) {
        byTenantId.set(d.tenantId, roundMoney2(d.amountDue));
    }
    const totalAmountDue = roundMoney2(details.reduce((sum, d) => sum + d.amountDue, 0));
    return { totalAmountDue, byTenantId };
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
    billingPeriodNotes?: Record<string, string>,
    /** 合同应收单源入口的入参（与财务报表 contractAmountDue / 预算管理「实际合同口径」完全同源） */
    contractReceivableCtx?: ContractOnlyReceivableCtx,
    projectId?: string
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

            const achievedDate = tenant.signingDate ? parseDateLocal(tenant.signingDate) : parseDateLocal(tenant.leaseStart);
            const leaseEnd = tenant.leaseEnd ? parseDateLocal(tenant.leaseEnd) : parseDateLocal(FAR_FUTURE_DATE);
            const terminationDate = tenant.terminationDate ? parseDateLocal(tenant.terminationDate) : null;
            const effectiveEnd = terminationDate && terminationDate < leaseEnd ? terminationDate : leaseEnd;
            if (achievedDate <= endDate && effectiveEnd > endDate) leasedAreaInMonth += tenant.totalArea;

            const physicalLeaseStart = parseDateLocal(tenant.leaseStart);
            if (physicalLeaseStart <= endDate && effectiveEnd >= startDate) {
                // 统一转为天单价用于均价展示
                let price = tenant.unitPrice;
                if (price && tenant.unitPriceMode === 'monthly') {
                    price = (price * 12) / 365;
                } else if (!price && tenant.totalArea > 0) {
                    price = (tenant.monthlyRent / tenant.totalArea) * 12 / 365;
                }
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
        // 合同应收：调用「单源入口」buildContractOnlyReceivableForPeriod
        // —— 与财务报表 contractAmountDue / 预算管理「每月合同应收」三处共用同一计算路径，
        //    任何后处理（缓缴 / 导入预算 / 特殊业态 / 手工应收行）均不在此累加。
        const contractReceivableCtxResolved: ContractOnlyReceivableCtx = contractReceivableCtx || {
            tenants,
            buildings,
            payments,
            initializationData,
            budgetAssumptions: assumptions,
            budgetAdjustments: adjustments,
            budgetScenarios: [],
        };
        const { totalAmountDue: contractReceivable } = buildContractOnlyReceivableForPeriod(
            year,
            month,
            contractReceivableCtxResolved,
            cache,
        );
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
            const initRt = resolveInitMonthRevenueTarget(initEntry, projectId);
            if (initRt > 0.005) {
                revenueTarget = initRt;
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
    const projectId = tenants[0]?.projectId || '';
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

    /**
     * 合同应收（contractReceivable）单源入口的输入 ctx：直接复用根级 currentData 的字段，
     * 让工作台 calculateTrends → buildContractOnlyReceivableForPeriod 与
     * 财务报表 buildBillingDetailsForPeriod.contractAmountDue 共用同一组数据/同一份方案/同一缓存。
     */
    const contractReceivableCtxForYear: ContractOnlyReceivableCtx = {
        tenants,
        buildings: syncedBuildings,
        payments,
        initializationData: initData,
        budgetAssumptions: assumptions,
        budgetAdjustments: adjustments,
        budgetScenarios: normalizedScenarios,
    };
    const contractReceivableCtxForPrevYear: ContractOnlyReceivableCtx = contractReceivableCtxForYear;

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
        contractReceivableCtxForYear,
        projectId,
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
        contractReceivableCtxForYear,
        projectId,
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
        contractReceivableCtxForPrevYear,
        projectId,
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
        const achievedDate = tenant.signingDate ? parseDateLocal(tenant.signingDate) : parseDateLocal(tenant.leaseStart);
        const terminated = tenant.terminationDate ? parseDateLocal(tenant.terminationDate) : null;
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
        // 欠款仅算到上月为止，不算当月（当月还没过完，应收尚未确定）
        const endMonth = arrearsYear === nowYear ? nowMonth - 1 : 11;
        if (endMonth < 0) continue;
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
        const achievedDate = tenant.signingDate ? parseDateLocal(tenant.signingDate) : parseDateLocal(tenant.leaseStart);
        const terminated = tenant.terminationDate ? parseDateLocal(tenant.terminationDate) : null;
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
            const signDate = parseDateLocal(signStr);
            return !Number.isNaN(signDate.getTime()) && signDate >= recentSigningsWindowStart && signDate <= recentSigningsWindowEnd;
        })
        .sort((a, b) => parseDateLocal(b.signingDate || b.leaseStart).getTime() - parseDateLocal(a.signingDate || a.leaseStart).getTime())
        .slice(0, 15);

    const expiringSoon = tenants.filter((tenant) => {
        if (tenant.status === 'Expired' || tenant.status === 'Terminated') return false;
        const end = parseDateLocal(tenant.leaseEnd);
        return end >= periodStart && end <= periodEnd;
    });

    const newSigningsInMonth = tenants.filter(
        (tenant) => tenant.status !== 'Expired' && tenant.status !== 'Terminated' && tenant.signingDate && tenant.signingDate.startsWith(billingSelectedMonth)
    );
    const newContractsCount = newSigningsInMonth.length;
    const newSigningsInYear = tenants.filter((tenant) => {
        const signStr = tenant.signingDate || tenant.leaseStart;
        if (!signStr) return false;
        const signDate = parseDateLocal(signStr);
        return !Number.isNaN(signDate.getTime()) && signDate.getFullYear() === year;
    });
    const newContractsArea = newSigningsInYear.reduce((sum, tenant) => sum + (tenant.totalArea || 0), 0);
    const terminatedInMonth = tenants.filter(
        (tenant) => tenant.status === ContractStatus.Terminated && tenant.terminationDate && tenant.terminationDate.startsWith(billingSelectedMonth)
    );
    const terminatedContractsCount = terminatedInMonth.length;
    const terminatedInYear = tenants.filter((tenant) => {
        if (tenant.status !== ContractStatus.Terminated) return false;
        const endStr = tenant.terminationDate || tenant.leaseEnd;
        if (!endStr) return false;
        const endDate = parseDateLocal(endStr);
        return !Number.isNaN(endDate.getTime()) && endDate.getFullYear() === year;
    });
    const terminatedContractsArea = terminatedInYear.reduce((sum, tenant) => sum + (tenant.totalArea || 0), 0);
    const netIncreaseArea = newContractsArea - terminatedContractsArea;

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
            const pDate = parseDateLocal(p.date);
            return pDate >= periodStart && pDate <= periodEnd && p.type === 'ParkingFee';
        })
        .reduce((sum, p) => sum + p.amount, 0);
    const parkingDetails: ParkingStatDetail[] = [];
    let totalContractSpaces = 0;
    let totalActualSpaces = 0;
    tenants.forEach((tenant) => {
        if (tenant.status === 'Expired' || tenant.status === 'Terminated') return;
        // 旧逻辑：合约/实际车位均未独立设置时，两者都 fallback 到 `parkingSpaces`，
        // 合计时同一批车位被算了两遍。此处显式区分：只要任何一边设置了独立值就用独立值，
        // 否则把 `parkingSpaces` 同时作为合约与实际值，仅记一次（不再翻倍）。
        const hasContract = tenant.contractParkingSpaces !== undefined;
        const hasActual = tenant.actualParkingSpaces !== undefined;
        const legacy = tenant.parkingSpaces || 0;
        const contractCount = hasContract ? (tenant.contractParkingSpaces || 0) : legacy;
        const actualCount = hasActual ? (tenant.actualParkingSpaces || 0) : legacy;
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
 * 年初预算年度值（元）：与首页「预算执行」表底部「年初预算」合计、`StatsCards` 同源。
 * 当年初始化数据中任一月份存在 `initialBudget` 时，年度值 = 1–12 月之和（未维护月份按 0）；
 * 否则使用 `yearlyTargets[year].initialBudget`。
 */
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

/**
 * KPI 汇总：`annualRevenueTarget` 在仪表盘主流程里来自 yearlyTargets（手工年度指标），
 * `monthlyTrends` 汇总则是预算引擎滚动的应收目标。若未维护年度指标但月度预算存在，
 * 管理员「所有园区经营汇总」会出现财务列为 0、预算分母却含该园区的不一致。
 * 口径：年度指标优先；未填时回退为月度汇总（与 annualBudgetTarget 一致）。
 * `annualGoalCompletion` 与管理员汇总顶栏一致：优先 **实收 / 实际合同应收**；无合同应收分母时回退为 **实收 / 年度应收目标**。
 */
export const buildKpiSummaryFromProcessedData = (processedData: DashboardData, statsYear?: number): KpiSnapshotSummary => {
    const trends = processedData.monthlyTrends || [];
    // 预算目标（来自导入 Excel 或初始化数据，含空置去化预测）
    const annualBudgetTarget = trends.reduce((sum, trend) => sum + (trend.revenueTarget || 0), 0);
    // 实际合同应收 = 仅真实履约合同滚动汇总（与预算表「全年合同应收」、工作台「合同应收」列同口径）
    const annualContractReceivable = trends.reduce((sum, trend) => sum + (trend.contractReceivable || 0), 0);
    const annualRevenueTarget = annualBudgetTarget > 0
        ? annualBudgetTarget
        : (processedData.annualRevenueTarget || processedData.monthlyRevenueTarget || 0);
    const annualRevenueCollected = processedData.annualRevenueCollected || 0;
    const year = statsYear || new Date().getFullYear();
    const annualInitialBudget = resolveAnnualInitialBudget(
        processedData.yearlyTargets,
        processedData.initializationData,
        year,
        processedData.tenants?.[0]?.projectId
    );
    /** 与管理员汇总顶栏「完成率（实收/合同应收）」一致；无合同应收分母时回退为实收/年度应收目标 */
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
    };
};

/** 从 PocketBase 读取的 KPI 快照：用 monthly_trends 重算预算分母，并对齐年度目标回退逻辑（兼容旧快照）。 */
export const normalizeKpiSummaryWithMonthlyTrends = (
    summary: KpiSnapshotSummary,
    monthlyTrends: MonthlyTrend[]
): KpiSnapshotSummary => {
    const sumFromTrends = (monthlyTrends || []).reduce((sum, t) => sum + (t.revenueTarget || 0), 0);
    const annualBudgetTarget = sumFromTrends > 0 ? sumFromTrends : summary.annualBudgetTarget || 0;
    const contractSumFromTrends = (monthlyTrends || []).reduce((sum, t) => sum + (t.contractReceivable || 0), 0);
    const annualContractReceivableResolved =
        contractSumFromTrends > 0 ? contractSumFromTrends : summary.annualContractReceivable || 0;
    // 年度应收目标：保留快照中原有的值（可能是人工设定的 yearlyTargets），
    // 仅在原有值为 0/空时回退到预算滚动的月度汇总。
    const existingTarget = summary.annualRevenueTarget;
    const annualRevenueTarget = (existingTarget != null && existingTarget > 0)
        ? existingTarget
        : annualBudgetTarget;
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
