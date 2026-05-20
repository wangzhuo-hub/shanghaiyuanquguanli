/**
 * 从 PocketBase 导出各园区 DashboardData JSON 备份（与前端 fetchPocketBaseBackup 同构）
 *
 * 用法：
 *   PB_URL=http://127.0.0.1:1002 PB_ADMIN_EMAIL=... PB_ADMIN_PASSWORD=... \
 *     node scripts/export-pb-dashboard-backup.mjs [输出目录]
 *
 * 默认输出：backups/json-export-<ISO时间戳>/
 */

import PocketBase from 'pocketbase';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const PB_URL =
  process.env.PB_URL ||
  (process.argv[2]?.startsWith('http') ? process.argv[2] : 'http://127.0.0.1:1002');
const ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL || process.env.PB_ADMIN_USER || '';
const ADMIN_PASSWORD = process.env.PB_ADMIN_PASSWORD || '';
const OUT_DIR =
  process.env.BACKUP_OUT_DIR ||
  (process.argv[2]?.startsWith('http') ? process.argv[3] : process.argv[2]) ||
  join('backups', `json-export-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`);

const BACKUP_TYPE = 'park_dashboard_backup';
const SCHEMA_VERSION = 2;
const DASHBOARD_VERSION_OID = 'dashboard_data_version';

const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

async function mapList(pb, collection, projectId) {
  return pb.collection(collection).getFullList({
    filter: `project_id = "${esc(projectId)}"`,
    requestKey: null,
  });
}

function rebuildDashboard(projectId, rows) {
  const {
    buildingsRows,
    unitsRows,
    tenantsRows,
    paymentsRows,
    invoicesRows,
    yearlyRows,
    monthlyInitRows,
    assumptionRows,
    adjustmentRows,
    scenarioRows,
    notesJson,
    cloudSaveVersion,
  } = rows;

  const unitsByBuilding = new Map();
  for (const row of unitsRows) {
    const arr = unitsByBuilding.get(row.building_id) || [];
    arr.push({
      id: row.original_id,
      name: row.name,
      area: row.area || 0,
      status: row.status || 'Vacant',
      floor: row.floor || 1,
      isSelfUse: !!row.is_self_use,
    });
    unitsByBuilding.set(row.building_id, arr);
  }

  return {
    buildings: buildingsRows.map((b) => ({
      id: b.original_id,
      name: b.name,
      type: b.type || 'Building',
      units: unitsByBuilding.get(b.original_id) || [],
    })),
    tenants: tenantsRows.map((t) => ({
      id: t.original_id,
      rootId: t.root_id || '',
      name: t.name,
      contactInfo: t.contact_info || '',
      industry: t.industry || '',
      foundingDate: t.founding_date || '',
      legalRepName: t.legal_rep_name || '',
      legalRepBirthday: t.legal_rep_birthday || '',
      contactName: t.contact_name || '',
      contactBirthday: t.contact_birthday || '',
      buildingId: t.building_id,
      unitIds: Array.isArray(t.unit_ids) ? t.unit_ids : [],
      totalArea: t.total_area || 0,
      signingDate: t.signing_date || '',
      leaseStart: t.lease_start,
      leaseEnd: t.lease_end,
      moveInDate: t.move_in_date || '',
      unitPrice: t.unit_price || 0,
      unitPriceMode: t.unit_price_mode || 'daily',
      projectId: t.project_id || projectId,
      monthlyRent: t.monthly_rent || 0,
      rentFreePeriods: Array.isArray(t.rent_free_periods) ? t.rent_free_periods : [],
      rentReductions: Array.isArray(t.rent_reductions) ? t.rent_reductions : [],
      managementFeeEnabled: t.management_fee_enabled != null ? !!t.management_fee_enabled : undefined,
      managementFeeExempt: !!t.management_fee_exempt,
      managementFeeFreePeriods: Array.isArray(t.management_fee_free_periods)
        ? t.management_fee_free_periods
        : [],
      managementFeeUnitPrice:
        t.management_fee_unit_price != null ? Number(t.management_fee_unit_price) : undefined,
      managementFeeUnitPriceMode:
        t.management_fee_unit_price_mode === 'monthly' ? 'monthly' : 'daily',
      managementFeeMonthlyAmount:
        t.management_fee_monthly_amount != null
          ? Number(t.management_fee_monthly_amount)
          : undefined,
      managementFeeFirstPaymentDate: t.management_fee_first_payment_date || undefined,
      managementFeeStartWithOccupancy:
        t.management_fee_start_with_occupancy != null
          ? !!t.management_fee_start_with_occupancy
          : undefined,
      managementFeeStartDate: t.management_fee_start_date || undefined,
      paymentCycle: t.payment_cycle || 'Monthly',
      unitTerms: Array.isArray(t.payment_terms) ? t.payment_terms : [],
      paymentTerms: Array.isArray(t.payment_terms) ? t.payment_terms : [],
      paymentCycleMonths: t.payment_cycle_months ?? undefined,
      firstPaymentDate: t.first_payment_date || '',
      firstPaymentMonths: t.first_payment_months ?? undefined,
      firstReceivableAmount: t.first_receivable_amount != null ? Number(t.first_receivable_amount) : undefined,
      firstReceivableStartDate: t.first_receivable_start_date || undefined,
      firstReceivableEndDate: t.first_receivable_end_date || undefined,
      freeRentHandling: t.free_rent_handling || undefined,
      depositAmount: t.deposit_amount || 0,
      depositStatus: t.deposit_status || 'Unpaid',
      status: t.status || 'Active',
      terminationDate: t.termination_date || undefined,
      terminationType: t.termination_type || undefined,
      terminationReason: t.termination_reason || '',
      parentContractId: t.parent_contract_id || undefined,
      earlyTerminationFreeRentClawbackOverride:
        t.early_termination_fr_clawback_override != null
          ? Number(t.early_termination_fr_clawback_override)
          : undefined,
      earlyTerminationDepositDeduction:
        t.early_termination_deposit_deduction != null
          ? Number(t.early_termination_deposit_deduction)
          : undefined,
      earlyTerminationOtherAdjustment:
        t.early_termination_other_adjustment != null
          ? Number(t.early_termination_other_adjustment)
          : undefined,
      specialRequirements: t.special_requirements || '',
      isRisk: !!t.is_risk,
      isSpecialBusiness: !!t.is_special_business,
      contractParkingSpaces: t.contract_parking_spaces ?? 0,
      actualParkingSpaces: t.actual_parking_spaces ?? 0,
      parkingUnitPrice: t.parking_unit_price || 0,
      keyMoments: Array.isArray(t.key_moments) ? t.key_moments : [],
      nameHistory: Array.isArray(t.name_history) ? t.name_history : [],
      paymentCycleChanges: Array.isArray(t.payment_cycle_changes) ? t.payment_cycle_changes : [],
      paymentPeriodAdjustments: Array.isArray(t.payment_period_adjustments)
        ? t.payment_period_adjustments
        : [],
      paymentPeriodShiftMonths:
        typeof t.payment_period_shift_months === 'number' ? t.payment_period_shift_months : 0,
    })),
    payments: paymentsRows.map((p) => ({
      id: p.original_id,
      tenantId: p.tenant_id,
      tenantName: p.tenant_name || '',
      amount: p.amount || 0,
      type: p.type || 'Rent',
      date: p.date,
      period: p.period || '',
      status: p.status || 'Pending',
      invoiceStatus: p.invoice_status || undefined,
      remarks: p.remarks || '',
    })),
    invoices: invoicesRows.map((inv) => ({
      id: inv.original_id,
      tenantId: inv.tenant_id,
      billDate: inv.bill_date,
      targetInvoiceDate: inv.target_invoice_date || '',
      amount: inv.amount || 0,
      status: inv.status || 'Pending',
      invoicedAt: inv.invoiced_at || undefined,
      deferReason: inv.defer_reason || '',
    })),
    yearlyTargets: yearlyRows.reduce((acc, row) => {
      acc[Number(row.year)] = {
        revenue: row.revenue || 0,
        occupancy: row.occupancy || 0,
        initialBudget: row.initial_budget ?? 0,
      };
      return acc;
    }, {}),
    initializationData: monthlyInitRows.map((row) => ({
      year: row.year,
      month: row.month,
      revenueTarget: row.revenue_target || 0,
      revenueCollected: row.revenue_collected || 0,
      occupancyRate: row.occupancy_rate || 0,
      accumulatedArrears: row.accumulated_arrears || 0,
      initialBudget: row.initial_budget ?? 0,
    })),
    budgetAssumptions: assumptionRows.map((a) => ({
      id: a.original_id,
      targetType: a.target_type,
      targetId: a.target_id || '',
      targetName: a.target_name || '',
      strategy: a.strategy || undefined,
      projectedTerminationDate: a.projected_termination_date || '',
      vacancyGapMonths: a.vacancy_gap_months ?? undefined,
      projectedSignDate: a.projected_sign_date || '',
      projectedUnitPrice: a.projected_unit_price || 0,
      projectedRentFreeMonths: a.projected_rent_free_months || 0,
      billingCycleShiftMonths: a.billing_cycle_shift_months ?? undefined,
      priceAdjustment: a.price_adjustment || undefined,
      paymentShift: a.payment_shift || undefined,
    })),
    budgetAdjustments: adjustmentRows.map((a) => {
      const isAmountDelta =
        a.adjustment_kind === 'amount_delta' ||
        (a.original_year == null && a.original_month == null);
      return {
        id: a.original_id,
        tenantId: a.tenant_id,
        tenantName: a.tenant_name || '',
        originalYear: isAmountDelta ? -1 : a.original_year,
        originalMonth: isAmountDelta ? -1 : a.original_month,
        adjustedYear: a.adjusted_year,
        adjustedMonth: a.adjusted_month,
        amount: a.amount || 0,
        reason: a.reason || '',
        adjustmentKind: a.adjustment_kind || undefined,
      };
    }),
    budgetScenarios: scenarioRows.map((s) => ({
      id: s.original_id,
      name: s.name,
      budgetYear: Number.isFinite(Number(s.budget_year)) ? Number(s.budget_year) : new Date().getFullYear(),
      description: s.description || '',
      createdAt: s.scenario_created_at || '',
      isActive: !!s.is_active,
      isReceivableActive: !!s.is_receivable_active,
      assumptions: Array.isArray(s.assumptions) ? s.assumptions : [],
      adjustments: Array.isArray(s.adjustments) ? s.adjustments : [],
      baseDataSnapshot: s.base_data_snapshot || undefined,
    })),
    billingPeriodNotes: notesJson || {},
    cloudSaveVersion,
  };
}

function summarize(data) {
  const buildings = Array.isArray(data.buildings) ? data.buildings : [];
  return {
    buildings: buildings.length,
    units: buildings.reduce((s, b) => s + (b.units?.length || 0), 0),
    tenants: data.tenants?.length || 0,
    payments: data.payments?.length || 0,
    invoices: data.invoices?.length || 0,
    budgetScenarios: data.budgetScenarios?.length || 0,
  };
}

async function exportProject(pb, projectId, parkName, outDir) {
  const buildingsRows = await mapList(pb, 'pb_buildings', projectId);
  const unitsRows = await mapList(pb, 'pb_units', projectId);
  const tenantsRows = await mapList(pb, 'pb_tenants', projectId);
  const paymentsRows = await mapList(pb, 'pb_payments', projectId);
  const invoicesRows = await mapList(pb, 'pb_invoices', projectId);
  const yearlyRows = await mapList(pb, 'pb_yearly_targets', projectId);
  const monthlyInitRows = await mapList(pb, 'pb_monthly_init_data', projectId);
  const assumptionRows = await mapList(pb, 'pb_budget_assumptions', projectId);
  const adjustmentRows = await mapList(pb, 'pb_budget_adjustments', projectId);
  const scenarioRows = await mapList(pb, 'pb_budget_scenarios', projectId);

  const notesRecord = await pb.collection('pb_billing_period_notes').getList(1, 1, {
    filter: `project_id = "${esc(projectId)}" && original_id = "billing_period_notes"`,
    requestKey: null,
  });
  const versionRecord = await pb.collection('pb_billing_period_notes').getList(1, 1, {
    filter: `project_id = "${esc(projectId)}" && original_id = "${esc(DASHBOARD_VERSION_OID)}"`,
    fields: 'notes_json',
    requestKey: null,
  });
  const cloudSaveVersionRaw = versionRecord.items[0]?.notes_json?.version;
  const cloudSaveVersion =
    typeof cloudSaveVersionRaw === 'number' && Number.isFinite(cloudSaveVersionRaw) && cloudSaveVersionRaw >= 0
      ? Math.floor(cloudSaveVersionRaw)
      : 0;

  const data = rebuildDashboard(projectId, {
    buildingsRows,
    unitsRows,
    tenantsRows,
    paymentsRows,
    invoicesRows,
    yearlyRows,
    monthlyInitRows,
    assumptionRows,
    adjustmentRows,
    scenarioRows,
    notesJson: notesRecord.items[0]?.notes_json || {},
    cloudSaveVersion,
  });

  const envelope = {
    schema_version: SCHEMA_VERSION,
    backup_type: BACKUP_TYPE,
    project_id: projectId,
    park_name: parkName,
    exported_at: new Date().toISOString(),
    exported_by: ADMIN_EMAIL || 'export-pb-dashboard-backup.mjs',
    data,
  };

  const file = join(outDir, `${projectId}.json`);
  writeFileSync(file, JSON.stringify(envelope, null, 2), 'utf8');
  return { projectId, parkName, file, summary: summarize(data) };
}

async function main() {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    console.error('[export] 请设置 PB_ADMIN_EMAIL 与 PB_ADMIN_PASSWORD');
    process.exit(1);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const pb = new PocketBase(PB_URL);
  try {
    await pb.collection('_superusers').authWithPassword(ADMIN_EMAIL, ADMIN_PASSWORD);
  } catch {
    await pb.admins.authWithPassword(ADMIN_EMAIL, ADMIN_PASSWORD);
  }

  let parks = [];
  try {
    parks = await pb.collection('pb_parks').getFullList({ sort: 'sort_order', requestKey: null });
  } catch {
    parks = [
      { project_id: 'shanghai_park', name: '上海园区' },
      { project_id: 'shenzhen_park', name: '深圳园区' },
      { project_id: 'beijing_park', name: '北京园区' },
    ];
  }

  const results = [];
  for (const park of parks) {
    const pid = park.project_id;
    if (!pid) continue;
    console.log(`[export] ${pid} ...`);
    results.push(await exportProject(pb, pid, park.name || pid, OUT_DIR));
  }

  const manifest = {
    created_at: new Date().toISOString(),
    pb_url: PB_URL,
    out_dir: OUT_DIR,
    parks: results,
  };
  writeFileSync(join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  console.log(`[export] 完成 → ${OUT_DIR}`);
  for (const r of results) {
    console.log(`  - ${r.projectId}: tenants=${r.summary.tenants} payments=${r.summary.payments}`);
  }
}

main().catch((e) => {
  console.error('[export] 失败:', e?.message || e);
  process.exit(1);
});
