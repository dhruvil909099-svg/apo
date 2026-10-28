import React, { useState } from 'react';
import {
  X, Check, AlertTriangle, ExternalLink, ShieldCheck,
  Building2, Users, ArrowRight, Copy, CheckCircle2,
  FileCheck2, Info
} from 'lucide-react';
import { IPO, Account, IPOPrepareApplicationResponse } from '../types';
import { api } from '../api';

interface IPOApplicationModalProps {
  ipo: IPO | null;
  accounts: Account[];
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (msg: string) => void;
}

export const IPOApplicationModal: React.FC<IPOApplicationModalProps> = ({
  ipo,
  accounts,
  isOpen,
  onClose,
  onSuccess
}) => {
  const [selectedAccountIds, setSelectedAccountIds] = useState<number[]>(
    accounts.filter(a => a.is_enabled).map(a => a.id)
  );
  const [lots, setLots] = useState<number>(1);
  const [category, setCategory] = useState<string>('RETAIL');
  const [useCutOff, setUseCutOff] = useState<boolean>(true);
  const [customBidPrice, setCustomBidPrice] = useState<number>(ipo?.max_price || ipo?.issue_price || 100);
  
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [prepResult, setPrepResult] = useState<IPOPrepareApplicationResponse | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Manual Handoff Confirmation Fields
  const [confirmAppNo, setConfirmAppNo] = useState<string>('');
  const [confirmUpiRef, setConfirmUpiRef] = useState<string>('');
  const [isConfirmingHandoff, setIsConfirmingHandoff] = useState<boolean>(false);

  if (!isOpen || !ipo) return null;

  const bidPrice = useCutOff ? (ipo.max_price || ipo.issue_price) : customBidPrice;
  const sharesPerAccount = lots * ipo.lot_size;
  const amountPerAccount = sharesPerAccount * bidPrice;
  const isRetailOverLimit = category === 'RETAIL' && amountPerAccount > 200000.0;

  const toggleAccount = (id: number) => {
    setSelectedAccountIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const selectAll = () => {
    if (selectedAccountIds.length === accounts.length) {
      setSelectedAccountIds([]);
    } else {
      setSelectedAccountIds(accounts.map(a => a.id));
    }
  };

  const copyToClipboard = (text: string, fieldName: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(fieldName);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handlePrepareDrafts = async () => {
    if (selectedAccountIds.length === 0) {
      alert('Please select at least one eligible account.');
      return;
    }
    if (isRetailOverLimit) {
      alert('Retail applications cannot exceed ₹2,00,000. Please decrease lots or choose HNI / sNII category.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await api.prepareIPOApplications({
        ipo_id: ipo.id,
        account_ids: selectedAccountIds,
        lots,
        category,
        bid_price: bidPrice,
        save_drafts: true
      });
      setPrepResult(res);
      onSuccess(`Prepared ${res.total_accounts} application drafts for ${ipo.symbol}. Proceed with official broker handoff.`);
    } catch (err: any) {
      alert(`Preparation failed: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveHandoffConfirmation = async (draftId: number) => {
    if (!confirmAppNo.trim()) {
      alert('Please enter the official broker application reference number.');
      return;
    }
    setIsConfirmingHandoff(true);
    try {
      await api.recordApplicationHandoff({
        allotment_id: draftId,
        application_no: confirmAppNo.trim(),
        upi_mandate_reference: confirmUpiRef.trim() || undefined,
        preparation_status: 'SUBMITTED_BROKER_CONFIRMED',
        broker_application_status: 'CONFIRMED',
        mandate_status: 'APPROVED',
        verification_source: 'ACCOUNT_HOLDER_OFFICIAL_CONFIRMATION'
      });
      onSuccess(`Application reference ${confirmAppNo} recorded successfully! Track status under 'Your Applications'.`);
      onClose();
    } catch (err: any) {
      alert(`Failed to record handoff: ${err.message}`);
    } finally {
      setIsConfirmingHandoff(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5 animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center font-bold text-sm shadow-md shadow-blue-500/20">
              {ipo.symbol.substring(0, 3)}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-slate-900 text-base">Prepare IPO Application</h3>
                <span className="text-xs font-semibold px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                  {ipo.symbol}
                </span>
                <span className="text-xs text-slate-500">Lot: {ipo.lot_size} Shares</span>
              </div>
              <p className="text-xs text-slate-500">{ipo.company_name}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-5 text-sm flex-1">
          {/* STEP 1: Application Parameters */}
          {!prepResult ? (
            <div className="space-y-5">
              {/* Category & Pricing Bar */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Investor Category</label>
                  <select
                    value={category}
                    onChange={e => setCategory(e.target.value)}
                    className="w-full text-xs font-medium bg-white border border-slate-300 rounded-lg p-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="RETAIL">Retail Individual (Max ₹2 Lakhs)</option>
                    <option value="sNII">Small HNI / sNII (₹2L - ₹10L)</option>
                    <option value="bNII">Big HNI / bNII (Above ₹10L)</option>
                    <option value="EMPLOYEE">Employee Reservation</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Number of Lots</label>
                  <div className="flex items-center">
                    <button
                      type="button"
                      onClick={() => setLots(Math.max(1, lots - 1))}
                      className="px-3 py-1.5 bg-white border border-slate-300 rounded-l-lg hover:bg-slate-100 font-bold text-slate-700"
                    >
                      -
                    </button>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={lots}
                      onChange={e => setLots(Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-16 text-center font-bold text-slate-900 border-y border-slate-300 py-1.5 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setLots(lots + 1)}
                      className="px-3 py-1.5 bg-white border border-slate-300 rounded-r-lg hover:bg-slate-100 font-bold text-slate-700"
                    >
                      +
                    </button>
                    <span className="text-xs text-slate-500 ml-2">({sharesPerAccount} sh)</span>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-semibold text-slate-600">Cut-off Price</label>
                    <label className="text-[11px] text-blue-600 font-medium flex items-center gap-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={useCutOff}
                        onChange={e => setUseCutOff(e.target.checked)}
                        className="rounded text-blue-600 focus:ring-0"
                      />
                      At Cut-off
                    </label>
                  </div>
                  {useCutOff ? (
                    <div className="text-sm font-bold text-slate-900 py-1.5 px-2 bg-white rounded border border-slate-300 font-mono">
                      ₹{(ipo.max_price || ipo.issue_price).toFixed(2)}
                    </div>
                  ) : (
                    <input
                      type="number"
                      step={0.5}
                      min={ipo.min_price || ipo.issue_price}
                      max={ipo.max_price || ipo.issue_price}
                      value={customBidPrice}
                      onChange={e => setCustomBidPrice(parseFloat(e.target.value) || ipo.issue_price)}
                      className="w-full text-xs font-mono font-bold bg-white border border-slate-300 rounded-lg p-2 text-slate-900"
                    />
                  )}
                </div>
              </div>

              {/* Retail Limit Warning */}
              {isRetailOverLimit && (
                <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl flex items-center gap-2.5 text-xs">
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>
                    Retail Category limit is <strong>₹2,00,000</strong>. Your application amount per account is <strong>₹{amountPerAccount.toLocaleString('en-IN')}</strong>. Please reduce the number of lots or select HNI category.
                  </span>
                </div>
              )}

              {/* Account Selection */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                    <Users className="w-4 h-4 text-blue-600" />
                    Select Target Angel One Demat Accounts ({selectedAccountIds.length} of {accounts.length})
                  </label>
                  <button
                    type="button"
                    onClick={selectAll}
                    className="text-xs font-semibold text-blue-600 hover:text-blue-800"
                  >
                    {selectedAccountIds.length === accounts.length ? 'Deselect All' : 'Select All Eligible'}
                  </button>
                </div>

                <div className="border border-slate-200 rounded-xl divide-y divide-slate-100 max-h-48 overflow-y-auto">
                  {accounts.map(acc => {
                    const isSelected = selectedAccountIds.includes(acc.id);
                    return (
                      <div
                        key={acc.id}
                        onClick={() => toggleAccount(acc.id)}
                        className={`p-3 flex items-center justify-between cursor-pointer transition-colors ${
                          isSelected ? 'bg-blue-50/50 hover:bg-blue-50' : 'hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => {}}
                            className="rounded text-blue-600 focus:ring-0 w-4 h-4"
                          />
                          <div>
                            <div className="font-semibold text-slate-900 text-xs flex items-center gap-1.5">
                              {acc.nickname}
                              <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-100 text-slate-600 font-normal">
                                {acc.account_group || 'Main'}
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-500 font-mono">
                              Client Code: {acc.masked_client_code || acc.client_code}
                            </div>
                          </div>
                        </div>

                        <div className="text-right">
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                            acc.auth_status === 'CONNECTED'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-slate-100 text-slate-600'
                          }`}>
                            {acc.auth_status}
                          </span>
                          <div className="text-[11px] text-slate-600 font-mono mt-0.5">
                            Avail Cash: ₹{(acc.available_cash || 0).toLocaleString('en-IN')}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Total Calculation Card */}
              <div className="bg-gradient-to-r from-blue-50 via-indigo-50/40 to-slate-50 p-4 rounded-xl border border-blue-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="text-xs text-slate-600 font-medium">Application Funding Calculation:</div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {selectedAccountIds.length} Accounts × {sharesPerAccount} Shares @ ₹{bidPrice.toFixed(2)}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-slate-500">Total Blocking Amount:</div>
                  <div className="text-xl font-bold text-blue-700 font-mono">
                    ₹{(selectedAccountIds.length * amountPerAccount).toLocaleString('en-IN')}
                  </div>
                </div>
              </div>

              {/* Official Handoff Warning Banner */}
              <div className="p-3.5 bg-amber-50/70 border border-amber-200 text-amber-900 rounded-xl text-xs flex items-start gap-2.5">
                <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <span className="font-bold">Official Broker Handoff Notice:</span>
                  <p className="text-amber-800 leading-relaxed">
                    Angel One SmartAPI does not expose programmatic REST endpoints for primary market IPO bid placement. IPOPro prepares and validates your parameters with zero error, and generates a structured handoff to Angel One's official portal where you confirm your UPI mandate.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            /* STEP 2: Prepared Applications & Handoff Action Screen */
            <div className="space-y-5 animate-in fade-in duration-200">
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                <div>
                  <h4 className="font-bold text-emerald-900 text-sm">Applications Successfully Prepared & Saved</h4>
                  <p className="text-xs text-emerald-700">
                    {prepResult.total_accounts} application draft(s) created. Complete official bid submission on Angel One below.
                  </p>
                </div>
              </div>

              {/* Accounts Handoff Table */}
              <div className="border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100 text-xs">
                <div className="bg-slate-50 px-4 py-2.5 font-bold text-slate-700 grid grid-cols-12">
                  <span className="col-span-4">Account</span>
                  <span className="col-span-3">Category & Lots</span>
                  <span className="col-span-3 text-right">Amount</span>
                  <span className="col-span-2 text-right">Action</span>
                </div>
                {prepResult.applications.map((app, idx) => (
                  <div key={idx} className="px-4 py-3 grid grid-cols-12 items-center bg-white hover:bg-slate-50">
                    <div className="col-span-4">
                      <div className="font-bold text-slate-900">{app.account_nickname}</div>
                      <div className="text-slate-500 font-mono text-[11px]">{app.account_masked_code}</div>
                    </div>
                    <div className="col-span-3">
                      <span className="font-semibold text-slate-800">{app.category}</span>
                      <div className="text-slate-500">{app.lots} Lot ({app.shares} Sh)</div>
                    </div>
                    <div className="col-span-3 text-right font-mono font-bold text-blue-700">
                      ₹{app.total_amount.toLocaleString('en-IN')}
                    </div>
                    <div className="col-span-2 text-right">
                      <button
                        type="button"
                        onClick={() => copyToClipboard(`${app.ipo_symbol} | ${app.shares} shares @ ₹${app.cut_off_price}`, `acc-${idx}`)}
                        className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded font-medium text-[11px] inline-flex items-center gap-1"
                      >
                        {copiedField === `acc-${idx}` ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                        {copiedField === `acc-${idx}` ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Direct Link to Angel One */}
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-bold text-slate-900 text-xs">Step 1: Open Official Angel One IPO Portal</h4>
                    <p className="text-[11px] text-slate-500">Sign in to your authorized Angel One account and submit the bid with your UPI ID.</p>
                  </div>
                  <a
                    href="https://trade.angelone.in/ipo"
                    target="_blank"
                    rel="noreferrer"
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold text-xs flex items-center gap-1.5 shadow-sm shadow-blue-500/20"
                  >
                    Open Angel One IPO
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>

                <div className="border-t border-slate-200 pt-3">
                  <h4 className="font-bold text-slate-900 text-xs mb-2">Step 2: Record Confirmed Broker Application Reference</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input
                      type="text"
                      placeholder="e.g. ANGEL-IPO-2026-99182"
                      value={confirmAppNo}
                      onChange={e => setConfirmAppNo(e.target.value)}
                      className="text-xs p-2 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <input
                      type="text"
                      placeholder="UPI Mandate Ref (Optional)"
                      value={confirmUpiRef}
                      onChange={e => setConfirmUpiRef(e.target.value)}
                      className="text-xs p-2 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1">
                    Entering your reference number updates the draft to <strong>SUBMITTED_BROKER_CONFIRMED</strong> for automatic allotment and demat tracking.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 border border-slate-300 text-slate-700 rounded-xl font-medium text-xs hover:bg-white transition-colors"
          >
            {prepResult ? 'Finish & Track' : 'Cancel'}
          </button>

          {!prepResult ? (
            <button
              type="button"
              disabled={isSubmitting || selectedAccountIds.length === 0 || isRetailOverLimit}
              onClick={handlePrepareDrafts}
              className={`px-5 py-2.5 rounded-xl font-bold text-xs text-white flex items-center gap-2 transition-all ${
                isSubmitting || selectedAccountIds.length === 0 || isRetailOverLimit
                  ? 'bg-slate-300 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-700 shadow-md shadow-blue-600/20'
              }`}
            >
              {isSubmitting ? 'Preparing Drafts...' : 'Save Application Drafts & Proceed to Handoff'}
              <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              type="button"
              disabled={isConfirmingHandoff || !confirmAppNo.trim()}
              onClick={() => prepResult.applications[0]?.draft_id && handleSaveHandoffConfirmation(prepResult.applications[0].draft_id)}
              className={`px-5 py-2.5 rounded-xl font-bold text-xs text-white flex items-center gap-2 transition-all ${
                isConfirmingHandoff || !confirmAppNo.trim()
                  ? 'bg-slate-300 cursor-not-allowed'
                  : 'bg-emerald-600 hover:bg-emerald-700 shadow-md shadow-emerald-600/20'
              }`}
            >
              <FileCheck2 className="w-4 h-4" />
              {isConfirmingHandoff ? 'Saving...' : 'Record Broker Submission'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
