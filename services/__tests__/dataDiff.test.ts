import { describe, it, expect } from 'vitest';
import {
    dashboardDataToPbRecords,
    diffPbRecords,
    diffPbRecordsScoped,
    payloadCount,
} from '../dataDiff';
import type { DashboardData } from '../../types';

const baseData = (): DashboardData => ({
    buildings: [
        {
            id: 'b1',
            name: 'A 楼',
            type: 'Building',
            units: [
                { id: 'u1', name: '101', area: 100, status: 'Vacant', floor: 1, isSelfUse: false },
            ],
        },
    ],
    tenants: [
        {
            id: 't1',
            name: '张三',
            buildingId: 'b1',
            unitIds: ['u1'],
            totalArea: 100,
            leaseStart: '2026-01-01',
            leaseEnd: '2027-01-01',
            unitPrice: 5,
            monthlyRent: 5000,
            paymentCycle: 'Monthly',
            depositAmount: 5000,
            depositStatus: 'Paid',
            status: 'Active',
        },
        {
            id: 't2',
            name: '李四',
            buildingId: 'b1',
            unitIds: [],
            totalArea: 0,
            leaseStart: '2026-01-01',
            leaseEnd: '2027-01-01',
            monthlyRent: 8000,
            paymentCycle: 'Monthly',
            depositAmount: 0,
            depositStatus: 'Unpaid',
            status: 'Active',
        },
    ],
    payments: [],
    invoices: [],
    yearlyTargets: { 2026: { revenue: 1000000, occupancy: 80 } },
    initializationData: [],
    budgetAssumptions: [],
    budgetAdjustments: [],
    budgetScenarios: [],
    billingPeriodNotes: {},
} as unknown as DashboardData);

const baseMeta = () => ({
    pb_tenants: { t1: '2026-04-21T10:00:00.000Z', t2: '2026-04-21T10:00:00.000Z' },
    pb_buildings: { b1: '2026-04-21T10:00:00.000Z' },
    pb_units: { u1: '2026-04-21T10:00:00.000Z' },
    pb_yearly_targets: { '2026': '2026-04-21T10:00:00.000Z' },
    pb_billing_period_notes: { billing_period_notes: '2026-04-21T10:00:00.000Z' },
});

describe('dataDiff', () => {
    it('未改动时 diff 结果为空', () => {
        const baseline = dashboardDataToPbRecords(baseData(), 'p1');
        const next = dashboardDataToPbRecords(baseData(), 'p1');
        const payload = diffPbRecords(baseline, next, baseMeta());
        expect(payloadCount(payload).total).toBe(0);
    });

    it('按年窗口保存时，同窗口 baseline 不会把窗口外收款/发票判为删除', () => {
        const full = baseData();
        full.payments = [
            { id: 'pay2025', tenantId: 't1', tenantName: '张三', amount: 1000, type: 'Rent', date: '2025-12-20', status: 'Paid', period: '2025-12' },
            { id: 'pay2026', tenantId: 't1', tenantName: '张三', amount: 1000, type: 'Rent', date: '2026-01-20', status: 'Paid', period: '2026-01' },
        ] as any;
        full.invoices = [
            { id: 'inv2025', tenantId: 't1', amount: 1000, billDate: '2025-12-01', status: 'Invoiced', invoicedAt: '2025-12-05' },
            { id: 'inv2026', tenantId: 't1', amount: 1000, billDate: '2026-01-01', status: 'Pending' },
        ] as any;

        const windowed = {
            ...full,
            payments: (full.payments || []).filter((p: any) => p.date.startsWith('2026-')),
            invoices: (full.invoices || []).filter((inv: any) => inv.billDate.startsWith('2026-')),
        } as DashboardData;
        const meta = {
            ...baseMeta(),
            pb_payments: {
                pay2025: '2026-04-21T10:00:00.000Z',
                pay2026: '2026-04-21T10:00:00.000Z',
            },
            pb_invoices: {
                inv2025: '2026-04-21T10:00:00.000Z',
                inv2026: '2026-04-21T10:00:00.000Z',
            },
        };

        const windowedBaseline = dashboardDataToPbRecords(windowed, 'p1');
        const payload = diffPbRecords(windowedBaseline, dashboardDataToPbRecords(windowed, 'p1'), meta);
        expect(payloadCount(payload).total).toBe(0);

        const fullBaseline = dashboardDataToPbRecords(full, 'p1');
        const mismatchedPayload = diffPbRecords(fullBaseline, dashboardDataToPbRecords(windowed, 'p1'), meta);
        expect(mismatchedPayload.pb_payments.deletes.map((d) => d.originalId)).toEqual(['pay2025']);
        expect(mismatchedPayload.pb_invoices.deletes.map((d) => d.originalId)).toEqual(['inv2025']);
    });

    it('修改张三的 monthly_rent → 只产生一条 update，且 changedFields 只含 monthly_rent', () => {
        const baseline = dashboardDataToPbRecords(baseData(), 'p1');
        const modified = baseData();
        (modified.tenants as any)[0].monthlyRent = 9999;
        const next = dashboardDataToPbRecords(modified, 'p1');

        const payload = diffPbRecords(baseline, next, baseMeta());
        expect(payload.pb_tenants.creates).toHaveLength(0);
        expect(payload.pb_tenants.deletes).toHaveLength(0);
        expect(payload.pb_tenants.updates).toHaveLength(1);
        expect(payload.pb_tenants.updates[0]).toMatchObject({
            originalId: 't1',
            changedFields: { monthly_rent: 9999 },
            baseUpdated: '2026-04-21T10:00:00.000Z',
        });
        // 没有其它 collection 被波及
        expect(payload.pb_buildings).toBeUndefined();
        expect(payload.pb_units).toBeUndefined();
    });

    it('scoped diff 对指定集合输出与全量 diff 一致', () => {
        const baseline = dashboardDataToPbRecords(baseData(), 'p1');
        const modified = baseData();
        (modified.tenants as any)[0].monthlyRent = 9999;
        modified.payments = [
            { id: 'pay1', tenantId: 't1', tenantName: '张三', amount: 1000, type: 'Rent', date: '2026-02-01', status: 'Paid', period: '2026-02' },
        ] as any;

        const fullPayload = diffPbRecords(
            baseline,
            dashboardDataToPbRecords(modified, 'p1'),
            baseMeta(),
        );
        const scopedSnapshot = dashboardDataToPbRecords(modified, 'p1', {
            collections: ['pb_tenants'],
        });
        expect(Object.keys(scopedSnapshot)).toEqual(['pb_tenants']);
        const scopedPayload = diffPbRecordsScoped(
            baseline,
            scopedSnapshot,
            baseMeta(),
            { collections: ['pb_tenants'] },
        );

        expect(scopedPayload).toEqual({
            pb_tenants: fullPayload.pb_tenants,
        });
        expect(scopedPayload.pb_payments).toBeUndefined();
    });

    it('A 改张三月租、B 改李四电话 → 两边 diff 不互相影响', () => {
        const baseline = dashboardDataToPbRecords(baseData(), 'p1');

        const editorA = baseData();
        (editorA.tenants as any)[0].monthlyRent = 9999;
        const payloadA = diffPbRecords(baseline, dashboardDataToPbRecords(editorA, 'p1'), baseMeta());

        const editorB = baseData();
        (editorB.tenants as any)[1].contactInfo = '13800000000';
        const payloadB = diffPbRecords(baseline, dashboardDataToPbRecords(editorB, 'p1'), baseMeta());

        expect(payloadA.pb_tenants.updates).toHaveLength(1);
        expect(payloadA.pb_tenants.updates[0].originalId).toBe('t1');
        expect(payloadB.pb_tenants.updates).toHaveLength(1);
        expect(payloadB.pb_tenants.updates[0].originalId).toBe('t2');
    });

    it('新增租户 → create；删除租户 → delete', () => {
        const baseline = dashboardDataToPbRecords(baseData(), 'p1');
        const modified = baseData();
        // 删 t2
        modified.tenants = modified.tenants.filter((t) => t.id !== 't2');
        // 加 t3
        modified.tenants.push({
            id: 't3',
            name: '王五',
            buildingId: 'b1',
            unitIds: [],
            totalArea: 0,
            leaseStart: '2026-02-01',
            leaseEnd: '2027-02-01',
            monthlyRent: 6000,
            paymentCycle: 'Monthly',
            depositAmount: 0,
            depositStatus: 'Unpaid',
            status: 'Active',
        } as any);

        const payload = diffPbRecords(baseline, dashboardDataToPbRecords(modified, 'p1'), baseMeta());
        expect(payload.pb_tenants.creates.map((c) => c.originalId)).toEqual(['t3']);
        expect(payload.pb_tenants.deletes.map((d) => d.originalId)).toEqual(['t2']);
        expect(payload.pb_tenants.updates).toHaveLength(0);
    });

    it('修改 yearlyTargets 用合成 key', () => {
        const baseline = dashboardDataToPbRecords(baseData(), 'p1');
        const modified = baseData();
        modified.yearlyTargets = { 2026: { revenue: 2000000, occupancy: 80 } };
        const payload = diffPbRecords(baseline, dashboardDataToPbRecords(modified, 'p1'), baseMeta());
        expect(payload.pb_yearly_targets.updates).toHaveLength(1);
        expect(payload.pb_yearly_targets.updates[0]).toMatchObject({
            originalId: '2026',
            changedFields: { revenue: 2000000 },
        });
    });

    it('billing_period_notes 当作单条 update 处理，并按顶层 key 打补丁', () => {
        const baseline = dashboardDataToPbRecords(baseData(), 'p1');
        const modified = baseData();
        modified.billingPeriodNotes = { 't1###2026-04': '已催收' };
        const payload = diffPbRecords(baseline, dashboardDataToPbRecords(modified, 'p1'), baseMeta());
        expect(payload.pb_billing_period_notes.updates).toHaveLength(1);
        expect(payload.pb_billing_period_notes.updates[0].originalId).toBe('billing_period_notes');
        expect(
            payload.pb_billing_period_notes.updates[0].changedFields.notes_json
        ).toBeUndefined();
        expect(
            payload.pb_billing_period_notes.updates[0].changedFields.notes_json_patch
        ).toEqual({ 't1###2026-04': '已催收' });
    });

    // 回归用例：合同卡片 ◀▶ 平移 / 单月账期调整 / 名称变更 / 付款周期变更 / 单价模式
    // 这些字段曾在 dataDiff.ts 的 tenant 映射中缺失，导致 diff 无变化、保存后刷新回退。
    it('修改 paymentPeriodShiftMonths → 产生 update，changedFields 包含 payment_period_shift_months', () => {
        const baseline = dashboardDataToPbRecords(baseData(), 'p1');
        const modified = baseData();
        (modified.tenants as any)[0].paymentPeriodShiftMonths = -2;
        const payload = diffPbRecords(baseline, dashboardDataToPbRecords(modified, 'p1'), baseMeta());
        expect(payload.pb_tenants.updates).toHaveLength(1);
        expect(payload.pb_tenants.updates[0]).toMatchObject({
            originalId: 't1',
            changedFields: { payment_period_shift_months: -2 },
        });
    });

    it('新增 paymentPeriodAdjustments / nameHistory / paymentCycleChanges / unitPriceMode → 均产生 update', () => {
        const baseline = dashboardDataToPbRecords(baseData(), 'p1');
        const modified = baseData();
        const t = (modified.tenants as any)[0];
        t.paymentPeriodAdjustments = [{ originalMonth: '2026-05', shiftMonths: 1, reason: '测试' }];
        t.nameHistory = [{ from: '张三', to: '张三（旧）', date: '2026-05-01' }];
        t.paymentCycleChanges = [{ effectiveDate: '2026-06-01', fromCycle: 'Monthly', toCycle: 'Quarterly', toCycleMonths: 3 }];
        t.unitPriceMode = 'monthly';
        const payload = diffPbRecords(baseline, dashboardDataToPbRecords(modified, 'p1'), baseMeta());
        expect(payload.pb_tenants.updates).toHaveLength(1);
        const changed = payload.pb_tenants.updates[0].changedFields;
        expect(changed.payment_period_adjustments).toEqual(t.paymentPeriodAdjustments);
        expect(changed.name_history).toEqual(t.nameHistory);
        expect(changed.payment_cycle_changes).toEqual(t.paymentCycleChanges);
        expect(changed.unit_price_mode).toBe('monthly');
    });

    it('amount_delta 预算调整：PB 行使用 null 代替 originalYear/Month -1（满足 original_month 0–11 约束）', () => {
        const data = baseData();
        data.budgetAdjustments = [
            {
                id: 'adj_delta_1',
                tenantId: 't1',
                tenantName: '张三',
                originalYear: -1,
                originalMonth: -1,
                adjustedYear: 2026,
                adjustedMonth: 2,
                amount: 500,
                reason: '手动调额',
                adjustmentKind: 'amount_delta',
            } as any,
        ];
        const pb = dashboardDataToPbRecords(data, 'p1');
        expect(pb.pb_budget_adjustments.adj_delta_1).toMatchObject({
            original_year: null,
            original_month: null,
            adjusted_year: 2026,
            adjusted_month: 2,
            adjustment_kind: 'amount_delta',
            amount: 500,
        });
    });
});
