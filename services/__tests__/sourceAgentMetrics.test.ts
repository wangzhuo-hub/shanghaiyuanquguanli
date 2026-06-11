import { describe, expect, it } from 'vitest';
import { ContractStatus } from '../../types';
import {
    computeSourceAgentMetrics,
    normalizeSourceAgentName,
    UNLABELED_SOURCE,
} from '../sourceAgentMetrics';

const baseTenant = {
    buildingId: 'b1',
    unitIds: ['u1'],
    totalArea: 100,
    leaseStart: '2024-01-01',
    signingDate: '2024-01-01',
    leaseEnd: '2026-12-31',
    monthlyRent: 10000,
    paymentCycle: 'Quarterly' as const,
    rentFreePeriods: [],
    depositAmount: 0,
    depositStatus: 'Unpaid' as const,
};

describe('sourceAgentMetrics', () => {
    it('normalizes empty source names to 未标注来源', () => {
        expect(normalizeSourceAgentName('')).toBe(UNLABELED_SOURCE);
        expect(normalizeSourceAgentName('  张三  ')).toBe('张三');
    });

    it('aggregates contracts by source and computes churn/stability', () => {
        const summary = computeSourceAgentMetrics(
            [
                {
                    ...baseTenant,
                    id: 't1',
                    name: 'A公司',
                    sourceAgentName: '张三',
                    status: ContractStatus.Active,
                },
                {
                    ...baseTenant,
                    id: 't2',
                    name: 'B公司',
                    sourceAgentName: '张三',
                    status: ContractStatus.Terminated,
                    terminationDate: '2025-06-01',
                    terminationType: 'Early',
                },
                {
                    ...baseTenant,
                    id: 't3',
                    name: 'C公司',
                    sourceAgentName: '李四中介',
                    status: ContractStatus.Active,
                },
                {
                    ...baseTenant,
                    id: 't4',
                    name: 'D公司',
                    status: ContractStatus.Active,
                },
            ] as any,
            'All',
            new Date('2026-05-01'),
        );

        expect(summary.totalContracts).toBe(4);
        expect(summary.labeledContracts).toBe(3);
        expect(summary.sourceCount).toBe(3);

        const zhang = summary.rows.find((r) => r.sourceName === '张三');
        expect(zhang?.contractCount).toBe(2);
        expect(zhang?.terminatedCount).toBe(1);
        expect(zhang?.churnRate).toBe(50);
        expect(zhang?.earlyTerminationRate).toBe(100);

        const unlabeled = summary.rows.find((r) => r.sourceName === UNLABELED_SOURCE);
        expect(unlabeled?.contractCount).toBe(1);
    });

    it('filters by current-year signings when period is Year', () => {
        const summary = computeSourceAgentMetrics(
            [
                {
                    ...baseTenant,
                    id: 'old',
                    name: '旧客户',
                    sourceAgentName: '张三',
                    signingDate: '2023-01-01',
                    leaseStart: '2023-01-01',
                    status: ContractStatus.Active,
                },
                {
                    ...baseTenant,
                    id: 'new',
                    name: '新客户',
                    sourceAgentName: '李四',
                    signingDate: '2026-03-01',
                    leaseStart: '2026-03-01',
                    status: ContractStatus.Active,
                },
            ] as any,
            'Year',
            new Date('2026-05-01'),
        );

        expect(summary.totalContracts).toBe(1);
        expect(summary.rows).toHaveLength(1);
        expect(summary.rows[0].sourceName).toBe('李四');
    });
});
