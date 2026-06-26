import { describe, expect, it } from 'vitest';
import type { Building, Tenant } from '../../types';
import { buildTenantAssetLookup, resolveTenantAssetDisplay } from '../tenantAssetDisplay';

const buildings: Building[] = [
    {
        id: 'b1',
        name: '一号楼',
        type: 'Building',
        units: [
            { id: 'u101', name: '101', floor: 1, area: 100, status: 'Occupied' as any },
            { id: 'u102', name: '102', floor: 1, area: 120, status: 'Occupied' as any },
        ],
    },
];

const tenant = (patch: Partial<Tenant>): Tenant =>
    ({
        id: 't1',
        name: '客户A',
        buildingId: 'b1',
        unitIds: ['u101'],
        ...patch,
    }) as Tenant;

describe('tenant asset display lookup', () => {
    it('resolves building and unit labels through prebuilt maps', () => {
        const lookup = buildTenantAssetLookup(buildings);
        const display = resolveTenantAssetDisplay(tenant({ unitIds: ['u101', 'u102'] }), lookup);

        expect(display).toEqual({
            buildingName: '一号楼',
            unitNames: '101, 102',
        });
        expect(lookup.unitFloorById.get('u101')).toBe(1);
    });

    it('preserves tenant unit order and falls back to raw unit id when metadata is missing', () => {
        const lookup = buildTenantAssetLookup(buildings);
        const display = resolveTenantAssetDisplay(tenant({ unitIds: ['u102', 'missing', 'u101'] }), lookup, {
            unitSeparator: ',',
        });

        expect(display.unitNames).toBe('102,missing,101');
    });

    it('uses configured unknown building label', () => {
        const lookup = buildTenantAssetLookup(buildings);
        const display = resolveTenantAssetDisplay(tenant({ buildingId: 'missing-building' }), lookup, {
            unknownBuildingName: '未知楼栋',
        });

        expect(display.buildingName).toBe('未知楼栋');
    });
});
