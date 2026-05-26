"use client";

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { LayoutDashboard, FileSpreadsheet, Settings, Store, ShoppingCart, RefreshCw, AlertCircle } from "lucide-react";

import SyncPanel from "../components/SyncPanel";
import KpiGrid from "../components/KpiGrid";
import FeeChart from "../components/FeeChart";
import ShopChart from "../components/ShopChart";
import ProductChart from "../components/ProductChart";
import HistoryChart from "../components/HistoryChart";
import ShopTable from "../components/ShopTable";
import ProductTable from "../components/ProductTable";

export default function DashboardPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reports, setReports] = useState([]);
  const [activeDate, setActiveDate] = useState("");
  const [activeReport, setActiveReport] = useState(null);
  const [isMock, setIsMock] = useState(false);
  const [activeTab, setActiveTab] = useState("dashboard"); // sidebar active tab

  const fetchDashboardData = async (targetActiveDate = null) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("http://localhost:3000/api/analytics/dashboard");
      const result = await res.json();
      
      if (result.success && result.data && result.data.length > 0) {
        setReports(result.data);
        setIsMock(result.isMock || false);
        
        // Select active report
        let selectedReport = result.data[result.data.length - 1]; // default to latest
        if (targetActiveDate) {
          const found = result.data.find(r => r.reportDate === targetActiveDate);
          if (found) selectedReport = found;
        }
        
        setActiveReport(selectedReport);
        setActiveDate(selectedReport.reportDate);
      } else {
        setError("Không nhận được dữ liệu báo cáo từ máy chủ.");
      }
    } catch (e) {
      console.error("Fetch dashboard error:", e);
      setError("Không thể kết nối đến máy chủ API Express. Vui lòng đảm bảo backend đang chạy trên cổng 3000.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const handleDateChange = (date) => {
    const found = reports.find(r => r.reportDate === date);
    if (found) {
      setActiveReport(found);
      setActiveDate(date);
    }
  };

  const handleSyncComplete = async (newReportDate) => {
    // Reload database reports and select the newly scraped one
    await fetchDashboardData(newReportDate);
  };

  // Fade-in variants for cards
  const containerVariants = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: {
        staggerChildren: 0.08
      }
    }
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 15 },
    show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 100 } }
  };

  return (
    <div className="flex min-h-screen bg-[#090a0f] text-[#f3f4f6]">
      
      {/* ── Left Sidebar Navigation (Lark Style) ── */}
      <aside className="hidden lg:flex flex-col w-64 bg-[#111218]/90 border-r border-white/5 p-6 shrink-0 z-20">
        {/* Branding header */}
        <div className="flex items-center gap-3 mb-8 px-2">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#10b981] to-[#3b82f6] flex items-center justify-center font-black text-sm text-[#090a0f]">
            L
          </div>
          <span className="font-extrabold text-base tracking-tight bg-gradient-to-r from-zinc-100 to-zinc-400 bg-clip-text text-transparent">
            Lark Bitable
          </span>
        </div>

        {/* Navigation items */}
        <nav className="flex-1 space-y-1.5">
          <button
            onClick={() => setActiveTab("dashboard")}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              activeTab === "dashboard"
                ? "bg-[#3b82f6]/10 text-[#3b82f6] border border-[#3b82f6]/15"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-white/5 border border-transparent"
            }`}
          >
            <LayoutDashboard className="w-4 h-4 shrink-0" />
            <span>Dashboard Tổng Quan</span>
          </button>
          
          <button
            onClick={() => setActiveTab("shops")}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              activeTab === "shops"
                ? "bg-[#3b82f6]/10 text-[#3b82f6] border border-[#3b82f6]/15"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-white/5 border border-transparent"
            }`}
          >
            <Store className="w-4 h-4 shrink-0" />
            <span>Phân Tích Gian Hàng</span>
          </button>
          
          <button
            onClick={() => setActiveTab("products")}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              activeTab === "products"
                ? "bg-[#3b82f6]/10 text-[#3b82f6] border border-[#3b82f6]/15"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-white/5 border border-transparent"
            }`}
          >
            <ShoppingCart className="w-4 h-4 shrink-0" />
            <span>Sản Phẩm Bán Chạy</span>
          </button>

          <button
            onClick={() => setActiveTab("history")}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              activeTab === "history"
                ? "bg-[#3b82f6]/10 text-[#3b82f6] border border-[#3b82f6]/15"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-white/5 border border-transparent"
            }`}
          >
            <FileSpreadsheet className="w-4 h-4 shrink-0" />
            <span>Lịch Sử Báo Cáo</span>
          </button>
        </nav>

        {/* Sidebar Footer settings */}
        <div className="pt-4 border-t border-white/5">
          <button 
            onClick={() => setActiveTab("settings")}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              activeTab === "settings"
                ? "bg-[#3b82f6]/10 text-[#3b82f6] border border-[#3b82f6]/15"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-white/5 border border-transparent"
            }`}
          >
            <Settings className="w-4 h-4 shrink-0" />
            <span>Cấu Hình Bot</span>
          </button>
        </div>
      </aside>

      {/* ── Main Content Area ── */}
      <main className="flex-1 min-w-0 p-6 lg:p-8 overflow-y-auto z-10">
        
        {/* Loading state screen */}
        <AnimatePresence mode="wait">
          {loading && (
            <motion.div 
              key="loader"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-[#090a0f]/90 flex flex-col items-center justify-center z-50"
            >
              <RefreshCw className="w-10 h-10 text-[#10b981] animate-spin mb-4" />
              <p className="text-sm font-semibold text-zinc-300">Đang đồng bộ dữ liệu tài chính Shopee...</p>
            </motion.div>
          )}

          {/* Error fallback state screen */}
          {error && !loading && (
            <motion.div 
              key="error"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="min-h-[80vh] flex flex-col items-center justify-center p-6"
            >
              <div className="glass-card max-w-md rounded-3xl p-8 border-rose-500/20 text-center flex flex-col items-center">
                <AlertCircle className="w-14 h-14 text-rose-400 mb-4" />
                <h3 className="text-lg font-bold text-zinc-200 mb-2">Không Thể Kết Nối</h3>
                <p className="text-xs text-zinc-400 mb-6 leading-relaxed">
                  {error}
                </p>
                <button
                  onClick={() => fetchDashboardData()}
                  className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-[#10b981] to-[#3b82f6] text-xs font-bold text-[#090a0f] hover:opacity-90 active:scale-95 transition-all cursor-pointer"
                >
                  Thử Kết Nối Lại
                </button>
              </div>
            </motion.div>
          )}

          {/* Main Dashboard Render */}
          {!loading && !error && activeReport && (
            <motion.div
              key="content"
              variants={containerVariants}
              initial="hidden"
              animate="show"
              className="space-y-6"
            >
              {/* Header section */}
              <SyncPanel 
                reports={reports}
                activeDate={activeDate}
                onDateChange={handleDateChange}
                onSyncComplete={handleSyncComplete}
                isMock={isMock}
              />

              {/* Conditionally render content tabs based on Sidebar selection */}
              {activeTab === "dashboard" && (
                <>
                  {/* Row 1: KPI Stats Grid */}
                  <motion.div variants={itemVariants}>
                    <KpiGrid activeReport={activeReport} />
                  </motion.div>

                  {/* Row 2: Trend Analysis & Fee Breakdown */}
                  <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                    <motion.div variants={itemVariants} className="xl:col-span-2">
                      <HistoryChart reportsHistory={reports} />
                    </motion.div>
                    <motion.div variants={itemVariants}>
                      <FeeChart activeReport={activeReport} />
                    </motion.div>
                  </div>

                  {/* Row 3: Shop Breakdown & Product Distribution */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <motion.div variants={itemVariants}>
                      <ShopChart activeReport={activeReport} />
                    </motion.div>
                    <motion.div variants={itemVariants}>
                      <ProductChart activeReport={activeReport} />
                    </motion.div>
                  </div>

                  {/* Row 4: Performance Tables */}
                  <motion.div variants={itemVariants}>
                    <ShopTable activeReport={activeReport} />
                  </motion.div>

                  <motion.div variants={itemVariants}>
                    <ProductTable activeReport={activeReport} />
                  </motion.div>
                </>
              )}

              {activeTab === "shops" && (
                <div className="space-y-6">
                  <motion.div variants={itemVariants}>
                    <ShopChart activeReport={activeReport} />
                  </motion.div>
                  <motion.div variants={itemVariants}>
                    <ShopTable activeReport={activeReport} />
                  </motion.div>
                </div>
              )}

              {activeTab === "products" && (
                <div className="space-y-6">
                  <motion.div variants={itemVariants}>
                    <ProductChart activeReport={activeReport} />
                  </motion.div>
                  <motion.div variants={itemVariants}>
                    <ProductTable activeReport={activeReport} />
                  </motion.div>
                </div>
              )}

              {activeTab === "history" && (
                <div className="space-y-6">
                  <motion.div variants={itemVariants}>
                    <HistoryChart reportsHistory={reports} />
                  </motion.div>
                  <div className="glass-card rounded-2xl p-6">
                    <h4 className="text-sm font-bold text-zinc-200 mb-4">Lịch sử kết xuất báo cáo trong SQLite</h4>
                    <div className="space-y-3">
                      {reports.slice().reverse().map((r, idx) => (
                        <div key={idx} className="flex items-center justify-between p-3.5 bg-zinc-800/20 border border-white/5 rounded-xl text-xs hover:border-zinc-700/50 transition-colors">
                          <div className="flex items-center gap-3">
                            <span className="w-2.5 h-2.5 rounded-full bg-[#10b981]" />
                            <span className="font-extrabold text-zinc-300">Báo cáo Shopee ngày {r.reportDate}</span>
                          </div>
                          <div className="flex items-center gap-4 text-zinc-400">
                            <span>Đơn hàng: <strong className="text-[#3b82f6] font-bold">{r.totalOrders}</strong></span>
                            <span>Doanh số: <strong className="text-[#10b981] font-bold">{new Intl.NumberFormat("vi-VN").format(r.totalRevenue)} đ</strong></span>
                            <button
                              onClick={() => {
                                handleDateChange(r.reportDate);
                                setActiveTab("dashboard");
                              }}
                              className="px-3 py-1.5 rounded-lg bg-zinc-800 text-[#10b981] font-bold border border-[#10b981]/15 hover:bg-[#10b981] hover:text-[#090a0f] transition-all cursor-pointer"
                            >
                              Xem Chi Tiết
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {activeTab === "settings" && (
                <div className="glass-card rounded-3xl p-8 max-w-2xl">
                  <h3 className="text-lg font-extrabold text-zinc-100 mb-2">Cấu Hình Kết Nối Shopee & Sapo</h3>
                  <p className="text-xs text-zinc-400 mb-6 leading-relaxed">
                    Trang cấu hình bot tự động. Thiết lập này được đồng bộ qua tệp cấu hình <code className="bg-zinc-800 px-1.5 py-0.5 rounded text-rose-400 font-mono text-[10px]">.env</code> của middleware.
                  </p>
                  
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1.5">Sapo Store Alias</label>
                        <input 
                          type="text" 
                          readOnly 
                          value={process.env.NEXT_PUBLIC_SAPO_STORE_ALIAS || "luxidecor"} 
                          className="w-full bg-zinc-900 text-xs text-zinc-400 px-4 py-3 rounded-xl border border-white/5"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1.5">Integration Mode</label>
                        <input 
                          type="text" 
                          readOnly 
                          value="sapo_go_scrape (TMĐT Shopee)" 
                          className="w-full bg-zinc-900 text-xs text-zinc-400 px-4 py-3 rounded-xl border border-white/5"
                        />
                      </div>
                    </div>

                    <div className="p-4 bg-zinc-900/40 border border-white/5 rounded-2xl text-xs leading-relaxed text-zinc-400">
                      <span className="font-bold text-zinc-200 block mb-1">💡 Hướng Dẫn Vận Hành:</span>
                      1. Bot tự động cào báo cáo Sapo Go lúc **8:00 sáng mỗi ngày**.<br />
                      2. Để lấy dữ liệu đột xuất hoặc báo cáo ngày hôm qua ngay lập tức, hãy nhấn nút **"Đồng Bộ Sapo"** bên trên.<br />
                      3. Dữ liệu sau khi cào sẽ tự động gửi thông báo Card về **Lark Chat**, đồng bộ bảng biểu **Lark Bitable** và lưu trữ cục bộ vào **SQLite** để cung cấp cho Dashboard này.
                    </div>
                  </div>
                </div>
              )}

            </motion.div>
          )}
        </AnimatePresence>
      </main>

    </div>
  );
}
