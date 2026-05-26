"use client";

import React, { useState } from "react";
import { RefreshCw, Calendar, CheckCircle2, AlertCircle, Loader } from "lucide-react";

export default function SyncPanel({ 
  reports, 
  activeDate, 
  onDateChange, 
  onSyncComplete,
  isMock
}) {
  const [isSyncing, setIsSyncing] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const handleSync = async () => {
    setIsSyncing(true);
    setErrorMsg("");
    setSuccessMsg("");
    try {
      const response = await fetch("http://localhost:3000/api/report/trigger", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ sync: true })
      });
      
      const result = await response.json();
      if (result.success) {
        setSuccessMsg("Đồng bộ báo cáo Shopee hôm qua thành công!");
        if (onSyncComplete) {
          // Trigger parent refresh
          await onSyncComplete(result.report?.reportDate || result.reportDate);
        }
      } else {
        setErrorMsg(result.error || "Không thể đồng bộ dữ liệu Sapo Go. Vui lòng kiểm tra logs.");
      }
    } catch (e) {
      setErrorMsg("Lỗi kết nối tới máy chủ Express. Đảm bảo cổng 3000 đang chạy.");
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="glass-card rounded-2xl p-6 mb-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        
        {/* Title and Branding */}
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#10b981] to-[#3b82f6] flex items-center justify-center font-black text-xl text-[#090a0f] shadow-lg shadow-emerald-500/10">
            L
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-black tracking-tight text-[#f3f4f6]">BÁO CÁO TÀI CHÍNH SHOPEE DAILY</h1>
              {isMock ? (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/20 pulse-glow">
                  DỮ LIỆU MẪU (DEMO)
                </span>
              ) : (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#10b981]/15 text-[#10b981] border border-[#10b981]/20">
                  KẾT NỐI SAPO THỰC
                </span>
              )}
            </div>
            <p className="text-xs text-zinc-400 mt-0.5 font-medium">
              Lark Bitable Shopee Financial Integration Dashboard
            </p>
          </div>
        </div>

        {/* Date Selector & Sync Action */}
        <div className="flex flex-wrap items-center gap-4">
          
          {/* Target Date Dropdown Selector */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5 text-zinc-500" /> Ngày Báo Cáo:
            </span>
            <select
              value={activeDate}
              onChange={(e) => onDateChange(e.target.value)}
              className="bg-zinc-800/40 text-xs font-bold text-zinc-100 px-3 py-2.5 rounded-xl border border-white/5 focus:outline-none cursor-pointer focus:border-[#3b82f6]/50"
            >
              {reports.map((report) => (
                <option key={report.reportDate} value={report.reportDate}>
                  {report.reportDate}
                </option>
              ))}
            </select>
          </div>

          {/* Sync Button */}
          <button
            onClick={handleSync}
            disabled={isSyncing}
            className={`flex items-center gap-2 text-xs font-bold px-4 py-2.5 rounded-xl cursor-pointer shadow-lg shadow-emerald-500/5 hover:-translate-y-0.5 active:translate-y-0 select-none transition-all ${
              isSyncing 
                ? "bg-[#10b981]/10 text-[#10b981] border border-[#10b981]/20 cursor-wait" 
                : "bg-[#10b981] text-[#090a0f] hover:bg-[#0ea5e9] border border-transparent"
            }`}
          >
            {isSyncing ? (
              <>
                <Loader className="w-4 h-4 animate-spin" />
                <span>Đang cào Sapo Go...</span>
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4" />
                <span>Đồng Bộ Sapo</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Notifications banner */}
      {(successMsg || errorMsg) && (
        <div className="mt-4 pt-4 border-t border-white/5 flex items-center gap-3">
          {successMsg && (
            <div className="flex items-center gap-2 text-xs text-[#10b981] bg-[#10b981]/10 px-4 py-2 rounded-xl border border-[#10b981]/15 w-full">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span className="font-semibold">{successMsg}</span>
            </div>
          )}
          {errorMsg && (
            <div className="flex items-center gap-2 text-xs text-rose-400 bg-rose-500/10 px-4 py-2 rounded-xl border border-rose-500/15 w-full">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span className="font-semibold">{errorMsg}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
