import React, { useState, useEffect } from 'react';
import {
  ShieldAlert, AlertTriangle, ShieldCheck, CheckCircle2,
  Lock, AlertOctagon, Sliders, Info, HelpCircle
} from 'lucide-react';
import { RiskLimit } from '../types';
import { api } from '../api';

interface RiskViewProps {
  onRefresh: () => void;
}

export const RiskView: React.FC<RiskViewProps> = ({ onRefresh }) => {
  const [risk, setRisk] = useState<RiskLimit | null>(null);
  const [formData, setFormData] = useState<Partial<RiskLimit>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const loadRisk = async () => {
    setIsLoading(true);
    try {
      const data = await api.getRiskLimits();
      setRisk(data);
      setFormData(data);
    } catch (err: any) {
      console.error('Failed to load risk limits:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadRisk();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setSaveSuccess(false);
    try {
      const updated = await api.updateRiskLimits(formData);
      setRisk(updated);
      setSaveSuccess(true);
      onRefresh();
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: any) {
      alert(`Error updating risk limits: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleKillSwitch = async () => {
    if (confirm('Are you sure you want to toggle the Emergency Kill Switch?')) {
      try {
        const res = await api.toggleEmergencyHalt();
        if (risk) {
          setRisk({ ...risk, emergency_trading_disabled: res.emergency_trading_disabled });
        }
        onRefresh();
      } catch (err: any) {
        alert(err.message);
      }
    }
  };

  return (
    <div className="space-y-6">
      {/* Emergency Kill Switch Banner Card */}
      <div className={`p-6 rounded-xl border shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 ${
        risk?.emergency_trading_disabled
          ? 'bg-red-50 border-red-300'
          : 'bg-white border-slate-200'
      }`}>
        <div className="flex items-start gap-4">
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${
            risk?.emergency_trading_disabled
              ? 'bg-red-600 text-white animate-pulse'
              : 'bg-slate-100 text-slate-600'
          }`}>
            <AlertOctagon className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-900">
              {risk?.emergency_trading_disabled ? 'TRADING HALTED — KILL SWITCH ACTIVE' : 'Master Trading Kill Switch'}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5 max-w-xl">
              When activated, all single order submissions, bulk order dispatching, and paper executions are immediately blocked across every account.
            </p>
          </div>
        </div>

        <button
          onClick={handleToggleKillSwitch}
          className={`px-5 py-2.5 rounded-lg text-xs font-bold shadow-md transition-all ${
            risk?.emergency_trading_disabled
              ? 'bg-finGreen hover:bg-green-700 text-white'
              : 'bg-red-600 hover:bg-red-700 text-white animate-none'
          }`}
        >
          {risk?.emergency_trading_disabled ? 'DEACTIVATE HALT (RESUME TRADING)' : 'ACTIVATE EMERGENCY KILL SWITCH'}
        </button>
      </div>

      {/* Grid: Risk Limits Form & Educational Guide */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Form: Global Guardrails */}
        <div className="lg:col-span-2 bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
          <div className="pb-3 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-900 tracking-tight">Global Operation Guardrails</h3>
              <p className="text-xs text-slate-500">Enforced by backend validation before any order draft is prepared</p>
            </div>
            {saveSuccess && (
              <span className="flex items-center gap-1 text-xs text-finGreen font-semibold">
                <CheckCircle2 className="w-4 h-4" />
                <span>Limits Updated</span>
              </span>
            )}
          </div>

          <form onSubmit={handleSave} className="space-y-4 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-slate-700 font-semibold mb-1">Max Order Value per Account (₹)</label>
                <input
                  type="number"
                  step="1000"
                  value={formData.max_order_value || 500000}
                  onChange={(e) => setFormData({ ...formData, max_order_value: Number(e.target.value) })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg outline-none num-mono font-bold"
                />
                <span className="text-[10px] text-slate-400 mt-1 block">Prevents accidental fat-finger orders</span>
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">Max Shares per Order</label>
                <input
                  type="number"
                  value={formData.max_quantity_per_order || 5000}
                  onChange={(e) => setFormData({ ...formData, max_quantity_per_order: Number(e.target.value) })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg outline-none num-mono font-bold"
                />
                <span className="text-[10px] text-slate-400 mt-1 block">Maximum permissible quantity per transaction</span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-slate-700 font-semibold mb-1">Daily Max Loss Threshold (₹)</label>
                <input
                  type="number"
                  step="1000"
                  value={formData.max_loss_threshold || 50000}
                  onChange={(e) => setFormData({ ...formData, max_loss_threshold: Number(e.target.value) })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg outline-none num-mono font-bold text-red-700"
                />
                <span className="text-[10px] text-slate-400 mt-1 block">Triggers high-priority warning alerts</span>
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">Default Stop Loss Level (%)</label>
                <input
                  type="number"
                  step="0.5"
                  value={formData.stop_loss_percent || 5.0}
                  onChange={(e) => setFormData({ ...formData, stop_loss_percent: Number(e.target.value) })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg outline-none num-mono font-bold"
                />
                <span className="text-[10px] text-slate-400 mt-1 block">Application-monitored protective trigger</span>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
              <span className="text-[11px] text-slate-400">
                Last modified: {risk?.updated_at ? new Date(risk.updated_at).toLocaleString('en-IN') : 'Default'}
              </span>
              <button
                type="submit"
                disabled={isSaving}
                className="px-5 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-lg font-bold shadow-sm transition-colors disabled:opacity-50"
              >
                {isSaving ? 'Saving Limits...' : 'Save Risk Policy'}
              </button>
            </div>
          </form>
        </div>

        {/* Educational Stop-Loss & Regulatory Clarification */}
        <div className="bg-slate-50 p-5 rounded-xl border border-slate-200 text-xs space-y-3">
          <div className="flex items-center gap-2 pb-2 border-b border-slate-200">
            <HelpCircle className="w-4 h-4 text-brand-600" />
            <h4 className="font-bold text-slate-900 uppercase tracking-wider text-[11px]">
              Stop-Loss Order Mechanisms Explained
            </h4>
          </div>

          <div className="space-y-2 text-slate-600 leading-relaxed">
            <div>
              <strong className="text-slate-900 block">1. Price Alert:</strong>
              A client or server notification sent when LTP crosses a price. Does NOT submit any order to the broker.
            </div>
            <div>
              <strong className="text-slate-900 block">2. Broker-Held Stop Order:</strong>
              An order held directly on the exchange order book during continuous trading (10:00 AM onwards). When triggered, fires automatically on the exchange.
            </div>
            <div>
              <strong className="text-slate-900 block">3. Application-Monitored Trigger:</strong>
              A software trigger managed by IPOPro. If WebSocket data drops or server restarts, execution may not occur.
            </div>
            <div>
              <strong className="text-slate-900 block">4. Stop-Limit Order:</strong>
              When trigger price is touched, converts to a LIMIT order. If price gaps down rapidly below your limit, the order remains UNFILLED.
            </div>
          </div>

          <div className="p-2.5 bg-amber-100/70 border border-amber-300 rounded-lg text-amber-900 font-medium text-[11px]">
            <strong>Important Regulatory Warning:</strong> Stop loss orders NEVER guarantee execution price on IPO listing day due to potential price gaps and illiquidity.
          </div>
        </div>
      </div>
    </div>
  );
};
