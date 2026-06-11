import React, { useMemo, useState } from 'react';
import {
    BarChart3,
    Briefcase,
    ChevronDown,
    ChevronUp,
    ShieldCheck,
    TrendingUp,
    Users,
} from 'lucide-react';
import {
    Bar,
    BarChart,
    CartesianGrid,
    Cell,
    ComposedChart,
    Legend,
    Line,
    Pie,
    PieChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';
import { Tenant } from '../types';
import { formatArea, formatPercent } from '../services/numberFormat';
import {
    computeSourceAgentMetrics,
    SourceAgentRow,
    SourceAnalysisPeriod,
    UNLABELED_SOURCE,
} from '../services/sourceAgentMetrics';

interface SourceAnalysisDashboardProps {
    tenants: Tenant[];
    onEditTenant?: (tenant: Tenant) => void;
}

const PERIOD_LABELS: Record<SourceAnalysisPeriod, string> = {
    All: '全部历史',
    Year: '本年度',
    Quarter: '本季度',
    Month: '本月',
};

const CHART_COLORS = ['#2563eb', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#64748b', '#ec4899'];

function stabilityBadge(score: number): { label: string; className: string } {
    if (score >= 80) return { label: '稳定', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
    if (score >= 60) return { label: '一般', className: 'bg-amber-50 text-amber-700 border-amber-200' };
    return { label: '需关注', className: 'bg-rose-50 text-rose-700 border-rose-200' };
}

export const SourceAnalysisDashboard: React.FC<SourceAnalysisDashboardProps> = ({
    tenants,
    onEditTenant,
}) => {
    const [period, setPeriod] = useState<SourceAnalysisPeriod>('All');
    const [sortKey, setSortKey] = useState<keyof SourceAgentRow>('stabilityScore');
    const [sortAsc, setSortAsc] = useState(false);
    const [expandedSource, setExpandedSource] = useState<string | null>(null);

    const summary = useMemo(
        () => computeSourceAgentMetrics(tenants, period),
        [tenants, period],
    );

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

    const chartRows = sortedRows.filter((r) => r.sourceName !== UNLABELED_SOURCE).slice(0, 8);
    const pieRows = sortedRows.filter((r) => r.contractCount > 0).slice(0, 6);

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

    const tenantById = useMemo(() => new Map(tenants.map((t) => [t.id, t])), [tenants]);

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            <div className="flex flex-col lg:flex-row gap-4 lg:items-center lg:justify-between">
                <div>
                    <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                        <Briefcase size={20} className="text-indigo-600" />
                        客户来源分析
                    </h3>
                    <p className="text-xs text-slate-500 mt-1">
                        按「招商客户经理/中介名称」汇总签约、退租与租期表现，评估各来源客户稳定性
                    </p>
                </div>
                <div className="grid grid-cols-4 gap-1 bg-slate-100 p-1 rounded-xl w-full lg:w-auto">
                    {(Object.keys(PERIOD_LABELS) as SourceAnalysisPeriod[]).map((p) => (
                        <button
                            key={p}
                            type="button"
                            onClick={() => setPeriod(p)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                                period === p ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                            }`}
                        >
                            {PERIOD_LABELS[p]}
                        </button>
                    ))}
                </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
                    <div className="text-xs font-bold text-slate-400 uppercase tracking-widest">来源标注率</div>
                    <div className="text-3xl font-black text-slate-800 mt-2">{formatPercent(summary.labeledRate)}</div>
                    <div className="text-xs text-slate-500 mt-2">
                        已标注 {summary.labeledContracts} / {summary.totalContracts} 份合同
                    </div>
                </div>
                <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
                    <div className="text-xs font-bold text-slate-400 uppercase tracking-widest">来源数量</div>
                    <div className="text-3xl font-black text-slate-800 mt-2">{summary.sourceCount}</div>
                    <div className="text-xs text-slate-500 mt-2">含 {summary.unlabeledCount} 份未标注合同</div>
                </div>
                <div className="bg-white rounded-2xl border border-emerald-100 p-5 shadow-sm bg-gradient-to-br from-emerald-50 to-white">
                    <div className="text-xs font-bold text-emerald-600 uppercase tracking-widest">签约面积 Top1</div>
                    <div className="text-lg font-black text-emerald-800 mt-2 truncate">
                        {summary.topBySignedArea?.sourceName || '—'}
                    </div>
                    <div className="text-xs text-emerald-700 mt-2">
                        {summary.topBySignedArea ? formatArea(summary.topBySignedArea.signedArea) : '暂无数据'}
                    </div>
                </div>
                <div className="bg-white rounded-2xl border border-indigo-100 p-5 shadow-sm bg-gradient-to-br from-indigo-50 to-white">
                    <div className="text-xs font-bold text-indigo-600 uppercase tracking-widest flex items-center gap-1">
                        <ShieldCheck size={12} /> 最稳定来源
                    </div>
                    <div className="text-lg font-black text-indigo-800 mt-2 truncate">
                        {summary.mostStable?.sourceName || '—'}
                    </div>
                    <div className="text-xs text-indigo-700 mt-2">
                        {summary.mostStable
                            ? `稳定指数 ${summary.mostStable.stabilityScore} · ${summary.mostStable.contractCount} 份合同`
                            : '需至少 2 份同来源合同'}
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                    <div className="flex items-center gap-2 mb-4">
                        <BarChart3 size={18} className="text-blue-600" />
                        <h4 className="font-bold text-slate-800">各来源签约面积</h4>
                    </div>
                    <div className="h-[280px]">
                        {chartRows.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={chartRows} layout="vertical" margin={{ left: 10, right: 20 }}>
                                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                                    <XAxis type="number" tick={{ fill: '#94a3b8', fontSize: 10 }} unit="㎡" />
                                    <YAxis
                                        type="category"
                                        dataKey="sourceName"
                                        width={90}
                                        tick={{ fill: '#64748b', fontSize: 11 }}
                                    />
                                    <Tooltip formatter={(value: number) => [formatArea(value), '签约面积']} />
                                    <Bar dataKey="signedArea" radius={[0, 4, 4, 0]} barSize={18}>
                                        {chartRows.map((_, i) => (
                                            <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="h-full flex items-center justify-center text-slate-400 text-sm">
                                当前筛选下暂无已标注来源
                            </div>
                        )}
                    </div>
                </div>

                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                    <div className="flex items-center gap-2 mb-4">
                        <Users size={18} className="text-violet-600" />
                        <h4 className="font-bold text-slate-800">来源合同占比</h4>
                    </div>
                    <div className="h-[280px] flex items-center">
                        {pieRows.length > 0 ? (
                            <>
                                <div className="w-1/2 h-full">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <PieChart>
                                            <Pie
                                                data={pieRows}
                                                dataKey="contractCount"
                                                nameKey="sourceName"
                                                cx="50%"
                                                cy="50%"
                                                innerRadius={52}
                                                outerRadius={78}
                                                paddingAngle={3}
                                            >
                                                {pieRows.map((_, i) => (
                                                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                                                ))}
                                            </Pie>
                                            <Tooltip />
                                        </PieChart>
                                    </ResponsiveContainer>
                                </div>
                                <div className="w-1/2 space-y-2 pr-2">
                                    {pieRows.map((row, i) => (
                                        <div key={row.sourceName} className="flex items-center justify-between text-xs gap-2">
                                            <div className="flex items-center gap-2 min-w-0">
                                                <div
                                                    className="w-2.5 h-2.5 rounded-full shrink-0"
                                                    style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }}
                                                />
                                                <span className="truncate text-slate-700">{row.sourceName}</span>
                                            </div>
                                            <span className="font-bold text-slate-800 shrink-0">{row.contractCount} 份</span>
                                        </div>
                                    ))}
                                </div>
                            </>
                        ) : (
                            <div className="w-full text-center text-slate-400 text-sm">暂无合同数据</div>
                        )}
                    </div>
                </div>
            </div>

            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                <div className="flex items-center gap-2 mb-4">
                    <TrendingUp size={18} className="text-indigo-600" />
                    <h4 className="font-bold text-slate-800">近 12 个月签约趋势</h4>
                </div>
                <div className="h-[260px]">
                    <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={summary.signingTrend} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                            <XAxis dataKey="month" tick={{ fill: '#94a3b8', fontSize: 10 }} />
                            <YAxis yAxisId="area" tick={{ fill: '#94a3b8', fontSize: 10 }} unit="㎡" />
                            <YAxis yAxisId="count" orientation="right" tick={{ fill: '#94a3b8', fontSize: 10 }} />
                            <Tooltip />
                            <Legend />
                            <Bar yAxisId="area" dataKey="totalArea" name="签约面积" fill="#6366f1" radius={[4, 4, 0, 0]} barSize={20} />
                            <Line yAxisId="count" type="monotone" dataKey="totalCount" name="签约数" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
                        </ComposedChart>
                    </ResponsiveContainer>
                </div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
                    <div>
                        <h4 className="font-bold text-slate-800">来源明细对比</h4>
                        <p className="text-xs text-slate-500 mt-0.5">
                            稳定指数 = 35% 留存 + 35% 非提前退租 + 30% 平均租期；点击行可展开合同列表
                        </p>
                    </div>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[980px]">
                        <thead className="bg-slate-50 text-slate-500">
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
                                        className="px-4 py-3 text-left font-bold cursor-pointer select-none whitespace-nowrap"
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
                        <tbody className="divide-y divide-slate-100">
                            {sortedRows.map((row) => {
                                const badge = stabilityBadge(row.stabilityScore);
                                const expanded = expandedSource === row.sourceName;
                                return (
                                    <React.Fragment key={row.sourceName}>
                                        <tr
                                            className={`hover:bg-slate-50/80 cursor-pointer ${row.sourceName === UNLABELED_SOURCE ? 'bg-amber-50/40' : ''}`}
                                            onClick={() => setExpandedSource(expanded ? null : row.sourceName)}
                                        >
                                            <td className="px-4 py-3 font-medium text-slate-800">
                                                <div className="flex items-center gap-2">
                                                    {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                                    <span className={row.sourceName === UNLABELED_SOURCE ? 'text-amber-700' : ''}>
                                                        {row.sourceName}
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="px-4 py-3">{row.contractCount}</td>
                                            <td className="px-4 py-3 tabular-nums">{formatArea(row.signedArea)}</td>
                                            <td className="px-4 py-3">{row.activeCount}</td>
                                            <td className="px-4 py-3">{row.terminatedCount}</td>
                                            <td className="px-4 py-3 tabular-nums">{formatPercent(row.churnRate)}</td>
                                            <td className="px-4 py-3 tabular-nums">{formatPercent(row.earlyTerminationRate)}</td>
                                            <td className="px-4 py-3">{row.renewalCount}</td>
                                            <td className="px-4 py-3 tabular-nums">{row.avgTenureMonths.toFixed(1)}</td>
                                            <td className="px-4 py-3">
                                                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-bold ${badge.className}`}>
                                                    {row.stabilityScore} · {badge.label}
                                                </span>
                                            </td>
                                        </tr>
                                        {expanded && (
                                            <tr className="bg-slate-50/60">
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
                                                                    className="text-left bg-white border border-slate-200 rounded-xl px-3 py-2 hover:border-indigo-300 hover:bg-indigo-50/40 transition-colors"
                                                                >
                                                                    <div className="font-medium text-slate-800 truncate">{tenant.name}</div>
                                                                    <div className="text-[11px] text-slate-500 mt-1">
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
                                <tr>
                                    <td colSpan={10} className="px-4 py-10 text-center text-slate-400">
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
