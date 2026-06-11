/**
 * services/dataDiff.ts —— DashboardData → PocketBase 行级 diff
 *
 * 目的：让 App.tsx 在保存时**不依赖各业务组件主动登记 dirty**，
 * 而是用「上次从云端加载的快照」与「当前界面 data」做行级 diff，
 * 自动推导出 DirtyPayload（creates/updates/deletes），
 * 这样能立刻享受到「行级乐观锁 + 字段级合并」，无需逐组件改造。
 *
 * 工作流程：
 *   1. 加载/刷新云端数据后，调用 dashboardDataToPbRecords(data, projectId)
 *      生成 PbRecordMap 作为 baseline 快照（与 recordMeta 一同保存）
 *   2. 用户编辑过程中只更新 React state，不触碰 dirtyTracker
 *   3. 点保存时，再次调用 dashboardDataToPbRecords 生成 newMap
 *   4. diffPbRecords(baselineMap, newMap, recordMeta) → DirtyPayload
 *   5. 提交给 saveIncrementalToCloud
 *   6. 成功后 baseline = newMap（实际推荐重新 fetchCloudBackup 拿最权威的 recordMeta）
 *
 * 重要约定：
 *   - 字段映射与 services/pocketbaseService.ts 中 saveToPocketBase 完全一致，
 *     是可重复（pure）函数，输入相同必输出相同（保证 diff 不会假性变化）
 *   - 对 yearly_targets / monthly_init_data 这类无 original_id 字段的集合，
 *     使用合成 key：year / `${year}_${month}`
 *   - billing_period_notes 是单条 JSON 大对象，作为单条 update 处理
 */

import type { DashboardData } from '../types';
import type { DirtyPayload } from './dirtyTracker';
import type { RecordMeta } from './pocketbaseService';

/** 一个集合内的 record map：key=originalId（或合成 key），value=完整字段 */
export type PbRecordMap = Record<string, Record<string, Record<string, any>>>;

const ensureArray = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

/** 判等：忽略字段顺序，递归比较对象/数组 */
const deepEqual = (a: unknown, b: unknown): boolean => {
    if (a === b) return true;
    if (a === null || b === null || a === undefined || b === undefined) return a === b;
    if (typeof a !== typeof b) return false;
    if (typeof a !== 'object') return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i += 1) {
            if (!deepEqual(a[i], b[i])) return false;
        }
        return true;
    }
    const ka = Object.keys(a as Record<string, unknown>).sort();
    const kb = Object.keys(b as Record<string, unknown>).sort();
    if (ka.length !== kb.length) return false;
    for (let i = 0; i < ka.length; i += 1) {
        if (ka[i] !== kb[i]) return false;
        if (!deepEqual((a as any)[ka[i]], (b as any)[kb[i]])) return false;
    }
    return true;
};

// 这些字段在 diff 时不参与比较（它们是路由/标识字段，不是业务可改字段）
const NON_DIFF_FIELDS = new Set(['project_id', 'original_id']);

/**
 * 把 DashboardData 转换为「按集合分组的 PB record map」。
 * 字段映射严格对齐 saveToPocketBase 中的 mapping。
 */
export function dashboardDataToPbRecords(
    data: DashboardData,
    projectId: string
): PbRecordMap {
    const out: PbRecordMap = {
        pb_buildings: {},
        pb_units: {},
        pb_tenants: {},
        pb_payments: {},
        pb_invoices: {},
        pb_yearly_targets: {},
        pb_monthly_init_data: {},
        pb_budget_assumptions: {},
        pb_budget_adjustments: {},
        pb_budget_scenarios: {},
        pb_billing_period_notes: {},
    };

    // ---- buildings + units ----
    const buildings = ensureArray<any>(data.buildings);
    for (const b of buildings) {
        if (!b?.id) continue;
        out.pb_buildings[b.id] = {
            original_id: b.id,
            name: b.name,
            type: b.type || 'Building',
            project_id: projectId,
        };
        for (const u of ensureArray<any>(b.units)) {
            if (!u?.id) continue;
            out.pb_units[u.id] = {
                original_id: u.id,
                building_id: b.id,
                name: u.name,
                area: u.area || 0,
                status: u.status || 'Vacant',
                floor: u.floor || 1,
                is_self_use: !!u.isSelfUse,
                project_id: projectId,
            };
        }
    }

    // ---- tenants ----
    for (const t of ensureArray<any>(data.tenants)) {
        if (!t?.id) continue;
        out.pb_tenants[t.id] = {
            original_id: t.id,
            root_id: t.rootId || '',
            name: t.name,
            source_agent_name: t.sourceAgentName || '',
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
            unit_price_mode: t.unitPriceMode || 'daily',
            monthly_rent: t.monthlyRent || 0,
            rent_free_periods: t.rentFreePeriods || [],
            rent_reductions: t.rentReductions || [],
            payment_cycle: t.paymentCycle || 'Monthly',
            payment_terms: Array.isArray(t.unitTerms) ? t.unitTerms : (Array.isArray(t.paymentTerms) ? t.paymentTerms : []),
            payment_cycle_months: t.paymentCycleMonths ?? null,
            first_payment_date: t.firstPaymentDate || '',
            first_payment_months: t.firstPaymentMonths ?? null,
            first_receivable_amount: t.firstReceivableAmount ?? null,
            first_receivable_start_date: t.firstReceivableStartDate || '',
            first_receivable_end_date: t.firstReceivableEndDate || '',
            free_rent_handling: t.freeRentHandling || null,
            deposit_amount: t.depositAmount || 0,
            deposit_status: t.depositStatus || 'Unpaid',
            status: t.status || 'Active',
            termination_date: t.terminationDate || '',
            termination_type: t.terminationType || null,
            termination_reason: t.terminationReason || '',
            early_termination_fr_clawback_override: t.earlyTerminationFreeRentClawbackOverride ?? null,
            early_termination_deposit_deduction: t.earlyTerminationDepositDeduction ?? null,
            early_termination_other_adjustment: t.earlyTerminationOtherAdjustment ?? null,
            special_requirements: t.specialRequirements || '',
            is_risk: !!t.isRisk,
            is_special_business: !!t.isSpecialBusiness,
            contract_parking_spaces: t.contractParkingSpaces ?? t.parkingSpaces ?? 0,
            actual_parking_spaces: t.actualParkingSpaces ?? t.parkingSpaces ?? 0,
            parking_unit_price: t.parkingUnitPrice || 0,
            key_moments: t.keyMoments || [],
            // 历史/审计：客户改名记录、付款周期变更记录
            name_history: t.nameHistory || [],
            payment_cycle_changes: t.paymentCycleChanges || [],
            // 合同级账期调整 —— 单月微调记录 + 整体平移（合同卡片 ◀▶ 写入的字段）。
            // 缺失这两项时，diffPbRecords 对账期平移无任何变更可报，导致保存后刷新回退。
            payment_period_adjustments: t.paymentPeriodAdjustments || [],
            payment_period_shift_months: t.paymentPeriodShiftMonths ?? 0,
            project_id: projectId,
        };
    }

    // ---- payments ----
    for (const p of ensureArray<any>(data.payments)) {
        if (!p?.id) continue;
        out.pb_payments[p.id] = {
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
        };
    }

    // ---- invoices ----
    for (const inv of ensureArray<any>(data.invoices)) {
        if (!inv?.id) continue;
        out.pb_invoices[inv.id] = {
            original_id: inv.id,
            tenant_id: inv.tenantId,
            bill_date: inv.billDate,
            target_invoice_date: inv.targetInvoiceDate || '',
            amount: inv.amount || 0,
            status: inv.status || 'Pending',
            invoiced_at: inv.invoicedAt || '',
            defer_reason: inv.deferReason || '',
            project_id: projectId,
        };
    }

    // ---- yearlyTargets（合成 key = year） ----
    for (const [yearStr, targets] of Object.entries(data.yearlyTargets || {})) {
        const yearKey = String(yearStr);
        out.pb_yearly_targets[yearKey] = {
            year: Number(yearStr),
            revenue: (targets as any)?.revenue || 0,
            occupancy: (targets as any)?.occupancy || 0,
            initial_budget: (targets as any)?.initialBudget ?? 0,
            project_id: projectId,
        };
    }

    // ---- monthlyInitData（合成 key = year_month） ----
    for (const d of ensureArray<any>(data.initializationData)) {
        if (d?.year === undefined || d?.month === undefined) continue;
        const key = `${d.year}_${d.month}`;
        out.pb_monthly_init_data[key] = {
            year: d.year,
            month: d.month,
            revenue_target: d.revenueTarget || 0,
            revenue_collected: d.revenueCollected || 0,
            occupancy_rate: d.occupancyRate || 0,
            accumulated_arrears: d.accumulatedArrears || 0,
            initial_budget: d.initialBudget ?? 0,
            project_id: projectId,
        };
    }

    // ---- budgetAssumptions ----
    for (const a of ensureArray<any>(data.budgetAssumptions)) {
        if (!a?.id) continue;
        out.pb_budget_assumptions[a.id] = {
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
        };
    }

    // ---- budgetAdjustments ----
    // amount_delta 在业务层用 originalYear/Month = -1 标记；PocketBase 的 original_month 约束为 0–11，-1 会 400，故落库用 null。
    for (const a of ensureArray<any>(data.budgetAdjustments)) {
        if (!a?.id) continue;
        const isAmountDelta =
            a.adjustmentKind === 'amount_delta' ||
            (a.originalYear === -1 && a.originalMonth === -1);
        out.pb_budget_adjustments[a.id] = {
            original_id: a.id,
            tenant_id: a.tenantId,
            tenant_name: a.tenantName || '',
            original_year: isAmountDelta ? null : a.originalYear,
            original_month: isAmountDelta ? null : a.originalMonth,
            adjusted_year: a.adjustedYear,
            adjusted_month: a.adjustedMonth,
            amount: a.amount || 0,
            reason: a.reason || '',
            adjustment_kind: isAmountDelta ? 'amount_delta' : a.adjustmentKind || 'period_shift',
            project_id: projectId,
        };
    }

    // ---- budgetScenarios ----
    for (const s of ensureArray<any>(data.budgetScenarios)) {
        if (!s?.id) continue;
        out.pb_budget_scenarios[s.id] = {
            original_id: s.id,
            name: s.name,
            budget_year: s.budgetYear ?? new Date().getFullYear(),
            description: s.description || '',
            scenario_created_at: s.createdAt || '',
            is_active: !!s.isActive,
            assumptions: s.assumptions || [],
            adjustments: s.adjustments || [],
            base_data_snapshot: s.baseDataSnapshot || null,
            project_id: projectId,
        };
    }

    // ---- billing_period_notes（单条 JSON）----
    out.pb_billing_period_notes['billing_period_notes'] = {
        original_id: 'billing_period_notes',
        notes_json: data.billingPeriodNotes || {},
        project_id: projectId,
    };

    return out;
}

/**
 * 把 baseline 与 next 两个 PbRecordMap 做行级 diff，输出 DirtyPayload。
 *
 * - 在 next 不在 baseline → create
 * - 在 baseline 不在 next → delete
 * - 都在但字段不同 → update（changedFields 仅包含真正不同的字段）
 *
 * baseUpdated 从 recordMeta 读取，既可作为乐观锁基准、也可在 PB 端用合成 key 定位。
 */
export function diffPbRecords(
    baseline: PbRecordMap,
    next: PbRecordMap,
    recordMeta: RecordMeta
): DirtyPayload {
    const payload: DirtyPayload = {};
    const collections = new Set<string>([
        ...Object.keys(baseline),
        ...Object.keys(next),
    ]);

    for (const collection of collections) {
        const oldRows = baseline[collection] || {};
        const newRows = next[collection] || {};
        const ids = new Set<string>([
            ...Object.keys(oldRows),
            ...Object.keys(newRows),
        ]);

        const creates: DirtyPayload[string]['creates'] = [];
        const updates: DirtyPayload[string]['updates'] = [];
        const deletes: DirtyPayload[string]['deletes'] = [];

        for (const id of ids) {
            const o = oldRows[id];
            const n = newRows[id];
            const baseUpdated = recordMeta?.[collection]?.[id] || '';

            if (o && !n) {
                deletes.push({ originalId: id, baseUpdated });
                continue;
            }
            if (!o && n) {
                // create 需要把业务主键也带上（DirtyTracker.markCreate 会要求 record.id）
                creates.push({
                    originalId: id,
                    data: { id, ...n },
                });
                continue;
            }
            if (o && n) {
                const changed: Record<string, any> = {};
                for (const k of Object.keys(n)) {
                    if (NON_DIFF_FIELDS.has(k)) continue;
                    if (!deepEqual(o[k], n[k])) {
                        changed[k] = n[k];
                    }
                }
                // 也要检查 baseline 里有但 next 里被去掉的字段（兜底，正常不会发生）
                for (const k of Object.keys(o)) {
                    if (NON_DIFF_FIELDS.has(k)) continue;
                    if (!(k in n) && o[k] !== undefined) {
                        // 缺失字段：保守处理为 null
                        changed[k] = null;
                    }
                }
                if (Object.keys(changed).length > 0) {
                    // billing_period_notes 的 notes_json 含缓缴/特殊业态/手工应收等多类键，
                    // 按顶层 key 打补丁，避免整包覆盖导致并发或部分失败时丢失其它键。
                    if (
                        collection === 'pb_billing_period_notes' &&
                        id === 'billing_period_notes' &&
                        changed.notes_json !== undefined
                    ) {
                        const oldNotes = (o.notes_json || {}) as Record<string, unknown>;
                        const newNotes = (n.notes_json || {}) as Record<string, unknown>;
                        const patch: Record<string, unknown> = {};
                        for (const key of new Set([
                            ...Object.keys(oldNotes),
                            ...Object.keys(newNotes),
                        ])) {
                            if (!deepEqual(oldNotes[key], newNotes[key])) {
                                patch[key] = Object.prototype.hasOwnProperty.call(newNotes, key)
                                    ? newNotes[key]
                                    : null;
                            }
                        }
                        delete changed.notes_json;
                        if (Object.keys(patch).length > 0) {
                            changed.notes_json_patch = patch;
                        }
                    }
                    if (Object.keys(changed).length > 0) {
                        updates.push({
                            originalId: id,
                            changedFields: changed,
                            baseUpdated,
                        });
                    }
                }
            }
        }

        if (creates.length || updates.length || deletes.length) {
            payload[collection] = { creates, updates, deletes };
        }
    }

    return payload;
}

/** 浅统计：方便日志/调试输出 */
export function payloadCount(payload: DirtyPayload): {
    creates: number;
    updates: number;
    deletes: number;
    total: number;
} {
    let c = 0;
    let u = 0;
    let d = 0;
    for (const bucket of Object.values(payload)) {
        c += bucket.creates.length;
        u += bucket.updates.length;
        d += bucket.deletes.length;
    }
    return { creates: c, updates: u, deletes: d, total: c + u + d };
}
