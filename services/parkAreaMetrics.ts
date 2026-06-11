import type { Building, DashboardData, Tenant } from '../types';
import { ContractStatus, UnitStatus } from '../types';
import { parseDateLocal } from './billingService';
import { toFixedNumber } from './numberFormat';

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

const LEASED_STATUSES = new Set<ContractStatus>([
    ContractStatus.Active,
    ContractStatus.Expiring,
    ContractStatus.Pending,
]);

function endOfLocalDay(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

/** 判断租户在 referenceDate 是否计入已租面积（与看板/OpenClaw/资产管理同源） */
export function isTenantLeasedAtDate(
    tenant: Tenant,
    referenceDate: Date,
    selfUseUnitIds: Set<string>,
): boolean {
    if (!LEASED_STATUSES.has(tenant.status)) return false;
    if (tenant.unitIds.some((uid) => selfUseUnitIds.has(uid))) return false;

    const achievedDate = tenant.signingDate
        ? parseDateLocal(tenant.signingDate)
        : parseDateLocal(tenant.leaseStart);
    if (Number.isNaN(achievedDate.getTime()) || achievedDate > referenceDate) return false;

    const terminated = tenant.terminationDate ? parseDateLocal(tenant.terminationDate) : null;
    if (terminated && !Number.isNaN(terminated.getTime()) && terminated <= referenceDate) return false;

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

    const selfUseUnitIds = new Set<string>();
    let campusTotalArea = 0;
    let selfUseArea = 0;
    let leasableArea = 0;
    let leasableUnits = 0;
    let leasedUnits = 0;
    let vacantUnits = 0;

    buildings.forEach((building) => {
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
                if (unit.status === UnitStatus.Occupied) leasedUnits += 1;
                else vacantUnits += 1;
            }
        });
    });

    let leasedArea = 0;
    tenants.forEach((tenant) => {
        if (buildingId && tenant.buildingId !== buildingId) return;
        const building = buildings.find((b) => b.id === tenant.buildingId);
        if (building?.type === 'Site') return;
        if (isTenantLeasedAtDate(tenant, referenceDate, selfUseUnitIds)) {
            leasedArea += tenant.totalArea || 0;
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

/** 从 calculateDashboardMetrics 产出的 DashboardData 还原面积指标（供资产管理等页面只读展示） */
export function parkAreaMetricsFromDashboard(data: Pick<
    DashboardData,
    | 'totalArea'
    | 'leasedArea'
    | 'occupancyRate'
    | 'campusTotalArea'
    | 'selfUseArea'
    | 'vacantArea'
    | 'leasableUnits'
    | 'leasedUnits'
    | 'vacantUnits'
>): ParkAreaMetrics {
    const leasableArea = data.totalArea || 0;
    const leasedArea = data.leasedArea || 0;
    return {
        campusTotalArea: data.campusTotalArea ?? leasableArea + (data.selfUseArea ?? 0),
        selfUseArea: data.selfUseArea ?? 0,
        leasableArea,
        leasedArea,
        vacantArea: data.vacantArea ?? Math.max(0, leasableArea - leasedArea),
        occupancyRate: data.occupancyRate || 0,
        leasableUnits: data.leasableUnits ?? 0,
        leasedUnits: data.leasedUnits ?? 0,
        vacantUnits: data.vacantUnits ?? 0,
    };
}
