"use client";

import React, { useState } from "react";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Sector } from "recharts";

const PREMIUM_COLORS = [
  "#10b981", // Emerald
  "#3b82f6", // Royal Blue
  "#8b5cf6", // Purple
  "#f59e0b", // Amber
  "#ec4899", // Pink
  "#f43f5e", // Rose
  "#06b6d4", // Cyan
  "#14b8a6"  // Teal
];

export default function ShopChart({ activeReport }) {
  const [activeIndex, setActiveIndex] = useState(null);

  if (!activeReport) return null;

  const shopBreakdown = activeReport.shopeeShopBreakdown || {};
  const totalRevenue = activeReport.totalRevenue || 1;

  // Prepare data from shop breakdown
  const rawData = Object.entries(shopBreakdown).map(([shopName, stats]) => {
    return {
      name: shopName,
      value: stats.revenue || 0,
      orders: stats.orders || 0
    };
  }).filter(item => item.value > 0);

  // Sort descending by revenue to match the beautiful flow
  const sortedData = rawData.sort((a, b) => b.value - a.value);

  // Add colors dynamically
  const data = sortedData.map((item, idx) => ({
    ...item,
    color: PREMIUM_COLORS[idx % PREMIUM_COLORS.length]
  }));

  // Format currency helpers
  const formatVnd = (num) => {
    return new Intl.NumberFormat("vi-VN").format(num) + " VNĐ";
  };

  const formatShortVnd = (num) => {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + "M";
    }
    return formatVnd(num).split(' ')[0];
  };

  const onPieEnter = (_, index) => {
    setActiveIndex(index);
  };

  const onPieLeave = () => {
    setActiveIndex(null);
  };

  // Custom active shape for pie hover
  const renderActiveShape = (props) => {
    const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill } = props;
    return (
      <g>
        <Sector
          cx={cx}
          cy={cy}
          innerRadius={innerRadius}
          outerRadius={outerRadius + 8}
          startAngle={startAngle}
          endAngle={endAngle}
          fill={fill}
        />
        <Sector
          cx={cx}
          cy={cy}
          innerRadius={innerRadius - 4}
          outerRadius={innerRadius}
          startAngle={startAngle}
          endAngle={endAngle}
          fill={fill}
        />
      </g>
    );
  };

  return (
    <div className="glass-card rounded-2xl p-6 h-[400px] flex flex-col justify-between">
      <div className="flex justify-between items-center mb-2">
        <h4 className="text-lg font-bold text-[#f3f4f6] tracking-tight">Sales Distribution Among Shops</h4>
        <span className="text-xs font-semibold px-2 py-1 rounded bg-zinc-800 text-zinc-400">
          Tổng: {data.length} Gian Hàng
        </span>
      </div>

      <div className="flex-1 relative flex items-center justify-center">
        {data.length === 0 ? (
          <p className="text-zinc-500 text-sm">Chưa có thông tin phân bổ doanh số</p>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie
                activeIndex={activeIndex}
                activeShape={renderActiveShape}
                data={data}
                cx="50%"
                cy="50%"
                innerRadius={65}
                outerRadius={85}
                paddingAngle={3}
                dataKey="value"
                onMouseEnter={onPieEnter}
                onMouseLeave={onPieLeave}
              >
                {data.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} style={{ outline: 'none' }} />
                ))}
              </Pie>
              <Tooltip
                content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    const dataObj = payload[0].payload;
                    const percent = ((dataObj.value / totalRevenue) * 100).toFixed(1);
                    return (
                      <div className="glass-card-no-hover rounded-xl p-3 border border-[#f3f4f6]/10 text-xs shadow-2xl">
                        <p className="font-bold text-zinc-100 mb-1">{dataObj.name}</p>
                        <p className="text-zinc-300 font-semibold mb-0.5">Doanh số: {formatVnd(dataObj.value)}</p>
                        <p className="text-zinc-300 mb-0.5">Số đơn: {dataObj.orders} đơn</p>
                        <p className="text-zinc-400">Tỷ trọng: {percent}%</p>
                      </div>
                    );
                  }
                  return null;
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        )}

        {/* Center Sales metrics summary */}
        {data.length > 0 && activeIndex === null && (
          <div className="absolute flex flex-col items-center justify-center pointer-events-none" style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }}>
            <span className="text-[9px] text-zinc-400 uppercase tracking-widest font-semibold">Tỉ Trọng</span>
            <span className="text-xl font-black text-[#10b981]">Shopee</span>
          </div>
        )}

        {/* Center Hover Specifics */}
        {data.length > 0 && activeIndex !== null && (
          <div className="absolute flex flex-col items-center justify-center pointer-events-none" style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }}>
            <span className="text-[10px] text-zinc-400 uppercase tracking-wider leading-none mb-0.5 max-w-[90px] truncate text-center">
              {data[activeIndex].name.split(' - ')[0]}
            </span>
            <span className="text-lg font-extrabold text-[#f3f4f6] leading-none">
              {((data[activeIndex].value / totalRevenue) * 100).toFixed(0)}%
            </span>
          </div>
        )}
      </div>

      {/* Customized Legend */}
      <div className="grid grid-cols-2 gap-2 mt-2 pt-3 border-t border-white/5 max-h-[85px] overflow-y-auto">
        {data.map((item, index) => {
          const pct = totalRevenue > 0 ? ((item.value / totalRevenue) * 100).toFixed(1) : "0";
          return (
            <div key={index} className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
              <div className="min-w-0 truncate text-[11px]">
                <p className="text-zinc-300 font-medium truncate leading-none mb-0.5">{item.name.split(' - ')[0]}</p>
                <p className="text-zinc-500 font-bold leading-none">{pct}% ({formatShortVnd(item.value)})</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
