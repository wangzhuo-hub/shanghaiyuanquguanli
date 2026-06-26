import { describe, expect, it } from 'vitest';
import type { Building, Tenant } from '../../types';
import {
    buildTenantAssetLabelLookup,
    resolveTenantAssetLabels,
    resolveTenantAssetLabelsFromLookup,
} from '../tenantAssetLabels';

const buildings: Building[] = [
    {
        id: 'b1',
        name: '一号楼',
        type: 'Building',
        units: [
            { id: 'u10', name: '10', floor: 1, area: 100, status: 'Occupied' as any },
            { id: 'u2', name: '2', floor: 1, area: 100, status: 'Occupied' as any },
        ],
    },
    {
        id: 'b2',
        name: '二号楼',
        type: 'Building',
        units: [
            { id: 'u2', name: '二号楼-2', floor: 1, area: 100, status: 'Occupied' as any },
        ],
    },
];

const tenant = (patch: Partial<Tenant>): Tenant =>
    ({
        id: 't1',
        name: '客户A',
        buildingId: 'b1',
        unitIds: ['u10', 'u2'],
        totalArea: 200,
        ...patch,
    }) as Tenant;

describe('tenant asset labels', () => {
    it('resolves labels through a reusable lookup with the original numeric room sort', () => {
        const lookup = buildTenantAssetLabelLookup(buildings);

        expect(resolveTenantAssetLabelsFromLookup(tenant({}), lookup)).toEqual({
            buildingLabel: '一号楼',
            unitNamesLabel: '2、10',
        });
    });

    it('only resolves units inside the tenant building', () => {
        const lookup = buildTenantAssetLabelLookup(buildings);

        expect(resolveTenantAssetLabelsFromLookup(tenant({ buildingId: 'b2', unitIds: ['u10', 'u2'] }), lookup)).toEqual({
            buildingLabel: '二号楼',
            unitNamesLabel: '二号楼-2',
        });
    });

    it('falls back to raw unit ids and unknown building when no metadata is available', () => {
        expect(resolveTenantAssetLabels(tenant({ buildingId: 'missing', unitIds: ['raw-a', 'raw-b'] }), buildings)).toEqual({
            buildingLabel: '未知楼宇',
            unitNamesLabel: 'raw-a、raw-b',
        });
    });
});
