/**
 * 排查两类应收/合同不一致：
 * A) 应收专用方案 baseDataSnapshot 与实时合同条款不一致（如顺江：快照免租仍 3 月、档案已 6–7 月）
 *    注：保存合同后 normalizeScenarioForReceivable 会自动 sync invoice_dedicated_* 快照；若仍不一致请保存云端。
 * B) 首期覆盖期 + 分房源：重锚后应收是否与覆盖期+免租重算一致（如金马指南针；修复后应 diff=0）
 *
 * 用法: npx tsx scripts/audit-receivable-contract-mismatches.ts
 */
import type { BudgetScenario, DashboardData, Tenant } from '../types';
import { generateBudgetedBills, computeDeductModeAmountForCoverage } from '../services/billingService';
import {
    buildBillingDetailsForPeriod,
    getReceivableScenarioForYear,
    mergeTenantsForReceivablePeriod,
} from '../services/dashboardMetrics';
import { formatYearRentFreeSummary } from '../services/sharedUtils';

const API = 'http://127.0.0.1:18787';
const YEAR = 2026;

const PARKS: { id: string; key: string; token: string }[] = [
    { id: 'beijing_park', key: 'beijing_park_api', token: 'c81d33122bcf375e89038142c55411940837efc0ba52748e' },
    { id: 'shanghai_park', key: 'shanghai_park_api', token: 'a15311990ad2324f3f0a1b591bd39befe021fd1a7ad19c13' },
    { id: 'shenzhen_park', key: 'shenzhen_park_write', token: 'd5b1e66fa813ce5a7b649673592ccaf39120359ab515a134' },
];

const rentFreeKey = (t: Tenant) => JSON.stringify(t.rentFreePeriods || []);

function normalizeTenantFromApi(raw: Record<string, unknown>): Tenant {
    const paymentTerms = (raw.payment_terms || raw.paymentTerms) as Tenant['paymentTerms'];
    const unitTerms = (raw.unit_terms || raw.unitTerms || paymentTerms) as Tenant['unitTerms'];
    return {
        id: String(raw.id || ''),
        name: String(raw.name || ''),
        buildingId: String(raw.building_id || raw.buildingId || ''),
        unitIds: (raw.unit_ids || raw.unitIds || []) as string[],
        totalArea: Number(raw.total_area ?? raw.totalArea ?? 0),
        unitPrice: raw.unit_price != null ? Number(raw.unit_price) : raw.unitPrice,
        unitPriceMode: (raw.unit_price_mode || raw.unitPriceMode) as Tenant['unitPriceMode'],
        monthlyRent: Number(raw.monthly_rent ?? raw.monthlyRent ?? 0),
        leaseStart: String(raw.lease_start || raw.leaseStart || ''),
        leaseEnd: String(raw.lease_end || raw.leaseEnd || ''),
        signingDate: String(raw.signing_date || raw.signingDate || ''),
        status: (raw.status || 'Active') as Tenant['status'],
        depositStatus: (raw.deposit_status || raw.depositStatus || 'Unpaid') as Tenant['depositStatus'],
        paymentCycle: (raw.payment_cycle || raw.paymentCycle) as Tenant['paymentCycle'],
        paymentCycleMonths: raw.payment_cycle_months != null ? Number(raw.payment_cycle_months) : raw.paymentCycleMonths,
        firstPaymentMonths: raw.first_payment_months != null ? Number(raw.first_payment_months) : raw.firstPaymentMonths,
        firstPaymentDate: String(raw.first_payment_date || raw.firstPaymentDate || ''),
        firstReceivableAmount:
            raw.first_receivable_amount != null
                ? Number(raw.first_receivable_amount)
                : raw.firstReceivableAmount,
        firstReceivableStartDate: String(raw.first_receivable_start_date || raw.firstReceivableStartDate || '') || undefined,
        firstReceivableEndDate: String(raw.first_receivable_end_date || raw.firstReceivableEndDate || '') || undefined,
        rentFreeHandling: (raw.free_rent_handling || raw.rentFreeHandling) as Tenant['rentFreeHandling'],
        rentFreePeriods: (raw.rent_free_periods || raw.rentFreePeriods || []) as Tenant['rentFreePeriods'],
        paymentTerms,
        unitTerms,
        projectId: String(raw.project_id || raw.projectId || ''),
        isSpecialBusiness: !!(raw.is_special_business ?? raw.isSpecialBusiness),
        terminationDate: String(raw.termination_date || raw.terminationDate || '') || undefined,
    };
}

function contractFieldsDiffer(live: Tenant, snap: Tenant): string[] {
    const fields: string[] = [];
    if (live.leaseStart !== snap.leaseStart) fields.push('leaseStart');
    if (live.leaseEnd !== snap.leaseEnd) fields.push('leaseEnd');
    if (live.monthlyRent !== snap.monthlyRent) fields.push('monthlyRent');
    if (rentFreeKey(live) !== rentFreeKey(snap)) fields.push('rentFreePeriods');
    if (live.paymentCycle !== snap.paymentCycle) fields.push('paymentCycle');
    if (live.firstPaymentDate !== snap.firstPaymentDate) fields.push('firstPaymentDate');
    if (live.freeRentHandling !== snap.freeRentHandling) fields.push('freeRentHandling');
    if (
        JSON.stringify(live.unitTerms || live.paymentTerms || []) !==
        JSON.stringify(snap.unitTerms || snap.paymentTerms || [])
    ) {
        fields.push('unitTerms');
    }
    return fields;
}

async function fetchDashboard(projectId: string, key: string, token: string) {
    const res = await fetch(`${API}/api/integration/dashboard?project_id=${projectId}`, {
        headers: {
            'X-Integration-Source-Type': 'openclaw_agent',
            'X-Integration-Source-Key': key,
            'X-Integration-Token': token,
        },
    });
    if (!res.ok) throw new Error(`${projectId} dashboard HTTP ${res.status}`);
    const json = (await res.json()) as { ok?: boolean; dashboard?: Record<string, unknown> };
    if (!json.ok) throw new Error(`${projectId} dashboard not ok`);
    return json.dashboard || json;
}

function buildCtx(liveTenants: Tenant[], scenario: BudgetScenario | undefined): DashboardData {
    return {
        tenants: liveTenants,
        buildings: [],
        payments: [],
        budgetScenarios: scenario ? [scenario] : [],
        budgetAssumptions: [],
        budgetAdjustments: [],
        billingPeriodNotes: {},
        monthlyTrends: [],
        yearlyTargets: {},
        initializationData: [],
        annualRevenueTarget: 0,
        annualRevenueCollected: 0,
        annualOccupancyTarget: 0,
        occupancyRate: 0,
        totalArea: 0,
        netIncreaseArea: 0,
    };
}

type SnapshotMismatch = {
    tenantId: string;
    name: string;
    diffFields: string[];
    liveRentFreeSummary: string;
    snapRentFreeSummary: string;
    amountDiffMonths: { month: string; liveDue: number; snapDue: number; delta: number }[];
};

function auditSnapshotVsLive(liveTenants: Tenant[], scenario: BudgetScenario | undefined): SnapshotMismatch[] {
    const snapTenants = scenario?.baseDataSnapshot?.tenants || [];
    const snapById = new Map(snapTenants.map((t) => [t.id, t]));
    const out: SnapshotMismatch[] = [];

    for (const live of liveTenants) {
        if (live.isSpecialBusiness) continue;
        const snap = snapById.get(live.id);
        if (!snap) continue;
        const diffFields = contractFieldsDiffer(live, snap);
        if (diffFields.length === 0) continue;

        const ctxLive = buildCtx(liveTenants, undefined);
        const ctxSnap = buildCtx(
            liveTenants,
            scenario ? { ...scenario, baseDataSnapshot: { tenants: snapTenants, buildings: [] } } : undefined,
        );

        const amountDiffMonths: SnapshotMismatch['amountDiffMonths'] = [];
        for (let m = 0; m < 12; m++) {
            const liveRow = buildBillingDetailsForPeriod(YEAR, m, ctxLive).find((d) => d.tenantId === live.id);
            const snapRow = buildBillingDetailsForPeriod(YEAR, m, ctxSnap).find((d) => d.tenantId === live.id);
            const liveDue = liveRow?.amountDue ?? 0;
            const snapDue = snapRow?.amountDue ?? 0;
            if (Math.abs(liveDue - snapDue) > 0.01) {
                amountDiffMonths.push({
                    month: `${YEAR}-${String(m + 1).padStart(2, '0')}`,
                    liveDue,
                    snapDue,
                    delta: Math.round((snapDue - liveDue) * 100) / 100,
                });
            }
        }

        out.push({
            tenantId: live.id,
            name: live.name,
            diffFields,
            liveRentFreeSummary: formatYearRentFreeSummary(YEAR, live.rentFreePeriods),
            snapRentFreeSummary: formatYearRentFreeSummary(YEAR, snap.rentFreePeriods),
            amountDiffMonths,
        });
    }
    return out;
}

type FirstReceivableIssue = {
    tenantId: string;
    name: string;
    issueRows: { payDate: string; amount: number; expected: number; coverage: string }[];
};

function auditFirstReceivableRecalc(tenants: Tenant[]): FirstReceivableIssue[] {
    const out: FirstReceivableIssue[] = [];
    for (const t of tenants) {
        if (t.isSpecialBusiness) continue;
        if (!t.firstReceivableStartDate || !t.firstReceivableEndDate) continue;
        if (!(t.firstReceivableAmount != null && t.firstReceivableAmount > 0)) continue;
        const unitRows = (t.unitTerms?.length ? t.unitTerms : t.paymentTerms || []).filter(
            (u) => (u.monthlyRent || u.unitPrice) && u.area > 0,
        );
        if (unitRows.length === 0) continue;

        const monthlyRent = t.monthlyRent || 0;
        const bills = generateBudgetedBills(t, [], [], new Date(YEAR - 1, 0, 1), new Date(YEAR, 11, 31));
        const firstEnd = t.firstReceivableEndDate;
        const issueRows: FirstReceivableIssue['issueRows'] = [];

        for (const b of bills) {
            if (!b.coverageStart || !b.coverageEnd) continue;
            const covLabel = `${b.coverageStart.toISOString().slice(0, 10)}~${b.coverageEnd.toISOString().slice(0, 10)}`;
            if (b.coverageEnd <= new Date(firstEnd)) continue;
            const expected = computeDeductModeAmountForCoverage(
                t,
                b.coverageStart,
                b.coverageEnd,
                monthlyRent,
                unitRows,
            );
            if (Math.abs(b.amount - expected) > 0.02) {
                issueRows.push({
                    payDate: b.date.toISOString().slice(0, 10),
                    amount: b.amount,
                    expected,
                    coverage: covLabel,
                });
            }
        }
        if (issueRows.length > 0) {
            out.push({ tenantId: t.id, name: t.name, issueRows });
        }
    }
    return out;
}

async function main() {
    console.log(`=== 应收/合同一致性排查 ${YEAR} ===\n`);

    let totalA = 0;
    let totalAWithAmount = 0;
    let totalB = 0;

    for (const park of PARKS) {
        console.log(`\n## ${park.id}`);
        let dash: Record<string, unknown>;
        try {
            dash = await fetchDashboard(park.id, park.key, park.token);
        } catch (e) {
            console.log(`  跳过: ${(e as Error).message}`);
            continue;
        }

        const rawTenants = (dash.tenants || []) as Record<string, unknown>[];
        const liveTenants = rawTenants.map(normalizeTenantFromApi).filter((t) => t.id && t.leaseStart);
        const scenarios = (dash.budgetScenarios || []) as BudgetScenario[];
        const recvScenario = getReceivableScenarioForYear(scenarios, YEAR);

        console.log(`  实时合同: ${liveTenants.length}，应收方案: ${recvScenario?.id || '无'}`);

        const snapMismatches = auditSnapshotVsLive(liveTenants, recvScenario);
        const withAmount = snapMismatches.filter((x) => x.amountDiffMonths.length > 0);
        totalA += snapMismatches.length;
        totalAWithAmount += withAmount.length;

        console.log(`\n  [A] 快照与实时条款不一致: ${snapMismatches.length} 户`);
        if (snapMismatches.length > 0) {
            for (const x of snapMismatches.slice(0, 30)) {
                console.log(
                    `    - ${x.name} (${x.tenantId}) 差异字段: ${x.diffFields.join(', ')}`,
                );
                console.log(`      实时免租: ${x.liveRentFreeSummary} | 快照: ${x.snapRentFreeSummary}`);
                if (x.amountDiffMonths.length > 0) {
                    console.log(
                        `      ${YEAR} 应收金额差异月: ${x.amountDiffMonths.map((m) => `${m.month} 快照${m.snapDue} vs 实时${m.liveDue} (Δ${m.delta})`).join('; ')}`,
                    );
                }
            }
            if (snapMismatches.length > 30) console.log(`    ... 另有 ${snapMismatches.length - 30} 户`);
        }

        const firstRecIssues = auditFirstReceivableRecalc(liveTenants);
        totalB += firstRecIssues.length;
        console.log(`\n  [B] 首期覆盖+分房源 账单金额未按覆盖期重算: ${firstRecIssues.length} 户`);
        for (const x of firstRecIssues) {
            console.log(`    - ${x.name} (${x.tenantId}) 异常期次 ${x.issueRows.length} 笔`);
            for (const r of x.issueRows.slice(0, 4)) {
                console.log(
                    `        收款 ${r.payDate} 现 ${r.amount} 应为 ${r.expected} 覆盖 ${r.coverage}`,
                );
            }
        }

        // 顺江：合并租户在变更月前用快照
        const shunjiang = liveTenants.filter((t) => t.name.includes('顺江'));
        if (shunjiang.length > 0 && recvScenario) {
            console.log(`\n  [顺江复核]`);
            for (const live of shunjiang) {
                const snap = recvScenario.baseDataSnapshot?.tenants?.find((s) => s.id === live.id);
                if (!snap) continue;
                for (let m = 0; m < 12; m++) {
                    const merged = mergeTenantsForReceivablePeriod(YEAR, m, [live], [snap])[0];
                    const rf = formatYearRentFreeSummary(YEAR, merged.rentFreePeriods);
                    const row = buildBillingDetailsForPeriod(
                        YEAR,
                        m,
                        buildCtx(liveTenants, recvScenario),
                    ).find((d) => d.tenantId === live.id);
                    if (row && row.amountDue > 0) {
                        console.log(
                            `    ${YEAR}-${String(m + 1).padStart(2, '0')} 核销用免租「${rf}」应收 ${row.amountDue}`,
                        );
                    }
                }
            }
        }
    }

    console.log(`\n=== 汇总 ===`);
    console.log(`[A] 条款快照不一致: ${totalA} 户（其中 ${totalAWithAmount} 户 ${YEAR} 年应收金额会不同）`);
    console.log(`[B] 首期+分房源重算异常: ${totalB} 户（当前代码下应为 0；>0 表示仍有 bug）`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
