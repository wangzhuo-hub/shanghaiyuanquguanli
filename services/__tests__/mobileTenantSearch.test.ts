import { describe, expect, it } from 'vitest';
import { BillingDetail, Building, ContractStatus, PaymentRecord, Tenant } from '../../types';
import {
    buildMobileTenantSearchIndex,
    countMobileTenantSearchResults,
    filterMobileTenantSearchIndex,
    selectMobileTenantSearchResults,
    shouldBuildMobileTenantSearchIndexForView,
} from '../mobileTenantSearch';

const buildings: Building[] = [
    {
        id: 'b1',
        name: '一号楼',
        type: 'Building',
        units: [
            { id: 'u101', name: '101', floor: 1, area: 100, status: 'Occupied' as any },
            { id: 'u102', name: '102', floor: 1, area: 120, status: 'Occupied' as any },
        ],
    },
];

const tenant = (patch: Partial<Tenant>): Tenant =>
    ({
        id: 't-active',
        name: '客户A',
        buildingId: 'b1',
        unitIds: ['u101'],
        totalArea: 100,
        leaseStart: '2026-01-01',
        leaseEnd: '2026-12-31',
        status: ContractStatus.Active,
        rentFreePeriods: [],
        paymentCycle: 'Monthly',
        firstPaymentDate: '2026-01-01',
        monthlyRent: 10000,
        depositAmount: 10000,
        depositStatus: 'Paid' as any,
        ...patch,
    }) as Tenant;

const payment = (patch: Partial<PaymentRecord>): PaymentRecord =>
    ({
        id: 'p1',
        tenantId: 't-active',
        tenantName: '客户A',
        amount: 10000,
        type: 'Rent',
        date: '2026-06-01',
        status: 'Received',
        invoiceStatus: 'Pending',
        ...patch,
    }) as PaymentRecord;

const billingDetail = (patch: Partial<BillingDetail>): BillingDetail =>
    ({
        tenantId: 't-active',
        tenantName: '客户A',
        unitIds: ['u101'],
        amountDue: 10000,
        amountPaid: 0,
        status: 'Unpaid',
        feeKind: 'rent',
        ...patch,
    }) as BillingDetail;

describe('mobile tenant search', () => {
    it('builds the mobile search index only for mobile dashboard search mode', () => {
        expect(shouldBuildMobileTenantSearchIndexForView({
            mobileNavLayout: true,
            activeTab: 'dashboard',
            mobileDashboardMode: 'search',
        })).toBe(true);

        expect(shouldBuildMobileTenantSearchIndexForView({
            mobileNavLayout: false,
            activeTab: 'dashboard',
            mobileDashboardMode: 'search',
        })).toBe(false);

        expect(shouldBuildMobileTenantSearchIndexForView({
            mobileNavLayout: true,
            activeTab: 'finance',
            mobileDashboardMode: 'search',
        })).toBe(false);

        expect(shouldBuildMobileTenantSearchIndexForView({
            mobileNavLayout: true,
            activeTab: 'dashboard',
            mobileDashboardMode: 'overview',
        })).toBe(false);
    });

    it('sorts tenants by mobile status rank and lease end date', () => {
        const index = buildMobileTenantSearchIndex({
            buildings,
            tenants: [
                tenant({ id: 't-expired', name: '已到期', status: ContractStatus.Expired, leaseEnd: '2026-01-31' }),
                tenant({ id: 't-late', name: '履约晚到期', status: ContractStatus.Active, leaseEnd: '2026-12-31' }),
                tenant({ id: 't-early', name: '履约早到期', status: ContractStatus.Active, leaseEnd: '2026-03-31' }),
            ],
            payments: [],
        });

        expect(index.map((item) => item.id)).toEqual(['t-early', 't-late', 't-expired']);
        expect(index[0].statusLabel).toBe('履约中');
    });

    it('returns top non-terminated tenants for empty query without scanning after limit', () => {
        const index = buildMobileTenantSearchIndex({
            buildings,
            tenants: [
                tenant({ id: 't1', name: '一号客户', status: ContractStatus.Active, leaseEnd: '2026-01-01' }),
                tenant({ id: 't2', name: '二号客户', status: ContractStatus.Terminated, leaseEnd: '2026-01-02' }),
                tenant({ id: 't3', name: '三号客户', status: ContractStatus.Pending, leaseEnd: '2026-01-03' }),
            ],
            payments: [],
        });

        expect(selectMobileTenantSearchResults(index, '').map((item) => item.id)).toEqual(['t1', 't3']);
    });

    it('counts the same visible set as empty mobile search results', () => {
        const index = buildMobileTenantSearchIndex({
            buildings,
            tenants: [
                tenant({ id: 't1', name: '一号客户', status: ContractStatus.Active, leaseEnd: '2026-01-01' }),
                tenant({ id: 't2', name: '已退租客户', status: ContractStatus.Terminated, leaseEnd: '2026-01-02' }),
                tenant({ id: 't3', name: '三号客户', status: ContractStatus.Pending, leaseEnd: '2026-01-03' }),
            ],
            payments: [],
        });

        expect(countMobileTenantSearchResults(index, '')).toBe(2);
        expect(countMobileTenantSearchResults(index, '已退租')).toBe(1);
    });

    it('matches search text across tenant, contact, building and unit labels', () => {
        const index = buildMobileTenantSearchIndex({
            buildings,
            tenants: [
                tenant({
                    id: 't1',
                    name: '目标客户',
                    contactName: '张三',
                    legalRepName: '李四',
                    contactInfo: '13800000000',
                    industry: '软件',
                    unitIds: ['u101', 'u102'],
                }),
            ],
            payments: [],
        });

        const [result] = selectMobileTenantSearchResults(index, '102');
        expect(result).toMatchObject({
            id: 't1',
            location: '一号楼 · 101/102',
            helper: '联系人 张三',
        });
    });

    it('exposes stable building, expiry, payment and current-period receivable metadata for mobile filters', () => {
        const index = buildMobileTenantSearchIndex({
            buildings,
            tenants: [
                tenant({ id: 't1', name: '有收款客户', buildingId: 'b1', leaseEnd: '2026-08-31' }),
                tenant({ id: 't2', name: '无收款客户', buildingId: 'b1', leaseEnd: '2026-09-30' }),
            ],
            payments: [payment({ id: 'p1', tenantId: 't1', tenantName: '有收款客户', amount: 10000 })],
            billingDetails: [
                billingDetail({ tenantId: 't2', tenantName: '无收款客户', amountDue: 12000, amountPaid: 2000 }),
            ],
            historicalArrearsByTenantId: new Map([
                ['t1', { amount: 25000, months: 2, latestPeriod: '2026-05' }],
            ]),
        });

        expect(index.find((item) => item.id === 't1')).toMatchObject({
            buildingId: 'b1',
            buildingName: '一号楼',
            leaseEnd: '2026-08-31',
            leaseEndMonth: '2026-08',
            hasPaymentRecord: true,
            hasCurrentReceivableDue: false,
            hasHistoricalArrears: true,
            historicalArrearsAmount: 25000,
            historicalArrearsSummary: '历史欠费 2.5万 · 最近 2026-05',
        });
        expect(index.find((item) => item.id === 't2')).toMatchObject({
            buildingId: 'b1',
            buildingName: '一号楼',
            hasPaymentRecord: false,
            hasCurrentReceivableDue: true,
            currentReceivableDueAmount: 10000,
            receivableSummary: '当前账期未收 1.0万',
            hasHistoricalArrears: false,
        });
    });

    it('filters the mobile search index by status, building, expiry month, payment and current-period receivable state', () => {
        const index = buildMobileTenantSearchIndex({
            buildings,
            tenants: [
                tenant({ id: 't1', name: '履约有收款', status: ContractStatus.Active, buildingId: 'b1', leaseEnd: '2026-08-31' }),
                tenant({ id: 't2', name: '签约无收款', status: ContractStatus.Pending, buildingId: 'b1', leaseEnd: '2026-09-30' }),
                tenant({ id: 't3', name: '其他楼宇', status: ContractStatus.Active, buildingId: 'b2', leaseEnd: '2026-08-15' }),
            ],
            payments: [payment({ id: 'p1', tenantId: 't1', tenantName: '履约有收款', amount: 10000 })],
            billingDetails: [
                billingDetail({ tenantId: 't2', tenantName: '签约无收款', amountDue: 10000, amountPaid: 0 }),
            ],
            historicalArrearsByTenantId: new Map([
                ['t3', { amount: 32000, months: 1, latestPeriod: '2026-04' }],
            ]),
        });

        expect(filterMobileTenantSearchIndex(index, {
            status: ContractStatus.Active,
            buildingId: 'b1',
            leaseEndMonth: '2026-08',
            paymentFilter: 'paid',
        }).map((item) => item.id)).toEqual(['t1']);

        expect(filterMobileTenantSearchIndex(index, {
            buildingId: 'b1',
            leaseEndMonth: '2026-09',
            paymentFilter: 'none',
            receivableFilter: 'due',
        }).map((item) => item.id)).toEqual(['t2']);

        expect(filterMobileTenantSearchIndex(index, {
            buildingId: 'b1',
            receivableFilter: 'clear',
        }).map((item) => item.id)).toEqual(['t1']);

        expect(filterMobileTenantSearchIndex(index, {
            arrearsFilter: 'historical_due',
        }).map((item) => item.id)).toEqual(['t3']);

        expect(filterMobileTenantSearchIndex(index, {
            buildingId: 'b1',
            arrearsFilter: 'historical_clear',
        }).map((item) => item.id)).toEqual(['t1', 't2']);
    });

    it('deduplicates direct and same-name payment matches for the same tenant', () => {
        const index = buildMobileTenantSearchIndex({
            buildings,
            tenants: [tenant({ id: 't1', name: '同名客户' })],
            payments: [
                payment({ id: 'p1', tenantId: 't1', tenantName: '同名客户', amount: 10000, date: '2026-06-01' }),
                payment({ id: 'p1', tenantId: 't1', tenantName: '同名客户', amount: 10000, date: '2026-06-01' }),
            ],
        });

        expect(selectMobileTenantSearchResults(index, '同名客户')[0].paymentSummary).toBe('已收 1.0万 · 最近 2026-06-01');
    });

    it('deduplicates direct and same-name current-period receivable matches for the same tenant', () => {
        const index = buildMobileTenantSearchIndex({
            buildings,
            tenants: [tenant({ id: 't1', name: '同名客户' })],
            payments: [],
            billingDetails: [
                billingDetail({ tenantId: 't1', tenantName: '同名客户', amountDue: 10000, amountPaid: 2500 }),
            ],
        });

        expect(index[0]).toMatchObject({
            hasCurrentReceivableDue: true,
            currentReceivableDueAmount: 7500,
            receivableSummary: '当前账期未收 0.8万',
        });
    });
});
