import React, { useState, useMemo } from 'react';
import {
  TrendingUp, Plus, Upload, Download, FileText,
  CheckCircle2, AlertCircle, ArrowUpRight, ArrowDownRight, Layers,
  Search, RefreshCw, ArrowUpDown, ChevronUp, ChevronDown, Trash2,
  X, ShieldCheck, Briefcase, Clock, Building2, Check, AlertTriangle
} from 'lucide-react';
import { IPO, Allotment, Account, CSVImportSummary, IPOPrepareApplicationResponse } from '../types';
import { api } from '../api';

interface IPOTrackerViewProps {
  ipos: IPO[];
  accounts: Account[];
  onRefresh: () => void;
}

type SortField = 'symbol' | 'issue_price' | 'lot_size' | 'current_ltp' | 'gain_pct' | 'total_allotted_shares' | 'estimated_current_value' | 'estimated_pnl';

export const IPOTrackerView: React.FC<IPOTrackerViewProps> = ({ ipos, accounts, onRefresh }) => {
  // Navigation & Sub-tabs
  const [activeTab, setActiveTab] = useState<'CATALOG' | 'WORKSPACE'>('CATALOG');
  const [selectedStatus, setSelectedStatus] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Sorting
  const [sortField, setSortField] = useState<SortField>('symbol');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  // Pagination
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(10);

  // Selected IPO & Allotments Drawer
  const [selectedIPO, setSelectedIPO] = useState<IPO | null>(null);
  const [allotments, setAllotments] = useState<Allotment[]>([]);
  const [isLoadingAllotments, setIsLoadingAllotments] = useState(false);

  // Notifications (replacing alert())
  const [toast, setToast] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);

  // Feed Synchronization State
  const [isSyncingFeed, setIsSyncingFeed] = useState(false);

  // Modals
  const [isAddIPOOpen, setIsAddIPOOpen] = useState(false);
  const [isCSVModalOpen, setIsCSVModalOpen] = useState(false);
  const [isManualAllotmentOpen, setIsManualAllotmentOpen] = useState(false);

  // New IPO Form
  const [ipoForm, setIpoForm] = useState<{
    symbol: string;
    company_name: string;
    exchange: string;
    issue_price: number;
    min_price?: number;
    max_price?: number;
    lot_size: number;
    bidding_start_date?: string;
    bidding_end_date?: string;
    allotment_date?: string;
    listing_date?: string;
    isin: string;
    symbol_token: string;
    is_sme: boolean;
    status: 'UPCOMING' | 'OPEN' | 'PRE_OPEN' | 'LISTED' | 'CLOSED';
  }>({
    symbol: '',
    company_name: '',
    exchange: 'NSE',
    issue_price: 100,
    lot_size: 1,
    isin: '',
    symbol_token: '',
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

  // CSV file state & Results
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [isUploadingCSV, setIsUploadingCSV] = useState(false);
  const [csvResult, setCsvResult] = useState<CSVImportSummary | null>(null);

  // Application Workspace State
  const [workspaceIPOId, setWorkspaceIPOId] = useState<number>(ipos[0]?.id || 1);
  const [workspaceAccountIds, setWorkspaceAccountIds] = useState<number[]>(accounts.map(a => a.id));
  const [workspaceLots, setWorkspaceLots] = useState<number>(1);
  const [workspaceCategory, setWorkspaceCategory] = useState<string>('RETAIL');
  const [workspacePrepResult, setWorkspacePrepResult] = useState<IPOPrepareApplicationResponse | null>(null);
  const [isPreparingWorkspace, setIsPreparingWorkspace] = useState(false);

  const statuses = useMemo(() => [
    { id: 'ALL', label: 'All Issues', count: ipos.length },
    { id: 'OPEN', label: 'Open Bidding', count: ipos.filter(i => i.status === 'OPEN' || i.status === 'PRE_OPEN').length },
    { id: 'UPCOMING', label: 'Upcoming', count: ipos.filter(i => i.status === 'UPCOMING').length },
    { id: 'CLOSED', label: 'Closed', count: ipos.filter(i => i.status === 'CLOSED').length },
    { id: 'LISTED', label: 'Listed & Trading', count: ipos.filter(i => i.status === 'LISTED').length },
    { id: 'SME', label: 'SME Only', count: ipos.filter(i => i.is_sme).length },
  ], [ipos]);

  const showToast = (type: 'success' | 'error' | 'info', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 6000);
  };

  // Filter and Sort IPOs
  const filteredAndSortedIPOs = useMemo(() => {
    return ipos
      .filter((ipo) => {
        // Status filter
        if (selectedStatus === 'SME') {
          if (!ipo.is_sme) return false;
        } else if (selectedStatus === 'OPEN') {
          if (ipo.status !== 'OPEN' && ipo.status !== 'PRE_OPEN') return false;
        } else if (selectedStatus !== 'ALL') {
          if (ipo.status !== selectedStatus) return false;
        }

        // Search query
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          const matchSym = ipo.symbol.toLowerCase().includes(q);
          const matchName = ipo.company_name.toLowerCase().includes(q);
          const matchIsin = ipo.isin?.toLowerCase().includes(q);
          if (!matchSym && !matchName && !matchIsin) return false;
        }

        return true;
      })
      .sort((a, b) => {
        let valA: any;
        let valB: any;

        if (sortField === 'gain_pct') {
          valA = a.issue_price > 0 && a.current_ltp ? ((a.current_ltp - a.issue_price) / a.issue_price) * 100 : 0;
          valB = b.issue_price > 0 && b.current_ltp ? ((b.current_ltp - b.issue_price) / b.issue_price) * 100 : 0;
        } else {
          valA = (a as any)[sortField];
          valB = (b as any)[sortField];
        }

        if (valA === undefined || valA === null) valA = 0;
        if (valB === undefined || valB === null) valB = 0;

        if (typeof valA === 'string') {
          return sortDirection === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        }
        return sortDirection === 'asc' ? valA - valB : valB - valA;
      });
  }, [ipos, selectedStatus, searchQuery, sortField, sortDirection]);

  // Paginated Slices
  const totalPages = Math.ceil(filteredAndSortedIPOs.length / pageSize) || 1;
  const paginatedIPOs = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredAndSortedIPOs.slice(start, start + pageSize);
  }, [filteredAndSortedIPOs, currentPage, pageSize]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const handleOpenAllotments = async (ipo: IPO) => {
    setSelectedIPO(ipo);
    setIsLoadingAllotments(true);
    try {
      const data = await api.getIPOAllotments(ipo.id);
      setAllotments(data);
    } catch (err: any) {
      showToast('error', `Error loading allotments: ${err.message}`);
    } finally {
      setIsLoadingAllotments(false);
    }
  };

  const handleCreateIPO = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ipoForm.symbol.trim()) {
      showToast('error', 'IPO symbol is mandatory.');
      return;
    }
    try {
      await api.createIPO(ipoForm);
      setIsAddIPOOpen(false);
      showToast('success', `IPO ${ipoForm.symbol.toUpperCase()} successfully registered in catalog.`);
      onRefresh();
    } catch (err: any) {
      showToast('error', `Failed to register IPO: ${err.message}`);
    }
  };

  const handleDeleteIPO = async (ipo: IPO) => {
    if (!window.confirm(`Are you sure you want to remove ${ipo.symbol} and all its allotment records from the catalog?`)) {
      return;
    }
    try {
      await api.deleteIPO(ipo.id);
      if (selectedIPO?.id === ipo.id) setSelectedIPO(null);
      showToast('success', `IPO ${ipo.symbol} removed.`);
      onRefresh();
    } catch (err: any) {
      showToast('error', `Delete failed: ${err.message}`);
    }
  };

  const handleCreateManualAllotment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedIPO) return;
    try {
      await api.createAllotment(selectedIPO.id, manualAllotForm);
      setIsManualAllotmentOpen(false);
      handleOpenAllotments(selectedIPO);
      showToast('success', 'Allotment entry saved.');
      onRefresh();
    } catch (err: any) {
      showToast('error', err.message);
    }
  };

  const handleDeleteAllotment = async (allotmentId: number) => {
    if (!selectedIPO) return;
    try {
      await api.deleteIPOAllotment(selectedIPO.id, allotmentId);
      handleOpenAllotments(selectedIPO);
      showToast('success', 'Allotment entry deleted.');
      onRefresh();
    } catch (err: any) {
      showToast('error', err.message);
    }
  };

  const handleCSVUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedIPO || !csvFile) return;
    setIsUploadingCSV(true);
    try {
      const res = await api.importCSV(selectedIPO.id, csvFile);
      setCsvResult(res);
      handleOpenAllotments(selectedIPO);
      showToast(
        res.conflict_count > 0 ? 'info' : 'success',
        `CSV import completed: ${res.imported_count} imported, ${res.updated_count} updated, ${res.conflict_count} conflicts reported.`
      );
      onRefresh();
    } catch (err: any) {
      showToast('error', `CSV Import Error: ${err.message}`);
    } finally {
      setIsUploadingCSV(false);
    }
  };

  const handleExportCSV = async () => {
    if (!selectedIPO) return;
    try {
      await api.exportIPOAllotmentsCSV(selectedIPO.id, selectedIPO.symbol);
      showToast('success', `Exported allotments for ${selectedIPO.symbol}.`);
    } catch (err: any) {
      showToast('error', `Export failed: ${err.message}`);
    }
  };

  const handleSyncFeed = async () => {
    setIsSyncingFeed(true);
    try {
      const res = await api.syncIPOFeed();
      showToast('success', `Market Feed Synced: ${res.created_count} added, ${res.updated_count} updated (${res.total_catalog_size} total catalog).`);
      onRefresh();
    } catch (err: any) {
      showToast('error', `Feed Sync Failed: ${err.message}`);
    } finally {
      setIsSyncingFeed(false);
    }
  };

  const handlePrepareWorkspace = async () => {
    if (workspaceAccountIds.length === 0) {
      showToast('error', 'Select at least one account for application preparation.');
      return;
    }
    setIsPreparingWorkspace(true);
    try {
      const res = await api.prepareIPOApplications({
        ipo_id: workspaceIPOId,
        account_ids: workspaceAccountIds,
        lots: workspaceLots,
        category: workspaceCategory
      });
      setWorkspacePrepResult(res);
      showToast('success', `Prepared applications for ${res.total_accounts} accounts.`);
    } catch (err: any) {
      showToast('error', `Application Preparation Error: ${err.message}`);
    } finally {
      setIsPreparingWorkspace(false);
    }
  };

  // Portfolio Totals across catalog
  const catalogMetrics = useMemo(() => {
    let totalAllotted = 0;
    let totalVal = 0;
    let totalPnl = 0;
    for (const ipo of ipos) {
      totalAllotted += ipo.total_allotted_shares || 0;
      totalVal += ipo.estimated_current_value || 0;
      totalPnl += ipo.estimated_pnl || 0;
    }
    return { totalAllotted, totalVal, totalPnl };
  }, [ipos]);

  return (
    <div className="space-y-6">
      {/* Toast Notification Banner */}
      {toast && (
        <div className={`p-4 rounded-xl flex items-center justify-between text-xs font-semibold shadow-sm transition-all ${
          toast.type === 'success'
            ? 'bg-emerald-50 text-emerald-900 border border-emerald-200'
            : toast.type === 'error'
            ? 'bg-rose-50 text-rose-900 border border-rose-200'
            : 'bg-blue-50 text-blue-900 border border-blue-200'
        }`}>
          <div className="flex items-center gap-2">
            {toast.type === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />}
            {toast.type === 'error' && <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />}
            {toast.type === 'info' && <AlertTriangle className="w-4 h-4 text-blue-600 shrink-0" />}
            <span>{toast.message}</span>
          </div>
          <button onClick={() => setToast(null)} className="p-1 hover:opacity-70">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Top Operational Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 text-xs font-medium">
            <span>Tracked Issues</span>
            <Building2 className="w-4 h-4 text-brand-600" />
          </div>
          <p className="mt-2 text-2xl font-bold text-slate-900 num-mono">{ipos.length}</p>
          <div className="mt-1 text-[11px] text-slate-500 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            <span>{ipos.filter(i => i.status === 'LISTED').length} Listed & Active</span>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 text-xs font-medium">
            <span>Confirmed Allotted Shares</span>
            <Layers className="w-4 h-4 text-blue-600" />
          </div>
          <p className="mt-2 text-2xl font-bold text-slate-900 num-mono">
            {catalogMetrics.totalAllotted.toLocaleString('en-IN')}
          </p>
          <p className="mt-1 text-[11px] text-slate-500">Across connected Demat accounts</p>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 text-xs font-medium">
            <span>Allotment Market Value</span>
            <Briefcase className="w-4 h-4 text-emerald-600" />
          </div>
          <p className="mt-2 text-2xl font-bold text-slate-900 num-mono">
            ₹{catalogMetrics.totalVal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </p>
          <p className="mt-1 text-[11px] text-slate-500">Marked to latest traded price</p>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 text-xs font-medium">
            <span>Net Listing Gain / P&L</span>
            <TrendingUp className="w-4 h-4 text-emerald-600" />
          </div>
          <p className={`mt-2 text-2xl font-bold num-mono ${catalogMetrics.totalPnl >= 0 ? 'text-finGreen' : 'text-finRed'}`}>
            {catalogMetrics.totalPnl >= 0 ? '+' : ''}₹{catalogMetrics.totalPnl.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </p>
          <p className="mt-1 text-[11px] text-slate-500">Unrealized listing day return</p>
        </div>
      </div>

      {/* Main Tab Switcher (Catalog vs Application Workspace) */}
      <div className="flex items-center border-b border-slate-200 gap-6 text-sm font-semibold">
        <button
          onClick={() => setActiveTab('CATALOG')}
          className={`pb-3 transition-colors flex items-center gap-2 ${
            activeTab === 'CATALOG'
              ? 'text-brand-600 border-b-2 border-brand-600 font-bold'
              : 'text-slate-500 hover:text-slate-900'
          }`}
        >
          <Layers className="w-4 h-4" />
          <span>IPO Catalog & Allotments</span>
        </button>
        <button
          onClick={() => setActiveTab('WORKSPACE')}
          className={`pb-3 transition-colors flex items-center gap-2 ${
            activeTab === 'WORKSPACE'
              ? 'text-brand-600 border-b-2 border-brand-600 font-bold'
              : 'text-slate-500 hover:text-slate-900'
          }`}
        >
          <FileText className="w-4 h-4" />
          <span>Application Preparation Workspace</span>
        </button>
      </div>

      {/* VIEW 1: IPO MASTER CATALOG */}
      {activeTab === 'CATALOG' && (
        <div className="space-y-4">
          {/* Header Controls: Filters, Search, Actions */}
          <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
            {/* Filter Pills with Accurate Counts */}
            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg overflow-x-auto">
              {statuses.map((s) => (
                <button
                  key={s.id}
                  onClick={() => {
                    setSelectedStatus(s.id);
                    setCurrentPage(1);
                  }}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap transition-colors flex items-center gap-1.5 ${
                    selectedStatus === s.id
                      ? 'bg-white text-slate-900 shadow-xs font-bold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <span>{s.label}</span>
                  <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono ${
                    selectedStatus === s.id
                      ? 'bg-brand-50 text-brand-700 font-bold'
                      : 'bg-slate-200 text-slate-600'
                  }`}>
                    {s.count}
                  </span>
                </button>
              ))}
            </div>

            {/* Search Box & Actions */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 sm:w-64">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setCurrentPage(1);
                  }}
                  placeholder="Search symbol, company, ISIN..."
                  className="w-full pl-9 pr-7 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-brand-500 focus:bg-white"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Sync Feed Button */}
              <button
                onClick={handleSyncFeed}
                disabled={isSyncingFeed}
                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold shadow-2xs transition-colors flex items-center gap-1.5 disabled:opacity-50"
                title="Discover newly active and scheduled IPOs from official market feed"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSyncingFeed ? 'animate-spin text-brand-600' : ''}`} />
                <span>{isSyncingFeed ? 'Syncing...' : 'Sync Market Feed'}</span>
              </button>

              {/* Add IPO Record Button */}
              <button
                onClick={() => setIsAddIPOOpen(true)}
                className="px-3.5 py-1.5 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" />
                <span>Add Record</span>
              </button>
            </div>
          </div>

          {/* Master Table Container */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 uppercase tracking-wider font-semibold border-b border-slate-200 text-[10px]">
                  <tr>
                    <th
                      onClick={() => handleSort('symbol')}
                      className="py-3 px-4 cursor-pointer hover:bg-slate-100 transition-colors"
                    >
                      <div className="flex items-center gap-1">
                        <span>Symbol / Company</span>
                        <ArrowUpDown className="w-3 h-3 text-slate-400" />
                      </div>
                    </th>
                    <th className="py-3 px-4">Status</th>
                    <th
                      onClick={() => handleSort('issue_price')}
                      className="py-3 px-4 cursor-pointer hover:bg-slate-100 transition-colors"
                    >
                      <div className="flex items-center gap-1">
                        <span>Issue Price</span>
                        <ArrowUpDown className="w-3 h-3 text-slate-400" />
                      </div>
                    </th>
                    <th
                      onClick={() => handleSort('lot_size')}
                      className="py-3 px-4 cursor-pointer hover:bg-slate-100 transition-colors"
                    >
                      <div className="flex items-center gap-1">
                        <span>Lot Size</span>
                        <ArrowUpDown className="w-3 h-3 text-slate-400" />
                      </div>
                    </th>
                    <th
                      onClick={() => handleSort('current_ltp')}
                      className="py-3 px-4 cursor-pointer hover:bg-slate-100 transition-colors"
                    >
                      <div className="flex items-center gap-1">
                        <span>Current LTP</span>
                        <ArrowUpDown className="w-3 h-3 text-slate-400" />
                      </div>
                    </th>
                    <th
                      onClick={() => handleSort('gain_pct')}
                      className="py-3 px-4 cursor-pointer hover:bg-slate-100 transition-colors"
                    >
                      <div className="flex items-center gap-1">
                        <span>Listing Gain</span>
                        <ArrowUpDown className="w-3 h-3 text-slate-400" />
                      </div>
                    </th>
                    <th
                      onClick={() => handleSort('total_allotted_shares')}
                      className="py-3 px-4 cursor-pointer hover:bg-slate-100 transition-colors"
                    >
                      <div className="flex items-center gap-1">
                        <span>Confirmed Shares</span>
                        <ArrowUpDown className="w-3 h-3 text-slate-400" />
                      </div>
                    </th>
                    <th
                      onClick={() => handleSort('estimated_current_value')}
                      className="py-3 px-4 cursor-pointer hover:bg-slate-100 transition-colors"
                    >
                      <div className="flex items-center gap-1">
                        <span>Market Value</span>
                        <ArrowUpDown className="w-3 h-3 text-slate-400" />
                      </div>
                    </th>
                    <th
                      onClick={() => handleSort('estimated_pnl')}
                      className="py-3 px-4 cursor-pointer hover:bg-slate-100 transition-colors"
                    >
                      <div className="flex items-center gap-1">
                        <span>Net P&L</span>
                        <ArrowUpDown className="w-3 h-3 text-slate-400" />
                      </div>
                    </th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-100">
                  {paginatedIPOs.map((ipo) => {
                    const gainPct =
                      ipo.issue_price > 0 && ipo.current_ltp
                        ? ((ipo.current_ltp - ipo.issue_price) / ipo.issue_price) * 100
                        : 0;
                    const isPositive = gainPct >= 0;

                    return (
                      <tr key={ipo.id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-900">{ipo.symbol}</span>
                            <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-medium">
                              {ipo.exchange}
                            </span>
                            {ipo.is_sme && (
                              <span className="text-[9px] bg-purple-100 text-purple-800 font-bold px-1.5 py-0.5 rounded">
                                SME
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-slate-500 truncate max-w-xs">{ipo.company_name}</p>
                          {ipo.listing_date && (
                            <span className="text-[10px] text-slate-400">Listing: {ipo.listing_date}</span>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex flex-col gap-1 items-start">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold inline-flex items-center gap-1 ${
                              ipo.status === 'OPEN' || ipo.status === 'PRE_OPEN'
                                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                : ipo.status === 'UPCOMING'
                                ? 'bg-blue-50 text-blue-800 border border-blue-200'
                                : ipo.status === 'CLOSED'
                                ? 'bg-amber-50 text-amber-800 border border-amber-200'
                                : 'bg-slate-100 text-slate-700 border border-slate-200'
                            }`}>
                              {(ipo.status === 'OPEN' || ipo.status === 'PRE_OPEN') && (
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                              )}
                              {ipo.status === 'OPEN' || ipo.status === 'PRE_OPEN' ? 'OPEN' : ipo.status}
                            </span>
                            {ipo.subscription_rate && (
                              <span className="text-[10px] text-slate-500 font-medium">
                                Sub: <span className="font-bold text-slate-800">{ipo.subscription_rate}</span>
                              </span>
                            )}
                            {ipo.bidding_end_date && (ipo.status === 'OPEN' || ipo.status === 'PRE_OPEN') && (
                              <span className="text-[10px] text-emerald-700 font-semibold">
                                Closes: {ipo.bidding_end_date}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-4 num-mono font-medium text-slate-700">
                          <div>₹{ipo.issue_price.toFixed(2)}</div>
                          {ipo.min_price && ipo.max_price && ipo.min_price !== ipo.max_price && (
                            <div className="text-[10px] text-slate-400">Band: ₹{ipo.min_price}–₹{ipo.max_price}</div>
                          )}
                          {ipo.min_investment ? (
                            <div className="text-[10px] text-slate-500">Min: ₹{ipo.min_investment.toLocaleString('en-IN')}</div>
                          ) : null}
                        </td>
                        <td className="py-3 px-4 num-mono text-slate-600">
                          {ipo.lot_size} {ipo.is_sme ? 'shares (fixed)' : 'shares'}
                        </td>
                        <td className="py-3 px-4 num-mono font-bold text-slate-900">
                          ₹{ipo.current_ltp?.toFixed(2) ?? '—'}
                        </td>
                        <td className="py-3 px-4">
                          <span className={`inline-flex items-center font-bold num-mono ${
                            isPositive ? 'text-finGreen' : 'text-finRed'
                          }`}>
                            {isPositive ? <ArrowUpRight className="w-3.5 h-3.5 mr-0.5" /> : <ArrowDownRight className="w-3.5 h-3.5 mr-0.5" />}
                            {isPositive ? '+' : ''}{gainPct.toFixed(2)}%
                          </span>
                        </td>
                        <td className="py-3 px-4 num-mono font-medium text-slate-900">
                          {ipo.total_allotted_shares.toLocaleString('en-IN')} shares
                          <div className="text-[10px] text-slate-400">{ipo.total_accounts_allotted} accounts</div>
                        </td>
                        <td className="py-3 px-4 num-mono font-bold text-slate-900">
                          ₹{ipo.estimated_current_value.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </td>
                        <td className="py-3 px-4">
                          <span className={`font-bold num-mono ${
                            ipo.estimated_pnl >= 0 ? 'text-finGreen' : 'text-finRed'
                          }`}>
                            {ipo.estimated_pnl >= 0 ? '+' : ''}₹{ipo.estimated_pnl.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => handleOpenAllotments(ipo)}
                              className="px-3 py-1 bg-brand-50 hover:bg-brand-100 text-brand-700 border border-brand-200 rounded text-xs font-semibold transition-colors flex items-center gap-1.5"
                            >
                              <Layers className="w-3.5 h-3.5" />
                              <span>Allotments ({ipo.total_accounts_allotted})</span>
                            </button>
                            <button
                              onClick={() => handleDeleteIPO(ipo)}
                              className="p-1.5 text-slate-400 hover:text-rose-600 rounded hover:bg-rose-50 transition-colors"
                              title="Delete from catalog"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {/* HIGH-IMPACT EMPTY STATE */}
              {filteredAndSortedIPOs.length === 0 && (
                <div className="p-12 text-center space-y-4">
                  <div className="w-14 h-14 bg-slate-100 text-slate-400 rounded-2xl flex items-center justify-center mx-auto">
                    <Building2 className="w-7 h-7" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-slate-900">No IPO records found</h3>
                    <p className="text-xs text-slate-500 max-w-md mx-auto mt-1">
                      {searchQuery
                        ? `No issues match your search "${searchQuery}". Try clearing search filters.`
                        : 'Your IPO catalog is currently empty. Synchronize official market feeds or add an IPO record to start tracking allotments.'}
                    </p>
                  </div>
                  <div className="flex items-center justify-center gap-3 pt-2">
                    <button
                      onClick={handleSyncFeed}
                      disabled={isSyncingFeed}
                      className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors flex items-center gap-1.5"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isSyncingFeed ? 'animate-spin' : ''}`} />
                      <span>Sync Market Feed</span>
                    </button>
                    <button
                      onClick={() => setIsAddIPOOpen(true)}
                      className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold transition-colors"
                    >
                      + Add Record Manually
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Pagination Controls */}
            {filteredAndSortedIPOs.length > 0 && (
              <div className="flex flex-col sm:flex-row items-center justify-between px-4 py-3 bg-slate-50 border-t border-slate-200 text-xs text-slate-500 gap-2">
                <div>
                  Showing <span className="font-semibold text-slate-900">{(currentPage - 1) * pageSize + 1}</span> to{' '}
                  <span className="font-semibold text-slate-900">
                    {Math.min(currentPage * pageSize, filteredAndSortedIPOs.length)}
                  </span>{' '}
                  of <span className="font-semibold text-slate-900">{filteredAndSortedIPOs.length}</span> issues
                </div>

                <div className="flex items-center gap-2">
                  <select
                    value={pageSize}
                    onChange={(e) => {
                      setPageSize(Number(e.target.value));
                      setCurrentPage(1);
                    }}
                    className="px-2 py-1 bg-white border border-slate-200 rounded text-xs text-slate-700 focus:outline-none"
                  >
                    <option value={10}>10 per page</option>
                    <option value={25}>25 per page</option>
                    <option value={50}>50 per page</option>
                  </select>

                  <button
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="px-2.5 py-1 bg-white border border-slate-200 rounded text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                  >
                    Previous
                  </button>
                  <span className="px-2 py-1 text-xs font-semibold text-slate-700">
                    {currentPage} / {totalPages}
                  </span>
                  <button
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    className="px-2.5 py-1 bg-white border border-slate-200 rounded text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* VIEW 2: MULTI-ACCOUNT APPLICATION PREPARATION WORKSPACE */}
      {activeTab === 'WORKSPACE' && (
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-xs space-y-6">
          <div className="border-b border-slate-100 pb-4">
            <h3 className="text-base font-bold text-slate-900">Multi-Account IPO Application Preparation Workspace</h3>
            <p className="text-xs text-slate-500 mt-1">
              Configure batch application bids across your family Demat accounts. Automatically calculates lot sizing,
              validates retail limit caps (max ₹2,00,000 for Retail), and warns about duplicate PAN applications.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* 1. Target IPO Selection */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">Target IPO Issue</label>
              <select
                value={workspaceIPOId}
                onChange={(e) => setWorkspaceIPOId(Number(e.target.value))}
                className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-brand-500"
              >
                {ipos.map(i => (
                  <option key={i.id} value={i.id}>
                    {i.symbol} — {i.company_name} (Lot: {i.lot_size}, Price: ₹{i.issue_price})
                  </option>
                ))}
              </select>
            </div>

            {/* 2. Lot Sizing */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">Number of Lots per Account</label>
              <input
                type="number"
                min={1}
                value={workspaceLots}
                onChange={(e) => setWorkspaceLots(Math.max(1, Number(e.target.value)))}
                className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>

            {/* 3. Investor Category */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">Investor Category</label>
              <select
                value={workspaceCategory}
                onChange={(e) => setWorkspaceCategory(e.target.value)}
                className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-brand-500"
              >
                <option value="RETAIL">Retail Individual Investor (RII - max ₹2L)</option>
                <option value="sNII">Small NII (sNII - ₹2L to ₹10L)</option>
                <option value="bNII">Big NII (bNII - above ₹10L)</option>
                <option value="EMPLOYEE">Eligible Employee</option>
              </select>
            </div>
          </div>

          {/* Account Selection Grid */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-700">Select Accounts for Application ({workspaceAccountIds.length}/{accounts.length})</label>
              <div className="flex items-center gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => setWorkspaceAccountIds(accounts.map(a => a.id))}
                  className="text-brand-600 hover:underline font-medium"
                >
                  Select All
                </button>
                <span className="text-slate-300">|</span>
                <button
                  type="button"
                  onClick={() => setWorkspaceAccountIds([])}
                  className="text-slate-500 hover:underline font-medium"
                >
                  Clear All
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {accounts.map(acc => {
                const isChecked = workspaceAccountIds.includes(acc.id);
                return (
                  <div
                    key={acc.id}
                    onClick={() => {
                      setWorkspaceAccountIds(prev =>
                        isChecked ? prev.filter(id => id !== acc.id) : [...prev, acc.id]
                      );
                    }}
                    className={`p-3 rounded-lg border cursor-pointer transition-all flex items-center justify-between ${
                      isChecked
                        ? 'bg-blue-50/50 border-brand-300 ring-1 ring-brand-500'
                        : 'bg-slate-50 border-slate-200 hover:bg-slate-100/50'
                    }`}
                  >
                    <div>
                      <p className="text-xs font-bold text-slate-900">{acc.nickname}</p>
                      <p className="text-[11px] text-slate-500 font-mono">{acc.masked_client_code} ({acc.account_group})</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => {}}
                      className="rounded text-brand-600 focus:ring-brand-500"
                    />
                  </div>
                );
              })}
            </div>
          </div>

          {/* Prepare Button */}
          <div className="pt-2">
            <button
              onClick={handlePrepareWorkspace}
              disabled={isPreparingWorkspace || workspaceAccountIds.length === 0}
              className="px-5 py-2.5 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-xs font-bold shadow-xs transition-colors flex items-center gap-2 disabled:opacity-50"
            >
              <FileText className="w-4 h-4" />
              <span>{isPreparingWorkspace ? 'Validating Applications...' : 'Generate Application Matrix'}</span>
            </button>
          </div>

          {/* Prepared Results Table */}
          {workspacePrepResult && (
            <div className="mt-6 border-t border-slate-100 pt-6 space-y-4">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div>
                  <h4 className="text-sm font-bold text-slate-900">
                    Prepared Applications for {workspacePrepResult.ipo_symbol}
                  </h4>
                  <p className="text-xs text-slate-500">
                    Total Funding Required: <span className="font-bold text-slate-900">₹{workspacePrepResult.total_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span> across {workspacePrepResult.total_accounts} accounts ({workspacePrepResult.total_shares} total shares).
                  </p>
                </div>
                {!workspacePrepResult.all_valid && (
                  <span className="px-2.5 py-1 bg-rose-50 text-rose-800 border border-rose-200 rounded text-xs font-bold flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 text-rose-600" />
                    <span>Validation Issues Detected</span>
                  </span>
                )}
              </div>

              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500 uppercase font-semibold text-[10px]">
                    <tr>
                      <th className="py-2.5 px-3">Account</th>
                      <th className="py-2.5 px-3">Category</th>
                      <th className="py-2.5 px-3">Lots</th>
                      <th className="py-2.5 px-3">Shares</th>
                      <th className="py-2.5 px-3">Cut-off Price</th>
                      <th className="py-2.5 px-3">Total Block Amount</th>
                      <th className="py-2.5 px-3">Validation Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {workspacePrepResult.applications.map(app => (
                      <tr key={app.account_id} className={app.is_valid ? '' : 'bg-rose-50/40'}>
                        <td className="py-2.5 px-3 font-medium text-slate-900">
                          {app.account_nickname} <span className="text-slate-400 font-mono">({app.account_masked_code})</span>
                        </td>
                        <td className="py-2.5 px-3 text-slate-600">{app.category}</td>
                        <td className="py-2.5 px-3 num-mono">{app.lots} lots</td>
                        <td className="py-2.5 px-3 num-mono">{app.shares} shares</td>
                        <td className="py-2.5 px-3 num-mono font-medium">₹{app.cut_off_price.toFixed(2)}</td>
                        <td className="py-2.5 px-3 num-mono font-bold text-slate-900">
                          ₹{app.total_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </td>
                        <td className="py-2.5 px-3">
                          {app.is_valid ? (
                            <div className="flex items-center gap-1.5 text-emerald-700 font-semibold text-[11px]">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                              <span>Eligible</span>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5 text-rose-700 font-semibold text-[11px]">
                              <AlertCircle className="w-3.5 h-3.5 text-rose-600" />
                              <span>{app.validation_message}</span>
                            </div>
                          )}
                          {app.duplicate_warning && (
                            <p className="text-[10px] text-amber-700 mt-0.5">{app.duplicate_warning}</p>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* MODAL 1: ALLOTMENT REGISTER DRAWER (FOR SELECTED IPO) */}
      {selectedIPO && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between pb-4 border-b border-slate-100 gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-base font-bold text-slate-900">{selectedIPO.symbol} Allotment Register</span>
                <span className="text-xs text-slate-500 font-medium">({selectedIPO.company_name})</span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Multi-account allotment outcomes, Demat holding verification & acquisition ledger
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setIsManualAllotmentOpen(true)}
                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Entry</span>
              </button>
              <button
                onClick={() => setIsCSVModalOpen(true)}
                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Import CSV</span>
              </button>
              <button
                onClick={handleExportCSV}
                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export CSV</span>
              </button>
              <button
                onClick={() => setSelectedIPO(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Allotment Register Table */}
          {isLoadingAllotments ? (
            <div className="py-8 text-center text-xs text-slate-400">Loading verified allotment records...</div>
          ) : (
            <div className="overflow-x-auto border border-slate-200 rounded-lg">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500 uppercase font-semibold text-[10px]">
                  <tr>
                    <th className="py-2.5 px-3">Account</th>
                    <th className="py-2.5 px-3">Category</th>
                    <th className="py-2.5 px-3">App No.</th>
                    <th className="py-2.5 px-3">Applied</th>
                    <th className="py-2.5 px-3">Allotted</th>
                    <th className="py-2.5 px-3">Unit Cost</th>
                    <th className="py-2.5 px-3">Market Value</th>
                    <th className="py-2.5 px-3">Unrealized P&L</th>
                    <th className="py-2.5 px-3">Demat Verification</th>
                    <th className="py-2.5 px-3 text-right">Delete</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {allotments.map((a) => (
                    <tr key={a.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-2.5 px-3">
                        <span className="font-bold text-slate-900">{a.account_nickname}</span>
                        <div className="text-[10px] text-slate-400 font-mono">{a.account_masked_code}</div>
                      </td>
                      <td className="py-2.5 px-3 text-slate-600 font-medium">{a.category || 'RETAIL'}</td>
                      <td className="py-2.5 px-3 font-mono text-slate-600">{a.application_no || '—'}</td>
                      <td className="py-2.5 px-3 num-mono">{a.applied_quantity}</td>
                      <td className="py-2.5 px-3 num-mono font-bold text-slate-900">{a.allotted_quantity}</td>
                      <td className="py-2.5 px-3 num-mono font-medium text-slate-700">₹{a.acquisition_cost.toFixed(2)}</td>
                      <td className="py-2.5 px-3 num-mono font-bold text-slate-900">
                        ₹{a.market_value.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-2.5 px-3">
                        <span className={`font-bold num-mono ${a.unrealized_pnl >= 0 ? 'text-finGreen' : 'text-finRed'}`}>
                          {a.unrealized_pnl >= 0 ? '+' : ''}₹{a.unrealized_pnl.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </span>
                        <div className="text-[10px] text-slate-400 font-mono">({a.pnl_percentage.toFixed(2)}%)</div>
                      </td>
                      <td className="py-2.5 px-3">
                        {a.demat_verified ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                            <span>Demat Credited</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                            <Clock className="w-3.5 h-3.5 text-amber-600" />
                            <span>Pending Depository</span>
                          </span>
                        )}
                        {a.conflict_note && (
                          <p className="text-[9px] text-blue-600 mt-0.5">{a.conflict_note}</p>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <button
                          onClick={() => handleDeleteAllotment(a.id)}
                          className="p-1 text-slate-400 hover:text-rose-600 rounded transition-colors"
                          title="Delete entry"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {allotments.length === 0 && (
                    <tr>
                      <td colSpan={10} className="py-6 text-center text-slate-400 text-xs">
                        No allotment records found for this IPO. Click "Add Entry" or "Import CSV" to populate records.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* MODAL 2: ADD IPO RECORD */}
      {isAddIPOOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-lg w-full border border-slate-200 shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Add New IPO Record</h3>
                <p className="text-xs text-slate-500">Register new listing or upcoming IPO in local catalog</p>
              </div>
              <button onClick={() => setIsAddIPOOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateIPO} className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Trading Symbol *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. TATATECH"
                    value={ipoForm.symbol}
                    onChange={(e) => setIpoForm({ ...ipoForm, symbol: e.target.value.toUpperCase() })}
                    className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono uppercase focus:outline-none focus:ring-1 focus:ring-brand-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Exchange</label>
                  <select
                    value={ipoForm.exchange}
                    onChange={(e) => setIpoForm({ ...ipoForm, exchange: e.target.value })}
                    className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-brand-500"
                  >
                    <option value="NSE">NSE (National Stock Exchange)</option>
                    <option value="BSE">BSE (Bombay Stock Exchange)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Company Legal Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Tata Technologies Limited"
                  value={ipoForm.company_name}
                  onChange={(e) => setIpoForm({ ...ipoForm, company_name: e.target.value })}
                  className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Issue / Cut-off Price (₹) *</label>
                  <input
                    type="number"
                    step="0.05"
                    min="1"
                    required
                    value={ipoForm.issue_price}
                    onChange={(e) => setIpoForm({ ...ipoForm, issue_price: parseFloat(e.target.value) || 0 })}
                    className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono focus:outline-none focus:ring-1 focus:ring-brand-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Lot Size (Shares) *</label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={ipoForm.lot_size}
                    onChange={(e) => setIpoForm({ ...ipoForm, lot_size: parseInt(e.target.value) || 1 })}
                    className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono focus:outline-none focus:ring-1 focus:ring-brand-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Status</label>
                  <select
                    value={ipoForm.status}
                    onChange={(e: any) => setIpoForm({ ...ipoForm, status: e.target.value })}
                    className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-brand-500"
                  >
                    <option value="OPEN">Open (Bidding Active)</option>
                    <option value="UPCOMING">Upcoming</option>
                    <option value="CLOSED">Closed</option>
                    <option value="LISTED">Listed</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Listing Date</label>
                  <input
                    type="date"
                    value={ipoForm.listing_date || ''}
                    onChange={(e) => setIpoForm({ ...ipoForm, listing_date: e.target.value })}
                    className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-brand-500"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  id="sme-toggle"
                  checked={ipoForm.is_sme}
                  onChange={(e) => setIpoForm({ ...ipoForm, is_sme: e.target.checked })}
                  className="rounded text-brand-600 focus:ring-brand-500"
                />
                <label htmlFor="sme-toggle" className="text-xs text-slate-700 font-medium">
                  SME Issue (Rigid whole lot trading rule)
                </label>
              </div>

              <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsAddIPOOpen(false)}
                  className="px-4 py-2 border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-xs font-bold shadow-xs transition-colors"
                >
                  Save Record
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: MANUAL ALLOTMENT ENTRY */}
      {isManualAllotmentOpen && selectedIPO && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full border border-slate-200 shadow-xl overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Add Allotment Entry</h3>
                <p className="text-xs text-slate-500">Assign {selectedIPO.symbol} shares to a Demat account</p>
              </div>
              <button onClick={() => setIsManualAllotmentOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateManualAllotment} className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Target Account *</label>
                <select
                  value={manualAllotForm.account_id}
                  onChange={(e) => setManualAllotForm({ ...manualAllotForm, account_id: parseInt(e.target.value) })}
                  className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-brand-500"
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.nickname} ({a.masked_client_code})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Application Number</label>
                <input
                  type="text"
                  placeholder="e.g. APP-10928392"
                  value={manualAllotForm.application_no}
                  onChange={(e) => setManualAllotForm({ ...manualAllotForm, application_no: e.target.value })}
                  className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Applied Shares</label>
                  <input
                    type="number"
                    min="0"
                    value={manualAllotForm.applied_quantity}
                    onChange={(e) => setManualAllotForm({ ...manualAllotForm, applied_quantity: parseInt(e.target.value) || 0 })}
                    className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono focus:outline-none focus:ring-1 focus:ring-brand-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Allotted Shares *</label>
                  <input
                    type="number"
                    min="0"
                    required
                    value={manualAllotForm.allotted_quantity}
                    onChange={(e) => setManualAllotForm({ ...manualAllotForm, allotted_quantity: parseInt(e.target.value) || 0 })}
                    className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono focus:outline-none focus:ring-1 focus:ring-brand-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Unit Cost (₹) *</label>
                <input
                  type="number"
                  step="0.05"
                  required
                  value={manualAllotForm.acquisition_cost}
                  onChange={(e) => setManualAllotForm({ ...manualAllotForm, acquisition_cost: parseFloat(e.target.value) || 0 })}
                  className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsManualAllotmentOpen(false)}
                  className="px-4 py-2 border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-xs font-bold shadow-xs transition-colors"
                >
                  Save Allotment
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 4: CSV ALLOTMENT IMPORT */}
      {isCSVModalOpen && selectedIPO && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-lg w-full border border-slate-200 shadow-xl overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Import Allotments CSV</h3>
                <p className="text-xs text-slate-500">Batch upload for {selectedIPO.symbol}</p>
              </div>
              <button onClick={() => { setIsCSVModalOpen(false); setCsvResult(null); }} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCSVUpload} className="p-5 space-y-4">
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs text-slate-600 space-y-2">
                <p className="font-semibold text-slate-900">Expected CSV File Columns:</p>
                <code className="block bg-white p-2 rounded border border-slate-200 text-[11px] font-mono text-slate-800">
                  client_code, application_no, applied_qty, allotted_qty, cost
                </code>
                <p className="text-[11px] text-slate-500">
                  Matches by Angel One Client Code or Account Nickname. Reconciles existing records with audit trace.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Select CSV File</label>
                <input
                  type="file"
                  accept=".csv"
                  required
                  onChange={(e) => setCsvFile(e.target.files ? e.target.files[0] : null)}
                  className="w-full text-xs text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-brand-50 file:text-brand-700 hover:file:bg-brand-100 cursor-pointer"
                />
              </div>

              {/* Import Results Box */}
              {csvResult && (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs space-y-1">
                  <p className="font-bold text-slate-900">Import Summary:</p>
                  <p className="text-emerald-700 font-semibold">• Imported: {csvResult.imported_count} new records</p>
                  <p className="text-blue-700 font-semibold">• Updated: {csvResult.updated_count} existing records</p>
                  <p className="text-slate-600">• Skipped: {csvResult.skipped_count} unchanged rows</p>
                  {csvResult.conflicts.length > 0 && (
                    <div className="mt-2 text-amber-800">
                      <p className="font-bold">Conflicts Reconciled ({csvResult.conflict_count}):</p>
                      <ul className="list-disc pl-4 text-[10px] space-y-0.5">
                        {csvResult.conflicts.map((c, i) => <li key={i}>{c}</li>)}
                      </ul>
                    </div>
                  )}
                  {csvResult.errors.length > 0 && (
                    <div className="mt-2 text-rose-700">
                      <p className="font-bold">Errors ({csvResult.errors.length}):</p>
                      <ul className="list-disc pl-4 text-[10px] space-y-0.5">
                        {csvResult.errors.map((err, i) => <li key={i}>{err}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => { setIsCSVModalOpen(false); setCsvResult(null); }}
                  className="px-4 py-2 border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={!csvFile || isUploadingCSV}
                  className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-xs font-bold shadow-xs transition-colors disabled:opacity-50 flex items-center gap-1.5"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>{isUploadingCSV ? 'Importing...' : 'Upload & Reconcile'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
