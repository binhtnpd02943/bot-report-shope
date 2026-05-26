"use client";

import React from "react";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from "recharts";

export default function HistoryChart({ reportsHistory }) {
  if (!reportsHistory || reportsHistory.length === 0) {
    return (
      <div className="glass-card rounded-2xl p-6 h-[400px] flex items-center justify-center">
        <p className="text-zinc-400">Không có dữ liệu lịch sử</p>
      </div>
    );
  }

  // Format data for Recharts (only take date parts DD/MM)
  const data = reportsHistory.map(report => {
    const dateParts = (report.reportDate || "").split("/");
    const shortDate = dateParts.length >= 2 ? `${dateParts[0]}/${dateParts[1]}` : report.reportDate;
    
    return {
      date: shortDate,
      fullDate: report.reportDate,
      "Doanh Số Gốc (Gross)": report.totalRevenue || 0,
      "Ví Thực Nhận (Net)": report.netRevenue || 0,
      "Dự Kiến Nhận (Expected)": report.expectedNetRevenue || report.totalRevenue - (report.fees?.total || 0),
    };
  });

  const formatVnd = (num) => {
    return new Intl.NumberFormat("vi-VN").format(num) + " VNĐ";
  };

  const formatShortVnd = (num) => {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + "M";
    }
    return formatVnd(num).split(' ')[0];
  };

  return (
    <div className="glass-card rounded-2xl p-6 h-[400px] flex flex-col justify-between">
      <div className="flex justify-between items-center mb-4">
        <div>
          <h4 className="text-lg font-bold text-[#f3f4f6] tracking-tight font-sans">Revenue & Cashflow Trends</h4>
          <p className="text-xs text-zinc-400 mt-0.5">Biểu đồ so sánh Doanh số, Thực nhận ví và Dự kiến ví qua thời gian</p>
        </div>
      </div>

      <div className="flex-1 min-h-0 relative">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
            <defs>
              <linearGradient id="colorGross" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.2} />
                <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
              </linearGradient>
              <linearGradient id="colorNet" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.0} />
              </linearGradient>
              <linearGradient id="colorExpected" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.2} />
                <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" vertical={false} />
            <XAxis 
              dataKey="date" 
              axisLine={false} 
              tickLine={false}
              tick={{ fill: "#71717a", fontSize: 10, fontWeight: 550 }}
            />
            <YAxis 
              axisLine={false} 
              tickLine={false}
              tick={{ fill: "#52525b", fontSize: 9 }}
              tickFormatter={formatShortVnd}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  return (
                    <div className="glass-card-no-hover rounded-xl p-3 border border-[#f3f4f6]/10 text-xs shadow-2xl space-y-1">
                      <p className="font-extrabold text-zinc-200 mb-1">Ngày báo cáo: {payload[0].payload.fullDate}</p>
                      {payload.map((entry, idx) => (
                        <p key={idx} style={{ color: entry.color }}>
                          <span className="text-zinc-500 font-medium">{entry.name}:</span>{" "}
                          <strong className="font-black">{formatVnd(entry.value)}</strong>
                        </p>
                      ))}
                    </div>
                  );
                }
                return null;
              }}
            />
            <Legend 
              verticalAlign="top" 
              height={36} 
              iconType="circle"
              iconSize={8}
              wrapperStyle={{ fontSize: 11, fontWeight: 500, paddingBottom: 15 }}
            />
            <Area 
              type="monotone" 
              dataKey="Doanh Số Gốc (Gross)" 
              stroke="#10b981" 
              strokeWidth={2}
              fillOpacity={1} 
              fill="url(#colorGross)" 
            />
            <Area 
              type="monotone" 
              dataKey="Ví Thực Nhận (Net)" 
              stroke="#3b82f6" 
              strokeWidth={2}
              fillOpacity={1} 
              fill="url(#colorNet)" 
            />
            <Area 
              type="monotone" 
              dataKey="Dự Kiến Nhận (Expected)" 
              stroke="#f59e0b" 
              strokeWidth={1.5}
              strokeDasharray="4 4"
              fillOpacity={1} 
              fill="url(#colorExpected)" 
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
