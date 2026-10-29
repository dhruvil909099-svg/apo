import React, { useState, useEffect } from 'react';
import {
  X, ShieldCheck, AlertCircle, TrendingUp, TrendingDown,
  Info, Check, HelpCircle, ArrowRight
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
  const [price, setPrice] = useState<number>(0);
  const [triggerPrice, setTriggerPrice] = useState<number>(0);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState<boolean>(false);

  useEffect(() => {
    if (holding) {
      const ltp = holding.current_ltp || holding.average_price || 100;
      setPrice(ltp);
      setTriggerPrice(round2(ltp * 0.98));
      if (defaultSide === 'SELL') {
        const avail = holding.available_quantity ?? holding.quantity;
        setQuantity(avail > 0 ? avail : 1);
      } else {
        setQuantity(1);
      }
    }
    setSide(defaultSide);
    setOrderType(defaultOrderType);
    setErrorMsg(null);
    setShowConfirmModal(false);
  }, [holding, defaultSide, defaultOrderType, isOpen]);

  if (!isOpen || !account || !holding) return null;

  const sym = holding.trading_symbol || `${holding.symbol}-EQ`;
  const ltp = holding.current_ltp || holding.average_price || price;
  const effectivePrice = orderType === 'MARKET' ? ltp : price;
  const estimatedValue = round2(quantity * effectivePrice);
  const availableQty = holding.available_quantity ?? holding.quantity;
  const isSellable = (account.ddpi_status === 'ACTIVE' || account.edis_authorized_today);

  function round2(v: number) {
    return Math.round(v * 100) / 100;
  }

  // Pre-submission validation
  const validateOrder = (): string | null => {
    if (quantity <= 0) {
      return 'Quantity must be at least 1 share.';
    }
    if (orderType !== 'MARKET' && price <= 0) {
      return 'Price must be greater than zero for Limit orders.';
    }
    if ((orderType === 'STOPLOSS_LIMIT' || orderType === 'STOPLOSS_MARKET') && triggerPrice <= 0) {
      return 'Trigger price is required for Stop-Loss orders.';
    }
    if (side === 'SELL' && quantity > availableQty) {
      return `Insufficient holdings. You have ${availableQty} shares available to sell.`;
    }
    if (side === 'SELL' && !isSellable && !account.is_demo) {
      return 'eDIS authorization or active DDPI is required to submit sell orders for delivery holdings.';
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
        symbol_token: holding.symbol_token || '0',
        exchange: holding.exchange || 'NSE',
        transaction_type: side,
        order_type: orderType,
        product_type: productType,
        quantity: quantity,
        price: effectivePrice,
        trigger_price: (orderType === 'STOPLOSS_LIMIT' || orderType === 'STOPLOSS_MARKET') ? triggerPrice : 0,
        variety: 'NORMAL',
        is_paper_trade: true // Default safety mode: PAPER trading
      };

      await api.placeSingleOrder(orderPayload);
      onOrderSuccess(`Order submitted successfully: ${side} ${quantity} ${sym} at ₹${effectivePrice.toFixed(2)} [PAPER]`);
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Order execution failed. Please verify account status.');
      setShowConfirmModal(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className={`px-6 py-4 border-b flex items-center justify-between ${
          side === 'BUY' ? 'bg-emerald-50/70 border-emerald-100' : 'bg-rose-50/70 border-rose-100'
        }`}>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-base text-slate-900">{sym}</span>
              <span className="text-[11px] px-2 py-0.5 rounded font-mono font-semibold bg-white border border-slate-200 text-slate-700">
                {holding.exchange || 'NSE'}
              </span>
              <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 text-[10px] font-bold rounded flex items-center gap-1">
                <ShieldCheck className="w-3 h-3 text-emerald-600" />
                <span>PAPER MODE</span>
              </span>
            </div>
            <div className="text-xs text-slate-500 mt-0.5">
              Account: <span className="font-bold text-slate-700">{account.nickname}</span> ({account.masked_client_code})
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-sm font-mono font-bold text-slate-900">₹{ltp.toFixed(2)}</div>
              <div className="text-[10px] text-slate-400">Live LTP</div>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200/50 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Side Selector Tabs */}
        <div className="grid grid-cols-2 p-2 bg-slate-100/60 gap-1 border-b border-slate-200">
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
        <form onSubmit={handleReviewClick} className="p-6 space-y-4">
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
                Product Type
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
                  CNC (Delivery)
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
                  MIS (Intraday)
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
                <option value="LIMIT">Limit Order</option>
                <option value="MARKET">Market Order</option>
                <option value="STOPLOSS_LIMIT">Stop-Loss Limit (SL)</option>
                <option value="STOPLOSS_MARKET">Stop-Loss Market (SL-M)</option>
              </select>
            </div>
          </div>

          {/* Quantity Input with Quick Stepper */}
          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                Quantity (Shares)
              </label>
              {side === 'SELL' && (
                <span className="text-[11px] text-slate-500">
                  Available: <span className="font-mono font-bold text-slate-800">{availableQty}</span>
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="1"
                step="1"
                value={quantity || ''}
                onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 0))}
                className="flex-1 text-sm font-mono font-bold bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-slate-900 focus:outline-hidden focus:border-brand-500"
                placeholder="Shares"
                required
              />
              <div className="flex gap-1">
                {[1, 5, 10, 50, 100].map((step) => (
                  <button
                    key={step}
                    type="button"
                    onClick={() => setQuantity((prev) => prev + step)}
                    className="px-2 py-2 text-[10px] font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors"
                  >
                    +{step}
                  </button>
                ))}
                {side === 'SELL' && availableQty > 0 && (
                  <button
                    type="button"
                    onClick={() => setQuantity(availableQty)}
                    className="px-2.5 py-2 text-[10px] font-bold bg-rose-50 text-rose-700 hover:bg-rose-100 rounded-lg border border-rose-200 transition-colors"
                  >
                    All
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Price & Trigger Price */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                Order Price (₹)
              </label>
              <input
                type="number"
                step="0.05"
                min="0.05"
                value={orderType === 'MARKET' ? '' : (price || '')}
                onChange={(e) => setPrice(parseFloat(e.target.value) || 0)}
                disabled={orderType === 'MARKET'}
                placeholder={orderType === 'MARKET' ? 'Market Executed' : '0.00'}
                className="w-full text-sm font-mono font-bold bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-slate-900 focus:outline-hidden focus:border-brand-500 disabled:bg-slate-100 disabled:text-slate-400"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                Trigger Price (₹)
              </label>
              <input
                type="number"
                step="0.05"
                min="0.05"
                value={(orderType === 'STOPLOSS_LIMIT' || orderType === 'STOPLOSS_MARKET') ? (triggerPrice || '') : ''}
                onChange={(e) => setTriggerPrice(parseFloat(e.target.value) || 0)}
                disabled={orderType !== 'STOPLOSS_LIMIT' && orderType !== 'STOPLOSS_MARKET'}
                placeholder={(orderType === 'STOPLOSS_LIMIT' || orderType === 'STOPLOSS_MARKET') ? 'Trigger ₹' : 'N/A for Limit/Mkt'}
                className="w-full text-sm font-mono font-bold bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-slate-900 focus:outline-hidden focus:border-brand-500 disabled:bg-slate-100 disabled:text-slate-400"
              />
            </div>
          </div>

          {/* Estimated Value & Read-out */}
          <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between text-xs">
            <div>
              <div className="text-slate-400 text-[10px] font-semibold uppercase">Estimated Order Value</div>
              <div className="text-base font-bold font-mono text-slate-900 mt-0.5">
                ₹{estimatedValue.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] text-slate-400">Execution Engine</div>
              <div className="font-mono text-xs font-semibold text-emerald-700 flex items-center justify-end gap-1">
                <Check className="w-3.5 h-3.5 text-emerald-600" />
                <span>Paper Trading</span>
              </div>
            </div>
          </div>

          {/* Submit Button */}
          <div className="pt-2">
            <button
              type="submit"
              className={`w-full py-3 rounded-xl text-xs font-bold text-white shadow-md transition-all flex items-center justify-center gap-2 ${
                side === 'BUY'
                  ? 'bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800'
                  : 'bg-rose-600 hover:bg-rose-700 active:bg-rose-800'
              }`}
            >
              <span>Review {side} Order</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </form>

        {/* Confirmation Modal */}
        {showConfirmModal && (
          <div className="absolute inset-0 bg-white/95 backdrop-blur-xs p-6 flex flex-col justify-between z-30 animate-in fade-in duration-100">
            <div>
              <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-brand-600" />
                  <span className="font-bold text-slate-900 text-sm">Confirm Order Submission</span>
                </div>
                <button
                  onClick={() => setShowConfirmModal(false)}
                  className="text-slate-400 hover:text-slate-600"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-2.5 text-xs">
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1.5">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Transaction Side:</span>
                    <span className={`font-bold ${side === 'BUY' ? 'text-emerald-700' : 'text-rose-700'}`}>{side}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Instrument:</span>
                    <span className="font-mono font-bold text-slate-900">{sym}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Quantity:</span>
                    <span className="font-mono font-bold text-slate-900">{quantity} Shares</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Price:</span>
                    <span className="font-mono font-bold text-slate-900">
                      {orderType === 'MARKET' ? 'Market' : `₹${effectivePrice.toFixed(2)}`}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Order & Product:</span>
                    <span className="font-semibold text-slate-800">{orderType} • {productType}</span>
                  </div>
                  <div className="flex justify-between pt-1 border-t border-slate-200">
                    <span className="text-slate-700 font-bold">Total Estimated Value:</span>
                    <span className="font-mono font-bold text-slate-900">₹{estimatedValue.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                  </div>
                </div>

                <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-xl text-[11px] text-amber-900">
                  <span className="font-bold">Transaction Notice:</span> Orders operate in simulated PAPER trading mode to safeguard capital. No live brokerage order will be executed on the real exchange without manual live authorization and registered static IP configuration.
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
