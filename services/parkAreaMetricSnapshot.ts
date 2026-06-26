import type { DashboardData } from '../types';
import type { ParkAreaMetrics } from './parkAreaMetrics';

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
