import { describe, expect, it } from 'vitest';
import { ContractStatus, DepositStatus, type Tenant } from '../../types';
import {
    buildContractAnalysisMetrics,
    EMPTY_CONTRACT_ANALYSIS_METRICS,
    type ContractAnalysisMetrics,
    type ContractAnalysisPeriod,
} from '../contractAnalysisMetrics';

const tenant = (patch: Partial<Tenant> & Pick<Tenant, 'id'>): Tenant =>
    ({
        id: patch.id,
        name: patch.name || patch.id,
        buildingId: patch.buildingId || 'b1',
        unitIds: patch.unitIds || [],
        totalArea: patch.totalArea ?? 0,
        signingDate: patch.signingDate,
        leaseStart: patch.leaseStart || '2026-01-01',
        leaseEnd: patch.leaseEnd || '2026-12-31',
        monthlyRent: patch.monthlyRent ?? 0,
        rentFreePeriods: patch.rentFreePeriods || [],
        paymentCycle: patch.paymentCycle || 'Monthly',
        firstPaymentDate: patch.firstPaymentDate || '2026-01-01',
        depositAmount: patch.depositAmount ?? 0,
        depositStatus: patch.depositStatus || DepositStatus.Unpaid,
        status: patch.status || ContractStatus.Active,
        terminationDate: patch.terminationDate,
        terminationType: patch.terminationType,
        terminationReason: patch.terminationReason,
    }) as Tenant;

const legacyBuildContractAnalysisMetrics = (
    tenants: Tenant[],
    analysisPeriod: ContractAnalysisPeriod,
    now: Date,
): ContractAnalysisMetrics => {
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    const currentQuarter = Math.floor(currentMonth / 3);

    const getPeriodKey = (dateStr: string) => {
        const d = new Date(dateStr);
        return {
            year: d.getFullYear(),
            month: d.getMonth(),
            quarter: Math.floor(d.getMonth() / 3),
        };
    };

    const isInPeriod = (dateStr: string, period: ContractAnalysisPeriod, offsetYear = 0, offsetPeriod = 0) => {
        if (!dateStr) return false;
        const d = getPeriodKey(dateStr);
        let targetYear = currentYear + offsetYear;

        if (period === 'Year') {
            return d.year === targetYear;
        }
        if (period === 'Quarter') {
            let targetQ = currentQuarter + offsetPeriod;
            while (targetQ < 0) {
                targetQ += 4;
                targetYear -= 1;
            }
            while (targetQ > 3) {
                targetQ -= 4;
                targetYear += 1;
            }
            return d.year === targetYear && d.quarter === targetQ;
        }

        let targetM = currentMonth + offsetPeriod;
        while (targetM < 0) {
            targetM += 12;
            targetYear -= 1;
        }
        while (targetM > 11) {
            targetM -= 12;
            targetYear += 1;
        }
        return d.year === targetYear && d.month === targetM;
    };

    const calculateMetrics = (offsetYear = 0, offsetPeriod = 0) => {
        const signed = tenants.filter((t) => isInPeriod(t.signingDate || t.leaseStart, analysisPeriod, offsetYear, offsetPeriod));
        const terminated = tenants.filter(
            (t) => t.status === ContractStatus.Terminated && isInPeriod(t.terminationDate || t.leaseEnd, analysisPeriod, offsetYear, offsetPeriod)
        );

        const signedArea = signed.reduce((s, t) => s + t.totalArea, 0);
        const terminatedArea = terminated.reduce((s, t) => s + t.totalArea, 0);

        return {
            signedCount: signed.length,
            signedArea: Math.round(signedArea),
            terminatedCount: terminated.length,
            terminatedArea: Math.round(terminatedArea),
            netArea: Math.round(signedArea - terminatedArea),
        };
    };

    const current = calculateMetrics(0, 0);
    const prevPeriod = calculateMetrics(analysisPeriod === 'Year' ? -1 : 0, analysisPeriod === 'Year' ? 0 : -1);
    const prevYear = calculateMetrics(-1, 0);
    const getChange = (curr: number, prev: number) => {
        if (prev === 0) return curr > 0 ? 100 : 0;
        return ((curr - prev) / prev) * 100;
    };

    const terminatedAll = tenants.filter((t) => t.status === ContractStatus.Terminated);
    const terminatedYear = tenants.filter(
        (t) => t.status === ContractStatus.Terminated && isInPeriod(t.terminationDate || t.leaseEnd, 'Year')
    );
    const terminatedQuarter = tenants.filter(
        (t) => t.status === ContractStatus.Terminated && isInPeriod(t.terminationDate || t.leaseEnd, 'Quarter')
    );
    const terminatedMonth = tenants.filter(
        (t) => t.status === ContractStatus.Terminated && isInPeriod(t.terminationDate || t.leaseEnd, 'Month')
    );

    const reasonMap: Record<string, number> = {};
    let earlyCount = 0;

    terminatedAll.forEach((t) => {
        const reason = t.terminationReason || '未填写原因';
        reasonMap[reason] = (reasonMap[reason] || 0) + 1;
        if (t.terminationType === 'Early') earlyCount += 1;
    });

    const reasonData = Object.entries(reasonMap).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
    const earlyRate = terminatedAll.length > 0 ? Math.round((earlyCount / terminatedAll.length) * 100) : 0;
    const terminationTypeData = [
        { name: '正常退租', value: terminatedAll.length - earlyCount },
        { name: '提前退租', value: earlyCount },
    ].filter((item) => item.value > 0);

    const trendData = [];
    for (let i = 11; i >= 0; i -= 1) {
        const d = new Date(currentYear, currentMonth - i, 1);
        const label = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const mSigned = tenants.filter((t) =>
            isInPeriod(t.signingDate || t.leaseStart, 'Month', d.getFullYear() - currentYear, d.getMonth() - currentMonth)
        );
        const mTerminated = tenants.filter(
            (t) =>
                t.status === ContractStatus.Terminated &&
                isInPeriod(t.terminationDate || t.leaseEnd, 'Month', d.getFullYear() - currentYear, d.getMonth() - currentMonth)
        );
        const signedArea = mSigned.reduce((s, t) => s + t.totalArea, 0);
        const terminatedArea = mTerminated.reduce((s, t) => s + t.totalArea, 0);

        trendData.push({
            month: label,
            newArea: Math.round(signedArea),
            lostArea: Math.round(terminatedArea),
            netArea: Math.round(signedArea - terminatedArea),
        });
    }

    return {
        metrics: current,
        mom: {
            area: getChange(current.signedArea, prevPeriod.signedArea),
            count: getChange(current.signedCount, prevPeriod.signedCount),
        },
        yoy: {
            area: getChange(current.signedArea, prevYear.signedArea),
            count: getChange(current.signedCount, prevYear.signedCount),
        },
        reasons: reasonData,
        earlyRate,
        trend: trendData,
        terminationStats: {
            all: terminatedAll.length,
            year: terminatedYear.length,
            quarter: terminatedQuarter.length,
            month: terminatedMonth.length,
            earlyCount,
            normalCount: terminatedAll.length - earlyCount,
        },
        terminationTypeData,
    };
};

const sampleTenants: Tenant[] = [
    tenant({ id: 'signed-current', totalArea: 100.4, signingDate: '2026-06-03' }),
    tenant({ id: 'signed-current-fallback', totalArea: 50.4, leaseStart: '2026-06-10' }),
    tenant({
        id: 'terminated-current',
        totalArea: 80.2,
        signingDate: '2026-04-01',
        status: ContractStatus.Terminated,
        terminationDate: '2026-06-12',
        terminationType: 'Early',
        terminationReason: '经营调整',
    }),
    tenant({ id: 'signed-prev-month', totalArea: 70, signingDate: '2026-05-15' }),
    tenant({ id: 'signed-prev-year', totalArea: 60, signingDate: '2025-06-15' }),
    tenant({
        id: 'terminated-prev-year',
        totalArea: 20,
        signingDate: '2025-01-01',
        status: ContractStatus.Terminated,
        terminationDate: '2025-06-10',
        terminationType: 'Normal',
        terminationReason: '合同到期',
    }),
    tenant({ id: 'signed-quarter', totalArea: 30, signingDate: '2026-04-20' }),
    tenant({ id: 'signed-year', totalArea: 45, signingDate: '2026-01-05' }),
    tenant({
        id: 'terminated-quarter',
        totalArea: 25,
        signingDate: '2026-03-03',
        status: ContractStatus.Terminated,
        terminationDate: '2026-04-03',
        terminationType: 'Normal',
    }),
    tenant({
        id: 'terminated-year',
        totalArea: 35,
        signingDate: '2026-02-02',
        status: ContractStatus.Terminated,
        terminationDate: '2026-02-05',
        terminationType: 'Early',
        terminationReason: '经营调整',
    }),
    tenant({ id: 'signed-december-trend', totalArea: 44, signingDate: '2025-12-01' }),
    tenant({
        id: 'terminated-december-trend',
        totalArea: 12,
        signingDate: '2025-11-01',
        status: ContractStatus.Terminated,
        terminationDate: '2025-12-15',
        terminationType: 'Normal',
        terminationReason: '缩租',
    }),
    tenant({ id: 'outside-window', totalArea: 999, signingDate: '2024-01-01' }),
];

describe('contract analysis metrics', () => {
    it.each<ContractAnalysisPeriod>(['Year', 'Quarter', 'Month'])('matches the legacy calculation for %s period', (period) => {
        const now = new Date(2026, 5, 20);

        expect(buildContractAnalysisMetrics(sampleTenants, period, now)).toEqual(
            legacyBuildContractAnalysisMetrics(sampleTenants, period, now)
        );
    });

    it('keeps month metrics, termination stats, reasons, and trends stable', () => {
        const result = buildContractAnalysisMetrics(sampleTenants, 'Month', new Date(2026, 5, 20));

        expect(result.metrics).toEqual({
            signedCount: 2,
            signedArea: 151,
            terminatedCount: 1,
            terminatedArea: 80,
            netArea: 71,
        });
        expect(result.mom.area).toBeCloseTo(115.71428571428571);
        expect(result.yoy.area).toBeCloseTo(151.66666666666666);
        expect(result.terminationStats).toEqual({
            all: 5,
            year: 3,
            quarter: 2,
            month: 1,
            earlyCount: 2,
            normalCount: 3,
        });
        expect(result.reasons).toEqual([
            { name: '经营调整', value: 2 },
            { name: '合同到期', value: 1 },
            { name: '未填写原因', value: 1 },
            { name: '缩租', value: 1 },
        ]);
        expect(result.earlyRate).toBe(40);
        expect(result.terminationTypeData).toEqual([
            { name: '正常退租', value: 3 },
            { name: '提前退租', value: 2 },
        ]);
        expect(result.trend.find((row) => row.month === '2026-06')).toEqual({
            month: '2026-06',
            newArea: 151,
            lostArea: 80,
            netArea: 71,
        });
    });

    it('returns the shared empty metrics object for empty inputs', () => {
        expect(buildContractAnalysisMetrics([], 'Year', new Date(2026, 5, 20))).toBe(EMPTY_CONTRACT_ANALYSIS_METRICS);
    });
});
