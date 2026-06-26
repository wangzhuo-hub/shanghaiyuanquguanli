import { ContractStatus, Tenant } from '../types';
import { parseDateLocal } from './billingLightweight';

/** 不计入当年新签面积的原因（供导出/Agent 标注） */
export type NewSigningExcludeReason =
    | 'expired_or_terminated'
    | 'pending_renewal_draft'
    | 'pending_future_lease';

function endOfLocalDay(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

function signingYear(tenant: Tenant): number | null {
    const signStr = tenant.signingDate || tenant.leaseStart;
    if (!signStr) return null;
    const signDate = parseDateLocal(signStr);
    if (Number.isNaN(signDate.getTime())) return null;
    return signDate.getFullYear();
}

/**
 * 判断合同是否应排除在「当年新签面积」之外。
 * - 续签链上的 Pending 草稿（有 rootId）→ 待起租/签约中，与在租主合同重复
 * - Pending 且起租日晚于统计日 → 真正待起租
 */
export function getNewSigningExcludeReason(
    tenant: Tenant,
    year: number,
    referenceDate = new Date(),
): NewSigningExcludeReason | null {
    if (signingYear(tenant) !== year) return null;

    if (tenant.status === ContractStatus.Expired || tenant.status === ContractStatus.Terminated) {
        return 'expired_or_terminated';
    }

    if (tenant.status === ContractStatus.Pending && (tenant.rootId || '').trim()) {
        return 'pending_renewal_draft';
    }

    if (tenant.status === ContractStatus.Pending && tenant.leaseStart) {
        const leaseStart = parseDateLocal(tenant.leaseStart);
        const ref = endOfLocalDay(referenceDate);
        if (!Number.isNaN(leaseStart.getTime()) && leaseStart > ref) {
            return 'pending_future_lease';
        }
    }

    return null;
}

/** 是否计入当年新签面积（与看板 KPI、OpenClaw 导出口径一致） */
export function isNewSigningInYear(tenant: Tenant, year: number, referenceDate = new Date()): boolean {
    if (signingYear(tenant) !== year) return false;
    return getNewSigningExcludeReason(tenant, year, referenceDate) === null;
}

export function listNewSigningsInYear(
    tenants: Tenant[],
    year: number,
    referenceDate = new Date(),
): Tenant[] {
    return tenants.filter((t) => isNewSigningInYear(t, year, referenceDate));
}

/** 导出/Agent 用：合同在新签明细中的展示状态 */
export function newSigningDetailStatusLabel(
    tenant: Tenant,
    year: number,
    referenceDate = new Date(),
): string {
    const exclude = getNewSigningExcludeReason(tenant, year, referenceDate);
    if (exclude === 'pending_renewal_draft') return '待起租（续签草稿）';
    if (exclude === 'pending_future_lease') return '待起租';
    if (exclude === 'expired_or_terminated') return tenant.status === ContractStatus.Terminated ? '已退租' : '已到期';
    if (tenant.status === ContractStatus.Terminated) return '已退租';
    if (tenant.status === ContractStatus.Pending) return '签约中';
    return '在租';
}
