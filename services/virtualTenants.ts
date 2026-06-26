import {
    BudgetAssumption,
    Building,
    ContractStatus,
    DepositStatus,
    Tenant,
} from '../types';

const parseDateLocal = (dateInput: string | Date | undefined): Date => {
    if (!dateInput) return new Date();
    if (dateInput instanceof Date) {
        return new Date(dateInput.getFullYear(), dateInput.getMonth(), dateInput.getDate());
    }
    const parts = dateInput.split('-').map(Number);
    if (parts.length === 3) {
        return new Date(parts[0], parts[1] - 1, parts[2]);
    }
    return new Date(dateInput);
};

const toLocalDateString = (d: Date): string => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
};

/**
 * 根据预算假设生成虚拟租户。
 * 该逻辑不依赖账单引擎，单独拆出供发票/预算等界面轻量读取。
 */
export const getVirtualTenants = (
    tenants: Tenant[],
    buildings: Building[],
    assumptions: BudgetAssumption[],
): Tenant[] => {
    const virtualTenants: Tenant[] = [];

    const addMonths = (dateStr: string, months: number): string => {
        const d = parseDateLocal(dateStr);
        d.setMonth(d.getMonth() + months);
        return toLocalDateString(d);
    };

    const occupiedUnitIds = new Set<string>();
    const tenantById = new Map<string, Tenant>();
    tenants.forEach((t) => {
        if (!tenantById.has(t.id)) tenantById.set(t.id, t);
        if (t.status === 'Active' || t.status === 'Expiring' || t.status === 'Pending') {
            t.unitIds.forEach((id) => occupiedUnitIds.add(id));
        }
    });

    const vacancyAssumptionByUnitId = new Map<string, BudgetAssumption>();
    assumptions.forEach((assumption) => {
        if (assumption.targetType !== 'Vacancy') return;
        if (!vacancyAssumptionByUnitId.has(assumption.targetId)) {
            vacancyAssumptionByUnitId.set(assumption.targetId, assumption);
        }
    });

    buildings.forEach((building) => {
        building.units.forEach((unit) => {
            if (unit.isSelfUse || occupiedUnitIds.has(unit.id) || unit.status === 'Occupied') return;
            const assumption = vacancyAssumptionByUnitId.get(unit.id);
            if (!assumption?.projectedSignDate) return;

            const start = parseDateLocal(assumption.projectedSignDate);
            const end = new Date(start);
            end.setFullYear(end.getFullYear() + 5);
            const firstPayDate = addMonths(assumption.projectedSignDate, assumption.projectedRentFreeMonths || 0);

            virtualTenants.push({
                id: `virt_vac_${unit.id}`,
                name: '待租去化 (预算)',
                buildingId: building.id,
                unitIds: [unit.id],
                totalArea: unit.area,
                leaseStart: assumption.projectedSignDate,
                leaseEnd: toLocalDateString(end),
                unitPrice: assumption.projectedUnitPrice,
                monthlyRent: 0,
                paymentCycle: 'Quarterly',
                paymentCycleMonths: 3,
                firstPaymentMonths: 3,
                firstPaymentDate: firstPayDate,
                depositAmount: 0,
                depositStatus: DepositStatus.Unpaid,
                status: ContractStatus.Active,
                rentFreePeriods: assumption.projectedRentFreeMonths > 0
                    ? [{
                        start: assumption.projectedSignDate,
                        end: toLocalDateString(new Date(new Date(start).setMonth(start.getMonth() + assumption.projectedRentFreeMonths))),
                        description: 'Budget Rent Free',
                    }]
                    : [],
                freeRentHandling: 'Defer',
            });
        });
    });

    assumptions.forEach((assumption) => {
        if (assumption.targetType === 'Vacancy' || assumption.targetType === 'Existing') return;

        const tenant = tenantById.get(assumption.targetId);
        if (!tenant) return;

        let newStart: Date | null = null;

        if (assumption.targetType === 'Renewal' && assumption.strategy !== 'ReLease') {
            const leaseEnd = parseDateLocal(tenant.leaseEnd);
            leaseEnd.setDate(leaseEnd.getDate() + 1);
            newStart = leaseEnd;
        } else if (assumption.strategy === 'ReLease' || assumption.targetType === 'RiskTermination') {
            const baseDate = assumption.targetType === 'RiskTermination' && assumption.projectedTerminationDate
                ? parseDateLocal(assumption.projectedTerminationDate)
                : parseDateLocal(tenant.leaseEnd);
            if (Number.isNaN(baseDate.getTime())) return;

            const gap = assumption.vacancyGapMonths || 0;
            newStart = new Date(baseDate);
            newStart.setMonth(newStart.getMonth() + gap);
            newStart.setDate(newStart.getDate() + 1);
        }

        if (!newStart) return;

        const newStartStr = toLocalDateString(newStart);
        const newEnd = new Date(newStart);
        newEnd.setFullYear(newEnd.getFullYear() + 3);
        const firstPayDate = addMonths(newStartStr, assumption.projectedRentFreeMonths || 0);

        virtualTenants.push({
            ...tenant,
            id: `virt_${assumption.targetType}_${tenant.id}`,
            name: `${tenant.name} (${assumption.targetType === 'Renewal' ? '续签' : '调改'})`,
            leaseStart: newStartStr,
            leaseEnd: toLocalDateString(newEnd),
            unitPrice: assumption.projectedUnitPrice,
            monthlyRent: 0,
            rentFreePeriods: assumption.projectedRentFreeMonths > 0
                ? [{
                    start: newStartStr,
                    end: toLocalDateString(new Date(new Date(newStart).setMonth(newStart.getMonth() + assumption.projectedRentFreeMonths))),
                    description: 'Assumption Rent Free',
                }]
                : [],
            firstPaymentDate: firstPayDate,
            freeRentHandling: 'Defer',
            status: ContractStatus.Active,
            depositStatus: DepositStatus.Unpaid,
        });
    });

    return virtualTenants;
};
