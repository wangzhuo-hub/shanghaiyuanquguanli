import { describe, expect, it } from 'vitest';
import { mapTenantAppDataToPbTenantRow } from '../mcpIncrementalSave';

describe('mapTenantAppDataToPbTenantRow', () => {
    it('keeps billing-critical contract fields for full tenant restores', () => {
        const row = mapTenantAppDataToPbTenantRow(
            {
                id: 't1776994815161_10',
                rootId: '',
                name: '北京快乐庄园摄影中心',
                buildingId: 'b1776414613524',
                unitIds: ['b1776414613524-4-7-713'],
                totalArea: 193,
                signingDate: '2023-07-20',
                leaseStart: '2023-07-21',
                leaseEnd: '2026-07-20',
                unitPrice: 1.04,
                unitPriceMode: 'daily',
                monthlyRent: 6105.23,
                paymentCycle: 'Quarterly',
                paymentCycleMonths: 3,
                firstPaymentDate: '2023-07-20',
                firstPaymentMonths: 3,
                firstReceivableAmount: 0,
                rentFreePeriods: [
                    { start: '2023-10-21', end: '2023-11-20', description: '免租期' },
                ],
                unitTerms: [
                    {
                        unitId: 'b1776414613524-4-7-713',
                        unitName: '4-7-713',
                        area: 193,
                        unitPrice: 1.04,
                        monthlyRent: 6105.23,
                    },
                ],
                depositAmount: 18315.7,
                depositStatus: 'Unpaid',
                status: 'Active',
                paymentPeriodShiftMonths: 0,
            },
            't1776994815161_10',
            'beijing_park',
        );

        expect(row).toMatchObject({
            original_id: 't1776994815161_10',
            project_id: 'beijing_park',
            root_id: '',
            first_payment_date: '2023-07-20',
            first_payment_months: 3,
            first_receivable_amount: 0,
            rent_free_periods: [
                { start: '2023-10-21', end: '2023-11-20', description: '免租期' },
            ],
            payment_terms: [
                {
                    unitId: 'b1776414613524-4-7-713',
                    unitName: '4-7-713',
                    area: 193,
                    unitPrice: 1.04,
                    monthlyRent: 6105.23,
                },
            ],
            deposit_amount: 18315.7,
            payment_period_shift_months: 0,
        });
    });

    it('does not default missing fields during partial updates', () => {
        const row = mapTenantAppDataToPbTenantRow(
            { monthlyRent: 2857.34 },
            't1776994414581_5',
            'beijing_park',
        );

        expect(row).toEqual({
            original_id: 't1776994414581_5',
            project_id: 'beijing_park',
            monthly_rent: 2857.34,
        });
    });
});
