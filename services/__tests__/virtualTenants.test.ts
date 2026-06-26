import { describe, expect, it } from 'vitest';
import { ContractStatus, DepositStatus, UnitStatus, type BudgetAssumption, type Building, type Tenant } from '../../types';
import { getVirtualTenants } from '../virtualTenants';

const baseBuilding: Building = {
    id: 'b1',
    name: '1号楼',
    units: [
        { id: 'u1', name: '101', area: 120, floor: 1, status: UnitStatus.Vacant },
        { id: 'u2', name: '102', area: 80, floor: 1, status: UnitStatus.Occupied },
    ],
};

const baseTenant: Tenant = {
    id: 't1',
    name: '存量客户',
    buildingId: 'b1',
    unitIds: ['u2'],
    totalArea: 80,
    leaseStart: '2024-01-01',
    leaseEnd: '2026-12-31',
    unitPrice: 2,
    monthlyRent: 4000,
    rentFreePeriods: [],
    paymentCycle: 'Quarterly',
    firstPaymentDate: '2024-01-01',
    depositAmount: 0,
    depositStatus: DepositStatus.Paid,
    status: ContractStatus.Active,
};

describe('getVirtualTenants', () => {
    it('builds vacancy virtual tenants without loading billing calculations', () => {
        const assumptions: BudgetAssumption[] = [{
            id: 'a1',
            targetType: 'Vacancy',
            targetId: 'u1',
            targetName: '101',
            projectedSignDate: '2026-03-15',
            projectedUnitPrice: 3,
            projectedRentFreeMonths: 2,
        }];

        const result = getVirtualTenants([], [baseBuilding], assumptions);

        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({
            id: 'virt_vac_u1',
            name: '待租去化 (预算)',
            buildingId: 'b1',
            unitIds: ['u1'],
            leaseStart: '2026-03-15',
            leaseEnd: '2031-03-15',
            firstPaymentDate: '2026-05-15',
            depositStatus: DepositStatus.Unpaid,
            status: ContractStatus.Active,
            freeRentHandling: 'Defer',
        });
        expect(result[0].rentFreePeriods?.[0]).toMatchObject({
            start: '2026-03-15',
            end: '2026-05-15',
        });
    });

    it('keeps the first vacancy assumption for a unit when building the lookup', () => {
        const assumptions: BudgetAssumption[] = [
            {
                id: 'first',
                targetType: 'Vacancy',
                targetId: 'u1',
                targetName: '101',
                projectedSignDate: '2026-03-15',
                projectedUnitPrice: 3,
                projectedRentFreeMonths: 0,
            },
            {
                id: 'second',
                targetType: 'Vacancy',
                targetId: 'u1',
                targetName: '101',
                projectedSignDate: '2026-06-01',
                projectedUnitPrice: 9,
                projectedRentFreeMonths: 0,
            },
        ];

        const result = getVirtualTenants([], [baseBuilding], assumptions);

        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({
            leaseStart: '2026-03-15',
            unitPrice: 3,
        });
    });

    it('builds renewal and risk replacement virtual tenants with the legacy date rules', () => {
        const assumptions: BudgetAssumption[] = [
            {
                id: 'renew',
                targetType: 'Renewal',
                targetId: 't1',
                targetName: '存量客户',
                strategy: 'Renewal',
                projectedSignDate: '2027-01-01',
                projectedUnitPrice: 4,
                projectedRentFreeMonths: 1,
            },
            {
                id: 'risk',
                targetType: 'RiskTermination',
                targetId: 't1',
                targetName: '存量客户',
                strategy: 'ReLease',
                projectedTerminationDate: '2026-06-30',
                vacancyGapMonths: 2,
                projectedSignDate: '2026-09-01',
                projectedUnitPrice: 5,
                projectedRentFreeMonths: 0,
            },
        ];

        const result = getVirtualTenants([baseTenant], [baseBuilding], assumptions);

        expect(result.map((tenant) => tenant.id)).toEqual(['virt_Renewal_t1', 'virt_RiskTermination_t1']);
        expect(result[0]).toMatchObject({
            leaseStart: '2027-01-01',
            leaseEnd: '2030-01-01',
            firstPaymentDate: '2027-02-01',
            unitPrice: 4,
        });
        expect(result[1]).toMatchObject({
            leaseStart: '2026-08-31',
            leaseEnd: '2029-08-31',
            firstPaymentDate: '2026-08-31',
            unitPrice: 5,
        });
    });
});
