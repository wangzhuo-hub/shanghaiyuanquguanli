import type { Building, Tenant } from '../types';
import { ContractStatus, UnitStatus } from '../types';
import { parseDateLocal } from './billingLightweight';
import { toFixedNumber } from './numberFormat';
export { parkAreaMetricsFromDashboard } from './parkAreaMetricSnapshot';

/** 看板 / 资产管理 / OpenClaw 快照共用的面积与出租率指标 */
export type ParkAreaMetrics = {
    campusTotalArea: number;
    selfUseArea: number;
    leasableArea: number;
    leasedArea: number;
    vacantArea: number;
    occupancyRate: number;
    leasableUnits: number;
    leasedUnits: number;
    vacantUnits: number;
};

export type ComputeParkAreaMetricsOptions = {
    /** 口径锚点；默认当天 23:59:59（「当前已租」） */
    referenceDate?: Date;
    /** 仅统计指定楼宇（资产管理单楼视图） */
    buildingId?: string;
};

type MutableParkAreaMetrics = {
    campusTotalArea: number;
    selfUseArea: number;
    leasableArea: number;
    leasedArea: number;
    leasableUnits: number;
    leasedUnits: number;
    vacantUnits: number;
};

type BuildingAreaAccumulator = {
    metrics: MutableParkAreaMetrics;
    selfUseUnitIds: Set<string>;
    leasableUnitAreaById: Map<string, number>;
    leasedUnitIds: Set<string>;
};

const LEASED_STATUSES = new Set<ContractStatus>([
    ContractStatus.Active,
    ContractStatus.Expiring,
    ContractStatus.Pending,
]);

function endOfLocalDay(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

function minValidDate(...dates: Array<Date | null>): Date | null {
    const valid = dates.filter((date): date is Date => !!date && !Number.isNaN(date.getTime()));
    if (valid.length === 0) return null;
    return valid.reduce((min, date) => (date < min ? date : min));
}

const emptyMutableParkAreaMetrics = (): MutableParkAreaMetrics => ({
    campusTotalArea: 0,
    selfUseArea: 0,
    leasableArea: 0,
    leasedArea: 0,
    leasableUnits: 0,
    leasedUnits: 0,
    vacantUnits: 0,
});

const finalizeParkAreaMetrics = (metrics: MutableParkAreaMetrics): ParkAreaMetrics => {
    const vacantArea = Math.max(0, metrics.leasableArea - metrics.leasedArea);
    const occupancyRate = metrics.leasableArea > 0 ? toFixedNumber((metrics.leasedArea / metrics.leasableArea) * 100) : 0;

    return {
        campusTotalArea: Number(metrics.campusTotalArea.toFixed(2)),
        selfUseArea: Number(metrics.selfUseArea.toFixed(2)),
        leasableArea: Number(metrics.leasableArea.toFixed(2)),
        leasedArea: Number(metrics.leasedArea.toFixed(2)),
        vacantArea: Number(vacantArea.toFixed(2)),
        occupancyRate,
        leasableUnits: metrics.leasableUnits,
        leasedUnits: metrics.leasedUnits,
        vacantUnits: metrics.vacantUnits,
    };
};

const emptyBuildingAccumulator = (): BuildingAreaAccumulator => ({
    metrics: emptyMutableParkAreaMetrics(),
    selfUseUnitIds: new Set(),
    leasableUnitAreaById: new Map(),
    leasedUnitIds: new Set(),
});

/** 判断租户在 referenceDate 是否计入已租面积（与看板/OpenClaw/资产管理同源） */
export function isTenantLeasedAtDate(
    tenant: Tenant,
    referenceDate: Date,
    selfUseUnitIds: Set<string>,
): boolean {
    if (!LEASED_STATUSES.has(tenant.status)) return false;
    if (tenant.unitIds.some((uid) => selfUseUnitIds.has(uid))) return false;

    const leaseStart = parseDateLocal(tenant.leaseStart);
    if (Number.isNaN(leaseStart.getTime()) || leaseStart > referenceDate) return false;

    const terminated = tenant.terminationDate ? parseDateLocal(tenant.terminationDate) : null;
    const leaseEnd = tenant.leaseEnd ? parseDateLocal(tenant.leaseEnd) : null;
    const effectiveEnd = minValidDate(
        leaseEnd ? endOfLocalDay(leaseEnd) : null,
        terminated ? endOfLocalDay(terminated) : null,
    );
    if (effectiveEnd && effectiveEnd < referenceDate) return false;

    return true;
}

/**
 * 园区（或单楼）面积指标唯一入口。
 * 规则：排除 Site 与自用单元；在租 = Active/Expiring/Pending 且日期有效。
 * 注意：特殊业态只影响应收生成，不影响楼宇物理已租面积。
 */
export function computeParkAreaMetrics(
    buildings: Building[],
    tenants: Tenant[],
    options: ComputeParkAreaMetricsOptions = {},
): ParkAreaMetrics {
    const referenceDate = endOfLocalDay(options.referenceDate ?? new Date());
    const buildingId = options.buildingId?.trim();

    const buildingTypeById = new Map<string, Building['type']>();
    const leasableUnitAreaById = new Map<string, number>();
    const selfUseUnitIds = new Set<string>();
    let campusTotalArea = 0;
    let selfUseArea = 0;
    let leasableArea = 0;
    let leasableUnits = 0;
    let leasedUnits = 0;
    let vacantUnits = 0;

    buildings.forEach((building) => {
        buildingTypeById.set(building.id, building.type);
        if (building.type === 'Site') return;
        if (buildingId && building.id !== buildingId) return;

        building.units.forEach((unit) => {
            campusTotalArea += unit.area;
            if (unit.isSelfUse) {
                selfUseArea += unit.area;
                selfUseUnitIds.add(unit.id);
            } else {
                leasableArea += unit.area;
                leasableUnits += 1;
                leasableUnitAreaById.set(unit.id, unit.area || 0);
                if (unit.status === UnitStatus.Occupied) leasedUnits += 1;
                else vacantUnits += 1;
            }
        });
    });

    let leasedArea = 0;
    const leasedUnitIds = new Set<string>();
    tenants.forEach((tenant) => {
        if (buildingId && tenant.buildingId !== buildingId) return;
        if (buildingTypeById.get(tenant.buildingId) === 'Site') return;
        if (isTenantLeasedAtDate(tenant, referenceDate, selfUseUnitIds)) {
            let hasMatchedUnit = false;
            tenant.unitIds.forEach((unitId) => {
                const unitArea = leasableUnitAreaById.get(unitId);
                if (unitArea === undefined) return;
                hasMatchedUnit = true;
                if (leasedUnitIds.has(unitId)) return;
                leasedUnitIds.add(unitId);
                leasedArea += unitArea;
            });
            if (!hasMatchedUnit) leasedArea += tenant.totalArea || 0;
        }
    });

    const vacantArea = Math.max(0, leasableArea - leasedArea);
    const occupancyRate = leasableArea > 0 ? toFixedNumber((leasedArea / leasableArea) * 100) : 0;

    return {
        campusTotalArea: Number(campusTotalArea.toFixed(2)),
        selfUseArea: Number(selfUseArea.toFixed(2)),
        leasableArea: Number(leasableArea.toFixed(2)),
        leasedArea: Number(leasedArea.toFixed(2)),
        vacantArea: Number(vacantArea.toFixed(2)),
        occupancyRate,
        leasableUnits,
        leasedUnits,
        vacantUnits,
    };
}

export function buildParkAreaMetricsByBuilding(
    buildings: Building[],
    tenants: Tenant[],
    options: Pick<ComputeParkAreaMetricsOptions, 'referenceDate'> = {},
): Map<string, ParkAreaMetrics> {
    const referenceDate = endOfLocalDay(options.referenceDate ?? new Date());
    const buildingTypeById = new Map<string, Building['type']>();
    const accumulators = new Map<string, BuildingAreaAccumulator>();

    for (const building of buildings) {
        buildingTypeById.set(building.id, building.type);
        const acc = emptyBuildingAccumulator();
        accumulators.set(building.id, acc);
        if (building.type === 'Site') continue;

        for (const unit of building.units) {
            acc.metrics.campusTotalArea += unit.area;
            if (unit.isSelfUse) {
                acc.metrics.selfUseArea += unit.area;
                acc.selfUseUnitIds.add(unit.id);
            } else {
                acc.metrics.leasableArea += unit.area;
                acc.metrics.leasableUnits += 1;
                acc.leasableUnitAreaById.set(unit.id, unit.area || 0);
                if (unit.status === UnitStatus.Occupied) acc.metrics.leasedUnits += 1;
                else acc.metrics.vacantUnits += 1;
            }
        }
    }

    for (const tenant of tenants) {
        if (buildingTypeById.get(tenant.buildingId) === 'Site') continue;
        const acc = accumulators.get(tenant.buildingId);
        if (!acc) continue;
        if (!isTenantLeasedAtDate(tenant, referenceDate, acc.selfUseUnitIds)) continue;

        let hasMatchedUnit = false;
        for (const unitId of tenant.unitIds) {
            const unitArea = acc.leasableUnitAreaById.get(unitId);
            if (unitArea === undefined) continue;
            hasMatchedUnit = true;
            if (acc.leasedUnitIds.has(unitId)) continue;
            acc.leasedUnitIds.add(unitId);
            acc.metrics.leasedArea += unitArea;
        }
        if (!hasMatchedUnit) acc.metrics.leasedArea += tenant.totalArea || 0;
    }

    const byBuilding = new Map<string, ParkAreaMetrics>();
    accumulators.forEach((acc, buildingId) => {
        byBuilding.set(buildingId, finalizeParkAreaMetrics(acc.metrics));
    });
    return byBuilding;
}
