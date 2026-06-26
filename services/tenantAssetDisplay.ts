import type { Building, Tenant } from '../types';

export type TenantAssetLookup = {
    buildingById: Map<string, Building>;
    unitNameById: Map<string, string>;
    unitFloorById: Map<string, number>;
};

export type TenantAssetDisplayOptions = {
    unitSeparator?: string;
    unknownBuildingName?: string;
};

export type TenantAssetDisplay = {
    buildingName: string;
    unitNames: string;
};

export const EMPTY_TENANT_ASSET_LOOKUP: TenantAssetLookup = {
    buildingById: new Map(),
    unitNameById: new Map(),
    unitFloorById: new Map(),
};

export function buildTenantAssetLookup(buildings: Building[]): TenantAssetLookup {
    const buildingById = new Map<string, Building>();
    const unitNameById = new Map<string, string>();
    const unitFloorById = new Map<string, number>();

    for (const building of buildings) {
        buildingById.set(building.id, building);
        for (const unit of building.units || []) {
            unitNameById.set(unit.id, unit.name);
            if (typeof unit.floor === 'number') unitFloorById.set(unit.id, unit.floor);
        }
    }

    return { buildingById, unitNameById, unitFloorById };
}

export function resolveTenantAssetDisplay(
    tenant: Pick<Tenant, 'buildingId' | 'unitIds'>,
    lookup: TenantAssetLookup,
    options: TenantAssetDisplayOptions = {},
): TenantAssetDisplay {
    const unitSeparator = options.unitSeparator ?? ', ';
    const unknownBuildingName = options.unknownBuildingName ?? '';
    const building = lookup.buildingById.get(tenant.buildingId);
    return {
        buildingName: building?.name || unknownBuildingName,
        unitNames: (tenant.unitIds || []).map((uid) => lookup.unitNameById.get(uid) || uid).join(unitSeparator),
    };
}
