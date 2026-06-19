import { ContractStatus, DepositStatus, type LeaseUnitTerm, type Tenant } from '../types';

export type BuildRenewalContractDraftOptions = {
    id?: string;
    today?: Date;
    termYears?: number;
};

const formatLocalYMD = (d: Date): string => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
};

const parseLocalYMD = (value: string | undefined, fallback = new Date()): Date => {
    if (!value) return new Date(fallback.getFullYear(), fallback.getMonth(), fallback.getDate());
    const parts = value.split('-').map(Number);
    if (parts.length === 3 && parts.every(Number.isFinite)) {
        return new Date(parts[0], parts[1] - 1, parts[2]);
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return new Date(fallback.getFullYear(), fallback.getMonth(), fallback.getDate());
    }
    return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
};

const addYearsMinusOneDay = (start: Date, years: number): Date => {
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    end.setFullYear(end.getFullYear() + years);
    end.setDate(end.getDate() - 1);
    return end;
};

const inferWholeYearTerm = (tenant: Tenant): number | undefined => {
    const start = parseLocalYMD(tenant.leaseStart);
    const end = parseLocalYMD(tenant.leaseEnd);
    const endYmd = formatLocalYMD(end);
    for (let years = 1; years <= 20; years += 1) {
        if (formatLocalYMD(addYearsMinusOneDay(start, years)) === endYmd) return years;
    }
    return undefined;
};

const clearDatedUnitTermFields = (terms: LeaseUnitTerm[] | undefined): LeaseUnitTerm[] | undefined => {
    if (!Array.isArray(terms)) return undefined;
    return terms.map((term) => ({ ...term, rentFreePeriods: [] }));
};

/**
 * Build a new renewal contract draft while preserving the original contract as its own receivable source.
 * Contract-specific dated terms are cleared so old free-rent / first-receivable settings do not leak into the renewal.
 */
export function buildRenewalContractDraft(
    tenant: Tenant,
    options: BuildRenewalContractDraftOptions = {},
): Partial<Tenant> {
    const today = options.today ?? new Date();
    const signingDate = formatLocalYMD(today);
    const sourceEnd = parseLocalYMD(tenant.leaseEnd, today);
    const renewalStartDate = new Date(sourceEnd.getFullYear(), sourceEnd.getMonth(), sourceEnd.getDate());
    renewalStartDate.setDate(renewalStartDate.getDate() + 1);

    const termYears = options.termYears ?? inferWholeYearTerm(tenant) ?? 1;
    const renewalEndDate = addYearsMinusOneDay(renewalStartDate, termYears);
    const cleanedTerms = clearDatedUnitTermFields(tenant.unitTerms || tenant.paymentTerms);

    return {
        ...tenant,
        id: options.id || `t${Date.now()}_renewal`,
        rootId: tenant.rootId || tenant.id,
        leaseStart: formatLocalYMD(renewalStartDate),
        leaseEnd: formatLocalYMD(renewalEndDate),
        signingDate,
        firstPaymentDate: signingDate,
        firstReceivableAmount: undefined,
        firstReceivableStartDate: undefined,
        firstReceivableEndDate: undefined,
        rentFreePeriods: [],
        rentReductions: [],
        unitTerms: cleanedTerms,
        paymentTerms: cleanedTerms,
        paymentPeriodAdjustments: [],
        paymentPeriodShiftMonths: 0,
        paymentCycleChanges: [],
        status: ContractStatus.Pending,
        terminationDate: undefined,
        terminationType: undefined,
        terminationReason: '',
        parentContractId: undefined,
        earlyTerminationFreeRentClawbackOverride: undefined,
        earlyTerminationDepositDeduction: 0,
        earlyTerminationOtherAdjustment: 0,
        depositStatus: DepositStatus.Unpaid,
    };
}
