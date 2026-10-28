import React, { useState, useMemo, useEffect } from 'react';
import {
  TrendingUp, Plus, Upload, Download, FileText,
  CheckCircle2, AlertCircle, ArrowUpRight, ArrowDownRight, Layers,
  Search, RefreshCw, ArrowUpDown, ChevronUp, ChevronDown, Trash2,
  X, ShieldCheck, Briefcase, Clock, Building2, Check, AlertTriangle,
  ExternalLink, Calendar, Users, Filter, ChevronRight, BarChart3,
  Award, Eye, FileCheck2
} from 'lucide-react';
import { IPO, Allotment, Account, CSVImportSummary } from '../types';
import { api } from '../api';
import { IPODetailsModal } from '../components/IPODetailsModal';
import { IPOApplicationModal } from '../components/IPOApplicationModal';

interface IPOTrackerViewProps {
  ipos: IPO[];
  accounts: Account[];
  onRefresh: () => void;
}

type MainTab = 'OPEN_UPCOMING' | 'YOUR_APPLICATIONS' | 'ALLOTMENT_STATUS' | 'LISTED_IPOS';
type SubFilter = 'ALL' | 'OPEN' | 'UPCOMING' | 'CLOSED' | 'MAINBOARD' | 'SME';

export const IPOTrackerView: React.FC<IPOTrackerViewProps> = ({ ipos, accounts, onRefresh }) => {
  // Navigation Tabs & Section Pagination
  const [activeTab, setActiveTab] = useState<MainTab>('OPEN_UPCOMING');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [upcomingVisibleCount, setUpcomingVisibleCount] = useState<number>(6);
  const [closedVisibleCount, setClosedVisibleCount] = useState<number>(6);

  // Applications State
  const [applications, setApplications] = useState<Allotment[]>([]);
  const [isLoadingApps, setIsLoadingApps] = useState<boolean>(false);
  const [appAccountFilter, setAppAccountFilter] = useState<string>('ALL');
  const [appStatusFilter, setAppStatusFilter] = useState<string>('ALL');

  // Selected IPO & Details Modal
  const [selectedIPOForDetails, setSelectedIPOForDetails] = useState<IPO | null>(null);
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState<boolean>(false);

  // Application Preparation Workspace Modal
  const [selectedIPOForApply, setSelectedIPOForApply] = useState<IPO | null>(null);
  const [isApplyModalOpen, setIsApplyModalOpen] = useState<boolean>(false);

  // Legacy / Allotment Management Modals
  const [selectedIPOForAllotments, setSelectedIPOForAllotments] = useState<IPO | null>(null);
  const [isAddIPOOpen, setIsAddIPOOpen] = useState(false);
  const [isCSVModalOpen, setIsCSVModalOpen] = useState(false);
  const [isManualAllotmentOpen, setIsManualAllotmentOpen] = useState(false);

  // Notifications
  const [toast, setToast] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const [isSyncingFeed, setIsSyncingFeed] = useState(false);

  // CSV file state & Results
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [isUploadingCSV, setIsUploadingCSV] = useState(false);
  const [csvResult, setCsvResult] = useState<CSVImportSummary | null>(null);

  // Form for New IPO
  const [ipoForm, setIpoForm] = useState({
    symbol: '',
    company_name: '',
    exchange: 'NSE',
    issue_price: 100,
    lot_size: 1,
    isin: '',
    is_sme: false,
    status: 'OPEN'
  });

  // Manual Allotment Form
  const [manualAllotForm, setManualAllotForm] = useState({
    account_id: accounts[0]?.id || 1,
    category: 'RETAIL',
    applied_quantity: 30,
    allotted_quantity: 30,
    acquisition_cost: 500,
    application_no: 'APP-MANUAL-01'
  });

  const showToast = (type: 'success' | 'error' | 'info', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 5000);
  };

  // Fetch all applications across all accounts
  const loadApplications = async () => {
    setIsLoadingApps(true);
    try {
      const data = await api.getAllApplications();
      setApplications(data);
    } catch (err: any) {
      console.error('Failed to load applications:', err);
    } finally {
      setIsLoadingApps(false);
    }
  };

  useEffect(() => {
    loadApplications();
  }, [ipos]);

  // Feed Synchronization
  const handleSyncFeed = async () => {
    setIsSyncingFeed(true);
    try {
      const res = await api.syncIPOFeed();
      showToast('success', `Market Feed Synchronized: ${res.created_count} new, ${res.updated_count} updated.`);
      onRefresh();
      loadApplications();
    } catch (err: any) {
      showToast('error', `Sync failed: ${err.message}`);
    } finally {
      setIsSyncingFeed(false);
    }
  };

  // Date Formatter Helper (e.g. 2026-10-29 -> 29 Oct 2026)
  const formatDisplayDate = (dStr?: string | null) => {
    if (!dStr) return 'To be announced';
    try {
      const parts = dStr.split('-');
      if (parts.length === 3) {
        const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
        return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
      }
      return dStr;
    } catch {
      return dStr;
    }
  };

  // 3 Angel One Sections: Open, Upcoming, Closed
  const openIPOs = useMemo(() => {
    return ipos.filter(ipo => {
      const isOpen = ipo.status === 'OPEN' || ipo.status === 'PRE_OPEN';
      if (!isOpen) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return ipo.symbol.toLowerCase().includes(q) || ipo.company_name.toLowerCase().includes(q) || (ipo.sector && ipo.sector.toLowerCase().includes(q));
      }
      return true;
    });
  }, [ipos, searchQuery]);

  const upcomingIPOs = useMemo(() => {
    return ipos.filter(ipo => {
      const isUpcoming = ipo.status === 'UPCOMING';
      if (!isUpcoming) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return ipo.symbol.toLowerCase().includes(q) || ipo.company_name.toLowerCase().includes(q) || (ipo.sector && ipo.sector.toLowerCase().includes(q));
      }
      return true;
    });
  }, [ipos, searchQuery]);

  const closedIPOs = useMemo(() => {
    return ipos.filter(ipo => {
      const isClosed = ipo.status === 'CLOSED' || ipo.status === 'LISTED';
      if (!isClosed) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return ipo.symbol.toLowerCase().includes(q) || ipo.company_name.toLowerCase().includes(q) || (ipo.sector && ipo.sector.toLowerCase().includes(q));
      }
      return true;
    });
  }, [ipos, searchQuery]);

  // Applications Summary Statistics
  const appMetrics = useMemo(() => {
    const total = applications.length;
    const drafts = applications.filter(a => a.preparation_status === 'READY_FOR_HANDOFF' || a.preparation_status === 'DRAFT').length;
    const confirmed = applications.filter(a => a.preparation_status === 'SUBMITTED_BROKER_CONFIRMED' || a.broker_application_status === 'CONFIRMED').length;
    const mandatePending = applications.filter(a => a.mandate_status === 'PENDING').length;
    const mandateApproved = applications.filter(a => a.mandate_status === 'APPROVED').length;
    const allotted = applications.filter(a => a.allotment_status === 'ALLOTTED' || a.status === 'ALLOTTED').length;
    const notAllotted = applications.filter(a => a.allotment_status === 'NOT_ALLOTTED' || a.status === 'NOT_ALLOTTED').length;
    const totalAmount = applications.reduce((sum, a) => sum + (a.total_amount || (a.applied_quantity * a.acquisition_cost) || 0), 0);

    return { total, drafts, confirmed, mandatePending, mandateApproved, allotted, notAllotted, totalAmount };
  }, [applications]);

  // Filtered Applications for Your Applications tab
  const filteredApplications = useMemo(() => {
    return applications.filter(a => {
      if (appAccountFilter !== 'ALL' && a.account_id !== parseInt(appAccountFilter)) return false;
      if (appStatusFilter === 'DRAFTS' && a.preparation_status !== 'READY_FOR_HANDOFF' && a.preparation_status !== 'DRAFT') return false;
      if (appStatusFilter === 'CONFIRMED' && a.preparation_status !== 'SUBMITTED_BROKER_CONFIRMED' && a.broker_application_status !== 'CONFIRMED') return false;
      if (appStatusFilter === 'MANDATE_PENDING' && a.mandate_status !== 'PENDING') return false;
      if (appStatusFilter === 'MANDATE_APPROVED' && a.mandate_status !== 'APPROVED') return false;
      if (appStatusFilter === 'ALLOTTED' && a.allotment_status !== 'ALLOTTED') return false;
      if (appStatusFilter === 'NOT_ALLOTTED' && a.allotment_status !== 'NOT_ALLOTTED') return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const mSym = a.ipo_symbol.toLowerCase().includes(q);
        const mApp = a.application_no?.toLowerCase().includes(q);
        const mAcc = a.account_nickname.toLowerCase().includes(q);
        const mCode = a.account_masked_code.toLowerCase().includes(q);
        if (!mSym && !mApp && !mAcc && !mCode) return false;
      }
      return true;
    });
  }, [applications, appAccountFilter, appStatusFilter, searchQuery]);

  // Listed IPOs
  const listedIPOs = useMemo(() => {
    return ipos.filter(i => i.status === 'LISTED');
  }, [ipos]);

  // Actions
  const handleOpenDetails = (ipo: IPO) => {
    setSelectedIPOForDetails(ipo);
    setIsDetailsModalOpen(true);
  };

  const handleOpenApply = (ipo: IPO) => {
    setSelectedIPOForApply(ipo);
    setIsApplyModalOpen(true);
  };

  const handleCSVUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedIPOForAllotments || !csvFile) return;
    setIsUploadingCSV(true);
    try {
      const summary = await api.importCSV(selectedIPOForAllotments.id, csvFile);
      setCsvResult(summary);
      showToast('success', `Imported ${summary.imported_count} allotments.`);
      onRefresh();
      loadApplications();
    } catch (err: any) {
      showToast('error', err.message);
    } finally {
      setIsUploadingCSV(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-xl shadow-xl border text-sm font-medium animate-in slide-in-from-top-2 duration-200 ${
          toast.type === 'success' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' :
          toast.type === 'error' ? 'bg-rose-50 text-rose-800 border-rose-200' :
          'bg-blue-50 text-blue-800 border-blue-200'
        }`}>
          {toast.type === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-600" />}
          {toast.type === 'error' && <AlertCircle className="w-4 h-4 text-rose-600" />}
          <span>{toast.message}</span>
          <button onClick={() => setToast(null)} className="ml-2 hover:opacity-70">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Top Banner & Telemetry Header */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">IPO Management Center</h1>
            <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
              Angel One SmartAPI Compatible
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1 flex items-center gap-2">
            <span>Primary Market Discovery, Single & Multi-Account Application Preparation, Allotment Tracking</span>
            <span>•</span>
            <span className="text-emerald-600 font-medium flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
              Live Market Feed Active
            </span>
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={handleSyncFeed}
            disabled={isSyncingFeed}
            className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-medium text-xs flex items-center gap-1.5 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSyncingFeed ? 'animate-spin text-blue-600' : ''}`} />
            {isSyncingFeed ? 'Syncing...' : 'Sync Market Feed'}
          </button>

          <button
            onClick={() => setIsAddIPOOpen(true)}
            className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium text-xs flex items-center gap-1.5 shadow-sm shadow-blue-500/20 transition-all"
          >
            <Plus className="w-3.5 h-3.5" />
            Register Custom Issue
          </button>
        </div>
      </div>

      {/* Main Navigation Tabs */}
      <div className="flex border-b border-slate-200 bg-white rounded-xl p-1 shadow-sm gap-1 overflow-x-auto text-sm font-semibold text-slate-600 no-scrollbar">
        {[
          { id: 'OPEN_UPCOMING', label: 'Open & Upcoming', count: ipos.filter(i => i.status === 'OPEN' || i.status === 'UPCOMING' || i.status === 'PRE_OPEN').length },
          { id: 'YOUR_APPLICATIONS', label: 'Your Applications', count: applications.length },
          { id: 'ALLOTMENT_STATUS', label: 'Allotment Status', count: applications.filter(a => a.allotment_status === 'ALLOTTED' || a.allotted_quantity > 0).length },
          { id: 'LISTED_IPOS', label: 'Listed IPOs', count: listedIPOs.length },
        ].map(tab => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => {
                setActiveTab(tab.id as MainTab);
                setSearchQuery('');
              }}
              className={`py-2.5 px-4 rounded-lg flex items-center gap-2 whitespace-nowrap transition-all ${
                active
                  ? 'bg-blue-600 text-white shadow-sm font-bold'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              <span>{tab.label}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full ${
                active ? 'bg-blue-700/80 text-white' : 'bg-slate-100 text-slate-600'
              }`}>
                {tab.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: OPEN & UPCOMING IPO DISCOVERY (ANGEL ONE 3-SECTION ARCHITECTURE) */}
      {/* ========================================================================= */}
      {activeTab === 'OPEN_UPCOMING' && (
        <div className="space-y-8">
          {/* Search Toolbar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-3.5 rounded-xl border border-slate-200/80 shadow-sm">
            <div className="text-xs font-semibold text-slate-700 flex items-center gap-2">
              <span>All IPO Issues</span>
              <span className="text-xs font-normal text-slate-500">
                ({openIPOs.length + upcomingIPOs.length + closedIPOs.length} total issues available)
              </span>
            </div>

            {/* Search Input */}
            <div className="relative min-w-[240px] sm:w-80">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search company, symbol, sector..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full text-xs pl-8 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          {/* SECTION 1: OPEN IPOS (All types: Mainboard & SME together) */}
          <section className="space-y-4">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-slate-900">Open IPOs</h2>
              <span className="min-w-5 h-5 px-1.5 rounded-full bg-rose-500 text-white text-[11px] font-bold flex items-center justify-center">
                {openIPOs.length}
              </span>
            </div>

            {openIPOs.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {openIPOs.map(ipo => {
                  return (
                    <div
                      key={ipo.id}
                      className="bg-white rounded-xl border border-slate-200/90 shadow-sm hover:shadow-md transition-all p-4 flex flex-col justify-between group cursor-pointer"
                      onClick={() => handleOpenDetails(ipo)}
                    >
                      <div>
                        {/* Header: Logo + Name + Category + Chevron */}
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-lg bg-slate-100 border border-slate-200 text-slate-700 font-bold flex items-center justify-center text-xs shrink-0">
                              {ipo.symbol.substring(0, 3)}
                            </div>
                            <div>
                              <h3 className="font-bold text-slate-900 text-xs leading-snug group-hover:text-blue-600 transition-colors line-clamp-1">
                                {ipo.company_name}
                              </h3>
                              <span className="inline-block mt-0.5 text-[10px] font-bold px-1.5 py-0.2 rounded bg-purple-50 text-purple-700 border border-purple-200/60 uppercase">
                                {ipo.is_sme ? 'SME' : 'MAINBOARD'}
                              </span>
                            </div>
                          </div>
                          <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-slate-600 shrink-0 mt-1" />
                        </div>

                        {/* Metrics Row: Closes On + Subscription + Apply Button */}
                        <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                          <div>
                            <span className="text-[11px] text-slate-400 block">Closes On</span>
                            <span className="font-semibold text-slate-800 text-xs mt-0.5 block">
                              {formatDisplayDate(ipo.bidding_end_date)}
                            </span>
                          </div>

                          <div className="text-center">
                            <span className="text-[11px] text-slate-400 block">Subscription</span>
                            <span className="font-semibold text-slate-900 text-xs mt-0.5 block font-mono">
                              {ipo.subscription_rate || '-'}
                            </span>
                          </div>

                          <div onClick={e => e.stopPropagation()}>
                            <button
                              type="button"
                              onClick={() => handleOpenApply(ipo)}
                              className="px-4 py-1.5 border border-blue-600 hover:bg-blue-600 hover:text-white text-blue-600 font-bold text-xs rounded-lg transition-colors uppercase tracking-wider"
                            >
                              APPLY
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="bg-white rounded-xl p-8 text-center border border-dashed border-slate-200 text-xs text-slate-400">
                No active IPOs open for bidding currently.
              </div>
            )}
          </section>

          {/* Need Help Banner */}
          <div className="bg-gradient-to-r from-blue-50/60 to-indigo-50/40 border border-blue-100 rounded-xl p-3.5 flex items-center justify-between text-xs">
            <span className="text-slate-700 font-medium">Need Help? Learn more about IPO application and UPI mandate authorization</span>
            <span className="text-blue-600 font-bold flex items-center gap-1 cursor-pointer hover:underline">
              View Guide <ChevronRight className="w-3.5 h-3.5" />
            </span>
          </div>

          {/* SECTION 2: UPCOMING IPOS */}
          <section className="space-y-4">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-slate-900">Upcoming IPOs</h2>
              <span className="min-w-5 h-5 px-1.5 rounded-full bg-rose-500 text-white text-[11px] font-bold flex items-center justify-center">
                {upcomingIPOs.length}
              </span>
            </div>

            {upcomingIPOs.length > 0 ? (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {upcomingIPOs.slice(0, upcomingVisibleCount).map(ipo => {
                    const priceRange = (ipo.min_price && ipo.max_price)
                      ? (ipo.min_price === ipo.max_price ? `₹${ipo.max_price.toFixed(2)}` : `₹${ipo.min_price.toFixed(2)} - ₹${ipo.max_price.toFixed(2)}`)
                      : '₹0.00 - ₹0.00';

                    return (
                      <div
                        key={ipo.id}
                        className="bg-white rounded-xl border border-slate-200/90 shadow-sm hover:shadow-md transition-all p-4 flex flex-col justify-between group cursor-pointer"
                        onClick={() => handleOpenDetails(ipo)}
                      >
                        <div>
                          {/* Header: Logo + Name + Category + Chevron */}
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-lg bg-slate-100 border border-slate-200 text-slate-700 font-bold flex items-center justify-center text-xs shrink-0">
                                {ipo.symbol.substring(0, 3)}
                              </div>
                              <div>
                                <h3 className="font-bold text-slate-900 text-xs leading-snug group-hover:text-blue-600 transition-colors line-clamp-1">
                                  {ipo.company_name}
                                </h3>
                                <span className="inline-block mt-0.5 text-[10px] font-bold px-1.5 py-0.2 rounded bg-purple-50 text-purple-700 border border-purple-200/60 uppercase">
                                  {ipo.is_sme ? 'SME' : 'MAINBOARD'}
                                </span>
                              </div>
                            </div>
                            <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-slate-600 shrink-0 mt-1" />
                          </div>

                          {/* Metrics Row: Offer Starts On + Bid Price Range */}
                          <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                            <div>
                              <span className="text-[11px] text-slate-400 block">Offer Starts On</span>
                              <span className="font-semibold text-slate-800 text-xs mt-0.5 block">
                                {formatDisplayDate(ipo.bidding_start_date)}
                              </span>
                            </div>

                            <div className="text-right">
                              <span className="text-[11px] text-slate-400 block">Bid Price Range</span>
                              <span className="font-semibold text-slate-900 text-xs mt-0.5 block font-mono">
                                {priceRange}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {upcomingVisibleCount < upcomingIPOs.length && (
                  <div className="flex justify-center mt-4">
                    <button
                      type="button"
                      onClick={() => setUpcomingVisibleCount(prev => prev + 10)}
                      className="px-6 py-2 border border-blue-600 text-blue-600 hover:bg-blue-50 font-bold text-xs rounded-xl flex items-center gap-1.5 transition-colors uppercase tracking-wider shadow-sm"
                    >
                      VIEW MORE
                      <ChevronDown className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className="bg-white rounded-xl p-8 text-center border border-dashed border-slate-200 text-xs text-slate-400">
                No upcoming IPO announcements at this time.
              </div>
            )}
          </section>

          {/* SECTION 3: CLOSED IPOS */}
          <section className="space-y-4">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-slate-900">Closed IPOs</h2>
              <span className="min-w-6 h-5 px-1.5 rounded-full bg-rose-500 text-white text-[11px] font-bold flex items-center justify-center">
                {closedIPOs.length}
              </span>
            </div>

            {closedIPOs.length > 0 ? (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {closedIPOs.slice(0, closedVisibleCount).map(ipo => {
                    return (
                      <div
                        key={ipo.id}
                        className="bg-white rounded-xl border border-slate-200/90 shadow-sm hover:shadow-md transition-all p-4 flex flex-col justify-between group cursor-pointer"
                        onClick={() => handleOpenDetails(ipo)}
                      >
                        <div>
                          {/* Header: Logo + Name + Category + Chevron */}
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-lg bg-slate-100 border border-slate-200 text-slate-700 font-bold flex items-center justify-center text-xs shrink-0">
                                {ipo.symbol.substring(0, 3)}
                              </div>
                              <div>
                                <h3 className="font-bold text-slate-900 text-xs leading-snug group-hover:text-blue-600 transition-colors line-clamp-1">
                                  {ipo.company_name}
                                </h3>
                                <span className="inline-block mt-0.5 text-[10px] font-bold px-1.5 py-0.2 rounded bg-purple-50 text-purple-700 border border-purple-200/60 uppercase">
                                  {ipo.is_sme ? 'SME' : 'MAINBOARD'}
                                </span>
                              </div>
                            </div>
                            <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-slate-600 shrink-0 mt-1" />
                          </div>

                          {/* Metrics Row: Listing Date + Listing Gains */}
                          <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                            <div>
                              <span className="text-[11px] text-slate-400 block">Listing Date</span>
                              <span className="font-semibold text-slate-800 text-xs mt-0.5 block">
                                {formatDisplayDate(ipo.listing_date || ipo.bidding_end_date)}
                              </span>
                            </div>

                            <div className="text-right">
                              <span className="text-[11px] text-slate-400 block">Listing Gains</span>
                              <span className={`font-bold text-xs mt-0.5 block font-mono ${
                                ipo.listing_gain && ipo.listing_gain > 0 ? 'text-emerald-600' : 'text-slate-600'
                              }`}>
                                {ipo.listing_gain ? `${ipo.listing_gain.toFixed(2)}% ▲` : '-'}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {closedVisibleCount < closedIPOs.length && (
                  <div className="flex justify-center mt-4">
                    <button
                      type="button"
                      onClick={() => setClosedVisibleCount(prev => prev + 10)}
                      className="px-6 py-2 border border-blue-600 text-blue-600 hover:bg-blue-50 font-bold text-xs rounded-xl flex items-center gap-1.5 transition-colors uppercase tracking-wider shadow-sm"
                    >
                      VIEW MORE
                      <ChevronDown className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className="bg-white rounded-xl p-8 text-center border border-dashed border-slate-200 text-xs text-slate-400">
                No closed IPO records found.
              </div>
            )}
          </section>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: YOUR APPLICATIONS (ANGEL ONE STYLE) */}
      {/* ========================================================================= */}
      {activeTab === 'YOUR_APPLICATIONS' && (
        <div className="space-y-5">
          {/* KPI Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
              <span className="text-[11px] font-semibold text-slate-400 uppercase">Total Bids</span>
              <div className="text-xl font-bold text-slate-900 mt-1">{appMetrics.total}</div>
              <span className="text-[10px] text-slate-500">₹{appMetrics.totalAmount.toLocaleString('en-IN')}</span>
            </div>

            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
              <span className="text-[11px] font-semibold text-blue-500 uppercase">Ready for Handoff</span>
              <div className="text-xl font-bold text-blue-600 mt-1">{appMetrics.drafts}</div>
              <span className="text-[10px] text-slate-500">Drafts prepared</span>
            </div>

            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
              <span className="text-[11px] font-semibold text-emerald-500 uppercase">Broker Confirmed</span>
              <div className="text-xl font-bold text-emerald-600 mt-1">{appMetrics.confirmed}</div>
              <span className="text-[10px] text-slate-500">Submitted bids</span>
            </div>

            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
              <span className="text-[11px] font-semibold text-amber-500 uppercase">Mandate Pending</span>
              <div className="text-xl font-bold text-amber-600 mt-1">{appMetrics.mandatePending}</div>
              <span className="text-[10px] text-slate-500">Awaiting UPI approval</span>
            </div>

            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
              <span className="text-[11px] font-semibold text-purple-500 uppercase">Allotted</span>
              <div className="text-xl font-bold text-purple-600 mt-1">{appMetrics.allotted}</div>
              <span className="text-[10px] text-slate-500">Successful bids</span>
            </div>

            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
              <span className="text-[11px] font-semibold text-rose-500 uppercase">Not Allotted</span>
              <div className="text-xl font-bold text-rose-600 mt-1">{appMetrics.notAllotted}</div>
              <span className="text-[10px] text-slate-500">Refund completed</span>
            </div>
          </div>

          {/* Filters Bar */}
          <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={appAccountFilter}
                onChange={e => setAppAccountFilter(e.target.value)}
                className="text-xs p-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-700 font-medium"
              >
                <option value="ALL">All Demat Accounts</option>
                {accounts.map(acc => (
                  <option key={acc.id} value={acc.id.toString()}>{acc.nickname} ({acc.masked_client_code})</option>
                ))}
              </select>

              <select
                value={appStatusFilter}
                onChange={e => setAppStatusFilter(e.target.value)}
                className="text-xs p-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-700 font-medium"
              >
                <option value="ALL">All Application States</option>
                <option value="DRAFTS">Ready for Handoff / Drafts</option>
                <option value="CONFIRMED">Broker Confirmed</option>
                <option value="MANDATE_PENDING">Mandate Pending</option>
                <option value="MANDATE_APPROVED">Mandate Approved</option>
                <option value="ALLOTTED">Allotted Only</option>
                <option value="NOT_ALLOTTED">Not Allotted</option>
              </select>
            </div>

            <div className="relative min-w-[220px]">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search symbol, application ref..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full text-xs pl-8 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none"
              />
            </div>
          </div>

          {/* Applications Table */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            {isLoadingApps ? (
              <div className="p-12 text-center text-slate-400 text-xs">Loading application records...</div>
            ) : filteredApplications.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase font-semibold">
                    <tr>
                      <th className="px-4 py-3">Company & Symbol</th>
                      <th className="px-4 py-3">Target Demat Account</th>
                      <th className="px-4 py-3">Application Ref</th>
                      <th className="px-4 py-3">Category & Bids</th>
                      <th className="px-4 py-3 text-right">Amount</th>
                      <th className="px-4 py-3">Preparation Status</th>
                      <th className="px-4 py-3">Mandate Status</th>
                      <th className="px-4 py-3">Allotment</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredApplications.map(app => {
                      const amount = app.total_amount || (app.applied_quantity * app.acquisition_cost);
                      return (
                        <tr key={app.id} className="hover:bg-slate-50/80 transition-colors">
                          <td className="px-4 py-3 font-semibold text-slate-900">
                            <div>{app.ipo_symbol}</div>
                            <span className="text-[10px] text-slate-400 font-normal">NSE / BSE</span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="font-semibold text-slate-800">{app.account_nickname}</div>
                            <div className="text-[10px] text-slate-400 font-mono">{app.account_masked_code}</div>
                          </td>
                          <td className="px-4 py-3 font-mono font-medium text-slate-700">
                            {app.application_no || <span className="text-slate-400 italic">Pending Handoff</span>}
                          </td>
                          <td className="px-4 py-3">
                            <span className="font-semibold text-slate-800">{app.category || 'RETAIL'}</span>
                            <div className="text-slate-500 text-[11px]">{app.lots || 1} Lot ({app.applied_quantity} Sh)</div>
                          </td>
                          <td className="px-4 py-3 text-right font-mono font-bold text-slate-900">
                            ₹{amount.toLocaleString('en-IN')}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                              app.preparation_status === 'SUBMITTED_BROKER_CONFIRMED'
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-blue-100 text-blue-800'
                            }`}>
                              {app.preparation_status === 'SUBMITTED_BROKER_CONFIRMED' ? 'Broker Confirmed' : 'Ready for Handoff'}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                              app.mandate_status === 'APPROVED' ? 'bg-emerald-100 text-emerald-800' :
                              app.mandate_status === 'REJECTED' ? 'bg-rose-100 text-rose-800' :
                              'bg-amber-100 text-amber-800'
                            }`}>
                              {app.mandate_status || 'PENDING'}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                              app.allotment_status === 'ALLOTTED' ? 'bg-purple-100 text-purple-800 font-bold' :
                              app.allotment_status === 'NOT_ALLOTTED' ? 'bg-slate-100 text-slate-600' :
                              'bg-slate-100 text-slate-500'
                            }`}>
                              {app.allotment_status || 'PENDING'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <a
                              href="https://trade.angelone.in/ipo"
                              target="_blank"
                              rel="noreferrer"
                              className="px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 font-semibold rounded-lg text-[11px] inline-flex items-center gap-1"
                            >
                              Handoff
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-12 text-center text-slate-400 text-xs">
                No application records found. Go to <strong>Open & Upcoming</strong> and prepare your first bid.
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: ALLOTMENT STATUS & REGISTRAR RECONCILIATION */}
      {/* ========================================================================= */}
      {activeTab === 'ALLOTMENT_STATUS' && (
        <div className="space-y-5">
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="text-base font-bold text-slate-900">Registrar Allotment Reconciliation</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Import CSV registers from Link Intime / KFintech or verify holdings synchronization.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setSelectedIPOForAllotments(ipos[0] || null);
                  setIsCSVModalOpen(true);
                }}
                className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors"
              >
                <Upload className="w-3.5 h-3.5" />
                Import Registrar CSV
              </button>

              <button
                onClick={() => {
                  setSelectedIPOForAllotments(ipos[0] || null);
                  setIsManualAllotmentOpen(true);
                }}
                className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-sm shadow-blue-500/20 transition-all"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Allotment Entry
              </button>
            </div>
          </div>

          {/* Allotment Records */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase font-semibold">
                  <tr>
                    <th className="px-4 py-3">IPO Issue</th>
                    <th className="px-4 py-3">Account</th>
                    <th className="px-4 py-3">Application No</th>
                    <th className="px-4 py-3 text-right">Allotted Qty</th>
                    <th className="px-4 py-3 text-right">Issue Cost</th>
                    <th className="px-4 py-3 text-right">Current LTP</th>
                    <th className="px-4 py-3 text-right">Market Value</th>
                    <th className="px-4 py-3 text-right">Unrealized P&L</th>
                    <th className="px-4 py-3">Demat Credit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {applications.filter(a => a.allotted_quantity > 0 || a.allotment_status === 'ALLOTTED').map(a => {
                    return (
                      <tr key={a.id} className="hover:bg-slate-50/80">
                        <td className="px-4 py-3 font-bold text-slate-900">{a.ipo_symbol}</td>
                        <td className="px-4 py-3">
                          <span className="font-semibold text-slate-800">{a.account_nickname}</span>
                          <div className="text-[10px] text-slate-400 font-mono">{a.account_masked_code}</div>
                        </td>
                        <td className="px-4 py-3 font-mono">{a.application_no || 'MANUAL-ALLOT'}</td>
                        <td className="px-4 py-3 text-right font-bold text-slate-900">{a.allotted_quantity}</td>
                        <td className="px-4 py-3 text-right font-mono">₹{a.acquisition_cost.toFixed(2)}</td>
                        <td className="px-4 py-3 text-right font-mono font-semibold">₹{(a.current_ltp || a.acquisition_cost).toFixed(2)}</td>
                        <td className="px-4 py-3 text-right font-mono font-bold text-slate-900">
                          ₹{a.market_value.toLocaleString('en-IN')}
                        </td>
                        <td className={`px-4 py-3 text-right font-mono font-bold ${
                          a.unrealized_pnl >= 0 ? 'text-emerald-600' : 'text-rose-600'
                        }`}>
                          {a.unrealized_pnl >= 0 ? '+' : ''}₹{a.unrealized_pnl.toLocaleString('en-IN')} ({a.pnl_percentage}%)
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                            a.demat_verified ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
                          }`}>
                            {a.demat_verified ? 'Demat Credited' : 'Pending Verification'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 4: LISTED IPOS TRACKING */}
      {/* ========================================================================= */}
      {activeTab === 'LISTED_IPOS' && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {listedIPOs.map(ipo => {
              const listingGain = ipo.listing_gain ?? (
                ipo.listing_price && ipo.issue_price
                  ? ((ipo.listing_price - ipo.issue_price) / ipo.issue_price) * 100
                  : 0
              );
              const currentReturn = (
                ipo.current_ltp && ipo.issue_price
                  ? ((ipo.current_ltp - ipo.issue_price) / ipo.issue_price) * 100
                  : 0
              );

              return (
                <div key={ipo.id} className="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-5 space-y-4">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-xl bg-purple-600 text-white font-bold flex items-center justify-center text-sm shadow-sm shadow-purple-500/20">
                        {ipo.symbol.substring(0, 3)}
                      </div>
                      <div>
                        <h4 className="font-bold text-slate-900 text-sm">{ipo.company_name}</h4>
                        <div className="text-[11px] text-slate-400 font-mono mt-0.5">Listed: {ipo.listing_date || 'Recent'}</div>
                      </div>
                    </div>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-purple-50 text-purple-700 border border-purple-200">
                      Listed
                    </span>
                  </div>

                  {/* Pricing Matrix */}
                  <div className="grid grid-cols-3 gap-2 bg-slate-50 p-3 rounded-xl border border-slate-100 text-xs text-center">
                    <div>
                      <span className="text-[10px] text-slate-400">Issue Price</span>
                      <div className="font-bold text-slate-900 mt-0.5 font-mono">₹{ipo.issue_price.toFixed(2)}</div>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400">Listing Price</span>
                      <div className="font-bold text-slate-900 mt-0.5 font-mono">₹{(ipo.listing_price || ipo.issue_price).toFixed(2)}</div>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400">Current LTP</span>
                      <div className="font-bold text-blue-700 mt-0.5 font-mono">₹{(ipo.current_ltp || ipo.issue_price).toFixed(2)}</div>
                    </div>
                  </div>

                  {/* Performance Badges */}
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="p-2.5 rounded-xl border bg-slate-50 flex items-center justify-between">
                      <span className="text-[11px] text-slate-500">Listing Gain:</span>
                      <span className={`font-bold font-mono ${listingGain >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {listingGain >= 0 ? '+' : ''}{listingGain.toFixed(1)}%
                      </span>
                    </div>

                    <div className="p-2.5 rounded-xl border bg-slate-50 flex items-center justify-between">
                      <span className="text-[11px] text-slate-500">Total Return:</span>
                      <span className={`font-bold font-mono ${currentReturn >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {currentReturn >= 0 ? '+' : ''}{currentReturn.toFixed(1)}%
                      </span>
                    </div>
                  </div>

                  <button
                    onClick={() => handleOpenDetails(ipo)}
                    className="w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs rounded-xl transition-colors"
                  >
                    View Comprehensive Financials & Allotments
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODALS */}
      {/* ========================================================================= */}

      {/* 1. IPODetailsModal */}
      <IPODetailsModal
        ipo={selectedIPOForDetails}
        isOpen={isDetailsModalOpen}
        onClose={() => setIsDetailsModalOpen(false)}
        onApply={ipo => handleOpenApply(ipo)}
      />

      {/* 2. IPOApplicationModal (Single & Multi-Account Preparation & Handoff) */}
      <IPOApplicationModal
        ipo={selectedIPOForApply}
        accounts={accounts}
        isOpen={isApplyModalOpen}
        onClose={() => setIsApplyModalOpen(false)}
        onSuccess={msg => {
          showToast('success', msg);
          loadApplications();
        }}
      />

      {/* 3. Add Custom IPO Modal */}
      {isAddIPOOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-lg p-6 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-bold text-slate-900">Register Custom IPO Issue</h3>
              <button onClick={() => setIsAddIPOOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={async (e) => {
              e.preventDefault();
              try {
                await api.createIPO(ipoForm as any);
                setIsAddIPOOpen(false);
                showToast('success', `Registered ${ipoForm.symbol}`);
                onRefresh();
              } catch (err: any) {
                showToast('error', err.message);
              }
            }} className="space-y-3 text-xs">
              <div>
                <label className="font-semibold block mb-1">Symbol</label>
                <input
                  type="text"
                  required
                  value={ipoForm.symbol}
                  onChange={e => setIpoForm({ ...ipoForm, symbol: e.target.value.toUpperCase() })}
                  className="w-full p-2 border rounded-lg uppercase"
                />
              </div>
              <div>
                <label className="font-semibold block mb-1">Company Name</label>
                <input
                  type="text"
                  required
                  value={ipoForm.company_name}
                  onChange={e => setIpoForm({ ...ipoForm, company_name: e.target.value })}
                  className="w-full p-2 border rounded-lg"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="font-semibold block mb-1">Issue Price (₹)</label>
                  <input
                    type="number"
                    required
                    value={ipoForm.issue_price}
                    onChange={e => setIpoForm({ ...ipoForm, issue_price: parseFloat(e.target.value) || 0 })}
                    className="w-full p-2 border rounded-lg"
                  />
                </div>
                <div>
                  <label className="font-semibold block mb-1">Lot Size</label>
                  <input
                    type="number"
                    required
                    value={ipoForm.lot_size}
                    onChange={e => setIpoForm({ ...ipoForm, lot_size: parseInt(e.target.value) || 1 })}
                    className="w-full p-2 border rounded-lg"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  id="sme-check"
                  checked={ipoForm.is_sme}
                  onChange={e => setIpoForm({ ...ipoForm, is_sme: e.target.checked })}
                />
                <label htmlFor="sme-check" className="font-medium text-slate-700">SME Issue</label>
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t">
                <button
                  type="button"
                  onClick={() => setIsAddIPOOpen(false)}
                  className="px-4 py-2 border rounded-lg text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg font-bold"
                >
                  Register Issue
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 4. CSV Import Modal */}
      {isCSVModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-bold text-slate-900">Import Registrar CSV Register</h3>
              <button onClick={() => setIsCSVModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCSVUpload} className="space-y-4 text-xs">
              <div>
                <label className="font-semibold block mb-1">Select Target IPO</label>
                <select
                  value={selectedIPOForAllotments?.id || ipos[0]?.id}
                  onChange={e => setSelectedIPOForAllotments(ipos.find(i => i.id === parseInt(e.target.value)) || null)}
                  className="w-full p-2 border rounded-lg bg-slate-50"
                >
                  {ipos.map(i => (
                    <option key={i.id} value={i.id}>{i.symbol} - {i.company_name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="font-semibold block mb-1">CSV File (client_code, application_no, allotted_qty, cost)</label>
                <input
                  type="file"
                  accept=".csv"
                  onChange={e => setCsvFile(e.target.files?.[0] || null)}
                  className="w-full p-2 border rounded-lg bg-slate-50"
                />
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t">
                <button
                  type="button"
                  onClick={() => setIsCSVModalOpen(false)}
                  className="px-4 py-2 border rounded-lg text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!csvFile || isUploadingCSV}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg font-bold"
                >
                  {isUploadingCSV ? 'Importing...' : 'Upload & Reconcile'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 5. Manual Allotment Modal */}
      {isManualAllotmentOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-bold text-slate-900">Add Manual Allotment Entry</h3>
              <button onClick={() => setIsManualAllotmentOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={async (e) => {
              e.preventDefault();
              if (!selectedIPOForAllotments) return;
              try {
                await api.createAllotment(selectedIPOForAllotments.id, manualAllotForm);
                setIsManualAllotmentOpen(false);
                showToast('success', 'Allotment entry saved.');
                loadApplications();
              } catch (err: any) {
                showToast('error', err.message);
              }
            }} className="space-y-3 text-xs">
              <div>
                <label className="font-semibold block mb-1">Target Account</label>
                <select
                  value={manualAllotForm.account_id}
                  onChange={e => setManualAllotForm({ ...manualAllotForm, account_id: parseInt(e.target.value) })}
                  className="w-full p-2 border rounded-lg bg-slate-50"
                >
                  {accounts.map(a => (
                    <option key={a.id} value={a.id}>{a.nickname} ({a.masked_client_code})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="font-semibold block mb-1">Target IPO</label>
                <select
                  value={selectedIPOForAllotments?.id || ipos[0]?.id}
                  onChange={e => setSelectedIPOForAllotments(ipos.find(i => i.id === parseInt(e.target.value)) || null)}
                  className="w-full p-2 border rounded-lg bg-slate-50"
                >
                  {ipos.map(i => (
                    <option key={i.id} value={i.id}>{i.symbol} - {i.company_name}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="font-semibold block mb-1">Allotted Shares</label>
                  <input
                    type="number"
                    value={manualAllotForm.allotted_quantity}
                    onChange={e => setManualAllotForm({ ...manualAllotForm, allotted_quantity: parseInt(e.target.value) || 0 })}
                    className="w-full p-2 border rounded-lg"
                  />
                </div>
                <div>
                  <label className="font-semibold block mb-1">Acquisition Cost (₹)</label>
                  <input
                    type="number"
                    value={manualAllotForm.acquisition_cost}
                    onChange={e => setManualAllotForm({ ...manualAllotForm, acquisition_cost: parseFloat(e.target.value) || 0 })}
                    className="w-full p-2 border rounded-lg"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t">
                <button
                  type="button"
                  onClick={() => setIsManualAllotmentOpen(false)}
                  className="px-4 py-2 border rounded-lg text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg font-bold"
                >
                  Save Entry
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
