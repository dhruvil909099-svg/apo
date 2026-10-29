import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  Search, ArrowUpDown, Download, RefreshCw, MoreVertical,
  TrendingUp, TrendingDown, Eye, BarChart2, ShieldCheck,
  Check, Copy, AlertCircle, Layers, SlidersHorizontal, X
} from 'lucide-react';
import { AccountHoldingItem } from '../types';

interface HoldingsTableProps {
  holdings: AccountHoldingItem[];
  isLoading: boolean;
  onRefresh: () => void;
  onOpenOrderTicket: (holding: AccountHoldingItem, side: 'BUY' | 'SELL') => void;
  onOpenDetailsModal: (holding: AccountHoldingItem, view: 'depth' | 'chart' | 'details' | 'corporate') => void;
}

export const HoldingsTable: React.FC<HoldingsTableProps> = ({
  holdings,
  isLoading,
  onRefresh,
  onOpenOrderTicket,
  onOpenDetailsModal,
}) => {
  const [search, setSearch] = useState<string>('');
  const [exchangeFilter, setExchangeFilter] = useState<'ALL' | 'NSE' | 'BSE'>('ALL');
  const [pnlFilter, setPnlFilter] = useState<'ALL' | 'GAINERS' | 'LOSERS'>('ALL');
  const [sortBy, setSortBy] = useState<'symbol' | 'qty' | 'val' | 'invested' | 'pnl' | 'pnl_pct' | 'day_pnl'>('val');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [selectedSymbols, setSelectedSymbols] = useState<Set<string>>(new Set());
  const [activeMenuIndex, setActiveMenuIndex] = useState<number | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Sub-second live price tick flash tracking
  const prevLtpRef = useRef<Record<string, number>>({});
  const [flashMap, setFlashMap] = useState<Record<string, 'UP' | 'DOWN'>>({});

  useEffect(() => {
    const newFlashes: Record<string, 'UP' | 'DOWN'> = {};
    let hasFlash = false;
    holdings.forEach((h) => {
      const sym = h.symbol;
      const current = h.current_ltp;
      const prev = prevLtpRef.current[sym];
      if (prev !== undefined && current !== undefined && current !== prev) {
        newFlashes[sym] = current > prev ? 'UP' : 'DOWN';
        hasFlash = true;
      }
      if (current !== undefined) {
        prevLtpRef.current[sym] = current;
      }
    });

    if (hasFlash) {
      setFlashMap((existing) => ({ ...existing, ...newFlashes }));
      const timer = setTimeout(() => {
        setFlashMap({});
      }, 700);
      return () => clearTimeout(timer);
    }
  }, [holdings]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2500);
  };

  const handleSort = (column: typeof sortBy) => {
    if (sortBy === column) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(column);
      setSortOrder('desc');
    }
  };

  const toggleSelectAll = () => {
    if (selectedSymbols.size === filteredHoldings.length) {
      setSelectedSymbols(new Set());
    } else {
      setSelectedSymbols(new Set(filteredHoldings.map((h) => h.symbol)));
    }
  };

  const toggleSelect = (sym: string) => {
    const next = new Set(selectedSymbols);
    if (next.has(sym)) {
      next.delete(sym);
    } else {
      next.add(sym);
    }
    setSelectedSymbols(next);
  };

  // Filter & Sort
  const filteredHoldings = useMemo(() => {
    return holdings
      .filter((h) => {
        const query = search.toLowerCase();
        const matchesSearch =
          h.symbol.toLowerCase().includes(query) ||
          (h.trading_symbol && h.trading_symbol.toLowerCase().includes(query)) ||
          (h.company_name && h.company_name.toLowerCase().includes(query)) ||
          (h.isin && h.isin.toLowerCase().includes(query));

        const matchesExchange =
          exchangeFilter === 'ALL' || (h.exchange || 'NSE').toUpperCase() === exchangeFilter;

        const pnl = h.unrealized_pnl ?? 0;
        const matchesPnl =
          pnlFilter === 'ALL' ||
          (pnlFilter === 'GAINERS' && pnl >= 0) ||
          (pnlFilter === 'LOSERS' && pnl < 0);

        return matchesSearch && matchesExchange && matchesPnl;
      })
      .sort((a, b) => {
        let va: number | string = 0;
        let vb: number | string = 0;
        const ltpA = a.current_ltp || a.average_price;
        const ltpB = b.current_ltp || b.average_price;
        const valA = a.valuation ?? (a.quantity * ltpA);
        const valB = b.valuation ?? (b.quantity * ltpB);
        const invA = a.invested_amount ?? (a.quantity * a.average_price);
        const invB = b.invested_amount ?? (b.quantity * b.average_price);
        const pnlA = a.unrealized_pnl ?? (valA - invA);
        const pnlB = b.unrealized_pnl ?? (valB - invB);
        const pnlPctA = a.pnl_percentage ?? (invA > 0 ? (pnlA / invA) * 100 : 0);
        const pnlPctB = b.pnl_percentage ?? (invB > 0 ? (pnlB / invB) * 100 : 0);
        const dayPnlA = a.day_pnl ?? ((ltpA - (a.close_price || ltpA)) * a.quantity);
        const dayPnlB = b.day_pnl ?? ((ltpB - (b.close_price || ltpB)) * b.quantity);

        switch (sortBy) {
          case 'symbol':
            va = a.symbol;
            vb = b.symbol;
            return sortOrder === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
          case 'qty':
            va = a.quantity;
            vb = b.quantity;
            break;
          case 'invested':
            va = invA;
            vb = invB;
            break;
          case 'val':
            va = valA;
            vb = valB;
            break;
          case 'pnl':
            va = pnlA;
            vb = pnlB;
            break;
          case 'pnl_pct':
            va = pnlPctA;
            vb = pnlPctB;
            break;
          case 'day_pnl':
            va = dayPnlA;
            vb = dayPnlB;
            break;
        }
        return sortOrder === 'asc' ? (va as number) - (vb as number) : (vb as number) - (va as number);
      });
  }, [holdings, search, exchangeFilter, pnlFilter, sortBy, sortOrder]);

  // Selected Metrics Summary
  const selectedMetrics = useMemo(() => {
    const selected = holdings.filter((h) => selectedSymbols.has(h.symbol));
    const count = selected.length;
    const totalVal = selected.reduce((sum, h) => sum + (h.valuation ?? (h.quantity * (h.current_ltp || h.average_price))), 0);
    const totalCost = selected.reduce((sum, h) => sum + (h.invested_amount ?? (h.quantity * h.average_price)), 0);
    const totalPnl = selected.reduce((sum, h) => sum + (h.unrealized_pnl ?? (h.valuation ?? 0) - (h.invested_amount ?? 0)), 0);
    return { count, totalVal, totalCost, totalPnl };
  }, [holdings, selectedSymbols]);

  // Export CSV
  const handleExportCSV = () => {
    const rowsToExport = selectedSymbols.size > 0
      ? holdings.filter((h) => selectedSymbols.has(h.symbol))
      : filteredHoldings;

    if (rowsToExport.length === 0) {
      showToast('No holdings available to export.');
      return;
    }

    const headers = [
      'Stock Name', 'Trading Symbol', 'Exchange', 'ISIN', 'Quantity',
      'Available Qty', 'T1 Qty', 'Average Price', 'LTP', 'Invested Amount',
      'Valuation', 'Overall P&L (Rs)', 'Overall P&L (%)', 'Day P&L (Rs)', 'Day P&L (%)'
    ];

    const csvData = rowsToExport.map((h) => {
      const ltp = h.current_ltp || h.average_price;
      const inv = h.invested_amount ?? (h.quantity * h.average_price);
      const val = h.valuation ?? (h.quantity * ltp);
      const pnl = h.unrealized_pnl ?? (val - inv);
      const pnlPct = h.pnl_percentage ?? (inv > 0 ? (pnl / inv) * 100 : 0);
      const dayPnl = h.day_pnl ?? ((ltp - (h.close_price || ltp)) * h.quantity);
      const dayPnlPct = h.day_pnl_percentage ?? (((ltp - (h.close_price || ltp)) / (h.close_price || ltp)) * 100);

      return [
        `"${h.company_name || h.symbol}"`,
        `"${h.trading_symbol || `${h.symbol}-EQ`}"`,
        h.exchange || 'NSE',
        h.isin || '—',
        h.quantity,
        h.available_quantity ?? h.quantity,
        h.t1_quantity ?? 0,
        h.average_price.toFixed(2),
        ltp.toFixed(2),
        inv.toFixed(2),
        val.toFixed(2),
        pnl.toFixed(2),
        `${pnlPct.toFixed(2)}%`,
        dayPnl.toFixed(2),
        `${dayPnlPct.toFixed(2)}%`
      ].join(',');
    });

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...csvData].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `angel_one_holdings_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast(`Exported ${rowsToExport.length} holdings to CSV.`);
  };

  return (
    <div className="space-y-3">
      {/* Toast Alert */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white text-xs font-semibold px-4 py-2.5 rounded-xl shadow-xl flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2 duration-150">
          <Check className="w-4 h-4 text-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Holdings Toolbar */}
      <div className="bg-white p-3 rounded-xl border border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs">
        {/* Left: Search & Filters */}
        <div className="flex items-center gap-2 flex-1 min-w-[280px]">
          <div className="relative flex-1 max-w-xs">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search stock, symbol, ISIN..."
              className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-hidden focus:border-brand-500"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg">
            {(['ALL', 'NSE', 'BSE'] as const).map((ex) => (
              <button
                key={ex}
                onClick={() => setExchangeFilter(ex)}
                className={`px-2 py-1 text-[11px] font-bold rounded ${
                  exchangeFilter === ex ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                {ex}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg">
            {(['ALL', 'GAINERS', 'LOSERS'] as const).map((pf) => (
              <button
                key={pf}
                onClick={() => setPnlFilter(pf)}
                className={`px-2 py-1 text-[11px] font-bold rounded ${
                  pnlFilter === pf ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                {pf}
              </button>
            ))}
          </div>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleExportCSV}
            className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg flex items-center gap-1.5 transition-colors"
            title="Export CSV holdings statement"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </button>
          <button
            onClick={onRefresh}
            disabled={isLoading}
            className="px-3 py-1.5 bg-brand-50 hover:bg-brand-100 text-brand-700 font-bold rounded-lg flex items-center gap-1.5 transition-colors disabled:opacity-50"
            title="Refresh verified holdings snapshot"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>Sync</span>
          </button>
        </div>
      </div>

      {/* Multi-Select Analytics Bar */}
      {selectedSymbols.size > 0 && (
        <div className="bg-brand-50/80 border border-brand-200 p-2.5 rounded-xl flex items-center justify-between text-xs text-brand-900 animate-in fade-in duration-100">
          <div className="flex items-center gap-4">
            <span className="font-bold">{selectedMetrics.count} stocks selected</span>
            <span>•</span>
            <span>Total Valuation: <span className="font-mono font-bold">₹{selectedMetrics.totalVal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span></span>
            <span>•</span>
            <span>Total Invested: <span className="font-mono font-bold">₹{selectedMetrics.totalCost.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span></span>
            <span>•</span>
            <span className={`font-mono font-bold ${selectedMetrics.totalPnl >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
              P&L: {selectedMetrics.totalPnl >= 0 ? '+' : ''}₹{selectedMetrics.totalPnl.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleExportCSV}
              className="px-2.5 py-1 bg-brand-600 text-white rounded font-bold text-[11px] shadow-2xs hover:bg-brand-700"
            >
              Export Selected
            </button>
            <button
              onClick={() => setSelectedSymbols(new Set())}
              className="px-2 py-1 text-slate-500 hover:text-slate-800 text-[11px] font-semibold"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Holdings Table */}
      {filteredHoldings.length === 0 ? (
        <div className="py-14 text-center text-slate-400 bg-white rounded-xl border border-slate-200">
          <SlidersHorizontal className="w-8 h-8 mx-auto text-slate-300 mb-2" />
          <p className="font-semibold text-slate-700">No holdings match your search criteria</p>
          <p className="text-xs text-slate-400 mt-0.5">Try clearing your filters or search keywords</p>
        </div>
      ) : (
        <div className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-2xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs whitespace-nowrap">
              <thead className="bg-slate-900 text-slate-300 uppercase text-[10px] font-bold tracking-wider border-b border-slate-800">
                <tr>
                  <th className="py-3 px-3 w-8 text-center">
                    <input
                      type="checkbox"
                      checked={selectedSymbols.size === filteredHoldings.length && filteredHoldings.length > 0}
                      onChange={toggleSelectAll}
                      className="rounded border-slate-700 bg-slate-800 text-brand-600 focus:ring-brand-500"
                    />
                  </th>
                  <th
                    onClick={() => handleSort('symbol')}
                    className="py-3 px-3 cursor-pointer hover:text-white transition-colors"
                  >
                    <div className="flex items-center gap-1">
                      <span>Name</span>
                      <ArrowUpDown className="w-3 h-3 text-slate-500" />
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort('qty')}
                    className="py-3 px-3 text-right cursor-pointer hover:text-white transition-colors"
                  >
                    <div className="flex items-center justify-end gap-1">
                      <span>Quantity</span>
                      <ArrowUpDown className="w-3 h-3 text-slate-500" />
                    </div>
                  </th>
                  <th className="py-3 px-3 text-right">Avg. Price</th>
                  <th className="py-3 px-3 text-right">LTP</th>
                  <th
                    onClick={() => handleSort('invested')}
                    className="py-3 px-3 text-right cursor-pointer hover:text-white transition-colors"
                  >
                    <div className="flex items-center justify-end gap-1">
                      <span>Inv. Amt.</span>
                      <ArrowUpDown className="w-3 h-3 text-slate-500" />
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort('val')}
                    className="py-3 px-3 text-right cursor-pointer hover:text-white transition-colors"
                  >
                    <div className="flex items-center justify-end gap-1">
                      <span>Current Val.</span>
                      <ArrowUpDown className="w-3 h-3 text-slate-500" />
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort('pnl')}
                    className="py-3 px-3 text-right cursor-pointer hover:text-white transition-colors"
                  >
                    <div className="flex items-center justify-end gap-1">
                      <span>Overall G/L</span>
                      <ArrowUpDown className="w-3 h-3 text-slate-500" />
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort('day_pnl')}
                    className="py-3 px-3 text-right cursor-pointer hover:text-white transition-colors"
                  >
                    <div className="flex items-center justify-end gap-1">
                      <span>Day's G/L</span>
                      <ArrowUpDown className="w-3 h-3 text-slate-500" />
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {filteredHoldings.map((h, idx) => {
                  const ltp = h.current_ltp || h.average_price;
                  const inv = h.invested_amount ?? (h.quantity * h.average_price);
                  const val = h.valuation ?? (h.quantity * ltp);
                  const pnl = h.unrealized_pnl ?? (val - inv);
                  const pnlPct = h.pnl_percentage ?? (inv > 0 ? (pnl / inv) * 100 : 0);
                  const closePrice = h.close_price || ltp;
                  const dayPnl = h.day_pnl ?? ((ltp - closePrice) * h.quantity);
                  const dayPnlPct = h.day_pnl_percentage ?? (((ltp - closePrice) / closePrice) * 100);
                  const isOverallGain = pnl >= 0;
                  const isDayGain = dayPnl >= 0;
                  const sym = h.trading_symbol || `${h.symbol}-EQ`;
                  const isSelected = selectedSymbols.has(h.symbol);
                  const flash = flashMap[h.symbol];

                  return (
                    <tr
                      key={idx}
                      className={`hover:bg-slate-50/90 transition-colors group ${isSelected ? 'bg-brand-50/30' : ''}`}
                    >
                      <td className="py-3.5 px-3 text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(h.symbol)}
                          className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                        />
                      </td>

                      {/* Name + Angel One broker style quick action buttons [ B ] [ S ] [ ⋮ ] */}
                      <td className="py-3.5 px-3">
                        <div className="flex items-center gap-2.5">
                          <button
                            type="button"
                            onClick={() => onOpenDetailsModal(h, 'chart')}
                            className="font-bold text-slate-900 text-xs hover:text-brand-600 text-left transition-colors flex items-center gap-1.5"
                            title="Click to open live TradingView candlestick chart"
                          >
                            <span>{h.symbol}</span>
                            <span className="text-[10px] font-mono font-medium px-1.5 py-0.2 bg-slate-100 text-slate-500 rounded border border-slate-200">
                              {h.exchange || 'NSE'}
                            </span>
                          </button>

                          {/* Quick Action Buttons matching Angel One UI */}
                          <div className="flex items-center gap-1 bg-slate-900 p-0.5 rounded-md border border-slate-800 shadow-xs">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onOpenOrderTicket(h, 'BUY');
                              }}
                              className="w-5 h-5 rounded flex items-center justify-center font-bold text-[11px] bg-emerald-500 hover:bg-emerald-400 text-white transition-all transform active:scale-90"
                              title="Buy more shares"
                            >
                              B
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onOpenOrderTicket(h, 'SELL');
                              }}
                              className="w-5 h-5 rounded flex items-center justify-center font-bold text-[11px] bg-rose-500 hover:bg-rose-400 text-white transition-all transform active:scale-90"
                              title="Sell shares"
                            >
                              S
                            </button>
                            <div className="relative">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setActiveMenuIndex(activeMenuIndex === idx ? null : idx);
                                }}
                                className="w-5 h-5 rounded flex items-center justify-center text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
                                title="More options & chart"
                              >
                                <MoreVertical className="w-3 h-3" />
                              </button>

                              {activeMenuIndex === idx && (
                                <div
                                  onMouseLeave={() => setActiveMenuIndex(null)}
                                  className="absolute left-0 top-full mt-1 w-48 bg-white rounded-xl shadow-xl border border-slate-200 py-1.5 z-40 text-left animate-in fade-in zoom-in-95 duration-100"
                                >
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setActiveMenuIndex(null);
                                      onOpenDetailsModal(h, 'chart');
                                    }}
                                    className="w-full px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 flex items-center gap-2 font-semibold"
                                  >
                                    <BarChart2 className="w-3.5 h-3.5 text-brand-600" />
                                    <span>TradingView Chart</span>
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setActiveMenuIndex(null);
                                      onOpenDetailsModal(h, 'depth');
                                    }}
                                    className="w-full px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                                  >
                                    <Layers className="w-3.5 h-3.5 text-slate-400" />
                                    <span>Market Depth</span>
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setActiveMenuIndex(null);
                                      onOpenDetailsModal(h, 'details');
                                    }}
                                    className="w-full px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                                  >
                                    <Eye className="w-3.5 h-3.5 text-slate-400" />
                                    <span>Stock Details</span>
                                  </button>
                                  <div className="border-t border-slate-100 my-1" />
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setActiveMenuIndex(null);
                                      navigator.clipboard.writeText(sym);
                                      showToast(`Copied ${sym} to clipboard`);
                                    }}
                                    className="w-full px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 flex items-center gap-2 font-mono"
                                  >
                                    <Copy className="w-3.5 h-3.5 text-slate-400" />
                                    <span>Copy Symbol</span>
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Quantity */}
                      <td className="py-3.5 px-3 text-right">
                        <span className="font-mono font-bold text-slate-900 text-xs">{h.quantity}</span>
                      </td>

                      {/* Avg Price */}
                      <td className="py-3.5 px-3 text-right font-mono text-slate-700 text-xs">
                        ₹{h.average_price.toFixed(2)}
                      </td>

                      {/* LTP with live sub-second tick flash */}
                      <td className="py-3.5 px-3 text-right font-mono font-bold text-xs">
                        <div className="flex items-center justify-end gap-1">
                          <span
                            className={`px-1.5 py-0.5 rounded transition-all duration-300 ${
                              flash === 'UP'
                                ? 'bg-emerald-500/25 text-emerald-600 scale-105 inline-block font-bold'
                                : flash === 'DOWN'
                                ? 'bg-rose-500/25 text-rose-600 scale-105 inline-block font-bold'
                                : 'text-slate-900'
                            }`}
                          >
                            ₹{ltp.toFixed(2)}
                          </span>
                          <span className={`w-1.5 h-1.5 rounded-full ${h.is_market_price_live ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300'}`} />
                        </div>
                      </td>

                      {/* Inv. Amt. */}
                      <td className="py-3.5 px-3 text-right font-mono text-slate-700 text-xs">
                        ₹{inv.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>

                      {/* Current Val. */}
                      <td className="py-3.5 px-3 text-right font-mono font-bold text-slate-900 text-xs">
                        ₹{val.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>

                      {/* Overall G/L */}
                      <td className={`py-3.5 px-3 text-right font-mono font-bold text-xs ${
                        isOverallGain ? 'text-emerald-600' : 'text-rose-600'
                      }`}>
                        <div>{isOverallGain ? '+' : ''}₹{pnl.toFixed(2)}</div>
                        <div className="text-[10px] font-semibold">{isOverallGain ? '+' : ''}{pnlPct.toFixed(2)}%</div>
                      </td>

                      {/* Day's G/L */}
                      <td className={`py-3.5 px-3 text-right font-mono font-bold text-xs ${
                        isDayGain ? 'text-emerald-600' : 'text-rose-600'
                      }`}>
                        <div>{isDayGain ? '+' : ''}₹{dayPnl.toFixed(2)}</div>
                        <div className="text-[10px] font-semibold">{isDayGain ? '+' : ''}{dayPnlPct.toFixed(2)}%</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
