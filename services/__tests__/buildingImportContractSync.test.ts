import { describe, expect, it } from 'vitest';
import { ContractStatus } from '../../types';
import { syncTenantFromBuildingImportRow } from '../buildingImportContractSync';

describe('syncTenantFromBuildingImportRow', () => {
    it('creates terminated tenant and flags unit vacant', () => {
        const row = {
            合同企业名称: '历史客户A',
            起租日期: '2023-01-01',
            结束日期: '2026-12-31',
            退租日期: '2025-06-30',
            月租金: 40000,
            合同状态: 'Terminated',
        };
        const { nextTenants, error, setUnitVacant } = syncTenantFromBuildingImportRow(
            row,
            'b1',
            'b1-101',
            [],
            0
        );
        expect(error).toBeUndefined();
        expect(setUnitVacant).toBe(true);
        expect(nextTenants).toHaveLength(1);
        expect(nextTenants[0].status).toBe(ContractStatus.Terminated);
        expect(nextTenants[0].terminationDate).toBe('2025-06-30');
    });

    it('keeps existing paymentCycle when template row omits 支付频率', () => {
        const existing = [
            {
                id: 't1',
                name: '停车场',
                buildingId: 'b1',
                unitIds: ['u1'],
                totalArea: 10,
                signingDate: '2026-01-01',
                leaseStart: '2026-01-01',
                leaseEnd: '2026-12-31',
                monthlyRent: 3000,
                paymentCycle: 'Monthly',
                depositAmount: 0,
                depositStatus: 'Unpaid',
                status: ContractStatus.Active,
                rentFreePeriods: [],
                keyMoments: [],
            } as any,
        ];
        const row = {
            合同企业名称: '停车场',
            起租日期: '2026-01-01',
            结束日期: '2026-12-31',
            月租金: 3000,
            // 故意不传“支付频率”
        };
        const { nextTenants, error } = syncTenantFromBuildingImportRow(
            row,
            'b1',
            'u1',
            existing,
            0
        );
        expect(error).toBeUndefined();
        expect(nextTenants).toHaveLength(1);
        expect(nextTenants[0].paymentCycle).toBe('Monthly');
    });
});
