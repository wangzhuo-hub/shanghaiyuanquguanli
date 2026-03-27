/**
 * JSON 数据迁移脚本
 * 
 * 功能：将 JSON 备份文件（或 PocketBase park_backups 中的数据）拆分并导入到结构化集合中
 * 
 * 使用方法：
 *   # 从 JSON 文件导入
 *   node scripts/migrate-json-to-pb.mjs http://127.0.0.1:8090 admin@example.com password123 ./park_data_2026-03-04.json
 * 
 *   # 从 PocketBase park_backups 集合中读取最新备份并拆分
 *   node scripts/migrate-json-to-pb.mjs http://127.0.0.1:8090 admin@example.com password123
 * 
 * 前提条件：
 *   1. 已运行 setup-pb-collections.mjs 创建集合
 *   2. PocketBase 服务正在运行
 */

import PocketBase from 'pocketbase';
import { readFileSync } from 'fs';

const PB_URL = process.argv[2] || 'http://127.0.0.1:8090';
const ADMIN_EMAIL = process.argv[3] || 'admin@example.com';
const ADMIN_PASSWORD = process.argv[4] || 'admin123456';
const JSON_FILE = process.argv[5] || null;
const PROJECT_ID = process.argv[6] || 'park_data_main';

// ===================== 数据转换函数 =====================

function extractBuildings(data, projectId) {
  if (!data.buildings) return [];
  return data.buildings.map(b => ({
    original_id: b.id,
    name: b.name,
    type: b.type || 'Building',
    project_id: projectId,
  }));
}

function extractUnits(data, projectId) {
  if (!data.buildings) return [];
  const units = [];
  data.buildings.forEach(b => {
    (b.units || []).forEach(u => {
      units.push({
        original_id: u.id,
        building_id: b.id,
        name: u.name,
        area: u.area || 0,
        status: u.status || 'Vacant',
        floor: u.floor || 1,
        is_self_use: u.isSelfUse || false,
        project_id: projectId,
      });
    });
  });
  return units;
}

function extractTenants(data, projectId) {
  if (!data.tenants) return [];
  return data.tenants.map(t => ({
    original_id: t.id,
    root_id: t.rootId || '',
    name: t.name,
    contact_info: t.contactInfo || '',
    industry: t.industry || '',
    founding_date: t.foundingDate || '',
    legal_rep_name: t.legalRepName || '',
    legal_rep_birthday: t.legalRepBirthday || '',
    contact_name: t.contactName || '',
    contact_birthday: t.contactBirthday || '',
    building_id: t.buildingId,
    unit_ids: t.unitIds || [],
    total_area: t.totalArea || 0,
    signing_date: t.signingDate || '',
    lease_start: t.leaseStart,
    lease_end: t.leaseEnd,
    move_in_date: t.moveInDate || '',
    unit_price: t.unitPrice || 0,
    monthly_rent: t.monthlyRent || 0,
    rent_free_periods: t.rentFreePeriods || [],
    payment_cycle: t.paymentCycle || 'Monthly',
    payment_terms: Array.isArray(t.paymentTerms) ? t.paymentTerms : [],
    payment_cycle_months: t.paymentCycleMonths || null,
    first_payment_date: t.firstPaymentDate || '',
    first_payment_months: t.firstPaymentMonths || null,
    free_rent_handling: t.freeRentHandling || null,
    deposit_amount: t.depositAmount || 0,
    deposit_status: t.depositStatus || 'Unpaid',
    status: t.status || 'Active',
    termination_date: t.terminationDate || '',
    termination_type: t.terminationType || null,
    termination_reason: t.terminationReason || '',
    special_requirements: t.specialRequirements || '',
    is_risk: t.isRisk || false,
    contract_parking_spaces: t.contractParkingSpaces ?? t.parkingSpaces ?? 0,
    actual_parking_spaces: t.actualParkingSpaces ?? t.parkingSpaces ?? 0,
    parking_unit_price: t.parkingUnitPrice || 0,
    key_moments: t.keyMoments || [],
    project_id: projectId,
  }));
}

function extractPayments(data, projectId) {
  if (!data.payments) return [];
  return data.payments.map(p => ({
    original_id: p.id,
    tenant_id: p.tenantId,
    tenant_name: p.tenantName || '',
    amount: p.amount || 0,
    type: p.type || 'Rent',
    date: p.date,
    status: p.status || 'Pending',
    invoice_status: p.invoiceStatus || null,
    period: p.period || '',
    remarks: p.remarks || '',
    project_id: projectId,
  }));
}

function extractInvoices(data, projectId) {
  if (!data.invoices) return [];
  return data.invoices.map(inv => ({
    original_id: inv.id,
    tenant_id: inv.tenantId,
    bill_date: inv.billDate,
    target_invoice_date: inv.targetInvoiceDate || '',
    amount: inv.amount || 0,
    status: inv.status || 'Pending',
    invoiced_at: inv.invoicedAt || '',
    defer_reason: inv.deferReason || '',
    project_id: projectId,
  }));
}

function extractYearlyTargets(data, projectId) {
  if (!data.yearlyTargets) return [];
  return Object.entries(data.yearlyTargets).map(([year, targets]) => ({
    year: Number(year),
    revenue: targets.revenue || 0,
    occupancy: targets.occupancy || 0,
    project_id: projectId,
  }));
}

function extractMonthlyInitData(data, projectId) {
  if (!data.initializationData) return [];
  return data.initializationData.map(d => ({
    year: d.year,
    month: d.month,
    revenue_target: d.revenueTarget || 0,
    revenue_collected: d.revenueCollected || 0,
    occupancy_rate: d.occupancyRate || 0,
    accumulated_arrears: d.accumulatedArrears || 0,
    project_id: projectId,
  }));
}

function extractBudgetAssumptions(data, projectId) {
  if (!data.budgetAssumptions) return [];
  return data.budgetAssumptions.map(a => ({
    original_id: a.id,
    target_type: a.targetType || null,
    target_id: a.targetId || '',
    target_name: a.targetName || '',
    strategy: a.strategy || null,
    projected_termination_date: a.projectedTerminationDate || '',
    vacancy_gap_months: a.vacancyGapMonths ?? null,
    projected_sign_date: a.projectedSignDate || '',
    projected_unit_price: a.projectedUnitPrice || 0,
    projected_rent_free_months: a.projectedRentFreeMonths || 0,
    billing_cycle_shift_months: a.billingCycleShiftMonths ?? null,
    price_adjustment: a.priceAdjustment || null,
    payment_shift: a.paymentShift || null,
    project_id: projectId,
  }));
}

function extractBudgetAdjustments(data, projectId) {
  if (!data.budgetAdjustments) return [];
  return data.budgetAdjustments.map(a => ({
    original_id: a.id,
    tenant_id: a.tenantId,
    tenant_name: a.tenantName || '',
    original_year: a.originalYear,
    original_month: a.originalMonth,
    adjusted_year: a.adjustedYear,
    adjusted_month: a.adjustedMonth,
    amount: a.amount || 0,
    reason: a.reason || '',
    adjustment_kind: a.adjustmentKind || ((a.originalYear === -1 && a.originalMonth === -1) ? 'amount_delta' : 'period_shift'),
    project_id: projectId,
  }));
}

function extractBudgetScenarios(data, projectId) {
  if (!data.budgetScenarios) return [];
  return data.budgetScenarios.map(s => ({
    original_id: s.id,
    name: s.name,
    description: s.description || '',
    scenario_created_at: s.createdAt || '',
    is_active: s.isActive || false,
    assumptions: s.assumptions || [],
    adjustments: s.adjustments || [],
    base_data_snapshot: s.baseDataSnapshot || null,
    project_id: projectId,
  }));
}

function extractBillingPeriodNotes(data, projectId) {
  return [{
    original_id: 'billing_period_notes',
    notes_json: data.billingPeriodNotes || {},
    project_id: projectId,
  }];
}

// ===================== 批量插入 =====================

async function batchInsert(pb, collectionName, records, label) {
  if (records.length === 0) {
    console.log(`  [⊘] ${label}: 无数据`);
    return { inserted: 0, skipped: 0, failed: 0 };
  }

  let inserted = 0, skipped = 0, failed = 0;

  for (const record of records) {
    try {
      await pb.collection(collectionName).create(record);
      inserted++;
    } catch (e) {
      if (e.status === 400 && e.data?.data?.original_id?.code === 'validation_not_unique') {
        skipped++;
      } else if (e.status === 400 && JSON.stringify(e.data).includes('UNIQUE')) {
        skipped++;
      } else {
        failed++;
        if (failed <= 3) {
          console.error(`    [✗] 插入失败 (${collectionName}):`, e.message);
          if (e.data?.data) console.error('    详情:', JSON.stringify(e.data.data));
        }
      }
    }
  }

  const status = failed > 0 ? '⚠' : '✓';
  console.log(`  [${status}] ${label}: 插入 ${inserted}, 跳过 ${skipped} (已存在), 失败 ${failed} / 共 ${records.length} 条`);
  return { inserted, skipped, failed };
}

// ===================== 主逻辑 =====================

async function main() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║   JSON → PocketBase 数据迁移工具                 ║');
  console.log('║   上海园区招商管理看板                           ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log();

  const pb = new PocketBase(PB_URL);

  // 1. 连接检查
  try {
    await pb.health.check();
    console.log('[✓] PocketBase 连接正常');
  } catch (e) {
    console.error('[✗] 无法连接到 PocketBase:', e.message);
    process.exit(1);
  }

  // 2. 认证（优先管理员；失败时回退匿名模式，依赖 API Rules）
  let authenticated = false;
  try {
    await pb.collection('_superusers').authWithPassword(ADMIN_EMAIL, ADMIN_PASSWORD);
    authenticated = true;
    console.log('[✓] 超级管理员认证成功');
  } catch (_) {
    try {
      await pb.admins.authWithPassword(ADMIN_EMAIL, ADMIN_PASSWORD);
      authenticated = true;
      console.log('[✓] 管理员认证成功');
    } catch (_) {
      console.warn('[!] 管理员认证失败，尝试匿名模式继续（需集合 API Rules 允许写入）');
    }
  }
  if (!authenticated) {
    pb.authStore.clear();
  }

  // 3. 获取数据
  let dashboardData;

  if (JSON_FILE) {
    console.log(`[i] 从文件读取: ${JSON_FILE}`);
    try {
      const raw = readFileSync(JSON_FILE, 'utf-8');
      dashboardData = JSON.parse(raw);
      console.log('[✓] JSON 文件解析成功');
    } catch (e) {
      console.error('[✗] 文件读取失败:', e.message);
      process.exit(1);
    }
  } else {
    console.log('[i] 从 PocketBase park_backups 集合读取最新备份...');
    try {
      const records = await pb.collection('park_backups').getList(1, 1, {
        filter: `project_id = "${PROJECT_ID}"`,
        sort: '-created',
      });
      if (records.items.length === 0) {
        console.error('[✗] 未找到备份记录 (project_id:', PROJECT_ID, ')');
        console.log('    请指定 JSON 文件路径作为第5个参数');
        process.exit(1);
      }
      dashboardData = records.items[0].data;
      console.log(`[✓] 获取备份成功 (ID: ${records.items[0].id}, Note: ${records.items[0].note || '无'})`);
    } catch (e) {
      console.error('[✗] 读取 park_backups 失败:', e.message);
      process.exit(1);
    }
  }

  // 4. 数据统计
  console.log();
  console.log('── 数据概览 ──────────────────────────────');
  console.log(`  楼宇/场地:   ${(dashboardData.buildings || []).length} 栋`);
  const unitCount = (dashboardData.buildings || []).reduce((sum, b) => sum + (b.units || []).length, 0);
  console.log(`  房间/单元:   ${unitCount} 个`);
  console.log(`  租户/合同:   ${(dashboardData.tenants || []).length} 条`);
  console.log(`  收款记录:    ${(dashboardData.payments || []).length} 条`);
  console.log(`  发票记录:    ${(dashboardData.invoices || []).length} 条`);
  console.log(`  年度目标:    ${Object.keys(dashboardData.yearlyTargets || {}).length} 年`);
  console.log(`  月度初始化:  ${(dashboardData.initializationData || []).length} 条`);
  console.log(`  预算假设:    ${(dashboardData.budgetAssumptions || []).length} 条`);
  console.log(`  预算调整:    ${(dashboardData.budgetAdjustments || []).length} 条`);
  console.log(`  预算方案:    ${(dashboardData.budgetScenarios || []).length} 套`);
  console.log();

  // 5. 提取并插入数据
  console.log('── 开始迁移 ──────────────────────────────');

  const stats = { totalInserted: 0, totalSkipped: 0, totalFailed: 0 };

  const migrations = [
    ['pb_buildings',          extractBuildings(dashboardData, PROJECT_ID),          '楼宇/场地'],
    ['pb_units',              extractUnits(dashboardData, PROJECT_ID),              '房间/单元'],
    ['pb_tenants',            extractTenants(dashboardData, PROJECT_ID),            '租户/合同'],
    ['pb_payments',           extractPayments(dashboardData, PROJECT_ID),           '收款记录'],
    ['pb_invoices',           extractInvoices(dashboardData, PROJECT_ID),           '发票记录'],
    ['pb_yearly_targets',     extractYearlyTargets(dashboardData, PROJECT_ID),      '年度目标'],
    ['pb_monthly_init_data',  extractMonthlyInitData(dashboardData, PROJECT_ID),    '月度初始化数据'],
    ['pb_budget_assumptions', extractBudgetAssumptions(dashboardData, PROJECT_ID),  '预算假设'],
    ['pb_budget_adjustments', extractBudgetAdjustments(dashboardData, PROJECT_ID),  '预算调整'],
    ['pb_budget_scenarios',   extractBudgetScenarios(dashboardData, PROJECT_ID),    '预算方案'],
    ['pb_billing_period_notes', extractBillingPeriodNotes(dashboardData, PROJECT_ID), '账期备注'],
  ];

  for (const [collection, records, label] of migrations) {
    const result = await batchInsert(pb, collection, records, label);
    stats.totalInserted += result.inserted;
    stats.totalSkipped += result.skipped;
    stats.totalFailed += result.failed;
  }

  // 6. 总结
  console.log();
  console.log('═══════════════════════════════════════════');
  console.log(`  迁移完成!`);
  console.log(`  成功插入:  ${stats.totalInserted} 条记录`);
  console.log(`  已跳过:    ${stats.totalSkipped} 条 (重复)`);
  if (stats.totalFailed > 0) {
    console.log(`  失败:      ${stats.totalFailed} 条`);
  }
  console.log('═══════════════════════════════════════════');
  console.log();
  console.log('数据迁移完成！您现在可以在 PocketBase Admin UI 中查看和管理各集合的数据');
  console.log(`Admin UI: ${PB_URL}/_/`);
}

main().catch(err => {
  console.error('脚本执行失败:', err);
  process.exit(1);
});
