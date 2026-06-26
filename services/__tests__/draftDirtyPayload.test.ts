import { describe, expect, it } from 'vitest';
import { ContractStatus, DepositStatus, UnitStatus, type DashboardData, type PaymentRecord, type Tenant } from '../../types';
import { generateInitialData } from '../mockData';
import type { DirtyPayload } from '../dirtyTracker';
import { applyDirtyPayloadToDashboardData } from '../draftDirtyPayload';

const tenant: Tenant = {
    id: 't1',
    name: '测试客户',
    buildingId: 'b1',
    unitIds: ['u1'],
    totalArea: 100,
    leaseStart: '2026-01-01',
    leaseEnd: '2026-12-31',
    monthlyRent: 10000,
    unitPrice: 3.2,
    unitPriceMode: 'daily',
    rentFreePeriods: [],
    paymentCycle: 'Monthly',
    firstPaymentDate: '2026-01-05',
    depositAmount: 10000,
    depositStatus: DepositStatus.Paid,
    status: ContractStatus.Active,
    projectId: 'shenzhen_park',
    managementFeeEnabled: true,
    managementFeeUnitPrice: 12,
    managementFeeUnitPriceMode: 'monthly',
    managementFeeMonthlyAmount: 1200,
    managementFeeFirstPaymentDate: '2026-01-10',
    managementFeeStartWithOccupancy: false,
    managementFeeStartDate: '2026-01-15',
};

const payment: PaymentRecord = {
    id: 'p1',
    tenantId: 't1',
    tenantName: '测试客户',
    amount: 100,
    type: 'Rent',
    date: '2026-06-15',
    status: 'Pending',
    period: '2026-06',
};

const baselineData = (): DashboardData => ({
    ...generateInitialData(),
    buildings: [{
        id: 'b1',
        name: '1号楼',
        type: 'Building',
        units: [{
            id: 'u1',
            name: '101',
            area: 100,
            floor: 1,
            status: UnitStatus.Occupied,
        }],
    }],
    tenants: [tenant],
    payments: [payment],
    billingPeriodNotes: {
        keep: '保留',
        remove: '删除',
    },
    cloudSaveVersion: 5,
});

describe('applyDirtyPayloadToDashboardData', () => {
    it('applies row-level tenant updates without mutating the baseline or dropping management fee fields', () => {
        const baseline = baselineData();
        const payload: DirtyPayload = {
            pb_tenants: {
                creates: [],
                updates: [{
                    originalId: 't1',
                    baseUpdated: '2026-06-01T00:00:00.000Z',
                    changedFields: {
                        name: '测试客户改名',
                        monthly_rent: 12000,
                    },
                }],
                deletes: [],
            },
        };

        const next = applyDirtyPayloadToDashboardData(baseline, payload);

        expect(next.tenants[0]).toMatchObject({
            id: 't1',
            name: '测试客户改名',
            monthlyRent: 12000,
            managementFeeEnabled: true,
            managementFeeUnitPrice: 12,
            managementFeeUnitPriceMode: 'monthly',
            managementFeeMonthlyAmount: 1200,
            managementFeeFirstPaymentDate: '2026-01-10',
            managementFeeStartWithOccupancy: false,
            managementFeeStartDate: '2026-01-15',
        });
        expect(baseline.tenants[0].name).toBe('测试客户');
        expect(baseline.tenants[0].monthlyRent).toBe(10000);
    });

    it('applies payment create/delete and billing notes json patches', () => {
        const baseline = baselineData();
        const payload: DirtyPayload = {
            pb_payments: {
                creates: [{
                    originalId: 'p2',
                    data: {
                        id: 'p2',
                        tenant_id: 't1',
                        tenant_name: '测试客户',
                        amount: 200,
                        type: 'ManagementFee',
                        date: '2026-06-20',
                        status: 'Received',
                        period: '2026-06',
                    },
                }],
                updates: [],
                deletes: [{
                    originalId: 'p1',
                    baseUpdated: '2026-06-01T00:00:00.000Z',
                }],
            },
            pb_billing_period_notes: {
                creates: [],
                updates: [{
                    originalId: 'billing_period_notes',
                    baseUpdated: '2026-06-01T00:00:00.000Z',
                    changedFields: {
                        notes_json_patch: {
                            remove: null,
                            added: '新增',
                        },
                    },
                }],
                deletes: [],
            },
        };

        const next = applyDirtyPayloadToDashboardData(baseline, payload);

        expect(next.payments.map((item) => item.id)).toEqual(['p2']);
        expect(next.payments[0]).toMatchObject({
            amount: 200,
            type: 'ManagementFee',
            status: 'Received',
        });
        expect(next.billingPeriodNotes).toEqual({
            keep: '保留',
            added: '新增',
        });
        expect(baseline.payments.map((item) => item.id)).toEqual(['p1']);
    });
});
