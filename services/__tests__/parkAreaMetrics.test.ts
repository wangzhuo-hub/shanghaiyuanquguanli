import { describe, expect, it } from 'vitest';
import { ContractStatus, UnitStatus } from '../../types';
import { computeParkAreaMetrics, isTenantLeasedAtDate } from '../parkAreaMetrics';

const building = {
    id: 'b1',
    name: 'A座',
    type: 'Building' as const,
    units: [
        { id: 'u1', name: '101', floor: 1, area: 100, status: UnitStatus.Occupied, isSelfUse: false },
        { id: 'u2', name: '102', floor: 1, area: 50, status: UnitStatus.Vacant, isSelfUse: false },
        { id: 'u3', name: '自用', floor: 2, area: 30, status: UnitStatus.Vacant, isSelfUse: true },
    ],
};

describe('computeParkAreaMetrics', () => {
    it('excludes Site and self-use, but keeps special-business tenants in leased area', () => {
        const ref = new Date('2026-05-15T12:00:00');
        const metrics = computeParkAreaMetrics(
            [building],
            [
                {
                    id: 't1',
                    name: '正常租户',
                    buildingId: 'b1',
                    unitIds: ['u1'],
                    totalArea: 100,
                    leaseStart: '2026-01-01',
                    signingDate: '2026-01-01',
                    status: ContractStatus.Active,
                } as any,
                {
                    id: 't2',
                    name: '特殊业态',
                    buildingId: 'b1',
                    unitIds: ['u2'],
                    totalArea: 50,
                    leaseStart: '2026-01-01',
                    signingDate: '2026-01-01',
                    status: ContractStatus.Active,
                    isSpecialBusiness: true,
                } as any,
            ],
            { referenceDate: ref },
        );

        expect(metrics.leasableArea).toBe(150);
        expect(metrics.leasedArea).toBe(150);
        expect(metrics.vacantArea).toBe(0);
        expect(metrics.occupancyRate).toBe(100);
    });

    it('requires active status and valid lease dates at reference date', () => {
        const ref = new Date('2026-05-15T12:00:00');
        const selfUse = new Set<string>();
        expect(
            isTenantLeasedAtDate(
                {
                    id: 'future',
                    status: ContractStatus.Active,
                    unitIds: ['u1'],
                    leaseStart: '2026-06-01',
                    signingDate: '2026-06-01',
                } as any,
                ref,
                selfUse,
            ),
        ).toBe(false);
        expect(
            isTenantLeasedAtDate(
                {
                    id: 'terminated',
                    status: ContractStatus.Terminated,
                    unitIds: ['u1'],
                    leaseStart: '2026-01-01',
                    terminationDate: '2026-04-01',
                } as any,
                ref,
                selfUse,
            ),
        ).toBe(false);
    });
});
