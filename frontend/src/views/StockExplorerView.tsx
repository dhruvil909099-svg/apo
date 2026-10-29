import React, { useState, useEffect, useMemo } from 'react';
import {
  Search, TrendingUp, TrendingDown, BarChart2,
  Activity, ArrowRight, ShieldCheck, Layers, RefreshCw,
  Clock, Database, Eye, ShoppingCart, Filter, Sparkles
} from 'lucide-react';
import { MarketInstrument, OptionChainResponse, CommodityContract, MarketSessionStatus, Account, IndexInfo } from '../types';
import { api, getWebSocketUrl } from '../api';
import { StockChart } from '../components/StockChart';
import { OrderTicketModal } from '../components/OrderTicketModal';
import { OptionChainModal } from '../components/OptionChainModal';

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

  // Benchmark Indices and Option Chain Modal State
  const [indices, setIndices] = useState<IndexInfo[]>([]);
  const [selectedOptionChainIndex, setSelectedOptionChainIndex] = useState<IndexInfo | null>(null);
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

  // Live real-time tick prices cache
  const [livePrices, setLivePrices] = useState<Record<string, { ltp: number; change?: number; changePercent?: number }>>({});

  // Real-time live tick subscription for displayed instruments
  useEffect(() => {
    let ws: WebSocket | null = null;
    let pingInterval: any = null;

    try {
      ws = new WebSocket(getWebSocketUrl());
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'TICK' && msg.ltp) {
            const ltp = Number(msg.ltp);
            const pClose = msg.previous_close ? Number(msg.previous_close) : undefined;
            const chg = msg.change !== undefined ? Number(msg.change) : (pClose ? ltp - pClose : undefined);
            const chgPct = msg.change_percent !== undefined ? Number(msg.change_percent) : (pClose && chg ? (chg / pClose) * 100 : undefined);

            setLivePrices((prev) => {
              const updated = { ...prev };
              const data = { ltp, change: chg, changePercent: chgPct };
              if (msg.symbol) {
                updated[msg.symbol.toUpperCase()] = data;
                updated[msg.symbol.replace('-EQ', '').toUpperCase()] = data;
              }
              if (msg.symbol_token) updated[String(msg.symbol_token)] = data;
              return updated;
            });
          }
        } catch {
          // ignore malformed tick
        }
      };

      ws.onopen = () => {
        pingInterval = setInterval(() => {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'PING' }));
          }
        }, 15000);
      };
    } catch {
      // offline fallback
    }

    return () => {
      if (pingInterval) clearInterval(pingInterval);
      if (ws) ws.close();
    };
  }, []);

  // Quick quote lookup map by symbol, clean symbol, or symbol_token
  const quoteMap = useMemo(() => {
    const map = new Map<string, { ltp: number; change: number; change_percent: number; previous_close?: number }>();
    for (const q of quotes || []) {
      const data = { ltp: q.ltp, change: q.change, change_percent: q.change_percent, previous_close: q.previous_close };
      if (q.symbol) {
        map.set(q.symbol.toUpperCase(), data);
        map.set(q.symbol.replace('-EQ', '').toUpperCase(), data);
      }
      if (q.symbol_token) {
        map.set(String(q.symbol_token), data);
      }
    }
    return map;
  }, [quotes]);

  const getInstrumentPrice = (inst: MarketInstrument) => {
    const cleanSym = inst.tradingsymbol.replace('-EQ', '').toUpperCase();
    const live = (inst.symbol_token ? livePrices[String(inst.symbol_token)] : undefined) ||
                 livePrices[inst.tradingsymbol.toUpperCase()] ||
                 livePrices[cleanSym];
    const quote = (inst.symbol_token ? quoteMap.get(String(inst.symbol_token)) : undefined) ||
                  quoteMap.get(inst.tradingsymbol.toUpperCase()) ||
                  quoteMap.get(cleanSym);

    const ltp = live?.ltp ?? inst.current_ltp ?? quote?.ltp;
    const pClose = inst.previous_close ?? quote?.previous_close;
    const chg = live?.change ?? inst.day_change ?? quote?.change ?? (pClose && ltp ? ltp - pClose : undefined);
    const chgPct = live?.changePercent ?? inst.day_change_percentage ?? quote?.change_percent ?? (pClose && chg ? (chg / pClose) * 100 : undefined);

    return { ltp, change: chg, changePercent: chgPct };
  };

  // Fetch catalog summary, session state, accounts, and benchmark indices once on mount
  useEffect(() => {
    const fetchMetadata = async () => {
      try {
        const [sum, sess, accs, idxs] = await Promise.all([
          api.getCatalogSummary().catch(() => null),
          api.getMarketSessionStatus().catch(() => null),
          api.getAccounts().catch(() => []),
          api.getMarketIndices().catch(() => [])
        ]);
        if (sum) setCatalogSummary(sum);
        if (sess) setSessionStatus(sess);
        if (accs && accs.length) setAccounts(accs);
        if (idxs && idxs.length) setIndices(idxs);
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
          const list = res.instruments || [];
          setInstruments(list);
          setTotalCount(res.total_count || 0);

          // Auto-fetch live market quotes for visible instruments
          if (list.length > 0) {
            const tokens = list
              .filter((i) => i.symbol_token && i.exchange)
              .map((i) => ({ exchange: i.exchange, symbol_token: i.symbol_token }));
            if (tokens.length > 0) {
              api.getBatchMarketQuotes(tokens.slice(0, 50), 'FULL').then((qRes) => {
                if (!isSubscribed || !qRes?.fetched || qRes.fetched.length === 0) return;
                const qMap = new Map<string, any>();
                for (const q of qRes.fetched) {
                  if (q.symbol_token) qMap.set(String(q.symbol_token), q);
                  if (q.trading_symbol) qMap.set(q.trading_symbol.replace('-EQ', '').toUpperCase(), q);
                }
                setInstruments((prev) =>
                  prev.map((item) => {
                    const q = (item.symbol_token ? qMap.get(String(item.symbol_token)) : undefined) ||
                              qMap.get(item.tradingsymbol.replace('-EQ', '').toUpperCase());
                    if (q && q.ltp) {
                      const netChg = q.net_change ?? q.change ?? (q.previous_close ? q.ltp - q.previous_close : undefined);
                      const pctChg = q.percent_change ?? q.change_percent ?? (q.previous_close && netChg ? (netChg / q.previous_close) * 100 : undefined);
                      return {
                        ...item,
                        current_ltp: q.ltp,
                        previous_close: q.previous_close,
                        day_change: netChg,
                        day_change_percentage: pctChg,
                      };
                    }
                    return item;
                  })
                );
              }).catch(() => {
                // Ignore transient batch quote errors
              });
            }
          }
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

        {/* Market Indices & Dynamic Option Chains Section */}
        <div className="pt-2 border-t border-slate-100">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
              <Layers className="w-4 h-4 text-brand-600" />
              <span>Market Indices & Option Chains</span>
              <span className="text-[10px] font-semibold text-slate-400 font-mono">(Authorized SmartAPI Live Quotes)</span>
            </div>
            <span className="text-[11px] text-slate-500">Click any card to open real dynamic Option Chain</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
            {indices.map((idx) => {
              const isPos = (idx.net_change ?? 0) >= 0;
              return (
                <div
                  key={idx.id}
                  onClick={() => setSelectedOptionChainIndex(idx)}
                  className="group bg-slate-50 hover:bg-white border border-slate-200 hover:border-brand-500 rounded-xl p-3 cursor-pointer shadow-2xs hover:shadow-md transition-all duration-200 flex flex-col justify-between"
                  title={`Open ${idx.name} Option Chain (${idx.derivatives_exchange})`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-900 group-hover:text-brand-600 transition-colors">
                      {idx.name}
                    </span>
                    <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-white border border-slate-200 text-slate-600">
                      {idx.exchange}
                    </span>
                  </div>

                  <div className="my-1.5">
                    <div className="text-sm font-bold font-mono text-slate-900">
                      {typeof idx.ltp === 'number' && Number.isFinite(idx.ltp)
                        ? idx.ltp.toLocaleString('en-IN', { minimumFractionDigits: 2 })
                        : 'Price unavailable'}
                    </div>
                    {typeof idx.net_change === 'number' && Number.isFinite(idx.net_change) ? (
                      <div className={`text-[10px] font-semibold flex items-center gap-0.5 ${isPos ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {isPos ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                        <span>
                          {isPos ? '+' : ''}{idx.net_change.toFixed(2)}
                          {typeof idx.percent_change === 'number' && Number.isFinite(idx.percent_change)
                            ? ` (${isPos ? '+' : ''}${idx.percent_change.toFixed(2)}%)`
                            : ''}
                        </span>
                      </div>
                    ) : (
                      <div className="text-[10px] text-slate-400">Quote pending</div>
                    )}
                  </div>

                  <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[10px]">
                    <span className={`px-1.5 py-0.2 rounded font-bold ${
                      idx.freshness_status === 'LIVE' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                    }`}>
                      {idx.freshness_status}
                    </span>
                    <span className="font-semibold text-brand-600 group-hover:underline flex items-center gap-0.5">
                      <span>Option Chain</span>
                      <ArrowRight className="w-2.5 h-2.5" />
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

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
                    <th className="py-2.5 px-4 text-right">Price</th>
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
                      <td className="py-2.5 px-4 text-right font-mono">
                        {(() => {
                          const priceInfo = getInstrumentPrice(inst);
                          if (priceInfo.ltp !== undefined && priceInfo.ltp !== null && priceInfo.ltp > 0) {
                            const chg = priceInfo.change;
                            const isUp = (chg ?? 0) >= 0;
                            const isZero = (chg ?? 0) === 0;
                            const textColor = isZero ? 'text-slate-600' : isUp ? 'text-emerald-600' : 'text-rose-600';
                            const arrow = isZero ? '' : isUp ? '▲' : '▼';
                            const sign = (chg ?? 0) > 0 ? '+' : '';

                            return (
                              <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
                                <span className="font-bold text-slate-900 text-xs">
                                  ₹{priceInfo.ltp.toFixed(2)}
                                </span>
                                {chg !== undefined && chg !== null && (
                                  <span className={`text-[11px] font-semibold flex items-center gap-0.5 ${textColor}`}>
                                    {arrow && <span className="text-[9px]">{arrow}</span>}
                                    <span>{sign}{chg.toFixed(2)} ({sign}{(priceInfo.changePercent ?? 0).toFixed(2)}%)</span>
                                  </span>
                                )}
                              </div>
                            );
                          }
                          return <span className="text-slate-400 text-xs font-normal">—</span>;
                        })()}
                      </td>
                      <td className="py-2.5 px-4 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() => {
                              const p = getInstrumentPrice(inst);
                              setChartSelection({
                                symbol: inst.tradingsymbol,
                                exchange: inst.exchange || 'NSE',
                                symbolToken: inst.symbol_token,
                                companyName: inst.name || inst.tradingsymbol,
                                currentLtp: p.ltp || inst.current_ltp || undefined,
                                lotSize: inst.lot_size,
                              });
                            }}
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
              initialRange="MAX"
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

      {/* Dynamic Real Option Chain Modal */}
      {selectedOptionChainIndex && (
        <OptionChainModal
          isOpen={Boolean(selectedOptionChainIndex)}
          index={selectedOptionChainIndex}
          onClose={() => setSelectedOptionChainIndex(null)}
          onOpenOrderTicket={(contract, side) => {
            handleOpenOrderTicket(
              {
                tradingsymbol: contract.tradingsymbol,
                name: `${contract.tradingsymbol} Option`,
                exchange: contract.exchange,
                symbol_token: contract.symbol_token,
                current_ltp: contract.current_ltp,
                lot_size: contract.lot_size,
                tick_size: contract.tick_size,
                segment: contract.exchange,
                instrument_type: 'OPTION',
                is_active: true,
              } as any,
              side
            );
          }}
        />
      )}

      {/* Reusable Order Ticket Modal */}
      {isOrderModalOpen && orderTicketInstrument && (
        <OrderTicketModal
          isOpen={isOrderModalOpen}
          account={accounts[0] || null}
          holding={{
            symbol: orderTicketInstrument.tradingsymbol,
            trading_symbol: orderTicketInstrument.tradingsymbol,
            company_name: orderTicketInstrument.name,
            exchange: orderTicketInstrument.exchange,
            symbol_token: orderTicketInstrument.symbol_token,
            quantity: 0,
            average_price: orderTicketInstrument.current_ltp ?? 0,
            current_ltp: orderTicketInstrument.current_ltp ?? undefined,
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
