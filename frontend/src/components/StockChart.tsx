import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  RefreshCw, ShieldCheck, TrendingUp, TrendingDown, X, AlertCircle,
  Crosshair, Minus, Sliders, PenTool, Type, Shapes, Ruler, ZoomIn, Magnet, Lock, Trash2
} from 'lucide-react';
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  CrosshairMode,
  LineStyle,
  ColorType,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
  type UTCTimestamp,
  type MouseEventParams,
  type Time,
} from 'lightweight-charts';
import { MarketCandleResponse } from '../types';
import { api, getWebSocketUrl } from '../api';

interface StockChartProps {
  symbol: string;
  exchange?: string;
  symbolToken?: string;
  initialInterval?: string;
  initialRange?: string;
  initialLtp?: number;
  initialPrevClose?: number;
  companyName?: string;
  onClose?: () => void;
  /** Called from the BUY @ / SELL @ buttons with live LTP and chosen quantity */
  onBuy?: (price: number, qty: number) => void;
  onSell?: (price: number, qty: number) => void;
  /** Notifies parent (e.g. modal header) of every live LTP change */
  onLtpChange?: (ltp: number, change: number, changePercent: number) => void;
  /** Hide the built-in symbol header when the parent already renders one */
  hideHeader?: boolean;
  /** Chart canvas height in px */
  height?: number;
  /** Show the TradingView left drawing toolbar strip */
  showDrawingToolbar?: boolean;
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

interface Bar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// ---------------------------------------------------------------------------
// Constants (Angel One look & SmartAPI limits)
// ---------------------------------------------------------------------------
const UP = '#089981';
const DOWN = '#f23645';
const UP_VOL = 'rgba(8,153,129,0.5)';
const DOWN_VOL = 'rgba(242,54,69,0.5)';
const IST_OFFSET_SEC = 19800; // shift UTC epoch so the time axis reads IST

const INTERVALS = [
  { label: '1m', value: 'ONE_MINUTE', sec: 60, maxDays: 30, legend: '1' },
  { label: '3m', value: 'THREE_MINUTE', sec: 180, maxDays: 60, legend: '3' },
  { label: '5m', value: 'FIVE_MINUTE', sec: 300, maxDays: 100, legend: '5' },
  { label: '10m', value: 'TEN_MINUTE', sec: 600, maxDays: 100, legend: '10' },
  { label: '15m', value: 'FIFTEEN_MINUTE', sec: 900, maxDays: 200, legend: '15' },
  { label: '30m', value: 'THIRTY_MINUTE', sec: 1800, maxDays: 200, legend: '30' },
  { label: '1h', value: 'ONE_HOUR', sec: 3600, maxDays: 400, legend: '60' },
  { label: '1D', value: 'ONE_DAY', sec: 86400, maxDays: 2000, legend: '1D' },
];
const RANGES = [
  { label: '1D', value: '1D', days: 1, defaultInterval: 'FIVE_MINUTE' },
  { label: '5D', value: '5D', days: 7, defaultInterval: 'FIFTEEN_MINUTE' },
  { label: '1M', value: '1M', days: 31, defaultInterval: 'ONE_HOUR' },
  { label: '3M', value: '3M', days: 92, defaultInterval: 'ONE_HOUR' },
  { label: '6M', value: '6M', days: 183, defaultInterval: 'ONE_DAY' },
  { label: '1Y', value: '1Y', days: 366, defaultInterval: 'ONE_DAY' },
  { label: '5Y', value: '5Y', days: 1826, defaultInterval: 'ONE_DAY' },
  { label: 'MAX', value: 'MAX', days: 2500, defaultInterval: 'ONE_DAY' },
];
const INTERVAL_ALIASES: Record<string, string> = {
  '1m': 'ONE_MINUTE', '3m': 'THREE_MINUTE', '5m': 'FIVE_MINUTE', '10m': 'TEN_MINUTE', '10min': 'TEN_MINUTE',
  '15m': 'FIFTEEN_MINUTE', '30m': 'THIRTY_MINUTE', '1h': 'ONE_HOUR', '60m': 'ONE_HOUR', '1d': 'ONE_DAY',
};

const normalizeInterval = (v?: string, r?: string) => {
  if (v) {
    if (INTERVALS.some((i) => i.value === v.toUpperCase())) return v.toUpperCase();
    if (INTERVAL_ALIASES[v.toLowerCase()]) return INTERVAL_ALIASES[v.toLowerCase()];
  }
  return r === '1D' ? 'FIVE_MINUTE' : 'ONE_DAY';
};
const normalizeRange = (v?: string) => (RANGES.some((r) => r.value === v?.toUpperCase()) ? v!.toUpperCase() : 'MAX');
const intervalMeta = (v: string) => INTERVALS.find((i) => i.value === v) || INTERVALS[7];
const rangeMeta = (v: string) => RANGES.find((r) => r.value === v) || RANGES[7];

function toChartTime(ts: string | number): number {
  if (typeof ts === 'number') return (ts > 1e12 ? Math.floor(ts / 1000) : ts) + IST_OFFSET_SEC;
  let s = String(ts).trim().replace(' ', 'T');
  if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) s += 'Z'; // naive backend timestamps are UTC
  return Math.floor(Date.parse(s) / 1000) + IST_OFFSET_SEC;
}

function normalizeBars(rows: MarketCandleResponse['candles']): Bar[] {
  const map = new Map<number, Bar>();
  for (const r of rows || []) {
    const bar: Bar = {
      time: toChartTime(r.timestamp),
      open: +r.open, high: +r.high, low: +r.low, close: +r.close, volume: +r.volume || 0,
    };
    if (Number.isFinite(bar.time) && Number.isFinite(bar.close)) map.set(bar.time, bar);
  }
  return [...map.values()].sort((a, b) => a.time - b.time);
}

const dayKey = (t: number) => Math.floor(t / 86400);
const volPoint = (b: Bar) => ({ time: b.time as UTCTimestamp, value: b.volume, color: b.close >= b.open ? UP_VOL : DOWN_VOL });
const candlePoint = (b: Bar) => ({ time: b.time as UTCTimestamp, open: b.open, high: b.high, low: b.low, close: b.close });

function computePrevClose(bars: Bar[], interval: string): number {
  if (!bars.length) return 0;
  if (interval === 'ONE_DAY') return bars.length > 1 ? bars[bars.length - 2].close : bars[0].open;
  const today = dayKey(bars[bars.length - 1].time);
  for (let i = bars.length - 1; i >= 0; i--) if (dayKey(bars[i].time) !== today) return bars[i].close;
  return 0;
}

function isMarketOpen(t: number): boolean {
  const d = new Date(t * 1000); // t is IST-shifted
  const dow = d.getUTCDay();
  const mins = d.getUTCHours() * 60 + d.getUTCMinutes();
  return dow >= 1 && dow <= 5 && mins >= 555 && mins < 930; // 09:15–15:30 IST
}

function fmtVol(v: number): string {
  if (v >= 1e7) return (v / 1e7).toFixed(2) + 'Cr';
  if (v >= 1e5) return (v / 1e5).toFixed(2) + 'L';
  if (v >= 1e3) return (v / 1e3).toFixed(3) + 'K';
  return String(Math.round(v));
}

const istClock = () => {
  const d = new Date(Date.now() + IST_OFFSET_SEC * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export const StockChart: React.FC<StockChartProps> = ({
  symbol,
  exchange,
  symbolToken,
  initialInterval = 'FIVE_MINUTE',
  initialRange = '1D',
  initialLtp,
  initialPrevClose,
  companyName,
  onClose,
  onBuy,
  onSell,
  onLtpChange,
  hideHeader = false,
  height = 460,
  accountsBreakdown = [],
}) => {
  const cleanSym = symbol.replace('-EQ', '').toUpperCase();

  const [range, setRange] = useState(() => normalizeRange(initialRange));
  const [interval, setIntervalValue] = useState(() => normalizeInterval(initialInterval, initialRange));
  const [meta, setMeta] = useState<MarketCandleResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isEmpty, setIsEmpty] = useState(false);
  const [ltp, setLtp] = useState(initialLtp || 0);
  const [prevClose, setPrevClose] = useState(initialPrevClose || 0);
  const [legend, setLegend] = useState<Bar | null>(null);
  const [feedLive, setFeedLive] = useState(false);
  const [qty, setQty] = useState(1);
  const [clock, setClock] = useState(istClock());
  const [reloadKey, setReloadKey] = useState(0);

  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const priceLineRef = useRef<IPriceLine | null>(null);
  const lastBarRef = useRef<Bar | null>(null);
  const prevCloseRef = useRef(initialPrevClose || 0);
  const lastCumVolRef = useRef(0);
  const intervalRef = useRef(interval);
  const onLtpChangeRef = useRef(onLtpChange);
  const initialLtpRef = useRef(initialLtp);
  const initialPrevCloseRef = useRef(initialPrevClose);
  const symbolTokenRef = useRef(symbolToken);
  const exchangeRef = useRef(exchange);
  const barsRef = useRef<Bar[]>([]);
  const isLoadingOlderRef = useRef(false);
  const hasMoreHistoryRef = useRef(true);

  intervalRef.current = interval;
  onLtpChangeRef.current = onLtpChange;
  symbolTokenRef.current = symbolToken;
  exchangeRef.current = exchange;

  // -- LTP + dotted price line ------------------------------------------------
  const applyLtp = useCallback((price: number) => {
    if (!(price > 0)) return;
    const pc = prevCloseRef.current || price;
    const color = price >= pc ? UP : DOWN;
    setLtp(price);
    setPrevClose(prevCloseRef.current);
    const opts = {
      price,
      color,
      lineWidth: 1 as const,
      lineStyle: LineStyle.Dotted,
      axisLabelVisible: true,
      title: '',
    };
    if (candleRef.current) {
      if (!priceLineRef.current) priceLineRef.current = candleRef.current.createPriceLine(opts);
      else priceLineRef.current.applyOptions(opts);
    }
    const chg = price - pc;
    onLtpChangeRef.current?.(price, chg, pc ? (chg / pc) * 100 : 0);
  }, []);

  // -- Load more history on scrolling left (TradingView Lightweight Charts pagination) --
  const loadOlderCandles = useCallback(() => {
    if (isLoadingOlderRef.current || !hasMoreHistoryRef.current || !barsRef.current.length) return;
    const oldestBar = barsRef.current[0];
    if (!oldestBar) return;

    isLoadingOlderRef.current = true;
    setIsLoadingOlder(true);

    const utcEpoch = oldestBar.time - IST_OFFSET_SEC;
    const oldestIso = new Date(utcEpoch * 1000).toISOString();

    api.getMarketCandles(
      symbol,
      intervalRef.current,
      undefined,
      exchangeRef.current,
      symbolTokenRef.current,
      undefined,
      undefined,
      oldestIso
    )
      .then((data) => {
        const olderBars = normalizeBars(data.candles);
        const candle = candleRef.current;
        const vol = volRef.current;
        const chart = chartRef.current;

        if (!olderBars.length || olderBars[olderBars.length - 1].time >= oldestBar.time) {
          hasMoreHistoryRef.current = false;
          return;
        }

        if (!candle || !vol || !chart) return;

        const existingMap = new Map<number, Bar>();
        for (const b of olderBars) existingMap.set(b.time, b);
        for (const b of barsRef.current) existingMap.set(b.time, b);

        const merged = [...existingMap.values()].sort((a, b) => a.time - b.time);
        const addedCount = merged.length - barsRef.current.length;
        barsRef.current = merged;

        candle.setData(merged.map(candlePoint));
        vol.setData(merged.map(volPoint));

        const currentRange = chart.timeScale().getVisibleLogicalRange();
        if (currentRange && addedCount > 0) {
          chart.timeScale().setVisibleLogicalRange({
            from: currentRange.from + addedCount,
            to: currentRange.to + addedCount,
          });
        }
        if (data.has_more_history === false || addedCount === 0) {
          hasMoreHistoryRef.current = false;
        }
      })
      .catch(() => {
        hasMoreHistoryRef.current = false;
      })
      .finally(() => {
        isLoadingOlderRef.current = false;
        setIsLoadingOlder(false);
      });
  }, [symbol]);

  // -- Create chart once --------------------------------------------------------
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const chart = createChart(el, {
      autoSize: true, // responsive via ResizeObserver
      layout: {
        background: { type: ColorType.Solid, color: '#0b0b0d' },
        textColor: '#8a8f98',
        fontSize: 11,
        fontFamily: "Inter, -apple-system, 'Segoe UI', Roboto, sans-serif",
      },
      grid: {
        vertLines: { color: 'rgba(42,46,57,0.35)' },
        horzLines: { color: 'rgba(42,46,57,0.35)' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: '#5d606b', style: LineStyle.Dashed, labelBackgroundColor: '#2a2e39' },
        horzLine: { color: '#5d606b', style: LineStyle.Dashed, labelBackgroundColor: '#2a2e39' },
      },
      rightPriceScale: { borderColor: '#222327', scaleMargins: { top: 0.2, bottom: 0.22 } },
      timeScale: { borderColor: '#222327', timeVisible: true, secondsVisible: false, rightOffset: 8, barSpacing: 7 },
      localization: { priceFormatter: (p: number) => p.toFixed(2) },
    });

    const candle = chart.addSeries(CandlestickSeries, {
      upColor: UP, downColor: DOWN,
      borderUpColor: UP, borderDownColor: DOWN,
      wickUpColor: UP, wickDownColor: DOWN,
      priceLineVisible: false, // custom dotted LTP line instead
      lastValueVisible: false,
    });
    const vol = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'vol',
      priceLineVisible: false,
      lastValueVisible: true,
    });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

    chart.subscribeCrosshairMove((param: MouseEventParams<Time>) => {
      const c = param.time ? (param.seriesData.get(candle) as any) : undefined;
      const v = param.time ? (param.seriesData.get(vol) as any) : undefined;
      if (c && c.open !== undefined) {
        setLegend({ time: Number(param.time), open: c.open, high: c.high, low: c.low, close: c.close, volume: v?.value ?? 0 });
      } else if (lastBarRef.current) {
        setLegend({ ...lastBarRef.current });
      }
    });

    // Pagination subscription on left scroll
    chart.timeScale().subscribeVisibleLogicalRangeChange((logicalRange) => {
      if (!logicalRange) return;
      if (logicalRange.from < 5) {
        loadOlderCandles();
      }
    });

    chartRef.current = chart;
    candleRef.current = candle;
    volRef.current = vol;

    return () => {
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      volRef.current = null;
      priceLineRef.current = null;
    };
  }, [loadOlderCandles]);

  // -- Load historical candles (backend -> SmartAPI getCandleData) -------------
  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    hasMoreHistoryRef.current = true;

    api.getMarketCandles(symbol, interval, range, exchange, symbolToken)
      .then((data) => {
        if (cancelled) return;
        setMeta(data);
        const bars = normalizeBars(data.candles);
        const candle = candleRef.current;
        const vol = volRef.current;
        const chart = chartRef.current;
        if (!candle || !vol || !chart) return;

        barsRef.current = bars;
        hasMoreHistoryRef.current = Boolean(data.has_more_history !== false && bars.length > 0);

        candle.setData(bars.map(candlePoint));
        vol.setData(bars.map(volPoint));
        setIsEmpty(bars.length === 0);
        lastCumVolRef.current = 0;

        if (!bars.length) {
          lastBarRef.current = null;
          applyLtp(data.current_ltp || initialLtpRef.current || 0);
          return;
        }

        const last = { ...bars[bars.length - 1] };
        lastBarRef.current = last;
        prevCloseRef.current = initialPrevCloseRef.current || computePrevClose(bars, interval) || data.previous_close || bars[0].open;
        setLegend({ ...last });
        applyLtp(last.close);

        if (range === '1D' && interval !== 'ONE_DAY') {
          // backend fetches a few days for weekends/holidays; zoom to the latest session
          const sessionBars = bars.filter((b) => dayKey(b.time) === dayKey(last.time)).length;
          chart.timeScale().setVisibleLogicalRange({ from: bars.length - Math.max(sessionBars, 20), to: bars.length + 6 });
        } else {
          chart.timeScale().fitContent();
        }
      })
      .catch((err: any) => {
        if (!cancelled) setError(err?.message || 'Failed to load SmartAPI candles');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => { cancelled = true; };
  }, [symbol, cleanSym, exchange, symbolToken, interval, range, reloadKey, applyLtp]);

  // -- Live ticks from IPOPro WebSocket (SmartStream relay) --------------------
  useEffect(() => {
    let ws: WebSocket | null = null;
    let alive = true;
    let retry: ReturnType<typeof setTimeout> | null = null;

    const handleTick = (msg: any) => {
      const price = Number(msg.ltp);
      if (!(price > 0)) return;
      const pc = Number(msg.previous_close);
      if (pc > 0 && pc !== price) prevCloseRef.current = pc;
      applyLtp(price);

      const last = lastBarRef.current;
      const candle = candleRef.current;
      const vol = volRef.current;
      if (!last || !candle || !vol) return;

      const t = Math.floor(Date.now() / 1000) + IST_OFFSET_SEC;
      const iv = intervalRef.current;
      const sec = intervalMeta(iv).sec;
      const bucket = iv === 'ONE_DAY'
        ? Math.floor(t / 86400) * 86400
        : last.time + Math.floor((t - last.time) / sec) * sec;

      let bar = last;
      if (bucket > last.time && isMarketOpen(t)) {
        bar = { time: bucket, open: price, high: price, low: price, close: price, volume: 0 };
        lastBarRef.current = bar;
      } else {
        bar.close = price;
        bar.high = Math.max(bar.high, price);
        bar.low = Math.min(bar.low, price);
      }

      // tick volume is cumulative for the day -> add delta to the live candle
      const cum = Number(msg.volume) || 0;
      if (cum > 0) {
        if (lastCumVolRef.current > 0 && cum > lastCumVolRef.current) bar.volume += cum - lastCumVolRef.current;
        lastCumVolRef.current = cum;
      }

      candle.update(candlePoint(bar));
      vol.update(volPoint(bar));
      setLegend({ ...bar });
    };

    const connect = () => {
      try {
        ws = new WebSocket(getWebSocketUrl());
      } catch {
        return;
      }
      ws.onopen = () => alive && setFeedLive(true);
      ws.onmessage = (event) => {
        if (!alive) return;
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'TICK') {
            const sym = msg.symbol ? String(msg.symbol).toUpperCase() : '';
            const tok = msg.symbol_token ? String(msg.symbol_token).trim() : '';
            const isMatch =
              (sym && (sym === symbol.toUpperCase() || sym.replace('-EQ', '') === cleanSym)) ||
              (symbolToken && tok && tok === String(symbolToken).trim());
            if (isMatch) {
              handleTick(msg);
            }
          }
        } catch {
          /* ignore non-JSON frames */
        }
      };
      ws.onclose = () => {
        if (!alive) return;
        setFeedLive(false);
        retry = setTimeout(connect, 3000);
      };
    };

    connect();
    return () => {
      alive = false;
      if (retry) clearTimeout(retry);
      ws?.close();
    };
  }, [cleanSym, symbol, symbolToken, applyLtp]);

  // -- IST clock --------------------------------------------------------------
  useEffect(() => {
    const id = window.setInterval(() => setClock(istClock()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // -- Interval / range selection within SmartAPI per-request limits ----------
  const selectInterval = (value: string) => {
    const iv = intervalMeta(value);
    setIntervalValue(value);
    if (rangeMeta(range).days > iv.maxDays) {
      const fit = [...RANGES].reverse().find((r) => r.days <= iv.maxDays);
      setRange(fit ? fit.value : '1D');
    } else if (value === 'ONE_DAY' && rangeMeta(range).days < 31) {
      setRange('6M');
    }
  };
  const selectRange = (value: string) => {
    const rm = rangeMeta(value);
    setRange(value);
    if (intervalMeta(interval).maxDays < rm.days || rm.days >= 180) {
      setIntervalValue(rm.defaultInterval);
    }
  };

  const change = prevClose ? ltp - prevClose : 0;
  const changePct = prevClose ? (change / prevClose) * 100 : 0;
  const isUp = change >= 0;
  const legendUp = legend ? legend.close >= legend.open : true;
  const legendChg = legend ? legend.close - legend.open : 0;
  const legendPct = legend && legend.open ? (legendChg / legend.open) * 100 : 0;
  const legendColor = legendUp ? 'text-[#089981]' : 'text-[#f23645]';
  const source = meta?.data_source;
  const sourceBadge =
    source === 'SMARTAPI_HISTORICAL_API' || source === 'CACHE_VERIFIED'
      ? { text: source === 'CACHE_VERIFIED' ? 'SmartAPI (Cached)' : 'SmartAPI historical', cls: 'bg-[#089981]/15 text-[#22c3a6]' }
      : source === 'LIVE_TICK_STREAM_CANDLES'
        ? { text: 'Synthetic · SmartAPI offline', cls: 'bg-amber-500/15 text-amber-400' }
        : { text: source ? 'Historical data unavailable' : '—', cls: 'bg-slate-800 text-slate-400' };

  return (
    <div className="bg-[#0b0b0d] text-slate-200 rounded-xl border border-[#222327] overflow-hidden flex flex-col">
      {/* ---------- Header ---------- */}
      {!hideHeader && (
        <div className="px-5 py-3.5 border-b border-[#222327] flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-[17px] font-bold text-white tracking-wide">{cleanSym}</h2>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#1d1e22] text-slate-400">
                {meta?.exchange || 'NSE'}
              </span>
            </div>
            <div className="text-xs text-slate-400 mt-0.5">{companyName || meta?.company_name || cleanSym}</div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="flex items-baseline gap-2 justify-end num-mono">
                <span className={`text-base font-bold ${isUp ? 'text-[#089981]' : 'text-[#f23645]'}`}>{ltp.toFixed(2)}</span>
                <span className={`text-xs font-semibold flex items-center gap-0.5 ${isUp ? 'text-[#089981]' : 'text-[#f23645]'}`}>
                  {isUp ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                  {isUp ? '+' : ''}{change.toFixed(2)} ({isUp ? '+' : ''}{changePct.toFixed(2)}%)
                </span>
              </div>
            </div>
            {onBuy && (
              <button onClick={() => onBuy(ltp, qty)} className="px-4 py-1.5 rounded-md bg-[#089981] hover:brightness-110 text-white text-xs font-bold transition active:scale-95">
                BUY
              </button>
            )}
            {onSell && (
              <button onClick={() => onSell(ltp, qty)} className="px-4 py-1.5 rounded-md bg-[#f23645] hover:brightness-110 text-white text-xs font-bold transition active:scale-95">
                SELL
              </button>
            )}
            {onClose && (
              <button onClick={onClose} className="p-1.5 rounded-full border border-[#2a2b30] text-slate-400 hover:text-white hover:bg-[#1d1e22] transition" title="Close chart">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* ---------- Interval toolbar ---------- */}
      <div className="px-3 py-1.5 border-b border-[#222327] bg-[#121214] flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-0.5">
          {INTERVALS.map((iv) => (
            <button
              key={iv.value}
              onClick={() => selectInterval(iv.value)}
              className={`px-2.5 py-1 rounded text-xs font-semibold transition-colors ${
                interval === iv.value ? 'text-[#5b7cfa] bg-[#5b7cfa]/10' : 'text-slate-400 hover:text-white hover:bg-[#1d1e22]'
              }`}
            >
              {iv.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide">
          <span className="flex items-center gap-1.5 text-slate-400">
            <span className={`w-1.5 h-1.5 rounded-full ${feedLive ? 'bg-[#089981] animate-pulse' : 'bg-slate-500'}`} />
            {feedLive ? 'Live ticks' : 'Feed offline'}
          </span>
          <span className={`px-2 py-0.5 rounded-full normal-case ${sourceBadge.cls}`}>{sourceBadge.text}</span>
          <button
            onClick={() => setReloadKey((k) => k + 1)}
            disabled={isLoading}
            title="Reload candles"
            className="p-1 text-slate-400 hover:text-white rounded transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* ---------- Chart ---------- */}
      <div className="relative w-full" style={{ height }}>
        <div ref={containerRef} className="absolute inset-0" />

        {/* Legend + BUY/SELL overlay (Angel One style) */}
        <div className="absolute top-2 left-3 z-10 flex flex-col gap-1.5 pointer-events-none">
          <div className="flex flex-wrap items-center gap-2.5 text-xs num-mono">
            <span className="text-white font-semibold">
              {cleanSym} · {intervalMeta(interval).legend} · {meta?.exchange || 'NSE'}
            </span>
            {legend && (
              <>
                <span><span className="text-slate-500">O</span> <span className={legendColor}>{legend.open.toFixed(2)}</span></span>
                <span><span className="text-slate-500">H</span> <span className={legendColor}>{legend.high.toFixed(2)}</span></span>
                <span><span className="text-slate-500">L</span> <span className={legendColor}>{legend.low.toFixed(2)}</span></span>
                <span><span className="text-slate-500">C</span> <span className={legendColor}>{legend.close.toFixed(2)}</span></span>
                <span className={legendColor}>
                  {legendChg >= 0 ? '+' : ''}{legendChg.toFixed(2)} ({legendChg >= 0 ? '+' : ''}{legendPct.toFixed(2)}%)
                </span>
              </>
            )}
          </div>
          {(onBuy || onSell) && (
            <div className="flex items-center gap-1.5 pointer-events-auto">
              {onBuy && (
                <button
                  onClick={() => onBuy(ltp, qty)}
                  className="px-3 py-2 rounded bg-[#089981] hover:brightness-110 text-white text-[11.5px] font-bold num-mono transition active:scale-95"
                >
                  BUY @ {ltp.toFixed(2)}
                </button>
              )}
              <input
                type="number"
                min={1}
                value={qty}
                onChange={(e) => setQty(Math.max(1, parseInt(e.target.value, 10) || 1))}
                className="w-12 h-[30px] rounded bg-[#1d1e22] border border-[#2a2b30] text-center text-xs font-semibold text-white focus:outline-none focus:border-[#5b7cfa]"
                aria-label="Order quantity"
              />
              {onSell && (
                <button
                  onClick={() => onSell(ltp, qty)}
                  className="px-3 py-2 rounded bg-[#f23645] hover:brightness-110 text-white text-[11.5px] font-bold num-mono transition active:scale-95"
                >
                  SELL @ {ltp.toFixed(2)}
                </button>
              )}
            </div>
          )}
          {legend && (
            <div className="text-xs text-slate-400 num-mono">
              Volume <span className={`ml-1 font-semibold ${legendColor}`}>{fmtVol(legend.volume)}</span>
            </div>
          )}
        </div>

        {isLoadingOlder && (
          <div className="absolute top-2 right-3 z-20 flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#1d1e22]/90 border border-[#2a2b30] text-[11px] text-[#5b7cfa] shadow-lg backdrop-blur-sm">
            <RefreshCw className="w-3 h-3 animate-spin" />
            <span>Loading older history…</span>
          </div>
        )}

        {isLoading && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-[#0b0b0d]/80">
            <RefreshCw className="w-6 h-6 text-[#5b7cfa] animate-spin" />
            <span className="text-xs text-slate-400">Loading SmartAPI candles…</span>
          </div>
        )}
        {!isLoading && (error || isEmpty) && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center text-center gap-2 bg-[#0b0b0d]/90 p-6">
            <AlertCircle className="w-7 h-7 text-[#f23645]" />
            <div className="text-sm font-semibold text-white">Historical Data Unavailable</div>
            <div className="text-xs text-slate-400 max-w-sm">
              {error || 'Historical data unavailable for this instrument or period.'}
            </div>
            <button onClick={() => setReloadKey((k) => k + 1)} className="mt-1 px-4 py-1.5 rounded-lg bg-[#1d1e22] hover:bg-[#2a2b30] text-xs font-semibold text-white">
              Retry
            </button>
          </div>
        )}
      </div>

      {/* ---------- Range footer ---------- */}
      <div className="px-3 py-1.5 border-t border-[#222327] bg-[#121214] flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-0.5">
          {RANGES.map((r) => (
            <button
              key={r.value}
              onClick={() => selectRange(r.value)}
              className={`px-2.5 py-1 rounded font-semibold transition-colors ${
                range === r.value ? 'text-[#5b7cfa] bg-[#5b7cfa]/10' : 'text-slate-400 hover:text-white hover:bg-[#1d1e22]'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
        <span className="text-slate-500 num-mono">{clock} (UTC+5:30)</span>
      </div>

      {/* ---------- Account breakdown ---------- */}
      {accountsBreakdown && accountsBreakdown.length > 0 && (
        <div className="p-5 border-t border-[#222327] bg-[#0f0f11] space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-[#089981]" />
              Family Account Holdings for {cleanSym} ({accountsBreakdown.length} Accounts)
            </h4>
            <span className="text-[11px] text-slate-400 font-medium">
              Total Shares: <strong className="num-mono text-white">{accountsBreakdown.reduce((s, a) => s + a.quantity, 0)}</strong>
            </span>
          </div>
          <div className="rounded-lg border border-[#222327] overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#121214] text-[10px] uppercase text-slate-500 border-b border-[#222327] font-semibold">
                <tr>
                  <th className="py-2.5 px-3">Account Nickname</th>
                  <th className="py-2.5 px-3">Client Code</th>
                  <th className="py-2.5 px-3">Group</th>
                  <th className="py-2.5 px-3">Quantity</th>
                  <th className="py-2.5 px-3">Avg Buy Price</th>
                  <th className="py-2.5 px-3">Market Value</th>
                  <th className="py-2.5 px-3">Unrealized P&amp;L</th>
                  <th className="py-2.5 px-3">DDPI Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1b1c20]">
                {accountsBreakdown.map((acc) => (
                  <tr key={acc.account_id} className="hover:bg-[#151518]">
                    <td className="py-2 px-3 font-semibold text-slate-100">{acc.nickname}</td>
                    <td className="py-2 px-3 font-mono text-slate-400">{acc.masked_client_code}</td>
                    <td className="py-2 px-3 text-slate-400">{acc.account_group}</td>
                    <td className="py-2 px-3 num-mono font-bold text-white">{acc.quantity}</td>
                    <td className="py-2 px-3 num-mono text-slate-300">₹{acc.acquisition_cost.toFixed(2)}</td>
                    <td className="py-2 px-3 num-mono font-bold text-white">
                      ₹{acc.market_value.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td className={`py-2 px-3 num-mono font-bold ${acc.unrealized_pnl >= 0 ? 'text-[#089981]' : 'text-[#f23645]'}`}>
                      {acc.unrealized_pnl >= 0 ? '+' : ''}₹{acc.unrealized_pnl.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-2 px-3">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        acc.ddpi_status === 'ACTIVE' ? 'bg-blue-500/10 text-blue-300' : 'bg-amber-500/10 text-amber-300'
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
