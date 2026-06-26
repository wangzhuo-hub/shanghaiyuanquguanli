import React from 'react';
import {
    Bar,
    CartesianGrid,
    Cell,
    ComposedChart,
    Legend,
    Line,
    Pie,
    PieChart as RechartsPieChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';
import type { DashboardData } from '../types';
import { OccupancyTrendChart, UnitPriceTrendChart } from './Charts';

type ContractTrendPoint = {
    month: string;
    newArea: number;
    lostArea: number;
    netArea: number;
};

type TerminationTypePoint = {
    name: string;
    value: number;
};

export const ContractDashboardTrendCharts: React.FC<{ data: DashboardData }> = ({ data }) => (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <OccupancyTrendChart data={data} period="年度" />
        <UnitPriceTrendChart data={data} period="年度" />
    </div>
);

export const ContractAreaChangeChart: React.FC<{ data: ContractTrendPoint[] }> = ({ data }) => (
    <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
            <XAxis dataKey="month" tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={false} tickLine={false} dy={10} />
            <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={false} tickLine={false} unit="㎡" />
            <Tooltip contentStyle={{ borderRadius: '16px', border: '1px solid rgba(226, 232, 240, 0.86)', background: 'rgba(255, 255, 255, 0.94)', boxShadow: '0 18px 42px rgba(15, 23, 42, 0.12)' }} />
            <Legend verticalAlign="top" align="right" height={36} iconType="circle" />
            <Bar dataKey="newArea" name="新租面积" fill="#2563eb" radius={[4, 4, 0, 0]} barSize={24} />
            <Bar dataKey="lostArea" name="退租面积" fill="#f43f5e" radius={[4, 4, 0, 0]} barSize={24} />
            <Line type="monotone" dataKey="netArea" name="净去化" stroke="#0891b2" strokeWidth={3} dot={{ r: 4, fill: '#0891b2' }} />
        </ComposedChart>
    </ResponsiveContainer>
);

export const ContractTerminationTypeChart: React.FC<{ data: TerminationTypePoint[] }> = ({ data }) => (
    <div className="flex h-full w-full flex-col gap-3 sm:flex-row sm:items-center">
        <div className="h-[120px] w-full sm:h-full sm:w-1/2">
            <ResponsiveContainer width="100%" height="100%">
                <RechartsPieChart>
                    <Pie
                        data={data}
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={70}
                        paddingAngle={5}
                        dataKey="value"
                    >
                        <Cell fill="#2563eb" />
                        <Cell fill="#ef4444" />
                    </Pie>
                    <Tooltip contentStyle={{ borderRadius: '16px', border: '1px solid rgba(226, 232, 240, 0.86)', background: 'rgba(255, 255, 255, 0.94)', boxShadow: '0 18px 42px rgba(15, 23, 42, 0.12)' }} />
                </RechartsPieChart>
            </ResponsiveContainer>
        </div>
        <div className="w-full space-y-2 sm:w-1/2 sm:space-y-3">
            {data.map((item, i) => (
                <div key={item.name} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: i === 0 ? '#2563eb' : '#ef4444' }} />
                        <span className="text-slate-700">{item.name}</span>
                    </div>
                    <span className="font-bold text-slate-800">{item.value} 家</span>
                </div>
            ))}
        </div>
    </div>
);
