import { ContractStatus, type AuthUser, type DashboardData, type Tenant } from '../types';
import { resolveAnnualInitialBudget } from './dashboardMetricHelpers';
import { listNewSigningsInYear } from './newSigningMetrics';
import { formatArea, formatWan } from './numberFormat';

export type DashboardCustomFieldId =
    | 'annualLeasedArea'
    | 'annualTerminatedArea'
    | 'earlyTerminations'
    | 'newContracts'
    | 'netIncreaseArea'
    | 'activeTenants'
    | 'vacantArea'
    | 'annualReceivable'
    | 'managementFeeCollected'
    | 'rentCollectionGap';

export type DashboardCustomFieldTone = 'cyan' | 'sky' | 'blue' | 'amber' | 'rose' | 'slate';

export type DashboardCustomFieldValue = {
    value: string;
    helper: string;
};

export type DashboardCustomFieldOption = {
    id: DashboardCustomFieldId;
    label: string;
    description: string;
    tone: DashboardCustomFieldTone;
    resolve: (data: DashboardData, selectedYear: number, projectId?: string) => DashboardCustomFieldValue;
};

type DashboardDataWithReceivable = DashboardData & {
    annualContractReceivable?: number;
};
type DashboardDataWithMonthlyTrends = DashboardData & {
    monthlyTrends?: Array<{ contractReceivable?: number | null; revenueTarget?: number | null }>;
};

const CUSTOM_DASHBOARD_FIELD_STORAGE_PREFIX = 'kingdee_dashboard_custom_fields_v1';
export const CUSTOM_DASHBOARD_FIELD_LIMIT = 5;
export const DEFAULT_CUSTOM_DASHBOARD_FIELD_IDS: DashboardCustomFieldId[] = [
    'annualLeasedArea',
    'annualTerminatedArea',
    'earlyTerminations',
];

const parseLocalYear = (value?: string): number | null => {
    if (!value) return null;
    const match = String(value).trim().match(/^(\d{4})/);
    if (match) return Number(match[1]);
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.getFullYear() : null;
};

const isYearValue = (value: string | undefined, year: number): boolean => parseLocalYear(value) === year;

const tenantsInSelectedProject = (data: DashboardData): Tenant[] => data.tenants || [];

const sumTenantArea = (tenants: Tenant[]): number =>
    tenants.reduce((sum, tenant) => sum + (Number.isFinite(tenant.totalArea) ? tenant.totalArea : 0), 0);

const signedTenantsForYear = (data: DashboardData, year: number): Tenant[] =>
    listNewSigningsInYear(tenantsInSelectedProject(data), year);

const startedTenantsForYear = (data: DashboardData, year: number): Tenant[] =>
    tenantsInSelectedProject(data).filter((tenant) => isYearValue(tenant.leaseStart, year));

const terminatedTenantsForYear = (data: DashboardData, year: number): Tenant[] =>
    tenantsInSelectedProject(data).filter((tenant) =>
        tenant.status === ContractStatus.Terminated && isYearValue(tenant.terminationDate || tenant.leaseEnd, year)
    );

const resolveAnnualContractReceivable = (data: DashboardData): number => {
    const trends = (data as DashboardDataWithMonthlyTrends).monthlyTrends || [];
    const contractReceivableFromTrends = trends.reduce(
        (sum, trend) => sum + (trend.contractReceivable ?? trend.revenueTarget ?? 0),
        0
    );
    return (
        contractReceivableFromTrends ||
        (data as DashboardDataWithReceivable).annualContractReceivable ||
        data.annualRevenueTarget ||
        data.monthlyRevenueTarget ||
        0
    );
};

export const DASHBOARD_CUSTOM_FIELD_OPTIONS: DashboardCustomFieldOption[] = [
    {
        id: 'annualLeasedArea',
        label: '本年累计出租',
        description: '按本年起租合同汇总出租面积',
        tone: 'cyan',
        resolve: (data, year) => {
            const tenants = startedTenantsForYear(data, year);
            const area = sumTenantArea(tenants);
            const count = tenants.length;
            return { value: formatArea(area, 0), helper: `${count} 份合同起租` };
        },
    },
    {
        id: 'annualTerminatedArea',
        label: '累计退租',
        description: '按本年退租日期汇总退租面积',
        tone: 'rose',
        resolve: (data, year) => {
            const tenants = terminatedTenantsForYear(data, year);
            const area = sumTenantArea(tenants);
            const count = tenants.length;
            return { value: formatArea(area, 0), helper: `${count} 份合同退租` };
        },
    },
    {
        id: 'earlyTerminations',
        label: '提前退租',
        description: '退租类型为提前退租的合同数量',
        tone: 'amber',
        resolve: (data, year) => {
            const tenants = terminatedTenantsForYear(data, year).filter((tenant) => tenant.terminationType === 'Early');
            return { value: `${tenants.length} 份`, helper: `${formatArea(sumTenantArea(tenants), 0)} 面积` };
        },
    },
    {
        id: 'newContracts',
        label: '本年新签',
        description: '按签约日期统计本年新增合同',
        tone: 'sky',
        resolve: (data, year) => {
            const tenants = signedTenantsForYear(data, year);
            const count = tenants.length;
            const area = sumTenantArea(tenants);
            return { value: `${count} 份`, helper: formatArea(area, 0) };
        },
    },
    {
        id: 'netIncreaseArea',
        label: '净增面积',
        description: '本年出租面积减退租面积',
        tone: 'blue',
        resolve: (data, year) => {
            const value =
                sumTenantArea(startedTenantsForYear(data, year)) -
                sumTenantArea(terminatedTenantsForYear(data, year));
            return { value: formatArea(value, 0), helper: value >= 0 ? '净增长' : '净流失' };
        },
    },
    {
        id: 'activeTenants',
        label: '在租客户',
        description: '当前履约中的客户数量',
        tone: 'cyan',
        resolve: (data) => {
            const tenants = tenantsInSelectedProject(data).filter((tenant) => tenant.status === ContractStatus.Active);
            return { value: `${tenants.length} 家`, helper: `${formatArea(data.leasedArea || sumTenantArea(tenants), 0)} 已租` };
        },
    },
    {
        id: 'vacantArea',
        label: '空置面积',
        description: '当前可招商空置面积',
        tone: 'sky',
        resolve: (data) => {
            const vacantArea = data.vacantArea ?? Math.max(0, (data.totalArea || 0) - (data.leasedArea || 0));
            return { value: formatArea(vacantArea, 0), helper: data.vacantUnits != null ? `${data.vacantUnits} 个空置单元` : '当前空置' };
        },
    },
    {
        id: 'annualReceivable',
        label: '年度合同应收',
        description: '当前年度合同口径应收金额',
        tone: 'slate',
        resolve: (data) => ({ value: formatWan(resolveAnnualContractReceivable(data), 0), helper: '合同应收口径' }),
    },
    {
        id: 'managementFeeCollected',
        label: '物业费实收',
        description: '启用物业费园区的年度实收',
        tone: 'blue',
        resolve: (data) => ({
            value: formatWan(data.annualManagementFeeCollected || 0, 0),
            helper: data.annualManagementFeeContractReceivable ? `应收 ${formatWan(data.annualManagementFeeContractReceivable, 0)}` : '物业费口径',
        }),
    },
    {
        id: 'rentCollectionGap',
        label: '收款缺口',
        description: '年度目标减已收金额',
        tone: 'amber',
        resolve: (data, year, projectId) => {
            const annualGoal =
                resolveAnnualInitialBudget(data.yearlyTargets, data.initializationData, year, projectId) ||
                data.annualRevenueTarget ||
                data.monthlyRevenueTarget ||
                0;
            const gap = Math.max(0, annualGoal - (data.annualRevenueCollected || 0));
            return { value: formatWan(gap, 0), helper: gap > 0 ? '距年度目标' : '已达成目标' };
        },
    },
];

export const DASHBOARD_CUSTOM_FIELD_OPTION_MAP = new Map(
    DASHBOARD_CUSTOM_FIELD_OPTIONS.map((option) => [option.id, option])
);

const isDashboardCustomFieldId = (value: string): value is DashboardCustomFieldId =>
    DASHBOARD_CUSTOM_FIELD_OPTION_MAP.has(value as DashboardCustomFieldId);

export const normalizeDashboardCustomFieldIds = (ids: unknown): DashboardCustomFieldId[] => {
    if (!Array.isArray(ids)) return DEFAULT_CUSTOM_DASHBOARD_FIELD_IDS;
    const seen = new Set<DashboardCustomFieldId>();
    ids.forEach((id) => {
        if (typeof id === 'string' && isDashboardCustomFieldId(id) && seen.size < CUSTOM_DASHBOARD_FIELD_LIMIT) {
            seen.add(id);
        }
    });
    return Array.from(seen);
};

export const buildDashboardCustomFieldStorageKey = (authUser?: AuthUser | null): string => {
    const userKey = authUser?.id || authUser?.email || authUser?.name || 'guest';
    return `${CUSTOM_DASHBOARD_FIELD_STORAGE_PREFIX}:${userKey}`;
};

export const readDashboardCustomFieldIds = (storageKey: string): DashboardCustomFieldId[] => {
    if (typeof window === 'undefined') return DEFAULT_CUSTOM_DASHBOARD_FIELD_IDS;
    try {
        const raw = window.localStorage.getItem(storageKey);
        if (!raw) return DEFAULT_CUSTOM_DASHBOARD_FIELD_IDS;
        const parsed = JSON.parse(raw);
        return normalizeDashboardCustomFieldIds(parsed?.fieldIds);
    } catch {
        return DEFAULT_CUSTOM_DASHBOARD_FIELD_IDS;
    }
};

export const writeDashboardCustomFieldIds = (storageKey: string, fieldIds: DashboardCustomFieldId[]): void => {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(
            storageKey,
            JSON.stringify({ fieldIds, updatedAt: new Date().toISOString() })
        );
    } catch {
        // Ignore storage failures; the UI still reflects the in-memory selection.
    }
};

export const customFieldToneClass = (tone: DashboardCustomFieldTone): string => {
    switch (tone) {
        case 'cyan':
            return 'text-cyan-700';
        case 'sky':
            return 'text-sky-700';
        case 'blue':
            return 'text-blue-700';
        case 'amber':
            return 'text-amber-700';
        case 'rose':
            return 'text-rose-600';
        default:
            return 'text-slate-800';
    }
};
