import type { Building, Tenant, Unit } from '../types';
import { compareUnitNameNumeric } from './sharedUtils';

export type TenantAssetLabelLookup = {
    buildingById: Map<string, Building>;
    unitByBuildingId: Map<string, Map<string, Unit>>;
};

export function buildTenantAssetLabelLookup(buildings: Building[] | undefined): TenantAssetLabelLookup {
    const buildingById = new Map<string, Building>();
    const unitByBuildingId = new Map<string, Map<string, Unit>>();
    for (const building of buildings || []) {
        buildingById.set(building.id, building);
        const unitById = new Map<string, Unit>();
        for (const unit of building.units || []) unitById.set(unit.id, unit);
        unitByBuildingId.set(building.id, unitById);
    }
    return { buildingById, unitByBuildingId };
}

export function resolveTenantAssetLabelsFromLookup(
    tenant: Pick<Tenant, 'buildingId' | 'unitIds'>,
    lookup: TenantAssetLabelLookup,
): { buildingLabel: string; unitNamesLabel: string } {
    const building = lookup.buildingById.get(tenant.buildingId);
    const unitById = lookup.unitByBuildingId.get(tenant.buildingId);
    const units = unitById
        ? (tenant.unitIds || []).map((uid) => unitById.get(uid)).filter((unit): unit is Unit => !!unit)
        : [];
    const unitNamesLabel = units.length
        ? [...units].sort((a, b) => compareUnitNameNumeric(a.name, b.name)).map((unit) => unit.name).join('、')
        : (tenant.unitIds || []).join('、');
    return { buildingLabel: building?.name || '未知楼宇', unitNamesLabel };
}

export function resolveTenantAssetLabels(
    tenant: Pick<Tenant, 'buildingId' | 'unitIds'>,
    buildings: Building[] | undefined,
): { buildingLabel: string; unitNamesLabel: string } {
    return resolveTenantAssetLabelsFromLookup(tenant, buildTenantAssetLabelLookup(buildings));
}
