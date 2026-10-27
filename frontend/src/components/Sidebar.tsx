import React from 'react';
import {
  LayoutDashboard, Users, TrendingUp, PieChart,
  Layers, ClipboardList, ShieldAlert, Bell, Settings,
  AlertTriangle, Shield, UserCheck, BarChart2,
  Download, ArrowRight
} from 'lucide-react';
import { DashboardSummary } from '../types';

interface SidebarProps {
  currentTab: string;
  setCurrentTab: (tab: string) => void;
  summary: DashboardSummary | null;
  onToggleHalt: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentTab,
  setCurrentTab,
  summary,
  onToggleHalt,
}) => {
  const isHalted = summary?.emergency_trading_disabled ?? false;
  const isPaper = summary?.trading_mode !== 'LIVE';

  const navSections = [
    {
      title: 'OVERVIEW',
      items: [
        { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
      ]
    },
    {
      title: 'IPO MANAGEMENT',
      items: [
        { id: 'ipo-tracker', label: 'IPO Tracker & Allotments', icon: TrendingUp, badge: summary?.total_ipos_monitored },
      ]
    },
    {
      title: 'PORTFOLIO & CHARTS',
      items: [
        { id: 'portfolio', label: 'Consolidated Holdings', icon: PieChart },
        { id: 'stock-explorer', label: 'Stock Explorer & Charts', icon: BarChart2 },
      ]
    },
    {
      title: 'ACCOUNTS',
      items: [
        { id: 'accounts', label: 'Connected Accounts', icon: Users, badge: summary?.total_accounts },
      ]
    },
    {
      title: 'OPERATIONS',
      items: [
        { id: 'single-account-tasks', label: 'Single Account Tasks', icon: UserCheck },
        { id: 'bulk-operations', label: 'Bulk Operations', icon: Layers },
        { id: 'bulk-orders', label: 'Bulk Order Workspace', icon: ArrowRight, highlight: true },
        { id: 'orders', label: 'Order Book & History', icon: ClipboardList, badge: summary?.orders_today_count },
      ]
    },
    {
      title: 'REPORTS & EXPORTS',
      items: [
        { id: 'reports', label: 'Export Center', icon: Download },
      ]
    },
    {
      title: 'SYSTEM & SECURITY',
      items: [
        { id: 'risk', label: 'Risk Controls', icon: ShieldAlert },
        { id: 'alerts', label: 'Notifications & Audit', icon: Bell },
        { id: 'settings', label: 'Settings & Compliance', icon: Settings },
      ]
    }
  ];

  return (
    <aside className="w-64 bg-navy-900 border-r border-navy-800 flex flex-col h-screen text-slate-300 flex-shrink-0 select-none">
      {/* Brand Header */}
      <div className="h-16 flex items-center px-5 border-b border-navy-800 gap-3">
        <div className="w-9 h-9 rounded-lg bg-brand-600 flex items-center justify-center text-white shadow-md shadow-brand-600/30">
          <Shield className="w-5 h-5" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="font-bold text-white text-base tracking-tight">IPOPro</span>
            <span className="text-[10px] bg-navy-700 text-brand-400 font-semibold px-1.5 py-0.5 rounded border border-navy-600">v1.2</span>
          </div>
          <p className="text-[11px] text-slate-400">Angel One Multi-Account</p>
        </div>
      </div>

      {/* Trading Mode Indicator Badge */}
      <div className="px-4 py-2.5">
        <div className={`rounded-md p-2 flex items-center justify-between border ${
          isPaper
            ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
            : 'bg-finRed-bg border-finRed/40 text-finRed'
        }`}>
          <div className="flex items-center gap-2 text-xs font-semibold">
            <div className={`w-2 h-2 rounded-full animate-pulse ${isPaper ? 'bg-amber-400' : 'bg-red-500'}`} />
            <span>{isPaper ? 'PAPER TRADING' : 'LIVE TRADING'}</span>
          </div>
          <span className="text-[10px] uppercase font-bold tracking-wider px-1 py-0.2 rounded bg-black/20">
            {isPaper ? 'Simulated' : 'Live'}
          </span>
        </div>
      </div>

      {/* Navigation Sections */}
      <nav className="flex-1 px-3 py-2 space-y-4 overflow-y-auto">
        {navSections.map((section) => (
          <div key={section.title} className="space-y-1">
            <div className="px-3 text-[10px] uppercase tracking-wider font-bold text-slate-500">
              {section.title}
            </div>
            {section.items.map((item) => {
              const Icon = item.icon;
              const isActive = currentTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setCurrentTab(item.id)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                    isActive
                      ? 'bg-brand-600 text-white shadow-sm shadow-brand-600/30 font-semibold'
                      : item.highlight
                      ? 'text-brand-400 hover:bg-navy-800 hover:text-white border border-brand-500/20'
                      : 'text-slate-400 hover:bg-navy-800 hover:text-slate-100'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Icon className={`w-4 h-4 ${isActive ? 'text-white' : item.highlight ? 'text-brand-400' : 'text-slate-400'}`} />
                    <span>{item.label}</span>
                  </div>
                  {item.badge !== undefined && item.badge > 0 && (
                    <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                      isActive ? 'bg-white/20 text-white' : 'bg-navy-800 text-slate-300'
                    }`}>
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Sidebar Footer with Kill Switch */}
      <div className="p-4 border-t border-navy-800 space-y-3 bg-navy-950/40">
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span className="text-[11px]">Synced Accounts:</span>
          <span className="font-semibold text-slate-200">
            {summary ? `${summary.connected_accounts}/${summary.total_accounts}` : '—'}
          </span>
        </div>

        <button
          onClick={onToggleHalt}
          className={`w-full py-2 px-3 rounded-lg flex items-center justify-center gap-2 text-xs font-bold transition-all border ${
            isHalted
              ? 'bg-red-600 hover:bg-red-700 text-white border-red-500 shadow-md shadow-red-900/50 animate-pulse'
              : 'bg-navy-800 hover:bg-navy-700 text-slate-300 border-navy-700 hover:text-white'
          }`}
        >
          <AlertTriangle className={`w-4 h-4 ${isHalted ? 'text-white' : 'text-amber-400'}`} />
          <span>{isHalted ? 'TRADING HALTED (RESUME)' : 'EMERGENCY KILL SWITCH'}</span>
        </button>
      </div>
    </aside>
  );
};
