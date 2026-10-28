import React, { useState, useEffect, useMemo } from 'react';
import {
  X, AlertTriangle, ShieldCheck, CheckCircle2,
  TrendingUp, TrendingDown, ArrowRight, ShieldAlert,
  Info, RefreshCw, Wallet, Clock
} from 'lucide-react';
import { Account, OrderPreviewResponse, Order } from '../types';
import { api } from '../api';

interface TradeModalProps {
  isOpen: boolean;
  onClose: () => void;
  symbol: string;
  companyName?: string;
  exchange?: string;
  initialPrice?: number;
  initialType?: 'BUY' | 'SELL';
  accounts: Account[];
  onSuccess?: (order: Order) => void;
}

export const TradeModal: React.FC<TradeModalProps> = ({
  isOpen,
  onClose,
  symbol,
  companyName,
  exchange = 'NSE',
  initialPrice = 100.0,
  initialType = 'BUY',
  accounts,
  onSuccess
}) => {
  const [transactionType, setTransactionType] = useState<'BUY' | 'SELL'>(initialType);
  const [selectedAccountId, setSelectedAccountId] = useState<number>(() => {
    const enabled = accounts.filter(a => a.is_enabled);
    return enabled.length > 0 ? enabled[0].id : 0;
  });
  const [orderType, setOrderType] = useState<'LIMIT' | 'MARKET' | 'STOPLOSS_LIMIT'>('LIMIT');
  const [quantity, setQuantity] = useState<number>(1);
  const [price, setPrice] = useState<number>(initialPrice);
  const [triggerPrice, setTriggerPrice] = useState<number>(Math.round(initialPrice * 0.95 * 100) / 100);

  const [step, setStep] = useState<'configure' | 'confirm' | 'result'>('configure');
  const [preview, setPreview] = useState<OrderPreviewResponse | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [executedOrder, setExecutedOrder] = useState<Order | null>(null);
  const [submissionError, setSubmissionError] = useState<string | null>(null);

  // Sync state when props change
  useEffect(() => {
    if (isOpen) {
      setTransactionType(initialType);
      setPrice(initialPrice > 0 ? initialPrice : 100.0);
      setTriggerPrice(Math.round(initialPrice * 0.95 * 100) / 100);
      setQuantity(1);
      setStep('configure');
      setExecutedOrder(null);
      setSubmissionError(null);
      const enabled = accounts.filter(a => a.is_enabled);
      if (enabled.length > 0 && (!selectedAccountId || !accounts.find(a => a.id === selectedAccountId))) {
        setSelectedAccountId(enabled[0].id);
      }
    }
  }, [isOpen, initialType, initialPrice, accounts]);

  const selectedAccount = useMemo(() => {
    return accounts.find(a => a.id === selectedAccountId);
  }, [accounts, selectedAccountId]);

  // Fetch pre-trade preview & regulatory charges calculation
  const fetchPreview = async () => {
    if (!selectedAccountId || quantity <= 0) return;
    setIsPreviewLoading(true);
    try {
      const resp = await api.previewSingleOrder({
        account_id: selectedAccountId,
        tradingsymbol: symbol,
        transaction_type: transactionType,
        order_type: orderType,
        quantity,
        price: orderType === 'MARKET' ? initialPrice : price,
        trigger_price: orderType === 'STOPLOSS_LIMIT' ? triggerPrice : 0
      });
      setPreview(resp);
    } catch (err: any) {
      console.warn('Pre-trade calculation error:', err);
    } finally {
      setIsPreviewLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && selectedAccountId) {
      const timer = setTimeout(fetchPreview, 250);
      return () => clearTimeout(timer);
    }
  }, [isOpen, selectedAccountId, transactionType, orderType, quantity, price, triggerPrice]);

  const handleReviewOrder = () => {
    if (preview && !preview.is_valid) return;
    setStep('confirm');
  };

  const handleConfirmOrder = async () => {
    if (!selectedAccount) return;
    setIsSubmitting(true);
    setSubmissionError(null);
    try {
      const orderPayload = {
        account_id: selectedAccountId,
        tradingsymbol: symbol,
        exchange: exchange,
        transaction_type: transactionType,
        order_type: orderType,
        product_type: 'DELIVERY',
        variety: orderType === 'STOPLOSS_LIMIT' ? 'STOPLOSS' : 'NORMAL',
        quantity: quantity,
        price: orderType === 'MARKET' ? 0.0 : price,
        trigger_price: orderType === 'STOPLOSS_LIMIT' ? triggerPrice : 0.0
      };

      const result = await api.placeSingleOrder(orderPayload);
      setExecutedOrder(result);
      setStep('result');
      if (onSuccess) {
        onSuccess(result);
      }
    } catch (err: any) {
      setSubmissionError(err.message || 'Order execution failed.');
      setStep('result');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold text-white shadow-xs ${
              transactionType === 'BUY' ? 'bg-emerald-600' : 'bg-rose-600'
            }`}>
              {transactionType === 'BUY' ? 'B' : 'S'}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-slate-900 tracking-tight">{symbol}</h3>
                <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-sm bg-slate-200 text-slate-700">
                  {exchange}
                </span>
                <span className="text-xs font-semibold text-slate-700">₹{initialPrice.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              </div>
              <p className="text-xs text-slate-500 line-clamp-1">{companyName || `${symbol} Ltd`}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          {step === 'configure' && (
            <>
              {/* Buy / Sell Tabs */}
              <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-xl">
                <button
                  type="button"
                  onClick={() => setTransactionType('BUY')}
                  className={`py-2 text-xs font-bold rounded-lg transition-all ${
                    transactionType === 'BUY'
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  BUY / LONG
                </button>
                <button
                  type="button"
                  onClick={() => setTransactionType('SELL')}
                  className={`py-2 text-xs font-bold rounded-lg transition-all ${
                    transactionType === 'SELL'
                      ? 'bg-rose-600 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  SELL / SHORT
                </button>
              </div>

              {/* Account Selection */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Trading Demat Account
                </label>
                <select
                  value={selectedAccountId}
                  onChange={(e) => setSelectedAccountId(Number(e.target.value))}
                  className="w-full text-xs rounded-xl border border-slate-300 bg-white px-3 py-2.5 font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  {accounts.map(acc => (
                    <option key={acc.id} value={acc.id} disabled={!acc.is_enabled}>
                      {acc.nickname} ({acc.masked_client_code}) - {acc.account_group}
                      {acc.is_demo ? ' [DEMO]' : ''}
                      {!acc.is_enabled ? ' (Disabled)' : ''}
                    </option>
                  ))}
                </select>
                {selectedAccount && (
                  <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-500">
                    <span className="flex items-center gap-1">
                      <Wallet className="w-3.5 h-3.5 text-slate-400" />
                      Available Cash: <strong>₹{(selectedAccount.available_cash || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong>
                    </span>
                    <span className={`px-1.5 py-0.5 rounded-sm font-semibold text-[10px] ${
                      selectedAccount.ddpi_status === 'ACTIVE'
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        : 'bg-amber-50 text-amber-700 border border-amber-200'
                    }`}>
                      DDPI: {selectedAccount.ddpi_status}
                    </span>
                  </div>
                )}
              </div>

              {/* Order Type Toggle */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Order Type</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['LIMIT', 'MARKET', 'STOPLOSS_LIMIT'] as const).map(ot => (
                    <button
                      key={ot}
                      type="button"
                      onClick={() => setOrderType(ot)}
                      className={`py-2 px-2 text-center text-xs font-semibold rounded-lg border transition-all ${
                        orderType === ot
                          ? 'border-brand-500 bg-brand-50 text-brand-700 font-bold'
                          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {ot === 'STOPLOSS_LIMIT' ? 'STOP-LOSS' : ot}
                    </button>
                  ))}
                </div>
              </div>

              {/* Quantity & Price Grid */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-semibold text-slate-700">Quantity</label>
                    <span className="text-[10px] text-slate-400">Shares</span>
                  </div>
                  <input
                    type="number"
                    min="1"
                    value={quantity}
                    onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-full text-xs rounded-xl border border-slate-300 bg-white px-3 py-2 font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                  {/* Quick Quantity Buttons */}
                  <div className="mt-1.5 grid grid-cols-4 gap-1">
                    {[1, 5, 10, 25].map(q => (
                      <button
                        key={q}
                        type="button"
                        onClick={() => setQuantity(q)}
                        className="text-[10px] py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-md transition-colors"
                      >
                        +{q}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-semibold text-slate-700">Price (₹)</label>
                    {orderType === 'MARKET' && (
                      <span className="text-[10px] text-brand-600 font-medium">Market execution</span>
                    )}
                  </div>
                  <input
                    type="number"
                    step="0.05"
                    disabled={orderType === 'MARKET'}
                    value={orderType === 'MARKET' ? initialPrice : price}
                    onChange={(e) => setPrice(Math.max(0.05, parseFloat(e.target.value) || 0.05))}
                    className={`w-full text-xs rounded-xl border border-slate-300 px-3 py-2 font-semibold focus:outline-none focus:ring-2 focus:ring-brand-500 ${
                      orderType === 'MARKET' ? 'bg-slate-100 text-slate-500 cursor-not-allowed' : 'bg-white text-slate-900'
                    }`}
                  />
                  <div className="mt-1.5 flex items-center justify-between text-[10px] text-slate-400">
                    <span>LTP: ₹{initialPrice.toFixed(2)}</span>
                    <button
                      type="button"
                      onClick={() => setPrice(initialPrice)}
                      className="text-brand-600 hover:underline font-semibold"
                    >
                      Use LTP
                    </button>
                  </div>
                </div>
              </div>

              {/* Trigger Price for Stop Loss */}
              {orderType === 'STOPLOSS_LIMIT' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Trigger Price (₹)
                  </label>
                  <input
                    type="number"
                    step="0.05"
                    value={triggerPrice}
                    onChange={(e) => setTriggerPrice(Math.max(0.05, parseFloat(e.target.value) || 0.05))}
                    className="w-full text-xs rounded-xl border border-slate-300 bg-white px-3 py-2 font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                  <p className="text-[11px] text-slate-400 mt-1">
                    Order activates on the exchange when LTP touches or crosses this trigger.
                  </p>
                </div>
              )}

              {/* Pre-Trade Valuation & Breakdown Card */}
              {preview && (
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-500">Gross Order Value:</span>
                    <span className="font-bold text-slate-800">
                      ₹{preview.estimated_value.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-500 flex items-center gap-1">
                      Statutory Charges (STT, NSE, GST, SEBI):
                    </span>
                    <span className="text-slate-600">
                      ₹{preview.estimated_charges.toFixed(2)}
                    </span>
                  </div>
                  <div className="pt-2 border-t border-slate-200 flex items-center justify-between text-xs font-bold">
                    <span className="text-slate-800">
                      {transactionType === 'BUY' ? 'Net Payable Amount:' : 'Net Receivable Amount:'}
                    </span>
                    <span className={`text-sm font-extrabold ${transactionType === 'BUY' ? 'text-brand-700' : 'text-emerald-700'}`}>
                      ₹{preview.net_total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </span>
                  </div>

                  {/* Blocking reason or warning banners */}
                  {preview.blocking_reasons && preview.blocking_reasons.length > 0 && (
                    <div className="mt-2 p-2.5 rounded-lg bg-rose-50 border border-rose-200 flex items-start gap-2 text-rose-800 text-xs">
                      <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                      <div>
                        {preview.blocking_reasons.map((r, i) => (
                          <div key={i}>{r}</div>
                        ))}
                      </div>
                    </div>
                  )}

                  {preview.warnings && preview.warnings.length > 0 && (
                    <div className="mt-2 p-2.5 rounded-lg bg-amber-50 border border-amber-200 flex items-start gap-2 text-amber-800 text-xs">
                      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                      <div>
                        {preview.warnings.map((w, i) => (
                          <div key={i}>{w}</div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* Confirm Step */}
          {step === 'confirm' && (
            <div className="space-y-4">
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div className="text-xs text-amber-900 leading-relaxed">
                  <p className="font-bold uppercase tracking-wider mb-1">Confirm Order Submission</p>
                  <p>
                    You are placing a <strong>{transactionType}</strong> order for <strong>{quantity} share(s)</strong> of <strong>{symbol}</strong> in account <strong>{selectedAccount?.nickname}</strong>.
                  </p>
                  <p className="mt-1 text-slate-600">
                    Trading Mode: <strong className="text-brand-700">PAPER SIMULATION</strong> (Default safe mode. Zero live broker funds will be risked).
                  </p>
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100 text-xs">
                <div className="p-3 flex justify-between">
                  <span className="text-slate-500">Action:</span>
                  <span className={`font-bold ${transactionType === 'BUY' ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {transactionType}
                  </span>
                </div>
                <div className="p-3 flex justify-between">
                  <span className="text-slate-500">Order Variety:</span>
                  <span className="font-semibold text-slate-800">{orderType}</span>
                </div>
                <div className="p-3 flex justify-between">
                  <span className="text-slate-500">Quantity:</span>
                  <span className="font-bold text-slate-800">{quantity} Shares</span>
                </div>
                <div className="p-3 flex justify-between">
                  <span className="text-slate-500">Execution Limit Price:</span>
                  <span className="font-bold text-slate-800">
                    {orderType === 'MARKET' ? 'Market Price' : `₹${price.toFixed(2)}`}
                  </span>
                </div>
                <div className="p-3 flex justify-between bg-slate-50 font-bold">
                  <span className="text-slate-700">Estimated Total:</span>
                  <span className="text-slate-900">₹{(preview?.net_total || (quantity * price)).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                </div>
              </div>
            </div>
          )}

          {/* Result Step */}
          {step === 'result' && (
            <div className="py-6 text-center space-y-4">
              {executedOrder && executedOrder.status === 'EXECUTED' && (
                <>
                  <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 mx-auto flex items-center justify-center">
                    <CheckCircle2 className="w-7 h-7" />
                  </div>
                  <div>
                    <h4 className="text-base font-bold text-slate-900">Order Executed Successfully!</h4>
                    <p className="text-xs text-slate-500 mt-1">
                      {transactionType} {executedOrder.quantity} {symbol} filled at ₹{executedOrder.execution_price?.toFixed(2) || price.toFixed(2)}
                    </p>
                  </div>
                  <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 text-xs text-slate-600 space-y-1 max-w-sm mx-auto text-left">
                    <div>Broker ID: <strong className="text-slate-800">{executedOrder.broker_order_id}</strong></div>
                    <div>Client Order ID: <span className="font-mono text-[11px] text-slate-500">{executedOrder.client_order_id}</span></div>
                    <div>Account: <strong className="text-slate-800">{selectedAccount?.nickname}</strong></div>
                  </div>
                </>
              )}

              {executedOrder && executedOrder.status === 'ACCEPTED' && (
                <>
                  <div className="w-12 h-12 rounded-full bg-blue-100 text-blue-600 mx-auto flex items-center justify-center">
                    <Clock className="w-7 h-7" />
                  </div>
                  <div>
                    <h4 className="text-base font-bold text-slate-900">Order Placed (Open in Order Book)</h4>
                    <p className="text-xs text-slate-500 mt-1">
                      Limit price ₹{price.toFixed(2)} is pending execution against market LTP ₹{initialPrice.toFixed(2)}.
                    </p>
                  </div>
                </>
              )}

              {((executedOrder && executedOrder.status === 'REJECTED') || submissionError) && (
                <>
                  <div className="w-12 h-12 rounded-full bg-rose-100 text-rose-600 mx-auto flex items-center justify-center">
                    <ShieldAlert className="w-7 h-7" />
                  </div>
                  <div>
                    <h4 className="text-base font-bold text-rose-900">Order Rejected</h4>
                    <p className="text-xs text-rose-700 mt-1 max-w-sm mx-auto">
                      {executedOrder?.rejection_reason || submissionError || 'Order could not be submitted.'}
                    </p>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
          {step === 'configure' && (
            <>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 rounded-lg hover:bg-slate-200/50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleReviewOrder}
                disabled={preview ? !preview.is_valid : false}
                className={`px-5 py-2.5 rounded-xl text-xs font-bold text-white shadow-xs transition-all flex items-center gap-1.5 ${
                  preview && !preview.is_valid
                    ? 'bg-slate-300 cursor-not-allowed text-slate-500'
                    : transactionType === 'BUY'
                    ? 'bg-emerald-600 hover:bg-emerald-700'
                    : 'bg-rose-600 hover:bg-rose-700'
                }`}
              >
                <span>Review {transactionType} Order</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </>
          )}

          {step === 'confirm' && (
            <>
              <button
                type="button"
                onClick={() => setStep('configure')}
                disabled={isSubmitting}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 rounded-lg hover:bg-slate-200/50 transition-colors"
              >
                Back
              </button>
              <button
                type="button"
                onClick={handleConfirmOrder}
                disabled={isSubmitting}
                className={`px-6 py-2.5 rounded-xl text-xs font-bold text-white shadow-md transition-all flex items-center gap-2 ${
                  transactionType === 'BUY'
                    ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/20'
                    : 'bg-rose-600 hover:bg-rose-700 shadow-rose-600/20'
                }`}
              >
                {isSubmitting ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Executing Order...</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck className="w-4 h-4" />
                    <span>Confirm & Transmit Order</span>
                  </>
                )}
              </button>
            </>
          )}

          {step === 'result' && (
            <div className="w-full flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="px-6 py-2.5 bg-brand-600 hover:bg-brand-700 text-white rounded-xl text-xs font-bold shadow-xs transition-colors"
              >
                Done
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
