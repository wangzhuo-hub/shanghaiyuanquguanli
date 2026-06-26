import React, { useEffect, useMemo, useState } from 'react';
import {
    AlertCircle,
    Briefcase,
    ChevronDown,
    ChevronUp,
    ShieldCheck,
} from 'lucide-react';
import { CloudConfig, Tenant } from '../types';
import { formatArea, formatPercent } from '../services/numberFormat';
import type {
    SourceAgentRow,
    SourceAnalysisPeriod,
    SourceAnalysisSummary,
} from '../services/sourceAgentMetrics';
import { fetchCloudSourceAgentMetrics } from '../services/cloudComputeClient';
import { shouldRunLocalSourceAgentMetricsFallback } from '../services/computeFallbackPolicy';
import { shouldBuildSourceTenantLookup } from '../services/sourceAnalysisViewGuards';

const SourceAnalysisCharts = React.lazy(() =>
    import('./SourceAnalysisCharts').then((m) => ({ default: m.SourceAnalysisCharts }))
);

const UNLABELED_SOURCE = '未标注来源';
const EMPTY_TENANT_BY_ID = new Map<string, Tenant>();

const loadLocalSourceSummary = async (
    tenants: Tenant[],
    period: SourceAnalysisPeriod,
): Promise<SourceAnalysisSummary> => {
    const { computeSourceAgentMetrics } = await import('../services/sourceAgentMetrics');
    return computeSourceAgentMetrics(tenants, period);
};

interface SourceAnalysisDashboardProps {
    tenants: Tenant[];
    cloudConfig?: CloudConfig;
    serverComputeEnabled?: boolean;
    onEditTenant?: (tenant: Tenant) => void;
}

const PERIOD_LABELS: Record<SourceAnalysisPeriod, string> = {
    All: '全部历史',
    Year: '本年度',
    Quarter: '本季度',
    Month: '本月',
};

const emptySourceSummary = (period: SourceAnalysisPeriod): SourceAnalysisSummary => ({
    period,
    totalContracts: 0,
    labeledContracts: 0,
    labeledRate: 0,
    unlabeledCount: 0,
    sourceCount: 0,
    rows: [],
    topBySignedArea: null,
    mostStable: null,
    signingTrend: [],
});

function stabilityBadge(score: number): { label: string; className: string } {
    if (score >= 80) return { label: '稳定', className: 'liquid-analysis-stability--stable' };
    if (score >= 60) return { label: '一般', className: 'liquid-analysis-stability--normal' };
    return { label: '需关注', className: 'liquid-analysis-stability--risk' };
}

export const SourceAnalysisDashboard: React.FC<SourceAnalysisDashboardProps> = ({
    tenants,
    cloudConfig,
    serverComputeEnabled = false,
    onEditTenant,
}) => {
    const [period, setPeriod] = useState<SourceAnalysisPeriod>('All');
    const [sortKey, setSortKey] = useState<keyof SourceAgentRow>('stabilityScore');
    const [sortAsc, setSortAsc] = useState(false);
    const [expandedSource, setExpandedSource] = useState<string | null>(null);
    const [serverSummaryState, setServerSummaryState] = useState<{
        loading: boolean;
        summary?: SourceAnalysisSummary;
        error?: string;
    }>({ loading: false });
    const [localSummaryState, setLocalSummaryState] = useState<{
        loading: boolean;
        summary?: SourceAnalysisSummary;
        error?: string;
    }>({ loading: false });
    const canUseServer = serverComputeEnabled && !!cloudConfig?.projectId;

    useEffect(() => {
        if (canUseServer) {
            setLocalSummaryState({ loading: false });
            return;
        }
        if (!shouldRunLocalSourceAgentMetricsFallback({ canUseServer, serverAttempted: false })) {
            setLocalSummaryState({
                loading: false,
                error: '后台来源分析计算不可用，未执行前端本地重算。',
            });
            return;
        }

        let cancelled = false;
        setLocalSummaryState((prev) => ({
            loading: true,
            summary: prev.summary,
            error: undefined,
        }));
        loadLocalSourceSummary(tenants, period)
            .then((summary) => {
                if (!cancelled) setLocalSummaryState({ loading: false, summary });
            })
            .catch((error: unknown) => {
                if (!cancelled) {
                    setLocalSummaryState({
                        loading: false,
                        error: error instanceof Error ? error.message : '本地来源分析模块加载失败。',
                    });
                }
            });

        return () => {
            cancelled = true;
        };
    }, [canUseServer, tenants, period]);

    useEffect(() => {
        if (!canUseServer || !cloudConfig) {
            setServerSummaryState({ loading: false });
            return;
        }

        let cancelled = false;
        setServerSummaryState({ loading: true });
        fetchCloudSourceAgentMetrics(cloudConfig, {
            tenants,
            period,
            referenceDate: new Date(),
        }).then((result) => {
            if (cancelled) return;
            if (result.success && result.summary) {
                setServerSummaryState({ loading: false, summary: result.summary });
                return;
            }
            if (shouldRunLocalSourceAgentMetricsFallback({ canUseServer, serverAttempted: true })) {
                loadLocalSourceSummary(tenants, period)
                    .then((summary) => {
                        if (!cancelled) setServerSummaryState({ loading: false, summary });
                    })
                    .catch((error: unknown) => {
                        if (!cancelled) {
                            setServerSummaryState({
                                loading: false,
                                error: error instanceof Error ? error.message : '本地来源分析模块加载失败。',
                            });
                        }
                    });
                return;
            }
            setServerSummaryState({
                loading: false,
                error: result.message || '后台来源分析计算失败，未执行前端本地重算。',
            });
        }).catch((error: unknown) => {
            if (!cancelled) {
                if (shouldRunLocalSourceAgentMetricsFallback({ canUseServer, serverAttempted: true })) {
                    loadLocalSourceSummary(tenants, period)
                        .then((summary) => {
                            if (!cancelled) setServerSummaryState({ loading: false, summary });
                        })
                        .catch((localError: unknown) => {
                            if (!cancelled) {
                                setServerSummaryState({
                                    loading: false,
                                    error: localError instanceof Error ? localError.message : '本地来源分析模块加载失败。',
                                });
                            }
                        });
                    return;
                }
                setServerSummaryState({
                    loading: false,
                    error: error instanceof Error ? error.message : '后台来源分析计算失败，未执行前端本地重算。',
                });
            }
        });

        return () => {
            cancelled = true;
        };
    }, [canUseServer, cloudConfig, tenants, period]);

    const emptySummary = useMemo(() => emptySourceSummary(period), [period]);
    const summary = serverSummaryState.summary || localSummaryState.summary || emptySummary;
    const loading = (
        canUseServer ? serverSummaryState.loading : localSummaryState.loading
    ) && !summary.rows.length;
    const errorMessage = serverSummaryState.error || localSummaryState.error;

    const sortedRows = useMemo(() => {
        const rows = [...summary.rows];
        rows.sort((a, b) => {
            const av = a[sortKey];
            const bv = b[sortKey];
            if (typeof av === 'number' && typeof bv === 'number') {
                return sortAsc ? av - bv : bv - av;
            }
            if (typeof av === 'string' && typeof bv === 'string') {
                return sortAsc ? av.localeCompare(bv, 'zh-CN') : bv.localeCompare(av, 'zh-CN');
            }
            return 0;
        });
        return rows;
    }, [summary.rows, sortKey, sortAsc]);

    const chartRows = useMemo(
        () => sortedRows.filter((r) => r.sourceName !== UNLABELED_SOURCE).slice(0, 8),
        [sortedRows],
    );
    const pieRows = useMemo(
        () => sortedRows.filter((r) => r.contractCount > 0).slice(0, 6),
        [sortedRows],
    );

    const handleSort = (key: keyof SourceAgentRow) => {
        if (sortKey === key) {
            setSortAsc((prev) => !prev);
            return;
        }
        setSortKey(key);
        setSortAsc(false);
    };

    const renderSortIcon = (key: keyof SourceAgentRow) => {
        if (sortKey !== key) return null;
        return sortAsc ? <ChevronUp size={12} /> : <ChevronDown size={12} />;
    };

    const shouldBuildTenantLookup = shouldBuildSourceTenantLookup({ expandedSource });
    const tenantById = useMemo(
        () => shouldBuildTenantLookup ? new Map(tenants.map((t) => [t.id, t])) : EMPTY_TENANT_BY_ID,
        [shouldBuildTenantLookup, tenants],
    );

    return (
        <div className="liquid-analysis-shell space-y-5 rounded-[28px] p-4 animate-in fade-in duration-500 sm:p-5 lg:p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                    <h3 className="flex items-center gap-2 text-lg font-black text-slate-950">
                        <span className="liquid-icon-well inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl text-blue-700">
                            <Briefcase size={20} />
                        </span>
                        客户来源分析
                    </h3>
                    <p className="mt-1 text-xs font-medium text-slate-500">
                        按「招商客户经理/中介名称」汇总签约、退租与租期表现，评估各来源客户稳定性
                    </p>
                </div>
                <div className="liquid-glass-control grid w-full grid-cols-4 gap-1 rounded-full p-1 lg:w-auto">
                    {(Object.keys(PERIOD_LABELS) as SourceAnalysisPeriod[]).map((p) => (
                        <button
                            key={p}
                            type="button"
                            onClick={() => setPeriod(p)}
                            className={`rounded-full px-3 py-2 text-xs font-bold transition-all focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-200/80 ${
                                period === p ? 'liquid-analysis-segment-active' : 'text-slate-500 hover:bg-blue-50/70 hover:text-blue-700'
                            }`}
                        >
                            {PERIOD_LABELS[p]}
                        </button>
                    ))}
                </div>
            </div>

            {(loading || errorMessage) && (
                <div
                    className={`liquid-analysis-card flex items-start gap-2 rounded-2xl px-4 py-3 text-sm font-semibold ${
                        errorMessage
                            ? 'text-amber-800 ring-1 ring-amber-200/80'
                            : 'text-blue-800 ring-1 ring-blue-200/80'
                    }`}
                >
                    <AlertCircle size={16} className="mt-0.5 shrink-0" />
                    <span>
                        {errorMessage ||
                            (canUseServer ? '后台正在计算客户来源分析...' : '本地来源分析模块加载中...')}
                    </span>
                </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                <div className="liquid-analysis-card rounded-[22px] p-5">
                    <div className="text-xs font-black uppercase tracking-widest text-slate-500">来源标注率</div>
                    <div className="mt-2 text-3xl font-black text-slate-950">{formatPercent(summary.labeledRate)}</div>
                    <div className="mt-2 text-xs font-medium text-slate-500">
                        已标注 {summary.labeledContracts} / {summary.totalContracts} 份合同
                    </div>
                </div>
                <div className="liquid-analysis-card rounded-[22px] p-5">
                    <div className="text-xs font-black uppercase tracking-widest text-slate-500">来源数量</div>
                    <div className="mt-2 text-3xl font-black text-slate-950">{summary.sourceCount}</div>
                    <div className="mt-2 text-xs font-medium text-slate-500">含 {summary.unlabeledCount} 份未标注合同</div>
                </div>
                <div className="liquid-analysis-card rounded-[22px] p-5 ring-1 ring-cyan-100/80">
                    <div className="text-xs font-black uppercase tracking-widest text-cyan-700">签约面积 Top1</div>
                    <div className="mt-2 truncate text-lg font-black text-slate-950">
                        {summary.topBySignedArea?.sourceName || '—'}
                    </div>
                    <div className="mt-2 text-xs font-semibold text-cyan-700">
                        {summary.topBySignedArea ? formatArea(summary.topBySignedArea.signedArea) : '暂无数据'}
                    </div>
                </div>
                <div className="liquid-analysis-card rounded-[22px] p-5 ring-1 ring-blue-100/80">
                    <div className="flex items-center gap-1 text-xs font-black uppercase tracking-widest text-blue-700">
                        <ShieldCheck size={12} /> 最稳定来源
                    </div>
                    <div className="mt-2 truncate text-lg font-black text-slate-950">
                        {summary.mostStable?.sourceName || '—'}
                    </div>
                    <div className="mt-2 text-xs font-semibold text-blue-700">
                        {summary.mostStable
                            ? `稳定指数 ${summary.mostStable.stabilityScore} · ${summary.mostStable.contractCount} 份合同`
                            : '需至少 2 份同来源合同'}
                    </div>
                </div>
            </div>

            <React.Suspense
                fallback={
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                        <div className="liquid-analysis-chart h-[352px] rounded-[24px]" />
                        <div className="liquid-analysis-chart h-[352px] rounded-[24px]" />
                    </div>
                }
            >
                <SourceAnalysisCharts
                    chartRows={chartRows}
                    pieRows={pieRows}
                    signingTrend={summary.signingTrend}
                />
            </React.Suspense>

            <div className="liquid-analysis-table overflow-hidden rounded-[24px]">
                <div className="liquid-analysis-table-toolbar flex flex-col gap-3 border-b border-white/70 px-4 py-4 sm:px-6 md:flex-row md:items-center md:justify-between">
                    <div className="min-w-0">
                        <h4 className="font-black text-slate-950">来源明细对比</h4>
                        <p className="mt-0.5 text-xs font-medium text-slate-500">
                            稳定指数 = 35% 留存 + 35% 非提前退租 + 30% 平均租期；点击行可展开合同列表
                        </p>
                    </div>
                </div>

                <div className="space-y-3 p-3 md:hidden">
                    {sortedRows.map((row) => {
                        const badge = stabilityBadge(row.stabilityScore);
                        const expanded = expandedSource === row.sourceName;
                        return (
                            <div
                                key={row.sourceName}
                                className={`liquid-analysis-card rounded-[22px] p-3 ${row.sourceName === UNLABELED_SOURCE ? 'ring-1 ring-amber-200/80' : ''}`}
                            >
                                <button
                                    type="button"
                                    onClick={() => setExpandedSource(expanded ? null : row.sourceName)}
                                    className="liquid-pressable w-full rounded-2xl px-1 py-1 text-left focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-200/80"
                                >
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <div className="flex min-w-0 items-center gap-2">
                                                {expanded ? <ChevronUp size={14} className="shrink-0 text-blue-700" /> : <ChevronDown size={14} className="shrink-0 text-slate-500" />}
                                                <div className={`break-words text-base font-black ${row.sourceName === UNLABELED_SOURCE ? 'text-amber-700' : 'text-slate-950'}`}>
                                                    {row.sourceName}
                                                </div>
                                            </div>
                                            <div className="mt-1 text-xs font-semibold text-slate-500">
                                                {row.contractCount} 份合同 · 签约 {formatArea(row.signedArea)}
                                            </div>
                                        </div>
                                        <span className={`liquid-analysis-stability shrink-0 rounded-full border px-2 py-0.5 text-xs font-bold ${badge.className}`}>
                                            {row.stabilityScore} · {badge.label}
                                        </span>
                                    </div>
                                </button>

                                <div className="mt-3 grid grid-cols-2 gap-2">
                                    <div className="liquid-glass-subtle rounded-2xl px-3 py-2">
                                        <div className="text-xs font-black uppercase tracking-wide text-slate-500">在租 / 退租</div>
                                        <div className="mt-1 text-sm font-black text-slate-900">{row.activeCount} / {row.terminatedCount}</div>
                                    </div>
                                    <div className="liquid-glass-subtle rounded-2xl px-3 py-2">
                                        <div className="text-xs font-black uppercase tracking-wide text-slate-500">续签数</div>
                                        <div className="mt-1 text-sm font-black text-slate-900">{row.renewalCount}</div>
                                    </div>
                                    <div className="liquid-glass-subtle rounded-2xl px-3 py-2">
                                        <div className="text-xs font-black uppercase tracking-wide text-slate-500">退租率</div>
                                        <div className="mt-1 text-sm font-black tabular-nums text-slate-900">{formatPercent(row.churnRate)}</div>
                                    </div>
                                    <div className="liquid-glass-subtle rounded-2xl px-3 py-2">
                                        <div className="text-xs font-black uppercase tracking-wide text-slate-500">提前退租率</div>
                                        <div className="mt-1 text-sm font-black tabular-nums text-slate-900">{formatPercent(row.earlyTerminationRate)}</div>
                                    </div>
                                </div>

                                <div className="mt-2 liquid-glass-subtle rounded-2xl px-3 py-2 text-xs font-semibold text-slate-600">
                                    平均租期 <span className="font-black tabular-nums text-slate-900">{row.avgTenureMonths.toFixed(1)}</span> 月
                                </div>

                                {expanded && (
                                    <div className="mt-3 space-y-2">
                                        {row.tenantIds.map((id) => {
                                            const tenant = tenantById.get(id);
                                            if (!tenant) return null;
                                            return (
                                                <button
                                                    key={id}
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        onEditTenant?.(tenant);
                                                    }}
                                                    className="liquid-glass-readable liquid-pressable w-full rounded-2xl px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-200/80"
                                                >
                                                    <div className="break-words font-bold text-slate-900">{tenant.name}</div>
                                                    <div className="mt-1 text-xs font-medium text-slate-500">
                                                        {tenant.leaseStart} ~ {tenant.leaseEnd} · {formatArea(tenant.totalArea || 0)}
                                                    </div>
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                    {sortedRows.length === 0 && (
                        <div className="liquid-analysis-empty rounded-2xl px-4 py-10 text-center text-sm font-semibold text-slate-500">
                            当前筛选下暂无合同
                        </div>
                    )}
                </div>

                <div className="hidden overflow-x-auto md:block">
                    <table className="w-full text-sm min-w-[980px]">
                        <thead className="liquid-analysis-sticky text-slate-600">
                            <tr>
                                {[
                                    ['sourceName', '来源'],
                                    ['contractCount', '签约数'],
                                    ['signedArea', '签约面积'],
                                    ['activeCount', '在租数'],
                                    ['terminatedCount', '退租数'],
                                    ['churnRate', '退租率'],
                                    ['earlyTerminationRate', '提前退租率'],
                                    ['renewalCount', '续签数'],
                                    ['avgTenureMonths', '平均租期(月)'],
                                    ['stabilityScore', '稳定指数'],
                                ].map(([key, label]) => (
                                    <th
                                        key={key}
                                        className="cursor-pointer select-none whitespace-nowrap px-4 py-3 text-left font-black"
                                        onClick={() => handleSort(key as keyof SourceAgentRow)}
                                    >
                                        <span className="inline-flex items-center gap-1">
                                            {label}
                                            {renderSortIcon(key as keyof SourceAgentRow)}
                                        </span>
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="liquid-analysis-table-body divide-y divide-slate-200/70">
                            {sortedRows.map((row) => {
                                const badge = stabilityBadge(row.stabilityScore);
                                const expanded = expandedSource === row.sourceName;
                                return (
                                    <React.Fragment key={row.sourceName}>
                                        <tr
                                            className={`liquid-analysis-table-row cursor-pointer ${row.sourceName === UNLABELED_SOURCE ? 'liquid-analysis-table-row--warning' : ''}`}
                                            onClick={() => setExpandedSource(expanded ? null : row.sourceName)}
                                        >
                                            <td className="px-4 py-3 font-bold text-slate-900">
                                                <div className="flex items-center gap-2">
                                                    {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                                    <span className={row.sourceName === UNLABELED_SOURCE ? 'text-amber-700' : ''}>
                                                        {row.sourceName}
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 font-semibold text-slate-700">{row.contractCount}</td>
                                            <td className="px-4 py-3 font-semibold tabular-nums text-slate-700">{formatArea(row.signedArea)}</td>
                                            <td className="px-4 py-3 font-semibold text-slate-700">{row.activeCount}</td>
                                            <td className="px-4 py-3 font-semibold text-slate-700">{row.terminatedCount}</td>
                                            <td className="px-4 py-3 font-semibold tabular-nums text-slate-700">{formatPercent(row.churnRate)}</td>
                                            <td className="px-4 py-3 font-semibold tabular-nums text-slate-700">{formatPercent(row.earlyTerminationRate)}</td>
                                            <td className="px-4 py-3 font-semibold text-slate-700">{row.renewalCount}</td>
                                            <td className="px-4 py-3 font-semibold tabular-nums text-slate-700">{row.avgTenureMonths.toFixed(1)}</td>
                                            <td className="px-4 py-3">
                                                <span className={`liquid-analysis-stability inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-bold ${badge.className}`}>
                                                    {row.stabilityScore} · {badge.label}
                                                </span>
                                            </td>
                                        </tr>
                                        {expanded && (
                                            <tr className="liquid-analysis-expand-row">
                                                <td colSpan={10} className="px-4 py-3">
                                                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                                                        {row.tenantIds.map((id) => {
                                                            const tenant = tenantById.get(id);
                                                            if (!tenant) return null;
                                                            return (
                                                                <button
                                                                    key={id}
                                                                    type="button"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        onEditTenant?.(tenant);
                                                                    }}
                                                                    className="liquid-analysis-card liquid-pressable rounded-2xl px-3 py-2 text-left transition-colors hover:border-blue-300 hover:bg-blue-50/55 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-200/80"
                                                                >
                                                                    <div className="truncate font-bold text-slate-900">{tenant.name}</div>
                                                                    <div className="mt-1 text-xs font-medium text-slate-500">
                                                                        {tenant.leaseStart} ~ {tenant.leaseEnd} · {formatArea(tenant.totalArea || 0)}
                                                                    </div>
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                    </React.Fragment>
                                );
                            })}
                            {sortedRows.length === 0 && (
                                <tr className="liquid-analysis-empty">
                                    <td colSpan={10} className="px-4 py-10 text-center text-sm font-semibold text-slate-500">
                                        当前筛选下暂无合同
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};
