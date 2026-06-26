import { describe, expect, it } from 'vitest';
import { ContractStatus, type Tenant } from '../../types';
import {
    buildExpiringContractView,
    filterContractListTenants,
    shouldBuildContractAssetLookup,
    shouldBuildContractListRows,
} from '../contractListFilters';

const tenant = (patch: Partial<Tenant> & Pick<Tenant, 'id' | 'name' | 'status' | 'leaseStart'>): Tenant =>
    ({
        buildingId: 'b1',
        unitIds: [],
        totalArea: 0,
        leaseEnd: '2026-12-31',
        monthlyRent: 0,
        rentFreePeriods: [],
        paymentCycle: 'Monthly',
        firstPaymentDate: '2026-01-01',
        depositAmount: 0,
        depositStatus: 'Unpaid',
        ...patch,
    }) as Tenant;

const baseOptions = {
    searchTerm: '',
    filterBuilding: 'all',
    filterStatus: 'all',
    filterPaymentCycle: 'all',
} as const;

describe('contract list filters', () => {
    it('skips list filtering for non-list tabs', () => {
        expect(shouldBuildContractListRows('Analysis')).toBe(false);
        expect(shouldBuildContractListRows('SourceAnalysis')).toBe(false);
        expect(shouldBuildContractListRows('Expiring')).toBe(false);

        const rows = filterContractListTenants([
            tenant({ id: 'active', name: '在租客户', status: ContractStatus.Active, leaseStart: '2026-01-01' }),
        ], {
            ...baseOptions,
            activeTab: 'Analysis',
        });

        expect(rows).toEqual([]);
    });

    it('builds asset lookup only for views that render tenant locations', () => {
        expect(shouldBuildContractAssetLookup('List')).toBe(true);
        expect(shouldBuildContractAssetLookup('Terminated')).toBe(true);
        expect(shouldBuildContractAssetLookup('Expiring')).toBe(true);
        expect(shouldBuildContractAssetLookup('Analysis')).toBe(false);
        expect(shouldBuildContractAssetLookup('SourceAnalysis')).toBe(false);
    });

    it('preserves active list filtering and leaseStart descending order', () => {
        const rows = filterContractListTenants([
            tenant({ id: 'old', name: '客户A', status: ContractStatus.Active, leaseStart: '2026-01-01' }),
            tenant({ id: 'new', name: '客户B', status: ContractStatus.Pending, leaseStart: '2026-03-01' }),
            tenant({ id: 'terminated', name: '客户C', status: ContractStatus.Terminated, leaseStart: '2026-04-01' }),
            tenant({ id: 'expired', name: '客户D', status: ContractStatus.Expired, leaseStart: '2026-05-01' }),
        ], {
            ...baseOptions,
            activeTab: 'List',
        });

        expect(rows.map((row) => row.id)).toEqual(['new', 'old']);
    });

    it('preserves terminated list filtering and extra predicates', () => {
        const rows = filterContractListTenants([
            tenant({
                id: 'match',
                name: '君科',
                status: ContractStatus.Terminated,
                leaseStart: '2026-02-01',
                buildingId: 'b2',
                paymentCycle: 'Quarterly',
                isRisk: true,
            }),
            tenant({
                id: 'wrong-building',
                name: '君科',
                status: ContractStatus.Terminated,
                leaseStart: '2026-03-01',
                buildingId: 'b1',
                paymentCycle: 'Quarterly',
                isRisk: true,
            }),
            tenant({
                id: 'active',
                name: '君科',
                status: ContractStatus.Active,
                leaseStart: '2026-04-01',
                buildingId: 'b2',
                paymentCycle: 'Quarterly',
                isRisk: true,
            }),
        ], {
            activeTab: 'Terminated',
            searchTerm: '君',
            filterBuilding: 'b2',
            filterStatus: 'risk',
            filterPaymentCycle: 'Quarterly',
        });

        expect(rows.map((row) => row.id)).toEqual(['match']);
    });

    it('builds expiring contract summary and quarter groups in one pass-compatible result', () => {
        const view = buildExpiringContractView([
            tenant({
                id: 'overdue',
                name: '已过期',
                status: ContractStatus.Active,
                leaseStart: '2025-01-01',
                leaseEnd: '2026-04-30',
                monthlyRent: 10_000,
            }),
            tenant({
                id: 'this-month',
                name: '本月到期',
                status: ContractStatus.Active,
                leaseStart: '2025-01-01',
                leaseEnd: '2026-05-20',
                monthlyRent: 20_000,
            }),
            tenant({
                id: 'next-month',
                name: '下月到期',
                status: ContractStatus.Expiring,
                leaseStart: '2025-01-01',
                leaseEnd: '2026-06-10',
                monthlyRent: 30_000,
            }),
            tenant({
                id: 'later',
                name: '年内较晚',
                status: ContractStatus.Pending,
                leaseStart: '2025-01-01',
                leaseEnd: '2026-10-01',
                monthlyRent: 40_000,
            }),
            tenant({
                id: 'terminated',
                name: '已退租',
                status: ContractStatus.Terminated,
                leaseStart: '2025-01-01',
                leaseEnd: '2026-06-01',
                monthlyRent: 99_000,
            }),
            tenant({
                id: 'invalid',
                name: '错误日期',
                status: ContractStatus.Active,
                leaseStart: '2025-01-01',
                leaseEnd: 'bad-date',
                monthlyRent: 99_000,
            }),
        ], {
            year: 2026,
            now: new Date(2026, 4, 15),
            includeGroups: true,
        });

        expect(view.summary).toEqual({
            count: 4,
            overdue: 1,
            thisMonth: 1,
            nextMonth: 1,
            monthlyRent: 100_000,
        });
        expect(view.expiringTenants.map((row) => row.id)).toEqual([
            'overdue',
            'this-month',
            'next-month',
            'later',
        ]);
        expect(view.byQuarter.map((group) => [group.label, group.tenants.map((row) => row.id)])).toEqual([
            ['第二季度 (4-6月)', ['overdue', 'this-month', 'next-month']],
            ['第四季度 (10-12月)', ['later']],
        ]);
    });

    it('can skip quarter grouping when only the expiring summary is needed', () => {
        const view = buildExpiringContractView([
            tenant({
                id: 'active',
                name: '在租客户',
                status: ContractStatus.Active,
                leaseStart: '2025-01-01',
                leaseEnd: '2026-08-01',
                monthlyRent: 12_000,
            }),
        ], {
            year: 2026,
            now: new Date(2026, 4, 15),
            includeGroups: false,
        });

        expect(view.summary.count).toBe(1);
        expect(view.expiringTenants).toEqual([]);
        expect(view.byQuarter).toEqual([]);
    });
});
