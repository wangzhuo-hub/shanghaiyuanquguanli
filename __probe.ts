import { generateBudgetedBills } from './services/billingService.ts';
import { buildBillingDetailsForPeriod } from './services/dashboardMetrics.ts';
import type { Tenant } from './types.ts';

const orig: Tenant = {
  id: '1v4ta96e3pupj46', name: '北京快乐庄园摄影中心', status: 'Expired' as any,
  buildingId: 'b1776414613524', unitIds: ['b1776414613524-4-7-713'], totalArea: 195,
  leaseStart: '2023-07-21', leaseEnd: '2026-07-20', signingDate: '2023-07-20',
  monthlyRent: 6105.23, unitPrice: 1.04, paymentCycle: 'Quarterly', paymentCycleMonths: 3,
  firstPaymentDate: '2023-07-20', projectId: 'beijing_park',
  rentFreePeriods: [], depositAmount: 0, depositStatus: 'Unpaid' as any,
} as any;

const renew: Tenant = {
  id: '31z51viz79bnvle', name: '北京快乐庄园摄影中心', status: 'Pending' as any,
  rootId: 't1776994815161_10',
  buildingId: 'b1776414613524', unitIds: ['b1776414613524-4-7-713'], totalArea: 195,
  leaseStart: '2026-07-21', leaseEnd: '2029-07-20', signingDate: '2026-06-02',
  monthlyRent: 6105.23, unitPrice: 1.04, paymentCycle: 'Quarterly', paymentCycleMonths: 3,
  firstPaymentDate: '2026-06-03', projectId: 'beijing_park',
  rentFreePeriods: [], depositAmount: 0, depositStatus: 'Unpaid' as any,
} as any;

function billsFor(t: Tenant, label: string) {
  const bills = generateBudgetedBills(t, [], [], new Date(2025,0,1), new Date(2027,11,31));
  console.log(`\n### ${label} (status=${t.status}) 账单 date / amount / coverage`);
  for (const b of bills) {
    const d = b.date;
    if (d.getFullYear() < 2026 || d.getFullYear() > 2026) continue;
    const cs = (b as any).coverageStart, ce = (b as any).coverageEnd;
    console.log(`  ${d.toISOString().slice(0,10)}  ¥${(b.amount||0).toFixed(2)}  cover ${cs?cs.toISOString().slice(0,10):'-'}~${ce?ce.toISOString().slice(0,10):'-'}`);
  }
}

billsFor(orig, '原合同 4-713');
billsFor(renew, '续签合同 4-713');

// Now the finance-report monthly AR via buildBillingDetailsForPeriod
const ctx: any = {
  tenants: [orig, renew],
  buildings: [{ id: 'b1776414613524', name: 'B4', units: [{ id: 'b1776414613524-4-7-713', name: '4-713', area: 195 }] }],
  payments: [], budgetScenarios: [], budgetAssumptions: [], budgetAdjustments: [],
  billingPeriodNotes: {}, initializationData: [],
};

console.log('\n### 财务报表「应收」逐月 (2026) — buildBillingDetailsForPeriod');
for (let m = 0; m < 12; m++) {
  const rows = buildBillingDetailsForPeriod(2026, m, ctx);
  const rent = rows.filter((r:any)=> (r.feeKind||'rent')==='rent');
  const byName = rent.map((r:any)=>`${r.tenantId.slice(-6)}:¥${r.amountDue.toFixed(0)}`).join('  ');
  console.log(`  2026-${String(m+1).padStart(2,'0')}: ${byName || '(无行)'}`);
}
