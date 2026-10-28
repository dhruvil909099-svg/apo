import React, { useState } from 'react';
import {
  ClipboardList, Search, Filter, RefreshCw,
  XCircle, CheckCircle2, Clock, AlertTriangle, Plus,
  Shield, AlertOctagon, TrendingUp, TrendingDown, ArrowRight,
  AlertCircle
} from 'lucide-react';
import { Order, Account } from '../types';
import { api } from '../api';

interface OrdersViewProps {
  orders: Order[];
  accounts: Account[];
  onRefresh: () => void;
}

export const OrdersView: React.FC<OrdersViewProps> = ({ orders, accounts, onRefresh }) => {
  const [selectedStatus, setSelectedStatus] = useState<string>('ALL');
  const [searchSymbol, setSearchSymbol] = useState<string>('');
  const [selectedAccountId, setSelectedAccountId] = useState<string>('ALL');
  const [cancellingId, setCancellingId] = useState<number | null>(null);

  // Single Paper Order Modal
  const [isSingleOrderOpen, setIsSingleOrderOpen] = useState(false);
  const [showConfirmStep, setShowConfirmStep] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);

  const [singleOrderForm, setSingleOrderForm] = useState({
    account_id: accounts[0]?.id || 1,
    tradingsymbol: 'TATATECH-EQ',
    symbol_token: '19326',
    exchange: 'NSE',
    transaction_type: 'BUY',
    order_type: 'LIMIT',
    variety: 'NORMAL',
    quantity: 10,
    price: 1050.0,
    trigger_price: 0.0,
  });

  const statuses = ['ALL', 'EXECUTED', 'ACCEPTED', 'REJECTED', 'CANCELLED'];

  const selectedAccount = accounts.find(a => a.id === singleOrderForm.account_id) || accounts[0];
  const estTotalValue = singleOrderForm.quantity * singleOrderForm.price;
  const isBuy = singleOrderForm.transaction_type === 'BUY';
  const hasSufficientCash = !isBuy || (selectedAccount && selectedAccount.available_cash >= estTotalValue);

  const filteredOrders = orders.filter((o) => {
    const matchesStatus = selectedStatus === 'ALL' || o.status === selectedStatus;
    const matchesSymbol = !searchSymbol || o.tradingsymbol.toLowerCase().includes(searchSymbol.toLowerCase());
    const matchesAccount = selectedAccountId === 'ALL' || o.account_id.toString() === selectedAccountId;
    return matchesStatus && matchesSymbol && matchesAccount;
  });

  const handleCancelOrder = async (orderId: number) => {
    if (!confirm('Cancel this open simulated order?')) return;
    setCancellingId(orderId);
    try {
      await api.cancelOrder(orderId);
      onRefresh();
    } catch (err: any) {
      alert(`Failed to cancel: ${err.message}`);
    } finally {
      setCancellingId(null);
    }
  };

  const handlePlaceSingleOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showConfirmStep) {
      setShowConfirmStep(true);
      return;
    }

    setIsSubmitting(true);
    setOrderError(null);
    try {
      await api.placeSingleOrder(singleOrderForm);
      setIsSingleOrderOpen(false);
      setShowConfirmStep(false);
      onRefresh();
    } catch (err: any) {
      setOrderError(err.message || 'Order submission error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Paper Trading Banner */}
      <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3.5 flex items-center justify-between text-amber-800">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-amber-500/20 flex items-center justify-center text-amber-700">
            <Shield className="w-4 h-4" />
          </div>
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-amber-900">
              Isolated Paper Trading Sandbox
            </h4>
            <p className="text-[11px] text-amber-700">
              All buy & sell tickets are strictly routed to the simulation engine. Zero live capital or real broker orders are executed.
            </p>
          </div>
        </div>
        <div className="text-right">
          <span className="text-[10px] font-mono uppercase bg-amber-200/60 text-amber-900 font-bold px-2 py-0.5 rounded">
            Virtual Environment
          </span>
        </div>
      </div>

      {/* Top Filter Bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          {/* Symbol Search */}
          <div className="relative w-48">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Filter symbol..."
              value={searchSymbol}
              onChange={(e) => setSearchSymbol(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-slate-300 outline-none focus:ring-1 focus:ring-brand-500 uppercase font-mono"
            />
          </div>

          {/* Account Filter */}
          <select
            value={selectedAccountId}
            onChange={(e) => setSelectedAccountId(e.target.value)}
            className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg outline-none bg-white font-medium"
          >
            <option value="ALL">All Accounts</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id.toString()}>
                {a.nickname} ({a.is_demo ? 'Demo' : 'Live'})
              </option>
            ))}
          </select>

          {/* Status Pills */}
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg">
            {statuses.map((s) => (
              <button
                key={s}
                onClick={() => setSelectedStatus(s)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  selectedStatus === s
                    ? 'bg-white text-slate-900 shadow-xs font-bold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* Place Single Order Button */}
        <button
          onClick={() => {
            setShowConfirmStep(false);
            setOrderError(null);
            setIsSingleOrderOpen(true);
          }}
          className="px-3.5 py-1.5 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-xs font-semibold shadow-sm transition-colors flex items-center gap-1.5"
        >
          <Plus className="w-4 h-4" />
          <span>New Paper Order Ticket</span>
        </button>
      </div>

      {/* Orders Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {filteredOrders.length === 0 ? (
          <div className="text-center py-12 text-xs text-slate-400">
            No simulated orders match the selected filters.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider font-semibold border-b border-slate-200 text-[10px]">
                <tr>
                  <th className="py-3 px-4">Simulated Order ID</th>
                  <th className="py-3 px-4">Account</th>
                  <th className="py-3 px-4">Instrument</th>
                  <th className="py-3 px-4">Side</th>
                  <th className="py-3 px-4">Type</th>
                  <th className="py-3 px-4">Qty (Filled / Total)</th>
                  <th className="py-3 px-4">Price</th>
                  <th className="py-3 px-4">Exec. Price</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Notes / Error</th>
                  <th className="py-3 px-4">Time</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredOrders.map((o) => (
                  <tr key={o.id} className="tr-hover">
                    <td className="py-3 px-4 font-mono text-[11px] text-slate-700">
                      <div className="font-semibold text-brand-700">{o.broker_order_id || '—'}</div>
                      <div className="text-[10px] text-slate-400">{o.client_order_id.slice(0, 10)}...</div>
                    </td>
                    <td className="py-3 px-4 font-semibold text-slate-900">
                      <div>{o.account_nickname || o.account_masked_code}</div>
                      <div className="text-[10px] text-slate-400 font-mono">{o.account_masked_code}</div>
                    </td>
                    <td className="py-3 px-4 font-bold text-slate-900">
                      <div className="flex items-center gap-1.5">
                        <span>{o.tradingsymbol}</span>
                        <span className="text-[9px] bg-slate-100 text-slate-600 px-1 py-0.2 rounded">
                          {o.exchange}
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        o.transaction_type === 'SELL' ? 'bg-red-50 text-red-600 border border-red-200' : 'bg-emerald-50 text-emerald-600 border border-emerald-200'
                      }`}>
                        {o.transaction_type}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-medium text-slate-700">{o.order_type}</td>
                    <td className="py-3 px-4 num-mono font-bold text-slate-900">
                      {o.filled_quantity} / {o.quantity}
                    </td>
                    <td className="py-3 px-4 num-mono text-slate-700">₹{o.price.toFixed(2)}</td>
                    <td className="py-3 px-4 num-mono font-bold text-slate-900">
                      {o.execution_price ? `₹${o.execution_price.toFixed(2)}` : '—'}
                    </td>
                    <td className="py-3 px-4">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        o.status === 'EXECUTED'
                          ? 'bg-finGreen-bg text-finGreen-text border border-finGreen-border'
                          : o.status === 'REJECTED'
                          ? 'bg-finRed-bg text-finRed-text border border-finRed-border'
                          : o.status === 'CANCELLED'
                          ? 'bg-slate-100 text-slate-500'
                          : 'bg-blue-50 text-brand-700 border border-blue-200'
                      }`}>
                        {o.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-slate-500 text-[11px] max-w-xs truncate">
                      {o.rejection_reason || '—'}
                    </td>
                    <td className="py-3 px-4 font-mono text-[10px] text-slate-400">
                      {new Date(o.created_at).toLocaleTimeString('en-IN', { hour12: false })}
                    </td>
                    <td className="py-3 px-4 text-right">
                      {o.status === 'ACCEPTED' && (
                        <button
                          onClick={() => handleCancelOrder(o.id)}
                          disabled={cancellingId === o.id}
                          className="px-2.5 py-1 bg-red-50 hover:bg-red-100 text-red-700 rounded text-[11px] font-medium transition-colors"
                        >
                          Cancel
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Single Paper Order Modal */}
      {isSingleOrderOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                  <span>Paper Trading Ticket</span>
                  <span className="text-[10px] bg-amber-100 text-amber-800 font-semibold px-1.5 py-0.2 rounded border border-amber-200">SIMULATION</span>
                </h3>
                <p className="text-[11px] text-slate-500">Virtual limit & market order execution simulator</p>
              </div>
              <button
                onClick={() => {
                  setIsSingleOrderOpen(false);
                  setShowConfirmStep(false);
                }}
                className="text-slate-400 hover:text-slate-600 text-lg"
              >
                &times;
              </button>
            </div>

            {orderError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{orderError}</span>
              </div>
            )}

            {!showConfirmStep ? (
              <form onSubmit={handlePlaceSingleOrder} className="space-y-3.5 text-xs">
                {/* Side Selection Tabs */}
                <div>
                  <label className="block text-slate-700 font-medium mb-1">Order Side</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setSingleOrderForm({ ...singleOrderForm, transaction_type: 'BUY' })}
                      className={`py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 border transition-all ${
                        isBuy
                          ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                          : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      <TrendingUp className="w-3.5 h-3.5" />
                      <span>BUY (Simulated)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setSingleOrderForm({ ...singleOrderForm, transaction_type: 'SELL' })}
                      className={`py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 border transition-all ${
                        !isBuy
                          ? 'bg-red-600 text-white border-red-600 shadow-sm'
                          : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      <TrendingDown className="w-3.5 h-3.5" />
                      <span>SELL (Delivery)</span>
                    </button>
                  </div>
                </div>

                {/* Account Selection */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-slate-700 font-medium">Account</label>
                    {selectedAccount && (
                      <span className="text-[11px] text-slate-500 font-mono">
                        Available Cash: ₹{selectedAccount.available_cash.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </span>
                    )}
                  </div>
                  <select
                    value={singleOrderForm.account_id}
                    onChange={(e) => setSingleOrderForm({ ...singleOrderForm, account_id: Number(e.target.value) })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg outline-none bg-white font-medium"
                  >
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.nickname} ({a.masked_client_code}) — {a.is_demo ? 'Demo Pool' : 'Live Account'}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Symbol & Exchange */}
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2">
                    <label className="block text-slate-700 font-medium mb-1">Tradingsymbol</label>
                    <input
                      type="text"
                      required
                      value={singleOrderForm.tradingsymbol}
                      onChange={(e) => setSingleOrderForm({ ...singleOrderForm, tradingsymbol: e.target.value.toUpperCase() })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg outline-none font-mono uppercase font-bold"
                      placeholder="e.g. TATATECH"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-700 font-medium mb-1">Exchange</label>
                    <select
                      value={singleOrderForm.exchange}
                      onChange={(e) => setSingleOrderForm({ ...singleOrderForm, exchange: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg outline-none bg-white font-bold"
                    >
                      <option value="NSE">NSE</option>
                      <option value="BSE">BSE</option>
                    </select>
                  </div>
                </div>

                {/* Order Type & Quantity */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-slate-700 font-medium mb-1">Order Type</label>
                    <select
                      value={singleOrderForm.order_type}
                      onChange={(e) => setSingleOrderForm({ ...singleOrderForm, order_type: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg outline-none bg-white font-medium"
                    >
                      <option value="LIMIT">LIMIT</option>
                      <option value="MARKET">MARKET</option>
                      <option value="STOPLOSS_LIMIT">STOPLOSS_LIMIT</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-slate-700 font-medium mb-1">Quantity</label>
                    <input
                      type="number"
                      min="1"
                      required
                      value={singleOrderForm.quantity}
                      onChange={(e) => setSingleOrderForm({ ...singleOrderForm, quantity: Math.max(1, Number(e.target.value)) })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg outline-none num-mono font-bold"
                    />
                  </div>
                </div>

                {/* Price & Trigger */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-slate-700 font-medium mb-1">Limit Price (₹)</label>
                    <input
                      type="number"
                      step="0.05"
                      min="0.05"
                      disabled={singleOrderForm.order_type === 'MARKET'}
                      value={singleOrderForm.price}
                      onChange={(e) => setSingleOrderForm({ ...singleOrderForm, price: Number(e.target.value) })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg outline-none num-mono font-bold disabled:bg-slate-100"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-700 font-medium mb-1">Trigger Price (₹)</label>
                    <input
                      type="number"
                      step="0.05"
                      disabled={!singleOrderForm.order_type.includes('STOPLOSS')}
                      value={singleOrderForm.trigger_price}
                      onChange={(e) => setSingleOrderForm({ ...singleOrderForm, trigger_price: Number(e.target.value) })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg outline-none num-mono disabled:bg-slate-100"
                    />
                  </div>
                </div>

                {/* Margin / Cost Preview */}
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-600">Estimated {isBuy ? 'Required Margin' : 'Gross Proceeds'}:</span>
                    <span className="font-mono font-bold text-slate-900">₹{estTotalValue.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                  </div>
                  {!hasSufficientCash && (
                    <div className="text-[11px] text-red-600 font-semibold flex items-center gap-1 pt-1">
                      <AlertOctagon className="w-3.5 h-3.5" />
                      <span>Warning: Simulated available cash is lower than estimated order value.</span>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setIsSingleOrderOpen(false)}
                    className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs text-slate-700 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className={`px-4 py-1.5 text-white rounded-lg text-xs font-semibold shadow-sm transition-colors ${
                      isBuy ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700'
                    }`}
                  >
                    Review Order
                  </button>
                </div>
              </form>
            ) : (
              /* Confirmation Dialog */
              <div className="space-y-4 text-xs">
                <div className="p-3.5 bg-amber-50 border border-amber-300 rounded-xl space-y-2 text-amber-900">
                  <div className="flex items-center gap-2 font-bold text-xs">
                    <Shield className="w-4 h-4 text-amber-600" />
                    <span>CONFIRM SIMULATED PAPER ORDER</span>
                  </div>
                  <p className="text-[11px] text-amber-800">
                    This order will be submitted to the local paper simulation engine. No real broker orders or live funds are involved.
                  </p>
                </div>

                <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 text-xs">
                  <div className="flex justify-between p-2.5">
                    <span className="text-slate-500">Account:</span>
                    <span className="font-semibold text-slate-900">{selectedAccount?.nickname} ({selectedAccount?.masked_client_code})</span>
                  </div>
                  <div className="flex justify-between p-2.5">
                    <span className="text-slate-500">Side:</span>
                    <span className={`font-bold ${isBuy ? 'text-emerald-600' : 'text-red-600'}`}>{singleOrderForm.transaction_type}</span>
                  </div>
                  <div className="flex justify-between p-2.5">
                    <span className="text-slate-500">Instrument:</span>
                    <span className="font-mono font-bold text-slate-900">{singleOrderForm.tradingsymbol} ({singleOrderForm.exchange})</span>
                  </div>
                  <div className="flex justify-between p-2.5">
                    <span className="text-slate-500">Quantity:</span>
                    <span className="font-mono font-bold text-slate-900">{singleOrderForm.quantity} shares</span>
                  </div>
                  <div className="flex justify-between p-2.5">
                    <span className="text-slate-500">Order Type:</span>
                    <span className="font-medium text-slate-900">{singleOrderForm.order_type} @ ₹{singleOrderForm.price.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between p-2.5 bg-slate-50">
                    <span className="text-slate-700 font-bold">Total Estimated Value:</span>
                    <span className="font-mono font-bold text-slate-900">₹{estTotalValue.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => setShowConfirmStep(false)}
                    className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs text-slate-700 hover:bg-slate-50"
                  >
                    Back to Edit
                  </button>
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={handlePlaceSingleOrder}
                    className={`px-4 py-1.5 text-white rounded-lg text-xs font-semibold shadow-sm transition-all flex items-center gap-1.5 ${
                      isBuy ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700'
                    }`}
                  >
                    {isSubmitting ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Simulating...</span>
                      </>
                    ) : (
                      <>
                        <span>Confirm Paper Order</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
