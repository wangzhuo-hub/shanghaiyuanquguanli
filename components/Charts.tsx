
import React from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Legend, LineChart, Line, ComposedChart } from 'recharts';
import { DashboardData } from '../types';
import { FileWarning } from 'lucide-react';

interface ChartProps {
  data: DashboardData;
  period?: string;
}

const NoDataPlaceholder = () => (
  <div className="h-full w-full flex flex-col items-center justify-center text-slate-400">
    <FileWarning size={32} className="mb-2 opacity-50" />
    <p className="text-sm">暂无趋势数据</p>
  </div>
);

export const OccupancyTrendChart: React.FC<ChartProps> = ({ data, period }) => {
  const hasData = data.monthlyTrends && data.monthlyTrends.length > 0;

  return (
    <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
      <h3 className="text-lg font-semibold text-slate-800 mb-6">{period || '年度'} 出租率趋势预测</h3>
      <div className="h-[300px] w-full">
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
                contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                itemStyle={{ color: '#1e293b' }}
              />
              <Area type="monotone" dataKey="occupancyRate" stroke="#2563eb" strokeWidth={3} fillOpacity={1} fill="url(#colorOccupancy)" name="出租率" />
            </AreaChart>
          </ResponsiveContainer>
        ) : <NoDataPlaceholder />}
      </div>
    </div>
  );
};

export const RevenueChart: React.FC<ChartProps> = ({ data, period }) => {
  const hasData = data.monthlyTrends && data.monthlyTrends.length > 0;

  return (
    <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
      <h3 className="text-lg font-semibold text-slate-800 mb-6">{period || '年度'} 租金应收达成与收缴率</h3>
      <div className="h-[300px] w-full">
        {hasData ? (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data.monthlyTrends} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis dataKey="month" tick={{fill: '#64748b', fontSize: 12}} axisLine={false} tickLine={false} />
              <YAxis yAxisId="left" tick={{fill: '#64748b', fontSize: 12}} axisLine={false} tickLine={false} tickFormatter={(value) => `${value / 10000}万`} />
              <YAxis yAxisId="right" orientation="right" domain={[0, 120]} tick={{fill: '#f59e0b', fontSize: 10}} axisLine={false} tickLine={false} unit="%" />
              <Tooltip 
                 contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                 formatter={(value: any, name: string) => {
                    if (value === null) return ['--', name];
                    if (name === '收缴率') return [`${value}%`, name];
                    return [new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(value as number), name];
                 }}
              />
              <Legend wrapperStyle={{paddingTop: '20px'}} />
              <Bar yAxisId="left" dataKey="revenueTarget" name="月度应收目标" fill="#cbd5e1" radius={[4, 4, 0, 0]} />
              <Bar yAxisId="left" dataKey="revenueCollected" name="月度实收金额" fill="#059669" radius={[4, 4, 0, 0]} />
              {/* connectNulls={false} ensures the line breaks when data is missing (future months) */}
              <Line yAxisId="right" connectNulls={false} type="monotone" dataKey="collectionRate" name="收缴率" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        ) : <NoDataPlaceholder />}
      </div>
    </div>
  );
};

export const UnitPriceTrendChart: React.FC<ChartProps> = ({ data, period }) => {
  const hasData = data.monthlyTrends && data.monthlyTrends.length > 0;

  return (
    <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
      <h3 className="text-lg font-semibold text-slate-800 mb-6">{period || '年度'} 平均租金单价趋势 (元/㎡/天)</h3>
      <div className="h-[300px] w-full">
        {hasData ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data.monthlyTrends} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis dataKey="month" tick={{fill: '#64748b', fontSize: 12}} axisLine={false} tickLine={false} />
              <YAxis tick={{fill: '#64748b', fontSize: 12}} axisLine={false} tickLine={false} />
              <Tooltip 
                 contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                 formatter={(value: number) => `¥${value.toFixed(2)}`}
              />
              <Line type="monotone" dataKey="avgUnitPrice" stroke="#8b5cf6" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} name="平均单价" />
            </LineChart>
          </ResponsiveContainer>
        ) : <NoDataPlaceholder />}
      </div>
    </div>
  );
};
