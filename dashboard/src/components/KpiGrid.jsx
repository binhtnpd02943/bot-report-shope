"use client";

import React from "react";
import { TrendingUp, Wallet, Coins, Percent, ArrowUpRight } from "lucide-react";

export default function KpiGrid({ activeReport }) {
  if (!activeReport) return null;

  // Format currency helpers
  const formatVnd = (num) => {
    return new Intl.NumberFormat("vi-VN").format(num) + " VNĐ";
  };

  const formatShortVnd = (num) => {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + "M VNĐ";
    }
    return formatVnd(num);
  };

  const grossSales = activeReport.totalRevenue || 0;
  const netWallet = activeReport.netRevenue || 0;
  const expectedNet = activeReport.expectedNetRevenue || activeReport.totalRevenue - (activeReport.fees?.total || 0);
  const shopeeFees = activeReport.fees?.total || 0;
  const feeRate = activeReport.feeRate || (grossSales > 0 ? ((shopeeFees / grossSales) * 100).toFixed(1) : 0);

  // Growth percentages (comparing to day before if available)
  const calcGrowth = (today, yesterday) => {
    if (!yesterday || yesterday === 0) return null;
    const diff = today - yesterday;
    return ((diff / yesterday) * 100).toFixed(1);
  };

  const salesGrowth = calcGrowth(grossSales, activeReport.dayBeforeRevenue);
  const netGrowth = calcGrowth(netWallet, activeReport.dayBeforeNetRevenue);
  const expectedGrowth = calcGrowth(expectedNet, activeReport.dayBeforeExpectedNet);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
      {/* 1. Gross Sales Card */}
      <div className="glass-card rounded-2xl p-6 relative overflow-hidden bg-gradient-to-br from-[#10b981]/15 to-[#16171d]/80 border-[#10b981]/25">
        <div className="absolute top-0 right-0 w-32 h-32 bg-[#10b981]/5 rounded-full blur-3xl -mr-5 -mt-5" />
        <div className="flex justify-between items-start mb-4">
          <div className="p-3 bg-[#10b981]/15 rounded-xl border border-[#10b981]/20">
            <TrendingUp className="w-6 h-6 text-[#10b981]" />
          </div>
          {salesGrowth && (
            <span className={`flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full ${Number(salesGrowth) >= 0 ? "bg-[#10b981]/15 text-[#10b981]" : "bg-red-500/15 text-red-400"}`}>
              {Number(salesGrowth) >= 0 ? "+" : ""}{salesGrowth}%
            </span>
          )}
        </div>
        <p className="text-[#a1a1aa] text-sm font-medium mb-1 uppercase tracking-wider">Gross Sales (Doanh Số Gốc)</p>
        <h3 className="text-3xl font-extrabold text-[#f3f4f6] tracking-tight flex items-baseline gap-2">
          {formatShortVnd(grossSales)}
          <span className="text-xs text-[#a1a1aa] font-normal block md:inline">({formatVnd(grossSales)})</span>
        </h3>
        <div className="flex items-center gap-1.5 mt-4 text-[#10b981] text-xs font-medium">
          <ArrowUpRight className="w-3.5 h-3.5" />
          <span>Ghi nhận phát sinh hôm qua</span>
        </div>
      </div>

      {/* 2. Net Wallet Revenue Card */}
      <div className="glass-card rounded-2xl p-6 relative overflow-hidden bg-gradient-to-br from-[#3b82f6]/15 to-[#16171d]/80 border-[#3b82f6]/25">
        <div className="absolute top-0 right-0 w-32 h-32 bg-[#3b82f6]/5 rounded-full blur-3xl -mr-5 -mt-5" />
        <div className="flex justify-between items-start mb-4">
          <div className="p-3 bg-[#3b82f6]/15 rounded-xl border border-[#3b82f6]/20">
            <Wallet className="w-6 h-6 text-[#3b82f6]" />
          </div>
          {netGrowth && (
            <span className={`flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full ${Number(netGrowth) >= 0 ? "bg-[#3b82f6]/15 text-[#3b82f6]" : "bg-red-500/15 text-red-400"}`}>
              {Number(netGrowth) >= 0 ? "+" : ""}{netGrowth}%
            </span>
          )}
        </div>
        <p className="text-[#a1a1aa] text-sm font-medium mb-1 uppercase tracking-wider">Net Wallet (Thực Nhận Ví)</p>
        <h3 className="text-3xl font-extrabold text-[#f3f4f6] tracking-tight flex items-baseline gap-2">
          {formatShortVnd(netWallet)}
          <span className="text-xs text-[#a1a1aa] font-normal block md:inline">({formatVnd(netWallet)})</span>
        </h3>
        <div className="flex items-center gap-1.5 mt-4 text-[#3b82f6] text-xs font-medium">
          <ArrowUpRight className="w-3.5 h-3.5" />
          <span>Dòng tiền thực đã đối soát về ví</span>
        </div>
      </div>

      {/* 3. Expected Net Revenue Card */}
      <div className="glass-card rounded-2xl p-6 relative overflow-hidden bg-gradient-to-br from-[#f59e0b]/15 to-[#16171d]/80 border-[#f59e0b]/25">
        <div className="absolute top-0 right-0 w-32 h-32 bg-[#f59e0b]/5 rounded-full blur-3xl -mr-5 -mt-5" />
        <div className="flex justify-between items-start mb-4">
          <div className="p-3 bg-[#f59e0b]/15 rounded-xl border border-[#f59e0b]/20">
            <Coins className="w-6 h-6 text-[#f59e0b]" />
          </div>
          {expectedGrowth && (
            <span className={`flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full ${Number(expectedGrowth) >= 0 ? "bg-[#f59e0b]/15 text-[#f59e0b]" : "bg-red-500/15 text-red-400"}`}>
              {Number(expectedGrowth) >= 0 ? "+" : ""}{expectedGrowth}%
            </span>
          )}
        </div>
        <p className="text-[#a1a1aa] text-sm font-medium mb-1 uppercase tracking-wider">Expected Net (Dự Kiến Nhận)</p>
        <h3 className="text-3xl font-extrabold text-[#f3f4f6] tracking-tight flex items-baseline gap-2">
          {formatShortVnd(expectedNet)}
          <span className="text-xs text-[#a1a1aa] font-normal block md:inline">({formatVnd(expectedNet)})</span>
        </h3>
        <div className="flex items-center gap-1.5 mt-4 text-[#f59e0b] text-xs font-medium">
          <ArrowUpRight className="w-3.5 h-3.5" />
          <span>Doanh thu thực nhận sau trừ phí thô</span>
        </div>
      </div>

      {/* 4. Shopee Fees Card */}
      <div className="glass-card rounded-2xl p-6 relative overflow-hidden bg-gradient-to-br from-[#f43f5e]/15 to-[#16171d]/80 border-[#f43f5e]/25">
        <div className="absolute top-0 right-0 w-32 h-32 bg-[#f43f5e]/5 rounded-full blur-3xl -mr-5 -mt-5" />
        <div className="flex justify-between items-start mb-4">
          <div className="p-3 bg-[#f43f5e]/15 rounded-xl border border-[#f43f5e]/20">
            <Percent className="w-6 h-6 text-[#f43f5e]" />
          </div>
          <span className="bg-[#f43f5e]/15 text-[#f43f5e] text-xs font-semibold px-2.5 py-1 rounded-full">
            Tỉ lệ: {feeRate}%
          </span>
        </div>
        <p className="text-[#a1a1aa] text-sm font-medium mb-1 uppercase tracking-wider">Shopee Fees (Tổng Phí Sàn)</p>
        <h3 className="text-3xl font-extrabold text-[#f3f4f6] tracking-tight flex items-baseline gap-2">
          {formatShortVnd(shopeeFees)}
          <span className="text-xs text-[#a1a1aa] font-normal block md:inline">({formatVnd(shopeeFees)})</span>
        </h3>
        <div className="flex items-center gap-1.5 mt-4 text-[#f43f5e] text-xs font-medium">
          <ArrowUpRight className="w-3.5 h-3.5" />
          <span>Bao gồm phí thanh toán, cố định, dịch vụ</span>
        </div>
      </div>
    </div>
  );
}
