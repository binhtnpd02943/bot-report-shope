"use client";

import React, { useState } from "react";
import { ArrowUpDown, Store } from "lucide-react";

export default function ShopTable({ activeReport }) {
  const [sortField, setSortField] = useState("revenue");
  const [sortAsc, setSortAsc] = useState(false);

  if (!activeReport) return null;

  const shopBreakdown = activeReport.shopeeShopBreakdown || {};

  const handleSort = (field) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(false);
    }
  };

  const formatVnd = (num) => {
    return new Intl.NumberFormat("vi-VN").format(num) + " đ";
  };

  // Parse shops breakdown into sortable rows
  const rows = Object.entries(shopBreakdown).map(([shopName, stats]) => {
    const fees = stats.fees || { total: 0 };
    return {
      name: shopName,
      revenue: stats.revenue || 0,
      orders: stats.orders || 0,
      fees: fees.total || 0,
      netExpected: stats.netRevenue !== undefined ? stats.netRevenue : (stats.revenue - fees.total),
      netActual: stats.netRevenueActual !== undefined ? stats.netRevenueActual : 0,
    };
  });

  // Sort rows
  const sortedRows = [...rows].sort((a, b) => {
    let valA = a[sortField];
    let valB = b[sortField];
    
    if (typeof valA === "string") {
      return sortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
    }
    return sortAsc ? valA - valB : valB - valA;
  });

  return (
    <div className="glass-card rounded-2xl p-6 mb-6">
      <div className="flex items-center gap-2 mb-4">
        <div className="p-2 bg-[#3b82f6]/10 rounded-lg">
          <Store className="w-5 h-5 text-[#3b82f6]" />
        </div>
        <div>
          <h4 className="text-lg font-bold text-[#f3f4f6] tracking-tight font-sans">Shop Performance Grid</h4>
          <p className="text-xs text-zinc-400">Hiệu suất và chi tiết doanh thu đối soát từng gian hàng</p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="border-b border-white/5 text-zinc-400 uppercase tracking-wider text-[10px] font-semibold bg-[#16171d]/40">
              <th className="py-3.5 px-4 font-semibold text-zinc-300">Gian Hàng</th>
              <th className="py-3.5 px-4 font-semibold text-right cursor-pointer hover:bg-zinc-800/40 rounded-lg transition-colors" onClick={() => handleSort("orders")}>
                <div className="flex items-center justify-end gap-1.5">
                  Số Đơn <ArrowUpDown className="w-3 h-3" />
                </div>
              </th>
              <th className="py-3.5 px-4 font-semibold text-right cursor-pointer hover:bg-zinc-800/40 rounded-lg transition-colors" onClick={() => handleSort("revenue")}>
                <div className="flex items-center justify-end gap-1.5">
                  Doanh Số Gốc (Gross) <ArrowUpDown className="w-3 h-3" />
                </div>
              </th>
              <th className="py-3.5 px-4 font-semibold text-right cursor-pointer hover:bg-zinc-800/40 rounded-lg transition-colors" onClick={() => handleSort("fees")}>
                <div className="flex items-center justify-end gap-1.5">
                  Phí Sàn Shopee <ArrowUpDown className="w-3 h-3" />
                </div>
              </th>
              <th className="py-3.5 px-4 font-semibold text-right cursor-pointer hover:bg-zinc-800/40 rounded-lg transition-colors" onClick={() => handleSort("netExpected")}>
                <div className="flex items-center justify-end gap-1.5">
                  Doanh Thu Dự Kiến <ArrowUpDown className="w-3 h-3" />
                </div>
              </th>
              <th className="py-3.5 px-4 font-semibold text-right cursor-pointer hover:bg-zinc-800/40 rounded-lg transition-colors" onClick={() => handleSort("netActual")}>
                <div className="flex items-center justify-end gap-1.5">
                  Thực Nhận Ví (Net) <ArrowUpDown className="w-3 h-3" />
                </div>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5 font-sans">
            {sortedRows.length === 0 ? (
              <tr>
                <td colSpan="6" className="py-8 text-center text-zinc-500 font-medium">
                  Chưa có thông tin doanh thu gian hàng
                </td>
              </tr>
            ) : (
              sortedRows.map((row, idx) => (
                <tr key={idx} className="hover:bg-[#16171d]/25 transition-colors">
                  <td className="py-3.5 px-4 font-bold text-zinc-200 flex items-center gap-2.5">
                    <span className="w-1.5 h-6 rounded bg-[#3b82f6]/60 shrink-0" />
                    {row.name}
                  </td>
                  <td className="py-3.5 px-4 font-bold text-right text-zinc-100">{row.orders} đơn</td>
                  <td className="py-3.5 px-4 font-extrabold text-right text-emerald-400">{formatVnd(row.revenue)}</td>
                  <td className="py-3.5 px-4 font-bold text-right text-rose-400">-{formatVnd(row.fees)}</td>
                  <td className="py-3.5 px-4 font-extrabold text-right text-amber-400">{formatVnd(row.netExpected)}</td>
                  <td className="py-3.5 px-4 font-extrabold text-right text-[#3b82f6]">{formatVnd(row.netActual)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
