import type {
    BudgetAdjustment,
    BudgetAssumption,
    BudgetScenario,
    Building,
    ContractStatus,
    DashboardData,
    DepositStatus,
    InvoiceRecord,
    MonthlyInitData,
    PaymentRecord,
    PaymentCycle,
    Tenant,
    Unit,
    UnitStatus,
} from '../types';
import type { DirtyPayload } from './dirtyTracker';

type DirtyBucket = DirtyPayload[string];
type Row = Record<string, any>;

const cloneJson = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const hasOwn = (row: Row, key: string): boolean => Object.prototype.hasOwnProperty.call(row, key);
const str = (value: unknown, fallback = ''): string => (value == null ? fallback : String(value));
const num = (value: unknown, fallback = 0): number => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
};
const bool = (value: unknown): boolean => value === true;
const arr = <T = any>(value: unknown): T[] => (Array.isArray(value) ? value as T[] : []);
const originalIdOf = (originalId: string, row: Row): string => str(row.original_id ?? row.id ?? originalId, originalId);

const applyBillingNotesPatch = (
    current: Record<string, unknown>,
    patch: Record<string, unknown>,
): Record<string, unknown> => {
    const next = { ...current };
    for (const [key, value] of Object.entries(patch || {})) {
        if (value === null) delete next[key];
        else next[key] = value;
    }
    return next;
};

const mergeRow = (base: Row, patch: Row): Row => {
    const next = { ...base };
    for (const [key, value] of Object.entries(patch || {})) {
        if (key === 'id') continue;
        if (key === 'notes_json_patch') {
            next.notes_json = applyBillingNotesPatch(next.notes_json || {}, value as Record<string, unknown>);
            continue;
        }
        next[key] = value;
    }
    return next;
};

const applyCollection = <T>(
    currentRows: T[],
    bucket: DirtyBucket | undefined,
    idOf: (item: T) => string,
    applyPatch: (item: T, patch: Row, originalId: string) => T,
    createFromRow: (row: Row, originalId: string) => T,
): T[] => {
    if (!bucket) return currentRows;
    const map = new Map<string, T>();
    for (const item of currentRows) map.set(idOf(item), item);

    for (const created of bucket.creates || []) {
        map.set(created.originalId, createFromRow(created.data as Row, created.originalId));
    }
    for (const updated of bucket.updates || []) {
        const existing = map.get(updated.originalId);
        const patch = updated.changedFields as Row;
        map.set(
            updated.originalId,
            existing
                ? applyPatch(existing, patch, updated.originalId)
                : createFromRow({ original_id: updated.originalId, ...patch }, updated.originalId),
        );
    }
    for (const deleted of bucket.deletes || []) {
        map.delete(deleted.originalId);
    }
    return Array.from(map.values());
};

const unitFromRow = (row: Row, originalId: string): Unit => ({
    id: originalIdOf(originalId, row),
    name: str(row.name),
    area: num(row.area),
    status: (row.status || 'Vacant') as UnitStatus,
    floor: num(row.floor, 1),
    isSelfUse: bool(row.is_self_use),
});

const applyUnitPatch = (unit: Unit, patch: Row, originalId: string): Unit => {
    const row = {
        original_id: unit.id,
        name: unit.name,
        area: unit.area,
        status: unit.status,
        floor: unit.floor,
        is_self_use: !!unit.isSelfUse,
    };
    return unitFromRow(mergeRow(row, patch), originalId);
};

const buildingFromRow = (row: Row, originalId: string, units: Unit[] = []): Building => ({
    id: originalIdOf(originalId, row),
    name: str(row.name),
    type: row.type === 'Site' ? 'Site' : 'Building',
    units,
});

const tenantFromRow = (row: Row, originalId: string): Tenant => ({
    id: originalIdOf(originalId, row),
    rootId: str(row.root_id),
    name: str(row.name),
    sourceAgentName: str(row.source_agent_name),
    contactInfo: str(row.contact_info),
    industry: str(row.industry),
    foundingDate: str(row.founding_date),
    legalRepName: str(row.legal_rep_name),
    legalRepBirthday: str(row.legal_rep_birthday),
    contactName: str(row.contact_name),
    contactBirthday: str(row.contact_birthday),
    buildingId: str(row.building_id),
    unitIds: arr<string>(row.unit_ids),
    totalArea: num(row.total_area),
    signingDate: str(row.signing_date),
    leaseStart: str(row.lease_start),
    leaseEnd: str(row.lease_end),
    moveInDate: str(row.move_in_date),
    unitPrice: num(row.unit_price),
    unitPriceMode: row.unit_price_mode === 'monthly' ? 'monthly' : 'daily',
    monthlyRent: num(row.monthly_rent),
    rentFreePeriods: arr(row.rent_free_periods),
    rentReductions: arr(row.rent_reductions),
    paymentCycle: (row.payment_cycle || 'Monthly') as PaymentCycle,
    unitTerms: arr(row.payment_terms),
    paymentTerms: arr(row.payment_terms),
    paymentCycleMonths: row.payment_cycle_months ?? undefined,
    firstPaymentDate: str(row.first_payment_date),
    firstPaymentMonths: row.first_payment_months ?? undefined,
    firstReceivableAmount: row.first_receivable_amount != null ? num(row.first_receivable_amount) : undefined,
    firstReceivableStartDate: row.first_receivable_start_date || undefined,
    firstReceivableEndDate: row.first_receivable_end_date || undefined,
    freeRentHandling: row.free_rent_handling || undefined,
    depositAmount: num(row.deposit_amount),
    depositStatus: (row.deposit_status || 'Unpaid') as DepositStatus,
    status: (row.status || 'Active') as ContractStatus,
    terminationDate: row.termination_date || undefined,
    terminationType: row.termination_type || undefined,
    terminationReason: str(row.termination_reason),
    earlyTerminationFreeRentClawbackOverride:
        row.early_termination_fr_clawback_override != null ? num(row.early_termination_fr_clawback_override) : undefined,
    earlyTerminationDepositDeduction:
        row.early_termination_deposit_deduction != null ? num(row.early_termination_deposit_deduction) : undefined,
    earlyTerminationOtherAdjustment:
        row.early_termination_other_adjustment != null ? num(row.early_termination_other_adjustment) : undefined,
    paymentPeriodAdjustments: arr(row.payment_period_adjustments),
    paymentPeriodShiftMonths: num(row.payment_period_shift_months),
    specialRequirements: str(row.special_requirements),
    isRisk: bool(row.is_risk),
    isSpecialBusiness: bool(row.is_special_business),
    contractParkingSpaces: num(row.contract_parking_spaces),
    actualParkingSpaces: num(row.actual_parking_spaces),
    parkingUnitPrice: num(row.parking_unit_price),
    keyMoments: arr(row.key_moments),
    nameHistory: arr(row.name_history),
    paymentCycleChanges: arr(row.payment_cycle_changes),
    parentContractId: row.parent_contract_id || undefined,
    managementFeeEnabled: row.management_fee_enabled != null ? !!row.management_fee_enabled : undefined,
    managementFeeExempt: !!row.management_fee_exempt,
    managementFeeFreePeriods: arr(row.management_fee_free_periods),
    managementFeeUnitPrice: row.management_fee_unit_price != null ? num(row.management_fee_unit_price) : undefined,
    managementFeeUnitPriceMode: row.management_fee_unit_price_mode === 'monthly' ? 'monthly' : 'daily',
    managementFeeMonthlyAmount:
        row.management_fee_monthly_amount != null ? num(row.management_fee_monthly_amount) : undefined,
    managementFeeFirstPaymentDate: row.management_fee_first_payment_date || undefined,
    managementFeeStartWithOccupancy:
        row.management_fee_start_with_occupancy != null ? !!row.management_fee_start_with_occupancy : undefined,
    managementFeeStartDate: row.management_fee_start_date || undefined,
    projectId: str(row.project_id),
});

const tenantToRow = (tenant: Tenant): Row => ({
    original_id: tenant.id,
    root_id: tenant.rootId || '',
    name: tenant.name,
    source_agent_name: tenant.sourceAgentName || '',
    contact_info: tenant.contactInfo || '',
    industry: tenant.industry || '',
    founding_date: tenant.foundingDate || '',
    legal_rep_name: tenant.legalRepName || '',
    legal_rep_birthday: tenant.legalRepBirthday || '',
    contact_name: tenant.contactName || '',
    contact_birthday: tenant.contactBirthday || '',
    building_id: tenant.buildingId,
    unit_ids: tenant.unitIds || [],
    total_area: tenant.totalArea || 0,
    signing_date: tenant.signingDate || '',
    lease_start: tenant.leaseStart,
    lease_end: tenant.leaseEnd,
    move_in_date: tenant.moveInDate || '',
    unit_price: tenant.unitPrice || 0,
    unit_price_mode: tenant.unitPriceMode || 'daily',
    monthly_rent: tenant.monthlyRent || 0,
    rent_free_periods: tenant.rentFreePeriods || [],
    rent_reductions: tenant.rentReductions || [],
    payment_cycle: tenant.paymentCycle || 'Monthly',
    payment_terms: Array.isArray(tenant.unitTerms) ? tenant.unitTerms : (tenant.paymentTerms || []),
    payment_cycle_months: tenant.paymentCycleMonths ?? null,
    first_payment_date: tenant.firstPaymentDate || '',
    first_payment_months: tenant.firstPaymentMonths ?? null,
    first_receivable_amount: tenant.firstReceivableAmount ?? null,
    first_receivable_start_date: tenant.firstReceivableStartDate || '',
    first_receivable_end_date: tenant.firstReceivableEndDate || '',
    free_rent_handling: tenant.freeRentHandling || null,
    deposit_amount: tenant.depositAmount || 0,
    deposit_status: tenant.depositStatus || 'Unpaid',
    status: tenant.status || 'Active',
    termination_date: tenant.terminationDate || '',
    termination_type: tenant.terminationType || null,
    termination_reason: tenant.terminationReason || '',
    parent_contract_id: tenant.parentContractId || '',
    early_termination_fr_clawback_override: tenant.earlyTerminationFreeRentClawbackOverride ?? null,
    early_termination_deposit_deduction: tenant.earlyTerminationDepositDeduction ?? null,
    early_termination_other_adjustment: tenant.earlyTerminationOtherAdjustment ?? null,
    payment_period_adjustments: tenant.paymentPeriodAdjustments || [],
    payment_period_shift_months: tenant.paymentPeriodShiftMonths ?? 0,
    special_requirements: tenant.specialRequirements || '',
    is_risk: !!tenant.isRisk,
    is_special_business: !!tenant.isSpecialBusiness,
    contract_parking_spaces: tenant.contractParkingSpaces ?? tenant.parkingSpaces ?? 0,
    actual_parking_spaces: tenant.actualParkingSpaces ?? tenant.parkingSpaces ?? 0,
    parking_unit_price: tenant.parkingUnitPrice || 0,
    key_moments: tenant.keyMoments || [],
    name_history: tenant.nameHistory || [],
    payment_cycle_changes: tenant.paymentCycleChanges || [],
    management_fee_enabled: tenant.managementFeeEnabled ?? null,
    management_fee_exempt: tenant.managementFeeExempt ?? null,
    management_fee_free_periods: tenant.managementFeeFreePeriods || [],
    management_fee_unit_price: tenant.managementFeeUnitPrice ?? null,
    management_fee_unit_price_mode: tenant.managementFeeUnitPriceMode || 'daily',
    management_fee_monthly_amount: tenant.managementFeeMonthlyAmount ?? null,
    management_fee_first_payment_date: tenant.managementFeeFirstPaymentDate || '',
    management_fee_start_with_occupancy: tenant.managementFeeStartWithOccupancy ?? null,
    management_fee_start_date: tenant.managementFeeStartDate || '',
    project_id: tenant.projectId || '',
});

const paymentFromRow = (row: Row, originalId: string): PaymentRecord => ({
    id: originalIdOf(originalId, row),
    tenantId: str(row.tenant_id),
    tenantName: str(row.tenant_name),
    amount: num(row.amount),
    type: (row.type || 'Rent') as PaymentRecord['type'],
    date: str(row.date),
    status: (row.status || 'Pending') as PaymentRecord['status'],
    invoiceStatus: row.invoice_status || undefined,
    period: str(row.period),
    remarks: str(row.remarks),
});

const paymentToRow = (payment: PaymentRecord): Row => ({
    original_id: payment.id,
    tenant_id: payment.tenantId,
    tenant_name: payment.tenantName || '',
    amount: payment.amount || 0,
    type: payment.type || 'Rent',
    date: payment.date,
    status: payment.status || 'Pending',
    invoice_status: payment.invoiceStatus || null,
    period: payment.period || '',
    remarks: payment.remarks || '',
});

const invoiceFromRow = (row: Row, originalId: string): InvoiceRecord => ({
    id: originalIdOf(originalId, row),
    tenantId: str(row.tenant_id),
    billDate: str(row.bill_date),
    targetInvoiceDate: str(row.target_invoice_date),
    amount: num(row.amount),
    status: (row.status || 'Pending') as InvoiceRecord['status'],
    invoicedAt: row.invoiced_at || undefined,
    deferReason: str(row.defer_reason),
});

const invoiceToRow = (invoice: InvoiceRecord): Row => ({
    original_id: invoice.id,
    tenant_id: invoice.tenantId,
    bill_date: invoice.billDate,
    target_invoice_date: invoice.targetInvoiceDate || '',
    amount: invoice.amount || 0,
    status: invoice.status || 'Pending',
    invoiced_at: invoice.invoicedAt || '',
    defer_reason: invoice.deferReason || '',
});

const monthlyInitFromRow = (row: Row): MonthlyInitData => ({
    year: num(row.year),
    month: num(row.month),
    revenueTarget: num(row.revenue_target),
    revenueCollected: num(row.revenue_collected),
    occupancyRate: num(row.occupancy_rate),
    accumulatedArrears: num(row.accumulated_arrears),
    initialBudget: row.initial_budget ?? 0,
});

const budgetAssumptionFromRow = (row: Row, originalId: string): BudgetAssumption => ({
    id: originalIdOf(originalId, row),
    targetType: (row.target_type || 'Vacancy') as BudgetAssumption['targetType'],
    targetId: str(row.target_id),
    targetName: str(row.target_name),
    strategy: row.strategy || undefined,
    projectedTerminationDate: str(row.projected_termination_date),
    vacancyGapMonths: row.vacancy_gap_months ?? undefined,
    projectedSignDate: str(row.projected_sign_date),
    projectedUnitPrice: num(row.projected_unit_price),
    projectedRentFreeMonths: num(row.projected_rent_free_months),
    billingCycleShiftMonths: row.billing_cycle_shift_months ?? undefined,
    priceAdjustment: row.price_adjustment || undefined,
    paymentShift: row.payment_shift || undefined,
});

const budgetAdjustmentFromRow = (row: Row, originalId: string): BudgetAdjustment => {
    const isAmountDelta = row.adjustment_kind === 'amount_delta' || (row.original_year == null && row.original_month == null);
    return {
        id: originalIdOf(originalId, row),
        tenantId: str(row.tenant_id),
        tenantName: str(row.tenant_name),
        originalYear: isAmountDelta ? -1 : num(row.original_year),
        originalMonth: isAmountDelta ? -1 : num(row.original_month),
        adjustedYear: num(row.adjusted_year),
        adjustedMonth: num(row.adjusted_month),
        amount: num(row.amount),
        reason: str(row.reason),
        adjustmentKind: row.adjustment_kind || undefined,
    };
};

const budgetScenarioFromRow = (row: Row, originalId: string): BudgetScenario => ({
    id: originalIdOf(originalId, row),
    name: str(row.name),
    budgetYear: num(row.budget_year, new Date().getFullYear()),
    description: str(row.description),
    createdAt: str(row.scenario_created_at),
    isActive: bool(row.is_active),
    assumptions: arr(row.assumptions),
    adjustments: arr(row.adjustments),
    baseDataSnapshot: row.base_data_snapshot || undefined,
});

const applyBuildingAndUnitPayload = (draft: DashboardData, payload: DirtyPayload): void => {
    if (!payload.pb_buildings && !payload.pb_units) return;

    const buildingRows = new Map<string, Row>();
    const unitRows = new Map<string, Row>();
    for (const building of draft.buildings || []) {
        buildingRows.set(building.id, {
            original_id: building.id,
            name: building.name,
            type: building.type || 'Building',
        });
        for (const unit of building.units || []) {
            unitRows.set(unit.id, {
                original_id: unit.id,
                building_id: building.id,
                name: unit.name,
                area: unit.area || 0,
                status: unit.status || 'Vacant',
                floor: unit.floor || 1,
                is_self_use: !!unit.isSelfUse,
            });
        }
    }

    const applyRows = (rows: Map<string, Row>, bucket: DirtyBucket | undefined) => {
        if (!bucket) return;
        for (const created of bucket.creates || []) rows.set(created.originalId, { ...created.data, original_id: created.originalId });
        for (const updated of bucket.updates || []) {
            const existing = rows.get(updated.originalId) || { original_id: updated.originalId };
            rows.set(updated.originalId, mergeRow(existing, updated.changedFields as Row));
        }
        for (const deleted of bucket.deletes || []) rows.delete(deleted.originalId);
    };

    applyRows(buildingRows, payload.pb_buildings);
    applyRows(unitRows, payload.pb_units);

    const unitsByBuilding = new Map<string, Unit[]>();
    for (const row of unitRows.values()) {
        const buildingId = str(row.building_id);
        if (!buildingId) continue;
        const list = unitsByBuilding.get(buildingId) || [];
        list.push(unitFromRow(row, str(row.original_id)));
        unitsByBuilding.set(buildingId, list);
    }
    draft.buildings = Array.from(buildingRows.values()).map((row) =>
        buildingFromRow(row, str(row.original_id), unitsByBuilding.get(str(row.original_id)) || []),
    );
};

export function applyDirtyPayloadToDashboardData(
    baselineData: DashboardData,
    payload: DirtyPayload,
): DashboardData {
    const draft = cloneJson(baselineData);

    applyBuildingAndUnitPayload(draft, payload);

    draft.tenants = applyCollection(
        draft.tenants || [],
        payload.pb_tenants,
        (item) => item.id,
        (item, patch, originalId) => tenantFromRow(mergeRow(tenantToRow(item), patch), originalId),
        tenantFromRow,
    );

    draft.payments = applyCollection(
        draft.payments || [],
        payload.pb_payments,
        (item) => item.id,
        (item, patch, originalId) => paymentFromRow(mergeRow(paymentToRow(item), patch), originalId),
        paymentFromRow,
    );

    draft.invoices = applyCollection(
        draft.invoices || [],
        payload.pb_invoices,
        (item) => item.id,
        (item, patch, originalId) => invoiceFromRow(mergeRow(invoiceToRow(item), patch), originalId),
        invoiceFromRow,
    );

    if (payload.pb_yearly_targets) {
        const targets = { ...(draft.yearlyTargets || {}) };
        for (const created of payload.pb_yearly_targets.creates || []) {
            targets[num((created.data as Row).year, Number(created.originalId))] = {
                revenue: num((created.data as Row).revenue),
                occupancy: num((created.data as Row).occupancy),
                initialBudget: (created.data as Row).initial_budget ?? 0,
            };
        }
        for (const updated of payload.pb_yearly_targets.updates || []) {
            const year = Number(updated.originalId);
            const current = targets[year] || { revenue: 0, occupancy: 0, initialBudget: 0 };
            const patch = updated.changedFields as Row;
            targets[year] = {
                revenue: hasOwn(patch, 'revenue') ? num(patch.revenue) : current.revenue,
                occupancy: hasOwn(patch, 'occupancy') ? num(patch.occupancy) : current.occupancy,
                initialBudget: hasOwn(patch, 'initial_budget') ? patch.initial_budget ?? 0 : current.initialBudget,
            };
        }
        for (const deleted of payload.pb_yearly_targets.deletes || []) delete targets[Number(deleted.originalId)];
        draft.yearlyTargets = targets;
    }

    draft.initializationData = applyCollection(
        draft.initializationData || [],
        payload.pb_monthly_init_data,
        (item) => `${item.year}_${item.month}`,
        (item, patch) => monthlyInitFromRow(mergeRow({
            year: item.year,
            month: item.month,
            revenue_target: item.revenueTarget,
            revenue_collected: item.revenueCollected,
            occupancy_rate: item.occupancyRate,
            accumulated_arrears: item.accumulatedArrears || 0,
            initial_budget: item.initialBudget ?? 0,
        }, patch)),
        (row, originalId) => {
            const [year, month] = originalId.split('_').map(Number);
            return monthlyInitFromRow({ year, month, ...row });
        },
    );

    draft.budgetAssumptions = applyCollection(
        draft.budgetAssumptions || [],
        payload.pb_budget_assumptions,
        (item) => item.id,
        (item, patch, originalId) => budgetAssumptionFromRow(mergeRow({
            original_id: item.id,
            target_type: item.targetType,
            target_id: item.targetId,
            target_name: item.targetName,
            strategy: item.strategy || null,
            projected_termination_date: item.projectedTerminationDate || '',
            vacancy_gap_months: item.vacancyGapMonths ?? null,
            projected_sign_date: item.projectedSignDate || '',
            projected_unit_price: item.projectedUnitPrice || 0,
            projected_rent_free_months: item.projectedRentFreeMonths || 0,
            billing_cycle_shift_months: item.billingCycleShiftMonths ?? null,
            price_adjustment: item.priceAdjustment || null,
            payment_shift: item.paymentShift || null,
        }, patch), originalId),
        budgetAssumptionFromRow,
    );

    draft.budgetAdjustments = applyCollection(
        draft.budgetAdjustments || [],
        payload.pb_budget_adjustments,
        (item) => item.id,
        (item, patch, originalId) => budgetAdjustmentFromRow(mergeRow({
            original_id: item.id,
            tenant_id: item.tenantId,
            tenant_name: item.tenantName,
            original_year: item.adjustmentKind === 'amount_delta' ? null : item.originalYear,
            original_month: item.adjustmentKind === 'amount_delta' ? null : item.originalMonth,
            adjusted_year: item.adjustedYear,
            adjusted_month: item.adjustedMonth,
            amount: item.amount,
            reason: item.reason,
            adjustment_kind: item.adjustmentKind || 'period_shift',
        }, patch), originalId),
        budgetAdjustmentFromRow,
    );

    draft.budgetScenarios = applyCollection(
        draft.budgetScenarios || [],
        payload.pb_budget_scenarios,
        (item) => item.id,
        (item, patch, originalId) => budgetScenarioFromRow(mergeRow({
            original_id: item.id,
            name: item.name,
            budget_year: item.budgetYear,
            description: item.description || '',
            scenario_created_at: item.createdAt,
            is_active: !!item.isActive,
            assumptions: item.assumptions || [],
            adjustments: item.adjustments || [],
            base_data_snapshot: item.baseDataSnapshot || null,
        }, patch), originalId),
        budgetScenarioFromRow,
    );

    if (payload.pb_billing_period_notes) {
        let notes = { ...(draft.billingPeriodNotes || {}) };
        const bucket = payload.pb_billing_period_notes;
        for (const created of bucket.creates || []) {
            notes = { ...((created.data as Row).notes_json || {}) };
        }
        for (const updated of bucket.updates || []) {
            const patch = updated.changedFields as Row;
            if (patch.notes_json_patch) notes = applyBillingNotesPatch(notes, patch.notes_json_patch as Record<string, unknown>) as Record<string, string>;
            else if (patch.notes_json) notes = { ...(patch.notes_json as Record<string, string>) };
        }
        for (const deleted of bucket.deletes || []) {
            if (deleted.originalId === 'billing_period_notes') notes = {};
        }
        draft.billingPeriodNotes = notes as Record<string, string>;
    }

    return draft;
}
