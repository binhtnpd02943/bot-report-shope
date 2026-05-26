"use client";

import React, { useState } from "react";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Sector } from "recharts";

export default function FeeChart({ activeReport }) {
  const [activeIndex, setActiveIndex] = useState(null);

  if (!activeReport || !activeReport.fees) {
    return (
      <div className="glass-card rounded-2xl p-6 h-[340px] flex items-center justify-center">
        <p className="text-zinc-400">Không có dữ liệu chi phí sàn</p>
      </div>
    );
  }

  const fees = activeReport.fees;
  const total = fees.total || 0;
  const transaction = fees.transaction || 0;
  const service = fees.service || 0;
  const commission = fees.commission || 0;
  const other = Math.max(0, total - (transaction + service + commission));

  const data = [
    { name: "Transaction Fee (Phí Thanh Toán)", value: transaction, color: "#10b981" },
    { name: "Service Fee (Phí Dịch Vụ)", value: service, color: "#3b82f6" },
    { name: "Commission Fee (Phí Cố Định)", value: commission, color: "#f59e0b" },
    { name: "Other Fees (Chi Phí Khác)", value: other, color: "#a1a1aa" }
  ].filter(item => item.value > 0);

  // Fallback if all values are 0
  if (data.length === 0 && total > 0) {
    data.push({ name: "Unspecified Fees", value: total, color: "#ef4444" });
  }

  // Format currency
  const formatVnd = (num) => {
    return new Intl.NumberFormat("vi-VN").format(num) + " VNĐ";
  };

  const onPieEnter = (_, index) => {
    setActiveIndex(index);
  };

  const onPieLeave = () => {
    setActiveIndex(null);
  };

  // Render customized active shape
  const renderActiveShape = (props) => {
    const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill } = props;
    return (
      <g>
        <Sector
          cx={cx}
          cy={cy}
          innerRadius={innerRadius}
          outerRadius={outerRadius + 6}
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
        <h4 className="text-lg font-bold text-[#f3f4f6] tracking-tight">Shopee Fee Breakdown</h4>
        <div className="text-right">
          <p className="text-xs text-[#a1a1aa] uppercase tracking-wider">Tổng phí sàn</p>
          <p className="text-base font-extrabold text-[#f43f5e]">{formatVnd(total)}</p>
        </div>
      </div>

      <div className="flex-1 relative flex items-center justify-center">
        {data.length === 0 ? (
          <p className="text-zinc-500 text-sm">Chưa có chi phí sàn được ghi nhận</p>
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
                paddingAngle={4}
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
                    const percent = ((dataObj.value / (total || 1)) * 100).toFixed(1);
                    return (
                      <div className="glass-card-no-hover rounded-xl p-3 border border-[#f3f4f6]/10 text-xs shadow-2xl">
                        <p className="font-bold text-zinc-100 mb-1">{dataObj.name}</p>
                        <p className="text-zinc-300 font-semibold mb-0.5">Số tiền: {formatVnd(dataObj.value)}</p>
                        <p className="text-zinc-400">Tỉ trọng: {percent}%</p>
                      </div>
                    );
                  }
                  return null;
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        )}

        {/* Center Text displaying total and percentage */}
        {total > 0 && (
          <div className="absolute flex flex-col items-center justify-center pointer-events-none" style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }}>
            <span className="text-[10px] text-zinc-400 uppercase tracking-widest font-semibold">Tỉ Lệ Phí</span>
            <span className="text-2xl font-extrabold text-[#f3f4f6]">
              {activeReport.feeRate || ((total / (activeReport.totalRevenue || 1)) * 100).toFixed(1)}%
            </span>
          </div>
        )}
      </div>

      {/* Customized Legend */}
      <div className="grid grid-cols-2 gap-2 mt-2 pt-3 border-t border-white/5">
        {data.map((item, index) => {
          const pct = total > 0 ? ((item.value / total) * 100).toFixed(1) : "0";
          return (
            <div key={index} className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
              <div className="min-w-0 truncate text-[11px]">
                <p className="text-zinc-300 font-medium truncate leading-none mb-0.5">{item.name.split(' (')[0]}</p>
                <p className="text-zinc-500 font-bold leading-none">{pct}% ({formatVnd(item.value).split(' ')[0]} VNĐ)</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
