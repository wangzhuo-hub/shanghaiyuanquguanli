/**
 * PocketBase 集合创建脚本
 * 
 * 功能：在 PocketBase 中创建结构化的数据集合，将原来的 JSON Blob 存储拆分为独立的关系型集合
 * 
 * 使用方法：
 *   node scripts/setup-pb-collections.mjs [pocketbase_url] [admin_email] [admin_password]
 * 
 * 示例：
 *   node scripts/setup-pb-collections.mjs http://127.0.0.1:8090 admin@example.com password123
 * 
 * 注意：需要 PocketBase 管理员账号才能创建集合
 */

import PocketBase from 'pocketbase';

const PB_URL = process.argv[2] || 'http://127.0.0.1:8090';
const ADMIN_EMAIL = process.argv[3] || 'admin@example.com';
const ADMIN_PASSWORD = process.argv[4] || 'admin123456';

// ===================== 集合定义 =====================

const COLLECTIONS = [
  {
    name: 'pb_buildings',
    schema: [
      { name: 'original_id', type: 'text', required: true, options: { min: null, max: null, pattern: '' } },
      { name: 'name', type: 'text', required: true, options: { min: null, max: null, pattern: '' } },
      { name: 'type', type: 'select', required: false, options: { maxSelect: 1, values: ['Building', 'Site'] } },
      { name: 'project_id', type: 'text', required: false, options: { min: null, max: null, pattern: '' } },
    ],
    indexes: ['CREATE UNIQUE INDEX idx_buildings_oid ON pb_buildings (original_id, project_id)'],
    comment: '楼宇/场地',
  },
  {
    name: 'pb_units',
    schema: [
      { name: 'original_id', type: 'text', required: true, options: { min: null, max: null, pattern: '' } },
      { name: 'building_id', type: 'text', required: true, options: { min: null, max: null, pattern: '' } },
      { name: 'name', type: 'text', required: true, options: { min: null, max: null, pattern: '' } },
      { name: 'area', type: 'number', required: true, options: { min: 0, max: null, noDecimal: false } },
      { name: 'status', type: 'select', required: false, options: { maxSelect: 1, values: ['Vacant', 'Occupied', 'Reserved'] } },
      { name: 'floor', type: 'number', required: false, options: { min: null, max: null, noDecimal: true } },
      { name: 'is_self_use', type: 'bool', required: false, options: {} },
      { name: 'project_id', type: 'text', required: false, options: { min: null, max: null, pattern: '' } },
    ],
    indexes: [
      'CREATE UNIQUE INDEX idx_units_oid ON pb_units (original_id, project_id)',
      'CREATE INDEX idx_units_building ON pb_units (building_id)',
    ],
    comment: '房间/单元',
  },
  {
    name: 'pb_tenants',
    schema: [
      { name: 'original_id', type: 'text', required: true, options: { min: null, max: null, pattern: '' } },
      { name: 'root_id', type: 'text', required: false, options: { min: null, max: null, pattern: '' } },
      { name: 'name', type: 'text', required: true, options: { min: null, max: null, pattern: '' } },
      { name: 'contact_info', type: 'text', required: false, options: { min: null, max: null, pattern: '' } },
      { name: 'industry', type: 'text', required: false, options: { min: null, max: null, pattern: '' } },
      { name: 'founding_date', type: 'text', required: false, options: { min: null, max: null, pattern: '' } },
      { name: 'legal_rep_name', type: 'text', required: false, options: { min: null, max: null, pattern: '' } },
      { name: 'legal_rep_birthday', type: 'text', required: false, options: { min: null, max: null, pattern: '' } },
      { name: 'contact_name', type: 'text', required: false, options: { min: null, max: null, pattern: '' } },
      { name: 'contact_birthday', type: 'text', required: false, options: { min: null, max: null, pattern: '' } },
      { name: 'building_id', type: 'text', required: true, options: { min: null, max: null, pattern: '' } },
      { name: 'unit_ids', type: 'json', required: false, options: { maxSize: 200000 } },
      { name: 'total_area', type: 'number', required: false, options: { min: 0, max: null, noDecimal: false } },
      { name: 'signing_date', type: 'text', required: false, options: { min: null, max: null, pattern: '' } },
      { name: 'move_in_date', type: 'text', required: false, options: { min: null, max: null, pattern: '' } },
      { name: 'lease_start', type: 'text', required: true, options: { min: null, max: null, pattern: '' } },
      { name: 'lease_end', type: 'text', required: true, options: { min: null, max: null, pattern: '' } },
      { name: 'unit_price', type: 'number', required: false, options: { min: null, max: null, noDecimal: false } },
      { name: 'monthly_rent', type: 'number', required: false, options: { min: null, max: null, noDecimal: false } },
      { name: 'rent_free_periods', type: 'json', required: false, options: { maxSize: 500000 } },
      { name: 'rent_reductions', type: 'json', required: false, options: { maxSize: 500000 } },
      { name: 'payment_cycle', type: 'select', required: false, options: { maxSelect: 1, values: ['HalfMonthly', 'Monthly', 'BiMonthly', 'Quarterly', 'SemiAnnual', 'Annual', 'Custom'] } },
      { name: 'payment_terms', type: 'json', required: false, options: { maxSize: 2000000 } },
      { name: 'payment_cycle_months', type: 'number', required: false, options: { min: null, max: null, noDecimal: false } },
      { name: 'first_payment_date', type: 'text', required: false, options: { min: null, max: null, pattern: '' } },
      { name: 'first_payment_months', type: 'number', required: false, options: { min: null, max: null, noDecimal: false } },
      { name: 'first_receivable_amount', type: 'number', required: false, options: { min: null, max: null, noDecimal: false } },
      { name: 'first_receivable_start_date', type: 'text', required: false, options: { min: null, max: null, pattern: '' } },
      { name: 'first_receivable_end_date', type: 'text', required: false, options: { min: null, max: null, pattern: '' } },
      { name: 'free_rent_handling', type: 'select', required: false, options: { maxSelect: 1, values: ['Deduct', 'Defer'] } },
      { name: 'deposit_amount', type: 'number', required: false, options: { min: null, max: null, noDecimal: false } },
      { name: 'deposit_status', type: 'select', required: false, options: { maxSelect: 1, values: ['Unpaid', 'Paid', 'Refunded', 'Deducted'] } },
      { name: 'status', type: 'select', required: false, options: { maxSelect: 1, values: ['Active', 'Expiring', 'Terminated', 'Pending', 'Expired'] } },
      { name: 'termination_date', type: 'text', required: false, options: { min: null, max: null, pattern: '' } },
      { name: 'termination_type', type: 'select', required: false, options: { maxSelect: 1, values: ['Normal', 'Early'] } },
      { name: 'termination_reason', type: 'text', required: false, options: { min: null, max: null, pattern: '' } },
      { name: 'early_termination_fr_clawback_override', type: 'number', required: false, options: { min: null, max: null, noDecimal: false } },
      { name: 'early_termination_deposit_deduction', type: 'number', required: false, options: { min: null, max: null, noDecimal: false } },
      { name: 'early_termination_other_adjustment', type: 'number', required: false, options: { min: null, max: null, noDecimal: false } },
      { name: 'special_requirements', type: 'text', required: false, options: { min: null, max: null, pattern: '' } },
      { name: 'is_risk', type: 'bool', required: false, options: {} },
      { name: 'is_special_business', type: 'bool', required: false, options: {} },
      { name: 'contract_parking_spaces', type: 'number', required: false, options: { min: null, max: null, noDecimal: true } },
      { name: 'actual_parking_spaces', type: 'number', required: false, options: { min: null, max: null, noDecimal: true } },
      { name: 'parking_unit_price', type: 'number', required: false, options: { min: null, max: null, noDecimal: false } },
      { name: 'key_moments', type: 'json', required: false, options: { maxSize: 1000000 } },
      { name: 'project_id', type: 'text', required: false, options: { min: null, max: null, pattern: '' } },
    ],
    indexes: [
      'CREATE UNIQUE INDEX idx_tenants_oid ON pb_tenants (original_id, project_id)',
      'CREATE INDEX idx_tenants_building ON pb_tenants (building_id)',
      'CREATE INDEX idx_tenants_status ON pb_tenants (status)',
      'CREATE INDEX idx_tenants_name ON pb_tenants (name)',
    ],
    comment: '租户/合同',
  },
  {
    name: 'pb_payments',
    schema: [
      { name: 'original_id', type: 'text', required: true, options: { min: null, max: null, pattern: '' } },
      { name: 'tenant_id', type: 'text', required: true, options: { min: null, max: null, pattern: '' } },
      { name: 'tenant_name', type: 'text', required: false, options: { min: null, max: null, pattern: '' } },
      { name: 'amount', type: 'number', required: true, options: { min: null, max: null, noDecimal: false } },
      { name: 'type', type: 'select', required: false, options: { maxSelect: 1, values: ['Rent', 'Deposit', 'ManagementFee', 'ParkingFee', 'Other', 'DepositToRent', 'DepositRefund'] } },
      { name: 'date', type: 'text', required: true, options: { min: null, max: null, pattern: '' } },
      { name: 'status', type: 'select', required: false, options: { maxSelect: 1, values: ['Received', 'Pending'] } },
      { name: 'invoice_status', type: 'select', required: false, options: { maxSelect: 1, values: ['Pending', 'Invoiced'] } },
      { name: 'period', type: 'text', required: false, options: { min: null, max: null, pattern: '' } },
      { name: 'remarks', type: 'text', required: false, options: { min: null, max: null, pattern: '' } },
      { name: 'project_id', type: 'text', required: false, options: { min: null, max: null, pattern: '' } },
    ],
    indexes: [
      'CREATE UNIQUE INDEX idx_payments_oid ON pb_payments (original_id, project_id)',
      'CREATE INDEX idx_payments_tenant ON pb_payments (tenant_id)',
      'CREATE INDEX idx_payments_date ON pb_payments (date)',
      'CREATE INDEX idx_payments_type ON pb_payments (type)',
    ],
    comment: '收款记录',
  },
  {
    name: 'pb_invoices',
    schema: [
      { name: 'original_id', type: 'text', required: true, options: { min: null, max: null, pattern: '' } },
      { name: 'tenant_id', type: 'text', required: true, options: { min: null, max: null, pattern: '' } },
      { name: 'bill_date', type: 'text', required: true, options: { min: null, max: null, pattern: '' } },
      { name: 'target_invoice_date', type: 'text', required: false, options: { min: null, max: null, pattern: '' } },
      { name: 'amount', type: 'number', required: true, options: { min: null, max: null, noDecimal: false } },
      { name: 'status', type: 'select', required: false, options: { maxSelect: 1, values: ['Pending', 'Invoiced'] } },
      { name: 'invoiced_at', type: 'text', required: false, options: { min: null, max: null, pattern: '' } },
      { name: 'defer_reason', type: 'text', required: false, options: { min: null, max: null, pattern: '' } },
      { name: 'project_id', type: 'text', required: false, options: { min: null, max: null, pattern: '' } },
    ],
    indexes: [
      'CREATE UNIQUE INDEX idx_invoices_oid ON pb_invoices (original_id, project_id)',
      'CREATE INDEX idx_invoices_tenant ON pb_invoices (tenant_id)',
      'CREATE INDEX idx_invoices_status ON pb_invoices (status)',
    ],
    comment: '发票记录',
  },
  {
    name: 'pb_yearly_targets',
    schema: [
      { name: 'year', type: 'number', required: true, options: { min: 2020, max: 2050, noDecimal: true } },
      { name: 'revenue', type: 'number', required: false, options: { min: null, max: null, noDecimal: false } },
      { name: 'occupancy', type: 'number', required: false, options: { min: 0, max: 100, noDecimal: false } },
      { name: 'initial_budget', type: 'number', required: false, options: { min: null, max: null, noDecimal: false } },
      { name: 'project_id', type: 'text', required: false, options: { min: null, max: null, pattern: '' } },
    ],
    indexes: [
      'CREATE UNIQUE INDEX idx_yearly_targets_year ON pb_yearly_targets (year, project_id)',
    ],
    comment: '年度目标',
  },
  {
    name: 'pb_monthly_init_data',
    schema: [
      { name: 'year', type: 'number', required: true, options: { min: 2020, max: 2050, noDecimal: true } },
      { name: 'month', type: 'number', required: true, options: { min: 1, max: 12, noDecimal: true } },
      { name: 'revenue_target', type: 'number', required: false, options: { min: null, max: null, noDecimal: false } },
      { name: 'revenue_collected', type: 'number', required: false, options: { min: null, max: null, noDecimal: false } },
      { name: 'occupancy_rate', type: 'number', required: false, options: { min: 0, max: 100, noDecimal: false } },
      { name: 'accumulated_arrears', type: 'number', required: false, options: { min: null, max: null, noDecimal: false } },
      { name: 'initial_budget', type: 'number', required: false, options: { min: null, max: null, noDecimal: false } },
      { name: 'project_id', type: 'text', required: false, options: { min: null, max: null, pattern: '' } },
    ],
    indexes: [
      'CREATE UNIQUE INDEX idx_monthly_init ON pb_monthly_init_data (year, month, project_id)',
    ],
    comment: '月度初始化数据（历史）',
  },
  {
    name: 'pb_budget_assumptions',
    schema: [
      { name: 'original_id', type: 'text', required: true, options: { min: null, max: null, pattern: '' } },
      { name: 'target_type', type: 'select', required: false, options: { maxSelect: 1, values: ['Vacancy', 'Renewal', 'RiskTermination', 'Existing', 'Excluded'] } },
      { name: 'target_id', type: 'text', required: false, options: { min: null, max: null, pattern: '' } },
      { name: 'target_name', type: 'text', required: false, options: { min: null, max: null, pattern: '' } },
      { name: 'strategy', type: 'select', required: false, options: { maxSelect: 1, values: ['Renewal', 'ReLease'] } },
      { name: 'projected_termination_date', type: 'text', required: false, options: { min: null, max: null, pattern: '' } },
      { name: 'vacancy_gap_months', type: 'number', required: false, options: { min: null, max: null, noDecimal: true } },
      { name: 'projected_sign_date', type: 'text', required: false, options: { min: null, max: null, pattern: '' } },
      { name: 'projected_unit_price', type: 'number', required: false, options: { min: null, max: null, noDecimal: false } },
      { name: 'projected_rent_free_months', type: 'number', required: false, options: { min: null, max: null, noDecimal: true } },
      { name: 'billing_cycle_shift_months', type: 'number', required: false, options: { min: null, max: null, noDecimal: true } },
      { name: 'price_adjustment', type: 'json', required: false, options: { maxSize: 200000 } },
      { name: 'payment_shift', type: 'json', required: false, options: { maxSize: 200000 } },
      { name: 'project_id', type: 'text', required: false, options: { min: null, max: null, pattern: '' } },
    ],
    indexes: [
      'CREATE UNIQUE INDEX idx_ba_oid ON pb_budget_assumptions (original_id, project_id)',
    ],
    comment: '预算假设',
  },
  {
    name: 'pb_budget_adjustments',
    schema: [
      { name: 'original_id', type: 'text', required: true, options: { min: null, max: null, pattern: '' } },
      { name: 'tenant_id', type: 'text', required: true, options: { min: null, max: null, pattern: '' } },
      { name: 'tenant_name', type: 'text', required: false, options: { min: null, max: null, pattern: '' } },
      { name: 'original_year', type: 'number', required: false, options: { min: null, max: null, noDecimal: true } },
      { name: 'original_month', type: 'number', required: false, options: { min: 0, max: 11, noDecimal: true } },
      { name: 'adjusted_year', type: 'number', required: false, options: { min: null, max: null, noDecimal: true } },
      { name: 'adjusted_month', type: 'number', required: false, options: { min: 0, max: 11, noDecimal: true } },
      { name: 'amount', type: 'number', required: false, options: { min: null, max: null, noDecimal: false } },
      { name: 'reason', type: 'text', required: false, options: { min: null, max: null, pattern: '' } },
      { name: 'adjustment_kind', type: 'select', required: false, options: { maxSelect: 1, values: ['period_shift', 'amount_delta'] } },
      { name: 'project_id', type: 'text', required: false, options: { min: null, max: null, pattern: '' } },
    ],
    indexes: [
      'CREATE UNIQUE INDEX idx_badj_oid ON pb_budget_adjustments (original_id, project_id)',
      'CREATE INDEX idx_badj_tenant ON pb_budget_adjustments (tenant_id)',
    ],
    comment: '预算调整',
  },
  {
    name: 'pb_budget_scenarios',
    schema: [
      { name: 'original_id', type: 'text', required: true, options: { min: null, max: null, pattern: '' } },
      { name: 'name', type: 'text', required: true, options: { min: null, max: null, pattern: '' } },
      { name: 'description', type: 'text', required: false, options: { min: null, max: null, pattern: '' } },
      { name: 'scenario_created_at', type: 'text', required: false, options: { min: null, max: null, pattern: '' } },
      { name: 'is_active', type: 'bool', required: false, options: {} },
      { name: 'assumptions', type: 'json', required: false, options: { maxSize: 2000000 } },
      { name: 'adjustments', type: 'json', required: false, options: { maxSize: 2000000 } },
      { name: 'base_data_snapshot', type: 'json', required: false, options: { maxSize: 5000000 } },
      { name: 'project_id', type: 'text', required: false, options: { min: null, max: null, pattern: '' } },
    ],
    indexes: [
      'CREATE UNIQUE INDEX idx_bs_oid ON pb_budget_scenarios (original_id, project_id)',
    ],
    comment: '预算方案',
  },
  {
    name: 'pb_billing_period_notes',
    schema: [
      { name: 'original_id', type: 'text', required: true, options: { min: null, max: null, pattern: '' } },
      { name: 'notes_json', type: 'json', required: false, options: { maxSize: 2000000 } },
      { name: 'project_id', type: 'text', required: false, options: { min: null, max: null, pattern: '' } },
    ],
    indexes: ['CREATE UNIQUE INDEX idx_bpn_oid ON pb_billing_period_notes (original_id, project_id)'],
    comment: '租金账期备注 (tenantId###YYYY-MM → 文本)',
  },
  {
    name: 'pb_sealed_months',
    schema: [
      { name: 'project_id', type: 'text', required: true, options: { min: null, max: null, pattern: '' } },
      { name: 'sealed_year', type: 'number', required: true, options: { min: 2020, max: 2050, noDecimal: true } },
      { name: 'sealed_month', type: 'number', required: true, options: { min: 1, max: 12, noDecimal: true } },
      { name: 'receivable_total', type: 'number', required: false, options: { min: null, max: null, noDecimal: false } },
      { name: 'unpaid_sum', type: 'number', required: false, options: { min: null, max: null, noDecimal: false } },
      { name: 'arrears_increment', type: 'number', required: false, options: { min: null, max: null, noDecimal: false } },
      { name: 'cumulative_arrears', type: 'number', required: false, options: { min: null, max: null, noDecimal: false } },
      { name: 'details_json', type: 'json', required: false, options: { maxSize: 15000000 } },
      { name: 'data_version', type: 'number', required: false, options: { min: null, max: null, noDecimal: true } },
      { name: 'sealed_at', type: 'text', required: false, options: { min: null, max: null, pattern: '' } },
    ],
    indexes: [
      'CREATE UNIQUE INDEX idx_sealed_months_pid_period ON pb_sealed_months (project_id, sealed_year, sealed_month)',
    ],
    comment: '月度封账快照（含客户级应收明细）',
  },
  {
    name: 'pb_integration_snapshots',
    schema: [
      { name: 'project_id', type: 'text', required: true, options: { min: null, max: null, pattern: '' } },
      { name: 'snapshot_kind', type: 'text', required: true, options: { min: null, max: null, pattern: '' } },
      { name: 'payload', type: 'json', required: true, options: { maxSize: 15000000 } },
    ],
    indexes: [
      'CREATE UNIQUE INDEX idx_integration_snapshots_pid_kind ON pb_integration_snapshots (project_id, snapshot_kind)',
    ],
    comment: '集成全量快照（看板同源运算 JSON，含 kpi 子对象）',
  },
];

// ===================== 主逻辑 =====================

async function main() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║   PocketBase 结构化集合创建工具                  ║');
  console.log('║   金蝶地产——招商管理系统                        ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log();
  console.log(`PocketBase URL: ${PB_URL}`);
  console.log(`Admin Email:    ${ADMIN_EMAIL}`);
  console.log();

  const pb = new PocketBase(PB_URL);

  // 1. 健康检查
  try {
    await pb.health.check();
    console.log('[✓] PocketBase 服务连接正常');
  } catch (e) {
    console.error('[✗] 无法连接到 PocketBase，请确认服务已启动:', e.message);
    process.exit(1);
  }

  // 2. 管理员认证
  try {
    await pb.admins.authWithPassword(ADMIN_EMAIL, ADMIN_PASSWORD);
    console.log('[✓] 管理员认证成功');
  } catch (e) {
    console.error('[✗] 管理员认证失败:', e.message);
    console.log('    请确认管理员邮箱和密码正确');
    console.log('    如果还没有管理员账号，请先访问 PocketBase Admin UI 创建');
    process.exit(1);
  }

  // 3. 获取已有集合
  let existingCollections;
  try {
    existingCollections = await pb.collections.getFullList();
  } catch (e) {
    console.error('[✗] 获取集合列表失败:', e.message);
    process.exit(1);
  }
  const existingNames = new Set(existingCollections.map(c => c.name));
  console.log(`[i] 现有集合: ${existingCollections.map(c => c.name).join(', ') || '(无)'}`);
  console.log();

  // 4. 创建集合
  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const col of COLLECTIONS) {
    if (existingNames.has(col.name)) {
      console.log(`[⊘] 跳过 ${col.name} (${col.comment}) - 已存在`);
      skipped++;
      continue;
    }

    try {
      await pb.collections.create({
        name: col.name,
        type: 'base',
        schema: col.schema,
        indexes: col.indexes || [],
        listRule: '',
        viewRule: '',
        createRule: '',
        updateRule: '',
        deleteRule: '',
      });
      console.log(`[✓] 创建 ${col.name} (${col.comment}) - ${col.schema.length} 个字段`);
      created++;
    } catch (e) {
      console.error(`[✗] 创建 ${col.name} 失败:`, e.message);
      if (e.data) console.error('    详情:', JSON.stringify(e.data, null, 2));
      failed++;
    }
  }

  // 5. 总结
  console.log();
  console.log('═══════════════════════════════════════════');
  console.log(`  创建完成:  ${created} 个集合`);
  console.log(`  已跳过:    ${skipped} 个集合 (已存在)`);
  if (failed > 0) console.log(`  失败:      ${failed} 个集合`);
  console.log('═══════════════════════════════════════════');
  console.log();

  if (created > 0) {
    console.log('下一步: 运行数据迁移脚本将 JSON 数据导入新集合');
    console.log('  node scripts/migrate-json-to-pb.mjs [pocketbase_url] [admin_email] [admin_password] [json_file_path]');
  }
}

main().catch(err => {
  console.error('脚本执行失败:', err);
  process.exit(1);
});
