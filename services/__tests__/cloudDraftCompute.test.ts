import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CloudConfig, DashboardData, Tenant } from '../../types';
import type { DirtyPayload } from '../dirtyTracker';
import {
    fetchCloudBudgetedBillsPreviewBatch,
    fetchCloudBudgetedBillsPreview,
    fetchCloudContractReceivableMonthly,
    fetchCloudContractAnalysisMetrics,
    fetchCloudDraftComputedBilling,
    fetchCloudDraftComputedDashboard,
    fetchCloudSourceAgentMetrics,
} from '../cloudComputeClient';

vi.mock('../cloudAuthToken', () => {
    return {
        getCurrentCloudAuthToken: vi.fn(() => 'auth-token'),
    };
});

const config: CloudConfig = {
    provider: 'pocketbase',
    autoSync: false,
    pocketbaseUrl: 'http://127.0.0.1:8090',
    projectId: 'shanghai_park',
};

const draftData = {
    tenants: [{ id: 't1', name: '测试客户' }],
    payments: [],
} as unknown as DashboardData;

const dirtyPayload: DirtyPayload = {
    pb_payments: {
        creates: [{
            originalId: 'p_draft_1',
            data: {
                id: 'p_draft_1',
                tenant_id: 't1',
                tenant_name: '测试客户',
                amount: 100,
                type: 'Rent',
                date: '2026-06-15',
                status: 'Received',
            },
        }],
        updates: [],
        deletes: [],
    },
};

describe('fetchCloudDraftComputedDashboard', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    it('posts the current draft dashboard data to the draft compute endpoint', async () => {
        const processedData = { ...draftData, occupancyRate: 88 } as DashboardData;
        const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => new Response(JSON.stringify({
            success: true,
            data: {
                ok: true,
                processed_data: processedData,
                full_year_monthly_trends: [],
                data_version: 7,
                computed_at: '2026-06-20T00:00:00.000Z',
            },
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        }));
        vi.stubGlobal('fetch', fetchMock);

        const result = await fetchCloudDraftComputedDashboard(config, draftData, {
            year: 2026,
            quarter: 'All',
            billingSelectedMonth: '2026-06',
            quickMode: true,
            includeCurrentMonthBilling: false,
        });

        expect(result.success).toBe(true);
        expect(result.processedData).toEqual(processedData);
        expect(result.dataVersion).toBe(7);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0];
        expect(String(url)).toContain('/api/integration/app/dashboard/compute-draft');
        expect((init as RequestInit).headers).toMatchObject({
            Authorization: 'Bearer auth-token',
            'Content-Type': 'application/json',
        });
        expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({
            project_id: 'shanghai_park',
            year: 2026,
            quarter: 'All',
            billing_selected_month: '2026-06',
            quick_mode: true,
            draft_data: draftData,
        });
    });

    it('posts dirty payload instead of full draft dashboard data when available', async () => {
        const processedData = { ...draftData, occupancyRate: 88 } as DashboardData;
        const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => new Response(JSON.stringify({
            success: true,
            data: {
                ok: true,
                processed_data: processedData,
                full_year_monthly_trends: [],
                data_version: 8,
            },
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        }));
        vi.stubGlobal('fetch', fetchMock);

        const result = await fetchCloudDraftComputedDashboard(config, draftData, {
            year: 2026,
            quarter: 'All',
            billingSelectedMonth: '2026-06',
            quickMode: true,
        }, {
            dirtyPayload,
            baseVersion: 12,
        });

        expect(result.success).toBe(true);
        const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
        expect(body).toMatchObject({
            project_id: 'shanghai_park',
            draft_payload: dirtyPayload,
            draft_base_version: 12,
        });
        expect(body).not.toHaveProperty('draft_data');
    });

    it('returns a failure result when the draft compute endpoint rejects the request', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
            success: false,
            error: { message: '草稿计算失败' },
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        })));

        const result = await fetchCloudDraftComputedDashboard(config, draftData, {
            year: 2026,
            quarter: 'All',
            billingSelectedMonth: '2026-06',
        });

        expect(result.success).toBe(false);
        expect(result.message).toContain('草稿计算失败');
    });

    it('deduplicates concurrent dashboard draft compute requests for the same draft data', async () => {
        const processedData = { ...draftData, occupancyRate: 88 } as DashboardData;
        const fetchMock = vi.fn(async () => new Response(JSON.stringify({
            success: true,
            data: {
                ok: true,
                processed_data: processedData,
                full_year_monthly_trends: [],
                data_version: 7,
            },
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        }));
        vi.stubGlobal('fetch', fetchMock);
        const options = {
            year: 2026,
            quarter: 'All' as const,
            billingSelectedMonth: '2026-06',
            quickMode: true,
        };

        const [first, second] = await Promise.all([
            fetchCloudDraftComputedDashboard(config, draftData, options),
            fetchCloudDraftComputedDashboard(config, draftData, options),
        ]);

        expect(first.success).toBe(true);
        expect(second.success).toBe(true);
        expect(fetchMock).toHaveBeenCalledTimes(1);

        await fetchCloudDraftComputedDashboard(config, draftData, options);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('deduplicates shallow-cloned dashboard draft data with the same tracked inputs', async () => {
        const processedData = { ...draftData, occupancyRate: 88 } as DashboardData;
        const fetchMock = vi.fn(async () => new Response(JSON.stringify({
            success: true,
            data: {
                ok: true,
                processed_data: processedData,
                full_year_monthly_trends: [],
                data_version: 7,
            },
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        }));
        vi.stubGlobal('fetch', fetchMock);
        const options = {
            year: 2026,
            quarter: 'All' as const,
            billingSelectedMonth: '2026-06',
            quickMode: true,
        };

        const [first, second] = await Promise.all([
            fetchCloudDraftComputedDashboard(config, draftData, options),
            fetchCloudDraftComputedDashboard(config, { ...draftData } as DashboardData, options),
        ]);

        expect(first.success).toBe(true);
        expect(second.success).toBe(true);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('does not deduplicate dashboard draft data when sealed month inputs differ', async () => {
        const processedData = { ...draftData, occupancyRate: 88 } as DashboardData;
        const fetchMock = vi.fn(async () => new Response(JSON.stringify({
            success: true,
            data: {
                ok: true,
                processed_data: processedData,
                full_year_monthly_trends: [],
                data_version: 7,
            },
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        }));
        vi.stubGlobal('fetch', fetchMock);
        const options = {
            year: 2026,
            quarter: 'All' as const,
            billingSelectedMonth: '2026-06',
            quickMode: true,
        };
        const withJanuarySeal = {
            ...draftData,
            sealedMonths: [{ year: 2025, month: 1, arrearsIncrement: 100 }],
        } as DashboardData;
        const withFebruarySeal = {
            ...draftData,
            sealedMonths: [{ year: 2025, month: 2, arrearsIncrement: 200 }],
        } as DashboardData;

        const [first, second] = await Promise.all([
            fetchCloudDraftComputedDashboard(config, withJanuarySeal, options),
            fetchCloudDraftComputedDashboard(config, withFebruarySeal, options),
        ]);

        expect(first.success).toBe(true);
        expect(second.success).toBe(true);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
});

describe('fetchCloudDraftComputedBilling', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    it('posts the current draft dashboard data to the draft billing endpoint', async () => {
        const billingDetails = [{ tenantId: 't1', amountDue: 100, amountPaid: 20 }];
        const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => new Response(JSON.stringify({
            success: true,
            data: {
                ok: true,
                billingDetails,
                totalDue: 100,
                totalPaid: 20,
                unpaidCount: 1,
                dataVersion: 7,
                computedAt: '2026-06-20T00:00:00.000Z',
            },
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        }));
        vi.stubGlobal('fetch', fetchMock);

        const result = await fetchCloudDraftComputedBilling(config, draftData, {
            year: 2026,
            month: 6,
        });

        expect(result.success).toBe(true);
        expect(result.billingDetails).toEqual(billingDetails);
        expect(result.totalDue).toBe(100);
        const [url, init] = fetchMock.mock.calls[0];
        expect(String(url)).toContain('/api/integration/app/compute/billing-draft');
        expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({
            project_id: 'shanghai_park',
            year: 2026,
            month: 6,
            draft_data: draftData,
        });
    });

    it('posts dirty payload instead of full draft dashboard data for billing draft compute', async () => {
        const billingDetails = [{ tenantId: 't1', amountDue: 100, amountPaid: 20 }];
        const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => new Response(JSON.stringify({
            success: true,
            data: {
                ok: true,
                billingDetails,
                totalDue: 100,
                totalPaid: 20,
                unpaidCount: 1,
            },
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        }));
        vi.stubGlobal('fetch', fetchMock);

        const result = await fetchCloudDraftComputedBilling(config, draftData, {
            year: 2026,
            month: 6,
        }, {
            dirtyPayload,
            baseVersion: 12,
        });

        expect(result.success).toBe(true);
        const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
        expect(body).toMatchObject({
            project_id: 'shanghai_park',
            draft_payload: dirtyPayload,
            draft_base_version: 12,
        });
        expect(body).not.toHaveProperty('draft_data');
    });

    it('deduplicates concurrent draft billing requests for the same draft data and period', async () => {
        const billingDetails = [{ tenantId: 't1', amountDue: 100, amountPaid: 20 }];
        const fetchMock = vi.fn(async () => new Response(JSON.stringify({
            success: true,
            data: {
                ok: true,
                billingDetails,
                totalDue: 100,
                totalPaid: 20,
                unpaidCount: 1,
            },
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        }));
        vi.stubGlobal('fetch', fetchMock);
        const options = { year: 2026, month: 6 };

        const [first, second] = await Promise.all([
            fetchCloudDraftComputedBilling(config, draftData, options),
            fetchCloudDraftComputedBilling(config, draftData, options),
        ]);

        expect(first.success).toBe(true);
        expect(second.success).toBe(true);
        expect(fetchMock).toHaveBeenCalledTimes(1);

        await fetchCloudDraftComputedBilling(config, draftData, options);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('deduplicates shallow-cloned draft billing data with the same tracked inputs', async () => {
        const billingDetails = [{ tenantId: 't1', amountDue: 100, amountPaid: 20 }];
        const fetchMock = vi.fn(async () => new Response(JSON.stringify({
            success: true,
            data: {
                ok: true,
                billingDetails,
                totalDue: 100,
                totalPaid: 20,
                unpaidCount: 1,
            },
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        }));
        vi.stubGlobal('fetch', fetchMock);
        const options = { year: 2026, month: 6 };

        const [first, second] = await Promise.all([
            fetchCloudDraftComputedBilling(config, draftData, options),
            fetchCloudDraftComputedBilling(config, { ...draftData } as DashboardData, options),
        ]);

        expect(first.success).toBe(true);
        expect(second.success).toBe(true);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});

describe('fetchCloudBudgetedBillsPreview', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    it('posts tenant preview input to the backend preview endpoint and parses bill dates', async () => {
        const tenant = {
            id: 't1',
            name: '测试客户',
            buildingId: 'b1',
            unitIds: ['u1'],
            totalArea: 100,
            leaseStart: '2026-01-01',
            leaseEnd: '2026-12-31',
            monthlyRent: 10000,
            paymentCycle: 'Monthly',
            firstPaymentDate: '2026-01-05',
            depositAmount: 0,
            depositStatus: 'Unpaid',
            status: 'Active',
            rentFreePeriods: [],
        } as Tenant;
        const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => new Response(JSON.stringify({
            success: true,
            data: {
                ok: true,
                bills: [{
                    date: '2026-01-05T00:00:00.000Z',
                    amount: 100,
                    originalDate: '2025-12-05T00:00:00.000Z',
                    coverageStart: '2026-01-01T00:00:00.000Z',
                    coverageEnd: '2026-01-31T00:00:00.000Z',
                }],
                count: 1,
                computedAt: '2026-06-20T00:00:00.000Z',
            },
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        }));
        vi.stubGlobal('fetch', fetchMock);

        const result = await fetchCloudBudgetedBillsPreview(config, {
            tenant,
            assumptions: [],
            adjustments: [],
            startDate: new Date('2026-01-01T00:00:00.000Z'),
            endDate: new Date('2026-12-31T00:00:00.000Z'),
        });

        expect(result.success).toBe(true);
        expect(result.bills?.[0].date).toBeInstanceOf(Date);
        expect(result.bills?.[0].coverageStart).toBeInstanceOf(Date);
        expect(result.count).toBe(1);
        const [url, init] = fetchMock.mock.calls[0];
        expect(String(url)).toContain('/api/integration/app/compute/budgeted-bills-preview');
        expect((init as RequestInit).headers).toMatchObject({
            Authorization: 'Bearer auth-token',
            'Content-Type': 'application/json',
        });
        expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({
            project_id: 'shanghai_park',
            tenant,
            assumptions: [],
            adjustments: [],
            start_date: '2026-01-01T00:00:00.000Z',
            end_date: '2026-12-31T00:00:00.000Z',
        });
    });

    it('deduplicates identical single tenant preview requests while in flight', async () => {
        const tenant = {
            id: 't1',
            name: '测试客户',
            buildingId: 'b1',
            unitIds: ['u1'],
            totalArea: 100,
            leaseStart: '2026-01-01',
            leaseEnd: '2026-12-31',
            monthlyRent: 10000,
            paymentCycle: 'Monthly',
            firstPaymentDate: '2026-01-05',
            depositAmount: 0,
            depositStatus: 'Unpaid',
            status: 'Active',
            rentFreePeriods: [],
        } as Tenant;
        let resolveFetch: (() => void) | undefined;
        const fetchMock = vi.fn((_url: string, _init?: RequestInit) => new Promise<Response>((resolve) => {
            resolveFetch = () => resolve(new Response(JSON.stringify({
                success: true,
                data: {
                    ok: true,
                    bills: [],
                    count: 0,
                    computedAt: '2026-06-20T00:00:00.000Z',
                },
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            }));
        }));
        vi.stubGlobal('fetch', fetchMock);

        const input = {
            tenant,
            assumptions: [],
            adjustments: [],
            startDate: new Date('2026-01-01T00:00:00.000Z'),
            endDate: new Date('2026-12-31T00:00:00.000Z'),
        };
        const first = fetchCloudBudgetedBillsPreview(config, input);
        const second = fetchCloudBudgetedBillsPreview(config, input);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        resolveFetch?.();
        const [firstResult, secondResult] = await Promise.all([first, second]);
        expect(firstResult.success).toBe(true);
        expect(secondResult.success).toBe(true);
        expect(firstResult).toEqual(secondResult);
    });

    it('posts batch tenant preview inputs to the backend preview endpoint', async () => {
        const tenant = {
            id: 't1',
            name: '测试客户',
            buildingId: 'b1',
            unitIds: ['u1'],
            totalArea: 100,
            leaseStart: '2026-01-01',
            leaseEnd: '2026-12-31',
            monthlyRent: 10000,
            paymentCycle: 'Monthly',
            firstPaymentDate: '2026-01-05',
            depositAmount: 0,
            depositStatus: 'Unpaid',
            status: 'Active',
            rentFreePeriods: [],
        } as Tenant;
        const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => new Response(JSON.stringify({
            success: true,
            data: {
                ok: true,
                items: [{
                    id: 't1',
                    bills: [{
                        date: '2026-01-05T00:00:00.000Z',
                        amount: 100,
                        coverageStart: '2026-01-01T00:00:00.000Z',
                        coverageEnd: '2026-01-31T00:00:00.000Z',
                    }],
                    count: 1,
                }],
                count: 1,
                computedAt: '2026-06-20T00:00:00.000Z',
            },
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        }));
        vi.stubGlobal('fetch', fetchMock);

        const result = await fetchCloudBudgetedBillsPreviewBatch(config, {
            items: [{
                id: 't1',
                tenant,
                assumptions: [],
                adjustments: [],
                startDate: new Date('2026-01-01T00:00:00.000Z'),
                endDate: new Date('2026-12-31T00:00:00.000Z'),
            }],
        });

        expect(result.success).toBe(true);
        expect(result.items?.[0].id).toBe('t1');
        expect(result.items?.[0].bills[0].date).toBeInstanceOf(Date);
        const [url, init] = fetchMock.mock.calls[0];
        expect(String(url)).toContain('/api/integration/app/compute/budgeted-bills-preview-batch');
        expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({
            project_id: 'shanghai_park',
            items: [{
                id: 't1',
                tenant,
                start_date: '2026-01-01T00:00:00.000Z',
                end_date: '2026-12-31T00:00:00.000Z',
            }],
        });
    });

    it('deduplicates identical batch tenant preview requests while in flight', async () => {
        const tenant = {
            id: 't1',
            name: '测试客户',
            buildingId: 'b1',
            unitIds: ['u1'],
            totalArea: 100,
            leaseStart: '2026-01-01',
            leaseEnd: '2026-12-31',
            monthlyRent: 10000,
            paymentCycle: 'Monthly',
            firstPaymentDate: '2026-01-05',
            depositAmount: 0,
            depositStatus: 'Unpaid',
            status: 'Active',
            rentFreePeriods: [],
        } as Tenant;
        let resolveFetch: (() => void) | undefined;
        const fetchMock = vi.fn((_url: string, _init?: RequestInit) => new Promise<Response>((resolve) => {
            resolveFetch = () => resolve(new Response(JSON.stringify({
                success: true,
                data: {
                    ok: true,
                    items: [{ id: 't1', bills: [], count: 0 }],
                    count: 1,
                    computedAt: '2026-06-20T00:00:00.000Z',
                },
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            }));
        }));
        vi.stubGlobal('fetch', fetchMock);

        const input = {
            items: [{
                id: 't1',
                tenant,
                assumptions: [],
                adjustments: [],
                startDate: new Date('2026-01-01T00:00:00.000Z'),
                endDate: new Date('2026-12-31T00:00:00.000Z'),
            }],
        };
        const first = fetchCloudBudgetedBillsPreviewBatch(config, input);
        const second = fetchCloudBudgetedBillsPreviewBatch(config, input);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        resolveFetch?.();
        const [firstResult, secondResult] = await Promise.all([first, second]);
        expect(firstResult.success).toBe(true);
        expect(secondResult.success).toBe(true);
        expect(firstResult).toEqual(secondResult);
    });

    it('posts source agent metrics input to the backend compute endpoint', async () => {
        const tenant = {
            id: 't1',
            name: '测试客户',
            buildingId: 'b1',
            unitIds: ['u1'],
            totalArea: 100,
            leaseStart: '2026-01-01',
            leaseEnd: '2026-12-31',
            monthlyRent: 10000,
            paymentCycle: 'Monthly',
            firstPaymentDate: '2026-01-05',
            depositAmount: 0,
            depositStatus: 'Unpaid',
            status: 'Active',
            rentFreePeriods: [],
            sourceAgentName: '张三',
        } as Tenant;
        const summary = {
            period: 'Year',
            totalContracts: 1,
            labeledContracts: 1,
            labeledRate: 100,
            unlabeledCount: 0,
            sourceCount: 1,
            rows: [{
                sourceName: '张三',
                contractCount: 1,
                clientCount: 1,
                activeCount: 1,
                terminatedCount: 0,
                signedArea: 100,
                activeArea: 100,
                terminatedArea: 0,
                churnRate: 0,
                earlyTerminationRate: 0,
                renewalCount: 0,
                avgTenureMonths: 1,
                stabilityScore: 70,
                tenantIds: ['t1'],
            }],
            topBySignedArea: null,
            mostStable: null,
            signingTrend: [],
        };
        const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => new Response(JSON.stringify({
            success: true,
            data: {
                ok: true,
                summary,
                computedAt: '2026-06-20T00:00:00.000Z',
            },
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        }));
        vi.stubGlobal('fetch', fetchMock);

        const result = await fetchCloudSourceAgentMetrics(config, {
            tenants: [tenant],
            period: 'Year',
            referenceDate: '2026-06-20T00:00:00.000Z',
        });

        expect(result.success).toBe(true);
        expect(result.summary).toEqual(summary);
        expect(result.computedAt).toBe('2026-06-20T00:00:00.000Z');
        const [url, init] = fetchMock.mock.calls[0];
        expect(String(url)).toContain('/api/integration/app/compute/source-agent-metrics');
        expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({
            project_id: 'shanghai_park',
            tenants: [tenant],
            period: 'Year',
            reference_date: '2026-06-20T00:00:00.000Z',
        });
    });

    it('deduplicates source agent metrics requests on the same reference date', async () => {
        const tenant = {
            id: 't1',
            name: '测试客户',
            buildingId: 'b1',
            unitIds: ['u1'],
            totalArea: 100,
            leaseStart: '2026-01-01',
            leaseEnd: '2026-12-31',
            monthlyRent: 10000,
            paymentCycle: 'Monthly',
            firstPaymentDate: '2026-01-05',
            depositAmount: 0,
            depositStatus: 'Unpaid',
            status: 'Active',
            rentFreePeriods: [],
            sourceAgentName: '张三',
        } as Tenant;
        const summary = {
            period: 'Year',
            totalContracts: 0,
            labeledContracts: 0,
            labeledRate: 0,
            unlabeledCount: 0,
            sourceCount: 0,
            rows: [],
            topBySignedArea: null,
            mostStable: null,
            signingTrend: [],
        };
        let resolveFetch: (() => void) | undefined;
        const fetchMock = vi.fn((_url: string, _init?: RequestInit) => new Promise<Response>((resolve) => {
            resolveFetch = () => resolve(new Response(JSON.stringify({
                success: true,
                data: {
                    ok: true,
                    summary,
                    computedAt: '2026-06-20T00:00:00.000Z',
                },
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            }));
        }));
        vi.stubGlobal('fetch', fetchMock);

        const tenants = [tenant];
        const first = fetchCloudSourceAgentMetrics(config, {
            tenants,
            period: 'Year',
            referenceDate: new Date(2026, 5, 20, 9, 0, 0),
        });
        const second = fetchCloudSourceAgentMetrics(config, {
            tenants,
            period: 'Year',
            referenceDate: new Date(2026, 5, 20, 18, 30, 0),
        });

        expect(fetchMock).toHaveBeenCalledTimes(1);
        resolveFetch?.();
        const [firstResult, secondResult] = await Promise.all([first, second]);
        expect(firstResult.success).toBe(true);
        expect(secondResult.success).toBe(true);
        expect(firstResult).toEqual(secondResult);
    });

    it('posts contract analysis metrics input to the backend compute endpoint', async () => {
        const tenant = {
            id: 't1',
            name: '测试客户',
            buildingId: 'b1',
            unitIds: ['u1'],
            totalArea: 100,
            leaseStart: '2026-01-01',
            leaseEnd: '2026-12-31',
            monthlyRent: 10000,
            paymentCycle: 'Monthly',
            firstPaymentDate: '2026-01-05',
            depositAmount: 0,
            depositStatus: 'Unpaid',
            status: 'Active',
            rentFreePeriods: [],
            signingDate: '2026-06-01',
        } as Tenant;
        const metrics = {
            metrics: {
                signedCount: 1,
                signedArea: 100,
                terminatedCount: 0,
                terminatedArea: 0,
                netArea: 100,
            },
            mom: { area: 100, count: 100 },
            yoy: { area: 100, count: 100 },
            reasons: [],
            earlyRate: 0,
            trend: [],
            terminationStats: {
                all: 0,
                year: 0,
                quarter: 0,
                month: 0,
                earlyCount: 0,
                normalCount: 0,
            },
            terminationTypeData: [],
        };
        const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => new Response(JSON.stringify({
            success: true,
            data: {
                ok: true,
                metrics,
                computedAt: '2026-06-20T00:00:00.000Z',
            },
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        }));
        vi.stubGlobal('fetch', fetchMock);

        const result = await fetchCloudContractAnalysisMetrics(config, {
            tenants: [tenant],
            period: 'Month',
            referenceDate: '2026-06-20T00:00:00.000Z',
        });

        expect(result.success).toBe(true);
        expect(result.metrics).toEqual(metrics);
        expect(result.computedAt).toBe('2026-06-20T00:00:00.000Z');
        const [url, init] = fetchMock.mock.calls[0];
        expect(String(url)).toContain('/api/integration/app/compute/contract-analysis-metrics');
        expect((init as RequestInit).headers).toMatchObject({
            Authorization: 'Bearer auth-token',
            'Content-Type': 'application/json',
        });
        expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({
            project_id: 'shanghai_park',
            tenants: [tenant],
            period: 'Month',
            reference_date: '2026-06-20T00:00:00.000Z',
        });
    });

    it('deduplicates contract analysis metrics requests on the same reference date', async () => {
        const tenant = {
            id: 't1',
            name: '测试客户',
            buildingId: 'b1',
            unitIds: ['u1'],
            totalArea: 100,
            leaseStart: '2026-01-01',
            leaseEnd: '2026-12-31',
            monthlyRent: 10000,
            paymentCycle: 'Monthly',
            firstPaymentDate: '2026-01-05',
            depositAmount: 0,
            depositStatus: 'Unpaid',
            status: 'Active',
            rentFreePeriods: [],
            signingDate: '2026-06-01',
        } as Tenant;
        const metrics = {
            metrics: {
                signedCount: 0,
                signedArea: 0,
                terminatedCount: 0,
                terminatedArea: 0,
                netArea: 0,
            },
            mom: { area: 0, count: 0 },
            yoy: { area: 0, count: 0 },
            reasons: [],
            earlyRate: 0,
            trend: [],
            terminationStats: {
                all: 0,
                year: 0,
                quarter: 0,
                month: 0,
                earlyCount: 0,
                normalCount: 0,
            },
            terminationTypeData: [],
        };
        let resolveFetch: (() => void) | undefined;
        const fetchMock = vi.fn((_url: string, _init?: RequestInit) => new Promise<Response>((resolve) => {
            resolveFetch = () => resolve(new Response(JSON.stringify({
                success: true,
                data: {
                    ok: true,
                    metrics,
                    computedAt: '2026-06-20T00:00:00.000Z',
                },
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            }));
        }));
        vi.stubGlobal('fetch', fetchMock);

        const tenants = [tenant];
        const first = fetchCloudContractAnalysisMetrics(config, {
            tenants,
            period: 'Month',
            referenceDate: new Date(2026, 5, 20, 9, 0, 0),
        });
        const second = fetchCloudContractAnalysisMetrics(config, {
            tenants,
            period: 'Month',
            referenceDate: new Date(2026, 5, 20, 18, 30, 0),
        });

        expect(fetchMock).toHaveBeenCalledTimes(1);
        resolveFetch?.();
        const [firstResult, secondResult] = await Promise.all([first, second]);
        expect(firstResult.success).toBe(true);
        expect(secondResult.success).toBe(true);
        expect(firstResult).toEqual(secondResult);
    });

    it('posts contract receivable monthly context and parses tenant maps', async () => {
        const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => new Response(JSON.stringify({
            success: true,
            data: {
                ok: true,
                months: [{
                    month: 1,
                    total_amount_due: 123,
                    by_tenant_id: [{ tenant_id: 't1', amount: 123 }],
                }],
                computed_at: '2026-06-20T00:00:00.000Z',
            },
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        }));
        vi.stubGlobal('fetch', fetchMock);

        const result = await fetchCloudContractReceivableMonthly(config, {
            year: 2026,
            tenants: [{ id: 't1', name: '测试客户' } as Tenant],
            buildings: [],
            payments: [],
            initializationData: [],
            budgetAssumptions: [],
            budgetAdjustments: [],
            budgetScenarios: [],
        });

        expect(result.success).toBe(true);
        expect(result.months?.[0]).toEqual({
            month: 1,
            totalAmountDue: 123,
            byTenantId: [{ tenantId: 't1', amount: 123 }],
        });
        const [url, init] = fetchMock.mock.calls[0];
        expect(String(url)).toContain('/api/integration/app/compute/contract-receivable-monthly');
        expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({
            project_id: 'shanghai_park',
            year: 2026,
            tenants: [{ id: 't1', name: '测试客户' }],
            buildings: [],
            payments: [],
            initialization_data: [],
            budget_assumptions: [],
            budget_adjustments: [],
            budget_scenarios: [],
        });
    });

    it('deduplicates identical contract receivable monthly requests while in flight', async () => {
        let resolveFetch: (() => void) | undefined;
        const fetchMock = vi.fn((_url: string, _init?: RequestInit) => new Promise<Response>((resolve) => {
            resolveFetch = () => resolve(new Response(JSON.stringify({
                success: true,
                data: {
                    ok: true,
                    months: [],
                    computed_at: '2026-06-20T00:00:00.000Z',
                },
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            }));
        }));
        vi.stubGlobal('fetch', fetchMock);

        const input = {
            year: 2026,
            tenants: [{ id: 't1', name: '测试客户' } as Tenant],
            buildings: [],
            payments: [],
            initializationData: [],
            budgetAssumptions: [],
            budgetAdjustments: [],
            budgetScenarios: [],
        };
        const first = fetchCloudContractReceivableMonthly(config, input);
        const second = fetchCloudContractReceivableMonthly(config, input);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        resolveFetch?.();
        const [firstResult, secondResult] = await Promise.all([first, second]);
        expect(firstResult.success).toBe(true);
        expect(secondResult.success).toBe(true);
        expect(firstResult).toEqual(secondResult);
    });
});
