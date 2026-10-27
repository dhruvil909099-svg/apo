import React, { useState, useEffect, useMemo } from 'react';
import {
  Users, ChevronDown, ChevronRight,
  TrendingUp, TrendingDown, RefreshCw,
  Search, Download, PieChart as PieChartIcon, BarChart3,
  Layers, ArrowUpDown, X, CheckSquare, Square
} from 'lucide-react';
import {
  ResponsiveContainer, PieChart, Pie, Cell,
  BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid
} from 'recharts';
import { ConsolidatedHolding, AccountPortfolio, PortfolioSummary, Account } from '../types';
import { api } from '../api';
import { StockChart } from '../components/StockChart';

const PIE_COLORS = ['#0284c7', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#3b82f6', '#14b8a6', '#64748b'];

export const PortfolioView: React.FC = () => {
  const [viewMode, setViewMode] = useState<'consolidated' | 'accounts' | 'analytics'>('consolidated');
  const [summary, setSummary] = useState<PortfolioSummary | null>(null);
  const [consolidated, setConsolidated] = useState<ConsolidatedHolding[]>([]);
  const [accountPortfolios, setAccountPortfolios] = useState<AccountPortfolio[]>([]);
  const [allAccounts, setAllAccounts] = useState<Account[]>([]);
  const [selectedAccountIds, setSelectedAccountIds] = useState<number[]>([]);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<'symbol' | 'market_value' | 'unrealized_pnl' | 'total_quantity'>('market_value');
  const [sortAsc, setSortAsc] = useState(false);
  const [expandedSymbol, setExpandedSymbol] = useState<string | null>(null);
  const [selectedInstrumentForChart, setSelectedInstrumentForChart] = useState<ConsolidatedHolding | null>(null);
  
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  // Load initial accounts
  useEffect(() => {
    const loadAccounts = async () => {
      try {
        const accs = await api.getAccounts();
        setAllAccounts(accs);
        // By default, select all accounts
        setSelectedAccountIds(accs.map(a => a.id));
      } catch (err) {
        console.error('Error loading accounts:', err);
      }
    };
    loadAccounts();
  }, []);

  // Load portfolio data whenever selectedAccountIds changes
  const loadPortfolioData = async () => {
    setIsLoading(true);
    try {
      const [consResp, accs] = await Promise.all([
        api.getConsolidatedPortfolio(selectedAccountIds.length === allAccounts.length ? undefined : selectedAccountIds),
        api.getAccountPortfolios()
      ]);
      setSummary(consResp.summary);
      setConsolidated(consResp.holdings);
      setAccountPortfolios(accs);
    } catch (err: any) {
      console.error('Error loading portfolio:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (allAccounts.length > 0) {
      loadPortfolioData();
    }
  }, [selectedAccountIds, allAccounts.length]);

  const handleSyncNow = async () => {
    setIsSyncing(true);
    setSyncMessage(null);
    try {
      const res = await api.syncPortfolio();
      setSyncMessage(`Holdings synced for ${res.accounts_synced} accounts at ${res.timestamp}`);
      await loadPortfolioData();
    } catch (err: any) {
      setSyncMessage(`Sync failed: ${err.message}`);
    } finally {
      setIsSyncing(false);
    }
  };

  const toggleAccountSelection = (id: number) => {
    setSelectedAccountIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const selectAllAccounts = () => {
    setSelectedAccountIds(allAccounts.map(a => a.id));
  };

  // Filtered and sorted holdings
  const filteredHoldings = useMemo(() => {
    let list = consolidated.filter(h =>
      h.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
      h.company_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (h.isin && h.isin.toLowerCase().includes(searchQuery.toLowerCase()))
    );

    list.sort((a, b) => {
      let valA: any = a[sortField];
      let valB: any = b[sortField];
      if (typeof valA === 'string') {
        return sortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
      }
      return sortAsc ? valA - valB : valB - valA;
    });

    return list;
  }, [consolidated, searchQuery, sortField, sortAsc]);

  // Export to CSV
  const exportToCSV = () => {
    if (!consolidated.length) return;
    const headers = ['Symbol', 'Company Name', 'ISIN', 'Exchange', 'Total Quantity', 'Average Cost', 'Current LTP', 'Market Value', 'Unrealized PnL', 'PnL Percent', 'Accounts Count'];
    const rows = consolidated.map(h => [
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
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `IPOPro_Consolidated_Holdings_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Pie chart data for analytics
  const pieData = useMemo(() => {
    return consolidated.map(h => ({
      name: h.symbol,
      value: h.market_value,
      allocation: h.portfolio_allocation_percent || 0
    }));
  }, [consolidated]);

  const totalVal = summary?.total_current_value ?? 0;
  const totalCost = summary?.total_investment_cost ?? 0;
  const totalPnl = summary?.unrealized_pnl ?? 0;
  const totalPnlPct = summary?.unrealized_pnl_percentage ?? 0;
  const dayChange = summary?.day_change ?? 0;
  const dayChangePct = summary?.day_change_percentage ?? 0;

  return (
    <div className="space-y-6">
      {/* Top Portfolio Summary Ribbon (Angel One-Style) */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div className="flex items-center gap-2">
            <h1 className="text-base font-bold text-slate-900">Consolidated Family Portfolio</h1>
            <span className="text-xs font-semibold bg-brand-50 text-brand-700 px-2 py-0.5 rounded border border-brand-200">
              {summary?.total_accounts_synced ?? 0} / {summary?.total_accounts_connected ?? 0} Synced
            </span>
          </div>
          
          <div className="flex items-center gap-2">
            {syncMessage && (
              <span className="text-xs text-emerald-600 font-medium hidden sm:inline">{syncMessage}</span>
            )}
            <button
              onClick={handleSyncNow}
              disabled={isSyncing}
              className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 hover:bg-slate-800 disabled:opacity-50 transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
              <span>{isSyncing ? 'Syncing...' : 'Sync Holdings'}</span>
            </button>
            <button
              onClick={exportToCSV}
              disabled={!consolidated.length}
              className="px-3 py-1.5 bg-white border border-slate-200 text-slate-700 rounded-lg text-xs font-semibold flex items-center gap-1.5 hover:bg-slate-50 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </button>
          </div>
        </div>

        {/* 5 KPI Metric Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
          <div>
            <span className="text-[11px] text-slate-400 font-medium uppercase tracking-wider">Current Market Value</span>
            <div className="text-xl font-bold text-slate-900 num-mono mt-1">
              ₹{totalVal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </div>
          </div>
          <div>
            <span className="text-[11px] text-slate-400 font-medium uppercase tracking-wider">Invested Capital</span>
            <div className="text-xl font-bold text-slate-700 num-mono mt-1">
              ₹{totalCost.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </div>
          </div>
          <div>
            <span className="text-[11px] text-slate-400 font-medium uppercase tracking-wider">Total Unrealized Gain</span>
            <div className={`text-xl font-bold num-mono mt-1 flex items-center gap-1 ${totalPnl >= 0 ? 'text-finGreen' : 'text-finRed'}`}>
              {totalPnl >= 0 ? '+' : ''}₹{totalPnl.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </div>
          </div>
          <div>
            <span className="text-[11px] text-slate-400 font-medium uppercase tracking-wider">Overall Return %</span>
            <div className={`text-xl font-bold num-mono mt-1 flex items-center gap-1 ${totalPnlPct >= 0 ? 'text-finGreen' : 'text-finRed'}`}>
              {totalPnlPct >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
              {totalPnlPct >= 0 ? '+' : ''}{totalPnlPct.toFixed(2)}%
            </div>
          </div>
          <div>
            <span className="text-[11px] text-slate-400 font-medium uppercase tracking-wider">1-Day Change</span>
            <div className={`text-xl font-bold num-mono mt-1 ${dayChange >= 0 ? 'text-finGreen' : 'text-finRed'}`}>
              {dayChange >= 0 ? '+' : ''}₹{dayChange.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              <span className="text-xs font-semibold ml-1.5">({dayChangePct >= 0 ? '+' : ''}{dayChangePct.toFixed(2)}%)</span>
            </div>
          </div>
        </div>
      </div>

      {/* Account Filter Pills Bar */}
      {allAccounts.length > 0 && (
        <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-slate-400 font-semibold uppercase text-[10px] mr-1">Filter Accounts:</span>
            <button
              onClick={selectAllAccounts}
              className={`px-2.5 py-1 rounded text-xs font-semibold border transition-colors ${
                selectedAccountIds.length === allAccounts.length
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              All Accounts ({allAccounts.length})
            </button>
            {allAccounts.map(acc => {
              const isSelected = selectedAccountIds.includes(acc.id);
              return (
                <button
                  key={acc.id}
                  onClick={() => toggleAccountSelection(acc.id)}
                  className={`px-2.5 py-1 rounded text-xs font-medium border flex items-center gap-1.5 transition-colors ${
                    isSelected
                      ? 'bg-brand-50 text-brand-700 border-brand-300 font-semibold'
                      : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {isSelected ? <CheckSquare className="w-3.5 h-3.5 text-brand-600" /> : <Square className="w-3.5 h-3.5 text-slate-400" />}
                  <span>{acc.nickname}</span>
                  <span className="font-mono text-[10px] text-slate-400">({acc.masked_client_code})</span>
                </button>
              );
            })}
          </div>

          <div className="text-[11px] text-slate-400 font-medium">
            Showing math for <strong className="text-slate-700">{selectedAccountIds.length}</strong> selected accounts
          </div>
        </div>
      )}

      {/* View Switcher Tabs & Search Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg">
          <button
            onClick={() => setViewMode('consolidated')}
            className={`px-4 py-1.5 rounded-md text-xs font-semibold transition-colors flex items-center gap-1.5 ${
              viewMode === 'consolidated' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Consolidated Holdings ({consolidated.length})</span>
          </button>
          <button
            onClick={() => setViewMode('accounts')}
            className={`px-4 py-1.5 rounded-md text-xs font-semibold transition-colors flex items-center gap-1.5 ${
              viewMode === 'accounts' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>Account Breakdown ({accountPortfolios.length})</span>
          </button>
          <button
            onClick={() => setViewMode('analytics')}
            className={`px-4 py-1.5 rounded-md text-xs font-semibold transition-colors flex items-center gap-1.5 ${
              viewMode === 'analytics' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <PieChartIcon className="w-3.5 h-3.5" />
            <span>Visual Analytics</span>
          </button>
        </div>

        {viewMode === 'consolidated' && (
          <div className="relative w-64">
            <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search symbol, company, ISIN..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-brand-500"
            />
          </div>
        )}
      </div>

      {/* Main View Display */}
      {isLoading ? (
        <div className="text-center py-16 text-xs text-slate-400 bg-white rounded-xl border border-slate-200">
          <RefreshCw className="w-6 h-6 mx-auto mb-2 text-slate-400 animate-spin" />
          <span>Calculating consolidated holdings across authorized accounts...</span>
        </div>
      ) : viewMode === 'consolidated' ? (
        /* Consolidated Holdings Table (Angel One-Style) */
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider font-semibold border-b border-slate-200 text-[10px]">
              <tr>
                <th className="py-3 px-3 w-8"></th>
                <th className="py-3 px-4 cursor-pointer" onClick={() => { setSortField('symbol'); setSortAsc(!sortAsc); }}>
                  <div className="flex items-center gap-1">
                    <span>Stock / Instrument</span>
                    <ArrowUpDown className="w-3 h-3 text-slate-400" />
                  </div>
                </th>
                <th className="py-3 px-3">ISIN</th>
                <th className="py-3 px-3 cursor-pointer text-right" onClick={() => { setSortField('total_quantity'); setSortAsc(!sortAsc); }}>
                  <div className="flex items-center justify-end gap-1">
                    <span>Quantity</span>
                    <ArrowUpDown className="w-3 h-3 text-slate-400" />
                  </div>
                </th>
                <th className="py-3 px-3 text-right">Avg Cost</th>
                <th className="py-3 px-3 text-right">Current LTP</th>
                <th className="py-3 px-4 cursor-pointer text-right" onClick={() => { setSortField('market_value'); setSortAsc(!sortAsc); }}>
                  <div className="flex items-center justify-end gap-1">
                    <span>Market Value</span>
                    <ArrowUpDown className="w-3 h-3 text-slate-400" />
                  </div>
                </th>
                <th className="py-3 px-4 cursor-pointer text-right" onClick={() => { setSortField('unrealized_pnl'); setSortAsc(!sortAsc); }}>
                  <div className="flex items-center justify-end gap-1">
                    <span>Unrealized P&L</span>
                    <ArrowUpDown className="w-3 h-3 text-slate-400" />
                  </div>
                </th>
                <th className="py-3 px-3 text-right">Allocation</th>
                <th className="py-3 px-3 text-center">Accounts</th>
                <th className="py-3 px-3 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredHoldings.length === 0 ? (
                <tr>
                  <td colSpan={11} className="py-12 text-center text-xs text-slate-400">
                    No holdings match your search criteria.
                  </td>
                </tr>
              ) : (
                filteredHoldings.map((item) => {
                  const isExpanded = expandedSymbol === item.symbol;
                  const isPositive = item.unrealized_pnl >= 0;

                  return (
                    <React.Fragment key={item.symbol}>
                      <tr className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-3 px-3 text-slate-400 cursor-pointer" onClick={() => setExpandedSymbol(isExpanded ? null : item.symbol)}>
                          {isExpanded ? <ChevronDown className="w-4 h-4 text-slate-700" /> : <ChevronRight className="w-4 h-4" />}
                        </td>
                        <td className="py-3 px-4 font-bold text-slate-900">
                          <div className="flex items-center gap-2">
                            <span className="hover:text-brand-600 cursor-pointer" onClick={() => setSelectedInstrumentForChart(item)}>
                              {item.symbol}
                            </span>
                            <span className="text-[10px] bg-slate-100 text-slate-600 px-1 py-0.2 rounded font-medium">
                              {item.exchange}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-400 truncate max-w-xs">{item.company_name}</div>
                        </td>
                        <td className="py-3 px-3 font-mono text-[11px] text-slate-500">{item.isin || '—'}</td>
                        <td className="py-3 px-3 num-mono font-bold text-slate-900 text-right">{item.total_quantity}</td>
                        <td className="py-3 px-3 num-mono text-slate-600 text-right">₹{item.average_cost.toFixed(2)}</td>
                        <td className="py-3 px-3 num-mono font-bold text-slate-900 text-right">₹{item.current_ltp.toFixed(2)}</td>
                        <td className="py-3 px-4 num-mono font-bold text-slate-900 text-right">
                          ₹{item.market_value.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className={`font-bold num-mono ${isPositive ? 'text-finGreen' : 'text-finRed'}`}>
                            {isPositive ? '+' : ''}₹{item.unrealized_pnl.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          </div>
                          <div className={`text-[10px] font-bold num-mono ${isPositive ? 'text-finGreen' : 'text-finRed'}`}>
                            {isPositive ? '+' : ''}{item.pnl_percentage.toFixed(2)}%
                          </div>
                        </td>
                        <td className="py-3 px-3 num-mono text-slate-700 text-right font-semibold">
                          {(item.portfolio_allocation_percent ?? 0).toFixed(1)}%
                        </td>
                        <td className="py-3 px-3 text-center">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-brand-50 text-brand-700 border border-brand-200">
                            {item.accounts_count} Accs
                          </span>
                        </td>
                        <td className="py-3 px-3 text-center">
                          <button
                            onClick={() => setSelectedInstrumentForChart(item)}
                            className="px-2.5 py-1 bg-slate-100 hover:bg-slate-900 hover:text-white rounded text-[11px] font-semibold text-slate-700 transition-colors"
                          >
                            Chart
                          </button>
                        </td>
                      </tr>

                      {/* Expandable Account Breakdown Drawer */}
                      {isExpanded && (
                        <tr className="bg-slate-50/80">
                          <td colSpan={11} className="p-4 pl-12">
                            <div className="bg-white p-4 rounded-lg border border-slate-200 space-y-3">
                              <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                                Account Distribution for {item.symbol}
                              </h4>
                              <div className="overflow-x-auto">
                                <table className="w-full text-left text-xs">
                                  <thead className="text-[10px] uppercase text-slate-400 border-b border-slate-100">
                                    <tr>
                                      <th className="py-1.5 px-3">Account Nickname</th>
                                      <th className="py-1.5 px-3">Client Code</th>
                                      <th className="py-1.5 px-3">Group</th>
                                      <th className="py-1.5 px-3">Quantity</th>
                                      <th className="py-1.5 px-3">Cost Basis</th>
                                      <th className="py-1.5 px-3">Market Value</th>
                                      <th className="py-1.5 px-3">Unrealized P&L</th>
                                      <th className="py-1.5 px-3">DDPI Status</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-100">
                                    {item.accounts_breakdown.map((acc) => (
                                      <tr key={acc.account_id}>
                                        <td className="py-2 px-3 font-semibold text-slate-800">{acc.nickname}</td>
                                        <td className="py-2 px-3 font-mono text-slate-500">{acc.masked_client_code}</td>
                                        <td className="py-2 px-3 text-slate-600">{acc.account_group}</td>
                                        <td className="py-2 px-3 num-mono font-bold text-slate-900">{acc.quantity}</td>
                                        <td className="py-2 px-3 num-mono text-slate-700">₹{acc.acquisition_cost.toFixed(2)}</td>
                                        <td className="py-2 px-3 num-mono font-bold text-slate-900">
                                          ₹{acc.market_value.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                                        </td>
                                        <td className={`py-2 px-3 num-mono font-bold ${acc.unrealized_pnl >= 0 ? 'text-finGreen' : 'text-finRed'}`}>
                                          {acc.unrealized_pnl >= 0 ? '+' : ''}₹{acc.unrealized_pnl.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                                        </td>
                                        <td className="py-2 px-3">
                                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                            acc.ddpi_status === 'ACTIVE' ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-800'
                                          }`}>
                                            DDPI: {acc.ddpi_status}
                                          </span>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      ) : viewMode === 'accounts' ? (
        /* Account-wise Portfolios Grid */
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {accountPortfolios.map((acc) => (
            <div key={acc.account_id} className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">{acc.nickname}</h3>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="font-mono text-xs text-slate-500">{acc.masked_client_code}</span>
                    <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.2 rounded font-medium">
                      {acc.account_group}
                    </span>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-slate-400">Total Valuation</div>
                  <div className="text-base font-bold text-slate-900 num-mono">
                    ₹{acc.portfolio_value.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </div>
                </div>
              </div>

              <div className="space-y-1.5 text-xs text-slate-500">
                <div className="flex justify-between">
                  <span>Cash Margin:</span>
                  <span className="num-mono font-bold text-slate-800">₹{acc.available_cash.toLocaleString('en-IN')}</span>
                </div>
                <div className="flex justify-between">
                  <span>DDPI Status:</span>
                  <span className={`font-semibold ${acc.ddpi_status === 'ACTIVE' ? 'text-blue-600' : 'text-amber-600'}`}>
                    DDPI {acc.ddpi_status} {acc.edis_authorized ? '(eDIS OK)' : ''}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Last Sync:</span>
                  <span className="font-mono text-[11px] text-slate-400">{acc.last_sync_time || '—'}</span>
                </div>
              </div>

              {/* Holdings inside account */}
              <div className="pt-2">
                <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">
                  Holdings ({acc.holdings.length})
                </h4>
                {acc.holdings.length === 0 ? (
                  <div className="text-center py-4 text-xs text-slate-400 bg-slate-50 rounded-lg">
                    No active holdings in this account.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100 border border-slate-100 rounded-lg overflow-hidden">
                    {acc.holdings.map((h) => (
                      <div key={h.allotment_id} className="p-2.5 flex items-center justify-between bg-white text-xs hover:bg-slate-50">
                        <div>
                          <div className="font-bold text-slate-900">{h.symbol}</div>
                          <div className="text-[11px] text-slate-400">{h.quantity} shares @ ₹{h.acquisition_cost.toFixed(2)}</div>
                        </div>
                        <div className="text-right">
                          <div className="font-bold num-mono text-slate-900">₹{h.market_value.toLocaleString('en-IN')}</div>
                          <div className={`text-[10px] font-bold num-mono ${h.unrealized_pnl >= 0 ? 'text-finGreen' : 'text-finRed'}`}>
                            {h.unrealized_pnl >= 0 ? '+' : ''}{h.pnl_percentage.toFixed(2)}%
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* Visual Analytics Tab */
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Portfolio Allocation Donut Chart */}
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <PieChartIcon className="w-4 h-4 text-brand-600" />
              <span>Asset Allocation by Stock (%)</span>
            </h3>
            {consolidated.length === 0 ? (
              <div className="h-64 flex items-center justify-center text-xs text-slate-400">No holdings to display</div>
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={80}
                      innerRadius={45}
                      paddingAngle={3}
                    >
                      {pieData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(val: number) => [`₹${val.toLocaleString('en-IN')}`, 'Market Value']}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
            <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-100">
              {pieData.map((item, idx) => (
                <div key={item.name} className="flex items-center gap-1.5 text-xs">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: PIE_COLORS[idx % PIE_COLORS.length] }} />
                  <span className="font-semibold text-slate-700">{item.name}</span>
                  <span className="text-slate-400 font-mono">({item.allocation.toFixed(1)}%)</span>
                </div>
              ))}
            </div>
          </div>

          {/* Unrealized P&L by Instrument Bar Chart */}
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-emerald-600" />
              <span>Unrealized Profit & Loss by Instrument (₹)</span>
            </h3>
            {consolidated.length === 0 ? (
              <div className="h-64 flex items-center justify-center text-xs text-slate-400">No holdings to display</div>
            ) : (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={consolidated} margin={{ top: 10, right: 10, left: 10, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="symbol" fontSize={11} stroke="#94a3b8" />
                    <YAxis fontSize={10} stroke="#94a3b8" tickFormatter={(v) => `₹${(v/1000).toFixed(0)}k`} />
                    <Tooltip formatter={(val: number) => [`₹${val.toLocaleString('en-IN')}`, 'Unrealized P&L']} />
                    <Bar
                      dataKey="unrealized_pnl"
                      isAnimationActive={false}
                      shape={(props: any) => {
                        const { x, y, width, height, payload } = props;
                        const isUp = payload.unrealized_pnl >= 0;
                        return (
                          <rect
                            x={x}
                            y={y}
                            width={width}
                            height={height}
                            fill={isUp ? '#10b981' : '#ef4444'}
                            rx={2}
                          />
                        );
                      }}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Selected Stock Modal: Angel One-Style Interactive Chart & Account Breakdown */}
      {selectedInstrumentForChart && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="relative w-full max-w-4xl my-8">
            <StockChart
              symbol={selectedInstrumentForChart.symbol}
              accountsBreakdown={selectedInstrumentForChart.accounts_breakdown}
              onClose={() => setSelectedInstrumentForChart(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
};
