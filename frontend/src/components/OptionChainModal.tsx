import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  X, Star, Search, RefreshCw, TrendingUp, TrendingDown,
  BarChart2, Info, Layers, ChevronDown, Check, ExternalLink
} from 'lucide-react';
import { IndexInfo, ExpiryInfo, OptionChainResponse, OptionChainStrike, OptionContractDetails } from '../types';
import { api } from '../api';
import { StockChart } from './StockChart';

interface OptionChainModalProps {
  isOpen: boolean;
  index: IndexInfo | null;
  onClose: () => void;
  onOpenOrderTicket?: (contract: OptionContractDetails, side: 'BUY' | 'SELL') => void;
}

export const OptionChainModal: React.FC<OptionChainModalProps> = ({
  isOpen,
  index,
  onClose,
  onOpenOrderTicket,
}) => {
  const [activeTab, setActiveTab] = useState<'charts' | 'overview' | 'option_chain'>('option_chain');
  const [basketMode, setBasketMode] = useState<boolean>(false);
  const [isStarred, setIsStarred] = useState<boolean>(false);

  // Expiries & Selected Expiry
  const [expiries, setExpiries] = useState<ExpiryInfo[]>([]);
  const [selectedExpiry, setSelectedExpiry] = useState<string>('');
  const [isExpiryDropdownOpen, setIsExpiryDropdownOpen] = useState<boolean>(false);

  // Option Chain Data
  const [chainData, setChainData] = useState<OptionChainResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Search Strike Filter
  const [searchStrike, setSearchStrike] = useState<string>('');

  // Selected contract to view chart
  const [chartContract, setChartContract] = useState<{
    symbol: string;
    token: string;
    exchange: string;
    name: string;
  } | null>(null);

  const dropdownRef = useRef<HTMLDivElement | null>(null);

  const underlying = index?.symbol || 'NIFTY';
  const exch = index?.exchange || 'NSE';
  const derivExch = index?.derivatives_exchange || (exch === 'BSE' ? 'BFO' : 'NFO');

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsExpiryDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // 1. Fetch available dynamic expiries when modal opens or index changes
  useEffect(() => {
    if (!isOpen || !index) return;
    setIsLoading(true);
    setErrorMsg(null);
    setChartContract(null);
    setActiveTab('option_chain');

    api.getOptionChainExpiries(underlying)
      .then((data) => {
        setExpiries(data || []);
        if (data && data.length > 0) {
          setSelectedExpiry(data[0].raw);
        } else {
          setSelectedExpiry('');
        }
      })
      .catch((err) => {
        setErrorMsg(err.message || 'Unable to load option expiries.');
      });
  }, [isOpen, underlying]);

  // 2. Fetch Option Chain when selectedExpiry changes
  useEffect(() => {
    if (!isOpen || !index || !selectedExpiry) return;
    setIsLoading(true);
    setErrorMsg(null);

    api.getOptionChain(underlying, selectedExpiry)
      .then((res) => {
        setChainData(res);
        setIsLoading(false);
      })
      .catch((err) => {
        setErrorMsg(err.message || 'Unable to load option chain strikes.');
        setIsLoading(false);
      });
  }, [isOpen, underlying, selectedExpiry]);

  // Derived Spot Price & Change
  const spotLtp = chainData?.spot_ltp ?? index?.ltp ?? null;
  const spotChange = chainData?.spot_change ?? index?.net_change ?? null;
  const spotChangePct = chainData?.spot_change_percent ?? index?.percent_change ?? null;
  const isPositive = (spotChange ?? 0) >= 0;

  // Selected expiry object
  const currentExpiryObj = useMemo(() => {
    return expiries.find((e) => e.raw === selectedExpiry) || expiries[0] || null;
  }, [expiries, selectedExpiry]);

  // Filter strikes
  const filteredStrikes = useMemo(() => {
    if (!chainData?.strikes) return [];
    if (!searchStrike.trim()) return chainData.strikes;
    const q = searchStrike.trim();
    return chainData.strikes.filter((s) => s.strike.toString().includes(q));
  }, [chainData?.strikes, searchStrike]);

  // ATM Strike identification
  const atmStrike = useMemo(() => {
    if (chainData?.atm_strike) return chainData.atm_strike;
    if (!spotLtp || !chainData?.strikes || chainData.strikes.length === 0) return null;
    return chainData.strikes.reduce((prev, curr) => {
      return Math.abs(curr.strike - spotLtp) < Math.abs(prev.strike - spotLtp) ? curr : prev;
    }).strike;
  }, [chainData, spotLtp]);

  if (!isOpen || !index) return null;

  // Format numbers cleanly
  const formatVol = (val?: number | null) => {
    if (val === null || val === undefined || typeof val !== 'number' || !Number.isFinite(val)) return '—';
    if (val >= 10000000) return `${(val / 10000000).toFixed(2)}Cr`;
    if (val >= 100000) return `${(val / 100000).toFixed(2)}L`;
    if (val >= 1000) return `${(val / 1000).toFixed(1)}K`;
    return val.toString();
  };

  const formatOI = (val?: number | null) => {
    if (val === null || val === undefined || typeof val !== 'number' || !Number.isFinite(val)) return '—';
    if (val >= 10000000) return `${(val / 10000000).toFixed(2)} Cr`;
    if (val >= 100000) return `${(val / 100000).toFixed(2)} L`;
    if (val >= 1000) return `${(val / 1000).toFixed(1)} K`;
    return val.toString();
  };

  const formatLtp = (val?: number | null) => {
    if (val === null || val === undefined || typeof val !== 'number' || !Number.isFinite(val)) return '—';
    return `₹${val.toFixed(2)}`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-2 sm:p-4 animate-in fade-in duration-200">
      <div className="bg-[#0e0f14] border border-[#232634] w-full max-w-6xl h-[92vh] max-h-[920px] rounded-xl flex flex-col shadow-2xl overflow-hidden text-gray-100">
        
        {/* HEADER */}
        <div className="flex items-center justify-between px-6 py-3.5 border-b border-[#1f222e] bg-[#12141c]">
          {/* Left: Index title & badge */}
          <div className="flex items-center space-x-3">
            <h2 className="text-xl font-bold tracking-tight text-white flex items-center space-x-2">
              <span>{index.name || index.symbol}</span>
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-[#1e2336] text-blue-400 border border-blue-500/30">
                {exch}
              </span>
            </h2>
            <span className="text-xs font-medium text-gray-400 tracking-wider">INDEX</span>
          </div>

          {/* Right: Spot level, Net change, Star, Buy/Sell, Close */}
          <div className="flex items-center space-x-4">
            <div className="text-right">
              <span className={`text-lg font-bold font-mono ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
                {typeof spotLtp === 'number' && Number.isFinite(spotLtp) ? spotLtp.toLocaleString('en-IN', { minimumFractionDigits: 2 }) : 'Price unavailable'}
              </span>
              {typeof spotChange === 'number' && Number.isFinite(spotChange) && (
                <span className={`ml-2 text-xs font-semibold ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {isPositive ? '+' : ''}{spotChange.toFixed(2)}
                  {typeof spotChangePct === 'number' && Number.isFinite(spotChangePct) ? ` (${isPositive ? '+' : ''}${spotChangePct.toFixed(2)}%)` : ''}
                </span>
              )}
            </div>

            <button
              onClick={() => setIsStarred(!isStarred)}
              className={`p-2 rounded-lg border transition ${
                isStarred
                  ? 'border-amber-500/50 text-amber-400 bg-amber-500/10'
                  : 'border-[#272b3b] text-gray-400 hover:text-white hover:bg-[#1a1d28]'
              }`}
              title="Add to Watchlist"
            >
              <Star className="w-4 h-4 fill-current" />
            </button>

            <button
              onClick={() => {
                if (onOpenOrderTicket) {
                  onOpenOrderTicket({
                    symbol_token: index.symbol_token,
                    tradingsymbol: index.symbol,
                    exchange: index.exchange,
                    lot_size: index.lot_size,
                    tick_size: index.tick_size,
                    current_ltp: spotLtp
                  }, 'BUY');
                }
              }}
              className="px-3.5 py-1.5 rounded-lg text-xs font-bold uppercase bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm transition"
            >
              BUY
            </button>

            <button
              onClick={() => {
                if (onOpenOrderTicket) {
                  onOpenOrderTicket({
                    symbol_token: index.symbol_token,
                    tradingsymbol: index.symbol,
                    exchange: index.exchange,
                    lot_size: index.lot_size,
                    tick_size: index.tick_size,
                    current_ltp: spotLtp
                  }, 'SELL');
                }
              }}
              className="px-3.5 py-1.5 rounded-lg text-xs font-bold uppercase bg-rose-600 hover:bg-rose-500 text-white shadow-sm transition"
            >
              SELL
            </button>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-[#1e2230] transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* TABS & BASKET MODE */}
        <div className="flex items-center justify-between px-6 border-b border-[#1f222e] bg-[#0f1118]">
          <div className="flex space-x-6 text-sm font-semibold">
            <button
              onClick={() => setActiveTab('charts')}
              className={`py-3 border-b-2 transition flex items-center space-x-1.5 ${
                activeTab === 'charts'
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-gray-400 hover:text-gray-200'
              }`}
            >
              <BarChart2 className="w-4 h-4" />
              <span>Charts</span>
            </button>

            <button
              onClick={() => setActiveTab('overview')}
              className={`py-3 border-b-2 transition flex items-center space-x-1.5 ${
                activeTab === 'overview'
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-gray-400 hover:text-gray-200'
              }`}
            >
              <Info className="w-4 h-4" />
              <span>Overview</span>
            </button>

            <button
              onClick={() => setActiveTab('option_chain')}
              className={`py-3 border-b-2 transition flex items-center space-x-1.5 ${
                activeTab === 'option_chain'
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-gray-400 hover:text-gray-200'
              }`}
            >
              <Layers className="w-4 h-4" />
              <span>Option Chain</span>
            </button>
          </div>

          <div className="flex items-center space-x-2">
            <span className="text-xs font-medium text-gray-400">Basket mode</span>
            <button
              onClick={() => setBasketMode(!basketMode)}
              className={`w-9 h-5 flex items-center rounded-full p-0.5 transition duration-200 ${
                basketMode ? 'bg-blue-600' : 'bg-[#272b3b]'
              }`}
            >
              <div
                className={`bg-white w-4 h-4 rounded-full shadow-md transform transition duration-200 ${
                  basketMode ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>

        {/* TAB 1: CHARTS TAB */}
        {activeTab === 'charts' && (
          <div className="flex-1 p-4 bg-[#0a0c10] overflow-hidden flex flex-col">
            <div className="flex-1 bg-[#12141c] rounded-xl border border-[#1f222e] overflow-hidden p-3">
              <StockChart
                symbol={index.symbol}
                symbolToken={index.symbol_token}
                exchange={index.exchange}
                companyName={`${index.name} Index`}
                initialRange="MAX"
                onBuy={() => onOpenOrderTicket && onOpenOrderTicket({ symbol_token: index.symbol_token, tradingsymbol: index.symbol, exchange: index.exchange, lot_size: index.lot_size, tick_size: index.tick_size, current_ltp: spotLtp }, 'BUY')}
                onSell={() => onOpenOrderTicket && onOpenOrderTicket({ symbol_token: index.symbol_token, tradingsymbol: index.symbol, exchange: index.exchange, lot_size: index.lot_size, tick_size: index.tick_size, current_ltp: spotLtp }, 'SELL')}
              />
            </div>
          </div>
        )}

        {/* TAB 2: OVERVIEW TAB */}
        {activeTab === 'overview' && (
          <div className="flex-1 p-6 bg-[#0a0c10] overflow-y-auto space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-[#12141c] border border-[#1f222e] rounded-xl p-4">
                <span className="text-xs text-gray-400 font-semibold uppercase tracking-wider">Spot Level</span>
                <p className="text-2xl font-bold font-mono text-white mt-1">
                  {spotLtp ? `₹${spotLtp.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : 'Unavailable'}
                </p>
                <p className={`text-xs font-semibold mt-1 ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {typeof spotChange === 'number' && Number.isFinite(spotChange) ? `${isPositive ? '+' : ''}${spotChange.toFixed(2)}` : ''}
                  {typeof spotChangePct === 'number' && Number.isFinite(spotChangePct) ? ` (${isPositive ? '+' : ''}${spotChangePct.toFixed(2)}%)` : ''}
                </p>
              </div>

              <div className="bg-[#12141c] border border-[#1f222e] rounded-xl p-4">
                <span className="text-xs text-gray-400 font-semibold uppercase tracking-wider">Derivatives Exchange</span>
                <p className="text-2xl font-bold font-mono text-white mt-1">{derivExch}</p>
                <p className="text-xs text-gray-400 mt-1">Cash Underlying on {exch}</p>
              </div>

              <div className="bg-[#12141c] border border-[#1f222e] rounded-xl p-4">
                <span className="text-xs text-gray-400 font-semibold uppercase tracking-wider">Active Expiries</span>
                <p className="text-2xl font-bold font-mono text-white mt-1">{expiries.length}</p>
                <p className="text-xs text-gray-400 mt-1">Nearest: {expiries[0]?.display || 'None'}</p>
              </div>
            </div>

            <div className="bg-[#12141c] border border-[#1f222e] rounded-xl p-4">
              <h4 className="text-sm font-bold text-gray-200 uppercase tracking-wider mb-3">Specification & Rules</h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                <div>
                  <span className="text-gray-400">Underlying Token</span>
                  <p className="font-mono font-bold text-gray-200 mt-0.5">{index.symbol_token}</p>
                </div>
                <div>
                  <span className="text-gray-400">Lot Size</span>
                  <p className="font-mono font-bold text-gray-200 mt-0.5">{index.lot_size}</p>
                </div>
                <div>
                  <span className="text-gray-400">Tick Size</span>
                  <p className="font-mono font-bold text-gray-200 mt-0.5">{index.tick_size}</p>
                </div>
                <div>
                  <span className="text-gray-400">ATM Strike</span>
                  <p className="font-mono font-bold text-emerald-400 mt-0.5">{atmStrike || '—'}</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: OPTION CHAIN TAB */}
        {activeTab === 'option_chain' && (
          <div className="flex-1 flex flex-col min-h-0 bg-[#0a0c10]">
            
            {/* SUBBAR: Spot pill, Expiry dropdown, Search Strike */}
            <div className="px-6 py-3 border-b border-[#1b1e2a] bg-[#11131b] flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center space-x-3">
                {/* Spot pill */}
                <div className="flex items-center space-x-2 px-3 py-1.5 rounded-lg bg-[#181b26] border border-[#272b3c]">
                  <span className="text-xs font-bold text-white">{underlying}</span>
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[#202538] text-blue-400">
                    {exch}
                  </span>
                  <span className={`text-xs font-mono font-bold ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {typeof spotLtp === 'number' && Number.isFinite(spotLtp) ? spotLtp.toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '—'}
                  </span>
                  {typeof spotChange === 'number' && Number.isFinite(spotChange) && (
                    <span className={`text-[11px] font-semibold flex items-center ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {isPositive ? '▲ +' : '▼ '}{spotChange.toFixed(2)}
                      {typeof spotChangePct === 'number' && Number.isFinite(spotChangePct) ? ` (${isPositive ? '+' : ''}${spotChangePct.toFixed(2)}%)` : ''}
                    </span>
                  )}
                </div>

                {/* Expiry Selector Dropdown */}
                <div className="relative" ref={dropdownRef}>
                  <button
                    onClick={() => setIsExpiryDropdownOpen(!isExpiryDropdownOpen)}
                    className="flex items-center space-x-2 px-3 py-1.5 rounded-lg bg-[#181b26] border border-[#272b3c] hover:border-blue-500/50 text-xs font-semibold text-white transition"
                  >
                    <span>{currentExpiryObj?.display || 'Select Expiry'}</span>
                    {currentExpiryObj?.type && (
                      <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30">
                        {currentExpiryObj.type}
                      </span>
                    )}
                    <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
                  </button>

                  {isExpiryDropdownOpen && (
                    <div className="absolute left-0 mt-1 w-52 max-h-64 overflow-y-auto bg-[#161822] border border-[#2a2e40] rounded-lg shadow-xl z-30 py-1">
                      {expiries.map((exp) => (
                        <button
                          key={exp.raw}
                          onClick={() => {
                            setSelectedExpiry(exp.raw);
                            setIsExpiryDropdownOpen(false);
                          }}
                          className={`w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-left hover:bg-[#202434] transition ${
                            selectedExpiry === exp.raw ? 'text-blue-400 bg-blue-500/10 font-bold' : 'text-gray-300'
                          }`}
                        >
                          <div className="flex items-center space-x-2">
                            <span>{exp.display}</span>
                            <span className="text-[10px] px-1 rounded bg-[#272b3d] text-gray-300">
                              {exp.type}
                            </span>
                          </div>
                          {selectedExpiry === exp.raw && <Check className="w-3.5 h-3.5 text-blue-400" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Search Strike */}
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search Strike"
                  value={searchStrike}
                  onChange={(e) => setSearchStrike(e.target.value)}
                  className="pl-8 pr-3 py-1.5 rounded-lg bg-[#181b26] border border-[#272b3c] focus:border-blue-500 text-xs text-white placeholder-gray-500 outline-none w-36 sm:w-48 transition"
                />
              </div>
            </div>

            {/* TWO-SIDED OPTION CHAIN TABLE */}
            <div className="flex-1 overflow-auto bg-[#0b0c10]">
              {isLoading ? (
                <div className="h-full flex flex-col items-center justify-center space-y-3 py-16 text-gray-400">
                  <RefreshCw className="w-6 h-6 animate-spin text-blue-500" />
                  <span className="text-xs font-medium tracking-wide">Loading authentic strikes & quotes from SmartAPI...</span>
                </div>
              ) : errorMsg ? (
                <div className="h-full flex flex-col items-center justify-center space-y-2 py-16 text-rose-400">
                  <span className="text-sm font-semibold">{errorMsg}</span>
                  <span className="text-xs text-gray-400">No active derivatives contracts listed for this date.</span>
                </div>
              ) : (
                <div className="min-w-[1000px] text-xs">
                  
                  {/* MAIN HEADER ROW */}
                  <div className="sticky top-0 z-20 grid grid-cols-11 bg-[#13151f] border-b border-[#242738] text-[11px] font-bold text-gray-300 select-none shadow-sm">
                    {/* CALL SIDE (Cols 1-5) */}
                    <div className="col-span-5 grid grid-cols-5 py-2.5 text-center bg-[#171a26] border-r border-[#26293a] text-blue-300 uppercase tracking-wider font-semibold">
                      <div className="col-span-5 text-center text-xs pb-1 border-b border-[#26293a]/60 font-bold">
                        CALL
                      </div>
                      <div className="py-1">Volume</div>
                      <div className="py-1">OI Chg (%)</div>
                      <div className="py-1">OI</div>
                      <div className="py-1 col-span-2">LTP (Change%)</div>
                    </div>

                    {/* STRIKE (Col 6) */}
                    <div className="col-span-1 flex items-center justify-center py-2 bg-[#1a1d2c] text-white font-extrabold uppercase tracking-wider border-r border-[#26293a]">
                      Strike
                    </div>

                    {/* PUT SIDE (Cols 7-11) */}
                    <div className="col-span-5 grid grid-cols-5 py-2.5 text-center bg-[#171a26] text-amber-300 uppercase tracking-wider font-semibold">
                      <div className="col-span-5 text-center text-xs pb-1 border-b border-[#26293a]/60 font-bold">
                        PUT
                      </div>
                      <div className="py-1 col-span-2">LTP (Change%)</div>
                      <div className="py-1">OI</div>
                      <div className="py-1">OI Chg (%)</div>
                      <div className="py-1">Volume</div>
                    </div>
                  </div>

                  {/* STRIKE ROWS */}
                  {filteredStrikes.map((s, idx) => {
                    const isATM = s.strike === atmStrike;
                    const call = s.call;
                    const put = s.put;

                    // In The Money (ITM) calculations:
                    // For Call: Strike < Spot is ITM (warm amber/yellowish tint)
                    // For Put: Strike > Spot is ITM (cool purple/indigo tint)
                    const isCallITM = spotLtp !== null && s.strike < spotLtp;
                    const isPutITM = spotLtp !== null && s.strike > spotLtp;

                    const callLtp = call?.current_ltp ?? null;
                    const callChgPct = call?.day_change_percentage ?? null;
                    const callIsPos = (callChgPct ?? 0) >= 0;

                    const putLtp = put?.current_ltp ?? null;
                    const putChgPct = put?.day_change_percentage ?? null;
                    const putIsPos = (putChgPct ?? 0) >= 0;

                    return (
                      <React.Fragment key={s.strike}>
                        {/* ATM SPOT DIVIDER LINE */}
                        {isATM && (
                          <div className="relative py-1 flex items-center justify-center bg-gradient-to-r from-emerald-950/40 via-emerald-800/60 to-emerald-950/40 border-y border-emerald-500/50 shadow-inner">
                            <span className="px-3 py-0.5 rounded-full text-[11px] font-bold font-mono bg-emerald-500 text-black shadow-lg">
                              Spot: {spotLtp?.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                            </span>
                          </div>
                        )}

                        <div className={`grid grid-cols-11 border-b border-[#181a24] hover:bg-[#181c28] transition duration-150 ${
                          isATM ? 'bg-[#151926]' : ''
                        }`}>
                          {/* CALL SIDE */}
                          <div
                            onClick={() => {
                              if (call) {
                                setChartContract({
                                  symbol: call.tradingsymbol,
                                  token: call.symbol_token,
                                  exchange: call.exchange,
                                  name: `${call.tradingsymbol} Chart`
                                });
                              }
                            }}
                            className={`col-span-5 grid grid-cols-5 py-2.5 px-1 items-center border-r border-[#222534] cursor-pointer group ${
                              isCallITM ? 'bg-amber-950/20' : 'bg-transparent'
                            }`}
                            title={call ? `Click to open ${call.tradingsymbol} chart` : 'No CALL contract listed'}
                          >
                            {/* Volume */}
                            <div className="text-center font-mono text-gray-400 group-hover:text-gray-200">
                              {formatVol(call?.volume)}
                            </div>
                            {/* OI Change */}
                            <div className="text-center font-mono text-gray-400">
                              {call?.oi_change !== null && call?.oi_change !== undefined ? (
                                <span className={call.oi_change >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                                  {formatOI(call.oi_change)}
                                </span>
                              ) : (
                                '—'
                              )}
                            </div>
                            {/* OI */}
                            <div className="text-center font-mono font-semibold text-cyan-300">
                              {formatOI(call?.open_interest)}
                            </div>
                            {/* LTP (Change%) */}
                            <div className="col-span-2 text-right pr-3 font-mono">
                              <span className="font-bold text-emerald-400">
                                {formatLtp(callLtp)}
                              </span>
                              {typeof callChgPct === 'number' && Number.isFinite(callChgPct) && (
                                <span className={`ml-1.5 text-[10px] font-semibold ${callIsPos ? 'text-emerald-400' : 'text-rose-400'}`}>
                                  ({callIsPos ? '+' : ''}{callChgPct.toFixed(1)}%)
                                </span>
                              )}
                            </div>
                          </div>

                          {/* STRIKE (CENTER) */}
                          <div className={`col-span-1 flex items-center justify-center font-bold font-mono text-sm border-r border-[#222534] select-none ${
                            isATM
                              ? 'text-emerald-400 font-extrabold bg-[#16222b]'
                              : 'text-gray-100 bg-[#12141d]'
                          }`}>
                            {s.strike}
                          </div>

                          {/* PUT SIDE */}
                          <div
                            onClick={() => {
                              if (put) {
                                setChartContract({
                                  symbol: put.tradingsymbol,
                                  token: put.symbol_token,
                                  exchange: put.exchange,
                                  name: `${put.tradingsymbol} Chart`
                                });
                              }
                            }}
                            className={`col-span-5 grid grid-cols-5 py-2.5 px-1 items-center cursor-pointer group ${
                              isPutITM ? 'bg-indigo-950/20' : 'bg-transparent'
                            }`}
                            title={put ? `Click to open ${put.tradingsymbol} chart` : 'No PUT contract listed'}
                          >
                            {/* LTP (Change%) */}
                            <div className="col-span-2 text-left pl-3 font-mono">
                              <span className="font-bold text-rose-400">
                                {formatLtp(putLtp)}
                              </span>
                              {typeof putChgPct === 'number' && Number.isFinite(putChgPct) && (
                                <span className={`ml-1.5 text-[10px] font-semibold ${putIsPos ? 'text-emerald-400' : 'text-rose-400'}`}>
                                  ({putIsPos ? '+' : ''}{putChgPct.toFixed(1)}%)
                                </span>
                              )}
                            </div>
                            {/* OI */}
                            <div className="text-center font-mono font-semibold text-cyan-300">
                              {formatOI(put?.open_interest)}
                            </div>
                            {/* OI Change */}
                            <div className="text-center font-mono text-gray-400">
                              {put?.oi_change !== null && put?.oi_change !== undefined ? (
                                <span className={put.oi_change >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                                  {formatOI(put.oi_change)}
                                </span>
                              ) : (
                                '—'
                              )}
                            </div>
                            {/* Volume */}
                            <div className="text-center font-mono text-gray-400 group-hover:text-gray-200">
                              {formatVol(put?.volume)}
                            </div>
                          </div>
                        </div>
                      </React.Fragment>
                    );
                  })}
                </div>
              )}
            </div>

            {/* FOOTER */}
            <div className="px-6 py-3 border-t border-[#1f222e] bg-[#10121a] flex items-center justify-between text-xs text-gray-400">
              <div className="flex items-center space-x-3">
                <span className="flex items-center space-x-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="font-semibold text-gray-300">Authorized SmartAPI Feed</span>
                </span>
                <span>•</span>
                <span>Click any strike row to open its TradingView Lightweight Chart</span>
              </div>

              <button
                onClick={() => {
                  if (onOpenOrderTicket) {
                    onOpenOrderTicket({
                      symbol_token: index.symbol_token,
                      tradingsymbol: index.symbol,
                      exchange: index.exchange,
                      lot_size: index.lot_size,
                      tick_size: index.tick_size,
                      current_ltp: spotLtp
                    }, 'BUY');
                  }
                }}
                className="px-4 py-1.5 rounded-lg text-xs font-bold uppercase bg-blue-600 hover:bg-blue-500 text-white shadow transition"
              >
                + Create Strategy / Trade
              </button>
            </div>
          </div>
        )}

      </div>

      {/* POPUP CHART MODAL FOR CLICKED OPTION CONTRACT */}
      {chartContract && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/85 backdrop-blur-md p-3 sm:p-6 animate-in fade-in">
          <div className="bg-[#0f1118] border border-[#232738] w-full max-w-5xl h-[85vh] rounded-xl flex flex-col shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-3.5 border-b border-[#202332] bg-[#141620]">
              <div className="flex items-center space-x-3">
                <h3 className="text-base font-bold text-white font-mono">{chartContract.symbol}</h3>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-[#202538] text-blue-400">
                  {chartContract.exchange}
                </span>
              </div>
              <button
                onClick={() => setChartContract(null)}
                className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-[#1e2230] transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 p-4 bg-[#0a0c10]">
              <StockChart
                symbol={chartContract.symbol}
                symbolToken={chartContract.token}
                exchange={chartContract.exchange}
                companyName={chartContract.name}
                initialRange="MAX"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
