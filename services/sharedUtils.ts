import type { Tenant, RentFreePeriod, Building, Unit } from '../types';
import { ContractStatus } from '../types';
import type { BudgetedBill } from './billingService';

/** 格式化日期为 YYYY-MM-DD */
export function formatLocalYMD(d: Date | string | undefined | null): string {
    if (!d) return '—';
    const dt = d instanceof Date ? d : new Date(d);
    if (Number.isNaN(dt.getTime())) return '—';
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

/** 判断某个月份是否与免租期有重叠 */
export function monthOverlapsRentFree(year: number, month: number, periods: RentFreePeriod[]): boolean {
    if (!periods?.length) return false;
    const ms = new Date(year, month, 1);
    const me = new Date(year, month + 1, 0);
    return periods.some((p) => {
        const ps = new Date(p.start);
        const pe = new Date(p.end);
        return !Number.isNaN(ps.getTime()) && !Number.isNaN(pe.getTime()) && ps <= me && pe >= ms;
    });
}

/** 当年历月与免租期重叠的紧凑描述，如「2–4月、9月」 */
export function formatYearRentFreeSummary(year: number, periods: RentFreePeriod[] | undefined): string {
    if (!periods?.length) return '—';
    const hit: number[] = [];
    for (let m = 0; m < 12; m++) {
        if (monthOverlapsRentFree(year, m, periods)) hit.push(m);
    }
    if (hit.length === 0) return '—';
    const parts: string[] = [];
    let i = 0;
    while (i < hit.length) {
        const start = hit[i];
        let end = start;
        while (i + 1 < hit.length && hit[i + 1] === end + 1) {
            end = hit[i + 1];
            i++;
        }
        i++;
        if (start === end) parts.push(`${start + 1}月`);
        else parts.push(`${start + 1}–${end + 1}月`);
    }
    return parts.join('、');
}

/** 房号/单元名：numeric 字符串比较，避免 2 与 10 错乱 */
export function compareUnitNameNumeric(a: string, b: string): number {
    return a.localeCompare(b, 'zh-CN', { numeric: true, sensitivity: 'base' });
}

/** 获取租户在某楼宇下对应的 Unit 对象列表 */
export function tenantUnitsResolved(t: Tenant, building: Building | undefined): Unit[] {
    if (!building) return [];
    return t.unitIds.map((uid) => building.units.find((u) => u.id === uid)).filter((u): u is Unit => !!u);
}

/** 租户房间号合并标签，如「101、102、201」 */
export function tenantMergedRoomLabels(t: Tenant, building: Building | undefined): string {
    const units = tenantUnitsResolved(t, building);
    if (!units.length) return t.unitIds.join('、');
    return [...units].sort((a, b) => compareUnitNameNumeric(a.name, b.name)).map((u) => u.name).join('、');
}

/** 付款周期中文标签 */
export const paymentCycleLabelMap: Record<Tenant['paymentCycle'], string> = {
    HalfMonthly: '半月付',
    Monthly: '月付',
    BiMonthly: '两月付',
    Quarterly: '季付',
    SemiAnnual: '半年付',
    Annual: '年付',
    Custom: '自定义',
};

export function paymentCycleLabel(cycle: Tenant['paymentCycle'] | undefined): string {
    return paymentCycleLabelMap[cycle || 'Quarterly'] || '季付';
}

/** 免租期处理方式标签 */
export function freeRentHandlingLabel(h?: Tenant['freeRentHandling']): string {
    if (h === 'Deduct') return '当期账单扣除';
    if (h === 'Defer') return '账期顺延';
    return '—';
}

/** 预算账单覆盖区间显示 */
export function budgetBillCoverageLabel(b: BudgetedBill): string {
    if (!b.coverageStart || !b.coverageEnd) return '—';
    return `${formatLocalYMD(b.coverageStart)} ~ ${formatLocalYMD(b.coverageEnd)}`;
}

/** 根据当前日期自动修正合同状态：
 *  - Expired（leaseEnd 尚未到）→ 恢复为 Active（修复续签误标）
 *  - Active/Expiring → Expired（leaseEnd 已过）
 *  - Pending → Active（leaseStart 已到或已过） */
export function transitionContractStatuses(tenants: Tenant[], today?: Date): Tenant[] {
    const now = endOfToday(today ?? new Date());
    let changed = false;
    const result = tenants.map((t) => {
        const leaseEnd = parseYMD(t.leaseEnd);
        const leaseStart = parseYMD(t.leaseStart);
        if (
            t.status === ContractStatus.Expired &&
            leaseEnd && leaseEnd > now
        ) {
            changed = true;
            return { ...t, status: ContractStatus.Active };
        }
        if (
            (t.status === ContractStatus.Active || t.status === ContractStatus.Expiring) &&
            leaseEnd && leaseEnd <= now
        ) {
            changed = true;
            return { ...t, status: ContractStatus.Expired };
        }
        if (
            t.status === ContractStatus.Pending &&
            leaseStart && leaseStart <= now
        ) {
            changed = true;
            return { ...t, status: ContractStatus.Active };
        }
        return t;
    });
    return changed ? result : tenants;
}

function endOfToday(d: Date): Date {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

function parseYMD(s: string): Date | null {
    if (!s) return null;
    const d = new Date(s + 'T00:00:00');
    return Number.isNaN(d.getTime()) ? null : d;
}
