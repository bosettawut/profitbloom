import React from 'react';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface SalesChartProps {
  chartType: 'line' | 'bar';
  data: Array<{ month: string; sales: number; profit: number }>;
  /** bars only: one bar a month, as tall as the sales, with the profit inside it marked in its own colour */
  stacked?: boolean;
}

export const SALES_COLOR = '#673AB7';
export const PROFIT_COLOR = '#eab308';

export function SalesChart({ chartType, data, stacked = false }: SalesChartProps) {
  // the two parts of a stacked bar: the profit, and the rest of the sales above it (a month sold at a loss has no profit part)
  const rows = data.map((d) => {
    const profitPart = Math.min(Math.max(d.profit, 0), Math.max(d.sales, 0));
    return { ...d, profitPart, restPart: Math.max(d.sales, 0) - profitPart };
  });

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white p-3 rounded-xl shadow-soft-lg">
          <p className="font-medium mb-2 text-ink text-sm">{`${label}`}</p>
          {([['ยอดขาย', payload[0].payload.sales, SALES_COLOR], ['กำไร', payload[0].payload.profit, PROFIT_COLOR]] as const).map(([name, value, color]) => (
            <div key={name} className="flex items-center gap-3 mb-2">
              <div className="w-4 h-4 rounded-full shadow-sm" style={{ backgroundColor: color }} />
              <span className="text-sm text-ink-muted">{name}:</span>
              <span className="text-sm font-bold" style={{ color }}>
                ฿{value.toLocaleString('th-TH')}
              </span>
            </div>
          ))}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="h-64 md:h-80 w-full" style={{ minHeight: '256px' }}>
      <ResponsiveContainer width="100%" height="100%">
        {chartType === 'line' ? (
          <LineChart data={data} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
            <CartesianGrid vertical={false} stroke="#ECEAF2" />
            <XAxis 
              dataKey="month" 
              axisLine={false} 
              tickLine={false}
              tick={{ fontSize: 12, fill: '#747083' }}
            />
            <YAxis 
              axisLine={false} 
              tickLine={false}
              tick={{ fontSize: 12, fill: '#747083' }}
              tickFormatter={(value) => `${+(value / 1000).toFixed(1)}k`}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: "#F4F3F7" }} />
            <Line 
              key="sales-line"
              type="monotone" 
              dataKey="sales" 
              stroke="#673AB7" 
              strokeWidth={2.5}
              dot={{ fill: '#673AB7', strokeWidth: 0, r: 3 }}
              activeDot={{ 
                r: 8, 
                stroke: '#673AB7', 
                strokeWidth: 3, 
                fill: 'white',
                filter: 'drop-shadow(0 2px 4px rgba(103, 58, 183, 0.3))'
              }}
            />
            <Line 
              key="profit-line"
              type="monotone" 
              dataKey="profit" 
              stroke="#eab308" 
              strokeWidth={2.5}
              dot={{ fill: '#eab308', strokeWidth: 0, r: 3 }}
              activeDot={{ 
                r: 8, 
                stroke: '#eab308', 
                strokeWidth: 3, 
                fill: 'white',
                filter: 'drop-shadow(0 2px 4px rgba(234, 179, 8, 0.3))'
              }}
            />
          </LineChart>
        ) : stacked ? (
          <BarChart data={rows} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
            <CartesianGrid vertical={false} stroke="#ECEAF2" />
            <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#747083' }} />
            <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#747083' }} tickFormatter={(value) => `${+(value / 1000).toFixed(1)}k`} />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: '#F4F3F7' }} />
            <Bar key="profit-part" dataKey="profitPart" stackId="month" fill={PROFIT_COLOR} maxBarSize={36} />
            <Bar key="rest-part" dataKey="restPart" stackId="month" fill={SALES_COLOR} radius={[6, 6, 0, 0]} maxBarSize={36} />
          </BarChart>
        ) : (
          <BarChart data={data} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
            <CartesianGrid vertical={false} stroke="#ECEAF2" />
            <XAxis 
              dataKey="month" 
              axisLine={false} 
              tickLine={false}
              tick={{ fontSize: 12, fill: '#747083' }}
            />
            <YAxis 
              axisLine={false} 
              tickLine={false}
              tick={{ fontSize: 12, fill: '#747083' }}
              tickFormatter={(value) => `${+(value / 1000).toFixed(1)}k`}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: "#F4F3F7" }} />
            <Bar 
              key="sales-bar"
              dataKey="sales" 
              fill="#673AB7" 
              radius={[6, 6, 0, 0]}
              maxBarSize={28}
              style={{
                filter: 'drop-shadow(0 4px 6px rgba(103, 58, 183, 0.2))'
              }}
            />
            <Bar 
              key="profit-bar"
              dataKey="profit" 
              fill="#eab308" 
              radius={[6, 6, 0, 0]}
              maxBarSize={28}
              style={{
                filter: 'drop-shadow(0 4px 6px rgba(234, 179, 8, 0.2))'
              }}
            />
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}