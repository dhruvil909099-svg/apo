import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  X, ShieldCheck, AlertCircle, TrendingUp, TrendingDown,
  Info, Check, HelpCircle, ArrowRight, RefreshCw, Calculator, FileText, Lock,
  Users, User, ChevronDown, CheckSquare, Square, Layers
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
  brokerage: number | null;
  stt: number | null;
  exchangeCharges: number | null;
  sebiCharges: number | null;
  stampDuty: number | null;
  gst: number | null;
  dpCharges: number | null;
  totalCharges: number | null;
  isBrokerVerified: boolean;
  dataSource: string;
  statusLabel?: string;
  disclaimer: string;
  errorReason?: string | null;
  accountId?: number | null;
  accountMaskedCode?: string | null;
  requestTimestamp?: string;
  isLoading: boolean;
}

interface MarginState {
  fullTradeValue: number;
  requiredMargin: number | null;
  marginForOrder?: number | null;
  totalMarginRequired?: number | null;
  marginComponents?: Record<string, any> | null;
  availableFunds: number;
  remainingFunds: number | null;
  isSufficient: boolean | null;
  leverageMultiplier: number;
  isBrokerVerified: boolean;
  dataSource: string;
  status: 'VERIFIED' | 'ESTIMATED' | 'UNAVAILABLE';
  statusLabel?: string;
  message: string;
  errorReason?: string | null;
  accountId?: number | null;
  accountMaskedCode?: string | null;
  requestTimestamp?: string;
  isLoading: boolean;
}

interface AccountBatchItem {
  account: Account;
  quantity: number;
  tradeValue: number;
  availableFunds: number;
  isEligible: boolean;
  validationReason: string;
}

export const OrderTicketModal: React.FC<OrderTicketModalProps> = ({
  isOpen,
  account: initialAccount,
  holding,
  defaultSide = 'BUY',
  defaultOrderType = 'LIMIT',
  onClose,
  onOrderSuccess,
}) => {
  // Accounts list from backend
  const [allAccounts, setAllAccounts] = useState<Account[]>([]);
  const [currentAccount, setCurrentAccount] = useState<Account | null>(initialAccount);
  const [isAccountDropdownOpen, setIsAccountDropdownOpen] = useState<boolean>(false);

  // Mode: Single Account vs Multiple Accounts
  const [tradingScope, setTradingScope] = useState<'SINGLE' | 'MULTI'>('SINGLE');
  const [selectedAccountIds, setSelectedAccountIds] = useState<number[]>([]);
  const [accountQuantities, setAccountQuantities] = useState<Record<number, number>>({});

  // Core Order State
  const [side, setSide] = useState<'BUY' | 'SELL'>(defaultSide);
  const [productType, setProductType] = useState<'DELIVERY' | 'INTRADAY'>('DELIVERY');
  const [orderType, setOrderType] = useState<'LIMIT' | 'MARKET' | 'STOPLOSS_LIMIT' | 'STOPLOSS_MARKET'>(defaultOrderType);
  const [quantity, setQuantity] = useState<number>(1);
  const [limitPrice, setLimitPrice] = useState<string>('');
  const [triggerPrice, setTriggerPrice] = useState<string>('');
  const [isLimitPriceUserEdited, setIsLimitPriceUserEdited] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Modals & Views
  const [showConfirmModal, setShowConfirmModal] = useState<boolean>(false);
  const [showChargesModal, setShowChargesModal] = useState<boolean>(false);
  const [showMarginBreakdownModal, setShowMarginBreakdownModal] = useState<boolean>(false);
  const [showBatchResultsModal, setShowBatchResultsModal] = useState<boolean>(false);
  const [batchResults, setBatchResults] = useState<any[]>([]);
  const [batchSummary, setBatchSummary] = useState<{ total: number; success: number; failed: number } | null>(null);

  // Request sequence tracking to prevent stale in-flight responses from overwriting latest settings
  const requestIdRef = useRef<number>(0);

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
    brokerage: null,
    stt: null,
    exchangeCharges: null,
    sebiCharges: null,
    stampDuty: null,
    gst: null,
    dpCharges: null,
    totalCharges: null,
    isBrokerVerified: false,
    dataSource: 'PENDING_INITIALIZATION',
    statusLabel: 'UNAVAILABLE',
    disclaimer: '',
    errorReason: null,
    isLoading: false,
  });

  const [margin, setMargin] = useState<MarginState>({
    fullTradeValue: 0,
    requiredMargin: null,
    marginForOrder: null,
    totalMarginRequired: null,
    marginComponents: null,
    availableFunds: initialAccount?.available_cash || 0,
    remainingFunds: null,
    isSufficient: null,
    leverageMultiplier: 1.0,
    isBrokerVerified: false,
    dataSource: 'PENDING_INITIALIZATION',
    status: 'UNAVAILABLE',
    statusLabel: 'UNAVAILABLE',
    message: '',
    errorReason: null,
    isLoading: false,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  const sym = holding?.trading_symbol || holding?.symbol || '';
  const token = holding?.symbol_token || '';
  const exchange = holding?.exchange || 'NSE';
  const availableSellQty = holding?.available_quantity ?? holding?.quantity ?? 0;

  const round2 = (v: number) => Math.round(v * 100) / 100;

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsAccountDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // 1. Fetch authorized connected accounts on mount
  useEffect(() => {
    if (!isOpen) return;
    api.getAccounts()
      .then((accs) => {
        setAllAccounts(accs || []);
        if (initialAccount) {
          const matched = accs.find((a) => a.id === initialAccount.id) || initialAccount;
          setCurrentAccount(matched);
          setSelectedAccountIds([matched.id]);
        } else if (accs && accs.length > 0) {
          // If no initial account passed, default to first connected account or leave for explicit selection
          setCurrentAccount(accs[0]);
          setSelectedAccountIds([accs[0].id]);
        }
      })
      .catch((err) => {
        console.error('Failed to load accounts for ticket:', err);
      });
  }, [isOpen, initialAccount]);

  // Sync available funds whenever currentAccount changes
  useEffect(() => {
    if (currentAccount) {
      setMargin((prev) => ({
        ...prev,
        availableFunds: currentAccount.available_cash || 0,
      }));
    }
  }, [currentAccount]);

  // 2. Fetch genuine quote and subscribe to WebSocket
  useEffect(() => {
    if (!isOpen || !holding) return;

    setSide(defaultSide);
    setOrderType(defaultOrderType);
    setErrorMsg(null);
    setShowConfirmModal(false);
    setShowBatchResultsModal(false);
    setIsLimitPriceUserEdited(false);

    // Initial quantity
    if (defaultSide === 'SELL' && availableSellQty > 0) {
      setQuantity(availableSellQty);
    } else {
      setQuantity(1);
    }

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

        if (ltpVal !== null) {
          setLimitPrice(ltpVal.toFixed(2));
          setTriggerPrice((ltpVal * 0.98).toFixed(2));
        } else {
          setLimitPrice('');
          setTriggerPrice('');
        }
      })
      .catch(() => {
        setQuote((prev) => ({
          ...prev,
          ltp: null,
          freshnessStatus: 'UNAVAILABLE',
          source: 'PRICE_UNAVAILABLE',
          isLoading: false,
        }));
      });

    // Establish WebSocket subscription for live ticks
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

  // Effective calculation price
  const parsedLimitPrice = parseFloat(limitPrice) || 0;
  const effectivePrice = orderType === 'MARKET' ? (quote.ltp || 0) : parsedLimitPrice;
  const estimatedOrderValue = round2(quantity * effectivePrice);

  // 3. Debounced Brokerage & Margin Estimation with ORDER_TYPE & ACCOUNT_ID included
  useEffect(() => {
    if (!isOpen || effectivePrice <= 0 || quantity <= 0) return;

    const reqId = ++requestIdRef.current;

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
        account_id: currentAccount?.id,
      })
        .then((res) => {
          if (reqId !== requestIdRef.current) return;
          setCharges({
            tradeValue: res.trade_value,
            brokerage: res.brokerage,
            stt: res.stt_ctt,
            exchangeCharges: res.exchange_charges,
            sebiCharges: res.sebi_charges,
            stampDuty: res.stamp_duty,
            gst: res.gst,
            dpCharges: res.dpCharges ?? res.dp_charges ?? null,
            totalCharges: res.total_charges,
            isBrokerVerified: Boolean(res.is_broker_verified),
            dataSource: res.data_source,
            statusLabel: res.status_label || (res.is_broker_verified ? 'BROKER ESTIMATE' : 'UNAVAILABLE'),
            disclaimer: res.disclaimer,
            errorReason: res.error_reason,
            accountId: res.account_id ?? currentAccount?.id,
            accountMaskedCode: res.account_masked_code ?? currentAccount?.masked_client_code,
            requestTimestamp: res.request_timestamp,
            isLoading: false,
          });
        })
        .catch((err) => {
          if (reqId !== requestIdRef.current) return;
          setCharges((prev) => ({
            ...prev,
            totalCharges: null,
            isBrokerVerified: false,
            statusLabel: 'UNAVAILABLE',
            errorReason: err.message || 'Charges unavailable',
            isLoading: false,
          }));
        });

      // Fetch Margin with ORDER_TYPE and ACCOUNT_ID explicitly passed
      setMargin((prev) => ({ ...prev, isLoading: true }));
      api.calculateMargin({
        exchange,
        symbol_token: token,
        tradingsymbol: sym,
        transaction_type: side,
        product_type: productType,
        quantity,
        price: effectivePrice,
        order_type: orderType,
        account_id: currentAccount?.id,
      })
        .then((res) => {
          if (reqId !== requestIdRef.current) return;
          setMargin({
            fullTradeValue: res.full_trade_value,
            requiredMargin: res.required_margin,
            marginForOrder: res.margin_for_order ?? res.required_margin,
            totalMarginRequired: res.total_margin_required ?? res.required_margin,
            marginComponents: res.margin_components ?? null,
            availableFunds: res.available_funds,
            remainingFunds: res.remaining_funds,
            isSufficient: res.is_sufficient,
            leverageMultiplier: res.leverage_multiplier,
            isBrokerVerified: Boolean(res.is_broker_verified),
            dataSource: res.data_source,
            status: res.status as any,
            statusLabel: res.status_label || (res.is_broker_verified ? 'BROKER ESTIMATE' : 'UNAVAILABLE'),
            message: res.message,
            errorReason: res.error_reason,
            accountId: res.account_id ?? currentAccount?.id,
            accountMaskedCode: res.account_masked_code ?? currentAccount?.masked_client_code,
            requestTimestamp: res.request_timestamp,
            isLoading: false,
          });
        })
        .catch((err) => {
          if (reqId !== requestIdRef.current) return;
          setMargin((prev) => ({
            ...prev,
            requiredMargin: null,
            isBrokerVerified: false,
            isSufficient: null,
            statusLabel: 'UNAVAILABLE',
            errorReason: err.message || 'Margin unavailable',
            isLoading: false,
          }));
        });
    }, 200);

    return () => clearTimeout(timer);
  }, [isOpen, sym, token, exchange, side, productType, orderType, quantity, effectivePrice, currentAccount?.id]);

  // Multi-account batch items calculation
  const multiAccountBatchItems: AccountBatchItem[] = useMemo(() => {
    return allAccounts
      .filter((acc) => selectedAccountIds.includes(acc.id))
      .map((acc) => {
        const qty = accountQuantities[acc.id] ?? quantity;
        const val = round2(qty * effectivePrice);
        const availCash = acc.available_cash || 0;
        let isEligible = true;
        let reason = 'Ready for paper submission';

        if (!acc.is_enabled) {
          isEligible = false;
          reason = 'Account is disabled';
        } else if (!acc.is_demo && acc.auth_status !== 'CONNECTED') {
          isEligible = false;
          reason = `Disconnected (${acc.auth_status})`;
        } else if (side === 'BUY' && availCash < val) {
          isEligible = false;
          reason = `Insufficient funds: Need ₹${val.toFixed(2)}, has ₹${availCash.toFixed(2)}`;
        }

        return {
          account: acc,
          quantity: qty,
          tradeValue: val,
          availableFunds: availCash,
          isEligible,
          validationReason: reason,
        };
      });
  }, [allAccounts, selectedAccountIds, accountQuantities, quantity, effectivePrice, side]);

  if (!isOpen || !holding) return null;

  // Validation function
  const validateOrder = (): string | null => {
    if (!currentAccount && tradingScope === 'SINGLE') {
      return 'Please select an authorized trading account to proceed.';
    }
    if (tradingScope === 'MULTI' && selectedAccountIds.length === 0) {
      return 'Please select at least one account for the multi-account paper batch.';
    }
    if (quantity <= 0) {
      return 'Quantity must be at least 1 share.';
    }
    if (quote.lotSize > 1 && quantity % quote.lotSize !== 0) {
      return `Invalid derivative quantity: must be an exact multiple of lot size (${quote.lotSize}).`;
    }
    if (orderType === 'LIMIT' && parsedLimitPrice <= 0) {
      return 'Limit price must be greater than zero.';
    }
    if (orderType === 'MARKET' && quote.ltp === null) {
      return 'Market order rejected: Live market quote is currently unavailable.';
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

  // Submit Single Order (Paper or Live)
  const handleSingleSubmit = async () => {
    if (!currentAccount) return;
    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      const orderPayload = {
        account_id: currentAccount.id,
        tradingsymbol: sym,
        symbol_token: token || '0',
        exchange,
        transaction_type: side,
        order_type: orderType,
        product_type: productType,
        variety: 'NORMAL',
        quantity,
        price: orderType === 'MARKET' ? (quote.ltp || 0) : parsedLimitPrice,
        trigger_price: parseFloat(triggerPrice) || 0,
      };

      const res = await api.placeSingleOrder(orderPayload);
      setIsSubmitting(false);
      setShowConfirmModal(false);
      const isPaper = res.is_paper_trade ?? true;
      onOrderSuccess(
        isPaper
          ? `Paper order executed in simulator! Status: ${res.status} (Client ID: ${res.client_order_id?.slice(0, 8) || 'N/A'}). Note: Simulated orders do NOT appear in the Angel One app.`
          : `Live order placed with Angel One! Status: ${res.status} (Broker Order ID: ${res.broker_order_id})`
      );
      onClose();
    } catch (err: any) {
      setIsSubmitting(false);
      setErrorMsg(err.message || 'Order submission failed.');
    }
  };

  // Submit Multi-Account Paper Batch
  const handleMultiBatchSubmit = async () => {
    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      const targets = multiAccountBatchItems.map((item) => ({
        account_id: item.account.id,
        quantity: item.quantity,
        price_override: effectivePrice,
      }));

      // 1. Prepare batch
      const prepRes = await api.prepareBulkOrders({
        tradingsymbol: sym,
        symbol_token: token || '0',
        exchange,
        transaction_type: side,
        order_type: orderType,
        product_type: productType,
        price: effectivePrice,
        accounts: targets,
      });

      // 2. Execute batch
      const execRes = await api.executeBulkOrders(prepRes.batch_id, true);

      setIsSubmitting(false);
      setShowConfirmModal(false);

      if (execRes && execRes.results) {
        setBatchResults(execRes.results);
        const successCount = execRes.results.filter((r: any) => r.status === 'ACCEPTED' || r.status === 'EXECUTED' || r.status === 'SUBMITTED').length;
        setBatchSummary({
          total: execRes.results.length,
          success: successCount,
          failed: execRes.results.length - successCount,
        });
        setShowBatchResultsModal(true);
      } else {
        onOrderSuccess(`Multi-account batch confirmed! Processed ${targets.length} paper accounts.`);
        onClose();
      }
    } catch (err: any) {
      setIsSubmitting(false);
      setErrorMsg(err.message || 'Multi-account paper batch submission failed.');
    }
  };

  const isUp = (quote.dayChange ?? 0) >= 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="relative bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 flex flex-col max-h-[94vh]">
        
        {/* HEADER: Symbol, Account Selector Dropdown, Live Price, Close */}
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
                <span>SIMULATED PAPER</span>
              </span>
            </div>

            {/* Account Selector Dropdown */}
            <div className="relative mt-1.5" ref={dropdownRef}>
              <button
                type="button"
                onClick={() => setIsAccountDropdownOpen(!isAccountDropdownOpen)}
                className="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-white border border-slate-200 hover:border-brand-500 text-xs font-semibold text-slate-800 shadow-2xs transition"
              >
                <User className="w-3.5 h-3.5 text-brand-600" />
                <span>
                  {currentAccount
                    ? `${currentAccount.nickname} (${currentAccount.masked_client_code})`
                    : 'Select Trading Account'}
                </span>
                <span className={`w-2 h-2 rounded-full ${
                  currentAccount?.auth_status === 'CONNECTED' ? 'bg-emerald-500' : 'bg-amber-500'
                }`} />
                <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
              </button>

              {isAccountDropdownOpen && (
                <div className="absolute left-0 mt-1 w-72 max-h-60 overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-xl z-50 py-1">
                  <div className="px-3 py-1.5 border-b text-[10px] font-bold uppercase text-slate-400">
                    Authorized Demat Accounts
                  </div>
                  {allAccounts.map((acc) => {
                    const isSelected = currentAccount?.id === acc.id;
                    return (
                      <button
                        key={acc.id}
                        type="button"
                        onClick={() => {
                          setCurrentAccount(acc);
                          if (!selectedAccountIds.includes(acc.id)) {
                            setSelectedAccountIds([acc.id]);
                          }
                          setIsAccountDropdownOpen(false);
                        }}
                        className={`w-full flex items-center justify-between px-3 py-2 text-xs text-left hover:bg-slate-50 transition ${
                          isSelected ? 'bg-brand-50/60 font-bold text-brand-800' : 'text-slate-700'
                        }`}
                      >
                        <div>
                          <div className="font-semibold text-slate-900">{acc.nickname}</div>
                          <div className="text-[10px] text-slate-400 font-mono">
                            {acc.masked_client_code} • Funds: ₹{(acc.available_cash || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          </div>
                        </div>
                        <div className="flex items-center space-x-1.5">
                          <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${
                            acc.auth_status === 'CONNECTED' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
                          }`}>
                            {acc.auth_status}
                          </span>
                          {isSelected && <Check className="w-3.5 h-3.5 text-brand-600" />}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Right: Live Quote and Close */}
          <div className="flex items-center gap-3">
            <div className="text-right">
              {typeof quote.ltp === 'number' && Number.isFinite(quote.ltp) ? (
                <>
                  <div className="text-base font-mono font-bold text-slate-900">
                    ₹{quote.ltp.toFixed(2)}
                  </div>
                  <div className="text-[11px] font-semibold flex items-center justify-end gap-1">
                    <span className={`flex items-center ${isUp ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {isUp ? <TrendingUp className="w-3 h-3 inline mr-0.5" /> : <TrendingDown className="w-3 h-3 inline mr-0.5" />}
                      {typeof quote.dayChange === 'number' && Number.isFinite(quote.dayChange) ? `${isUp ? '+' : ''}${quote.dayChange.toFixed(2)}` : ''}
                      {typeof quote.dayChangePercent === 'number' && Number.isFinite(quote.dayChangePercent) ? ` (${isUp ? '+' : ''}${quote.dayChangePercent.toFixed(2)}%)` : ''}
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

        {/* TRADING SCOPE SELECTOR: Single Account vs Multiple Accounts */}
        <div className="flex items-center justify-between px-5 py-2 bg-slate-50 border-b border-slate-200">
          <div className="flex space-x-2 text-xs font-bold">
            <button
              type="button"
              onClick={() => setTradingScope('SINGLE')}
              className={`px-3 py-1 rounded-lg transition ${
                tradingScope === 'SINGLE'
                  ? 'bg-brand-600 text-white shadow-2xs'
                  : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
              }`}
            >
              <User className="w-3 h-3 inline mr-1" />
              Single Account
            </button>
            <button
              type="button"
              onClick={() => {
                setTradingScope('MULTI');
                if (selectedAccountIds.length === 0 && allAccounts.length > 0) {
                  setSelectedAccountIds(allAccounts.map((a) => a.id));
                }
              }}
              className={`px-3 py-1 rounded-lg transition ${
                tradingScope === 'MULTI'
                  ? 'bg-brand-600 text-white shadow-2xs'
                  : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
              }`}
            >
              <Users className="w-3 h-3 inline mr-1" />
              Multiple Accounts ({selectedAccountIds.length})
            </button>
          </div>

          {tradingScope === 'MULTI' && (
            <div className="flex items-center space-x-2 text-xs">
              <button
                type="button"
                onClick={() => setSelectedAccountIds(allAccounts.map((a) => a.id))}
                className="text-brand-600 hover:underline font-semibold"
              >
                Select All
              </button>
              <span className="text-slate-300">•</span>
              <button
                type="button"
                onClick={() => setSelectedAccountIds([])}
                className="text-slate-500 hover:underline"
              >
                Clear
              </button>
            </div>
          )}
        </div>

        {/* Side Tabs: BUY (Long) vs SELL (Exit) */}
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

        {/* ORDER FORM */}
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

          {/* Quantity & Base Quantity Input */}
          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                {tradingScope === 'MULTI' ? 'Base Quantity (per account)' : `Quantity ${quote.lotSize > 1 ? `(Lot Size: ${quote.lotSize})` : '(Shares)'}`}
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
                onChange={(e) => {
                  const val = Math.max(1, parseInt(e.target.value) || 0);
                  setQuantity(val);
                  // Update per-account quantities to match if in multi mode
                  if (tradingScope === 'MULTI') {
                    const newQs: Record<number, number> = {};
                    selectedAccountIds.forEach((id) => (newQs[id] = val));
                    setAccountQuantities(newQs);
                  }
                }}
                className="flex-1 text-sm font-mono font-bold bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-slate-900 focus:outline-hidden focus:border-brand-500"
                placeholder="Qty"
                required
              />
              <div className="flex gap-1">
                {[1, 5, 10, 50, 100].map((step) => (
                  <button
                    key={step}
                    type="button"
                    onClick={() => {
                      const newQty = quantity + step * quote.lotSize;
                      setQuantity(newQty);
                      if (tradingScope === 'MULTI') {
                        const newQs: Record<number, number> = {};
                        selectedAccountIds.forEach((id) => (newQs[id] = newQty));
                        setAccountQuantities(newQs);
                      }
                    }}
                    className="px-2 py-1.5 text-[10px] font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors"
                  >
                    +{step * quote.lotSize}
                  </button>
                ))}
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

          {/* MULTI-ACCOUNT BATCH WORKSPACE TABLE */}
          {tradingScope === 'MULTI' ? (
            <div className="bg-slate-50 rounded-xl p-3 border border-slate-200 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                  <Layers className="w-4 h-4 text-brand-600" />
                  <span>Multi-Account Batch Allocation</span>
                </span>
                <span className="text-[11px] text-slate-500">
                  {selectedAccountIds.length} of {allAccounts.length} selected
                </span>
              </div>

              <div className="max-h-48 overflow-y-auto border border-slate-200 rounded-lg bg-white">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-100 text-[10px] text-slate-500 uppercase font-semibold sticky top-0">
                    <tr>
                      <th className="p-2 w-8"></th>
                      <th className="p-2">Account</th>
                      <th className="p-2 text-right">Qty</th>
                      <th className="p-2 text-right">Value (₹)</th>
                      <th className="p-2 text-right">Funds</th>
                      <th className="p-2">Eligibility</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-mono">
                    {allAccounts.map((acc) => {
                      const isChecked = selectedAccountIds.includes(acc.id);
                      const item = multiAccountBatchItems.find((b) => b.account.id === acc.id);
                      const itemQty = accountQuantities[acc.id] ?? quantity;
                      const itemVal = round2(itemQty * effectivePrice);

                      return (
                        <tr key={acc.id} className={isChecked ? 'bg-brand-50/20' : 'opacity-60'}>
                          <td className="p-2 text-center">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedAccountIds((prev) => [...prev, acc.id]);
                                } else {
                                  setSelectedAccountIds((prev) => prev.filter((id) => id !== acc.id));
                                }
                              }}
                              className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                            />
                          </td>
                          <td className="p-2 font-sans">
                            <div className="font-semibold text-slate-900">{acc.nickname}</div>
                            <div className="text-[10px] text-slate-400 font-mono">{acc.masked_client_code}</div>
                          </td>
                          <td className="p-2 text-right">
                            {isChecked ? (
                              <input
                                type="number"
                                min={quote.lotSize}
                                step={quote.lotSize}
                                value={itemQty}
                                onChange={(e) => {
                                  const q = Math.max(1, parseInt(e.target.value) || 0);
                                  setAccountQuantities((prev) => ({ ...prev, [acc.id]: q }));
                                }}
                                className="w-16 px-1.5 py-0.5 text-right font-mono font-bold text-xs border rounded bg-slate-50"
                              />
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="p-2 text-right font-bold text-slate-900">
                            {isChecked ? `₹${itemVal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '—'}
                          </td>
                          <td className="p-2 text-right text-slate-600">
                            ₹{(acc.available_cash || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          </td>
                          <td className="p-2 font-sans">
                            {isChecked && item ? (
                              item.isEligible ? (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">
                                  Eligible
                                </span>
                              ) : (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800" title={item.validationReason}>
                                  Blocked
                                </span>
                              )
                            ) : (
                              <span className="text-slate-400 text-[10px]">Excluded</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            /* SINGLE ACCOUNT FINANCIAL METRICS */
            <div className="bg-slate-50 rounded-xl p-3.5 border border-slate-200 space-y-2 text-xs">
              <div className="grid grid-cols-2 gap-3 pb-2 border-b border-slate-200">
                {/* Margin for Order */}
                <div>
                  <div className="flex items-center gap-1.5 text-[10px] text-slate-500 font-semibold uppercase">
                    <span>Margin for Order</span>
                    <span className="px-1 py-0.2 bg-violet-100 text-violet-700 text-[9px] font-bold rounded">
                      {productType === 'INTRADAY' ? 'MIS ~5x' : 'CNC 1x'}
                    </span>
                    <span className={`px-1 py-0.2 text-[9px] font-bold rounded ${margin.isBrokerVerified ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                      {margin.isBrokerVerified ? 'BROKER ESTIMATE' : 'UNAVAILABLE'}
                    </span>
                  </div>
                  <div className="text-base font-bold font-mono text-slate-900 mt-0.5">
                    {typeof margin.requiredMargin === 'number' && Number.isFinite(margin.requiredMargin) ? (
                      `₹${margin.requiredMargin.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
                    ) : (
                      <span className="text-amber-600 text-xs font-semibold">Margin unavailable</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] text-slate-400">
                      {margin.isBrokerVerified
                        ? (orderType === 'MARKET' ? 'SmartAPI Margin (+0.5% buffer)' : 'SmartAPI Margin (Limit 100%)')
                        : (margin.errorReason || 'Broker session required')}
                    </span>
                    {margin.requiredMargin !== null && (
                      <button
                        type="button"
                        onClick={() => setShowMarginBreakdownModal(true)}
                        className="text-[10px] text-brand-600 hover:text-brand-800 font-semibold underline flex items-center gap-0.5"
                      >
                        <span>Breakdown</span>
                        <Info className="w-2.5 h-2.5" />
                      </button>
                    )}
                  </div>
                  {margin.requiredMargin !== null && charges.totalCharges !== null && (
                    <div className="text-[10px] text-slate-500 font-mono mt-1 pt-1 border-t border-slate-200">
                      Total Req: <span className="font-bold text-slate-800">₹{(margin.requiredMargin + charges.totalCharges).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span> <span className="text-[9px] text-slate-400">(incl charges)</span>
                    </div>
                  )}
                </div>

                {/* Total Order Value */}
                <div className="text-right">
                  <div className="flex items-center justify-end gap-1.5 text-[10px] text-slate-500 font-semibold uppercase">
                    <span>Total Order Value</span>
                    <span className="px-1 py-0.2 bg-slate-200 text-slate-700 text-[9px] font-bold rounded">
                      CALCULATED
                    </span>
                  </div>
                  <div className="text-base font-bold font-mono text-slate-900 mt-0.5">
                    ₹{estimatedOrderValue.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </div>
                  <div className="text-[10px] text-slate-400">
                    {quantity} × ₹{effectivePrice.toFixed(2)}
                  </div>
                  <div className="text-[10px] text-slate-500 font-sans mt-1 pt-1 border-t border-slate-200">
                    {orderType === 'MARKET' ? (
                      <span className="text-emerald-700 font-medium">Market Order (Dynamic Fill)</span>
                    ) : (
                      <span className="text-slate-600">Limit @ ₹{effectivePrice.toFixed(2)}</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Funds & Charges Row */}
              <div className="flex items-center justify-between pt-1">
                <div>
                  <span className="text-[11px] text-slate-500">Available Funds:</span>
                  <span className="ml-1.5 font-mono font-bold text-slate-800">
                    ₹{((currentAccount?.available_cash) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </span>
                  <span className="ml-1 text-[9px] px-1 py-0.2 bg-slate-100 text-slate-600 border border-slate-200 rounded font-semibold">
                    {currentAccount?.is_demo ? 'SIMULATED RMS' : 'SMARTAPI RMS'}
                  </span>
                  {margin.requiredMargin !== null ? (
                    ((margin.requiredMargin + (charges.totalCharges || 0)) > ((currentAccount?.available_cash) || 0)) ? (
                      <span className="ml-2 text-[10px] font-bold text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded border border-rose-200">
                        Shortfall: ₹{((margin.requiredMargin + (charges.totalCharges || 0)) - ((currentAccount?.available_cash) || 0)).toFixed(2)}
                      </span>
                    ) : (
                      <span className="ml-2 text-[10px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                        Sufficient
                      </span>
                    )
                  ) : (
                    <span className="ml-2 text-[10px] font-semibold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                      Margin unverified
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
                  <span>Charges: {typeof charges.totalCharges === 'number' && Number.isFinite(charges.totalCharges) ? `₹${charges.totalCharges.toFixed(2)}` : 'Unavailable'}</span>
                  <span className="text-[9px] bg-white px-1 rounded text-brand-800 font-bold">
                    {charges.isBrokerVerified ? 'BROKER ESTIMATE' : 'UNAVAILABLE'}
                  </span>
                </button>
              </div>
            </div>
          )}

          {/* Action Button */}
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
              <span>{tradingScope === 'MULTI' ? `Review Multi-Account Paper Batch (${selectedAccountIds.length})` : `Review ${side} Order`}</span>
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
                  <span className="font-bold text-slate-900">
                    {typeof charges.brokerage === 'number' && Number.isFinite(charges.brokerage) ? `₹${charges.brokerage.toFixed(2)}` : 'Not provided'}
                  </span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Securities Transaction Tax (STT)</span>
                  <span className="font-bold text-slate-900">
                    {typeof charges.stt === 'number' && Number.isFinite(charges.stt) ? `₹${charges.stt.toFixed(2)}` : 'Not provided'}
                  </span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Exchange Transaction Charges</span>
                  <span className="font-bold text-slate-900">
                    {typeof charges.exchangeCharges === 'number' && Number.isFinite(charges.exchangeCharges) ? `₹${charges.exchangeCharges.toFixed(2)}` : 'Not provided'}
                  </span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Stamp Duty (State Stamp Act)</span>
                  <span className="font-bold text-slate-900">
                    {typeof charges.stampDuty === 'number' && Number.isFinite(charges.stampDuty) ? `₹${charges.stampDuty.toFixed(2)}` : 'Not provided'}
                  </span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>SEBI Turnover Fees</span>
                  <span className="font-bold text-slate-900">
                    {typeof charges.sebiCharges === 'number' && Number.isFinite(charges.sebiCharges) ? `₹${charges.sebiCharges.toFixed(4)}` : 'Not provided'}
                  </span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>GST (18% on Services)</span>
                  <span className="font-bold text-slate-900">
                    {typeof charges.gst === 'number' && Number.isFinite(charges.gst) ? `₹${charges.gst.toFixed(2)}` : 'Not provided'}
                  </span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>DP Charges (CDSL Settlement)</span>
                  <span className="font-bold text-slate-500 text-[11px]">
                    {typeof charges.dpCharges === 'number' && Number.isFinite(charges.dpCharges) ? `₹${charges.dpCharges.toFixed(2)}` : 'Not included in broker estimate'}
                  </span>
                </div>
                <div className="flex justify-between pt-2 border-t font-sans font-bold text-slate-900 text-sm">
                  <span>Total Estimated Charges</span>
                  <span className="font-mono text-brand-700">
                    {typeof charges.totalCharges === 'number' && Number.isFinite(charges.totalCharges) ? `₹${charges.totalCharges.toFixed(2)}` : 'Charges Unavailable'}
                  </span>
                </div>
              </div>

              <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-[10px] text-slate-500 space-y-1">
                <div>{charges.disclaimer || 'Official Angel One Brokerage API estimate. Final statutory taxes applied upon exchange trade settlement.'}</div>
                {currentAccount && (
                  <div className="font-mono text-[9px] text-slate-400">Account: {currentAccount.nickname} ({currentAccount.masked_client_code})</div>
                )}
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

        {/* SmartAPI Margin & Funds Breakdown Modal */}
        {showMarginBreakdownModal && (
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-40 animate-in fade-in duration-100">
            <div className="bg-white rounded-2xl p-5 shadow-2xl border border-slate-200 w-full max-w-md space-y-3.5">
              <div className="flex items-center justify-between border-b pb-2.5">
                <div className="flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-brand-600" />
                  <span className="font-bold text-slate-900 text-sm">SmartAPI Margin & Funds Breakdown</span>
                </div>
                <button onClick={() => setShowMarginBreakdownModal(false)} className="text-slate-400 hover:text-slate-600">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-2 text-xs font-mono">
                <div className="flex justify-between text-slate-600">
                  <span>Trade Value</span>
                  <span className="font-bold text-slate-900">
                    ₹{estimatedOrderValue.toFixed(2)} <span className="text-[10px] text-slate-400 font-sans font-normal">(CALCULATED)</span>
                  </span>
                </div>

                <div className="flex justify-between text-slate-600">
                  <span>Angel One Brokerage</span>
                  <span className="font-bold text-slate-900">
                    {typeof charges.brokerage === 'number' && Number.isFinite(charges.brokerage) ? `₹${charges.brokerage.toFixed(2)}` : 'Not provided'}
                  </span>
                </div>

                <div className="flex justify-between text-slate-600">
                  <span>External Charges (Exch/Stamp/SEBI)</span>
                  <span className="font-bold text-slate-900">
                    {typeof charges.exchangeCharges === 'number' && typeof charges.stampDuty === 'number'
                      ? `₹${((charges.exchangeCharges || 0) + (charges.stampDuty || 0) + (charges.sebiCharges || 0)).toFixed(2)}`
                      : 'Not provided'}
                  </span>
                </div>

                <div className="flex justify-between text-slate-600">
                  <span>Taxes (STT + GST)</span>
                  <span className="font-bold text-slate-900">
                    {typeof charges.stt === 'number' && typeof charges.gst === 'number'
                      ? `₹${((charges.stt || 0) + (charges.gst || 0)).toFixed(2)}`
                      : 'Not provided'}
                  </span>
                </div>

                <div className="flex justify-between text-slate-600 pt-1 border-t border-dashed">
                  <span>Total Charges</span>
                  <span className="font-bold text-slate-900">
                    + {typeof charges.totalCharges === 'number' && Number.isFinite(charges.totalCharges) ? `₹${charges.totalCharges.toFixed(2)}` : 'Unavailable'}
                  </span>
                </div>

                <div className="flex justify-between text-slate-600">
                  <span className="flex items-center gap-1">
                    <span>Margin for Order</span>
                    <span className="text-[9px] px-1 bg-emerald-100 text-emerald-800 rounded font-sans font-semibold">BROKER ESTIMATE</span>
                  </span>
                  <span className="font-bold text-slate-900">
                    + {typeof margin.requiredMargin === 'number' && Number.isFinite(margin.requiredMargin) ? `₹${margin.requiredMargin.toFixed(2)}` : 'Unavailable'}
                  </span>
                </div>

                {margin.marginComponents && (
                  <div className="pl-3 py-1 bg-slate-50 rounded text-[11px] text-slate-500 space-y-0.5">
                    {margin.marginComponents.netMargin !== undefined && (
                      <div className="flex justify-between"><span>Net Margin:</span><span className="font-mono">₹{parseFloat(margin.marginComponents.netMargin).toFixed(2)}</span></div>
                    )}
                    {margin.marginComponents.varMargin !== undefined && parseFloat(margin.marginComponents.varMargin) > 0 && (
                      <div className="flex justify-between"><span>VAR Margin:</span><span className="font-mono">₹{parseFloat(margin.marginComponents.varMargin).toFixed(2)}</span></div>
                    )}
                    {margin.marginComponents.extremeLossMargin !== undefined && parseFloat(margin.marginComponents.extremeLossMargin) > 0 && (
                      <div className="flex justify-between"><span>Extreme Loss:</span><span className="font-mono">₹{parseFloat(margin.marginComponents.extremeLossMargin).toFixed(2)}</span></div>
                    )}
                  </div>
                )}

                <div className="flex justify-between pt-2 border-t font-sans font-bold text-slate-900 text-sm">
                  <span>Total Required Margin</span>
                  <span className="font-mono text-brand-700">
                    = {typeof margin.requiredMargin === 'number' && Number.isFinite(margin.requiredMargin)
                      ? `₹${(margin.requiredMargin + (charges.totalCharges || 0)).toFixed(2)}`
                      : 'Unavailable'}
                  </span>
                </div>

                <div className="flex justify-between pt-1 text-slate-600">
                  <span>Available Funds ({currentAccount?.nickname})</span>
                  <span className="font-bold font-mono text-slate-800">
                    ₹{((currentAccount?.available_cash) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </span>
                </div>

                {margin.requiredMargin !== null && ((margin.requiredMargin + (charges.totalCharges || 0)) > ((currentAccount?.available_cash) || 0)) && (
                  <div className="flex justify-between text-rose-600 font-bold">
                    <span>Funds Shortfall to Add</span>
                    <span className="font-mono">
                      ₹{((margin.requiredMargin + (charges.totalCharges || 0)) - ((currentAccount?.available_cash) || 0)).toFixed(2)}
                    </span>
                  </div>
                )}
              </div>

              <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-[10px] text-slate-500 space-y-1">
                <div className="font-semibold text-slate-700">Official SmartAPI Data Transparency:</div>
                <div>Values originate directly from authorized Angel One SmartAPI endpoints: Margin Calculator (<span className="font-mono">/margin/v1/batch</span>) and Brokerage Calculator (<span className="font-mono">/brokerage/v1/estimateCharges</span>).</div>
                <div className="text-[10px] text-slate-600">
                  <span className="font-semibold text-slate-700">Order Type Behavior:</span> For <span className="font-semibold">Limit</span> orders, SmartAPI returns exact 100% margin (₹51,537.50 for 125 shares @ ₹412.30) because limit price is capped. For <span className="font-semibold">Market</span> orders, SmartAPI applies an official 0.5% market volatility buffer (₹51,795.19 for 125 shares), exactly matching the Angel One mobile app's Market view.
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowMarginBreakdownModal(false)}
                className="w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        )}

        {/* Confirmation Modal — Exactly matches buying box dimensions */}
        {showConfirmModal && (
          <div className="absolute inset-0 bg-white z-30 p-5 sm:p-6 rounded-2xl flex flex-col justify-between overflow-y-auto animate-in fade-in duration-100">
            <div>
              <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-3.5">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-brand-600" />
                  <span className="font-bold text-slate-900 text-sm">
                    {tradingScope === 'MULTI' ? 'Review & Confirm Multi-Account Batch' : 'Review & Confirm Order'}
                  </span>
                  <span className="px-2 py-0.5 bg-amber-100 text-amber-800 text-[10px] font-bold rounded">
                    SIMULATED PAPER
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowConfirmModal(false)}
                  className="text-slate-400 hover:text-slate-600"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-3 text-xs">
                {tradingScope === 'MULTI' ? (
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                    <div className="flex justify-between font-bold">
                      <span className="text-slate-600">Selected Accounts:</span>
                      <span className="font-mono text-brand-700">{selectedAccountIds.length} Accounts</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Instrument:</span>
                      <span className="font-mono font-bold text-slate-900">{sym} ({exchange})</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Total Batch Quantity:</span>
                      <span className="font-mono font-bold text-slate-900">
                        {multiAccountBatchItems.reduce((acc, i) => acc + i.quantity, 0)} Shares
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Estimated Total Value:</span>
                      <span className="font-mono font-bold text-slate-900">
                        ₹{multiAccountBatchItems.reduce((acc, i) => acc + i.tradeValue, 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </span>
                    </div>

                    <div className="mt-2 max-h-36 overflow-y-auto border border-slate-200 rounded-lg bg-white">
                      <table className="w-full text-[11px] text-left">
                        <thead className="bg-slate-100 text-slate-500 font-semibold sticky top-0">
                          <tr>
                            <th className="p-1.5">Account</th>
                            <th className="p-1.5 text-right">Qty</th>
                            <th className="p-1.5 text-right">Value</th>
                            <th className="p-1.5 text-right">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 font-mono">
                          {multiAccountBatchItems.map((b) => (
                            <tr key={b.account.id}>
                              <td className="p-1.5 font-sans font-medium text-slate-800">
                                {b.account.nickname} <span className="text-slate-400 font-mono text-[10px]">({b.account.masked_client_code})</span>
                              </td>
                              <td className="p-1.5 text-right font-bold">{b.quantity}</td>
                              <td className="p-1.5 text-right">₹{b.tradeValue.toFixed(2)}</td>
                              <td className="p-1.5 text-right">
                                <span className={`px-1 py-0.2 rounded text-[9px] font-bold ${
                                  b.isEligible ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                                }`}>
                                  {b.isEligible ? 'Ready' : 'Blocked'}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                    <div className="flex justify-between items-center pb-1.5 border-b border-slate-200">
                      <span className="text-slate-500">Account:</span>
                      <div className="text-right">
                        <span className="font-bold text-slate-900">{currentAccount?.nickname}</span>
                        <span className="ml-1 text-slate-400 font-mono">({currentAccount?.masked_client_code})</span>
                        <span className="ml-1 text-[9px] px-1 bg-slate-200 text-slate-700 rounded font-semibold">
                          {currentAccount?.is_demo ? 'Demo' : 'Angel One'}
                        </span>
                      </div>
                    </div>

                    <div className="flex justify-between items-center">
                      <span className="text-slate-500">Order Action:</span>
                      <span className={`px-2 py-0.5 rounded font-bold text-xs ${
                        side === 'BUY' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                      }`}>
                        {side === 'BUY' ? 'BUY (Long)' : 'SELL (Exit)'}
                      </span>
                    </div>

                    <div className="flex justify-between">
                      <span className="text-slate-500">Instrument:</span>
                      <span className="font-mono font-bold text-slate-900">
                        {sym} ({exchange}) {token ? `• Token: ${token}` : ''}
                      </span>
                    </div>

                    <div className="flex justify-between">
                      <span className="text-slate-500">Quantity & Product:</span>
                      <span className="font-mono font-bold text-slate-900">
                        {quantity} Shares • {productType} ({productType === 'DELIVERY' ? 'CNC' : 'MIS'})
                      </span>
                    </div>

                    <div className="flex justify-between">
                      <span className="text-slate-500">Execution Price:</span>
                      <span className="font-mono font-bold text-slate-900">
                        {orderType === 'MARKET' ? `Market Execution (Ref: ₹${quote.ltp?.toFixed(2) || '—'})` : `Limit @ ₹${effectivePrice.toFixed(2)}`}
                      </span>
                    </div>

                    <div className="flex justify-between">
                      <span className="text-slate-500">Order Type:</span>
                      <span className="font-semibold text-slate-800">{orderType}</span>
                    </div>

                    <div className="flex justify-between pt-1 border-t border-slate-200">
                      <span className="text-slate-600">Margin for Order:</span>
                      <span className="font-mono font-bold text-slate-900">
                        {margin.requiredMargin !== null ? `₹${margin.requiredMargin.toFixed(2)}` : 'Unavailable'}
                        <span className="ml-1 text-[9px] px-1 bg-emerald-50 text-emerald-700 font-sans font-semibold rounded">
                          BROKER ESTIMATE
                        </span>
                      </span>
                    </div>

                    <div className="flex justify-between">
                      <span className="text-slate-600">Estimated Charges:</span>
                      <span className="font-mono font-bold text-slate-900">
                        {charges.totalCharges !== null ? `+ ₹${charges.totalCharges.toFixed(2)}` : 'Unavailable'}
                        <span className="ml-1 text-[9px] px-1 bg-slate-100 text-slate-600 font-sans font-semibold rounded">
                          BROKER ESTIMATE
                        </span>
                      </span>
                    </div>

                    <div className="flex justify-between pt-1 border-t border-slate-200 font-bold text-slate-900">
                      <span>Total Required Margin:</span>
                      <span className="font-mono text-brand-700">
                        {margin.requiredMargin !== null && charges.totalCharges !== null
                          ? `₹${(margin.requiredMargin + charges.totalCharges).toFixed(2)}`
                          : (margin.requiredMargin !== null ? `₹${margin.requiredMargin.toFixed(2)}` : 'Unavailable')}
                      </span>
                    </div>

                    <div className="flex justify-between pt-0.5 text-slate-500 text-[11px]">
                      <span>Available Funds:</span>
                      <span className="font-mono font-bold text-slate-700">
                        ₹{((currentAccount?.available_cash) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        <span className="ml-1 text-[9px] font-normal text-slate-400">SMARTAPI RMS</span>
                      </span>
                    </div>
                  </div>
                )}

                {/* PROMINENT MODE EXPLANATION NOTICE */}
                <div className="p-3 bg-amber-50 border border-amber-300 rounded-xl text-xs text-amber-950 space-y-1">
                  <div className="flex items-center gap-1.5 font-bold text-amber-900">
                    <Info className="w-4 h-4 text-amber-600 flex-shrink-0" />
                    <span>SIMULATED PAPER TRADING MODE ACTIVE</span>
                  </div>
                  <p className="text-[11px] leading-relaxed text-amber-800">
                    This order will execute inside the IPOPro Simulator for safety.
                    <span className="font-bold text-amber-950"> No real money is debited, and this order will NOT appear in your Angel One mobile app.</span>
                  </p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 pt-3.5 border-t border-slate-100 mt-2">
              <button
                type="button"
                onClick={() => setShowConfirmModal(false)}
                className="flex-1 py-2.5 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
              >
                ← Back to Edit
              </button>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={tradingScope === 'MULTI' ? handleMultiBatchSubmit : handleSingleSubmit}
                className={`flex-1 py-2.5 text-xs font-bold text-white rounded-xl shadow-md transition-all ${
                  side === 'BUY'
                    ? 'bg-emerald-600 hover:bg-emerald-700'
                    : 'bg-rose-600 hover:bg-rose-700'
                }`}
              >
                {isSubmitting
                  ? 'Submitting...'
                  : (tradingScope === 'MULTI' ? `Confirm Paper Batch (${selectedAccountIds.length})` : `Confirm & Place ${side} (Paper)`)}
              </button>
            </div>
          </div>
        )}

        {/* Multi-Account Batch Results Modal */}
        {showBatchResultsModal && (
          <div className="absolute inset-0 bg-white/95 backdrop-blur-xs p-6 flex flex-col justify-between z-40 animate-in fade-in duration-100">
            <div>
              <div className="flex items-center justify-between border-b pb-3 mb-4">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-emerald-600" />
                  <span className="font-bold text-slate-900 text-sm">Paper Batch Execution Results</span>
                </div>
                <button
                  onClick={() => {
                    setShowBatchResultsModal(false);
                    onOrderSuccess(`Paper batch executed: ${batchSummary?.success || 0} filled.`);
                    onClose();
                  }}
                  className="text-slate-400 hover:text-slate-600"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {batchSummary && (
                <div className="grid grid-cols-3 gap-3 mb-4 text-center">
                  <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                    <span className="text-[10px] text-slate-500 uppercase font-bold">Total Accounts</span>
                    <p className="text-base font-bold font-mono text-slate-800">{batchSummary.total}</p>
                  </div>
                  <div className="bg-emerald-50 p-2.5 rounded-xl border border-emerald-200">
                    <span className="text-[10px] text-emerald-600 uppercase font-bold">Successful Fills</span>
                    <p className="text-base font-bold font-mono text-emerald-700">{batchSummary.success}</p>
                  </div>
                  <div className="bg-rose-50 p-2.5 rounded-xl border border-rose-200">
                    <span className="text-[10px] text-rose-600 uppercase font-bold">Rejected / Blocked</span>
                    <p className="text-base font-bold font-mono text-rose-700">{batchSummary.failed}</p>
                  </div>
                </div>
              )}

              <div className="max-h-60 overflow-y-auto border border-slate-200 rounded-xl bg-white">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-100 text-[10px] text-slate-500 uppercase font-semibold sticky top-0">
                    <tr>
                      <th className="p-2">Account</th>
                      <th className="p-2">Order Ref</th>
                      <th className="p-2 text-right">Status</th>
                      <th className="p-2">Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-mono">
                    {batchResults.map((r, i) => (
                      <tr key={i}>
                        <td className="p-2 font-sans font-semibold text-slate-900">{r.nickname}</td>
                        <td className="p-2 text-slate-500">{r.broker_order_id || r.client_order_id?.slice(0, 8)}</td>
                        <td className="p-2 text-right font-bold">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                            r.status === 'EXECUTED' || r.status === 'ACCEPTED'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-rose-100 text-rose-800'
                          }`}>
                            {r.status === 'EXECUTED' ? 'PAPER_FILLED' : r.status}
                          </span>
                        </td>
                        <td className="p-2 font-sans text-slate-500 text-[11px]">{r.rejection_reason || 'Simulated Fill'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100">
              <button
                type="button"
                onClick={() => {
                  setShowBatchResultsModal(false);
                  onOrderSuccess(`Paper batch executed: ${batchSummary?.success || 0} filled.`);
                  onClose();
                }}
                className="w-full py-2.5 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-xl transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};
