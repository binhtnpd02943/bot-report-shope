"use client";

import React, { useState } from "react";
import { ArrowUpDown, Box, ShoppingBag } from "lucide-react";

export default function ProductTable({ activeReport }) {
  const [sortField, setSortField] = useState("qty");
  const [sortAsc, setSortAsc] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  if (!activeReport) return null;

  const topProducts = activeReport.topProducts || [];

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

  // Filter products by search term
  const filteredProducts = topProducts.filter(p => {
    const term = searchTerm.toLowerCase();
    return (
      (p.name || "").toLowerCase().includes(term) ||
      (p.sku || "").toLowerCase().includes(term) ||
      (p.shopName || "").toLowerCase().includes(term)
    );
  });

  // Sort products
  const sortedProducts = [...filteredProducts].sort((a, b) => {
    let valA = a[sortField];
    let valB = b[sortField];
    
    if (typeof valA === "string") {
      return sortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
    }
    return sortAsc ? valA - valB : valB - valA;
  });

  return (
    <div className="glass-card rounded-2xl p-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-[#10b981]/10 rounded-lg">
            <ShoppingBag className="w-5 h-5 text-[#10b981]" />
          </div>
          <div>
            <h4 className="text-lg font-bold text-[#f3f4f6] tracking-tight font-sans">Product Sales Performance</h4>
            <p className="text-xs text-zinc-400">Danh sách hiệu suất bán hàng của từng SKU & Sản phẩm</p>
          </div>
        </div>
        
        {/* Search Input */}
        <div className="relative">
          <input
            type="text"
            placeholder="Tìm kiếm sản phẩm, SKU..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full md:w-64 bg-zinc-800/40 text-xs text-zinc-200 pl-4 pr-10 py-2.5 rounded-xl border border-white/5 focus:border-[#10b981]/50 focus:outline-none transition-all placeholder-zinc-500"
          />
          <Box className="absolute right-3.5 top-3 w-4 h-4 text-zinc-500 pointer-events-none" />
        </div>
      </div>

      <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="border-b border-white/5 text-zinc-400 uppercase tracking-wider text-[10px] font-semibold bg-[#16171d]/40 sticky top-0 z-10">
              <th className="py-3 px-4 font-semibold text-zinc-300">Tên Sản Phẩm</th>
              <th className="py-3 px-4 font-semibold cursor-pointer hover:bg-zinc-800/40 rounded transition-colors" onClick={() => handleSort("sku")}>
                <div className="flex items-center gap-1">
                  Mã SKU <ArrowUpDown className="w-3 h-3" />
                </div>
              </th>
              <th className="py-3 px-4 font-semibold">Phân Loại / Phiên Bản</th>
              <th className="py-3 px-4 font-semibold cursor-pointer hover:bg-zinc-800/40 rounded transition-colors" onClick={() => handleSort("shopName")}>
                <div className="flex items-center gap-1">
                  Gian Hàng <ArrowUpDown className="w-3 h-3" />
                </div>
              </th>
              <th className="py-3 px-4 font-semibold text-right cursor-pointer hover:bg-zinc-800/40 rounded transition-colors" onClick={() => handleSort("qty")}>
                <div className="flex items-center justify-end gap-1">
                  Đã Bán <ArrowUpDown className="w-3 h-3" />
                </div>
              </th>
              <th className="py-3 px-4 font-semibold text-right cursor-pointer hover:bg-zinc-800/40 rounded transition-colors" onClick={() => handleSort("revenue")}>
                <div className="flex items-center justify-end gap-1">
                  Doanh Thu SP <ArrowUpDown className="w-3 h-3" />
                </div>
              </th>
              <th className="py-3 px-4 font-semibold text-right cursor-pointer hover:bg-zinc-800/40 rounded transition-colors" onClick={() => handleSort("cancelledQty")}>
                <div className="flex items-center justify-end gap-1">
                  Hủy / Trả <ArrowUpDown className="w-3 h-3" />
                </div>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5 font-sans">
            {sortedProducts.length === 0 ? (
              <tr>
                <td colSpan="7" className="py-8 text-center text-zinc-500 font-medium">
                  Không tìm thấy sản phẩm nào
                </td>
              </tr>
            ) : (
              sortedProducts.map((p, idx) => (
                <tr key={idx} className="hover:bg-[#16171d]/25 transition-colors">
                  <td className="py-3 px-4 font-bold text-zinc-200 max-w-[200px] truncate" title={p.fullName || p.name}>
                    {p.name}
                  </td>
                  <td className="py-3 px-4 font-semibold text-zinc-400">{p.sku || "N/A"}</td>
                  <td className="py-3 px-4 text-zinc-400 font-medium">{p.variantName || "N/A"}</td>
                  <td className="py-3 px-4 text-zinc-300 font-semibold">{p.shopName}</td>
                  <td className="py-3 px-4 font-extrabold text-right text-emerald-400">{p.qty} chiếc</td>
                  <td className="py-3 px-4 font-extrabold text-right text-zinc-200">{formatVnd(p.revenue)}</td>
                  <td className="py-3 px-4 text-right">
                    <span className={`font-bold ${p.cancelledQty > 0 ? "text-rose-400" : "text-zinc-500"}`}>
                      {p.cancelledQty || 0} chiếc ({p.cancelledRate || 0}%)
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
