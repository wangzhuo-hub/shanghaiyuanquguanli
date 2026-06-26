
import React from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Legend, LineChart, Line, ComposedChart } from 'recharts';
import { DashboardData } from '../types';
import { FileWarning } from 'lucide-react';
import { formatCurrency, formatPercent, formatWan } from '../services/numberFormat';

interface ChartProps {
  data: DashboardData;
  period?: string;
}

const NoDataPlaceholder = () => (
  <div className="liquid-glass-readable flex h-full min-h-[220px] w-full flex-col items-center justify-center rounded-[22px] px-4 text-center">
    <span className="liquid-icon-well mb-3 flex h-12 w-12 items-center justify-center rounded-[18px] text-blue-700">
      <FileWarning size={24} />
    </span>
    <p className="text-sm font-black text-slate-700">暂无趋势数据</p>
    <p className="mt-1 text-xs font-semibold text-slate-500">等待月度指标同步</p>
  </div>
);

const tooltipStyle = {
  borderRadius: '16px',
  border: '1px solid rgba(226, 232, 240, 0.86)',
  background: 'rgba(255, 255, 255, 0.94)',
  boxShadow: '0 18px 42px rgba(15, 23, 42, 0.12)',
};

const ChartShell: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="liquid-analysis-chart rounded-[24px] p-4 sm:p-6">
    <div className="mb-4 flex items-center justify-between gap-3 sm:mb-5">
      <h3 className="min-w-0 text-base font-black text-slate-950 sm:text-lg">{title}</h3>
      <span className="liquid-glass-control hidden shrink-0 rounded-full px-2.5 py-1 text-xs font-black text-blue-700 sm:inline-flex">
        趋势
      </span>
    </div>
    <div className="h-[260px] w-full sm:h-[300px]">
      {children}
    </div>
  </section>
);

export const OccupancyTrendChart: React.FC<ChartProps> = ({ data, period }) => {
  const hasData = data.monthlyTrends && data.monthlyTrends.length > 0;

  return (
    <ChartShell title={`${period || '年度'} 出租率趋势预测`}>
        {hasData ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data.monthlyTrends} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="colorOccupancy" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#2563eb" stopOpacity={0.1}/>
                  <stop offset="95%" stopColor="#2563eb" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <XAxis dataKey="month" tick={{fill: '#64748b', fontSize: 12}} axisLine={false} tickLine={false} />
              <YAxis domain={[0, 100]} tick={{fill: '#64748b', fontSize: 12}} axisLine={false} tickLine={false} unit="%" />
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <Tooltip 
                contentStyle={tooltipStyle}
                itemStyle={{ color: '#1e293b' }}
              />
              <Area type="monotone" dataKey="occupancyRate" stroke="#2563eb" strokeWidth={3} fillOpacity={1} fill="url(#colorOccupancy)" name="出租率" />
            </AreaChart>
          </ResponsiveContainer>
        ) : <NoDataPlaceholder />}
    </ChartShell>
  );
};

export const RevenueChart: React.FC<ChartProps> = ({ data, period }) => {
  const hasData = data.monthlyTrends && data.monthlyTrends.length > 0;

  return (
    <ChartShell title={`${period || '年度'} 租金应收达成与收缴率`}>
        {hasData ? (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data.monthlyTrends} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis dataKey="month" tick={{fill: '#64748b', fontSize: 12}} axisLine={false} tickLine={false} />
              <YAxis yAxisId="left" tick={{fill: '#64748b', fontSize: 12}} axisLine={false} tickLine={false} tickFormatter={(value) => formatWan(value as number)} />
              <YAxis yAxisId="right" orientation="right" domain={[0, 120]} tick={{fill: '#b45309', fontSize: 12, fontWeight: 700}} axisLine={false} tickLine={false} unit="%" />
              <Tooltip 
                 contentStyle={tooltipStyle}
                 formatter={(value: any, name: string) => {
                    if (value === null) return ['--', name];
                    if (name === '收缴率') return [formatPercent(value as number), name];
                    return [formatCurrency(value as number), name];
                 }}
              />
              <Legend wrapperStyle={{paddingTop: '20px'}} />
              <Bar yAxisId="left" dataKey="revenueTarget" name="月度应收目标" fill="#cbd5e1" radius={[4, 4, 0, 0]} />
              <Bar yAxisId="left" dataKey="revenueCollected" name="月度实收金额" fill="#0891b2" radius={[4, 4, 0, 0]} />
              {/* connectNulls={false} ensures the line breaks when data is missing (future months) */}
              <Line yAxisId="right" connectNulls={false} type="monotone" dataKey="collectionRate" name="收缴率" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        ) : <NoDataPlaceholder />}
    </ChartShell>
  );
};

export const UnitPriceTrendChart: React.FC<ChartProps> = ({ data, period }) => {
  const hasData = data.monthlyTrends && data.monthlyTrends.length > 0;

  return (
    <ChartShell title={`${period || '年度'} 平均租金单价趋势 (元/㎡/天)`}>
        {hasData ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data.monthlyTrends} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis dataKey="month" tick={{fill: '#64748b', fontSize: 12}} axisLine={false} tickLine={false} />
              <YAxis tick={{fill: '#64748b', fontSize: 12}} axisLine={false} tickLine={false} />
              <Tooltip 
                 contentStyle={tooltipStyle}
                 formatter={(value: number) => `¥${value.toFixed(2)}`}
              />
              <Line type="monotone" dataKey="avgUnitPrice" stroke="#1d4ed8" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} name="平均单价" />
            </LineChart>
          </ResponsiveContainer>
        ) : <NoDataPlaceholder />}
    </ChartShell>
  );
};
