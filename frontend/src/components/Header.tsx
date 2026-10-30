import React, { useState, useEffect } from 'react';
import {
  RefreshCw, Clock, ShieldCheck, AlertOctagon,
  Server, KeyRound, Wifi, WifiOff, AlertTriangle, CheckCircle2,
  User, LogOut
} from 'lucide-react';
import { DashboardSummary, Account } from '../types';
import { connectionManager, ConnectionState } from '../services/backendConnectionManager';

interface HeaderProps {
  currentTab: string;
  summary: DashboardSummary | null;
  accounts?: Account[];
  onRefresh: () => void;
  isRefreshing: boolean;
  lastUpdated?: Date | null;
  currentUser?: { username: string; role: string } | null;
  onOpenLogin?: () => void;
  onLogout?: () => void;
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

export const Header: React.FC<HeaderProps> = ({
  currentTab,
  summary,
  accounts = [],
  onRefresh,
  isRefreshing,
  lastUpdated,
  currentUser,
  onOpenLogin,
  onLogout,
}) => {
  const [timeStr, setTimeStr] = useState<string>('');
  const [connState, setConnState] = useState<ConnectionState>(connectionManager.getState());

  useEffect(() => {
    const unsub = connectionManager.subscribe((st) => setConnState(st));
    return () => unsub();
  }, []);

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

  // Broker connection status calculations
  const totalAccounts = accounts.length;
  const liveAccounts = accounts.filter((a) => !a.is_demo);
  const errorAccounts = accounts.filter((a) => a.auth_status === 'ERROR' || a.auth_status === 'EXPIRED');

  // Backend connection status badge rendering
  const renderBackendStatus = () => {
    const { lifecycle, lastProbeLatencyMs, nextRetryInSeconds, isWakingUp } = connState;

    if (lifecycle === 'CONNECTED' || lifecycle === 'READY' || lifecycle === 'LOADING_DATA') {
      return (
        <div
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-50 border border-emerald-200 text-[11px] font-semibold text-emerald-700"
          title={`Backend connected (${lastProbeLatencyMs || 0}ms)`}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          <span>Backend: Online</span>
        </div>
      );
    }

    if (lifecycle === 'CHECKING_BACKEND') {
      return (
        <div
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-blue-50 border border-blue-200 text-[11px] font-semibold text-blue-700 animate-pulse"
          title="Checking backend liveness..."
        >
          <RefreshCw className="w-3 h-3 animate-spin text-blue-600" />
          <span>Connecting...</span>
        </div>
      );
    }

    if (lifecycle === 'RETRYING') {
      return (
        <div
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-50 border border-amber-300 text-[11px] font-semibold text-amber-800"
          title={connState.statusMessage}
        >
          <RefreshCw className="w-3 h-3 animate-spin text-amber-600" />
          <span>
            {isWakingUp ? 'Waking up' : 'Reconnecting'}
            {nextRetryInSeconds !== null ? ` in ${nextRetryInSeconds}s` : '...'}
          </span>
        </div>
      );
    }

    if (lifecycle === 'DEGRADED') {
      return (
        <div
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-50 border border-amber-200 text-[11px] font-semibold text-amber-700"
          title="Backend running but database degraded"
        >
          <AlertTriangle className="w-3 h-3 text-amber-500" />
          <span>Backend Degraded</span>
        </div>
      );
    }

    if (lifecycle === 'AUTHENTICATION_REQUIRED') {
      return (
        <div
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-rose-50 border border-rose-200 text-[11px] font-semibold text-rose-700"
          title="Invalid API Key configured"
        >
          <KeyRound className="w-3 h-3 text-rose-500" />
          <span>Auth Required</span>
        </div>
      );
    }

    return (
      <div
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-100 border border-slate-300 text-[11px] font-semibold text-slate-600"
        title="Backend unreachable"
      >
        <WifiOff className="w-3 h-3 text-slate-400" />
        <span>Offline</span>
      </div>
    );
  };

  // Broker session status badge rendering
  const renderBrokerStatus = () => {
    if (totalAccounts === 0) {
      return null;
    }

    if (errorAccounts.length > 0) {
      return (
        <div
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-rose-50 border border-rose-200 text-[11px] font-semibold text-rose-700"
          title={`${errorAccounts.length} account(s) need session reconnection`}
        >
          <KeyRound className="w-3 h-3 text-rose-600" />
          <span>Angel One: {errorAccounts.length} Action Needed</span>
        </div>
      );
    }

    if (liveAccounts.length > 0) {
      return (
        <div
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-50 border border-emerald-200 text-[11px] font-semibold text-emerald-700"
          title="All authorized Angel One sessions healthy"
        >
          <ShieldCheck className="w-3 h-3 text-emerald-600" />
          <span>Angel One: Valid</span>
        </div>
      );
    }

    return (
      <div
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-50 border border-amber-200 text-[11px] font-semibold text-amber-800"
        title="Simulated demo trading pool only"
      >
        <ShieldCheck className="w-3 h-3 text-amber-600" />
        <span>Angel One: Demo</span>
      </div>
    );
  };

  return (
    <header className="bg-white border-b border-slate-200 px-6 py-3.5 flex items-center justify-between flex-shrink-0">
      <div>
        <h1 className="text-lg font-bold text-slate-900 tracking-tight">{meta.title}</h1>
        <p className="text-xs text-slate-500">{meta.subtitle}</p>
      </div>

      <div className="flex items-center gap-3">
        {/* Emergency Halt Banner */}
        {isHalted && (
          <div className="flex items-center gap-1.5 px-3 py-1 bg-red-100 border border-red-300 rounded-md text-red-800 text-xs font-bold animate-pulse">
            <AlertOctagon className="w-4 h-4 text-red-600" />
            <span>EMERGENCY TRADING HALTED</span>
          </div>
        )}

        {/* Status Badges: Backend & Broker */}
        {renderBackendStatus()}
        {renderBrokerStatus()}

        {/* Live Market Pill */}
        <div className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-100 border border-slate-200 text-[11px] font-medium text-slate-700">
          <span className="w-2 h-2 rounded-full bg-finGreen animate-ping" />
          <span>NSE / BSE: Cash</span>
        </div>

        {/* Live Clock & Last Updated */}
        <div className="flex items-center gap-1.5 text-xs font-mono font-medium text-slate-600 bg-slate-50 px-2.5 py-1 rounded border border-slate-200">
          <Clock className="w-3.5 h-3.5 text-slate-400" />
          <span>{timeStr || 'Loading IST...'}</span>
        </div>

        {/* User Authentication Profile */}
        {currentUser ? (
          <div className="flex items-center gap-2 pl-1">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-100 border border-slate-200 text-xs">
              <User className="w-3.5 h-3.5 text-brand-600" />
              <span className="font-semibold text-slate-800">{currentUser.username}</span>
              <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-brand-50 text-brand-700 border border-brand-200">
                {currentUser.role}
              </span>
            </div>
            {onLogout && (
              <button
                onClick={onLogout}
                title="Sign out of IPOPro"
                className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-rose-50 text-slate-500 hover:text-rose-600 transition-colors"
              >
                <LogOut className="w-4 h-4" />
              </button>
            )}
          </div>
        ) : (
          onOpenLogin && (
            <button
              onClick={onOpenLogin}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white font-semibold text-xs shadow-sm shadow-brand-600/30 transition-all"
            >
              <KeyRound className="w-3.5 h-3.5" />
              <span>Sign In</span>
            </button>
          )
        )}

        {/* Refresh Button */}
        <button
          onClick={onRefresh}
          disabled={isRefreshing}
          className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 hover:text-slate-900 transition-colors disabled:opacity-50"
          title={lastUpdated ? `Last updated: ${lastUpdated.toLocaleTimeString('en-IN')}` : 'Refresh Data'}
        >
          <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-brand-600' : ''}`} />
        </button>
      </div>
    </header>
  );
};
