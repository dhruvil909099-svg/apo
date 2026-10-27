import React, { useState } from 'react';
import {
  Download, FileSpreadsheet, Layers, Users,
  TrendingUp, ClipboardList, Bell, CheckCircle2,
  Calendar, FileText, ArrowRight
} from 'lucide-react';
import { Account, IPO, Order } from '../types';
import { AccountSelector } from '../components/AccountSelector';
import { api } from '../api';

interface ExportCenterViewProps {
  accounts: Account[];
  ipos: IPO[];
  orders: Order[];
}

export const ExportCenterView: React.FC<ExportCenterViewProps> = ({
  accounts,
  ipos,
  orders
}) => {
  const [selectedAccountIds, setSelectedAccountIds] = useState<number[]>(
    accounts.map((a) => a.id)
  );
  const [isExporting, setIsExporting] = useState<string | null>(null);
  const [exportNotice, setExportNotice] = useState<string | null>(null);

  const toggleAccount = (id: number) => {
    setSelectedAccountIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const selectAll = () => setSelectedAccountIds(accounts.map((a) => a.id));
  const clearAll = () => setSelectedAccountIds([]);

  const downloadCSV = (filename: string, content: string) => {
    const encodedUri = encodeURI('data:text/csv;charset=utf-8,' + content);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // 1. Export Consolidated Holdings CSV
  const handleExportHoldings = async () => {
    setIsExporting('HOLDINGS');
    try {
      const resp = await api.getConsolidatedPortfolio(
        selectedAccountIds.length === accounts.length ? undefined : selectedAccountIds
      );
      const headers = ['Symbol', 'Company Name', 'ISIN', 'Exchange', 'Total Quantity', 'Average Cost', 'Current LTP', 'Market Value', 'Unrealized PnL', 'PnL Percent', 'Accounts Count'];
      const rows = resp.holdings.map((h) => [
        h.symbol,
        `"${h.company_name}"`,
        h.isin || '',
        h.exchange,
        h.total_quantity,
        h.average_cost.toFixed(2),
        h.current_ltp.toFixed(2),
        h.market_value.toFixed(2),
        h.unrealized_pnl.toFixed(2),
        h.pnl_percentage.toFixed(2),
        h.accounts_count
      ]);
      const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
      downloadCSV(`IPOPro_Consolidated_Holdings_${new Date().toISOString().split('T')[0]}.csv`, csv);
      setExportNotice('Consolidated Holdings CSV exported successfully.');
    } catch (err: any) {
      alert(`Export failed: ${err.message}`);
    } finally {
      setIsExporting(null);
    }
  };

  // 2. Export Account Balances CSV
  const handleExportAccounts = () => {
    setIsExporting('ACCOUNTS');
    try {
      const headers = ['Account Nickname', 'Client Code', 'Group', 'Auth Status', 'DDPI Status', 'eDIS Authorized', 'Available Cash Margin', 'Created At'];
      const filtered = accounts.filter((a) => selectedAccountIds.includes(a.id));
      const rows = filtered.map((a) => [
        `"${a.nickname}"`,
        a.masked_client_code,
        a.account_group,
        a.auth_status,
        a.ddpi_status,
        a.edis_authorized_today ? 'YES' : 'NO',
        a.available_cash.toFixed(2),
        a.created_at
      ]);
      const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
      downloadCSV(`IPOPro_Account_Balances_${new Date().toISOString().split('T')[0]}.csv`, csv);
      setExportNotice('Account Balances CSV exported successfully.');
    } finally {
      setIsExporting(null);
    }
  };

  // 3. Export Orders & Trades CSV
  const handleExportOrders = () => {
    setIsExporting('ORDERS');
    try {
      const headers = ['Client Order ID', 'Broker Order ID', 'Account', 'Symbol', 'Exchange', 'Type', 'Qty', 'Price', 'Status', 'Timestamp'];
      const filtered = orders.filter((o) => selectedAccountIds.includes(o.account_id));
      const rows = filtered.map((o) => [
        o.client_order_id,
        o.broker_order_id || '—',
        o.account_nickname || o.account_masked_code || String(o.account_id),
        o.tradingsymbol,
        o.exchange,
        `${o.transaction_type} ${o.order_type}`,
        o.quantity,
        o.price.toFixed(2),
        o.status,
        o.created_at
      ]);
      const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
      downloadCSV(`IPOPro_Order_Book_${new Date().toISOString().split('T')[0]}.csv`, csv);
      setExportNotice('Order Book CSV exported successfully.');
    } finally {
      setIsExporting(null);
    }
  };

  // 4. Export IPO Opportunities & Allotments CSV
  const handleExportIPOs = () => {
    setIsExporting('IPOS');
    try {
      const headers = ['Symbol', 'Company Name', 'Exchange', 'Issue Price', 'Current LTP', 'Status', 'Allotted Shares', 'Total Value'];
      const rows = ipos.map((ipo) => [
        ipo.symbol,
        `"${ipo.company_name}"`,
        ipo.exchange,
        ipo.issue_price.toFixed(2),
        (ipo.current_ltp || ipo.issue_price).toFixed(2),
        ipo.status,
        ipo.total_allotted_shares,
        ipo.estimated_current_value.toFixed(2)
      ]);
      const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
      downloadCSV(`IPOPro_IPO_Registry_${new Date().toISOString().split('T')[0]}.csv`, csv);
      setExportNotice('IPO Registry CSV exported successfully.');
    } finally {
      setIsExporting(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Scope Filter */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold text-slate-900">Compliance & Export Center</h1>
              <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-brand-50 text-brand-700 border border-brand-200">
                Data Downloads
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Export audit-ready CSV spreadsheets for tax filing, reconciliation, and compliance reporting.
            </p>
          </div>

          {/* Reusable Account Selector Component */}
          <AccountSelector
            accounts={accounts}
            mode="multi"
            selectedAccountIds={selectedAccountIds}
            onToggleAccount={toggleAccount}
            onSelectAll={selectAll}
            onClearAll={clearAll}
            label="Report Scope:"
          />
        </div>

        {exportNotice && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-lg flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span>{exportNotice}</span>
            </div>
            <button onClick={() => setExportNotice(null)} className="text-emerald-600 hover:text-emerald-800 font-bold">✕</button>
          </div>
        )}
      </div>

      {/* Export Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Card 1: Consolidated Holdings CSV */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-3 flex flex-col justify-between">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="p-2 rounded-lg bg-brand-50 text-brand-600">
                <Layers className="w-5 h-5" />
              </span>
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono">Format: CSV</span>
            </div>
            <h3 className="text-sm font-bold text-slate-900">Consolidated Holdings Report</h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              Complete inventory of equity shares across all {selectedAccountIds.length} selected accounts, including weighted average cost bases, current mark-to-market valuations, and unrealized profits.
            </p>
          </div>
          <button
            onClick={handleExportHoldings}
            disabled={isExporting === 'HOLDINGS'}
            className="w-full py-2.5 px-4 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{isExporting === 'HOLDINGS' ? 'Compiling Report...' : 'Download Holdings CSV'}</span>
          </button>
        </div>

        {/* Card 2: Account Balances & Status CSV */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-3 flex flex-col justify-between">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="p-2 rounded-lg bg-emerald-50 text-emerald-600">
                <Users className="w-5 h-5" />
              </span>
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono">Format: CSV</span>
            </div>
            <h3 className="text-sm font-bold text-slate-900">Account Margins & DDPI Audit</h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              Audit ledger of registered client codes, cash margin balances, active depository DDPI statuses, and daily CDSL eDIS compliance records.
            </p>
          </div>
          <button
            onClick={handleExportAccounts}
            disabled={isExporting === 'ACCOUNTS'}
            className="w-full py-2.5 px-4 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{isExporting === 'ACCOUNTS' ? 'Compiling Report...' : 'Download Account Balances CSV'}</span>
          </button>
        </div>

        {/* Card 3: Orders & Trade Book CSV */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-3 flex flex-col justify-between">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="p-2 rounded-lg bg-blue-50 text-blue-600">
                <ClipboardList className="w-5 h-5" />
              </span>
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono">Format: CSV</span>
            </div>
            <h3 className="text-sm font-bold text-slate-900">Trade Book & Order History</h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              Complete record of all single and bulk orders submitted, including broker order IDs, limit prices, execution outcomes, and rejection reasons ({orders.length} orders recorded).
            </p>
          </div>
          <button
            onClick={handleExportOrders}
            disabled={isExporting === 'ORDERS'}
            className="w-full py-2.5 px-4 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{isExporting === 'ORDERS' ? 'Compiling Report...' : 'Download Order Book CSV'}</span>
          </button>
        </div>

        {/* Card 4: IPO Registry & Allotments CSV */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-3 flex flex-col justify-between">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="p-2 rounded-lg bg-purple-50 text-purple-600">
                <TrendingUp className="w-5 h-5" />
              </span>
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono">Format: CSV</span>
            </div>
            <h3 className="text-sm font-bold text-slate-900">IPO Opportunities & Allotments</h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              Tracked initial public offerings, issue prices, listing gains, lot sizes, and confirmed registrar allotments across all family Demat accounts.
            </p>
          </div>
          <button
            onClick={handleExportIPOs}
            disabled={isExporting === 'IPOS'}
            className="w-full py-2.5 px-4 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{isExporting === 'IPOS' ? 'Compiling Report...' : 'Download IPO Registry CSV'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
