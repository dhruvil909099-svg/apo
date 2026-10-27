import React, { useState, useEffect } from 'react';
import { RefreshCw, Clock, ShieldCheck, AlertOctagon } from 'lucide-react';
import { DashboardSummary } from '../types';

interface HeaderProps {
  currentTab: string;
  summary: DashboardSummary | null;
  onRefresh: () => void;
  isRefreshing: boolean;
}

const TAB_TITLES: Record<string, { title: string; subtitle: string }> = {
  dashboard: { title: 'Multi-Account Overview', subtitle: 'Live allotment metrics, consolidated value, and execution status' },
  accounts: { title: 'Angel One Demat Accounts', subtitle: 'Separately authenticated client accounts, connection health & DDPI / eDIS status' },
  'ipo-tracker': { title: 'IPO Allotment Tracker', subtitle: 'Listing dates, confirmed allotments, acquisition cost & CSV register synchronization' },
  'market-watch': { title: 'Live Market Watch', subtitle: 'Real-time LTP, percentage change, and listing-day equilibrium pricing' },
  portfolio: { title: 'Portfolio & Holdings', subtitle: 'Consolidated family holdings and per-account Demat portfolio breakdown' },
  'bulk-orders': { title: 'Bulk Order Execution Workspace', subtitle: 'Multi-account order preparation, tick validation, and coordinated execution' },
  orders: { title: 'Order Book & Positions', subtitle: 'Submitted, accepted, executed, and rejected order records across accounts' },
  risk: { title: 'Risk Limits & Safeguards', subtitle: 'Global loss thresholds, max order values, stop-loss order vs trigger monitoring' },
  alerts: { title: 'Audit Trail & Alerts', subtitle: 'Immutable event log and compliance-grade action records' },
  settings: { title: 'Settings & Reports', subtitle: 'Configuration, exportable registers, and Angel One SmartAPI connection guides' },
};

export const Header: React.FC<HeaderProps> = ({ currentTab, summary, onRefresh, isRefreshing }) => {
  const [timeStr, setTimeStr] = useState<string>('');

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTimeStr(now.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false }) + ' IST');
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  const meta = TAB_TITLES[currentTab] || { title: 'IPOPro Dashboard', subtitle: 'Multi-Account Management' };
  const isHalted = summary?.emergency_trading_disabled ?? false;

  return (
    <header className="bg-white border-b border-slate-200 px-6 py-3.5 flex items-center justify-between flex-shrink-0">
      <div>
        <h1 className="text-lg font-bold text-slate-900 tracking-tight">{meta.title}</h1>
        <p className="text-xs text-slate-500">{meta.subtitle}</p>
      </div>

      <div className="flex items-center gap-4">
        {/* Emergency Halt Banner if active */}
        {isHalted && (
          <div className="flex items-center gap-1.5 px-3 py-1 bg-red-100 border border-red-300 rounded-md text-red-800 text-xs font-bold animate-pulse">
            <AlertOctagon className="w-4 h-4 text-red-600" />
            <span>EMERGENCY TRADING HALTED</span>
          </div>
        )}

        {/* Market Status Pill */}
        <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-slate-100 border border-slate-200 text-xs font-medium text-slate-700">
          <span className="w-2 h-2 rounded-full bg-finGreen animate-ping" />
          <span>NSE / BSE: Cash Market</span>
        </div>

        {/* Live Clock */}
        <div className="flex items-center gap-1.5 text-xs font-mono font-medium text-slate-600 bg-slate-50 px-2.5 py-1 rounded border border-slate-200">
          <Clock className="w-3.5 h-3.5 text-slate-400" />
          <span>{timeStr || 'Loading IST...'}</span>
        </div>

        {/* Refresh Button */}
        <button
          onClick={onRefresh}
          disabled={isRefreshing}
          className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 hover:text-slate-900 transition-colors disabled:opacity-50"
          title="Refresh Data"
        >
          <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-brand-600' : ''}`} />
        </button>
      </div>
    </header>
  );
};
