import { describe, expect, it } from 'vitest';
import { ContractStatus, UnitStatus } from '../../types';
import { buildParkAreaMetricsByBuilding, computeParkAreaMetrics, isTenantLeasedAtDate } from '../parkAreaMetrics';

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
                    id: 'signed-renewal',
                    status: ContractStatus.Active,
                    unitIds: ['u1'],
                    signingDate: '2026-05-01',
                    leaseStart: '2026-06-01',
                    leaseEnd: '2027-05-31',
                } as any,
                ref,
                selfUse,
            ),
        ).toBe(false);
        expect(
            isTenantLeasedAtDate(
                {
                    id: 'ended',
                    status: ContractStatus.Active,
                    unitIds: ['u1'],
                    leaseStart: '2025-01-01',
                    leaseEnd: '2026-05-01',
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

    it('deduplicates renewal contracts for the same physical unit', () => {
        const ref = new Date('2026-06-18T12:00:00');
        const metrics = computeParkAreaMetrics(
            [building],
            [
                {
                    id: 'original',
                    name: '原合同',
                    buildingId: 'b1',
                    unitIds: ['u1'],
                    totalArea: 100,
                    leaseStart: '2023-07-21',
                    leaseEnd: '2026-07-20',
                    signingDate: '2023-07-20',
                    status: ContractStatus.Active,
                } as any,
                {
                    id: 'renewal',
                    name: '续签合同',
                    buildingId: 'b1',
                    unitIds: ['u1'],
                    totalArea: 100,
                    leaseStart: '2026-07-21',
                    leaseEnd: '2029-07-20',
                    signingDate: '2026-06-02',
                    status: ContractStatus.Active,
                } as any,
            ],
            { referenceDate: ref },
        );

        expect(metrics.leasedArea).toBe(100);
        expect(metrics.vacantArea).toBe(50);
        expect(metrics.occupancyRate).toBe(66.67);
    });

    it('builds per-building metrics in one batch with the same single-building口径', () => {
        const ref = new Date('2026-06-18T12:00:00');
        const buildings = [
            building,
            {
                id: 'b2',
                name: 'B座',
                type: 'Building' as const,
                units: [
                    { id: 'u4', name: '201', floor: 2, area: 80, status: UnitStatus.Occupied, isSelfUse: false },
                    { id: 'u5', name: '202', floor: 2, area: 40, status: UnitStatus.Vacant, isSelfUse: false },
                ],
            },
            {
                id: 'site1',
                name: '场地',
                type: 'Site' as const,
                units: [
                    { id: 's1', name: '场地1', floor: 1, area: 999, status: UnitStatus.Occupied, isSelfUse: false },
                ],
            },
        ];
        const tenants = [
            {
                id: 'b1-tenant',
                name: 'A客户',
                buildingId: 'b1',
                unitIds: ['u1'],
                totalArea: 100,
                leaseStart: '2026-01-01',
                leaseEnd: '2026-12-31',
                status: ContractStatus.Active,
            },
            {
                id: 'b2-tenant',
                name: 'B客户',
                buildingId: 'b2',
                unitIds: ['u4'],
                totalArea: 80,
                leaseStart: '2026-01-01',
                leaseEnd: '2026-12-31',
                status: ContractStatus.Active,
            },
            {
                id: 'site-tenant',
                name: '场地客户',
                buildingId: 'site1',
                unitIds: ['s1'],
                totalArea: 999,
                leaseStart: '2026-01-01',
                leaseEnd: '2026-12-31',
                status: ContractStatus.Active,
            },
        ] as any;

        const byBuilding = buildParkAreaMetricsByBuilding(buildings, tenants, { referenceDate: ref });

        expect(byBuilding.get('b1')).toEqual(computeParkAreaMetrics(buildings, tenants, {
            buildingId: 'b1',
            referenceDate: ref,
        }));
        expect(byBuilding.get('b2')).toEqual(computeParkAreaMetrics(buildings, tenants, {
            buildingId: 'b2',
            referenceDate: ref,
        }));
        expect(byBuilding.get('site1')).toEqual(computeParkAreaMetrics(buildings, tenants, {
            buildingId: 'site1',
            referenceDate: ref,
        }));
    });
});
