import { describe, expect, it } from 'vitest';
import { ContractStatus, DepositStatus, type Tenant } from '../../types';
import { buildRenewalContractDraft } from '../contractRenewal';

describe('buildRenewalContractDraft', () => {
    it('creates a new linked contract without mutating the original', () => {
        const original: Tenant = {
            id: 't1776994815161_10',
            name: '北京快乐庄园摄影中心',
            buildingId: 'b1776414613524',
            unitIds: ['b1776414613524-4-7-713'],
            totalArea: 193,
            signingDate: '2023-07-20',
            leaseStart: '2023-07-21',
            leaseEnd: '2026-07-20',
            firstPaymentDate: '2023-07-20',
            paymentCycle: 'Quarterly',
            paymentCycleMonths: 3,
            firstPaymentMonths: 3,
            monthlyRent: 6105.23,
            unitPrice: 1.04,
            rentFreePeriods: [{ start: '2024-10-21', end: '2024-11-20', description: '旧合同免租' }],
            rentReductions: [{ id: 'old-red', start: '2025-01-01', end: '2025-01-31', reductionAmount: 100 }],
            paymentPeriodShiftMonths: 1,
            paymentPeriodAdjustments: [
                {
                    id: 'old-adj',
                    originalYear: 2026,
                    originalMonth: 2,
                    adjustedYear: 2026,
                    adjustedMonth: 3,
                    amount: 100,
                    reason: '测试调整',
                },
            ],
            firstReceivableAmount: 1,
            firstReceivableStartDate: '2023-07-21',
            firstReceivableEndDate: '2023-10-20',
            depositAmount: 18315.7,
            depositStatus: DepositStatus.Paid,
            status: ContractStatus.Active,
        };

        const draft = buildRenewalContractDraft(original, {
            id: 't_new_renewal',
            today: new Date(2026, 5, 17),
        });

        expect(draft.id).toBe('t_new_renewal');
        expect(draft.rootId).toBe('t1776994815161_10');
        expect(draft.leaseStart).toBe('2026-07-21');
        expect(draft.leaseEnd).toBe('2029-07-20');
        expect(draft.signingDate).toBe('2026-06-17');
        expect(draft.firstPaymentDate).toBe('2026-06-17');
        expect(draft.status).toBe(ContractStatus.Pending);
        expect(draft.depositStatus).toBe(DepositStatus.Unpaid);
        expect(draft.rentFreePeriods).toEqual([]);
        expect(draft.rentReductions).toEqual([]);
        expect(draft.paymentPeriodAdjustments).toEqual([]);
        expect(draft.paymentPeriodShiftMonths).toBe(0);
        expect(draft.firstReceivableAmount).toBeUndefined();
        expect(draft.firstReceivableStartDate).toBeUndefined();
        expect(draft.firstReceivableEndDate).toBeUndefined();

        expect(original.id).toBe('t1776994815161_10');
        expect(original.leaseStart).toBe('2023-07-21');
        expect(original.leaseEnd).toBe('2026-07-20');
        expect(original.rentFreePeriods).toHaveLength(1);
    });

    it('keeps an existing renewal chain root', () => {
        const draft = buildRenewalContractDraft(
            {
                id: 'renew-2',
                rootId: 'root-contract',
                name: '链上续签客户',
                buildingId: 'b1',
                unitIds: ['u1'],
                totalArea: 10,
                leaseStart: '2025-01-01',
                leaseEnd: '2025-12-31',
                firstPaymentDate: '2025-01-01',
                paymentCycle: 'Quarterly',
                monthlyRent: 100,
                rentFreePeriods: [],
                depositAmount: 0,
                depositStatus: DepositStatus.Unpaid,
                status: ContractStatus.Active,
            },
            { id: 'renew-3', today: new Date(2025, 10, 1) },
        );

        expect(draft.rootId).toBe('root-contract');
        expect(draft.leaseStart).toBe('2026-01-01');
        expect(draft.leaseEnd).toBe('2026-12-31');
    });
});
