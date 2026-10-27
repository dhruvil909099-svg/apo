import React, { useState, useEffect } from 'react';
import {
  TrendingUp, TrendingDown, Clock, BarChart2,
  Activity, RefreshCw, AlertCircle, ShieldCheck
} from 'lucide-react';
import {
  ResponsiveContainer, ComposedChart, AreaChart, Area,
  Bar, XAxis, YAxis, Tooltip, CartesianGrid
} from 'recharts';
import { MarketCandleResponse, MarketCandle } from '../types';
import { api } from '../api';

interface StockChartProps {
  symbol: string;
  initialInterval?: string;
  initialRange?: string;
  onClose?: () => void;
  accountsBreakdown?: Array<{
    account_id: number;
    nickname: string;
    masked_client_code: string;
    account_group: string;
    quantity: number;
    acquisition_cost: number;
    market_value: number;
    unrealized_pnl: number;
    ddpi_status: string;
  }>;
}

// Custom SVG Candlestick Shape Renderer for Recharts
const CandlestickBar = (props: any) => {
  const { x, y, width, height, payload } = props;
  if (!payload) return null;

  const { open, high, low, close } = payload;
  const isUp = close >= open;
  const color = isUp ? '#10b981' : '#ef4444';

  // Calculate coordinates within the candle's bar column
  const openY = y + (height * (high - open)) / (high - low || 1);
  const closeY = y + (height * (high - close)) / (high - low || 1);
  const topY = Math.min(openY, closeY);
  const bodyHeight = Math.max(Math.abs(closeY - openY), 2);
  const candleWidth = Math.max(width * 0.7, 4);
  const candleX = x + (width - candleWidth) / 2;
  const centerX = x + width / 2;

  return (
    <g>
      {/* High-Low Wick */}
      <line
        x1={centerX}
        y1={y}
        x2={centerX}
        y2={y + height}
        stroke={color}
        strokeWidth={1.5}
      />
      {/* Candle Body */}
      <rect
        x={candleX}
        y={topY}
        width={candleWidth}
        height={bodyHeight}
        fill={color}
        stroke={color}
        strokeWidth={1}
        rx={1}
      />
    </g>
  );
};

export const StockChart: React.FC<StockChartProps> = ({
  symbol,
  initialInterval = 'ONE_DAY',
  initialRange = '1M',
  onClose,
  accountsBreakdown = []
}) => {
  const [chartData, setChartData] = useState<MarketCandleResponse | null>(null);
  const [chartType, setChartType] = useState<'candle' | 'line'>('candle');
  const [interval, setInterval] = useState<string>(initialInterval);
  const [rangePeriod, setRangePeriod] = useState<string>(initialRange);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchChart = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.getMarketCandles(symbol, interval, rangePeriod);
      setChartData(data);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch historical market data');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchChart();
  }, [symbol, interval, rangePeriod]);

  const isPositive = (chartData?.change ?? 0) >= 0;

  // Format timestamp for X-Axis based on interval
  const formatXAxis = (tickStr: string) => {
    try {
      const date = new Date(tickStr);
      if (interval.includes('MINUTE') || interval === 'ONE_HOUR') {
        return date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
      }
      return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    } catch {
      return tickStr;
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
      {/* Top Header: Angel One-Style Market Snapshot */}
      <div className="p-5 border-b border-slate-100 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-xl font-bold text-slate-900 tracking-tight">{symbol}</h2>
              <span className="text-xs font-semibold bg-slate-100 text-slate-700 px-2 py-0.5 rounded">
                {chartData?.exchange || 'NSE'}
              </span>
              <span className="text-xs text-slate-500 font-medium truncate max-w-xs">
                {chartData?.company_name}
              </span>
            </div>
            
            {/* Price & Change */}
            <div className="flex items-baseline gap-3 mt-1.5">
              <span className="text-3xl font-extrabold text-slate-900 num-mono tracking-tight">
                ₹{(chartData?.current_ltp ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </span>
              <span className={`flex items-center text-sm font-bold num-mono ${isPositive ? 'text-finGreen' : 'text-finRed'}`}>
                {isPositive ? <TrendingUp className="w-4 h-4 mr-1" /> : <TrendingDown className="w-4 h-4 mr-1" />}
                {isPositive ? '+' : ''}₹{(chartData?.change ?? 0).toFixed(2)} ({isPositive ? '+' : ''}{(chartData?.change_percent ?? 0).toFixed(2)}%)
              </span>
            </div>
          </div>

          {/* Quick Actions & Status */}
          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-2">
              <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold border flex items-center gap-1.5 ${
                chartData?.data_source === 'SMARTAPI_LIVE'
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : 'bg-slate-50 text-slate-600 border-slate-200'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${chartData?.data_source === 'SMARTAPI_LIVE' ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
                {chartData?.data_source === 'SMARTAPI_LIVE' ? 'SMARTAPI LIVE' : 'SIMULATED FEED'}
              </span>
              <button
                onClick={fetchChart}
                disabled={isLoading}
                title="Refresh Market Data"
                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
              </button>
              {onClose && (
                <button
                  onClick={onClose}
                  className="px-2.5 py-1 text-xs font-semibold text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  Close
                </button>
              )}
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-slate-400 font-medium">
              <Clock className="w-3.5 h-3.5" />
              <span>Last update: {chartData?.last_updated || '—'}</span>
            </div>
          </div>
        </div>

        {/* OHLCV Summary Ribbon */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 pt-3 border-t border-slate-100 text-xs">
          <div>
            <span className="text-slate-400 text-[11px]">Open:</span>
            <div className="font-bold text-slate-800 num-mono mt-0.5">
              ₹{(chartData?.open ?? 0).toFixed(2)}
            </div>
          </div>
          <div>
            <span className="text-slate-400 text-[11px]">High:</span>
            <div className="font-bold text-finGreen num-mono mt-0.5">
              ₹{(chartData?.high ?? 0).toFixed(2)}
            </div>
          </div>
          <div>
            <span className="text-slate-400 text-[11px]">Low:</span>
            <div className="font-bold text-finRed num-mono mt-0.5">
              ₹{(chartData?.low ?? 0).toFixed(2)}
            </div>
          </div>
          <div>
            <span className="text-slate-400 text-[11px]">Prev. Close:</span>
            <div className="font-bold text-slate-700 num-mono mt-0.5">
              ₹{(chartData?.previous_close ?? 0).toFixed(2)}
            </div>
          </div>
          <div>
            <span className="text-slate-400 text-[11px]">Period Volume:</span>
            <div className="font-bold text-slate-800 num-mono mt-0.5">
              {(chartData?.volume ?? 0).toLocaleString('en-IN')}
            </div>
          </div>
        </div>
      </div>

      {/* Chart Control Toolbar */}
      <div className="px-5 py-2.5 bg-slate-50 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3 text-xs">
        {/* Interval Selector */}
        <div className="flex items-center gap-1 bg-white p-1 rounded-lg border border-slate-200">
          <span className="text-[10px] uppercase font-bold text-slate-400 px-2">Timeframe:</span>
          {[
            { label: '1m', interval: 'ONE_MINUTE', range: '1D' },
            { label: '5m', interval: 'FIVE_MINUTE', range: '1D' },
            { label: '15m', interval: 'FIFTEEN_MINUTE', range: '1D' },
            { label: '1h', interval: 'ONE_HOUR', range: '1W' },
            { label: '1D', interval: 'ONE_DAY', range: '1M' },
            { label: '3M', interval: 'ONE_DAY', range: '3M' },
            { label: '1Y', interval: 'ONE_DAY', range: '1Y' }
          ].map((item) => {
            const isActive = interval === item.interval && rangePeriod === item.range;
            return (
              <button
                key={`${item.interval}_${item.range}`}
                onClick={() => {
                  setInterval(item.interval);
                  setRangePeriod(item.range);
                }}
                className={`px-2.5 py-1 rounded text-xs font-semibold transition-colors ${
                  isActive
                    ? 'bg-brand-600 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        {/* Chart View Type: Candlestick vs Line */}
        <div className="flex items-center gap-1 bg-white p-1 rounded-lg border border-slate-200">
          <button
            onClick={() => setChartType('candle')}
            className={`px-3 py-1 rounded text-xs font-semibold flex items-center gap-1.5 transition-colors ${
              chartType === 'candle'
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <BarChart2 className="w-3.5 h-3.5" />
            <span>Candles (OHLC)</span>
          </button>
          <button
            onClick={() => setChartType('line')}
            className={`px-3 py-1 rounded text-xs font-semibold flex items-center gap-1.5 transition-colors ${
              chartType === 'line'
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>Line (Area)</span>
          </button>
        </div>
      </div>

      {/* Main Chart Canvas */}
      <div className="p-4 flex-1 min-h-[380px] relative">
        {isLoading ? (
          <div className="absolute inset-0 flex items-center justify-center bg-white/70 z-10">
            <div className="flex flex-col items-center gap-2">
              <RefreshCw className="w-6 h-6 text-brand-600 animate-spin" />
              <span className="text-xs font-semibold text-slate-500">Loading historical candles...</span>
            </div>
          </div>
        ) : error ? (
          <div className="h-80 flex flex-col items-center justify-center text-center p-6">
            <AlertCircle className="w-8 h-8 text-rose-500 mb-2" />
            <h4 className="text-sm font-bold text-slate-800">Chart Data Unavailable</h4>
            <p className="text-xs text-slate-500 mt-1 max-w-sm">{error}</p>
            <button
              onClick={fetchChart}
              className="mt-3 px-4 py-1.5 bg-slate-900 text-white text-xs font-semibold rounded-lg hover:bg-slate-800"
            >
              Retry
            </button>
          </div>
        ) : !chartData || chartData.candles.length === 0 ? (
          <div className="h-80 flex items-center justify-center text-slate-400 text-xs font-medium">
            No historical candles available for this timeframe.
          </div>
        ) : (
          <div className="space-y-4">
            {/* Price Chart */}
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                {chartType === 'candle' ? (
                  <ComposedChart
                    data={chartData.candles}
                    margin={{ top: 10, right: 20, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis
                      dataKey="timestamp"
                      tickFormatter={formatXAxis}
                      stroke="#94a3b8"
                      fontSize={10}
                      tickLine={false}
                    />
                    <YAxis
                      domain={['auto', 'auto']}
                      stroke="#94a3b8"
                      fontSize={10}
                      orientation="right"
                      tickLine={false}
                      tickFormatter={(val) => `₹${val.toFixed(0)}`}
                    />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload || !payload.length) return null;
                        const data: MarketCandle = payload[0].payload;
                        const isUp = data.close >= data.open;
                        return (
                          <div className="bg-slate-900 text-white p-3 rounded-lg shadow-xl text-xs space-y-1.5 border border-slate-700">
                            <div className="text-[10px] text-slate-400 font-mono">
                              {new Date(data.timestamp).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST
                            </div>
                            <div className="grid grid-cols-2 gap-x-4 gap-y-1 num-mono text-[11px]">
                              <div><span className="text-slate-400">Open:</span> ₹{data.open.toFixed(2)}</div>
                              <div><span className="text-slate-400">Close:</span> ₹{data.close.toFixed(2)}</div>
                              <div><span className="text-slate-400">High:</span> <span className="text-emerald-400">₹{data.high.toFixed(2)}</span></div>
                              <div><span className="text-slate-400">Low:</span> <span className="text-rose-400">₹{data.low.toFixed(2)}</span></div>
                            </div>
                            <div className="pt-1 border-t border-slate-800 text-[10px] text-slate-300 flex justify-between">
                              <span>Volume:</span>
                              <span className="font-bold">{data.volume.toLocaleString('en-IN')}</span>
                            </div>
                          </div>
                        );
                      }}
                    />
                    <Bar
                      dataKey="high"
                      shape={<CandlestickBar />}
                      isAnimationActive={false}
                    />
                  </ComposedChart>
                ) : (
                  <AreaChart
                    data={chartData.candles}
                    margin={{ top: 10, right: 20, left: 0, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient id="chartAreaGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={isPositive ? '#10b981' : '#ef4444'} stopOpacity={0.25} />
                        <stop offset="95%" stopColor={isPositive ? '#10b981' : '#ef4444'} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis
                      dataKey="timestamp"
                      tickFormatter={formatXAxis}
                      stroke="#94a3b8"
                      fontSize={10}
                      tickLine={false}
                    />
                    <YAxis
                      domain={['auto', 'auto']}
                      stroke="#94a3b8"
                      fontSize={10}
                      orientation="right"
                      tickLine={false}
                      tickFormatter={(val) => `₹${val.toFixed(0)}`}
                    />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload || !payload.length) return null;
                        const data: MarketCandle = payload[0].payload;
                        return (
                          <div className="bg-slate-900 text-white p-2.5 rounded-lg shadow-xl text-xs space-y-1 border border-slate-700">
                            <div className="text-[10px] text-slate-400 font-mono">
                              {new Date(data.timestamp).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST
                            </div>
                            <div className="text-sm font-bold num-mono text-emerald-400">
                              ₹{data.close.toFixed(2)}
                            </div>
                            <div className="text-[10px] text-slate-400">
                              Volume: {data.volume.toLocaleString('en-IN')}
                            </div>
                          </div>
                        );
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="close"
                      stroke={isPositive ? '#10b981' : '#ef4444'}
                      strokeWidth={2}
                      fillOpacity={1}
                      fill="url(#chartAreaGradient)"
                      isAnimationActive={false}
                    />
                  </AreaChart>
                )}
              </ResponsiveContainer>
            </div>

            {/* Volume Histogram Sub-chart */}
            <div className="h-16 pt-2 border-t border-slate-100">
              <div className="flex items-center justify-between text-[10px] text-slate-400 uppercase font-semibold mb-1">
                <span>Trading Volume Sub-chart</span>
                <span>Max: {Math.max(...chartData.candles.map(c => c.volume)).toLocaleString('en-IN')}</span>
              </div>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData.candles} margin={{ top: 0, right: 20, left: 0, bottom: 0 }}>
                  <Bar
                    dataKey="volume"
                    fill="#94a3b8"
                    isAnimationActive={false}
                    shape={(props: any) => {
                      const { x, y, width, height, payload } = props;
                      const isUp = payload.close >= payload.open;
                      return (
                        <rect
                          x={x}
                          y={y}
                          width={Math.max(width * 0.7, 2)}
                          height={height}
                          fill={isUp ? '#a7f3d0' : '#fecaca'}
                        />
                      );
                    }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>

      {/* Account-by-Account Holdings Breakdown for this Stock */}
      {accountsBreakdown && accountsBreakdown.length > 0 && (
        <div className="p-5 bg-slate-50/70 border-t border-slate-100 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              Family Account Holdings for {symbol} ({accountsBreakdown.length} Accounts)
            </h4>
            <span className="text-[11px] text-slate-500 font-medium">
              Total Shares: <strong className="num-mono text-slate-900">{accountsBreakdown.reduce((sum, a) => sum + a.quantity, 0)}</strong>
            </span>
          </div>

          <div className="bg-white rounded-lg border border-slate-200 overflow-x-auto shadow-2xs">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-[10px] uppercase text-slate-500 border-b border-slate-100 font-semibold">
                <tr>
                  <th className="py-2.5 px-3">Account Nickname</th>
                  <th className="py-2.5 px-3">Client Code</th>
                  <th className="py-2.5 px-3">Group</th>
                  <th className="py-2.5 px-3">Quantity</th>
                  <th className="py-2.5 px-3">Avg Buy Price</th>
                  <th className="py-2.5 px-3">Market Value</th>
                  <th className="py-2.5 px-3">Unrealized P&L</th>
                  <th className="py-2.5 px-3">DDPI Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {accountsBreakdown.map((acc) => (
                  <tr key={acc.account_id} className="hover:bg-slate-50/60">
                    <td className="py-2 px-3 font-semibold text-slate-800">{acc.nickname}</td>
                    <td className="py-2 px-3 font-mono text-slate-500">{acc.masked_client_code}</td>
                    <td className="py-2 px-3 text-slate-600">{acc.account_group}</td>
                    <td className="py-2 px-3 num-mono font-bold text-slate-900">{acc.quantity}</td>
                    <td className="py-2 px-3 num-mono text-slate-700">₹{acc.acquisition_cost.toFixed(2)}</td>
                    <td className="py-2 px-3 num-mono font-bold text-slate-900">
                      ₹{acc.market_value.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td className={`py-2 px-3 num-mono font-bold ${acc.unrealized_pnl >= 0 ? 'text-finGreen' : 'text-finRed'}`}>
                      {acc.unrealized_pnl >= 0 ? '+' : ''}₹{acc.unrealized_pnl.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-2 px-3">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        acc.ddpi_status === 'ACTIVE' ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'bg-amber-50 text-amber-800 border border-amber-200'
                      }`}>
                        DDPI: {acc.ddpi_status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
