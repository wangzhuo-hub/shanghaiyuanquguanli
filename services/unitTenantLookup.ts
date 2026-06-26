import { ContractStatus, type Tenant } from '../types';

export function buildTenantByUnitIdForStatuses(
    tenants: Tenant[],
    statuses: ContractStatus[],
): Map<string, Tenant> {
    const tenantByUnitId = new Map<string, Tenant>();
    const allowed = new Set(statuses);
    for (const tenant of tenants) {
        if (!allowed.has(tenant.status)) continue;
        for (const unitId of tenant.unitIds || []) {
            if (!tenantByUnitId.has(unitId)) tenantByUnitId.set(unitId, tenant);
        }
    }
    return tenantByUnitId;
}

export function buildActiveTenantByUnitId(tenants: Tenant[]): Map<string, Tenant> {
    return buildTenantByUnitIdForStatuses(tenants, [ContractStatus.Active]);
}

export function buildActiveThenTerminatedTenantByUnitId(tenants: Tenant[]): Map<string, Tenant> {
    const tenantByUnitId = buildTenantByUnitIdForStatuses(tenants, [ContractStatus.Active]);
    for (const tenant of tenants) {
        if (tenant.status !== ContractStatus.Terminated) continue;
        for (const unitId of tenant.unitIds || []) {
            if (!tenantByUnitId.has(unitId)) tenantByUnitId.set(unitId, tenant);
        }
    }
    return tenantByUnitId;
}
