import { describe, expect, it } from 'vitest';
import {
    DASHBOARD_CUSTOM_FIELD_OPTION_MAP,
    DEFAULT_CUSTOM_DASHBOARD_FIELD_IDS,
    normalizeDashboardCustomFieldIds,
} from '../dashboardCustomFields';
import { ContractStatus, DepositStatus, type DashboardData, type Tenant } from '../../types';

const tenant = (patch: Partial<Tenant>): Tenant => ({
    id: patch.id || 'tenant',
    name: patch.name || '测试客户',
    buildingId: 'b1',
    unitIds: [],
    totalArea: 0,
    signingDate: '2025-12-20',
    leaseStart: '2025-12-20',
    leaseEnd: '2026-12-19',
    monthlyRent: 0,
    rentFreePeriods: [],
    paymentCycle: 'Monthly',
    firstPaymentDate: '2025-12-20',
    depositAmount: 0,
    depositStatus: DepositStatus.Unpaid,
    status: ContractStatus.Active,
    ...patch,
});

const initMonth = (month: number, value: number) => ({
    year: 2026,
    month,
    revenueTarget: 0,
    revenueCollected: 0,
    occupancyRate: 0,
    initialBudget: value,
});

const dashboardData = (patch: Partial<DashboardData> = {}): DashboardData => ({
    buildings: [],
    tenants: [],
    payments: [],
    totalArea: 500,
    leasedArea: 180,
    occupancyRate: 36,
    vacantArea: 320,
    vacantUnits: 4,
    annualRevenueTarget: 900000,
    annualRevenueCollected: 450000,
    annualOccupancyTarget: 0,
    monthlyRevenueTarget: 0,
    monthlyRevenueCollected: 0,
    collectionRate: 0,
    accumulatedArrears: 0,
    newContractsCount: 0,
    newContractsArea: 0,
    terminatedContractsCount: 0,
    terminatedContractsArea: 0,
    netIncreaseArea: 0,
    expiringSoonCount: 0,
    recentSignings: [],
    expiringSoon: [],
    monthlyTrends: [],
    currentMonthBilling: [],
    parkingStats: {
        totalContractSpaces: 0,
        totalActualSpaces: 0,
        totalMonthlyRevenue: 0,
        details: [],
    },
    budgetAssumptions: [],
    budgetAdjustments: [],
    budgetAnalysis: { occupancy: '', revenue: '' },
    ...patch,
} as DashboardData);

const resolveField = (
    id: Parameters<typeof DASHBOARD_CUSTOM_FIELD_OPTION_MAP.get>[0],
    data: DashboardData,
    year = 2026,
    projectId = 'park_data_main',
) => {
    const option = DASHBOARD_CUSTOM_FIELD_OPTION_MAP.get(id);
    if (!option) throw new Error(`missing custom field option: ${id}`);
    return option.resolve(data, year, projectId);
};

describe('dashboard custom fields', () => {
    const data = dashboardData({
        tenants: [
            tenant({
                id: 'active-started-2026',
                name: '本年起租客户',
                leaseStart: '2026-01-01',
                leaseEnd: '2026-12-31',
                signingDate: '2025-12-20',
                status: ContractStatus.Active,
                totalArea: 100,
            }),
            tenant({
                id: 'active-signed-2026',
                name: '本年新签客户',
                leaseStart: '2026-03-01',
                leaseEnd: '2027-02-28',
                signingDate: '2026-02-15',
                status: ContractStatus.Active,
                totalArea: 80,
            }),
            tenant({
                id: 'terminated-early',
                name: '提前退租客户',
                leaseStart: '2025-01-01',
                leaseEnd: '2026-12-31',
                signingDate: '2025-01-01',
                terminationDate: '2026-04-20',
                terminationType: 'Early',
                status: ContractStatus.Terminated,
                totalArea: 30,
            }),
            tenant({
                id: 'terminated-normal',
                name: '正常退租客户',
                leaseStart: '2025-03-01',
                leaseEnd: '2026-05-31',
                signingDate: '2025-03-01',
                terminationDate: '2026-05-31',
                terminationType: 'Normal',
                status: ContractStatus.Terminated,
                totalArea: 20,
            }),
        ],
        annualManagementFeeCollected: 260000,
        annualManagementFeeContractReceivable: 310000,
        yearlyTargets: { 2026: { revenue: 0, occupancy: 0, initialBudget: 300000 } },
        initializationData: Array.from({ length: 12 }, (_, index) => initMonth(index + 1, 100000)),
    });

    it('normalizes saved selections with dedupe, known ids only, and a five-field cap', () => {
        expect(normalizeDashboardCustomFieldIds(undefined)).toEqual(DEFAULT_CUSTOM_DASHBOARD_FIELD_IDS);
        expect(
            normalizeDashboardCustomFieldIds([
                'annualLeasedArea',
                'unknown',
                'annualLeasedArea',
                'annualTerminatedArea',
                'earlyTerminations',
                'newContracts',
                'netIncreaseArea',
                'activeTenants',
            ]),
        ).toEqual([
            'annualLeasedArea',
            'annualTerminatedArea',
            'earlyTerminations',
            'newContracts',
            'netIncreaseArea',
        ]);
    });

    it('resolves lease movement fields from the selected-year contract dates', () => {
        expect(resolveField('annualLeasedArea', data)).toEqual({
            value: '180㎡',
            helper: '2 份合同起租',
        });
        expect(resolveField('annualTerminatedArea', data)).toEqual({
            value: '50㎡',
            helper: '2 份合同退租',
        });
        expect(resolveField('earlyTerminations', data)).toEqual({
            value: '1 份',
            helper: '30㎡ 面积',
        });
        expect(resolveField('newContracts', data)).toEqual({
            value: '1 份',
            helper: '80㎡',
        });
        expect(resolveField('netIncreaseArea', data)).toEqual({
            value: '130㎡',
            helper: '净增长',
        });
    });

    it('resolves operating and financial fields from processed dashboard metrics', () => {
        expect(resolveField('activeTenants', data)).toEqual({
            value: '2 家',
            helper: '180㎡ 已租',
        });
        expect(resolveField('vacantArea', data)).toEqual({
            value: '320㎡',
            helper: '4 个空置单元',
        });
        expect(resolveField('annualReceivable', dashboardData({
            annualRevenueTarget: 1100000,
            monthlyTrends: [
                { month: '2026-01', occupancyRate: 0, revenueTarget: 120000, revenueCollected: 0, avgUnitPrice: 0, collectionRate: 0, contractReceivable: 180000 },
                { month: '2026-02', occupancyRate: 0, revenueTarget: 130000, revenueCollected: 0, avgUnitPrice: 0, collectionRate: 0, contractReceivable: 220000 },
            ],
        }))).toEqual({
            value: '40万',
            helper: '合同应收口径',
        });
        expect(resolveField('managementFeeCollected', data)).toEqual({
            value: '26万',
            helper: '应收 31万',
        });
        expect(resolveField('rentCollectionGap', data)).toEqual({
            value: '75万',
            helper: '距年度目标',
        });
    });
});
