import React, { useState, useEffect, useMemo } from 'react';
import {
  Users, ChevronDown, ChevronRight,
  TrendingUp, TrendingDown, RefreshCw,
  Search, Download, PieChart as PieChartIcon, BarChart3,
  Layers, ArrowUpDown, X, CheckSquare, Square, AlertTriangle,
  Activity, CheckCircle2, Clock, AlertCircle
} from 'lucide-react';
import {
  ResponsiveContainer, PieChart, Pie, Cell,
  BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid
} from 'recharts';
import { ConsolidatedHolding, AccountPortfolio, PortfolioSummary, Account } from '../types';
import { api, getWebSocketUrl } from '../api';
import { StockChart } from '../components/StockChart';
import { TradeModal } from '../components/TradeModal';

const PIE_COLORS = ['#0284c7', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#3b82f6', '#14b8a6', '#64748b'];

export interface PortfolioViewProps {
  initialViewMode?: 'consolidated' | 'accounts' | 'analytics' | 'batch-activity';
  batchContext?: {
    batchId?: string;
    totalOrders?: number;
    successCount?: number;
    failedCount?: number;
    symbol?: string;
    accounts?: Array<{ accountId: number; nickname: string; status: string; orderId?: string; error?: string }>;
  } | null;
  onClearBatchContext?: () => void;
  onNavigateToAccount?: (accountId: number, tab?: string, symbol?: string) => void;
}

export const PortfolioView: React.FC<PortfolioViewProps> = ({
  initialViewMode,
  batchContext,
  onClearBatchContext,
  onNavigateToAccount
}) => {
  const [viewMode, setViewMode] = useState<'consolidated' | 'accounts' | 'analytics' | 'batch-activity'>(
    initialViewMode || (batchContext ? 'batch-activity' : 'consolidated')
  );

  useEffect(() => {
    if (batchContext) {
      setViewMode('batch-activity');
    }
  }, [batchContext]);

  useEffect(() => {
    if (initialViewMode) {
      setViewMode(initialViewMode);
    }
  }, [initialViewMode]);
  const [capitalFilter, setCapitalFilter] = useState<'live' | 'demo' | 'all'>('live');
  const [filterStatus, setFilterStatus] = useState<'ALL' | 'PROFIT' | 'LOSS' | 'READY_SELL' | 'NEEDS_EDIS'>('ALL');
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

  // Trade Modal State
  const [tradeModal, setTradeModal] = useState<{
    isOpen: boolean;
    symbol: string;
    companyName?: string;
    exchange?: string;
    initialPrice?: number;
    initialType?: 'BUY' | 'SELL';
  }>({
    isOpen: false,
    symbol: '',
    companyName: '',
    exchange: 'NSE',
    initialPrice: 100,
    initialType: 'BUY'
  });
  
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const handleOpenTrade = (item: ConsolidatedHolding, type: 'BUY' | 'SELL') => {
    setTradeModal({
      isOpen: true,
      symbol: item.symbol,
      companyName: item.company_name,
      exchange: item.exchange || 'NSE',
      initialPrice: item.current_ltp,
      initialType: type
    });
  };


  // Accounts applicable to the current capital filter
  const applicableAccounts = useMemo(() => {
    if (capitalFilter === 'live') return allAccounts.filter(a => !a.is_demo);
    if (capitalFilter === 'demo') return allAccounts.filter(a => a.is_demo);
    return allAccounts;
  }, [allAccounts, capitalFilter]);

  // Load initial accounts
  useEffect(() => {
    const loadAccounts = async () => {
      try {
        const accs = await api.getAccounts();
        setAllAccounts(accs);
        // By default, select live accounts if available, otherwise all
        const liveAccs = accs.filter(a => !a.is_demo);
        const initialSelected = liveAccs.length > 0 ? liveAccs.map(a => a.id) : accs.map(a => a.id);
        setSelectedAccountIds(initialSelected);
      } catch (err) {
        console.error('Error loading accounts:', err);
      }
    };
    loadAccounts();
  }, []);

  // When capital filter changes, synchronize selected accounts
  const handleCapitalFilterChange = (filter: 'live' | 'demo' | 'all') => {
    setCapitalFilter(filter);
    if (filter === 'live') {
      setSelectedAccountIds(allAccounts.filter(a => !a.is_demo).map(a => a.id));
    } else if (filter === 'demo') {
      setSelectedAccountIds(allAccounts.filter(a => a.is_demo).map(a => a.id));
    } else {
      setSelectedAccountIds(allAccounts.map(a => a.id));
    }
  };

  // Load portfolio data whenever selectedAccountIds or capitalFilter changes
  const loadPortfolioData = async () => {
    setIsLoading(true);
    try {
      const consResp = await api.getConsolidatedPortfolio(
        selectedAccountIds.length === applicableAccounts.length ? undefined : selectedAccountIds,
        capitalFilter
      );
      setSummary(consResp.summary);
      setConsolidated(consResp.holdings);

      if (viewMode === 'accounts') {
        const accs = await api.getAccountPortfolios();
        setAccountPortfolios(accs);
      }
    } catch (err: any) {
      console.error('Error loading portfolio:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // Lazy-load account portfolios only when user switches to 'accounts' view tab
  useEffect(() => {
    if (viewMode === 'accounts' && accountPortfolios.length === 0) {
      api.getAccountPortfolios().then(setAccountPortfolios).catch(() => {});
    }
  }, [viewMode, accountPortfolios.length]);

  const [lastTickTime, setLastTickTime] = useState<Date | null>(null);
  const [streamConnected, setStreamConnected] = useState<boolean>(false);

  // Live WebSocket Tick Streaming for Holdings & Real-time P&L recalculation
  useEffect(() => {
    let ws: WebSocket | null = null;
    try {
      const url = getWebSocketUrl();
      ws = new WebSocket(url);
      ws.onopen = () => setStreamConnected(true);
      ws.onclose = () => setStreamConnected(false);
      ws.onerror = () => setStreamConnected(false);
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'TICK' && msg.symbol && typeof msg.ltp === 'number') {
            const sym = msg.symbol.replace('-EQ', '').toUpperCase();
            const newLtp = msg.ltp;
            setLastTickTime(new Date());

            setConsolidated((prev) => {
              let hasChanged = false;
              const updated = prev.map((h) => {
                const hSym = h.symbol.replace('-EQ', '').toUpperCase();
                if (hSym === sym) {
                  hasChanged = true;
                  const newMktVal = Math.round(h.total_quantity * newLtp * 100) / 100;
                  const newPnl = Math.round((newMktVal - h.total_cost) * 100) / 100;
                  const newPnlPct = h.total_cost > 0 ? Math.round((newPnl / h.total_cost) * 10000) / 100 : 0.0;
                  return {
                    ...h,
                    current_ltp: newLtp,
                    market_value: newMktVal,
                    unrealized_pnl: newPnl,
                    pnl_percentage: newPnlPct,
                    last_updated: new Date().toLocaleTimeString('en-IN', { hour12: false }) + ' IST'
                  };
                }
                return h;
              });

              if (hasChanged) {
                const totalVal = updated.reduce((sum, item) => sum + item.market_value, 0);
                const totalCost = updated.reduce((sum, item) => sum + item.total_cost, 0);
                const netPnl = totalVal - totalCost;
                const netPct = totalCost > 0 ? (netPnl / totalCost) * 100 : 0.0;

                setSummary((prevSum) => prevSum ? {
                  ...prevSum,
                  total_current_value: Math.round(totalVal * 100) / 100,
                  unrealized_pnl: Math.round(netPnl * 100) / 100,
                  unrealized_pnl_percentage: Math.round(netPct * 100) / 100,
                  last_sync_time: new Date().toLocaleTimeString('en-IN', { hour12: false }) + ' IST'
                } : null);
              }
              return updated;
            });
          }
        } catch {
          // ignore malformed tick
        }
      };
    } catch {
      setStreamConnected(false);
    }

    return () => {
      if (ws) ws.close();
    };
  }, []);

  useEffect(() => {
    if (allAccounts.length > 0) {
      loadPortfolioData();
    }
  }, [selectedAccountIds, allAccounts.length, capitalFilter]);

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

    if (filterStatus === 'PROFIT') list = list.filter(h => h.unrealized_pnl > 0);
    if (filterStatus === 'LOSS') list = list.filter(h => h.unrealized_pnl < 0);
    if (filterStatus === 'READY_SELL') list = list.filter(h => (h.sellable_quantity || 0) > 0);
    if (filterStatus === 'NEEDS_EDIS') list = list.filter(h => (h.blocked_quantity || 0) > 0);

    list.sort((a, b) => {
      let valA: any = a[sortField];
      let valB: any = b[sortField];
      if (typeof valA === 'string') {
        return sortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
      }
      return sortAsc ? valA - valB : valB - valA;
    });

    return list;
  }, [consolidated, searchQuery, sortField, sortAsc, filterStatus]);


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
      {/* Persistent Disconnection Banner */}
      {allAccounts.some(a => !a.is_demo && a.auth_status !== 'CONNECTED') && (
        <div className="p-4 bg-amber-50 border border-amber-300 rounded-xl flex items-start sm:items-center justify-between gap-3 text-amber-900 shadow-xs">
          <div className="flex items-start sm:items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5 sm:mt-0" />
            <div>
              <p className="text-xs font-bold text-amber-950">
                Historical data is available. Live updates and account modifications are disabled until reconnection.
              </p>
              <p className="text-[11px] text-amber-800 mt-0.5">
                Displaying last saved verified ledger records. To resume live portfolio synchronization and order placement, reconnect disconnected accounts in the Accounts tab.
              </p>
            </div>
          </div>
          <span className="text-[10px] uppercase font-bold bg-amber-200 text-amber-900 px-2 py-0.5 rounded border border-amber-300 shrink-0">
            Last saved data — not live
          </span>
        </div>
      )}

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

      {/* Account & Capital Filter Toolbar */}
      {allAccounts.length > 0 && (
        <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm flex flex-col gap-3 text-xs">
          {/* Row 1: Capital Mode Selector */}
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <span className="text-slate-400 font-semibold uppercase text-[10px]">Capital Mode:</span>
              <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg">
                <button
                  onClick={() => handleCapitalFilterChange('live')}
                  className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors flex items-center gap-1.5 ${
                    capitalFilter === 'live'
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-300" />
                  <span>Live Demat (Real Capital)</span>
                </button>
                <button
                  onClick={() => handleCapitalFilterChange('demo')}
                  className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors flex items-center gap-1.5 ${
                    capitalFilter === 'demo'
                      ? 'bg-slate-800 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                  <span>Simulated / Paper</span>
                </button>
                <button
                  onClick={() => handleCapitalFilterChange('all')}
                  className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
                    capitalFilter === 'all'
                      ? 'bg-brand-600 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  All Accounts Combined
                </button>
              </div>
            </div>

            <div className="text-[11px] text-slate-400 font-medium">
              Showing math for <strong className="text-slate-700">{selectedAccountIds.length}</strong> of {applicableAccounts.length} applicable accounts
            </div>
          </div>

          {/* Row 2: Account Selection Checklist */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-slate-400 font-semibold uppercase text-[10px] mr-1">Accounts:</span>
            <button
              onClick={() => setSelectedAccountIds(applicableAccounts.map(a => a.id))}
              className={`px-2.5 py-1 rounded text-xs font-semibold border transition-colors ${
                selectedAccountIds.length === applicableAccounts.length
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              Select All ({applicableAccounts.length})
            </button>
            {applicableAccounts.map(acc => {
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
                  <span className={`text-[9px] px-1 py-0.2 rounded font-bold ${
                    acc.is_demo ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'
                  }`}>
                    {acc.is_demo ? 'SIM' : 'LIVE'}
                  </span>
                </button>
              );
            })}
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
          <button
            onClick={() => setViewMode('batch-activity')}
            className={`px-4 py-1.5 rounded-md text-xs font-semibold transition-colors flex items-center gap-1.5 ${
              viewMode === 'batch-activity' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>Batch Activity</span>
            {batchContext && (
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            )}
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

      {/* Filter Status Pills */}
      {viewMode === 'consolidated' && (
        <div className="flex flex-wrap items-center gap-1.5 py-1">
          <span className="text-slate-400 font-semibold uppercase text-[10px] mr-1">Filter:</span>
          {[
            { id: 'ALL', label: `All Holdings (${consolidated.length})` },
            { id: 'PROFIT', label: `Profitable (${consolidated.filter(h => h.unrealized_pnl > 0).length})` },
            { id: 'LOSS', label: `In Loss (${consolidated.filter(h => h.unrealized_pnl < 0).length})` },
            { id: 'READY_SELL', label: `Ready to Sell (${consolidated.filter(h => (h.sellable_quantity || 0) > 0).length})` },
            { id: 'NEEDS_EDIS', label: `Needs eDIS (${consolidated.filter(h => (h.blocked_quantity || 0) > 0).length})` },
          ].map(pill => (
            <button
              key={pill.id}
              onClick={() => setFilterStatus(pill.id as any)}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-all ${
                filterStatus === pill.id
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
              }`}
            >
              {pill.label}
            </button>
          ))}
        </div>
      )}


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
                <th className="py-3 px-3">ISIN & Token</th>
                <th className="py-3 px-3 cursor-pointer text-right" onClick={() => { setSortField('total_quantity'); setSortAsc(!sortAsc); }}>
                  <div className="flex items-center justify-end gap-1">
                    <span>Holdings / Sellable</span>
                    <ArrowUpDown className="w-3 h-3 text-slate-400" />
                  </div>
                </th>
                <th className="py-3 px-3 text-right">Avg Cost / Invested</th>
                <th className="py-3 px-3 text-right">LTP / Day Change</th>
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
                <th className="py-3 px-3 text-center">Permitted Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredHoldings.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-xs text-slate-400">
                    No holdings match your search or filter criteria.
                  </td>
                </tr>
              ) : (
                filteredHoldings.map((item) => {
                  const isExpanded = expandedSymbol === item.symbol;
                  const isPositive = item.unrealized_pnl >= 0;
                  const sellableQty = item.sellable_quantity ?? item.total_quantity;
                  const blockedQty = item.blocked_quantity ?? (item.total_quantity - sellableQty);

                  return (
                    <React.Fragment key={item.symbol}>
                      <tr className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-3 px-3 text-slate-400 cursor-pointer" onClick={() => setExpandedSymbol(isExpanded ? null : item.symbol)}>
                          {isExpanded ? <ChevronDown className="w-4 h-4 text-slate-700" /> : <ChevronRight className="w-4 h-4" />}
                        </td>
                        <td className="py-3 px-4 font-bold text-slate-900">
                          <div className="flex items-center gap-2">
                            <span className="hover:text-brand-600 cursor-pointer font-bold text-slate-900" onClick={() => setSelectedInstrumentForChart(item)}>
                              {item.symbol}
                            </span>
                            <span className="text-[10px] bg-slate-100 text-slate-600 px-1 py-0.2 rounded font-medium">
                              {item.exchange}
                            </span>
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" title="Live Broker Feed Active" />
                          </div>
                          <div className="text-[11px] text-slate-400 truncate max-w-xs">{item.company_name}</div>
                        </td>
                        <td className="py-3 px-3">
                          <div className="font-mono text-[11px] text-slate-600">{item.isin || '—'}</div>
                          <div className="text-[10px] text-slate-400 font-mono">Token: {item.symbol_token || '—'}</div>
                        </td>
                        <td className="py-3 px-3 text-right">
                          <div className="num-mono font-bold text-slate-900">{item.total_quantity} Qty</div>
                          <div className="text-[10px] flex items-center justify-end gap-1">
                            <span className="text-emerald-700 font-semibold">{sellableQty} Sellable</span>
                            {blockedQty > 0 && (
                              <span className="text-amber-700 font-medium">({blockedQty} eDIS)</span>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-3 text-right">
                          <div className="num-mono font-semibold text-slate-800">₹{item.average_cost.toFixed(2)}</div>
                          <div className="text-[10px] text-slate-400 num-mono">₹{item.total_cost.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
                        </td>
                        <td className="py-3 px-3 text-right">
                          <div className="num-mono font-bold text-slate-900">₹{item.current_ltp.toFixed(2)}</div>
                          <div className={`text-[10px] font-semibold num-mono ${item.day_change && item.day_change >= 0 ? 'text-finGreen' : 'text-finRed'}`}>
                            {item.day_change && item.day_change >= 0 ? '+' : ''}{item.day_change?.toFixed(2) || '0.00'} ({item.day_change_percent?.toFixed(2) || '0.00'}%)
                          </div>
                        </td>
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
                        <td className="py-3 px-3 text-right">
                          <div className="num-mono text-slate-700 font-semibold">
                            {(item.portfolio_allocation_percent ?? 0).toFixed(1)}%
                          </div>
                          <div className="w-12 ml-auto bg-slate-200 h-1.5 rounded-full overflow-hidden mt-1">
                            <div
                              className="bg-brand-600 h-full rounded-full"
                              style={{ width: `${Math.min(100, item.portfolio_allocation_percent ?? 0)}%` }}
                            />
                          </div>
                        </td>
                        <td className="py-3 px-3 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              onClick={() => handleOpenTrade(item, 'BUY')}
                              className="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-[10px] font-bold shadow-2xs transition-colors"
                              title="Place Buy Order"
                            >
                              BUY
                            </button>
                            <button
                              onClick={() => handleOpenTrade(item, 'SELL')}
                              className="px-2 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded text-[10px] font-bold shadow-2xs transition-colors"
                              title="Place Sell Order"
                            >
                              SELL
                            </button>
                            <button
                              onClick={() => setSelectedInstrumentForChart(item)}
                              className="px-2 py-1 bg-slate-100 hover:bg-slate-800 hover:text-white rounded text-[10px] font-semibold text-slate-700 transition-colors"
                              title="Open Instrument Terminal"
                            >
                              Terminal
                            </button>
                          </div>
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

      {/* View Mode: Batch Activity (Part 5) */}
      {viewMode === 'batch-activity' && (
        <div className="space-y-4">
          {/* Batch Activity Overview Header */}
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2.5">
                <Activity className="w-5 h-5 text-brand-600" />
                <div>
                  <h3 className="font-bold text-sm text-slate-900">Multi-Account Batch Activity Ledger</h3>
                  <p className="text-xs text-slate-500">
                    Track independent instruction execution across authorized Angel One accounts with durable outcome verification.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {batchContext && onClearBatchContext && (
                  <button
                    onClick={onClearBatchContext}
                    className="px-2.5 py-1 text-xs border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-600"
                  >
                    Clear Active Batch
                  </button>
                )}
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                  ANGEL_ONE_SMARTAPI
                </span>
              </div>
            </div>

            {/* Batch Metrics Ribbon */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                <span className="text-[10px] uppercase font-bold text-slate-400">Total Accounts</span>
                <div className="text-lg font-bold font-mono text-slate-900 mt-0.5">
                  {allAccounts.length} Connected
                </div>
                <div className="text-[10px] text-slate-500 mt-0.5">
                  {applicableAccounts.length} applicable under {capitalFilter.toUpperCase()} filter
                </div>
              </div>

              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                <span className="text-[10px] uppercase font-bold text-slate-400">Active Batch Reference</span>
                <div className="text-lg font-bold font-mono text-brand-700 mt-0.5 truncate" title={batchContext?.batchId || 'None'}>
                  {batchContext?.batchId ? batchContext.batchId.slice(0, 14) + '...' : 'No active batch'}
                </div>
                <div className="text-[10px] text-slate-500 mt-0.5">
                  {batchContext?.symbol ? `Instrument: ${batchContext.symbol}` : 'Awaiting batch run'}
                </div>
              </div>

              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                <span className="text-[10px] uppercase font-bold text-slate-400">Verified Fills / Successes</span>
                <div className="text-lg font-bold font-mono text-emerald-600 mt-0.5">
                  {batchContext ? `${batchContext.successCount ?? 0} / ${batchContext.totalOrders ?? 0}` : '—'}
                </div>
                <div className="text-[10px] text-slate-500 mt-0.5">Confirmed order instructions</div>
              </div>

              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                <span className="text-[10px] uppercase font-bold text-slate-400">Rejections / Errors</span>
                <div className={`text-lg font-bold font-mono mt-0.5 ${
                  (batchContext?.failedCount || 0) > 0 ? 'text-rose-600' : 'text-slate-700'
                }`}>
                  {batchContext ? `${batchContext.failedCount ?? 0}` : '0'}
                </div>
                <div className="text-[10px] text-slate-500 mt-0.5">Non-hidden broker errors</div>
              </div>
            </div>
          </div>

          {/* Reconciliation & Regulatory Compliance Notice (Part 5) */}
          <div className="p-3.5 bg-blue-50/80 border border-blue-200 rounded-xl text-xs text-blue-950 flex items-start gap-2.5">
            <Clock className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-semibold">
                Exchange Delivery Settlement & Batch Integrity Notice:
              </p>
              <p className="text-[11px] leading-relaxed text-blue-900">
                • <strong>Delivery Settlement (T+1):</strong> Newly placed and confirmed buy orders are verified instantly in each account's Order Book and Trade Book. Settled demat shares appear in delivery holdings upon completion of the official exchange T+1 settlement cycle.
                <br />
                • <strong>Zero Fabrication Rule:</strong> IPOPro never fabricates instant holding rows or masks failures. If an individual account in a batch fails (e.g. insufficient margin or token expiry), it is explicitly retained below with its original error message.
                <br />
                • <strong>Regulatory Authorization:</strong> Live multi-account execution for unrelated clients requires Angel One broker commercial approval and explicit authorisations. Paper-mode batch runs are simulated in an isolated environment.
              </p>
            </div>
          </div>

          {/* Account-by-Account Batch Execution Table */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
              <h4 className="font-bold text-xs text-slate-800">Individual Account Execution Details</h4>
              <span className="text-xs text-slate-400">
                {batchContext?.accounts ? `${batchContext.accounts.length} Accounts in Batch` : `${allAccounts.length} Connected Accounts`}
              </span>
            </div>

            {batchContext?.accounts && batchContext.accounts.length > 0 ? (
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] font-semibold border-b border-slate-200">
                  <tr>
                    <th className="py-2.5 px-3">Account</th>
                    <th className="py-2.5 px-3">Symbol</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3">Order / Batch Ref</th>
                    <th className="py-2.5 px-3">Execution Detail</th>
                    <th className="py-2.5 px-3">Notes / Error</th>
                    <th className="py-2.5 px-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-[11px]">
                  {batchContext.accounts.map((accRow, idx) => {
                    const isSuccess = ['COMPLETE', 'EXECUTED', 'TRADED', 'SUCCESS'].includes(accRow.status.toUpperCase());
                    const isFailed = ['FAILED', 'REJECTED', 'ERROR'].includes(accRow.status.toUpperCase());
                    return (
                      <tr key={idx} className="hover:bg-slate-50">
                        <td className="py-2.5 px-3">
                          <div className="font-bold text-slate-900">{accRow.nickname}</div>
                          <div className="text-[10px] text-slate-400 font-mono">ID: {accRow.accountId}</div>
                        </td>
                        <td className="py-2.5 px-3 font-semibold text-slate-800">
                          {batchContext.symbol || '—'}
                        </td>
                        <td className="py-2.5 px-3">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            isSuccess
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : isFailed
                              ? 'bg-rose-50 text-rose-700 border border-rose-200'
                              : 'bg-amber-50 text-amber-700 border border-amber-200'
                          }`}>
                            {accRow.status}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 font-mono text-[10px] text-slate-600">
                          {accRow.orderId || batchContext.batchId || '—'}
                        </td>
                        <td className="py-2.5 px-3 text-slate-700">
                          {isSuccess ? 'Verified batch execution' : 'Submission halted / rejected'}
                        </td>
                        <td className="py-2.5 px-3 text-rose-600 text-[10px] max-w-xs">
                          {accRow.error || (isSuccess ? 'Executed without error' : '—')}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          {onNavigateToAccount && (
                            <button
                              onClick={() => onNavigateToAccount(accRow.accountId, 'orders', batchContext.symbol)}
                              className="px-2.5 py-1 text-[10px] font-semibold rounded bg-slate-900 text-white hover:bg-slate-800 transition-colors shadow-2xs whitespace-nowrap"
                            >
                              Inspect Account →
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="py-16 text-center text-slate-400 bg-slate-50">
                <Activity className="w-8 h-8 mx-auto text-slate-300 mb-2" />
                <p className="font-semibold text-slate-600">No batch executions recorded in current session</p>
                <p className="text-xs text-slate-400 mt-0.5">
                  Execute a multi-account paper batch from the Stock Explorer or Accounts drawer to view live batch tracking here.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Selected Stock Modal: Comprehensive Instrument Terminal & Actions */}
      {selectedInstrumentForChart && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="relative w-full max-w-4xl my-8 bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
            {/* Terminal Header Bar */}
            <div className="px-6 py-4 bg-slate-900 text-white flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold tracking-tight">{selectedInstrumentForChart.symbol}</h2>
                  <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                    {selectedInstrumentForChart.exchange}
                  </span>
                  <span className="text-xs text-slate-400 font-mono">ISIN: {selectedInstrumentForChart.isin || '—'}</span>
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" title="Live WebSocket Feed Connected" />
                </div>
                <div className="text-xs text-slate-300 mt-0.5">{selectedInstrumentForChart.company_name}</div>
              </div>

              <div className="flex items-center gap-4">
                <div className="text-right">
                  <div className="text-base font-extrabold text-white num-mono">
                    ₹{selectedInstrumentForChart.current_ltp.toFixed(2)}
                  </div>
                  <div className={`text-xs font-bold num-mono ${
                    (selectedInstrumentForChart.day_change || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`}>
                    {(selectedInstrumentForChart.day_change || 0) >= 0 ? '+' : ''}
                    {selectedInstrumentForChart.day_change?.toFixed(2) || '0.00'} ({selectedInstrumentForChart.day_change_percent?.toFixed(2) || '0.00'}%)
                  </div>
                </div>

                <div className="flex items-center gap-2 border-l border-slate-800 pl-4">
                  <button
                    onClick={() => handleOpenTrade(selectedInstrumentForChart, 'BUY')}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-md shadow-emerald-600/20 transition-all"
                  >
                    BUY
                  </button>
                  <button
                    onClick={() => handleOpenTrade(selectedInstrumentForChart, 'SELL')}
                    className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold shadow-md shadow-rose-600/20 transition-all"
                  >
                    SELL
                  </button>
                  <button
                    onClick={() => setSelectedInstrumentForChart(null)}
                    className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </div>

            {/* Instrument Statistics & Attribution Bar */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 bg-slate-50 border-b border-slate-200 text-xs">
              <div>
                <span className="text-slate-400 text-[10px] uppercase font-semibold">Quantity in Demat</span>
                <div className="font-bold text-slate-900 num-mono mt-0.5">
                  {selectedInstrumentForChart.total_quantity} Shares
                  <span className="text-emerald-700 text-[10px] ml-1">({selectedInstrumentForChart.sellable_quantity ?? selectedInstrumentForChart.total_quantity} Sellable)</span>
                </div>
              </div>
              <div>
                <span className="text-slate-400 text-[10px] uppercase font-semibold">Avg Acquisition Cost</span>
                <div className="font-bold text-slate-900 num-mono mt-0.5">
                  ₹{selectedInstrumentForChart.average_cost.toFixed(2)}
                </div>
              </div>
              <div>
                <span className="text-slate-400 text-[10px] uppercase font-semibold">Current Valuation</span>
                <div className="font-bold text-slate-900 num-mono mt-0.5">
                  ₹{selectedInstrumentForChart.market_value.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </div>
              </div>
              <div>
                <span className="text-slate-400 text-[10px] uppercase font-semibold">Unrealized Gain / Return</span>
                <div className={`font-bold num-mono mt-0.5 ${
                  selectedInstrumentForChart.unrealized_pnl >= 0 ? 'text-emerald-700' : 'text-rose-700'
                }`}>
                  {selectedInstrumentForChart.unrealized_pnl >= 0 ? '+' : ''}₹{selectedInstrumentForChart.unrealized_pnl.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  <span className="text-[10px] ml-1">({selectedInstrumentForChart.pnl_percentage.toFixed(2)}%)</span>
                </div>
              </div>
            </div>

            {/* Interactive Candlestick Chart */}
            <div className="p-4">
              <StockChart
                symbol={selectedInstrumentForChart.symbol}
                initialLtp={selectedInstrumentForChart.current_ltp}
                initialPrevClose={selectedInstrumentForChart.previous_close}
                companyName={selectedInstrumentForChart.company_name}
                accountsBreakdown={selectedInstrumentForChart.accounts_breakdown}
                onClose={() => setSelectedInstrumentForChart(null)}
              />
            </div>

            {/* Cost Basis & Broker Verification Disclosures */}
            <div className="px-6 py-3 bg-slate-50 border-t border-slate-200 text-[11px] text-slate-500 flex flex-wrap items-center justify-between gap-2">
              <div>
                <strong>Valuation Basis:</strong> FIFO weighted-average acquisition cost strictly verified against Angel One Demat holdings.
              </div>
              <div className="text-slate-400">
                Data Source: SmartAPI Streaming WebSocket & Verified Allotment Ledger.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Trade Modal (BUY / SELL) */}
      <TradeModal
        isOpen={tradeModal.isOpen}
        onClose={() => setTradeModal(prev => ({ ...prev, isOpen: false }))}
        symbol={tradeModal.symbol}
        companyName={tradeModal.companyName}
        exchange={tradeModal.exchange}
        initialPrice={tradeModal.initialPrice}
        initialType={tradeModal.initialType}
        accounts={allAccounts}
        onSuccess={() => {
          loadPortfolioData();
        }}
      />
    </div>
  );
};

