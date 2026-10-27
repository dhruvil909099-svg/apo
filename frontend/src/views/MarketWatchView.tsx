import React, { useState, useEffect } from 'react';
import {
  Activity, Search, ArrowUpRight, ArrowDownRight,
  Sliders, RefreshCw, AlertCircle, Info, Zap
} from 'lucide-react';
import { MarketQuote } from '../types';
import { api } from '../api';

interface MarketWatchViewProps {
  quotes: MarketQuote[];
  onRefresh: () => void;
}

export const MarketWatchView: React.FC<MarketWatchViewProps> = ({ quotes, onRefresh }) => {
  const [search, setSearch] = useState('');
  const [simSymbol, setSimSymbol] = useState<string>('TATATECH');
  const [simPrice, setSimPrice] = useState<number>(1050.0);
  const [isUpdatingPrice, setIsUpdatingPrice] = useState(false);
  const [simSuccess, setSimSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (quotes.length > 0 && !simSymbol) {
      setSimSymbol(quotes[0].symbol);
      setSimPrice(quotes[0].ltp);
    }
  }, [quotes]);

  const filteredQuotes = quotes.filter((q) =>
    q.symbol.toLowerCase().includes(search.toLowerCase()) ||
    q.company_name.toLowerCase().includes(search.toLowerCase())
  );

  const handleSimulatePrice = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsUpdatingPrice(true);
    setSimSuccess(null);
    try {
      await api.updatePrice(simSymbol, simPrice);
      setSimSuccess(`Broadcasted price update: ${simSymbol} = ₹${simPrice}`);
      onRefresh();
    } catch (err: any) {
      alert(`Simulation error: ${err.message}`);
    } finally {
      setIsUpdatingPrice(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner: Indian Market Session Rules */}
      <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl flex items-start gap-3 text-xs text-blue-900">
        <Info className="w-5 h-5 text-brand-600 flex-shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="font-bold text-sm text-blue-950">Indian Market IPO Listing Day Session Timings (NSE / BSE)</p>
          <p>
            <strong>09:00 AM – 09:45 AM:</strong> Special Pre-Open order entry session for IPOs.
            <span className="text-red-700 font-bold ml-1">ONLY LIMIT orders are accepted</span>. Market orders and Stop-Loss orders are rejected by the exchange.
          </p>
          <p>
            <strong>09:45 AM – 10:00 AM:</strong> Equilibrium price discovery & buffer. Regular market continuous trading starts at <strong>10:00 AM IST</strong>.
          </p>
        </div>
      </div>

      {/* Grid: Quotes Table & Simulation Testing Control */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Quotes Table */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
          <div className="p-4 border-b border-slate-100 flex items-center justify-between gap-4">
            <div className="relative w-72">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Search instrument..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-slate-300 outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span className="w-2 h-2 rounded-full bg-finGreen animate-ping" />
              <span>Real-Time Watchlist Stream</span>
            </div>
          </div>

          <div className="overflow-x-auto flex-1">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider font-semibold border-b border-slate-200 text-[10px]">
                <tr>
                  <th className="py-3 px-4">Instrument</th>
                  <th className="py-3 px-4">Exch</th>
                  <th className="py-3 px-4">LTP (₹)</th>
                  <th className="py-3 px-4">Change</th>
                  <th className="py-3 px-4">Change %</th>
                  <th className="py-3 px-4">Prev Close</th>
                  <th className="py-3 px-4">Data Source</th>
                  <th className="py-3 px-4">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredQuotes.map((q) => {
                  const isPositive = q.change >= 0;
                  return (
                    <tr key={q.symbol} className="tr-hover">
                      <td className="py-3 px-4">
                        <div className="font-bold text-slate-900">{q.symbol}</div>
                        <div className="text-[11px] text-slate-500 truncate max-w-xs">{q.company_name}</div>
                      </td>
                      <td className="py-3 px-4">
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700">
                          {q.exchange}
                        </span>
                      </td>
                      <td className="py-3 px-4 num-mono font-bold text-sm text-slate-900">
                        ₹{q.ltp.toFixed(2)}
                      </td>
                      <td className="py-3 px-4 num-mono font-semibold">
                        <span className={isPositive ? 'text-finGreen' : 'text-finRed'}>
                          {isPositive ? '+' : ''}{q.change.toFixed(2)}
                        </span>
                      </td>
                      <td className="py-3 px-4 num-mono">
                        <span className={`inline-flex items-center font-bold px-1.5 py-0.5 rounded ${
                          isPositive ? 'bg-finGreen-bg text-finGreen-text' : 'bg-finRed-bg text-finRed-text'
                        }`}>
                          {isPositive ? <ArrowUpRight className="w-3 h-3 mr-0.5" /> : <ArrowDownRight className="w-3 h-3 mr-0.5" />}
                          {isPositive ? '+' : ''}{q.change_percent.toFixed(2)}%
                        </span>
                      </td>
                      <td className="py-3 px-4 num-mono text-slate-500">
                        ₹{q.previous_close.toFixed(2)}
                      </td>
                      <td className="py-3 px-4">
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                          {q.data_source}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-slate-400 font-mono text-[10px]">
                        {new Date(q.timestamp).toLocaleTimeString('en-IN', { hour12: false })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Price Simulator Tool for Paper Testing */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <div className="space-y-4">
            <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
              <Zap className="w-4 h-4 text-brand-600" />
              <div>
                <h3 className="text-sm font-bold text-slate-900 tracking-tight">Price Movement Simulator</h3>
                <p className="text-[11px] text-slate-500">Stimulate paper trading fills & WebSocket ticks</p>
              </div>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Use this control to simulate live market price changes. When price crosses an account's limit sell price, the paper trading engine will automatically match and execute the order!
            </p>

            {simSuccess && (
              <div className="p-2.5 bg-green-50 border border-green-200 rounded-lg text-xs text-green-800 font-medium">
                {simSuccess}
              </div>
            )}

            <form onSubmit={handleSimulatePrice} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-700 font-medium mb-1">Select Instrument</label>
                <select
                  value={simSymbol}
                  onChange={(e) => {
                    setSimSymbol(e.target.value);
                    const q = quotes.find((x) => x.symbol === e.target.value);
                    if (q) setSimPrice(q.ltp);
                  }}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg outline-none bg-white font-bold"
                >
                  {quotes.map((q) => (
                    <option key={q.symbol} value={q.symbol}>
                      {q.symbol} — Currently ₹{q.ltp.toFixed(2)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-700 font-medium mb-1">Simulated New Price (₹)</label>
                <input
                  type="number"
                  step="0.05"
                  required
                  value={simPrice}
                  onChange={(e) => setSimPrice(Number(e.target.value))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg outline-none num-mono font-bold text-base"
                />
              </div>

              {/* Quick Shift Presets */}
              <div className="flex items-center gap-1.5 pt-1">
                <button
                  type="button"
                  onClick={() => setSimPrice((prev) => Number((prev * 1.05).toFixed(2)))}
                  className="flex-1 py-1 bg-green-50 hover:bg-green-100 text-green-800 rounded font-semibold text-[11px]"
                >
                  +5% Surge
                </button>
                <button
                  type="button"
                  onClick={() => setSimPrice((prev) => Number((prev * 1.10).toFixed(2)))}
                  className="flex-1 py-1 bg-green-50 hover:bg-green-100 text-green-800 rounded font-semibold text-[11px]"
                >
                  +10% Circuit
                </button>
                <button
                  type="button"
                  onClick={() => setSimPrice((prev) => Number((prev * 0.95).toFixed(2)))}
                  className="flex-1 py-1 bg-red-50 hover:bg-red-100 text-red-800 rounded font-semibold text-[11px]"
                >
                  -5% Drop
                </button>
              </div>

              <button
                type="submit"
                disabled={isUpdatingPrice}
                className="w-full py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-lg font-semibold shadow-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                <Zap className="w-4 h-4" />
                <span>{isUpdatingPrice ? 'Broadcasting Tick...' : 'Broadcast Price Update'}</span>
              </button>
            </form>
          </div>

          <div className="text-[11px] text-slate-400 border-t border-slate-100 pt-3">
            Simulated ticks do not interact with live exchange order books.
          </div>
        </div>
      </div>
    </div>
  );
};
