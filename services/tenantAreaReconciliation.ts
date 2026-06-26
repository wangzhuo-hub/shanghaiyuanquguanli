import type { Building, Tenant } from '../types';

export function buildUnitAreaById(buildings: Building[]): Map<string, number> {
    const unitAreaById = new Map<string, number>();
    for (const building of buildings) {
        for (const unit of building.units || []) {
            unitAreaById.set(unit.id, unit.area || 0);
        }
    }
    return unitAreaById;
}

export function reconcileTenantAreasWithBuildings(
    buildings: Building[],
    tenants: Tenant[],
): Tenant[] {
    const unitAreaById = buildUnitAreaById(buildings);
    return tenants.map((tenant) => {
        let newTotalArea = 0;
        for (const unitId of tenant.unitIds || []) {
            const area = unitAreaById.get(unitId);
            if (area !== undefined) newTotalArea += area;
        }
        newTotalArea = Number(newTotalArea.toFixed(2));
        if (Math.abs(newTotalArea - tenant.totalArea) < 0.01) return tenant;

        let price = tenant.unitPrice;
        if ((price === undefined || price === 0) && tenant.totalArea > 0) {
            price = (tenant.monthlyRent * 12) / (tenant.totalArea * 365);
        }
        price = price || 0;
        const newMonthlyRent = Math.round(price * (365 / 12) * newTotalArea * 100) / 100;
        return {
            ...tenant,
            totalArea: newTotalArea,
            monthlyRent: newMonthlyRent,
            unitPrice: price,
        };
    });
}
