import React, { useState, useMemo } from 'react';
import { useAsync } from 'react-async-hook';
import { 
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  PieChart, Pie, Cell, Legend
} from 'recharts';
import { 
  DollarSign, ShoppingBag, RefreshCcw, AlertTriangle, 
  Award, TrendingUp, HelpCircle
} from 'lucide-react';
import { getTableData } from './utils';
import './App.css';

// Helper to extract clean values from Lark Bitable cell value structure
function getCellValue(cellValue: any): any {
  if (cellValue === null || cellValue === undefined) return null;
  if (typeof cellValue === 'number' || typeof cellValue === 'boolean' || typeof cellValue === 'string') {
    return cellValue;
  }
  if (Array.isArray(cellValue)) {
    if (cellValue.length === 0) return null;
    if (cellValue[0] && typeof cellValue[0] === 'object' && 'text' in cellValue[0]) {
      return cellValue.map((run: any) => run.text || '').join('');
    }
    return cellValue;
  }
  if (typeof cellValue === 'object') {
    if ('text' in cellValue) return cellValue.text;
    if ('value' in cellValue) return cellValue.value;
  }
  return cellValue;
}

export const App = () => {
  const response = useAsync(getTableData, []);
  const [selectedDate, setSelectedDate] = useState<string>('');

  // 1. Process Bitable Data & Fields
  const processedData = useMemo(() => {
    if (!response.result) return null;
    const { columns, dataSource } = response.result;

    // Create Field ID -> Field Name map
    const idToNameMap: Record<string, string> = {};
    columns.forEach((col: any) => {
      idToNameMap[col.dataIndex] = col.title;
    });

    // Translate raw row attributes using actual Bitable field names
    const parsedRecords = dataSource.map((row: any) => {
      const parsedRow: Record<string, any> = { recordId: row.recordId };
      Object.keys(row).forEach((key) => {
        if (key === 'recordId') return;
        const fieldName = idToNameMap[key];
        if (fieldName) {
          parsedRow[fieldName] = getCellValue(row[key]);
        }
      });

      // Smart dynamic fallback: in case 'Kênh bán hàng' or 'Doanh thu gộp' are not physically present,
      // calculate them in-memory to ensure dashboard is 100% robust and backwards-compatible!
      if (!parsedRow['Kênh bán hàng']) {
        if (parsedRow['Tên chi nhánh']) {
          parsedRow['Kênh bán hàng'] = 'Sapo POS';
        } else if (parsedRow['Shop']) {
          parsedRow['Kênh bán hàng'] = 'Shopee';
        }
      }

      if (!parsedRow['Doanh thu gộp']) {
        if (parsedRow['Kênh bán hàng'] === 'Sapo POS') {
          parsedRow['Doanh thu gộp'] = Number(parsedRow['Doanh thu'] || 0);
        } else if (parsedRow['Kênh bán hàng'] === 'Shopee') {
          parsedRow['Doanh thu gộp'] = Number(parsedRow['Gross Sales'] || 0);
        }
      }

      return parsedRow;
    });

    // Determine the unique list of dates in the dataset, sorted descending
    const dates = Array.from(new Set(
      parsedRecords
        .map(r => r['Ngày'])
        .filter(Boolean)
    )).sort((a: any, b: any) => {
      const partsA = a.split('/');
      const partsB = b.split('/');
      if (partsA.length === 3 && partsB.length === 3) {
        const da = new Date(partsA[2], partsA[1] - 1, partsA[0]);
        const db = new Date(partsB[2], partsB[1] - 1, partsB[0]);
        return db.getTime() - da.getTime();
      }
      return b.localeCompare(a);
    });

    return { records: parsedRecords, dates };
  }, [response.result]);

  // Determine active date (default to latest date in the dataset)
  const activeDate = useMemo(() => {
    if (!processedData || !processedData.dates || processedData.dates.length === 0) return '';
    if (selectedDate && processedData.dates.includes(selectedDate)) return selectedDate;
    return processedData.dates[0];
  }, [processedData, selectedDate]);

  // Calculate dynamic metrics based on a 7-day rolling window ending on activeDate
  const dashboardData = useMemo(() => {
    if (!processedData || !activeDate) return null;

    // Helper to generate 7-day list ending on activeDate
    const get7DaysList = (endDateStr: string) => {
      const parts = endDateStr.split('/');
      if (parts.length !== 3) return [endDateStr];
      const dates = [];
      const end = new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
      for (let i = 0; i < 7; i++) {
        const d = new Date(end);
        d.setDate(end.getDate() - i);
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const yyyy = d.getFullYear();
        dates.push(`${dd}/${mm}/${yyyy}`);
      }
      return dates;
    };

    const target7Days = get7DaysList(activeDate);
    const rollingRecords = processedData.records.filter(r => target7Days.includes(r['Ngày']));

    // --- 1. KPI CARD COMPUTATIONS ---
    const totalRevenue = rollingRecords.reduce((acc, r) => acc + Number(r['Doanh thu gộp'] || 0), 0);
    const totalOrders = rollingRecords.reduce((acc, r) => acc + Number(r['SL đơn hàng'] || 0), 0);
    
    // Shopee Net Revenue (Thực nhận)
    const shopeeNetRevenue = rollingRecords
      .filter(r => r['Kênh bán hàng'] === 'Shopee')
      .reduce((acc, r) => acc + Number(r['Doanh thu thực nhận'] || 0), 0);

    // Best Employee (Nhân viên xuất sắc nhất)
    const employeeSalesMap: Record<string, { name: string; revenue: number; orders: number }> = {};
    rollingRecords
      .filter(r => r['Kênh bán hàng'] === 'Sapo POS' && r['Tên nhân viên'] && r['Tên nhân viên'] !== 'Không rõ')
      .forEach(r => {
        const name = r['Tên nhân viên'];
        if (!employeeSalesMap[name]) {
          employeeSalesMap[name] = { name, revenue: 0, orders: 0 };
        }
        employeeSalesMap[name].revenue += Number(r['Doanh thu'] || 0);
        employeeSalesMap[name].orders += Number(r['SL đơn hàng'] || 0);
      });
    
    const sortedEmployees = Object.values(employeeSalesMap).sort((a, b) => b.revenue - a.revenue);
    const bestEmployee = sortedEmployees[0] || { name: 'Không có', orders: 0 };

    // --- 2. CHART COMPUTATIONS ---
    // A. Pie Chart: Tỷ trọng doanh thu theo Shopee Shop (7 ngày) - Chỉ gồm 6 shop Shopee!
    const shopeeShopRevenueMap: Record<string, number> = {};
    const shopeeTotalRev = rollingRecords
      .filter(r => r['Kênh bán hàng'] === 'Shopee')
      .reduce((acc, r) => acc + Number(r['Doanh thu gộp'] || 0), 0);

    rollingRecords
      .filter(r => r['Kênh bán hàng'] === 'Shopee' && r['Shop'])
      .forEach(r => {
        const name = r['Shop'];
        shopeeShopRevenueMap[name] = (shopeeShopRevenueMap[name] || 0) + Number(r['Doanh thu gộp'] || 0);
      });

    const shopRatioData = Object.entries(shopeeShopRevenueMap)
      .map(([name, value]) => ({
        name: name.replace(' Wood - Decor', '').replace(' DECOR', '').replace(' LUXI', '').replace('LUXI', '').trim(),
        value,
        percentage: shopeeTotalRev ? (value / shopeeTotalRev) * 100 : 0
      }))
      .sort((a, b) => b.value - a.value);

    // B. Bar Chart: Doanh thu chi nhánh Sapo 7 ngày qua - Hiển thị theo từng ngày (25/5 -> 31/5)
    const sorted7DaysAsc = target7Days.slice().reverse();
    const branchChartData = sorted7DaysAsc.map(date => {
      const daySapoRevenue = rollingRecords
        .filter(r => r['Kênh bán hàng'] === 'Sapo POS' && r['Ngày'] === date)
        .reduce((acc, r) => acc + Number(r['Doanh thu'] || 0), 0);
      
      const shortDate = date.split('/').slice(0, 2).join('/'); // 'DD/MM'
      return {
        name: shortDate,
        value: daySapoRevenue
      };
    });

    // C. Bar Chart: Đóng góp doanh thu của nhân viên Sapo
    const employeeChartData = sortedEmployees.map(emp => ({
      name: emp.name.split('-')[0].trim(), // Shorten for aesthetics
      value: emp.revenue,
      displayValue: (emp.revenue / 1000000).toFixed(1) + 'M'
    })).slice(0, 5); // top 5 employees

    // D. Stacked Bar Chart: Cơ cấu phí sàn Shopee
    const shopeeShopFeeMap: Record<string, { shop: string; payment: number; commission: number; service: number }> = {};
    rollingRecords
      .filter(r => r['Kênh bán hàng'] === 'Shopee' && r['Shop'])
      .forEach(r => {
        const shop = r['Shop'];
        if (!shopeeShopFeeMap[shop]) {
          shopeeShopFeeMap[shop] = { shop, payment: 0, commission: 0, service: 0 };
        }
        shopeeShopFeeMap[shop].payment += Number(r['Phí thanh toán'] || 0);
        shopeeShopFeeMap[shop].commission += Number(r['Phí cố định'] || 0);
        shopeeShopFeeMap[shop].service += Number(r['Phí dịch vụ'] || 0);
      });
    
    const stackedBarData = Object.values(shopeeShopFeeMap).map(item => ({
      name: item.shop.replace(' Wood - Decor', '').replace(' DECOR', ''), // Shorten name
      'Phí thanh toán': item.payment,
      'Phí cố định': item.commission,
      'Phí dịch vụ': item.service,
      'Tổng phí': item.payment + item.commission + item.service
    }));

    // --- 3. DETAIL TABLES COMPUTATIONS ---
    // A. Sapo Detailed Branch Activity Table
    const sapoBranchActivity: Record<string, any> = {};
    rollingRecords
      .filter(r => r['Kênh bán hàng'] === 'Sapo POS' && r['Tên chi nhánh'])
      .forEach(r => {
        const name = r['Tên chi nhánh'];
        if (!sapoBranchActivity[name]) {
          sapoBranchActivity[name] = { name, orders: 0, revenue: 0, profit: 0 };
        }
        sapoBranchActivity[name].orders += Number(r['SL đơn hàng'] || 0);
        sapoBranchActivity[name].revenue += Number(r['Doanh thu'] || 0);
        sapoBranchActivity[name].profit += Number(r['Lợi nhuận gộp'] || 0);
      });
    
    const sapoTableRows = Object.values(sapoBranchActivity).map(item => ({
      ...item,
      aov: item.orders > 0 ? Math.round(item.revenue / item.orders) : 0
    })).sort((a, b) => b.revenue - a.revenue);

    // B. Sapo Detailed Employee Activity Table
    const sapoEmployeeActivity: Record<string, any> = {};
    rollingRecords
      .filter(r => r['Kênh bán hàng'] === 'Sapo POS' && r['Tên nhân viên'] && r['Tên nhân viên'] !== 'Không rõ')
      .forEach(r => {
        const name = r['Tên nhân viên'];
        if (!sapoEmployeeActivity[name]) {
          sapoEmployeeActivity[name] = { 
            name, 
            orders: 0, 
            goodsAmt: 0, 
            returned: 0, 
            tax: 0, 
            delivery: 0, 
            revenue: 0, 
            profit: 0 
          };
        }
        sapoEmployeeActivity[name].orders += Number(r['SL đơn hàng'] || 0);
        sapoEmployeeActivity[name].goodsAmt += Number(r['Tiền hàng'] || 0);
        sapoEmployeeActivity[name].returned += Number(r['Tiền hàng trả lại'] || 0);
        sapoEmployeeActivity[name].tax += Number(r['Tiền thuế'] || 0);
        sapoEmployeeActivity[name].delivery += Number(r['Phí giao hàng'] || 0);
        sapoEmployeeActivity[name].revenue += Number(r['Doanh thu'] || 0);
        sapoEmployeeActivity[name].profit += Number(r['Lợi nhuận gộp'] || 0);
      });
    
    const sapoEmployeeRows = Object.values(sapoEmployeeActivity).sort((a, b) => b.revenue - a.revenue);

    const employeeTotals = sapoEmployeeRows.reduce((acc, row) => ({
      orders: acc.orders + row.orders,
      goodsAmt: acc.goodsAmt + row.goodsAmt,
      returned: acc.returned + row.returned,
      tax: acc.tax + row.tax,
      delivery: acc.delivery + row.delivery,
      revenue: acc.revenue + row.revenue,
      profit: acc.profit + row.profit
    }), { orders: 0, goodsAmt: 0, returned: 0, tax: 0, delivery: 0, revenue: 0, profit: 0 });

    // C. Shopee Detailed Shop Financial Table
    const shopeeShopFinancial: Record<string, any> = {};
    rollingRecords
      .filter(r => r['Kênh bán hàng'] === 'Shopee' && r['Shop'])
      .forEach(r => {
        const name = r['Shop'];
        if (!shopeeShopFinancial[name]) {
          shopeeShopFinancial[name] = { 
            name, 
            grossSales: 0, 
            commissionFee: 0, 
            shippingFee: 0, 
            netRevenue: 0, 
            paymentFee: 0, 
            orders: 0 
          };
        }
        shopeeShopFinancial[name].grossSales += Number(r['Gross Sales'] || 0);
        shopeeShopFinancial[name].commissionFee += Number(r['Phí cố định'] || 0);
        shopeeShopFinancial[name].shippingFee += Number(r['Phí dịch vụ'] || 0); // stack service fee in shipping fee column
        shopeeShopFinancial[name].netRevenue += Number(r['Doanh thu thực nhận'] || 0);
        shopeeShopFinancial[name].paymentFee += Number(r['Phí thanh toán'] || 0);
        shopeeShopFinancial[name].orders += Number(r['SL đơn hàng'] || 0);
      });

    const shopeeTableRows = Object.values(shopeeShopFinancial).sort((a, b) => b.grossSales - a.grossSales);

    return {
      totalRevenue,
      totalOrders,
      shopeeNetRevenue,
      bestEmployee,
      shopRatioData,
      branchChartData,
      employeeChartData,
      stackedBarData,
      sapoTableRows,
      sapoEmployeeRows,
      employeeTotals,
      shopeeTableRows
    };
  }, [processedData, activeDate]);

  // Loading indicator
  if (response.loading) {
    return (
      <div className="loader-container">
        <RefreshCcw className="animate-spin text-blue-500" size={36} />
        <span className="loader-text">Đang tải cấu hình WoodDecor Dashboard...</span>
      </div>
    );
  }

  // Handle empty base data compatibility
  if (processedData && processedData.records.length === 0) {
    return (
      <div className="empty-container">
        <AlertTriangle size={56} className="text-yellow-500 mb-4" />
        <h3>Chưa có dữ liệu đồng bộ</h3>
        <p>Bảng **`BÁO CÁO HÀNG NGÀY`** hiện đang trống. Hãy chạy đồng bộ từ Sapo POS/Shopee trước để kích hoạt Dashboard!</p>
      </div>
    );
  }

  const fmtVND = (v: number) => {
    if (v >= 1000000) {
      return (v / 1000000).toFixed(1) + 'M đ';
    }
    return new Intl.NumberFormat('vi-VN').format(v) + ' đ';
  };

  const fmtCurrency = (v: number) => {
    return new Intl.NumberFormat('vi-VN').format(v) + ' đ';
  };

  const fmtNum = (v: number) => new Intl.NumberFormat('vi-VN').format(v);

  return (
    <div className="dashboard-container">
      {/* Background ambient glow shapes for glassmorphism */}
      <div className="ambient-glow glow-1"></div>
      <div className="ambient-glow glow-2"></div>
      <div className="ambient-glow glow-3"></div>

      {/* Modern Executive Frosted Glass Header */}
      <header className="glass-header">
        <div className="header-brand">
          <div className="brand-logo-cube">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M2 17L12 22L22 17" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M2 12L12 17L22 12" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <div className="brand-text">
            <h2>WoodDecor Dashboard</h2>
            <span className="brand-subtitle">Báo cáo Tổng Hợp 7 Ngày qua (All-in-One)</span>
          </div>
        </div>

        {/* Date Controller */}
        <div className="header-controls">
          <div className="date-selector-wrapper">
            <span className="control-label">Ngày đối soát gộp (Chu kỳ 7 ngày):</span>
            {processedData && processedData.dates && (
              <select 
                className="glass-select" 
                value={activeDate}
                onChange={(e) => setSelectedDate(e.target.value)}
              >
                {processedData.dates.map((date) => (
                  <option key={date} value={date}>{date}</option>
                ))}
              </select>
            )}
          </div>
          <button className="icon-btn" title="Cài đặt">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </button>
        </div>
      </header>

      {dashboardData && (
        <div className="dashboard-content-layout">
          
          {/* Row 1: KPI Cards Grid */}
          <section className="sapo-kpi-grid">
            <div className="sapo-kpi-card">
              <div className="sapo-kpi-icon-wrapper blue">
                <DollarSign size={20} />
              </div>
              <div className="sapo-kpi-info">
                <span className="sapo-kpi-label">Tổng doanh thu hệ thống (7 ngày)</span>
                <span className="sapo-kpi-val">{fmtCurrency(dashboardData.totalRevenue)}</span>
              </div>
            </div>

            <div className="sapo-kpi-card">
              <div className="sapo-kpi-icon-wrapper green">
                <ShoppingBag size={20} />
              </div>
              <div className="sapo-kpi-info">
                <span className="sapo-kpi-label">Tổng đơn hàng gộp (7 ngày)</span>
                <span className="sapo-kpi-val">{fmtNum(dashboardData.totalOrders)} đơn</span>
              </div>
            </div>

            <div className="sapo-kpi-card">
              <div className="sapo-kpi-icon-wrapper orange">
                <TrendingUp size={20} />
              </div>
              <div className="sapo-kpi-info">
                <span className="sapo-kpi-label">Shopee thực nhận (7 ngày)</span>
                <span className="sapo-kpi-val">{fmtCurrency(dashboardData.shopeeNetRevenue)}</span>
              </div>
            </div>

            <div className="sapo-kpi-card">
              <div className="sapo-kpi-icon-wrapper purple">
                <Award size={20} />
              </div>
              <div className="sapo-kpi-info">
                <span className="sapo-kpi-label">Nhân viên xuất sắc nhất (7 ngày)</span>
                <span className="sapo-kpi-val" style={{ fontSize: 13, fontWeight: 700 }}>
                  {dashboardData.bestEmployee.name} ({dashboardData.bestEmployee.orders} đơn)
                </span>
              </div>
            </div>
          </section>

          {/* Row 2: 3 Side-by-Side Comparative Charts (3 Columns) */}
          <section className="middle-charts-grid">
            
            {/* Pie Chart: Tỷ trọng doanh thu Shopee Shop */}
            <div className="glass-card chart-card flex-col">
              <div className="card-header-with-action">
                <h3 className="card-title">Tỷ trọng doanh thu Shopee Shop (7 ngày)</h3>
                <HelpCircle size={15} className="text-gray-400 cursor-help" title="So sánh tỷ trọng đóng góp doanh thu giữa 6 cửa hàng Shopee với nhau" />
              </div>
              <div className="chart-wrapper flex-center" style={{ height: 210 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={dashboardData.shopRatioData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={80}
                      paddingAngle={3}
                      dataKey="value"
                    >
                      {dashboardData.shopRatioData.map((entry: any, index: number) => {
                        const colors = ['#3b82f6', '#10b981', '#f59e0b', '#a855f7', '#ec4899', '#14b8a6', '#6366f1', '#f43f5e', '#06b6d4'];
                        return <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />;
                      })}
                    </Pie>
                    <Tooltip 
                      formatter={(value: any, name: any, props: any) => [
                        fmtCurrency(value) + ` (${Number(props.payload.percentage || 0).toFixed(1)}%)`,
                        name
                      ]}
                      contentStyle={{ background: 'rgba(255, 255, 255, 0.9)', border: 'none', borderRadius: 10, boxShadow: '0 4px 15px rgba(0,0,0,0.1)' }}
                    />
                    <Legend iconType="circle" iconSize={6} layout="horizontal" verticalAlign="bottom" align="center" wrapperStyle={{ fontSize: 9, fontWeight: 600, paddingTop: 10 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Bar Chart: Doanh thu chi nhánh Sapo 7 ngày */}
            <div className="glass-card chart-card">
              <div className="card-header-with-action">
                <h3 className="card-title">Doanh thu chi nhánh Sapo 7 ngày qua</h3>
              </div>
              <div className="chart-wrapper" style={{ height: 210 }}>
                {dashboardData.branchChartData.length === 0 ? (
                  <div className="empty-chart-fallback">Không có dữ liệu Sapo POS</div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={dashboardData.branchChartData} margin={{ top: 20, right: 5, left: -25, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(0,0,0,0.04)" />
                      <XAxis dataKey="name" tick={{ fill: '#637381', fontSize: 9, fontWeight: 600 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: '#637381', fontSize: 9 }} axisLine={false} tickLine={false} formatter={(v: any) => fmtNum(v / 1000000) + 'M'} />
                      <Tooltip 
                        formatter={(v: any) => [fmtCurrency(v), 'Doanh thu']}
                        contentStyle={{ background: 'rgba(255, 255, 255, 0.9)', border: 'none', borderRadius: 10, boxShadow: '0 4px 15px rgba(0,0,0,0.1)' }}
                      />
                      <Bar dataKey="value" fill="#3b82f6" radius={[6, 6, 0, 0]} maxBarSize={32} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            {/* Bar Chart: Đóng góp doanh thu nhân viên Sapo */}
            <div className="glass-card chart-card">
              <div className="card-header-with-action">
                <h3 className="card-title">Đóng góp doanh thu của nhân viên</h3>
              </div>
              <div className="chart-wrapper" style={{ height: 210 }}>
                {dashboardData.employeeChartData.length === 0 ? (
                  <div className="empty-chart-fallback">Không có dữ liệu nhân viên Sapo</div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={dashboardData.employeeChartData} margin={{ top: 20, right: 5, left: -25, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(0,0,0,0.04)" />
                      <XAxis dataKey="name" tick={{ fill: '#637381', fontSize: 9, fontWeight: 600 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: '#637381', fontSize: 9 }} axisLine={false} tickLine={false} formatter={(v: any) => fmtNum(v / 1000000) + 'M'} />
                      <Tooltip 
                        formatter={(v: any) => [fmtCurrency(v), 'Doanh thu']}
                        contentStyle={{ background: 'rgba(255, 255, 255, 0.9)', border: 'none', borderRadius: 10, boxShadow: '0 4px 15px rgba(0,0,0,0.1)' }}
                      />
                      <Bar dataKey="value" fill="#10b981" radius={[6, 6, 0, 0]} maxBarSize={32} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </section>

          {/* Row 3: Split Columns (Stacked Bar Chart for Fees + Detailed Table for Sapo) */}
          <section className="bottom-split-grid">
            
            {/* Shopee stacked fees bar chart */}
            <div className="glass-card chart-card">
              <div className="card-header-with-action">
                <h3 className="card-title">Cơ cấu phí sàn Shopee</h3>
              </div>
              <div className="chart-wrapper" style={{ height: 250 }}>
                {dashboardData.stackedBarData.length === 0 ? (
                  <div className="empty-chart-fallback">Không có dữ liệu phí Shopee</div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={dashboardData.stackedBarData} margin={{ top: 10, right: 5, left: -20, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(0,0,0,0.04)" />
                      <XAxis dataKey="name" tick={{ fill: '#637381', fontSize: 9, fontWeight: 600 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: '#637381', fontSize: 9 }} axisLine={false} tickLine={false} formatter={(v: any) => fmtNum(v / 1000) + 'k'} />
                      <Tooltip 
                        formatter={(v: any) => fmtCurrency(v)}
                        contentStyle={{ background: 'rgba(255, 255, 255, 0.9)', border: 'none', borderRadius: 10, boxShadow: '0 4px 15px rgba(0,0,0,0.1)' }}
                      />
                      <Bar dataKey="Phí thanh toán" stackId="a" fill="#3b82f6" />
                      <Bar dataKey="Phí cố định" stackId="a" fill="#f59e0b" />
                      <Bar dataKey="Phí dịch vụ" stackId="a" fill="#ef4444" radius={[4, 4, 0, 0]} />
                      <Legend iconType="rect" iconSize={10} wrapperStyle={{ fontSize: 10, fontWeight: 600 }} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            {/* Detailed Sapo Activities Table */}
            <div className="glass-card table-card">
              <div className="card-header-with-action">
                <h3 className="card-title">Chi tiết hoạt động chi nhánh Sapo</h3>
              </div>
              <div className="glass-table-wrapper" style={{ maxHeight: 250, overflowY: 'auto' }}>
                <table className="glass-table">
                  <thead>
                    <tr>
                      <th>Branch Name</th>
                      <th style={{ textAlign: 'center' }}>Tổng đơn hàng</th>
                      <th style={{ textAlign: 'right' }}>Doanh thu</th>
                      <th style={{ textAlign: 'right' }}>Lợi nhuận gộp</th>
                      <th style={{ textAlign: 'right' }}>AOV</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dashboardData.sapoTableRows.length === 0 ? (
                      <tr>
                        <td colSpan={5} style={{ textAlign: 'center', color: '#637381' }}>Không có dữ liệu chi nhánh Sapo</td>
                      </tr>
                    ) : (
                      dashboardData.sapoTableRows.map((row, idx) => (
                        <tr key={idx}>
                          <td className="branch-link">{row.name}</td>
                          <td style={{ textAlign: 'center', fontWeight: 600 }}>{row.orders} đơn</td>
                          <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmtCurrency(row.revenue)}</td>
                          <td style={{ textAlign: 'right', color: '#10b981', fontWeight: 600 }}>{fmtCurrency(row.profit)}</td>
                          <td style={{ textAlign: 'right', color: '#637381' }}>{fmtCurrency(row.aov)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          {/* Row 4: Full-width Sapo Employee detailed table */}
          <section className="full-width-table-section" style={{ marginBottom: 24 }}>
            <div className="glass-card table-card">
              <div className="card-header-with-action">
                <h3 className="card-title">👤 Chi tiết hoạt động kinh doanh của nhân viên</h3>
              </div>
              <div className="glass-table-wrapper">
                <table className="glass-table">
                  <thead>
                    <tr>
                      <th>Tên nhân viên</th>
                      <th style={{ textAlign: 'center' }}>SL đơn hàng</th>
                      <th style={{ textAlign: 'right' }}>Tiền hàng</th>
                      <th style={{ textAlign: 'right' }}>Tiền hàng trả lại</th>
                      <th style={{ textAlign: 'right' }}>Tiền thuế</th>
                      <th style={{ textAlign: 'right' }}>Phí giao hàng</th>
                      <th style={{ textAlign: 'right' }}>Doanh thu</th>
                      <th style={{ textAlign: 'right' }}>Lợi nhuận gộp</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr style={{ background: 'rgba(241, 245, 249, 0.6)', fontWeight: 800 }}>
                      <td style={{ color: '#0f172a', fontWeight: 800 }}>Tổng nhân viên</td>
                      <td style={{ textAlign: 'center', fontWeight: 800 }}>{fmtNum(dashboardData.employeeTotals.orders)} đơn</td>
                      <td style={{ textAlign: 'right', fontWeight: 800 }}>{fmtCurrency(dashboardData.employeeTotals.goodsAmt)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 800, color: '#ef4444' }}>{fmtCurrency(dashboardData.employeeTotals.returned)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 800 }}>{fmtCurrency(dashboardData.employeeTotals.tax)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 800 }}>{fmtCurrency(dashboardData.employeeTotals.delivery)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 800, color: '#3b82f6' }}>{fmtCurrency(dashboardData.employeeTotals.revenue)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 800, color: '#10b981' }}>{fmtCurrency(dashboardData.employeeTotals.profit)}</td>
                    </tr>
                    {dashboardData.sapoEmployeeRows.length === 0 ? (
                      <tr>
                        <td colSpan={8} style={{ textAlign: 'center', color: '#637381' }}>Không có dữ liệu nhân viên Sapo</td>
                      </tr>
                    ) : (
                      dashboardData.sapoEmployeeRows.map((row, idx) => (
                        <tr key={idx}>
                          <td style={{ fontWeight: 600, color: '#3b82f6' }}>{row.name}</td>
                          <td style={{ textAlign: 'center', fontWeight: 600 }}>{row.orders} đơn</td>
                          <td style={{ textAlign: 'right' }}>{fmtCurrency(row.goodsAmt)}</td>
                          <td style={{ textAlign: 'right', color: '#ef4444' }}>{row.returned > 0 ? fmtCurrency(row.returned) : '0 đ'}</td>
                          <td style={{ textAlign: 'right' }}>{fmtCurrency(row.tax)}</td>
                          <td style={{ textAlign: 'right' }}>{fmtCurrency(row.delivery)}</td>
                          <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmtCurrency(row.revenue)}</td>
                          <td style={{ textAlign: 'right', fontWeight: 700, color: row.profit > 0 ? '#10b981' : '#64748b' }}>{fmtCurrency(row.profit)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          {/* Row 5: Full-width Shopee detailed table */}
          <section className="full-width-table-section">
            <div className="glass-card table-card">
              <div className="card-header-with-action">
                <h3 className="card-title">Chi tiết tài chính Shopee Shop</h3>
              </div>
              <div className="glass-table-wrapper">
                <table className="glass-table">
                  <thead>
                    <tr>
                      <th>Cửa hàng Shopee</th>
                      <th style={{ textAlign: 'right' }}>Tổng doanh số (Gross)</th>
                      <th style={{ textAlign: 'right' }}>Phí cố định</th>
                      <th style={{ textAlign: 'right' }}>Phí dịch vụ</th>
                      <th style={{ textAlign: 'right' }}>Doanh thu thực nhận</th>
                      <th style={{ textAlign: 'right' }}>Phí thanh toán</th>
                      <th style={{ textAlign: 'center' }}>Tổng đơn hàng</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dashboardData.shopeeTableRows.length === 0 ? (
                      <tr>
                        <td colSpan={7} style={{ textAlign: 'center', color: '#637381' }}>Không có dữ liệu cửa hàng Shopee</td>
                      </tr>
                    ) : (
                      dashboardData.shopeeTableRows.map((row, idx) => (
                        <tr key={idx}>
                          <td className="shop-link">{row.name}</td>
                          <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmtCurrency(row.grossSales)}</td>
                          <td style={{ textAlign: 'right', color: '#f59e0b' }}>{fmtCurrency(row.commissionFee)}</td>
                          <td style={{ textAlign: 'right', color: '#ef4444' }}>{fmtCurrency(row.shippingFee)}</td>
                          <td style={{ textAlign: 'right', color: '#10b981', fontWeight: 700 }}>{fmtCurrency(row.netRevenue)}</td>
                          <td style={{ textAlign: 'right' }}>{fmtCurrency(row.paymentFee)}</td>
                          <td style={{ textAlign: 'center', fontWeight: 600 }}>{row.orders} đơn</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

        </div>
      )}
    </div>
  );
};
