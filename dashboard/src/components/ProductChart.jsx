"use client";

import React from "react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell } from "recharts";

export default function ProductChart({ activeReport }) {
  if (!activeReport) return null;

  const topProducts = activeReport.topProducts || [];
  
  // Sort and filter down to top 5
  const data = topProducts
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 5)
    .map((item, idx) => {
      // Shorten product name to fit nicely
      let shortName = item.name;
      if (shortName.length > 18) {
        shortName = shortName.substring(0, 15) + "...";
      }
      return {
        name: shortName,
        fullName: item.name,
        qty: item.qty,
        revenue: item.revenue,
        sku: item.sku,
        shopName: item.shopName,
        displayName: `SP ${idx + 1}`
      };
    });

  const formatVnd = (num) => {
    return new Intl.NumberFormat("vi-VN").format(num) + " VNĐ";
  };

  return (
    <div className="glass-card rounded-2xl p-6 h-[400px] flex flex-col justify-between">
      <div>
        <h4 className="text-lg font-bold text-[#f3f4f6] tracking-tight">Top 5 Products (Sản Phẩm Bán Chạy)</h4>
        <p className="text-xs text-zinc-400 mt-0.5">Xếp hạng theo số lượng sản phẩm bán ra hôm qua</p>
      </div>

      <div className="flex-1 mt-4 relative">
        {data.length === 0 ? (
          <div className="w-full h-full flex items-center justify-center">
            <p className="text-zinc-500 text-sm">Chưa có thông tin sản phẩm</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={data} margin={{ top: 20, right: 10, left: -20, bottom: 5 }}>
              <defs>
                <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={0.95} />
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.4} />
                </linearGradient>
              </defs>
              <XAxis 
                dataKey="displayName" 
                axisLine={false} 
                tickLine={false}
                tick={{ fill: "#a1a1aa", fontSize: 11, fontWeight: 600 }}
              />
              <YAxis 
                axisLine={false} 
                tickLine={false}
                tick={{ fill: "#71717a", fontSize: 10 }}
              />
              <Tooltip
                cursor={{ fill: "rgba(255, 255, 255, 0.03)", radius: 8 }}
                content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    const item = payload[0].payload;
                    return (
                      <div className="glass-card-no-hover rounded-xl p-3 border border-[#f3f4f6]/10 text-xs shadow-2xl max-w-[220px]">
                        <p className="font-extrabold text-[#10b981] mb-1">{item.fullName}</p>
                        <div className="space-y-0.5 text-zinc-300">
                          <p><span className="text-zinc-500 font-medium">SKU:</span> {item.sku || "N/A"}</p>
                          <p><span className="text-zinc-500 font-medium">Gian hàng:</span> {item.shopName}</p>
                          <p className="text-emerald-400"><span className="text-zinc-500 font-medium">Đã bán:</span> <strong className="font-black text-sm">{item.qty}</strong> chiếc</p>
                          <p><span className="text-zinc-500 font-medium">Doanh thu:</span> {formatVnd(item.revenue)}</p>
                        </div>
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <Bar 
                dataKey="qty" 
                fill="url(#barGradient)" 
                radius={[8, 8, 0, 0]}
                barSize={32}
              >
                {data.map((entry, index) => (
                  <Cell 
                    key={`cell-${index}`} 
                    className="hover:opacity-85 transition-opacity duration-300"
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Legend list at bottom */}
      <div className="border-t border-white/5 pt-3 mt-1 flex flex-col gap-1.5 max-h-[80px] overflow-y-auto">
        {data.map((item, idx) => (
          <div key={idx} className="flex justify-between items-center text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-5 h-5 rounded-md bg-[#10b981]/15 text-[#10b981] flex items-center justify-center font-bold text-[10px] shrink-0">
                {idx + 1}
              </span>
              <span className="text-zinc-300 truncate font-medium">{item.fullName}</span>
            </div>
            <div className="shrink-0 text-zinc-400 font-bold ml-2">
              <span className="text-emerald-400">{item.qty} chiếc</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
