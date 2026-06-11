/**
 * 调试单租户应收归属月份
 * 用法: PB_URL=... PB_ADMIN_EMAIL=... PB_ADMIN_PASSWORD=... node scripts/debug-tenant-billing.mjs shanghai_park <tenantIdOrNameSubstring> [year]
 */
import { initPocketBase, authenticatePocketBase, fetchPocketBaseBackup } from '../services/pocketbaseService.ts';
import { buildBillingDetailsForPeriod } from '../services/dashboardMetrics.ts';
import { generateBudgetedBills } from '../services/billingService.ts';
import { receivableBudgetMonthForBill, parseDeferBillingNoteEntries } from '../services/receivableListHelpers.ts';

const projectId = process.argv[2] || 'shanghai_park';
const needle = process.argv[3] || '';
const year = Number(process.argv[4] || 2026);

async function main() {
    initPocketBase(process.env.PB_URL || 'http://127.0.0.1:1001');
    const ok = await authenticatePocketBase(process.env.PB_ADMIN_EMAIL || '', process.env.PB_ADMIN_PASSWORD || '');
    if (!ok) throw new Error('PocketBase auth failed');
    const res = await fetchPocketBaseBackup(projectId);
    if (!res.data) throw new Error(res.message || 'no data');
    const data = res.data;
    const t = data.tenants.find(
        (x) => x.id === needle || (needle && x.name?.includes(needle))
    );
    if (!t) {
        console.log('tenant not found for', needle);
        process.exit(1);
    }
    console.log('=== 合同 ===');
    console.log(
        JSON.stringify(
            {
                id: t.id,
                name: t.name?.trim(),
                status: t.status,
                leaseStart: t.leaseStart,
                leaseEnd: t.leaseEnd,
                signingDate: t.signingDate,
                firstPaymentDate: t.firstPaymentDate,
                firstPaymentMonths: t.firstPaymentMonths,
                paymentCycle: t.paymentCycle,
                paymentCycleMonths: t.paymentCycleMonths,
                paymentPeriodShiftMonths: t.paymentPeriodShiftMonths,
                freeRentHandling: t.freeRentHandling,
                monthlyRent: t.monthlyRent,
                unitPrice: t.unitPrice,
                rentFreePeriods: t.rentFreePeriods,
            },
            null,
            2
        )
    );
    const asm = (data.budgetAssumptions || []).filter((a) => a.targetId === t.id);
    const adj = (data.budgetAdjustments || []).filter((a) => a.tenantId === t.id);
    console.log('\n=== 预算假设 ===', JSON.stringify(asm, null, 2));
    console.log('\n=== 预算调整 ===', JSON.stringify(adj, null, 2));
    const deferEntries = parseDeferBillingNoteEntries(data.billingPeriodNotes).filter((e) => e.tenantId === t.id);
    console.log('\n=== 缓缴备注 ===', JSON.stringify(deferEntries, null, 2));

    const bills = generateBudgetedBills(
        t,
        data.budgetAssumptions || [],
        data.budgetAdjustments || [],
        new Date(year - 2, 0, 1),
        new Date(year + 2, 11, 31)
    );
    console.log(`\n=== ${year} 推算账单 (bill.date -> 归属月) ===`);
    for (const b of bills) {
        if (b.date.getFullYear() !== year) continue;
        const { year: y, monthIndex } = receivableBudgetMonthForBill(b, t);
        const cov =
            b.coverageStart && b.coverageEnd
                ? `${b.coverageStart.toISOString().slice(0, 10)}~${b.coverageEnd.toISOString().slice(0, 10)}`
                : '';
        const orig = b.originalDate ? ` orig=${b.originalDate.toISOString().slice(0, 10)}` : '';
        console.log(
            `  billDate ${b.date.toISOString().slice(0, 10)} -> ${y}-${monthIndex + 1}  ¥${b.amount}  cov ${cov}${orig}`
        );
    }

    for (let m = 0; m < 12; m++) {
        const det = buildBillingDetailsForPeriod(year, m, data).filter(
            (d) => d.tenantId === t.id || d.tenantName?.includes('极然')
        );
        if (!det.length) continue;
        console.log(`\n=== 核销视图 ${year}-${String(m + 1).padStart(2, '0')} ===`);
        for (const d of det) {
            console.log(
                `  due=${d.amountDue} paid=${d.amountPaid} contract=${d.contractAmountDue ?? '-'} status=${d.status} deferTo=${d.deferredToPeriod || '-'} deferAmt=${d.deferredAmount || 0}`
            );
        }
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
