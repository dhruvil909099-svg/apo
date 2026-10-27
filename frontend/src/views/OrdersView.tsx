import React, { useState } from 'react';
import {
  ClipboardList, Search, Filter, RefreshCw,
  XCircle, CheckCircle2, Clock, AlertTriangle, Plus
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

  // Single Order Modal
  const [isSingleOrderOpen, setIsSingleOrderOpen] = useState(false);
  const [singleOrderForm, setSingleOrderForm] = useState({
    account_id: accounts[0]?.id || 1,
    tradingsymbol: 'TATATECH-EQ',
    symbol_token: '19326',
    exchange: 'NSE',
    transaction_type: 'SELL',
    order_type: 'LIMIT',
    variety: 'NORMAL',
    quantity: 10,
    price: 1050.0,
    trigger_price: 0.0,
  });

  const statuses = ['ALL', 'EXECUTED', 'ACCEPTED', 'REJECTED', 'CANCELLED'];

  const filteredOrders = orders.filter((o) => {
    const matchesStatus = selectedStatus === 'ALL' || o.status === selectedStatus;
    const matchesSymbol = !searchSymbol || o.tradingsymbol.toLowerCase().includes(searchSymbol.toLowerCase());
    const matchesAccount = selectedAccountId === 'ALL' || o.account_id.toString() === selectedAccountId;
    return matchesStatus && matchesSymbol && matchesAccount;
  });

  const handleCancelOrder = async (orderId: number) => {
    if (confirm('Cancel this open order?')) {
      setCancellingId(orderId);
      try {
        await api.cancelOrder(orderId);
        onRefresh();
      } catch (err: any) {
        alert(`Failed to cancel: ${err.message}`);
      } finally {
        setCancellingId(null);
      }
    }
  };

  const handlePlaceSingleOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.placeSingleOrder(singleOrderForm);
      setIsSingleOrderOpen(false);
      onRefresh();
    } catch (err: any) {
      alert(`Order submission error: ${err.message}`);
    }
  };

  return (
    <div className="space-y-6">
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
                {a.nickname}
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
          onClick={() => setIsSingleOrderOpen(true)}
          className="px-3.5 py-1.5 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-xs font-semibold shadow-sm transition-colors flex items-center gap-1.5"
        >
          <Plus className="w-4 h-4" />
          <span>Single Order Ticket</span>
        </button>
      </div>

      {/* Orders Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {filteredOrders.length === 0 ? (
          <div className="text-center py-12 text-xs text-slate-400">
            No orders match the selected filters.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider font-semibold border-b border-slate-200 text-[10px]">
                <tr>
                  <th className="py-3 px-4">Client / Broker Order ID</th>
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
                      <div>{o.broker_order_id || '—'}</div>
                      <div className="text-[10px] text-slate-400">{o.client_order_id.slice(0, 8)}...</div>
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
                        o.transaction_type === 'SELL' ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'
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

      {/* Single Order Modal */}
      {isSingleOrderOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-900">Place Single Order Ticket</h3>
              <button onClick={() => setIsSingleOrderOpen(false)} className="text-slate-400 hover:text-slate-600 text-lg">&times;</button>
            </div>

            <form onSubmit={handlePlaceSingleOrder} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-700 font-medium mb-1">Account</label>
                <select
                  value={singleOrderForm.account_id}
                  onChange={(e) => setSingleOrderForm({ ...singleOrderForm, account_id: Number(e.target.value) })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg outline-none bg-white"
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.nickname} ({a.masked_client_code})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-medium mb-1">Symbol</label>
                  <input
                    type="text"
                    required
                    value={singleOrderForm.tradingsymbol}
                    onChange={(e) => setSingleOrderForm({ ...singleOrderForm, tradingsymbol: e.target.value.toUpperCase() })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg outline-none font-mono uppercase"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-medium mb-1">Side</label>
                  <select
                    value={singleOrderForm.transaction_type}
                    onChange={(e) => setSingleOrderForm({ ...singleOrderForm, transaction_type: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg outline-none bg-white font-bold"
                  >
                    <option value="SELL">SELL (Delivery)</option>
                    <option value="BUY">BUY</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-medium mb-1">Order Type</label>
                  <select
                    value={singleOrderForm.order_type}
                    onChange={(e) => setSingleOrderForm({ ...singleOrderForm, order_type: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg outline-none bg-white"
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
                    onChange={(e) => setSingleOrderForm({ ...singleOrderForm, quantity: Number(e.target.value) })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg outline-none num-mono font-bold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-medium mb-1">Price (₹)</label>
                  <input
                    type="number"
                    step="0.05"
                    disabled={singleOrderForm.order_type === 'MARKET'}
                    value={singleOrderForm.price}
                    onChange={(e) => setSingleOrderForm({ ...singleOrderForm, price: Number(e.target.value) })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg outline-none num-mono font-bold"
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
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg outline-none num-mono"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsSingleOrderOpen(false)}
                  className="px-3 py-1.5 border border-slate-300 rounded text-xs text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-brand-600 hover:bg-brand-700 text-white rounded text-xs font-semibold"
                >
                  Submit Order
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
