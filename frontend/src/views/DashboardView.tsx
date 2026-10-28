import React, { useState, useEffect, useMemo } from 'react';
import {
  Users, TrendingUp, Layers, CheckCircle2,
  DollarSign, ArrowUpRight, ArrowDownRight, Clock, ShieldCheck,
  AlertTriangle, RefreshCw, ChevronRight, Wallet, ShieldAlert
} from 'lucide-react';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { DashboardSummary, IPO, Order, Account, AccountPortfolio } from '../types';
import { api } from '../api';

interface DashboardViewProps {
  summary: DashboardSummary | null;
  ipos: IPO[];
  orders: Order[];
  accounts: Account[];
  onNavigate: (tab: string) => void;
  onRefresh?: () => void;
  lastUpdated?: Date | null;
}

const mockTrajectoryData = [
  { time: '09:00', value: 433950 },
  { time: '09:15', value: 433950 },
  { time: '09:30', value: 485000 },
  { time: '09:45', value: 540000 },
  { time: '10:00', value: 615000 },
  { time: '10:15', value: 632000 },
  { time: '10:30', value: 648250 },
];

export const DashboardView: React.FC<DashboardViewProps> = ({
  summary,
  ipos,
  orders,
  accounts,
  onNavigate,
  onRefresh,
  lastUpdated,
}) => {
  const [accountPortfolios, setAccountPortfolios] = useState<AccountPortfolio[]>([]);
  const [chartView, setChartView] = useState<'allocation' | 'trajectory'>('allocation');
  const [isRefreshingAccounts, setIsRefreshingAccounts] = useState(false);

  // Fetch account portfolios to get exact verified contribution per account
  useEffect(() => {
    let isMounted = true;
    const fetchPortfolios = async () => {
      try {
        const data = await api.getAccountPortfolios();
        if (isMounted) setAccountPortfolios(data);
      } catch (err) {
        // Fall back gracefully
      }
    };
    fetchPortfolios();
    // Automatic Data Engine: Auto-refresh stale accounts in background without UI freeze
    api.triggerAutoRefresh(false).catch(() => {});
    return () => {
      isMounted = false;
    };
  }, [accounts]);

  const [autoSyncNotice, setAutoSyncNotice] = useState<string | null>(null);
  const [isAutoRefreshing, setIsAutoRefreshing] = useState(false);

  const handleTriggerAutoRefresh = async () => {
    setIsAutoRefreshing(true);
    try {
      const res = await api.triggerAutoRefresh(true);
      setAutoSyncNotice(res.message);
      if (onRefresh) onRefresh();
      setTimeout(() => setAutoSyncNotice(null), 5000);
    } catch (err: any) {
      setAutoSyncNotice(`Refresh notice: ${err.message}`);
    } finally {
      setIsAutoRefreshing(false);
    }
  };


  const pnlIsPositive = (summary?.total_unrealized_pnl ?? 0) >= 0;

  // Identify expired accounts
  const expiredAccounts = useMemo(() => {
    return accounts.filter(a => a.auth_status === 'EXPIRED');
  }, [accounts]);

  // Map account ID to portfolio value
  const accountPortfolioMap = useMemo(() => {
    const map = new Map<number, AccountPortfolio>();
    for (const ap of accountPortfolios) {
      map.set(ap.account_id, ap);
    }
    return map;
  }, [accountPortfolios]);

  // Data for Account Valuation Breakdown Chart
  const accountAllocationChartData = useMemo(() => {
    if (accountPortfolios.length === 0) {
      return accounts.map(a => ({
        name: a.nickname || a.masked_client_code,
        value: a.available_cash || 0,
        isDemo: a.is_demo,
      }));
    }
    return accountPortfolios.map(ap => ({
      name: ap.nickname || ap.masked_client_code,
      value: ap.portfolio_value || 0,
      cash: ap.available_cash || 0,
      isDemo: ap.is_demo,
    }));
  }, [accountPortfolios, accounts]);

  const handleManualSync = async () => {
    if (onRefresh) {
      setIsRefreshingAccounts(true);
      try {
        await onRefresh();
      } finally {
        setIsRefreshingAccounts(false);
      }
    }
  };

  return (
    <div className="space-y-6">
      {/* Auto-Data Engine & Self-Healing Telemetry Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-brand-50 border border-brand-200 flex items-center justify-center text-brand-700">
            <ShieldCheck className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-900 tracking-tight">Auto-Data Engine & Self-Healing</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Active
              </span>
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Demat holdings & RMS cash are refreshed automatically in the background using saved Base32 credentials. Zero manual Sync clicks required.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
          {autoSyncNotice && (
            <span className="text-[11px] text-emerald-700 font-semibold">{autoSyncNotice}</span>
          )}
          <button
            onClick={handleTriggerAutoRefresh}
            disabled={isAutoRefreshing}
            className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-50 shadow-xs"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isAutoRefreshing ? 'animate-spin' : ''}`} />
            <span>{isAutoRefreshing ? 'Refreshing...' : 'Auto-Refresh Now'}</span>
          </button>
        </div>
      </div>

      {/* Session Expired Global Banner */}
      {expiredAccounts.length > 0 && (

        <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-100 text-amber-800 rounded-lg">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-xs font-bold text-amber-900 uppercase tracking-wider">
                Angel One Broker Session Expired ({expiredAccounts.length} Account{expiredAccounts.length > 1 ? 's' : ''})
              </h4>
              <p className="text-xs text-amber-800 mt-0.5">
                Daily SmartAPI tokens expired for: <strong>{expiredAccounts.map(a => a.nickname).join(', ')}</strong>. Re-authenticate in Accounts to restore live holdings and order placement.
              </p>
            </div>
          </div>
          <button
            onClick={() => onNavigate('accounts')}
            className="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors whitespace-nowrap flex items-center gap-1"
          >
            <span>Reconnect Accounts</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* KPI Cards Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        {/* Card 1: Connected Accounts */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-medium">Authorized Accounts</span>
            <Users className="w-4 h-4 text-brand-600" />
          </div>
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-slate-900 num-mono">
                {summary?.connected_accounts ?? 0}
              </span>
              <span className="text-xs text-slate-500">of {summary?.total_accounts ?? accounts.length} active</span>
            </div>
            <div className="mt-2 flex items-center gap-1.5 text-[11px] font-medium">
              {expiredAccounts.length > 0 ? (
                <span className="text-amber-600 flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {expiredAccounts.length} Expired Session{expiredAccounts.length > 1 ? 's' : ''}
                </span>
              ) : (
                <span className="text-finGreen flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  All Sessions Active
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Card 2: Monitored IPOs */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-medium">Active IPOs</span>
            <TrendingUp className="w-4 h-4 text-brand-600" />
          </div>
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-slate-900 num-mono">
                {summary?.total_ipos_monitored ?? ipos.length}
              </span>
              <span className="text-xs text-slate-500">tracked</span>
            </div>
            <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-500">
              <span className="bg-blue-50 text-brand-600 px-1.5 py-0.5 rounded font-medium border border-blue-200">
                {ipos.filter(i => i.status === 'PRE_OPEN').length} Pre-Open
              </span>
              <span className="bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-medium">
                {ipos.filter(i => i.status === 'LISTED').length} Listed
              </span>
              {ipos.filter(i => i.is_sme).length > 0 && (
                <span className="bg-purple-50 text-purple-700 px-1.5 py-0.5 rounded font-medium border border-purple-200">
                  {ipos.filter(i => i.is_sme).length} SME
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Card 3: Confirmed Allotted Shares */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-medium">Confirmed Allotments</span>
            <Layers className="w-4 h-4 text-brand-600" />
          </div>
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-slate-900 num-mono">
                {summary?.total_allotted_shares.toLocaleString('en-IN') ?? 0}
              </span>
              <span className="text-xs text-slate-500">shares</span>
            </div>
            <div className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-500">
              <span>Across all accounts</span>
            </div>
          </div>
        </div>

        {/* Card 4: Estimated Market Value */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-medium">Portfolio Market Value</span>
            <DollarSign className="w-4 h-4 text-brand-600" />
          </div>
          <div>
            <div className="text-2xl font-bold text-slate-900 num-mono">
              ₹{summary?.total_portfolio_value.toLocaleString('en-IN', { minimumFractionDigits: 2 }) ?? '0.00'}
            </div>
            <div className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-500">
              <span>Mark to Market (LTP)</span>
            </div>
          </div>
        </div>

        {/* Card 5: Unrealized P&L */}
        <div className={`p-4 rounded-xl border shadow-sm flex flex-col justify-between ${
          pnlIsPositive ? 'bg-finGreen-bg border-finGreen-border' : 'bg-finRed-bg border-finRed-border'
        }`}>
          <div className="flex items-center justify-between mb-2">
            <span className={`text-xs font-semibold ${pnlIsPositive ? 'text-finGreen-text' : 'text-finRed-text'}`}>
              Unrealized Profit / Loss
            </span>
            {pnlIsPositive ? (
              <ArrowUpRight className="w-4 h-4 text-finGreen" />
            ) : (
              <ArrowDownRight className="w-4 h-4 text-finRed" />
            )}
          </div>
          <div>
            <div className={`text-2xl font-bold num-mono ${pnlIsPositive ? 'text-finGreen-text' : 'text-finRed-text'}`}>
              {pnlIsPositive ? '+' : ''}₹{summary?.total_unrealized_pnl.toLocaleString('en-IN', { minimumFractionDigits: 2 }) ?? '0.00'}
            </div>
            <div className={`mt-2 text-[11px] font-bold ${pnlIsPositive ? 'text-finGreen-text' : 'text-finRed-text'}`}>
              {pnlIsPositive ? '+' : ''}{summary?.pnl_percentage.toFixed(2)}% on acquisition cost
            </div>
          </div>
        </div>
      </div>

      {/* Authorized Angel One Accounts Command Center */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4 pb-3 border-b border-slate-100">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-slate-900 tracking-tight">Authorized Angel One Accounts</h2>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700">
                {accounts.length} Total
              </span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                {accounts.filter(a => a.auth_status === 'CONNECTED').length} Connected
              </span>
              {accounts.some(a => a.is_demo) && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                  {accounts.filter(a => a.is_demo).length} Simulated
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Live status, available funds, portfolio contribution and SmartAPI synchronization
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[11px] text-slate-400 font-mono hidden sm:inline">
              Data Freshness: {lastUpdated ? lastUpdated.toLocaleTimeString('en-IN') : summary?.server_time ? new Date(summary.server_time).toLocaleTimeString('en-IN') : 'Live'}
            </span>
            <button
              onClick={handleManualSync}
              disabled={isRefreshingAccounts}
              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshingAccounts ? 'animate-spin' : ''}`} />
              <span>{isRefreshingAccounts ? 'Syncing...' : 'Sync Now'}</span>
            </button>
            <button
              onClick={() => onNavigate('accounts')}
              className="px-3 py-1.5 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors flex items-center gap-1"
            >
              <span>Manage Accounts</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {accounts.length === 0 ? (
          <div className="text-center py-8 text-slate-400 text-xs">
            <Users className="w-8 h-8 mx-auto mb-2 opacity-50" />
            No Angel One accounts configured yet. Navigate to Accounts to add your first client profile.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3.5">
            {accounts.map(acc => {
              const ap = accountPortfolioMap.get(acc.id);
              const isExpired = acc.auth_status === 'EXPIRED';
              const isConnected = acc.auth_status === 'CONNECTED';
              const isError = acc.auth_status === 'ERROR';

              return (
                <div
                  key={acc.id}
                  onClick={() => onNavigate('accounts')}
                  className={`p-3.5 rounded-xl border transition-all cursor-pointer hover:shadow-md ${
                    isExpired
                      ? 'bg-amber-50/40 border-amber-300 hover:border-amber-400'
                      : isError
                      ? 'bg-red-50/40 border-red-300 hover:border-red-400'
                      : 'bg-white border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-xs text-slate-900">{acc.nickname}</span>
                        <span className={`text-[9px] px-1.5 py-0.2 rounded font-bold ${
                          acc.is_demo ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'
                        }`}>
                          {acc.is_demo ? 'SIM' : 'LIVE'}
                        </span>
                      </div>
                      <span className="font-mono text-[10px] text-slate-400">{acc.masked_client_code}</span>
                    </div>

                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold flex items-center gap-1 ${
                      isConnected
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        : isExpired
                        ? 'bg-amber-100 text-amber-800 border border-amber-300'
                        : isError
                        ? 'bg-red-100 text-red-800 border border-red-300'
                        : 'bg-slate-100 text-slate-600 border border-slate-200'
                    }`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${
                        isConnected ? 'bg-emerald-500' : isExpired ? 'bg-amber-500' : isError ? 'bg-red-500' : 'bg-slate-400'
                      }`} />
                      <span>{acc.auth_status}</span>
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs pt-2 border-t border-slate-100">
                    <div>
                      <span className="text-[10px] text-slate-400 block font-medium">Available Cash</span>
                      <span className="font-bold num-mono text-slate-800 text-[11px]">
                        ₹{(acc.available_cash ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400 block font-medium">Holdings Value</span>
                      <span className="font-bold num-mono text-slate-800 text-[11px]">
                        ₹{(ap?.portfolio_value ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                      </span>
                    </div>
                  </div>

                  <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-400">
                    <span>
                      {acc.ddpi_status === 'ACTIVE' ? 'DDPI Active' : 'eDIS Required'}
                    </span>
                    <span className="font-mono">
                      {acc.last_sync_time
                        ? `Synced ${new Date(acc.last_sync_time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`
                        : 'Pending sync'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Quick Actions Ribbon */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Quick Actions:</span>
          <button
            onClick={() => onNavigate('bulk-orders')}
            className="px-3.5 py-1.5 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-xs font-semibold shadow-sm transition-colors flex items-center gap-1.5"
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Launch Bulk Sell Workspace</span>
          </button>
          <button
            onClick={() => onNavigate('portfolio')}
            className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5"
          >
            <Wallet className="w-3.5 h-3.5 text-slate-500" />
            <span>Consolidated Portfolio</span>
          </button>
          <button
            onClick={() => onNavigate('ipo-tracker')}
            className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg text-xs font-medium transition-colors"
          >
            Import Allotment Register
          </button>
          <button
            onClick={() => onNavigate('accounts')}
            className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg text-xs font-medium transition-colors"
          >
            Manage Accounts
          </button>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <ShieldCheck className="w-4 h-4 text-brand-600" />
          <span>Paper Trading Safeguards Active</span>
        </div>
      </div>

      {/* Grid: Chart & IPO Watchlist */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Dynamic Portfolio Chart Card */}
        <div className="lg:col-span-2 bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-bold text-slate-900 tracking-tight">
                {chartView === 'allocation' ? 'Account Holdings Contribution' : 'Portfolio Trajectory (Intraday)'}
              </h2>
              <p className="text-xs text-slate-500">
                {chartView === 'allocation'
                  ? 'Rupee valuation contributed by each authorized Angel One account'
                  : 'Consolidated holding valuation across time'}
              </p>
            </div>
            <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg text-xs font-medium">
              <button
                onClick={() => setChartView('allocation')}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${
                  chartView === 'allocation' ? 'bg-white shadow-xs text-slate-900' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                By Account
              </button>
              <button
                onClick={() => setChartView('trajectory')}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${
                  chartView === 'trajectory' ? 'bg-white shadow-xs text-slate-900' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Trajectory
              </button>
            </div>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              {chartView === 'allocation' ? (
                <BarChart data={accountAllocationChartData} margin={{ top: 10, right: 10, left: 10, bottom: 20 }}>
                  <XAxis dataKey="name" stroke="#94A3B8" fontSize={11} tickLine={false} />
                  <YAxis
                    stroke="#94A3B8"
                    fontSize={11}
                    tickLine={false}
                    tickFormatter={(val) => `₹${(val / 1000).toFixed(0)}k`}
                  />
                  <Tooltip
                    formatter={(val: any) => [`₹${Number(val).toLocaleString('en-IN')}`, 'Portfolio Valuation']}
                    contentStyle={{ backgroundColor: '#0B132B', borderColor: '#1C2541', borderRadius: '8px', color: '#fff', fontSize: '12px' }}
                  />
                  <Bar dataKey="value" fill="#2563EB" radius={[4, 4, 0, 0]} />
                </BarChart>
              ) : (
                <AreaChart data={mockTrajectoryData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorVal" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#2563EB" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#2563EB" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="time" stroke="#94A3B8" fontSize={11} tickLine={false} />
                  <YAxis
                    stroke="#94A3B8"
                    fontSize={11}
                    tickLine={false}
                    domain={['dataMin - 20000', 'dataMax + 20000']}
                    tickFormatter={(val) => `₹${(val / 1000).toFixed(0)}k`}
                  />
                  <Tooltip
                    formatter={(val: any) => [`₹${Number(val).toLocaleString('en-IN')}`, 'Portfolio Value']}
                    contentStyle={{ backgroundColor: '#0B132B', borderColor: '#1C2541', borderRadius: '8px', color: '#fff', fontSize: '12px' }}
                  />
                  <Area type="monotone" dataKey="value" stroke="#2563EB" strokeWidth={2.5} fillOpacity={1} fill="url(#colorVal)" />
                </AreaChart>
              )}
            </ResponsiveContainer>
          </div>
        </div>

        {/* IPO Watchlist Card */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-slate-900 tracking-tight">Active IPO Allotments</h2>
            <button
              onClick={() => onNavigate('ipo-tracker')}
              className="text-xs text-brand-600 hover:text-brand-700 font-medium"
            >
              View All ({ipos.length})
            </button>
          </div>
          <div className="divide-y divide-slate-100 flex-1 overflow-y-auto">
            {ipos.length === 0 ? (
              <div className="text-center py-8 text-slate-400 text-xs">
                No active IPO allotments monitored.
              </div>
            ) : (
              ipos.slice(0, 6).map((ipo) => {
                const gainPct = ipo.issue_price > 0 && ipo.current_ltp
                  ? ((ipo.current_ltp - ipo.issue_price) / ipo.issue_price) * 100
                  : 0;
                const isPositive = gainPct >= 0;

                return (
                  <div key={ipo.id} className="py-3 flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-xs text-slate-900">{ipo.symbol}</span>
                        <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.2 rounded font-medium">
                          {ipo.exchange}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 truncate max-w-[150px]">{ipo.company_name}</p>
                    </div>
                    <div className="text-right">
                      <div className="text-xs font-bold text-slate-900 num-mono">
                        ₹{ipo.current_ltp?.toFixed(2) ?? ipo.issue_price.toFixed(2)}
                      </div>
                      <div className={`text-[10px] font-bold num-mono ${isPositive ? 'text-finGreen' : 'text-finRed'}`}>
                        {isPositive ? '+' : ''}{gainPct.toFixed(2)}%
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Recent Orders Execution Book */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-bold text-slate-900 tracking-tight">Today's Executed & Pending Orders</h2>
            <p className="text-xs text-slate-500">Live order activity across all connected accounts</p>
          </div>
          <button
            onClick={() => onNavigate('orders')}
            className="text-xs text-brand-600 hover:text-brand-700 font-medium"
          >
            Open Order Book
          </button>
        </div>

        {orders.length === 0 ? (
          <div className="text-center py-8 text-slate-400 text-xs">
            <Clock className="w-8 h-8 mx-auto mb-2 opacity-50" />
            No orders submitted today. Use the Bulk Order Workspace to prepare and execute trades.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider font-semibold border-b border-slate-200 text-[10px]">
                <tr>
                  <th className="py-2.5 px-3">Order ID</th>
                  <th className="py-2.5 px-3">Account</th>
                  <th className="py-2.5 px-3">Symbol</th>
                  <th className="py-2.5 px-3">Side</th>
                  <th className="py-2.5 px-3">Type</th>
                  <th className="py-2.5 px-3">Qty</th>
                  <th className="py-2.5 px-3">Limit Price</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {orders.slice(0, 5).map((o) => (
                  <tr key={o.id} className="tr-hover">
                    <td className="py-2 px-3 font-mono text-[11px] text-slate-500">
                      {o.broker_order_id || o.client_order_id.slice(0, 8)}
                    </td>
                    <td className="py-2 px-3 font-medium text-slate-900">
                      {o.account_nickname || o.account_masked_code}
                    </td>
                    <td className="py-2 px-3 font-bold text-slate-900">{o.tradingsymbol}</td>
                    <td className="py-2 px-3">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        o.transaction_type === 'SELL' ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'
                      }`}>
                        {o.transaction_type}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-slate-600">{o.order_type}</td>
                    <td className="py-2 px-3 num-mono font-medium">{o.quantity}</td>
                    <td className="py-2 px-3 num-mono font-medium">₹{o.price.toFixed(2)}</td>
                    <td className="py-2 px-3">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        o.status === 'EXECUTED'
                          ? 'bg-finGreen-bg text-finGreen-text border border-finGreen-border'
                          : o.status === 'REJECTED'
                          ? 'bg-finRed-bg text-finRed-text border border-finRed-border'
                          : 'bg-blue-50 text-brand-600 border border-blue-200'
                      }`}>
                        {o.status}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-slate-400 font-mono text-[10px]">
                      {new Date(o.created_at).toLocaleTimeString('en-IN', { hour12: false })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
