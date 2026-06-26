import type { Building } from '../types';

/** 与预算表 Excel、合同侧展示对齐：去空白、统一小写，用于「客户+房号+楼宇」匹配键。 */
export const normalizeBudgetRowKeyPart = (value: string | undefined | null): string =>
    String(value || '')
        .trim()
        .replace(/\s+/g, '')
        .toLowerCase();

/** 导入预算表一行与合同行共用的匹配键（客户名|房号|楼宇）。 */
export const importedBudgetRowKey = (customer: string, unit: string, building: string): string =>
    `${normalizeBudgetRowKeyPart(customer)}|${normalizeBudgetRowKeyPart(unit)}|${normalizeBudgetRowKeyPart(building)}`;

export type BudgetRowKeyLookup = {
    buildingById: Map<string, Building>;
    unitNameByBuildingId: Map<string, Map<string, string>>;
};

export const buildBudgetRowKeyLookup = (buildings: Building[] | Map<string, Building>): BudgetRowKeyLookup => {
    const buildingList = Array.isArray(buildings) ? buildings : Array.from(buildings.values());
    const buildingById = buildings instanceof Map ? buildings : new Map(buildingList.map((building) => [building.id, building] as const));
    const unitNameByBuildingId = new Map<string, Map<string, string>>();
    for (const building of buildingList) {
        const unitNameById = new Map<string, string>();
        for (const unit of building.units || []) unitNameById.set(unit.id, unit.name);
        unitNameByBuildingId.set(building.id, unitNameById);
    }
    return { buildingById, unitNameByBuildingId };
};

const isBudgetRowKeyLookup = (
    value: Map<string, Building> | BudgetRowKeyLookup
): value is BudgetRowKeyLookup =>
    !(value instanceof Map) &&
    value &&
    value.buildingById instanceof Map &&
    value.unitNameByBuildingId instanceof Map;

/** 由当前合同客户与楼宇资料生成与导入表对齐的匹配键。 */
export const tenantImportedBudgetRowKey = (
    tenant: { name: string; buildingId: string; unitIds: string[] },
    buildingByIdOrLookup: Map<string, Building> | BudgetRowKeyLookup
): string => {
    let buildingById: Map<string, Building>;
    let unitNameById: Map<string, string> | undefined;
    if (isBudgetRowKeyLookup(buildingByIdOrLookup)) {
        buildingById = buildingByIdOrLookup.buildingById;
        unitNameById = buildingByIdOrLookup.unitNameByBuildingId.get(tenant.buildingId);
    } else {
        buildingById = buildingByIdOrLookup;
    }
    const building = buildingById.get(tenant.buildingId);
    const unitNames = tenant.unitIds
        .map((uid) => unitNameById?.get(uid) || building?.units.find((unit) => unit.id === uid)?.name || uid)
        .join(', ');
    return importedBudgetRowKey(tenant.name, unitNames, building?.name || '未知楼宇');
};
