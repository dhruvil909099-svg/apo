import React, { useState } from 'react';
import {
  Search, TrendingUp, TrendingDown, BarChart2,
  Activity, ArrowRight, ShieldCheck, Layers
} from 'lucide-react';
import { IPO, MarketQuote } from '../types';
import { StockChart } from '../components/StockChart';

interface StockExplorerViewProps {
  ipos: IPO[];
  quotes: MarketQuote[];
  onNavigateToBulkOrders?: (symbol: string) => void;
}

export const StockExplorerView: React.FC<StockExplorerViewProps> = ({
  ipos,
  quotes,
  onNavigateToBulkOrders
}) => {
  const [search, setSearch] = useState('');
  const [selectedSymbol, setSelectedSymbol] = useState<string>(
    ipos[0]?.symbol || 'TATATECH'
  );

  // Combine IPO records and Market Quotes
  const instrumentList = ipos.map((ipo) => {
    const q = quotes.find((quote) => quote.symbol === ipo.symbol);
    const ltp = q ? q.ltp : (ipo.current_ltp || ipo.issue_price);
    const prev = q ? q.previous_close : (ipo.previous_close || ipo.issue_price);
    const change = round(ltp - prev, 2);
    const changePct = round((change / prev) * 100, 2);

    return {
      symbol: ipo.symbol,
      company_name: ipo.company_name,
      exchange: ipo.exchange || 'NSE',
      issue_price: ipo.issue_price,
      current_ltp: ltp,
      previous_close: prev,
      change,
      change_percent: changePct,
      status: ipo.status,
      symbol_token: ipo.symbol_token || '0'
    };
  });

  const filtered = instrumentList.filter(
    (item) =>
      item.symbol.toLowerCase().includes(search.toLowerCase()) ||
      item.company_name.toLowerCase().includes(search.toLowerCase())
  );

  function round(val: number, decimals: number) {
    return Number(Math.round(Number(val + 'e' + decimals)) + 'e-' + decimals);
  }

  return (
    <div className="space-y-6">
      {/* Search Header */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold text-slate-900">Stock Explorer & Interactive Charts</h1>
              <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-brand-50 text-brand-700 border border-brand-200">
                Angel One Style
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Inspect candlestick OHLCV charts, live prices, and family account holdings per stock.
            </p>
          </div>

          {/* Quick Search */}
          <div className="relative w-72">
            <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search by symbol or company name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-brand-500"
            />
          </div>
        </div>

        {/* Quick Instrument Carousel / Pill Selector */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 pt-2 border-t border-slate-100 text-xs">
          {filtered.length === 0 ? (
            <span className="text-xs text-slate-400">No instruments match "{search}"</span>
          ) : (
            filtered.map((inst) => {
              const isSelected = selectedSymbol === inst.symbol;
              const isUp = inst.change >= 0;
              return (
                <button
                  key={inst.symbol}
                  onClick={() => setSelectedSymbol(inst.symbol)}
                  className={`px-3 py-2 rounded-lg border flex-shrink-0 text-left transition-all ${
                    isSelected
                      ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                      : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold">{inst.symbol}</span>
                    <span className={`text-[10px] font-bold num-mono ${isSelected ? (isUp ? 'text-emerald-400' : 'text-rose-400') : (isUp ? 'text-finGreen' : 'text-finRed')}`}>
                      {isUp ? '+' : ''}{inst.change_percent.toFixed(2)}%
                    </span>
                  </div>
                  <div className="text-[11px] num-mono font-medium opacity-80 mt-0.5">
                    ₹{inst.current_ltp.toFixed(2)}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Main Stock Chart Component */}
      <div className="space-y-4">
        <StockChart symbol={selectedSymbol} />
      </div>
    </div>
  );
};
