import React, { useState, useEffect, useMemo } from 'react';
import {
  Search, TrendingUp, TrendingDown, BarChart2,
  Activity, ArrowRight, ShieldCheck, Layers, RefreshCw,
  Clock, Database, Eye, ShoppingCart, Filter, Sparkles
} from 'lucide-react';
import { MarketInstrument, OptionChainResponse, CommodityContract, MarketSessionStatus, Account } from '../types';
import { api } from '../api';
import { StockChart } from '../components/StockChart';
import { OrderTicketModal } from '../components/OrderTicketModal';

interface StockExplorerViewProps {
  ipos?: import('../types').IPO[];
  quotes?: import('../types').MarketQuote[];
  onNavigateToBulkOrders?: (symbol: string) => void;
}

type MainCategory = 'ALL' | 'NSE' | 'BSE' | 'FUTURES' | 'OPTIONS' | 'COMMODITIES' | 'INDICES';

const ALPHABET = ['ALL', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'];

export const StockExplorerView: React.FC<StockExplorerViewProps> = ({
  ipos,
  quotes,
  onNavigateToBulkOrders
}) => {
  const [activeCategory, setActiveCategory] = useState<MainCategory>('ALL');
  const [selectedLetter, setSelectedLetter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [instruments, setInstruments] = useState<MarketInstrument[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [page, setPage] = useState<number>(0);
  const pageSize = 50;
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [catalogSummary, setCatalogSummary] = useState<any>(null);
  const [sessionStatus, setSessionStatus] = useState<MarketSessionStatus | null>(null);

  // Accounts for Order Ticket
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [orderTicketSide, setOrderTicketSide] = useState<'BUY' | 'SELL'>('BUY');
  
  // Selected for TradingView Lightweight Chart Modal
  const [chartSelection, setChartSelection] = useState<{
    symbol: string;
    exchange: string;
    symbolToken?: string;
    companyName?: string;
    currentLtp?: number;
    lotSize?: number;
  } | null>(null);
  
  // Selected for Order Ticket
  const [orderTicketInstrument, setOrderTicketInstrument] = useState<MarketInstrument | null>(null);
  const [isOrderModalOpen, setIsOrderModalOpen] = useState<boolean>(false);

  // Option Chain state
  const [optionUnderlying, setOptionUnderlying] = useState<string>('NIFTY');
  const [optionChainData, setOptionChainData] = useState<OptionChainResponse | null>(null);
  const [selectedExpiry, setSelectedExpiry] = useState<string | null>(null);
  const [isLoadingChain, setIsLoadingChain] = useState<boolean>(false);

  // Commodities state
  const [commodities, setCommodities] = useState<CommodityContract[]>([]);
  const [isLoadingCommodities, setIsLoadingCommodities] = useState<boolean>(false);

  // Fetch catalog summary, session state, and accounts once on mount
  useEffect(() => {
    const fetchMetadata = async () => {
      try {
        const [sum, sess, accs] = await Promise.all([
          api.getCatalogSummary().catch(() => null),
          api.getMarketSessionStatus().catch(() => null),
          api.getAccounts().catch(() => [])
        ]);
        if (sum) setCatalogSummary(sum);
        if (sess) setSessionStatus(sess);
        if (accs && accs.length) setAccounts(accs);
      } catch (err) {
        console.error('Failed to load market metadata:', err);
      }
    };
    fetchMetadata();
  }, []);

  // Fetch instruments when filters change
  useEffect(() => {
    let isSubscribed = true;
    const fetchCatalog = async () => {
      setIsLoading(true);
      try {
        let exchange: string | undefined = undefined;
        let segment: string | undefined = undefined;

        if (activeCategory === 'NSE') {
          exchange = 'NSE';
          segment = 'EQUITY';
        } else if (activeCategory === 'BSE') {
          exchange = 'BSE';
          segment = 'EQUITY';
        } else if (activeCategory === 'FUTURES') {
          segment = 'FUTURES';
        } else if (activeCategory === 'OPTIONS') {
          segment = 'OPTIONS';
        } else if (activeCategory === 'COMMODITIES') {
          exchange = 'MCX';
          segment = 'COMMODITY';
        } else if (activeCategory === 'INDICES') {
          segment = 'INDEX';
        }

        const letter = selectedLetter !== 'ALL' ? selectedLetter : undefined;

        const res = await api.searchInstruments({
          query: searchQuery || undefined,
          exchange,
          segment,
          letter,
          limit: pageSize,
          offset: page * pageSize
        });

        if (isSubscribed) {
          setInstruments(res.instruments || []);
          setTotalCount(res.total_count || 0);
        }
      } catch (err) {
        console.error('Failed to search instruments:', err);
        if (isSubscribed) {
          setInstruments([]);
          setTotalCount(0);
        }
      } finally {
        if (isSubscribed) setIsLoading(false);
      }
    };

    const timer = setTimeout(fetchCatalog, 200);
    return () => {
      isSubscribed = false;
      clearTimeout(timer);
    };
  }, [activeCategory, selectedLetter, searchQuery, page]);

  // Load Option Chain if Options tab is active
  useEffect(() => {
    if (activeCategory !== 'OPTIONS') return;

    let isSubscribed = true;
    const loadChain = async () => {
      setIsLoadingChain(true);
      try {
        const res = await api.getOptionChain(optionUnderlying, selectedExpiry || undefined);
        if (isSubscribed) {
          setOptionChainData(res);
          if (res.selected_expiry && !selectedExpiry) {
            setSelectedExpiry(res.selected_expiry);
          }
        }
      } catch (err) {
        console.error('Failed to load option chain:', err);
      } finally {
        if (isSubscribed) setIsLoadingChain(false);
      }
    };

    loadChain();
    return () => { isSubscribed = false; };
  }, [activeCategory, optionUnderlying, selectedExpiry]);

  // Load MCX Commodities if Commodities tab is active
  useEffect(() => {
    if (activeCategory !== 'COMMODITIES') return;

    let isSubscribed = true;
    const loadCommodities = async () => {
      setIsLoadingCommodities(true);
      try {
        const res = await api.getCommodities();
        if (isSubscribed) {
          setCommodities(res || []);
        }
      } catch (err) {
        console.error('Failed to load commodities:', err);
      } finally {
        if (isSubscribed) setIsLoadingCommodities(false);
      }
    };

    loadCommodities();
    return () => { isSubscribed = false; };
  }, [activeCategory]);

  const handleOpenOrderTicket = (inst: MarketInstrument, side: 'BUY' | 'SELL' = 'BUY') => {
    setOrderTicketSide(side);
    setOrderTicketInstrument(inst);
    setIsOrderModalOpen(true);
  };

  return (
    <div className="space-y-6">
      {/* Header & Session Awareness Banner */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold text-slate-900">A–Z Stock Explorer & Interactive Charts</h1>
              <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-brand-50 text-brand-700 border border-brand-200">
                Official Angel One Master
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Authoritative catalog of {catalogSummary?.total_instruments?.toLocaleString() || '151,000+'} exchange securities across NSE, BSE, NFO, BFO, and MCX.
            </p>
          </div>

          {/* Session Status Pill */}
          {sessionStatus && (
            <div className="flex items-center gap-3 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-xs">
              <div className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${sessionStatus.is_equity_open ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
                <span className="font-semibold text-slate-800">
                  Equity: {sessionStatus.equity_segment.session_name}
                </span>
              </div>
              <span className="text-slate-300">|</span>
              <div className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${sessionStatus.is_commodity_open ? 'bg-amber-500 animate-pulse' : 'bg-slate-400'}`} />
                <span className="font-semibold text-slate-800">
                  MCX: {sessionStatus.commodity_segment.session_name}
                </span>
              </div>
              <span className="text-[10px] text-slate-400">({sessionStatus.time} IST)</span>
            </div>
          )}
        </div>

        {/* Catalog Statistics Cards */}
        {catalogSummary?.counts_by_exchange && (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-2 border-t border-slate-100">
            <div className="bg-slate-50 rounded-lg p-2 border border-slate-100">
              <span className="text-[10px] text-slate-500 uppercase font-semibold">NSE Cash</span>
              <p className="text-sm font-bold text-slate-900">
                {catalogSummary.counts_by_exchange.NSE?.toLocaleString() || '10,080'}
              </p>
            </div>
            <div className="bg-slate-50 rounded-lg p-2 border border-slate-100">
              <span className="text-[10px] text-slate-500 uppercase font-semibold">BSE Cash</span>
              <p className="text-sm font-bold text-slate-900">
                {catalogSummary.counts_by_exchange.BSE?.toLocaleString() || '13,022'}
              </p>
            </div>
            <div className="bg-slate-50 rounded-lg p-2 border border-slate-100">
              <span className="text-[10px] text-slate-500 uppercase font-semibold">NFO Derivatives</span>
              <p className="text-sm font-bold text-slate-900">
                {catalogSummary.counts_by_exchange.NFO?.toLocaleString() || '32,512'}
              </p>
            </div>
            <div className="bg-slate-50 rounded-lg p-2 border border-slate-100">
              <span className="text-[10px] text-slate-500 uppercase font-semibold">BFO Derivatives</span>
              <p className="text-sm font-bold text-slate-900">
                {catalogSummary.counts_by_exchange.BFO?.toLocaleString() || '43,609'}
              </p>
            </div>
            <div className="bg-slate-50 rounded-lg p-2 border border-slate-100">
              <span className="text-[10px] text-slate-500 uppercase font-semibold">MCX Commodities</span>
              <p className="text-sm font-bold text-slate-900">
                {catalogSummary.counts_by_exchange.MCX?.toLocaleString() || '41,229'}
              </p>
            </div>
          </div>
        )}

        {/* Category Tabs & Search Bar */}
        <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
          {/* Main Segment Tabs */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
            {[
              { id: 'ALL', label: 'All Instruments' },
              { id: 'NSE', label: 'NSE Equity' },
              { id: 'BSE', label: 'BSE Equity' },
              { id: 'FUTURES', label: 'Futures (NFO)' },
              { id: 'OPTIONS', label: 'Options Chain' },
              { id: 'COMMODITIES', label: 'MCX Commodities' },
              { id: 'INDICES', label: 'Indices' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveCategory(tab.id as MainCategory);
                  setPage(0);
                }}
                className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                  activeCategory === tab.id
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Search Input */}
          <div className="relative w-80">
            <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search symbol (e.g. HINDCOPPER, TCS, GOLD)..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(0);
              }}
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-brand-500"
            />
          </div>
        </div>

        {/* A–Z Letter Browser Bar */}
        <div className="flex items-center gap-1 overflow-x-auto pt-2 border-t border-slate-100 text-[11px]">
          <span className="text-slate-400 font-semibold px-1 text-[10px] uppercase">A–Z:</span>
          {ALPHABET.map((ltr) => (
            <button
              key={ltr}
              onClick={() => {
                setSelectedLetter(ltr);
                setPage(0);
              }}
              className={`px-2 py-0.5 rounded text-xs transition-colors font-medium ${
                selectedLetter === ltr
                  ? 'bg-brand-600 text-white font-bold'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {ltr}
            </button>
          ))}
        </div>
      </div>

      {/* Main Content Areas */}
      {activeCategory === 'OPTIONS' ? (
        /* Dedicated Options Chain Subview */
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-base font-bold text-slate-900">Options Chain Matrix</h2>
              <p className="text-xs text-slate-500">
                Paired Call (CE) and Put (PE) contracts across strikes for {optionUnderlying}.
              </p>
            </div>

            <div className="flex items-center gap-3">
              {/* Underlying Selector */}
              <select
                value={optionUnderlying}
                onChange={(e) => {
                  setOptionUnderlying(e.target.value);
                  setSelectedExpiry(null);
                }}
                className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 font-semibold text-slate-800"
              >
                <option value="NIFTY">NIFTY</option>
                <option value="BANKNIFTY">BANKNIFTY</option>
                <option value="FINNIFTY">FINNIFTY</option>
                <option value="HINDCOPPER">HINDCOPPER</option>
                <option value="RELIANCE">RELIANCE</option>
                <option value="TCS">TCS</option>
              </select>

              {/* Expiry Selector */}
              {optionChainData?.available_expiries && optionChainData.available_expiries.length > 0 && (
                <select
                  value={selectedExpiry || ''}
                  onChange={(e) => setSelectedExpiry(e.target.value)}
                  className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 font-semibold text-slate-800"
                >
                  {optionChainData.available_expiries.map((exp) => (
                    <option key={exp} value={exp}>
                      Expiry: {exp}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {isLoadingChain ? (
            <div className="py-12 text-center text-xs text-slate-500">
              <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-slate-400" />
              Loading verified option chain for {optionUnderlying}...
            </div>
          ) : !optionChainData || optionChainData.strikes.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-500">
              No active option contracts found for {optionUnderlying} at the selected expiry.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase text-[10px]">
                    <th className="py-2 px-3 text-right text-emerald-700 bg-emerald-50/50">Call (CE) Symbol</th>
                    <th className="py-2 px-3 text-right bg-emerald-50/50">Lot Size</th>
                    <th className="py-2 px-3 text-right bg-emerald-50/50">LTP</th>
                    <th className="py-2 px-4 text-center font-bold text-slate-900 bg-slate-100">STRIKE PRICE</th>
                    <th className="py-2 px-3 text-left bg-rose-50/50">LTP</th>
                    <th className="py-2 px-3 text-left bg-rose-50/50">Lot Size</th>
                    <th className="py-2 px-3 text-left text-rose-700 bg-rose-50/50">Put (PE) Symbol</th>
                    <th className="py-2 px-3 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {optionChainData.strikes.map((row) => (
                    <tr key={row.strike} className="hover:bg-slate-50 transition-colors">
                      {/* CALL SIDE */}
                      <td className="py-2 px-3 text-right font-medium text-slate-700">
                        {row.call ? row.call.tradingsymbol : '—'}
                      </td>
                      <td className="py-2 px-3 text-right text-slate-500">
                        {row.call ? row.call.lot_size : '—'}
                      </td>
                      <td className="py-2 px-3 text-right font-semibold text-slate-900">
                        {row.call?.current_ltp ? `₹${row.call.current_ltp.toFixed(2)}` : 'Live quote req'}
                      </td>

                      {/* STRIKE */}
                      <td className="py-2 px-4 text-center font-bold text-slate-900 bg-slate-50 border-x border-slate-200">
                        ₹{row.strike.toLocaleString()}
                      </td>

                      {/* PUT SIDE */}
                      <td className="py-2 px-3 text-left font-semibold text-slate-900">
                        {row.put?.current_ltp ? `₹${row.put.current_ltp.toFixed(2)}` : 'Live quote req'}
                      </td>
                      <td className="py-2 px-3 text-left text-slate-500">
                        {row.put ? row.put.lot_size : '—'}
                      </td>
                      <td className="py-2 px-3 text-left font-medium text-slate-700">
                        {row.put ? row.put.tradingsymbol : '—'}
                      </td>

                      {/* ACTIONS */}
                      <td className="py-2 px-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          {row.call && (
                            <button
                              onClick={() => setChartSelection({
                                symbol: row.call!.tradingsymbol,
                                exchange: row.call!.exchange || 'NFO',
                                symbolToken: row.call!.symbol_token,
                                companyName: `${optionUnderlying} CE ${row.strike}`,
                                currentLtp: row.call!.current_ltp || undefined,
                                lotSize: row.call!.lot_size,
                              })}
                              className="px-2 py-0.5 text-[10px] rounded bg-emerald-50 text-emerald-700 hover:bg-emerald-100 font-medium"
                              title="Inspect Call Chart"
                            >
                              CE Chart
                            </button>
                          )}
                          {row.put && (
                            <button
                              onClick={() => setChartSelection({
                                symbol: row.put!.tradingsymbol,
                                exchange: row.put!.exchange || 'NFO',
                                symbolToken: row.put!.symbol_token,
                                companyName: `${optionUnderlying} PE ${row.strike}`,
                                currentLtp: row.put!.current_ltp || undefined,
                                lotSize: row.put!.lot_size,
                              })}
                              className="px-2 py-0.5 text-[10px] rounded bg-rose-50 text-rose-700 hover:bg-rose-100 font-medium"
                              title="Inspect Put Chart"
                            >
                              PE Chart
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : activeCategory === 'COMMODITIES' ? (
        /* Dedicated MCX Commodities Subview */
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-4">
          <div className="border-b border-slate-100 pb-3">
            <h2 className="text-base font-bold text-slate-900">Multi Commodity Exchange (MCX) Contracts</h2>
            <p className="text-xs text-slate-500">
              Verified active commodity contracts with segment specifications and 09:00 - 23:30 IST trading hours.
            </p>
          </div>

          {isLoadingCommodities ? (
            <div className="py-12 text-center text-xs text-slate-500">
              <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-slate-400" />
              Loading verified MCX commodities...
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {commodities.slice(0, 30).map((comm) => (
                <div
                  key={`${comm.exchange}_${comm.symbol_token}`}
                  className="p-3.5 rounded-lg border border-slate-200 hover:border-slate-300 bg-slate-50/50 hover:bg-white transition-all space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-bold text-slate-900 text-xs">{comm.tradingsymbol}</span>
                      <p className="text-[11px] text-slate-500">{comm.contract_name}</p>
                    </div>
                    <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200">
                      MCX
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-1 text-[11px] pt-1 border-t border-slate-100">
                    <div>
                      <span className="text-[10px] text-slate-400 block">Lot Size</span>
                      <span className="font-semibold text-slate-700">{comm.lot_size}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400 block">Tick Size</span>
                      <span className="font-semibold text-slate-700">{comm.tick_size}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400 block">Expiry</span>
                      <span className="font-semibold text-slate-700">{comm.expiry || 'Cash'}</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2">
                    <span className="text-[10px] text-slate-400">Hours: {comm.trading_hours}</span>
                    <button
                      onClick={() => setChartSelection({
                        symbol: comm.tradingsymbol,
                        exchange: comm.exchange || 'MCX',
                        symbolToken: comm.symbol_token,
                        companyName: comm.contract_name || comm.commodity_name,
                        currentLtp: comm.current_ltp || undefined,
                        lotSize: comm.lot_size,
                      })}
                      className="px-2.5 py-1 text-xs rounded bg-slate-900 text-white hover:bg-slate-800 font-medium"
                    >
                      View Chart
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        /* Standard Catalog Table for All / NSE / BSE / Futures / Indices */
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex items-center justify-between">
            <span className="text-xs text-slate-500">
              Showing {instruments.length} of {totalCount.toLocaleString()} instruments
              {searchQuery ? ` matching "${searchQuery}"` : ''}
            </span>

            {/* Pagination Controls */}
            <div className="flex items-center gap-2 text-xs">
              <button
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                className="px-2.5 py-1 rounded border border-slate-200 bg-white text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50"
              >
                Previous
              </button>
              <span className="text-slate-600 font-medium">
                Page {page + 1} of {Math.ceil(totalCount / pageSize) || 1}
              </span>
              <button
                disabled={(page + 1) * pageSize >= totalCount}
                onClick={() => setPage((p) => p + 1)}
                className="px-2.5 py-1 rounded border border-slate-200 bg-white text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50"
              >
                Next
              </button>
            </div>
          </div>

          {isLoading ? (
            <div className="py-16 text-center text-xs text-slate-500">
              <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-slate-400" />
              Searching official exchange catalog...
            </div>
          ) : instruments.length === 0 ? (
            <div className="py-16 text-center text-xs text-slate-500 space-y-2">
              <Database className="w-6 h-6 mx-auto text-slate-300" />
              <p className="font-semibold text-slate-700">No instruments found matching criteria.</p>
              <p className="text-[11px] text-slate-400">Try adjusting your search query, segment tab, or A–Z letter filter.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase text-[10px]">
                    <th className="py-2.5 px-4">Instrument / Company</th>
                    <th className="py-2.5 px-3">Exchange & Segment</th>
                    <th className="py-2.5 px-3">Type</th>
                    <th className="py-2.5 px-3 text-right">Lot Size</th>
                    <th className="py-2.5 px-3 text-right">Tick Size</th>
                    <th className="py-2.5 px-3">Expiry</th>
                    <th className="py-2.5 px-3 text-right">LTP</th>
                    <th className="py-2.5 px-4 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {instruments.map((inst) => (
                    <tr key={`${inst.exchange}_${inst.symbol_token}`} className="hover:bg-slate-50 transition-colors">
                      <td className="py-2.5 px-4">
                        <div className="font-bold text-slate-900">{inst.tradingsymbol}</div>
                        <div className="text-[11px] text-slate-500 truncate max-w-xs">{inst.name}</div>
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-slate-800">{inst.exchange}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-medium">
                            {inst.segment}
                          </span>
                        </div>
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="text-slate-600 font-medium">{inst.instrument_type}</span>
                        {inst.strike ? ` (₹${inst.strike})` : ''}
                      </td>
                      <td className="py-2.5 px-3 text-right font-medium text-slate-700">
                        {inst.lot_size}
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-500">
                        {inst.tick_size}
                      </td>
                      <td className="py-2.5 px-3 text-slate-600">
                        {inst.expiry || '—'}
                      </td>
                      <td className="py-2.5 px-3 text-right font-semibold text-slate-900">
                        {inst.current_ltp ? `₹${inst.current_ltp.toFixed(2)}` : (
                          <span className="text-[10px] text-slate-400 font-normal">Live quote req</span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() => setChartSelection({
                              symbol: inst.tradingsymbol,
                              exchange: inst.exchange || 'NSE',
                              symbolToken: inst.symbol_token,
                              companyName: inst.name || inst.tradingsymbol,
                              currentLtp: inst.current_ltp || undefined,
                              lotSize: inst.lot_size,
                            })}
                            className="px-2.5 py-1 text-xs rounded border border-slate-200 bg-white hover:bg-slate-50 font-medium text-slate-700"
                          >
                            Chart
                          </button>
                          <button
                            onClick={() => handleOpenOrderTicket(inst)}
                            className="px-2.5 py-1 text-xs rounded bg-brand-600 hover:bg-brand-700 font-medium text-white shadow-xs"
                          >
                            Trade
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Interactive TradingView Lightweight Chart Modal */}
      {chartSelection && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/80 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-[#0b0b0d] text-slate-100 rounded-2xl shadow-2xl border border-slate-800 w-full max-w-6xl overflow-hidden flex flex-col max-h-[92vh]">
            <StockChart
              key={`${chartSelection.exchange}_${chartSelection.symbolToken || chartSelection.symbol}`}
              symbol={chartSelection.symbol}
              exchange={chartSelection.exchange}
              symbolToken={chartSelection.symbolToken}
              companyName={chartSelection.companyName}
              initialLtp={chartSelection.currentLtp}
              height={520}
              onClose={() => setChartSelection(null)}
              onBuy={(price) => {
                handleOpenOrderTicket(
                  {
                    tradingsymbol: chartSelection.symbol,
                    name: chartSelection.companyName || chartSelection.symbol,
                    exchange: chartSelection.exchange,
                    symbol_token: chartSelection.symbolToken || '',
                    current_ltp: price,
                    lot_size: chartSelection.lotSize || 1,
                    tick_size: 0.05,
                    segment: chartSelection.exchange,
                    instrument_type: 'EQUITY',
                    is_active: true,
                  } as any,
                  'BUY'
                );
              }}
              onSell={(price) => {
                handleOpenOrderTicket(
                  {
                    tradingsymbol: chartSelection.symbol,
                    name: chartSelection.companyName || chartSelection.symbol,
                    exchange: chartSelection.exchange,
                    symbol_token: chartSelection.symbolToken || '',
                    current_ltp: price,
                    lot_size: chartSelection.lotSize || 1,
                    tick_size: 0.05,
                    segment: chartSelection.exchange,
                    instrument_type: 'EQUITY',
                    is_active: true,
                  } as any,
                  'SELL'
                );
              }}
            />
          </div>
        </div>
      )}

      {/* Reusable Order Ticket Modal */}
      {isOrderModalOpen && orderTicketInstrument && (
        <OrderTicketModal
          isOpen={isOrderModalOpen}
          account={accounts[0] || ({
            id: 1,
            client_code: 'DEMO',
            nickname: 'Default Trading Account',
            broker_name: 'Angel One',
            is_active: true,
            is_demo: false,
            ddpi_status: 'ACTIVE',
            edis_authorized_today: true,
            account_group: 'Primary',
            total_portfolio_value: 0,
            available_cash: 500000,
            used_margin: 0,
            total_realized_pnl: 0,
            total_unrealized_pnl: 0,
            synced_at: new Date().toISOString()
          } as any)}
          holding={{
            symbol: orderTicketInstrument.tradingsymbol,
            trading_symbol: orderTicketInstrument.tradingsymbol,
            company_name: orderTicketInstrument.name,
            exchange: orderTicketInstrument.exchange,
            quantity: 0,
            average_price: orderTicketInstrument.current_ltp || 100,
            current_ltp: orderTicketInstrument.current_ltp || 100,
            source_type: 'SNAPSHOT'
          }}
          defaultSide={orderTicketSide}
          onClose={() => {
            setIsOrderModalOpen(false);
            setOrderTicketInstrument(null);
          }}
          onOrderSuccess={(msg) => {
            setIsOrderModalOpen(false);
            setOrderTicketInstrument(null);
          }}
        />
      )}
    </div>
  );
};
