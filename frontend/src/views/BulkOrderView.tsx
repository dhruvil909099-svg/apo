import React, { useState, useEffect } from 'react';
import {
  Layers, AlertTriangle, CheckCircle2, ShieldCheck,
  Send, Calculator, Sliders, ArrowRight, XCircle, Info
} from 'lucide-react';
import { IPO, ConsolidatedHolding, BulkOrderPreview, Account } from '../types';
import { api } from '../api';

interface BulkOrderViewProps {
  ipos: IPO[];
  accounts: Account[];
  onOrderPlaced: () => void;
}

interface AccountSelectionState {
  account_id: number;
  nickname: string;
  masked_client_code: string;
  account_group: string;
  holding_qty: number;
  selected: boolean;
  quantity: number;
  price_override: number;
  ddpi_status: string;
}

export const BulkOrderView: React.FC<BulkOrderViewProps> = ({ ipos, accounts, onOrderPlaced }) => {
  const [selectedIpoId, setSelectedIpoId] = useState<number>(ipos[0]?.id || 1);
  const [orderType, setOrderType] = useState<string>('LIMIT');
  const [globalPrice, setGlobalPrice] = useState<number>(1050.0);
  const [accountStates, setAccountStates] = useState<AccountSelectionState[]>([]);
  const [preview, setPreview] = useState<BulkOrderPreview | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
  const [executionResult, setExecutionResult] = useState<any>(null);

  // Load holdings for the selected IPO
  useEffect(() => {
    if (!selectedIpoId) return;
    const ipo = ipos.find((x) => x.id === selectedIpoId);
    if (ipo) {
      setGlobalPrice(ipo.current_ltp || ipo.issue_price);
    }

    const loadAllotments = async () => {
      try {
        const allotments = await api.getIPOAllotments(selectedIpoId);
        const mapped = allotments
          .filter((a) => a.allotted_quantity > 0)
          .map((a) => ({
            account_id: a.account_id,
            nickname: a.account_nickname,
            masked_client_code: a.account_masked_code,
            account_group: a.account_group,
            holding_qty: a.allotted_quantity,
            selected: true,
            quantity: a.allotted_quantity,
            price_override: ipo?.current_ltp || ipo?.issue_price || 0,
            ddpi_status: a.ddpi_status
          }));
        setAccountStates(mapped);
        setPreview(null);
        setExecutionResult(null);
      } catch (err: any) {
        console.error('Failed to load allotments for bulk order:', err);
      }
    };

    loadAllotments();
  }, [selectedIpoId, ipos]);

  const selectedIPO = ipos.find((x) => x.id === selectedIpoId);

  // Bulk actions on accounts
  const toggleSelectAll = (checked: boolean) => {
    setAccountStates((prev) => prev.map((a) => ({ ...a, selected: checked })));
  };

  const setPercentQuantity = (pct: number) => {
    setAccountStates((prev) =>
      prev.map((a) => ({
        ...a,
        quantity: Math.max(1, Math.floor((a.holding_qty * pct) / 100))
      }))
    );
  };

  const applyGlobalPriceToAll = () => {
    setAccountStates((prev) =>
      prev.map((a) => ({
        ...a,
        price_override: globalPrice
      }))
    );
  };

  const handleValidatePreview = async () => {
    if (!selectedIPO) return;
    const targets = accountStates
      .filter((a) => a.selected && a.quantity > 0)
      .map((a) => ({
        account_id: a.account_id,
        quantity: a.quantity,
        price_override: a.price_override
      }));

    if (targets.length === 0) {
      alert('Please select at least one account with quantity > 0.');
      return;
    }

    setIsValidating(true);
    setPreview(null);
    setExecutionResult(null);

    try {
      const payload = {
        ipo_id: selectedIPO.id,
        tradingsymbol: `${selectedIPO.symbol}-EQ`,
        symbol_token: selectedIPO.symbol_token || '19326',
        exchange: selectedIPO.exchange,
        order_type: orderType,
        price: globalPrice,
        trigger_price: 0.0,
        accounts: targets
      };

      const res = await api.prepareBulkOrders(payload);
      setPreview(res);
    } catch (err: any) {
      alert(`Validation error: ${err.message}`);
    } finally {
      setIsValidating(false);
    }
  };

  const handleExecuteOrders = async () => {
    if (!preview) return;
    setIsExecuting(true);
    try {
      const res = await api.executeBulkOrders(preview.batch_id, true);
      setExecutionResult(res);
      setIsConfirmModalOpen(false);
      onOrderPlaced();
    } catch (err: any) {
      alert(`Execution error: ${err.message}`);
    } finally {
      setIsExecuting(false);
    }
  };

  const totalSelectedQty = accountStates
    .filter((a) => a.selected)
    .reduce((sum, a) => sum + a.quantity, 0);

  const totalEstimatedProceeds = accountStates
    .filter((a) => a.selected)
    .reduce((sum, a) => sum + (a.quantity * (a.price_override || globalPrice)), 0);

  return (
    <div className="space-y-6">
      {/* Top Banner: Critical Safeguards Notice */}
      <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl text-xs text-slate-300 flex items-start gap-3 shadow-md">
        <ShieldCheck className="w-5 h-5 text-brand-500 flex-shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="font-bold text-sm text-white">Multi-Account Coordinated Bulk Order Engine</p>
          <p>
            Orders are submitted through <strong>strictly isolated per-account sessions</strong> adhering to Angel One rate limits.
            Failures in Account A will never block or silently corrupt orders in Account B. Double-click idempotency protection is enforced.
          </p>
        </div>
      </div>

      {/* Step 1: Instrument & Order Configuration */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
        <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-brand-600 text-white flex items-center justify-center text-xs">1</span>
          <span>Select IPO & Base Pricing</span>
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-xs">
          <div>
            <label className="block text-slate-700 font-medium mb-1">Select IPO Holding</label>
            <select
              value={selectedIpoId}
              onChange={(e) => setSelectedIpoId(Number(e.target.value))}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg outline-none bg-white font-bold"
            >
              {ipos.map((ipo) => (
                <option key={ipo.id} value={ipo.id}>
                  {ipo.symbol} — {ipo.total_allotted_shares} shares in {ipo.total_accounts_allotted} accounts
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-slate-700 font-medium mb-1">Order Type</label>
            <select
              value={orderType}
              onChange={(e) => setOrderType(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg outline-none bg-white font-semibold"
            >
              <option value="LIMIT">LIMIT Order (Recommended for Listing Day)</option>
              <option value="MARKET">MARKET Order (Rejected during Pre-Open)</option>
            </select>
          </div>

          <div>
            <label className="block text-slate-700 font-medium mb-1">Base Limit Price (₹)</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                step="0.05"
                disabled={orderType === 'MARKET'}
                value={globalPrice}
                onChange={(e) => setGlobalPrice(Number(e.target.value))}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg outline-none num-mono font-bold text-sm"
              />
              <button
                type="button"
                onClick={applyGlobalPriceToAll}
                className="px-2.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-medium text-[11px] whitespace-nowrap"
                title="Apply to all selected accounts below"
              >
                Apply All
              </button>
            </div>
          </div>

          <div>
            <label className="block text-slate-700 font-medium mb-1">Batch Summary</label>
            <div className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg space-y-0.5">
              <div className="flex justify-between text-slate-600">
                <span>Selected Shares:</span>
                <span className="font-bold text-slate-900 num-mono">{totalSelectedQty}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Est. Total Value:</span>
                <span className="font-bold text-slate-900 num-mono">₹{totalEstimatedProceeds.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Step 2: Account Selection & Quantity Overrides */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
          <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
            <span className="w-5 h-5 rounded-full bg-brand-600 text-white flex items-center justify-center text-xs">2</span>
            <span>Target Accounts & Quantities ({accountStates.length} accounts with confirmed holdings)</span>
          </h3>

          {/* Quick Preset Buttons */}
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-slate-400 font-medium mr-1">Presets:</span>
            <button
              onClick={() => toggleSelectAll(true)}
              className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-[11px] font-semibold"
            >
              Select All
            </button>
            <button
              onClick={() => toggleSelectAll(false)}
              className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-[11px] font-semibold"
            >
              Deselect All
            </button>
            <button
              onClick={() => setPercentQuantity(100)}
              className="px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-brand-700 rounded text-[11px] font-semibold"
            >
              Sell 100%
            </button>
            <button
              onClick={() => setPercentQuantity(50)}
              className="px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-brand-700 rounded text-[11px] font-semibold"
            >
              Sell 50%
            </button>
          </div>
        </div>

        {accountStates.length === 0 ? (
          <div className="text-center py-8 text-xs text-slate-400">
            No accounts currently hold confirmed allotted shares of {selectedIPO?.symbol}.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider font-semibold border-b border-slate-200 text-[10px]">
                <tr>
                  <th className="py-2.5 px-3 w-8">
                    <input
                      type="checkbox"
                      checked={accountStates.every((a) => a.selected)}
                      onChange={(e) => toggleSelectAll(e.target.checked)}
                      className="w-4 h-4 text-brand-600 rounded"
                    />
                  </th>
                  <th className="py-2.5 px-3">Account Nickname</th>
                  <th className="py-2.5 px-3">Client Code</th>
                  <th className="py-2.5 px-3">Group</th>
                  <th className="py-2.5 px-3">Holding Qty</th>
                  <th className="py-2.5 px-3">Quantity to Sell</th>
                  <th className="py-2.5 px-3">Limit Price (₹)</th>
                  <th className="py-2.5 px-3">Est. Value (₹)</th>
                  <th className="py-2.5 px-3">DDPI / eDIS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {accountStates.map((acc, idx) => (
                  <tr key={acc.account_id} className={`tr-hover ${acc.selected ? 'bg-blue-50/20' : 'opacity-60'}`}>
                    <td className="py-2.5 px-3">
                      <input
                        type="checkbox"
                        checked={acc.selected}
                        onChange={(e) => {
                          const updated = [...accountStates];
                          updated[idx].selected = e.target.checked;
                          setAccountStates(updated);
                        }}
                        className="w-4 h-4 text-brand-600 rounded cursor-pointer"
                      />
                    </td>
                    <td className="py-2.5 px-3 font-semibold text-slate-900">{acc.nickname}</td>
                    <td className="py-2.5 px-3 font-mono text-slate-500">{acc.masked_client_code}</td>
                    <td className="py-2.5 px-3">
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-100 text-slate-600">
                        {acc.account_group}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 num-mono font-bold text-slate-800">{acc.holding_qty}</td>
                    <td className="py-2.5 px-3">
                      <input
                        type="number"
                        min="1"
                        max={acc.holding_qty}
                        disabled={!acc.selected}
                        value={acc.quantity}
                        onChange={(e) => {
                          const updated = [...accountStates];
                          updated[idx].quantity = Math.min(acc.holding_qty, Math.max(1, Number(e.target.value)));
                          setAccountStates(updated);
                        }}
                        className="w-20 px-2 py-1 border border-slate-300 rounded outline-none num-mono font-bold text-slate-900"
                      />
                    </td>
                    <td className="py-2.5 px-3">
                      <input
                        type="number"
                        step="0.05"
                        disabled={!acc.selected || orderType === 'MARKET'}
                        value={acc.price_override}
                        onChange={(e) => {
                          const updated = [...accountStates];
                          updated[idx].price_override = Number(e.target.value);
                          setAccountStates(updated);
                        }}
                        className="w-24 px-2 py-1 border border-slate-300 rounded outline-none num-mono font-bold text-slate-900"
                      />
                    </td>
                    <td className="py-2.5 px-3 num-mono font-bold text-slate-900">
                      ₹{(acc.quantity * (acc.price_override || globalPrice)).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-2.5 px-3">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        acc.ddpi_status === 'ACTIVE'
                          ? 'bg-blue-50 text-blue-700'
                          : 'bg-amber-50 text-amber-800'
                      }`}>
                        DDPI: {acc.ddpi_status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
          <div className="text-xs text-slate-500">
            Total of <strong>{totalSelectedQty}</strong> shares will be queued for order submission across <strong>{accountStates.filter(a => a.selected).length}</strong> accounts.
          </div>
          <button
            onClick={handleValidatePreview}
            disabled={isValidating || totalSelectedQty === 0}
            className="px-5 py-2.5 bg-brand-600 hover:bg-brand-700 text-white rounded-lg font-bold text-xs shadow-sm transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            <Calculator className="w-4 h-4" />
            <span>{isValidating ? 'Validating Batch...' : 'Validate & Preview Orders'}</span>
          </button>
        </div>
      </div>

      {/* Step 3: Pre-Flight Validation Results Table */}
      {preview && (
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-finGreen text-white flex items-center justify-center text-xs">3</span>
              <span>Pre-Flight Validation Results ({preview.proposed_orders.length} Prepared Drafts)</span>
            </h3>

            <div className="flex items-center gap-2">
              <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                preview.is_executable
                  ? 'bg-finGreen-bg text-finGreen-text border border-finGreen-border'
                  : 'bg-finRed-bg text-finRed-text border border-finRed-border'
              }`}>
                {preview.is_executable ? 'ALL CHECKS PASSED — READY FOR EXECUTION' : 'EXECUTION BLOCKED BY RISKS'}
              </span>
            </div>
          </div>

          {/* Blocking Errors Banner */}
          {preview.blocking_errors.length > 0 && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg space-y-1">
              <div className="flex items-center gap-1.5 text-xs font-bold text-red-900">
                <AlertTriangle className="w-4 h-4 text-red-600" />
                <span>Blocking Safety Errors:</span>
              </div>
              <ul className="list-disc list-inside text-xs text-red-700 pl-4">
                {preview.blocking_errors.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Non-Blocking Warnings Banner */}
          {preview.warnings.length > 0 && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg space-y-1">
              <div className="flex items-center gap-1.5 text-xs font-bold text-amber-900">
                <Info className="w-4 h-4 text-amber-600" />
                <span>Depository & Compliance Warnings:</span>
              </div>
              <ul className="list-disc list-inside text-xs text-amber-800 pl-4">
                {preview.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider font-semibold border-b border-slate-200 text-[10px]">
                <tr>
                  <th className="py-2.5 px-3">Account</th>
                  <th className="py-2.5 px-3">Client Code</th>
                  <th className="py-2.5 px-3">Side</th>
                  <th className="py-2.5 px-3">Type</th>
                  <th className="py-2.5 px-3">Order Qty</th>
                  <th className="py-2.5 px-3">Limit Price</th>
                  <th className="py-2.5 px-3">Est. Proceeds</th>
                  <th className="py-2.5 px-3">Validation Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {preview.proposed_orders.map((po) => (
                  <tr key={po.account_id} className="tr-hover">
                    <td className="py-2 px-3 font-semibold text-slate-900">{po.nickname}</td>
                    <td className="py-2 px-3 font-mono text-slate-500">{po.masked_client_code}</td>
                    <td className="py-2 px-3">
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-50 text-red-600">SELL</span>
                    </td>
                    <td className="py-2 px-3 font-medium text-slate-700">{po.order_type}</td>
                    <td className="py-2 px-3 num-mono font-bold text-slate-900">{po.proposed_quantity}</td>
                    <td className="py-2 px-3 num-mono font-bold text-slate-900">₹{po.price.toFixed(2)}</td>
                    <td className="py-2 px-3 num-mono font-bold text-slate-900">
                      ₹{po.estimated_value.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-2 px-3">
                      {po.is_valid ? (
                        <span className="inline-flex items-center gap-1 text-finGreen font-semibold">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Passed</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-finRed font-semibold">
                          <XCircle className="w-3.5 h-3.5" />
                          <span>{po.message}</span>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
            <div className="text-xs text-slate-600">
              Total Order Count: <strong>{preview.total_accounts}</strong> | Total Value: <strong>₹{preview.total_estimated_value.toLocaleString('en-IN')}</strong>
            </div>
            <button
              onClick={() => setIsConfirmModalOpen(true)}
              disabled={!preview.is_executable || isExecuting}
              className="px-6 py-2.5 bg-brand-600 hover:bg-brand-700 text-white rounded-lg font-bold text-xs shadow-md transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              <Send className="w-4 h-4" />
              <span>Confirm & Dispatch Orders</span>
            </button>
          </div>
        </div>
      )}

      {/* Execution Results Stream */}
      {executionResult && (
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <h3 className="text-sm font-bold text-slate-900 tracking-tight flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-finGreen" />
              <span>Bulk Order Execution Summary</span>
            </h3>
            <div className="text-xs text-slate-500 font-mono">
              Batch: {executionResult.batch_id.slice(0, 8)}...
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4 text-center">
            <div className="p-3 bg-slate-50 rounded-lg">
              <div className="text-xs text-slate-500">Attempted</div>
              <div className="text-lg font-bold text-slate-900 num-mono">{executionResult.total_submitted}</div>
            </div>
            <div className="p-3 bg-green-50 rounded-lg">
              <div className="text-xs text-green-700">Successful / Executed</div>
              <div className="text-lg font-bold text-finGreen num-mono">{executionResult.successful_count}</div>
            </div>
            <div className="p-3 bg-red-50 rounded-lg">
              <div className="text-xs text-red-700">Rejected / Failed</div>
              <div className="text-lg font-bold text-finRed num-mono">{executionResult.failed_count}</div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider font-semibold border-b border-slate-200 text-[10px]">
                <tr>
                  <th className="py-2 px-3">Account</th>
                  <th className="py-2 px-3">Client Code</th>
                  <th className="py-2 px-3">Broker Order ID</th>
                  <th className="py-2 px-3">Status</th>
                  <th className="py-2 px-3">Filled Qty</th>
                  <th className="py-2 px-3">Details / Rejection Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {executionResult.results?.map((r: any, idx: number) => (
                  <tr key={idx} className="tr-hover">
                    <td className="py-2 px-3 font-semibold text-slate-900">{r.nickname}</td>
                    <td className="py-2 px-3 font-mono text-slate-500">{r.masked_client_code}</td>
                    <td className="py-2 px-3 font-mono text-slate-600">{r.broker_order_id || '—'}</td>
                    <td className="py-2 px-3">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        r.status === 'EXECUTED' || r.status === 'ACCEPTED'
                          ? 'bg-finGreen-bg text-finGreen-text border border-finGreen-border'
                          : 'bg-finRed-bg text-finRed-text border border-finRed-border'
                      }`}>
                        {r.status}
                      </span>
                    </td>
                    <td className="py-2 px-3 num-mono font-bold">{r.filled_quantity ?? '—'}</td>
                    <td className="py-2 px-3 text-slate-500">{r.rejection_reason || 'Order processed successfully'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Double Confirmation Modal */}
      {isConfirmModalOpen && preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-lg p-6 space-y-4">
            <div className="flex items-center gap-3 border-b border-slate-100 pb-3">
              <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center text-amber-700">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Confirm Live / Paper Bulk Execution</h3>
                <p className="text-xs text-slate-500">Requires explicit human authorization</p>
              </div>
            </div>

            <div className="text-xs text-slate-700 space-y-3 bg-slate-50 p-4 rounded-lg border border-slate-200">
              <p>You are about to submit the following trade instructions:</p>
              <div className="grid grid-cols-2 gap-2 text-slate-800 font-semibold">
                <div>Instrument: {selectedIPO?.symbol}</div>
                <div>Side: SELL (Delivery)</div>
                <div>Total Accounts: {preview.total_accounts}</div>
                <div>Total Shares: {preview.total_quantity}</div>
                <div>Order Type: {orderType}</div>
                <div>Estimated Proceeds: ₹{preview.total_estimated_value.toLocaleString('en-IN')}</div>
              </div>
              <p className="text-red-700 font-medium">
                Orders will be dispatched sequentially to respect rate limits. Each account will execute independently.
              </p>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setIsConfirmModalOpen(false)}
                className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleExecuteOrders}
                disabled={isExecuting}
                className="px-5 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-xs font-bold shadow-md transition-colors disabled:opacity-50"
              >
                {isExecuting ? 'Submitting Batch...' : 'I Confirm — Submit All Orders'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
