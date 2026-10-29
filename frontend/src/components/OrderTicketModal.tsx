import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  X, ShieldCheck, AlertCircle, TrendingUp, TrendingDown,
  Info, Check, HelpCircle, ArrowRight, RefreshCw, Calculator, FileText, Lock
} from 'lucide-react';
import { Account, AccountHoldingItem } from '../types';
import { api } from '../api';

interface OrderTicketModalProps {
  isOpen: boolean;
  account: Account | null;
  holding: AccountHoldingItem | null;
  defaultSide?: 'BUY' | 'SELL';
  defaultOrderType?: 'LIMIT' | 'MARKET' | 'STOPLOSS_LIMIT' | 'STOPLOSS_MARKET';
  onClose: () => void;
  onOrderSuccess: (orderMessage: string) => void;
}

interface MarketQuoteState {
  ltp: number | null;
  previousClose: number | null;
  dayChange: number | null;
  dayChangePercent: number | null;
  tickSize: number;
  lotSize: number;
  source: string;
  freshnessStatus: 'LIVE' | 'CACHED' | 'STALE' | 'UNAVAILABLE';
  asOfTimestamp: string | null;
  isLoading: boolean;
}

interface BrokerageChargesState {
  tradeValue: number;
  brokerage: number;
  stt: number;
  exchangeCharges: number;
  sebiCharges: number;
  stampDuty: number;
  gst: number;
  dpCharges: number;
  totalCharges: number;
  isBrokerVerified: boolean;
  dataSource: string;
  disclaimer: string;
  isLoading: boolean;
}

interface MarginState {
  fullTradeValue: number;
  requiredMargin: number | null;
  availableFunds: number;
  remainingFunds: number;
  isSufficient: boolean;
  leverageMultiplier: number;
  isBrokerVerified: boolean;
  dataSource: string;
  status: 'VERIFIED' | 'ESTIMATED' | 'UNAVAILABLE';
  message: string;
  isLoading: boolean;
}

export const OrderTicketModal: React.FC<OrderTicketModalProps> = ({
  isOpen,
  account,
  holding,
  defaultSide = 'BUY',
  defaultOrderType = 'LIMIT',
  onClose,
  onOrderSuccess,
}) => {
  const [side, setSide] = useState<'BUY' | 'SELL'>(defaultSide);
  const [productType, setProductType] = useState<'DELIVERY' | 'INTRADAY'>('DELIVERY');
  const [orderType, setOrderType] = useState<'LIMIT' | 'MARKET' | 'STOPLOSS_LIMIT' | 'STOPLOSS_MARKET'>(defaultOrderType);
  const [quantity, setQuantity] = useState<number>(1);
  const [limitPrice, setLimitPrice] = useState<string>('');
  const [triggerPrice, setTriggerPrice] = useState<string>('');
  const [isLimitPriceUserEdited, setIsLimitPriceUserEdited] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState<boolean>(false);
  const [showChargesModal, setShowChargesModal] = useState<boolean>(false);

  // Market Quote State
  const [quote, setQuote] = useState<MarketQuoteState>({
    ltp: null,
    previousClose: null,
    dayChange: null,
    dayChangePercent: null,
    tickSize: 0.05,
    lotSize: 1,
    source: 'PENDING_INITIALIZATION',
    freshnessStatus: 'UNAVAILABLE',
    asOfTimestamp: null,
    isLoading: true,
  });

  // Brokerage & Margin States
  const [charges, setCharges] = useState<BrokerageChargesState>({
    tradeValue: 0,
    brokerage: 0,
    stt: 0,
    exchangeCharges: 0,
    sebiCharges: 0,
    stampDuty: 0,
    gst: 0,
    dpCharges: 0,
    totalCharges: 0,
    isBrokerVerified: false,
    dataSource: '',
    disclaimer: '',
    isLoading: false,
  });

  const [margin, setMargin] = useState<MarginState>({
    fullTradeValue: 0,
    requiredMargin: null,
    availableFunds: account?.available_cash || 0,
    remainingFunds: account?.available_cash || 0,
    isSufficient: true,
    leverageMultiplier: 1.0,
    isBrokerVerified: false,
    dataSource: '',
    status: 'UNAVAILABLE',
    message: '',
    isLoading: false,
  });

  const wsRef = useRef<WebSocket | null>(null);

  const sym = holding?.trading_symbol || holding?.symbol || '';
  const token = holding?.symbol_token || '';
  const exchange = holding?.exchange || 'NSE';
  const availableSellQty = holding?.available_quantity ?? holding?.quantity ?? 0;
  const isSellable = Boolean(account?.ddpi_status === 'ACTIVE' || account?.edis_authorized_today);

  // Helper rounding
  const round2 = (v: number) => Math.round(v * 100) / 100;

  // 1. Fetch genuine initial quote & subscribe to WebSocket
  useEffect(() => {
    if (!isOpen || !holding) return;

    setSide(defaultSide);
    setOrderType(defaultOrderType);
    setErrorMsg(null);
    setShowConfirmModal(false);
    setIsLimitPriceUserEdited(false);

    // Initial quantity
    if (defaultSide === 'SELL' && availableSellQty > 0) {
      setQuantity(availableSellQty);
    } else {
      setQuantity(1);
    }

    // Set initial quote loading
    setQuote((prev) => ({ ...prev, isLoading: true }));

    // Fetch authorized initial quote from backend
    api.getSingleMarketQuote(sym, exchange, token)
      .then((data) => {
        const ltpVal = data.ltp !== null && data.ltp !== undefined ? Number(data.ltp) : null;
        setQuote({
          ltp: ltpVal,
          previousClose: data.previous_close !== null ? Number(data.previous_close) : null,
          dayChange: data.net_change !== null ? Number(data.net_change) : null,
          dayChangePercent: data.percent_change !== null ? Number(data.percent_change) : null,
          tickSize: Number(data.tick_size || 0.05),
          lotSize: Number(data.lot_size || 1),
          source: data.source || 'SMARTAPI_MARKET_FEED',
          freshnessStatus: data.freshness_status || (ltpVal !== null ? 'LIVE' : 'UNAVAILABLE'),
          asOfTimestamp: data.as_of_timestamp || new Date().toISOString(),
          isLoading: false,
        });

        // Initialize limit price only if not user-edited
        if (ltpVal !== null) {
          setLimitPrice(ltpVal.toFixed(2));
          setTriggerPrice((ltpVal * 0.98).toFixed(2));
        } else {
          setLimitPrice('');
          setTriggerPrice('');
        }
      })
      .catch((err) => {
        setQuote((prev) => ({
          ...prev,
          ltp: null,
          freshnessStatus: 'UNAVAILABLE',
          source: 'PRICE_UNAVAILABLE',
          isLoading: false,
        }));
      });

    // 2. Establish live WebSocket subscription for ticks
    try {
      const loc = window.location;
      const wsProto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${wsProto}//${loc.host}/api/v1/market/ws`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'TICK' && (msg.symbol === sym || msg.symbol === token)) {
            const newLtp = Number(msg.ltp);
            setQuote((prev) => ({
              ...prev,
              ltp: newLtp,
              dayChange: msg.change !== undefined ? Number(msg.change) : prev.dayChange,
              dayChangePercent: msg.change_percent !== undefined ? Number(msg.change_percent) : prev.dayChangePercent,
              source: 'SMARTAPI_LIVE_TICK',
              freshnessStatus: 'LIVE',
              asOfTimestamp: msg.timestamp || new Date().toISOString(),
            }));
            // NEVER overwrite user-entered limit price when live LTP ticks arrive!
          }
        } catch (_) {}
      };

      ws.onerror = () => {
        setQuote((prev) => ({ ...prev, freshnessStatus: prev.ltp ? 'CACHED' : 'UNAVAILABLE' }));
      };
    } catch (_) {}

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [isOpen, holding, sym, exchange, token, defaultSide, defaultOrderType]);

  // Effective price used for calculation
  const parsedLimitPrice = parseFloat(limitPrice) || 0;
  const effectivePrice = orderType === 'MARKET' ? (quote.ltp || 0) : parsedLimitPrice;
  const estimatedOrderValue = round2(quantity * effectivePrice);

  // 3. Debounced Brokerage & Margin Estimation on input changes
  useEffect(() => {
    if (!isOpen || effectivePrice <= 0 || quantity <= 0) return;

    const timer = setTimeout(() => {
      // Fetch Brokerage
      setCharges((prev) => ({ ...prev, isLoading: true }));
      api.estimateBrokerage({
        exchange,
        symbol_token: token,
        tradingsymbol: sym,
        transaction_type: side,
        product_type: productType,
        quantity,
        price: effectivePrice,
        order_type: orderType,
      })
        .then((res) => {
          setCharges({
            tradeValue: res.trade_value,
            brokerage: res.brokerage,
            stt: res.stt_ctt,
            exchangeCharges: res.exchange_charges,
            sebiCharges: res.sebi_charges,
            stampDuty: res.stamp_duty,
            gst: res.gst,
            dpCharges: res.dp_charges,
            totalCharges: res.total_charges,
            isBrokerVerified: res.is_broker_verified,
            dataSource: res.data_source,
            disclaimer: res.disclaimer,
            isLoading: false,
          });
        })
        .catch(() => {
          setCharges((prev) => ({ ...prev, isLoading: false }));
        });

      // Fetch Margin
      setMargin((prev) => ({ ...prev, isLoading: true }));
      api.calculateMargin({
        exchange,
        symbol_token: token,
        tradingsymbol: sym,
        transaction_type: side,
        product_type: productType,
        quantity,
        price: effectivePrice,
        account_id: account?.id,
      })
        .then((res) => {
          setMargin({
            fullTradeValue: res.full_trade_value,
            requiredMargin: res.required_margin,
            availableFunds: res.available_funds,
            remainingFunds: res.remaining_funds,
            isSufficient: res.is_sufficient,
            leverageMultiplier: res.leverage_multiplier,
            isBrokerVerified: res.is_broker_verified,
            dataSource: res.data_source,
            status: res.status as any,
            message: res.message,
            isLoading: false,
          });
        })
        .catch(() => {
          setMargin((prev) => ({ ...prev, isLoading: false }));
        });
    }, 250);

    return () => clearTimeout(timer);
  }, [isOpen, sym, token, exchange, side, productType, orderType, quantity, effectivePrice, account?.id]);

  if (!isOpen || !account || !holding) return null;

  // Validation
  const validateOrder = (): string | null => {
    if (quantity <= 0) {
      return 'Quantity must be at least 1 share.';
    }
    if (quote.lotSize > 1 && quantity % quote.lotSize !== 0) {
      return `Invalid derivative quantity: must be an exact multiple of lot size (${quote.lotSize}).`;
    }
    if (orderType !== 'MARKET' && (!parsedLimitPrice || parsedLimitPrice <= 0)) {
      return 'Please enter a valid Limit Price greater than zero.';
    }
    if (orderType === 'MARKET' && (!quote.ltp || quote.ltp <= 0)) {
      return 'Market order disabled: Live market quote unavailable. Please use a Limit order.';
    }
    if ((orderType === 'STOPLOSS_LIMIT' || orderType === 'STOPLOSS_MARKET') && (!triggerPrice || parseFloat(triggerPrice) <= 0)) {
      return 'Trigger price is required for Stop-Loss orders.';
    }
    if (side === 'SELL' && quantity > availableSellQty) {
      return `Insufficient sellable quantity. You own ${availableSellQty} verified shares available to sell.`;
    }
    if (side === 'SELL' && productType === 'DELIVERY' && !isSellable && !account.is_demo) {
      return 'CDSL eDIS authorization or active DDPI is required to submit sell orders for delivery holdings.';
    }
    if (side === 'BUY' && margin.requiredMargin !== null && !margin.isSufficient) {
      return `Insufficient funds: Required margin is ₹${margin.requiredMargin.toFixed(2)}, but available funds are ₹${(account.available_cash || 0).toFixed(2)}.`;
    }
    return null;
  };

  const handleReviewClick = (e: React.FormEvent) => {
    e.preventDefault();
    const err = validateOrder();
    if (err) {
      setErrorMsg(err);
      return;
    }
    setErrorMsg(null);
    setShowConfirmModal(true);
  };

  const handleFinalSubmit = async () => {
    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      const orderPayload = {
        account_id: account.id,
        tradingsymbol: sym,
        symbol_token: token || '0',
        exchange: exchange,
        transaction_type: side,
        order_type: orderType,
        product_type: productType,
        quantity: quantity,
        price: orderType === 'MARKET' ? 0.0 : effectivePrice,
        trigger_price: (orderType === 'STOPLOSS_LIMIT' || orderType === 'STOPLOSS_MARKET') ? (parseFloat(triggerPrice) || 0.0) : 0.0,
        variety: 'NORMAL',
        is_paper_trade: true, // Default safety mode: PAPER trading
      };

      await api.placeSingleOrder(orderPayload);
      onOrderSuccess(`Order submitted successfully: ${side} ${quantity} ${sym} (${productType}) [SIMULATED]`);
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Order execution failed. Please verify account status.');
      setShowConfirmModal(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  const isUp = (quote.dayChange ?? 0) >= 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-150 flex flex-col max-h-[92vh]">
        {/* Header with authentic market quote metadata */}
        <div className={`px-5 py-3.5 border-b flex items-center justify-between ${
          side === 'BUY' ? 'bg-emerald-50/70 border-emerald-100' : 'bg-rose-50/70 border-rose-100'
        }`}>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-base text-slate-900">{sym}</span>
              <span className="text-[11px] px-2 py-0.5 rounded font-mono font-bold bg-white border border-slate-200 text-slate-700">
                {exchange}
              </span>
              <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 text-[10px] font-bold rounded flex items-center gap-1">
                <ShieldCheck className="w-3 h-3 text-emerald-600" />
                <span>SIMULATED</span>
              </span>
            </div>
            <div className="text-xs text-slate-500 mt-0.5 truncate max-w-xs">
              {holding.company_name || sym} • <span className="font-semibold text-slate-700">{account.nickname}</span> ({account.masked_client_code})
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <div className="text-right">
              {quote.ltp !== null ? (
                <>
                  <div className="text-base font-mono font-bold text-slate-900">
                    ₹{quote.ltp.toFixed(2)}
                  </div>
                  <div className="text-[11px] font-semibold flex items-center justify-end gap-1">
                    <span className={`flex items-center ${isUp ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {isUp ? <TrendingUp className="w-3 h-3 inline mr-0.5" /> : <TrendingDown className="w-3 h-3 inline mr-0.5" />}
                      {isUp ? '+' : ''}{quote.dayChange?.toFixed(2)} ({isUp ? '+' : ''}{quote.dayChangePercent?.toFixed(2)}%)
                    </span>
                  </div>
                </>
              ) : (
                <div className="text-right">
                  <div className="text-xs font-semibold text-amber-600 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                    Price Unavailable
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5">Demat Session Required</div>
                </div>
              )}

              {/* Feed Status Tag */}
              <div className="mt-0.5 flex items-center justify-end gap-1">
                <span className={`w-1.5 h-1.5 rounded-full ${
                  quote.freshnessStatus === 'LIVE' ? 'bg-emerald-500 animate-pulse' :
                  quote.freshnessStatus === 'CACHED' ? 'bg-blue-500' : 'bg-slate-400'
                }`} />
                <span className="text-[9px] font-bold text-slate-400 tracking-wider">
                  {quote.freshnessStatus}
                </span>
              </div>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200/50 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Side Tabs */}
        <div className="grid grid-cols-2 p-1.5 bg-slate-100/70 gap-1 border-b border-slate-200">
          <button
            type="button"
            onClick={() => setSide('BUY')}
            className={`py-2 text-xs font-bold rounded-xl transition-all ${
              side === 'BUY'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'text-slate-600 hover:bg-white/60'
            }`}
          >
            BUY (Long)
          </button>
          <button
            type="button"
            onClick={() => setSide('SELL')}
            className={`py-2 text-xs font-bold rounded-xl transition-all ${
              side === 'SELL'
                ? 'bg-rose-600 text-white shadow-xs'
                : 'text-slate-600 hover:bg-white/60'
            }`}
          >
            SELL (Exit)
          </button>
        </div>

        {/* Order Form */}
        <form onSubmit={handleReviewClick} className="p-5 space-y-3.5 overflow-y-auto flex-1">
          {errorMsg && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Product Type & Order Type */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                Product
              </label>
              <div className="grid grid-cols-2 gap-1 bg-slate-100 p-1 rounded-xl">
                <button
                  type="button"
                  onClick={() => setProductType('DELIVERY')}
                  className={`py-1.5 text-xs font-bold rounded-lg transition-all ${
                    productType === 'DELIVERY'
                      ? 'bg-white text-slate-900 shadow-2xs'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  Delivery (CNC)
                </button>
                <button
                  type="button"
                  onClick={() => setProductType('INTRADAY')}
                  className={`py-1.5 text-xs font-bold rounded-lg transition-all ${
                    productType === 'INTRADAY'
                      ? 'bg-white text-slate-900 shadow-2xs'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  Intraday (MIS)
                </button>
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                Order Type
              </label>
              <select
                value={orderType}
                onChange={(e: any) => setOrderType(e.target.value)}
                className="w-full text-xs font-semibold bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-hidden focus:border-brand-500"
              >
                <option value="LIMIT">Limit</option>
                <option value="MARKET">Market</option>
                <option value="STOPLOSS_LIMIT">Stop-Loss Limit (SL)</option>
                <option value="STOPLOSS_MARKET">Stop-Loss Market (SL-M)</option>
              </select>
            </div>
          </div>

          {/* Quantity Input */}
          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                Quantity {quote.lotSize > 1 ? `(Lot Size: ${quote.lotSize})` : '(Shares)'}
              </label>
              {side === 'SELL' && (
                <span className="text-[11px] text-slate-500">
                  Sellable: <span className="font-mono font-bold text-slate-800">{availableSellQty}</span>
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={quote.lotSize}
                step={quote.lotSize}
                value={quantity || ''}
                onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 0))}
                className="flex-1 text-sm font-mono font-bold bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-slate-900 focus:outline-hidden focus:border-brand-500"
                placeholder="Qty"
                required
              />
              <div className="flex gap-1">
                {[1, 5, 10, 50, 100].map((step) => (
                  <button
                    key={step}
                    type="button"
                    onClick={() => setQuantity((prev) => prev + step * quote.lotSize)}
                    className="px-2 py-1.5 text-[10px] font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors"
                  >
                    +{step * quote.lotSize}
                  </button>
                ))}
                {side === 'SELL' && availableSellQty > 0 && (
                  <button
                    type="button"
                    onClick={() => setQuantity(availableSellQty)}
                    className="px-2.5 py-1.5 text-[10px] font-bold bg-rose-50 text-rose-700 hover:bg-rose-100 rounded-lg border border-rose-200 transition-colors"
                  >
                    All
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Limit Price & Trigger Price */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                Price (₹)
              </label>
              <input
                type="number"
                step={quote.tickSize || 0.05}
                min="0.01"
                value={orderType === 'MARKET' ? '' : limitPrice}
                onChange={(e) => {
                  setLimitPrice(e.target.value);
                  setIsLimitPriceUserEdited(true);
                }}
                disabled={orderType === 'MARKET'}
                placeholder={orderType === 'MARKET' ? 'Market Execution' : '0.00'}
                className="w-full text-sm font-mono font-bold bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-slate-900 focus:outline-hidden focus:border-brand-500 disabled:bg-slate-100 disabled:text-slate-400"
              />
              {orderType === 'MARKET' && (
                <p className="text-[10px] text-slate-400 mt-0.5 leading-tight">
                  Reference: ₹{quote.ltp?.toFixed(2) || '—'} (Execution price determined at exchange fill)
                </p>
              )}
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                Trigger Price (₹)
              </label>
              <input
                type="number"
                step={quote.tickSize || 0.05}
                min="0.01"
                value={(orderType === 'STOPLOSS_LIMIT' || orderType === 'STOPLOSS_MARKET') ? triggerPrice : ''}
                onChange={(e) => setTriggerPrice(e.target.value)}
                disabled={orderType !== 'STOPLOSS_LIMIT' && orderType !== 'STOPLOSS_MARKET'}
                placeholder={(orderType === 'STOPLOSS_LIMIT' || orderType === 'STOPLOSS_MARKET') ? 'Trigger ₹' : 'N/A'}
                className="w-full text-sm font-mono font-bold bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-slate-900 focus:outline-hidden focus:border-brand-500 disabled:bg-slate-100 disabled:text-slate-400"
              />
            </div>
          </div>

          {/* Genuine Financial Metrics: Required Margin vs Trade Value vs Charges */}
          <div className="bg-slate-50 rounded-xl p-3.5 border border-slate-200 space-y-2 text-xs">
            <div className="grid grid-cols-2 gap-3 pb-2 border-b border-slate-200">
              {/* Required Margin */}
              <div>
                <div className="flex items-center gap-1 text-[10px] text-slate-500 font-semibold uppercase">
                  <span>Required Margin</span>
                  <span className="px-1 py-0.2 bg-violet-100 text-violet-700 text-[9px] font-bold rounded">
                    {productType === 'INTRADAY' ? 'MIS ~5x' : 'CNC 1x'}
                  </span>
                </div>
                <div className="text-base font-bold font-mono text-slate-900 mt-0.5">
                  {margin.requiredMargin !== null ? (
                    `₹${margin.requiredMargin.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
                  ) : (
                    <span className="text-slate-400 text-xs font-normal">Margin unavailable</span>
                  )}
                </div>
                <div className="text-[10px] text-slate-400">
                  {margin.status === 'VERIFIED' ? 'SmartAPI broker estimate' : 'Regulatory SEBI margin'}
                </div>
              </div>

              {/* Total Order Value */}
              <div className="text-right">
                <div className="text-[10px] text-slate-500 font-semibold uppercase">
                  Total Order Value
                </div>
                <div className="text-base font-bold font-mono text-slate-900 mt-0.5">
                  ₹{estimatedOrderValue.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </div>
                <div className="text-[10px] text-slate-400">
                  {quantity} × ₹{effectivePrice.toFixed(2)}
                </div>
              </div>
            </div>

            {/* Funds & Charges Row */}
            <div className="flex items-center justify-between pt-1">
              <div>
                <span className="text-[11px] text-slate-500">Available Funds:</span>
                <span className="ml-1.5 font-mono font-bold text-slate-800">
                  ₹{(account.available_cash || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </span>
                {margin.requiredMargin !== null && !margin.isSufficient && (
                  <span className="ml-2 text-[10px] font-bold text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded border border-rose-200">
                    Shortfall: ₹{(margin.requiredMargin - (account.available_cash || 0)).toFixed(2)}
                  </span>
                )}
              </div>

              {/* Clickable Brokerage & Taxes Button */}
              <button
                type="button"
                onClick={() => setShowChargesModal(true)}
                className="text-[11px] font-semibold text-brand-600 hover:text-brand-700 flex items-center gap-1 bg-brand-50 hover:bg-brand-100/70 px-2.5 py-1 rounded-lg border border-brand-200 transition-colors"
              >
                <Calculator className="w-3 h-3" />
                <span>Charges: ₹{charges.totalCharges.toFixed(2)}</span>
                <span className="text-[9px] bg-white px-1 rounded text-brand-800 font-bold">EST</span>
              </button>
            </div>
          </div>

          {/* Review Button */}
          <div className="pt-1">
            <button
              type="submit"
              disabled={quote.ltp === null && orderType === 'MARKET'}
              className={`w-full py-3 rounded-xl text-xs font-bold text-white shadow-md transition-all flex items-center justify-center gap-2 ${
                side === 'BUY'
                  ? 'bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 disabled:bg-slate-300'
                  : 'bg-rose-600 hover:bg-rose-700 active:bg-rose-800 disabled:bg-slate-300'
              }`}
            >
              <span>Review {side} Order</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </form>

        {/* Charges Breakdown Modal */}
        {showChargesModal && (
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-40 animate-in fade-in duration-100">
            <div className="bg-white rounded-2xl p-5 shadow-2xl border border-slate-200 w-full max-w-sm space-y-3.5">
              <div className="flex items-center justify-between border-b pb-2.5">
                <div className="flex items-center gap-1.5">
                  <Calculator className="w-4 h-4 text-brand-600" />
                  <span className="font-bold text-slate-900 text-sm">Estimated Charges & Taxes</span>
                </div>
                <button onClick={() => setShowChargesModal(false)} className="text-slate-400 hover:text-slate-600">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-2 text-xs font-mono">
                <div className="flex justify-between text-slate-600">
                  <span>Angel One Brokerage</span>
                  <span className="font-bold text-slate-900">₹{charges.brokerage.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Securities Transaction Tax (STT)</span>
                  <span className="font-bold text-slate-900">₹{charges.stt.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Exchange Transaction Charges</span>
                  <span className="font-bold text-slate-900">₹{charges.exchangeCharges.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Stamp Duty (State Stamp Act)</span>
                  <span className="font-bold text-slate-900">₹{charges.stampDuty.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>SEBI Turnover Fees</span>
                  <span className="font-bold text-slate-900">₹{charges.sebiCharges.toFixed(4)}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>GST (18% on Services)</span>
                  <span className="font-bold text-slate-900">₹{charges.gst.toFixed(2)}</span>
                </div>
                {charges.dpCharges > 0 && (
                  <div className="flex justify-between text-slate-600">
                    <span>DP Charges (CDSL Settlement)</span>
                    <span className="font-bold text-slate-900">₹{charges.dpCharges.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between pt-2 border-t font-sans font-bold text-slate-900 text-sm">
                  <span>Total Estimated Charges</span>
                  <span className="font-mono text-brand-700">₹{charges.totalCharges.toFixed(2)}</span>
                </div>
              </div>

              <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-[10px] text-slate-500">
                {charges.disclaimer || 'Official Angel One Brokerage API estimate. Final statutory taxes applied upon exchange trade settlement.'}
              </div>

              <button
                type="button"
                onClick={() => setShowChargesModal(false)}
                className="w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        )}

        {/* Confirmation Modal */}
        {showConfirmModal && (
          <div className="absolute inset-0 bg-white/95 backdrop-blur-xs p-6 flex flex-col justify-between z-30 animate-in fade-in duration-100">
            <div>
              <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-brand-600" />
                  <span className="font-bold text-slate-900 text-sm">Confirm Order Submission</span>
                </div>
                <button onClick={() => setShowConfirmModal(false)} className="text-slate-400 hover:text-slate-600">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-2.5 text-xs">
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1.5">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Side:</span>
                    <span className={`font-bold ${side === 'BUY' ? 'text-emerald-700' : 'text-rose-700'}`}>{side}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Instrument:</span>
                    <span className="font-mono font-bold text-slate-900">{sym} ({exchange})</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Quantity:</span>
                    <span className="font-mono font-bold text-slate-900">{quantity} Shares</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Execution Price:</span>
                    <span className="font-mono font-bold text-slate-900">
                      {orderType === 'MARKET' ? `Market (Ref: ₹${quote.ltp?.toFixed(2) || '—'})` : `₹${effectivePrice.toFixed(2)}`}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Order & Product:</span>
                    <span className="font-semibold text-slate-800">{orderType} • {productType}</span>
                  </div>
                  <div className="flex justify-between pt-1 border-t border-slate-200">
                    <span className="text-slate-700 font-bold">Required Margin:</span>
                    <span className="font-mono font-bold text-violet-700">
                      ₹{margin.requiredMargin ? margin.requiredMargin.toFixed(2) : estimatedOrderValue.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-700 font-bold">Total Estimated Value:</span>
                    <span className="font-mono font-bold text-slate-900">₹{estimatedOrderValue.toFixed(2)}</span>
                  </div>
                </div>

                <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-xl text-[11px] text-amber-900">
                  <span className="font-bold">Execution Protection:</span> Operating in simulated PAPER trading mode. Simulated orders are safely isolated and do not execute live demat transactions without formal manual authorization.
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 pt-4 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowConfirmModal(false)}
                className="flex-1 py-2.5 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
              >
                Back to Edit
              </button>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={handleFinalSubmit}
                className={`flex-1 py-2.5 text-xs font-bold text-white rounded-xl shadow-md transition-all ${
                  side === 'BUY'
                    ? 'bg-emerald-600 hover:bg-emerald-700'
                    : 'bg-rose-600 hover:bg-rose-700'
                }`}
              >
                {isSubmitting ? 'Submitting...' : `Confirm & Place ${side}`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
