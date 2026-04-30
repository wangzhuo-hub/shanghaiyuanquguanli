/// <reference path="../pb_data/types.d.ts" />

/**
 * 创建结构化数据集合
 * 将原来的 JSON Blob 存储拆分为 10 个独立集合，支持精细化查询和数据分析
 */
migrate((db) => {
  // ── 1. pb_buildings (楼宇/场地) ──
  const buildings = new Collection({
    "name": "pb_buildings",
    "type": "base",
    "system": false,
    "schema": [
      { "name": "original_id", "type": "text", "required": true, "options": { "min": null, "max": null, "pattern": "" } },
      { "name": "name", "type": "text", "required": true, "options": { "min": null, "max": null, "pattern": "" } },
      { "name": "type", "type": "select", "required": false, "options": { "maxSelect": 1, "values": ["Building", "Site"] } },
      { "name": "project_id", "type": "text", "required": false, "options": { "min": null, "max": null, "pattern": "" } }
    ],
    "indexes": ["CREATE UNIQUE INDEX idx_buildings_oid ON pb_buildings (original_id, project_id)"],
    "listRule": "", "viewRule": "", "createRule": "", "updateRule": "", "deleteRule": "",
    "options": {}
  });
  Dao(db).saveCollection(buildings);

  // ── 2. pb_units (房间/单元) ──
  const units = new Collection({
    "name": "pb_units",
    "type": "base",
    "system": false,
    "schema": [
      { "name": "original_id", "type": "text", "required": true, "options": { "min": null, "max": null, "pattern": "" } },
      { "name": "building_id", "type": "text", "required": true, "options": { "min": null, "max": null, "pattern": "" } },
      { "name": "name", "type": "text", "required": true, "options": { "min": null, "max": null, "pattern": "" } },
      { "name": "area", "type": "number", "required": true, "options": { "min": 0, "max": null, "noDecimal": false } },
      { "name": "status", "type": "select", "required": false, "options": { "maxSelect": 1, "values": ["Vacant", "Occupied", "Reserved"] } },
      { "name": "floor", "type": "number", "required": false, "options": { "min": null, "max": null, "noDecimal": true } },
      { "name": "is_self_use", "type": "bool", "required": false, "options": {} },
      { "name": "project_id", "type": "text", "required": false, "options": { "min": null, "max": null, "pattern": "" } }
    ],
    "indexes": [
      "CREATE UNIQUE INDEX idx_units_oid ON pb_units (original_id, project_id)",
      "CREATE INDEX idx_units_building ON pb_units (building_id)"
    ],
    "listRule": "", "viewRule": "", "createRule": "", "updateRule": "", "deleteRule": "",
    "options": {}
  });
  Dao(db).saveCollection(units);

  // ── 3. pb_tenants (租户/合同) ──
  const tenants = new Collection({
    "name": "pb_tenants",
    "type": "base",
    "system": false,
    "schema": [
      { "name": "original_id", "type": "text", "required": true, "options": { "min": null, "max": null, "pattern": "" } },
      { "name": "root_id", "type": "text", "required": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "name": "name", "type": "text", "required": true, "options": { "min": null, "max": null, "pattern": "" } },
      { "name": "contact_info", "type": "text", "required": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "name": "industry", "type": "text", "required": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "name": "founding_date", "type": "text", "required": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "name": "legal_rep_name", "type": "text", "required": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "name": "legal_rep_birthday", "type": "text", "required": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "name": "contact_name", "type": "text", "required": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "name": "contact_birthday", "type": "text", "required": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "name": "building_id", "type": "text", "required": true, "options": { "min": null, "max": null, "pattern": "" } },
      { "name": "unit_ids", "type": "json", "required": false, "options": { "maxSize": 200000 } },
      { "name": "total_area", "type": "number", "required": false, "options": { "min": 0, "max": null, "noDecimal": false } },
      { "name": "signing_date", "type": "text", "required": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "name": "move_in_date", "type": "text", "required": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "name": "lease_start", "type": "text", "required": true, "options": { "min": null, "max": null, "pattern": "" } },
      { "name": "lease_end", "type": "text", "required": true, "options": { "min": null, "max": null, "pattern": "" } },
      { "name": "unit_price", "type": "number", "required": false, "options": { "min": null, "max": null, "noDecimal": false } },
      { "name": "monthly_rent", "type": "number", "required": false, "options": { "min": null, "max": null, "noDecimal": false } },
      { "name": "rent_free_periods", "type": "json", "required": false, "options": { "maxSize": 500000 } },
      { "name": "payment_cycle", "type": "select", "required": false, "options": { "maxSelect": 1, "values": ["HalfMonthly", "Monthly", "BiMonthly", "Quarterly", "SemiAnnual", "Annual", "Custom"] } },
      { "name": "payment_cycle_months", "type": "number", "required": false, "options": { "min": null, "max": null, "noDecimal": false } },
      { "name": "first_payment_date", "type": "text", "required": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "name": "first_payment_months", "type": "number", "required": false, "options": { "min": null, "max": null, "noDecimal": false } },
      { "name": "free_rent_handling", "type": "select", "required": false, "options": { "maxSelect": 1, "values": ["Deduct", "Defer"] } },
      { "name": "deposit_amount", "type": "number", "required": false, "options": { "min": null, "max": null, "noDecimal": false } },
      { "name": "deposit_status", "type": "select", "required": false, "options": { "maxSelect": 1, "values": ["Unpaid", "Paid", "Refunded", "Deducted"] } },
      { "name": "status", "type": "select", "required": false, "options": { "maxSelect": 1, "values": ["Active", "Expiring", "Terminated", "Pending", "Expired"] } },
      { "name": "termination_date", "type": "text", "required": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "name": "termination_type", "type": "select", "required": false, "options": { "maxSelect": 1, "values": ["Normal", "Early"] } },
      { "name": "termination_reason", "type": "text", "required": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "name": "special_requirements", "type": "text", "required": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "name": "is_risk", "type": "bool", "required": false, "options": {} },
      { "name": "contract_parking_spaces", "type": "number", "required": false, "options": { "min": null, "max": null, "noDecimal": true } },
      { "name": "actual_parking_spaces", "type": "number", "required": false, "options": { "min": null, "max": null, "noDecimal": true } },
      { "name": "parking_unit_price", "type": "number", "required": false, "options": { "min": null, "max": null, "noDecimal": false } },
      { "name": "key_moments", "type": "json", "required": false, "options": { "maxSize": 1000000 } },
      { "name": "project_id", "type": "text", "required": false, "options": { "min": null, "max": null, "pattern": "" } }
    ],
    "indexes": [
      "CREATE UNIQUE INDEX idx_tenants_oid ON pb_tenants (original_id, project_id)",
      "CREATE INDEX idx_tenants_building ON pb_tenants (building_id)",
      "CREATE INDEX idx_tenants_status ON pb_tenants (status)",
      "CREATE INDEX idx_tenants_name ON pb_tenants (name)"
    ],
    "listRule": "", "viewRule": "", "createRule": "", "updateRule": "", "deleteRule": "",
    "options": {}
  });
  Dao(db).saveCollection(tenants);

  // ── 4. pb_payments (收款记录) ──
  const payments = new Collection({
    "name": "pb_payments",
    "type": "base",
    "system": false,
    "schema": [
      { "name": "original_id", "type": "text", "required": true, "options": { "min": null, "max": null, "pattern": "" } },
      { "name": "tenant_id", "type": "text", "required": true, "options": { "min": null, "max": null, "pattern": "" } },
      { "name": "tenant_name", "type": "text", "required": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "name": "amount", "type": "number", "required": true, "options": { "min": null, "max": null, "noDecimal": false } },
      { "name": "type", "type": "select", "required": false, "options": { "maxSelect": 1, "values": ["Rent", "Deposit", "ManagementFee", "ParkingFee", "Other", "DepositToRent", "DepositRefund"] } },
      { "name": "date", "type": "text", "required": true, "options": { "min": null, "max": null, "pattern": "" } },
      { "name": "status", "type": "select", "required": false, "options": { "maxSelect": 1, "values": ["Received", "Pending"] } },
      { "name": "invoice_status", "type": "select", "required": false, "options": { "maxSelect": 1, "values": ["Pending", "Invoiced"] } },
      { "name": "period", "type": "text", "required": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "name": "remarks", "type": "text", "required": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "name": "project_id", "type": "text", "required": false, "options": { "min": null, "max": null, "pattern": "" } }
    ],
    "indexes": [
      "CREATE UNIQUE INDEX idx_payments_oid ON pb_payments (original_id, project_id)",
      "CREATE INDEX idx_payments_tenant ON pb_payments (tenant_id)",
      "CREATE INDEX idx_payments_date ON pb_payments (date)",
      "CREATE INDEX idx_payments_type ON pb_payments (type)"
    ],
    "listRule": "", "viewRule": "", "createRule": "", "updateRule": "", "deleteRule": "",
    "options": {}
  });
  Dao(db).saveCollection(payments);

  // ── 5. pb_invoices (发票记录) ──
  const invoices = new Collection({
    "name": "pb_invoices",
    "type": "base",
    "system": false,
    "schema": [
      { "name": "original_id", "type": "text", "required": true, "options": { "min": null, "max": null, "pattern": "" } },
      { "name": "tenant_id", "type": "text", "required": true, "options": { "min": null, "max": null, "pattern": "" } },
      { "name": "bill_date", "type": "text", "required": true, "options": { "min": null, "max": null, "pattern": "" } },
      { "name": "target_invoice_date", "type": "text", "required": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "name": "amount", "type": "number", "required": true, "options": { "min": null, "max": null, "noDecimal": false } },
      { "name": "status", "type": "select", "required": false, "options": { "maxSelect": 1, "values": ["Pending", "Invoiced"] } },
      { "name": "invoiced_at", "type": "text", "required": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "name": "defer_reason", "type": "text", "required": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "name": "project_id", "type": "text", "required": false, "options": { "min": null, "max": null, "pattern": "" } }
    ],
    "indexes": [
      "CREATE UNIQUE INDEX idx_invoices_oid ON pb_invoices (original_id, project_id)",
      "CREATE INDEX idx_invoices_tenant ON pb_invoices (tenant_id)",
      "CREATE INDEX idx_invoices_status ON pb_invoices (status)"
    ],
    "listRule": "", "viewRule": "", "createRule": "", "updateRule": "", "deleteRule": "",
    "options": {}
  });
  Dao(db).saveCollection(invoices);

  // ── 6. pb_yearly_targets (年度目标) ──
  const yearlyTargets = new Collection({
    "name": "pb_yearly_targets",
    "type": "base",
    "system": false,
    "schema": [
      { "name": "year", "type": "number", "required": true, "options": { "min": 2020, "max": 2050, "noDecimal": true } },
      { "name": "revenue", "type": "number", "required": false, "options": { "min": null, "max": null, "noDecimal": false } },
      { "name": "occupancy", "type": "number", "required": false, "options": { "min": 0, "max": 100, "noDecimal": false } },
      { "name": "project_id", "type": "text", "required": false, "options": { "min": null, "max": null, "pattern": "" } }
    ],
    "indexes": ["CREATE UNIQUE INDEX idx_yearly_targets_year ON pb_yearly_targets (year, project_id)"],
    "listRule": "", "viewRule": "", "createRule": "", "updateRule": "", "deleteRule": "",
    "options": {}
  });
  Dao(db).saveCollection(yearlyTargets);

  // ── 7. pb_monthly_init_data (月度初始化数据) ──
  const monthlyInit = new Collection({
    "name": "pb_monthly_init_data",
    "type": "base",
    "system": false,
    "schema": [
      { "name": "year", "type": "number", "required": true, "options": { "min": 2020, "max": 2050, "noDecimal": true } },
      { "name": "month", "type": "number", "required": true, "options": { "min": 1, "max": 12, "noDecimal": true } },
      { "name": "revenue_target", "type": "number", "required": false, "options": { "min": null, "max": null, "noDecimal": false } },
      { "name": "revenue_collected", "type": "number", "required": false, "options": { "min": null, "max": null, "noDecimal": false } },
      { "name": "occupancy_rate", "type": "number", "required": false, "options": { "min": 0, "max": 100, "noDecimal": false } },
      { "name": "accumulated_arrears", "type": "number", "required": false, "options": { "min": null, "max": null, "noDecimal": false } },
      { "name": "project_id", "type": "text", "required": false, "options": { "min": null, "max": null, "pattern": "" } }
    ],
    "indexes": ["CREATE UNIQUE INDEX idx_monthly_init ON pb_monthly_init_data (year, month, project_id)"],
    "listRule": "", "viewRule": "", "createRule": "", "updateRule": "", "deleteRule": "",
    "options": {}
  });
  Dao(db).saveCollection(monthlyInit);

  // ── 8. pb_budget_assumptions (预算假设) ──
  const budgetAssumptions = new Collection({
    "name": "pb_budget_assumptions",
    "type": "base",
    "system": false,
    "schema": [
      { "name": "original_id", "type": "text", "required": true, "options": { "min": null, "max": null, "pattern": "" } },
      { "name": "target_type", "type": "select", "required": false, "options": { "maxSelect": 1, "values": ["Vacancy", "Renewal", "RiskTermination", "Existing"] } },
      { "name": "target_id", "type": "text", "required": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "name": "target_name", "type": "text", "required": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "name": "strategy", "type": "select", "required": false, "options": { "maxSelect": 1, "values": ["Renewal", "ReLease"] } },
      { "name": "projected_termination_date", "type": "text", "required": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "name": "vacancy_gap_months", "type": "number", "required": false, "options": { "min": null, "max": null, "noDecimal": true } },
      { "name": "projected_sign_date", "type": "text", "required": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "name": "projected_unit_price", "type": "number", "required": false, "options": { "min": null, "max": null, "noDecimal": false } },
      { "name": "projected_rent_free_months", "type": "number", "required": false, "options": { "min": null, "max": null, "noDecimal": true } },
      { "name": "billing_cycle_shift_months", "type": "number", "required": false, "options": { "min": null, "max": null, "noDecimal": true } },
      { "name": "price_adjustment", "type": "json", "required": false, "options": { "maxSize": 200000 } },
      { "name": "payment_shift", "type": "json", "required": false, "options": { "maxSize": 200000 } },
      { "name": "project_id", "type": "text", "required": false, "options": { "min": null, "max": null, "pattern": "" } }
    ],
    "indexes": ["CREATE UNIQUE INDEX idx_ba_oid ON pb_budget_assumptions (original_id, project_id)"],
    "listRule": "", "viewRule": "", "createRule": "", "updateRule": "", "deleteRule": "",
    "options": {}
  });
  Dao(db).saveCollection(budgetAssumptions);

  // ── 9. pb_budget_adjustments (预算调整) ──
  const budgetAdjustments = new Collection({
    "name": "pb_budget_adjustments",
    "type": "base",
    "system": false,
    "schema": [
      { "name": "original_id", "type": "text", "required": true, "options": { "min": null, "max": null, "pattern": "" } },
      { "name": "tenant_id", "type": "text", "required": true, "options": { "min": null, "max": null, "pattern": "" } },
      { "name": "tenant_name", "type": "text", "required": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "name": "original_year", "type": "number", "required": false, "options": { "min": null, "max": null, "noDecimal": true } },
      { "name": "original_month", "type": "number", "required": false, "options": { "min": 0, "max": 11, "noDecimal": true } },
      { "name": "adjusted_year", "type": "number", "required": false, "options": { "min": null, "max": null, "noDecimal": true } },
      { "name": "adjusted_month", "type": "number", "required": false, "options": { "min": 0, "max": 11, "noDecimal": true } },
      { "name": "amount", "type": "number", "required": false, "options": { "min": null, "max": null, "noDecimal": false } },
      { "name": "reason", "type": "text", "required": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "name": "project_id", "type": "text", "required": false, "options": { "min": null, "max": null, "pattern": "" } }
    ],
    "indexes": [
      "CREATE UNIQUE INDEX idx_badj_oid ON pb_budget_adjustments (original_id, project_id)",
      "CREATE INDEX idx_badj_tenant ON pb_budget_adjustments (tenant_id)"
    ],
    "listRule": "", "viewRule": "", "createRule": "", "updateRule": "", "deleteRule": "",
    "options": {}
  });
  Dao(db).saveCollection(budgetAdjustments);

  // ── 10. pb_budget_scenarios (预算方案) ──
  const budgetScenarios = new Collection({
    "name": "pb_budget_scenarios",
    "type": "base",
    "system": false,
    "schema": [
      { "name": "original_id", "type": "text", "required": true, "options": { "min": null, "max": null, "pattern": "" } },
      { "name": "name", "type": "text", "required": true, "options": { "min": null, "max": null, "pattern": "" } },
      { "name": "description", "type": "text", "required": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "name": "scenario_created_at", "type": "text", "required": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "name": "is_active", "type": "bool", "required": false, "options": {} },
      { "name": "assumptions", "type": "json", "required": false, "options": { "maxSize": 2000000 } },
      { "name": "adjustments", "type": "json", "required": false, "options": { "maxSize": 2000000 } },
      { "name": "base_data_snapshot", "type": "json", "required": false, "options": { "maxSize": 5000000 } },
      { "name": "project_id", "type": "text", "required": false, "options": { "min": null, "max": null, "pattern": "" } }
    ],
    "indexes": ["CREATE UNIQUE INDEX idx_bs_oid ON pb_budget_scenarios (original_id, project_id)"],
    "listRule": "", "viewRule": "", "createRule": "", "updateRule": "", "deleteRule": "",
    "options": {}
  });
  Dao(db).saveCollection(budgetScenarios);

}, (db) => {
  const dao = new Dao(db);
  const names = [
    "pb_budget_scenarios", "pb_budget_adjustments", "pb_budget_assumptions",
    "pb_monthly_init_data", "pb_yearly_targets", "pb_invoices",
    "pb_payments", "pb_tenants", "pb_units", "pb_buildings"
  ];
  for (const name of names) {
    try {
      const col = dao.findCollectionByNameOrId(name);
      dao.deleteCollection(col);
    } catch (e) {}
  }
})
