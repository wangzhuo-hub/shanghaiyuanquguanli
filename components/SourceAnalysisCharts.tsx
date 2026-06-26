import React from 'react';
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
import { BarChart3, TrendingUp, Users } from 'lucide-react';
import type { SourceAgentRow, SourceAnalysisSummary } from '../services/sourceAgentMetrics';
import { formatArea } from '../services/numberFormat';

const CHART_COLORS = ['#2563eb', '#0891b2', '#f59e0b', '#e11d48', '#475569', '#38bdf8', '#1d4ed8', '#f97316'];

export const SourceAnalysisCharts: React.FC<{
    chartRows: SourceAgentRow[];
    pieRows: SourceAgentRow[];
    signingTrend: SourceAnalysisSummary['signingTrend'];
}> = ({ chartRows, pieRows, signingTrend }) => (
    <>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <div className="liquid-analysis-chart rounded-[24px] p-4 sm:p-6">
                <div className="flex items-center gap-2 mb-4">
                    <span className="liquid-icon-well inline-flex h-9 w-9 items-center justify-center rounded-2xl text-blue-700">
                        <BarChart3 size={18} />
                    </span>
                    <h4 className="font-black text-slate-950">各来源签约面积</h4>
                </div>
                <div className="h-[280px]">
                    {chartRows.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={chartRows} layout="vertical" margin={{ left: 10, right: 20 }}>
                                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                                <XAxis type="number" tick={{ fill: '#475569', fontSize: 12, fontWeight: 700 }} unit="㎡" />
                                <YAxis
                                    type="category"
                                    dataKey="sourceName"
                                    width={90}
                                    tick={{ fill: '#334155', fontSize: 12, fontWeight: 800 }}
                                />
                                <Tooltip formatter={(value: number) => [formatArea(value), '签约面积']} />
                                <Bar dataKey="signedArea" radius={[0, 8, 8, 0]} barSize={18}>
                                    {chartRows.map((_, i) => (
                                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    ) : (
                        <div className="flex h-full items-center justify-center text-sm font-semibold text-slate-500">
                            当前筛选下暂无已标注来源
                        </div>
                    )}
                </div>
            </div>

            <div className="liquid-analysis-chart rounded-[24px] p-4 sm:p-6">
                <div className="flex items-center gap-2 mb-4">
                    <span className="liquid-icon-well inline-flex h-9 w-9 items-center justify-center rounded-2xl text-blue-700">
                        <Users size={18} />
                    </span>
                    <h4 className="font-black text-slate-950">来源合同占比</h4>
                </div>
                <div className="flex h-[280px] items-center">
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
                                    <div key={row.sourceName} className="flex items-center justify-between gap-2 text-xs">
                                        <div className="flex min-w-0 items-center gap-2">
                                            <div
                                                className="h-2.5 w-2.5 shrink-0 rounded-full"
                                                style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }}
                                            />
                                            <span className="truncate font-semibold text-slate-700">{row.sourceName}</span>
                                        </div>
                                        <span className="shrink-0 font-black text-slate-950">{row.contractCount} 份</span>
                                    </div>
                                ))}
                            </div>
                        </>
                    ) : (
                        <div className="w-full text-center text-sm font-semibold text-slate-500">暂无合同数据</div>
                    )}
                </div>
            </div>
        </div>

        <div className="liquid-analysis-chart rounded-[24px] p-4 sm:p-6">
            <div className="flex items-center gap-2 mb-4">
                <span className="liquid-icon-well inline-flex h-9 w-9 items-center justify-center rounded-2xl text-blue-700">
                    <TrendingUp size={18} />
                </span>
                <h4 className="font-black text-slate-950">近 12 个月签约趋势</h4>
            </div>
            <div className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={signingTrend} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                        <XAxis dataKey="month" tick={{ fill: '#475569', fontSize: 12, fontWeight: 700 }} />
                        <YAxis yAxisId="area" tick={{ fill: '#475569', fontSize: 12, fontWeight: 700 }} unit="㎡" />
                        <YAxis yAxisId="count" orientation="right" tick={{ fill: '#475569', fontSize: 12, fontWeight: 700 }} />
                        <Tooltip />
                        <Legend />
                        <Bar yAxisId="area" dataKey="totalArea" name="签约面积" fill="#2563eb" radius={[8, 8, 0, 0]} barSize={20} />
                        <Line yAxisId="count" type="monotone" dataKey="totalCount" name="签约数" stroke="#0891b2" strokeWidth={2.5} dot={{ r: 3 }} />
                    </ComposedChart>
                </ResponsiveContainer>
            </div>
        </div>
    </>
);
