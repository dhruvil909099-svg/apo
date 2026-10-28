import React from 'react';
import {
  Users, TrendingUp, Layers, CheckCircle2,
  DollarSign, ArrowUpRight, ArrowDownRight, Clock, ShieldCheck
} from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { DashboardSummary, IPO, Order } from '../types';

interface DashboardViewProps {
  summary: DashboardSummary | null;
  ipos: IPO[];
  orders: Order[];
  onNavigate: (tab: string) => void;
}

const mockChartData = [
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
  onNavigate,
}) => {
  const pnlIsPositive = (summary?.total_unrealized_pnl ?? 0) >= 0;

  return (
    <div className="space-y-6">
      {/* KPI Cards Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        {/* Card 1: Connected Accounts */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-medium">Connected Accounts</span>
            <Users className="w-4 h-4 text-brand-600" />
          </div>
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-slate-900 num-mono">
                {summary?.connected_accounts ?? 0}
              </span>
              <span className="text-xs text-slate-500">of {summary?.total_accounts ?? 0} active</span>
            </div>
            <div className="mt-2 flex items-center gap-1.5 text-[11px] text-finGreen font-medium">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>100% Sessions Valid</span>
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
                {summary?.total_ipos_monitored ?? 0}
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
            onClick={() => onNavigate('ipo-tracker')}
            className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg text-xs font-medium transition-colors"
          >
            Import Allotment Register (CSV)
          </button>
          <button
            onClick={() => onNavigate('accounts')}
            className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg text-xs font-medium transition-colors"
          >
            Manage Demat Accounts
          </button>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <ShieldCheck className="w-4 h-4 text-brand-600" />
          <span>Paper Trading Active: No live exchange orders will be executed.</span>
        </div>
      </div>

      {/* Grid: Chart & IPO Watchlist */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Intraday Portfolio Trajectory Chart */}
        <div className="lg:col-span-2 bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-bold text-slate-900 tracking-tight">Portfolio Value Trajectory (Listing Session)</h2>
              <p className="text-xs text-slate-500">Simulated combined holding valuation across all accounts</p>
            </div>
            <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg text-xs font-medium">
              <span className="px-2.5 py-1 bg-white rounded-md shadow-xs text-slate-800 font-semibold">Today (1M)</span>
              <span className="px-2.5 py-1 text-slate-500">1W</span>
              <span className="px-2.5 py-1 text-slate-500">1M</span>
            </div>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={mockChartData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
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
            {ipos.map((ipo) => {
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
            })}
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
