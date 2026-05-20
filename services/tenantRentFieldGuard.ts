import type { AuthUser } from '../types';
import type { DirtyPayload } from './dirtyTracker';
import type { PbRecordMap } from './dataDiff';
import { canViewRentPricing } from './receivablePermissions';

/** pb_tenants 中属于「租金/押金/免租」的字段 —— 物业脱敏账号不得通过 diff 改写 */
export const RENT_TENANT_PB_FIELDS: readonly string[] = [
    'unit_price',
    'unit_price_mode',
    'monthly_rent',
    'rent_free_periods',
    'rent_reductions',
    'free_rent_handling',
    'deposit_amount',
    'first_receivable_amount',
    'first_receivable_start_date',
    'first_receivable_end_date',
    'payment_terms',
];

const RENT_FIELD_SET = new Set(RENT_TENANT_PB_FIELDS);

export function shouldMaskRentFieldsForUser(user: AuthUser | null | undefined): boolean {
    if (!user) return false;
    return !canViewRentPricing(user);
}

/** 脱敏账号保存前：用 baseline 还原租户租金字段，避免 monthlyRent=0 写入 PB */
export function preserveRentFieldsInTenantPbMap(
    next: PbRecordMap,
    baseline: PbRecordMap | null | undefined,
    user: AuthUser | null | undefined,
): PbRecordMap {
    if (!shouldMaskRentFieldsForUser(user) || !baseline?.pb_tenants) return next;
    const tenantRows = next.pb_tenants;
    if (!tenantRows) return next;

    const mergedTenants: PbRecordMap[string] = { ...tenantRows };
    for (const [id, row] of Object.entries(tenantRows)) {
        const baseRow = baseline.pb_tenants[id];
        if (!baseRow) continue;
        const patched = { ...row };
        for (const field of RENT_TENANT_PB_FIELDS) {
            if (baseRow[field] !== undefined) {
                patched[field] = baseRow[field];
            }
        }
        mergedTenants[id] = patched;
    }
    return { ...next, pb_tenants: mergedTenants };
}

/** 增量保存 payload：剔除租金字段变更；禁止物业账号删建租户 */
export function filterDirtyPayloadForRentMaskedUser(
    payload: DirtyPayload,
    user: AuthUser | null | undefined,
): DirtyPayload {
    if (!shouldMaskRentFieldsForUser(user)) return payload;

    const bucket = payload.pb_tenants;
    if (!bucket) return payload;

    const filtered = { ...payload, pb_tenants: { ...bucket } };
    filtered.pb_tenants.creates = [];
    filtered.pb_tenants.deletes = [];

    filtered.pb_tenants.updates = bucket.updates
        .map((u) => {
            const changed = { ...u.changedFields };
            for (const key of Object.keys(changed)) {
                if (RENT_FIELD_SET.has(key)) delete changed[key];
            }
            if (Object.keys(changed).length === 0) return null;
            return { ...u, changedFields: changed };
        })
        .filter((u): u is NonNullable<typeof u> => u !== null);

    if (
        filtered.pb_tenants.creates.length === 0 &&
        filtered.pb_tenants.updates.length === 0 &&
        filtered.pb_tenants.deletes.length === 0
    ) {
        const { pb_tenants: _omit, ...rest } = filtered;
        return rest;
    }
    return filtered;
}
