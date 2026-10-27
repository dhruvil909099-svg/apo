import React, { useState } from 'react';
import {
  TrendingUp, Plus, Upload, Download, FileText,
  CheckCircle2, AlertCircle, ArrowUpRight, ArrowDownRight, Layers
} from 'lucide-react';
import { IPO, Allotment, Account } from '../types';
import { api } from '../api';

interface IPOTrackerViewProps {
  ipos: IPO[];
  accounts: Account[];
  onRefresh: () => void;
}

export const IPOTrackerView: React.FC<IPOTrackerViewProps> = ({ ipos, accounts, onRefresh }) => {
  const [selectedStatus, setSelectedStatus] = useState<string>('ALL');
  const [selectedIPO, setSelectedIPO] = useState<IPO | null>(null);
  const [allotments, setAllotments] = useState<Allotment[]>([]);
  const [isLoadingAllotments, setIsLoadingAllotments] = useState(false);

  // Modals
  const [isAddIPOOpen, setIsAddIPOOpen] = useState(false);
  const [isCSVModalOpen, setIsCSVModalOpen] = useState(false);
  const [isManualAllotmentOpen, setIsManualAllotmentOpen] = useState(false);

  // New IPO Form
  const [ipoForm, setIpoForm] = useState<{
    symbol: string;
    company_name: string;
    exchange: string;
    issue_price: number;
    lot_size: number;
    listing_date: string;
    isin: string;
    symbol_token: string;
    is_sme: boolean;
    status: 'UPCOMING' | 'PRE_OPEN' | 'LISTED' | 'CLOSED';
  }>({
    symbol: '',
    company_name: '',
    exchange: 'NSE',
    issue_price: 100,
    lot_size: 1,
    listing_date: '',
    isin: '',
    symbol_token: '',
    is_sme: false,
    status: 'LISTED'
  });


  // Manual Allotment Form
  const [manualAllotForm, setManualAllotForm] = useState({
    account_id: accounts[0]?.id || 1,
    applied_quantity: 30,
    allotted_quantity: 30,
    acquisition_cost: 500,
    application_no: 'APP-MANUAL-01'
  });

  // CSV file state
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvResult, setCsvResult] = useState<any>(null);

  const statuses = [
    { id: 'ALL', label: 'All IPOs' },
    { id: 'PRE_OPEN', label: 'Pre-Open Session' },
    { id: 'LISTED', label: 'Listed' },
    { id: 'UPCOMING', label: 'Upcoming' },
  ];

  const filteredIPOs = ipos.filter(
    (ipo) => selectedStatus === 'ALL' || ipo.status === selectedStatus
  );

  const handleOpenAllotments = async (ipo: IPO) => {
    setSelectedIPO(ipo);
    setIsLoadingAllotments(true);
    try {
      const data = await api.getIPOAllotments(ipo.id);
      setAllotments(data);
    } catch (err: any) {
      alert(`Error loading allotments: ${err.message}`);
    } finally {
      setIsLoadingAllotments(false);
    }
  };

  const handleCreateIPO = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.createIPO(ipoForm);
      setIsAddIPOOpen(false);
      onRefresh();
    } catch (err: any) {
      alert(`Failed to add IPO: ${err.message}`);
    }
  };

  const handleCreateManualAllotment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedIPO) return;
    try {
      await api.createAllotment(selectedIPO.id, manualAllotForm);
      setIsManualAllotmentOpen(false);
      handleOpenAllotments(selectedIPO);
      onRefresh();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleCSVUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedIPO || !csvFile) return;
    try {
      const res = await api.importCSV(selectedIPO.id, csvFile);
      setCsvResult(res);
      handleOpenAllotments(selectedIPO);
      onRefresh();
    } catch (err: any) {
      alert(err.message);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header Controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg">
          {statuses.map((s) => (
            <button
              key={s.id}
              onClick={() => setSelectedStatus(s.id)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                selectedStatus === s.id
                  ? 'bg-white text-slate-900 shadow-xs font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsAddIPOOpen(true)}
            className="px-3.5 py-1.5 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-xs font-semibold shadow-sm transition-colors flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            <span>Add IPO Record</span>
          </button>
        </div>
      </div>

      {/* IPO Master Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider font-semibold border-b border-slate-200 text-[10px]">
              <tr>
                <th className="py-3 px-4">Symbol / Company</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Issue Price</th>
                <th className="py-3 px-4">Lot Size</th>
                <th className="py-3 px-4">Current LTP</th>
                <th className="py-3 px-4">Listing Gain %</th>
                <th className="py-3 px-4">Confirmed Shares</th>
                <th className="py-3 px-4">Market Value</th>
                <th className="py-3 px-4">Unrealized P&L</th>
                <th className="py-3 px-4 text-right">Allotment Register</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredIPOs.map((ipo) => {
                const gainPct = ipo.issue_price > 0 && ipo.current_ltp
                  ? ((ipo.current_ltp - ipo.issue_price) / ipo.issue_price) * 100
                  : 0;
                const isPositive = gainPct >= 0;

                return (
                  <tr key={ipo.id} className="tr-hover">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900">{ipo.symbol}</span>
                        <span className="text-[10px] bg-slate-100 text-slate-600 px-1 py-0.2 rounded font-medium">
                          {ipo.exchange}
                        </span>
                        {ipo.is_sme && (
                          <span className="text-[9px] bg-purple-100 text-purple-800 font-bold px-1 py-0.2 rounded">
                            SME
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-500 truncate max-w-xs">{ipo.company_name}</p>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        ipo.status === 'PRE_OPEN'
                          ? 'bg-amber-100 text-amber-800 border border-amber-300'
                          : ipo.status === 'LISTED'
                          ? 'bg-blue-50 text-brand-600 border border-blue-200'
                          : 'bg-slate-100 text-slate-600'
                      }`}>
                        {ipo.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 num-mono font-medium text-slate-700">
                      ₹{ipo.issue_price.toFixed(2)}
                    </td>
                    <td className="py-3 px-4 num-mono text-slate-600">
                      {ipo.lot_size} {ipo.is_sme ? 'shares (fixed)' : 'shares'}
                    </td>
                    <td className="py-3 px-4 num-mono font-bold text-slate-900">
                      ₹{ipo.current_ltp?.toFixed(2) ?? '—'}
                    </td>
                    <td className="py-3 px-4">
                      <span className={`inline-flex items-center font-bold num-mono ${
                        isPositive ? 'text-finGreen' : 'text-finRed'
                      }`}>
                        {isPositive ? <ArrowUpRight className="w-3.5 h-3.5 mr-0.5" /> : <ArrowDownRight className="w-3.5 h-3.5 mr-0.5" />}
                        {isPositive ? '+' : ''}{gainPct.toFixed(2)}%
                      </span>
                    </td>
                    <td className="py-3 px-4 num-mono font-medium text-slate-900">
                      {ipo.total_allotted_shares.toLocaleString('en-IN')} shares
                      <div className="text-[10px] text-slate-400">{ipo.total_accounts_allotted} accounts</div>
                    </td>
                    <td className="py-3 px-4 num-mono font-bold text-slate-900">
                      ₹{ipo.estimated_current_value.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-3 px-4">
                      <span className={`font-bold num-mono ${
                        ipo.estimated_pnl >= 0 ? 'text-finGreen' : 'text-finRed'
                      }`}>
                        {ipo.estimated_pnl >= 0 ? '+' : ''}₹{ipo.estimated_pnl.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        onClick={() => handleOpenAllotments(ipo)}
                        className="px-3 py-1 bg-brand-50 hover:bg-brand-100 text-brand-700 border border-brand-200 rounded text-xs font-semibold transition-colors flex items-center gap-1.5 ml-auto"
                      >
                        <Layers className="w-3.5 h-3.5" />
                        <span>Allotments ({ipo.total_accounts_allotted})</span>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Account-wise Allotment Drawer / Details View */}
      {selectedIPO && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between pb-4 border-b border-slate-100 gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-base font-bold text-slate-900">{selectedIPO.symbol} Allotment Register</span>
                <span className="text-xs text-slate-500">({selectedIPO.company_name})</span>
              </div>
              <p className="text-xs text-slate-400">
                Official Demat reconciliation & account-by-account allotment verification
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsManualAllotmentOpen(true)}
                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Entry</span>
              </button>
              <button
                onClick={() => setIsCSVModalOpen(true)}
                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Import CSV</span>
              </button>
              <a
                href={`/api/v1/ipos/${selectedIPO.id}/export-csv`}
                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1"
                download
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export CSV</span>
              </a>
              <button
                onClick={() => setSelectedIPO(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600"
              >
                &times;
              </button>
            </div>
          </div>

          {isLoadingAllotments ? (
            <div className="text-center py-8 text-xs text-slate-500">Loading allotments...</div>
          ) : allotments.length === 0 ? (
            <div className="text-center py-8 text-xs text-slate-400">
              No allotments registered for this IPO yet. Click "Add Entry" or "Import CSV" to populate the register.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider font-semibold border-b border-slate-200 text-[10px]">
                  <tr>
                    <th className="py-2.5 px-3">Account Nickname</th>
                    <th className="py-2.5 px-3">Masked Client ID</th>
                    <th className="py-2.5 px-3">Group</th>
                    <th className="py-2.5 px-3">App No.</th>
                    <th className="py-2.5 px-3">Applied</th>
                    <th className="py-2.5 px-3">Allotted Qty</th>
                    <th className="py-2.5 px-3">Cost Basis</th>
                    <th className="py-2.5 px-3">Market Value</th>
                    <th className="py-2.5 px-3">Unrealized P&L</th>
                    <th className="py-2.5 px-3">Demat / DDPI Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {allotments.map((a) => (
                    <tr key={a.id} className="tr-hover">
                      <td className="py-2.5 px-3 font-semibold text-slate-900">{a.account_nickname}</td>
                      <td className="py-2.5 px-3 font-mono text-slate-600">{a.account_masked_code}</td>
                      <td className="py-2.5 px-3">
                        <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-100 text-slate-600">
                          {a.account_group}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-mono text-slate-400">{a.application_no || '—'}</td>
                      <td className="py-2.5 px-3 num-mono text-slate-500">{a.applied_quantity}</td>
                      <td className="py-2.5 px-3 num-mono font-bold text-slate-900">{a.allotted_quantity}</td>
                      <td className="py-2.5 px-3 num-mono text-slate-700">₹{a.acquisition_cost.toFixed(2)}</td>
                      <td className="py-2.5 px-3 num-mono font-bold text-slate-900">
                        ₹{a.market_value.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-2.5 px-3">
                        <span className={`font-bold num-mono ${a.unrealized_pnl >= 0 ? 'text-finGreen' : 'text-finRed'}`}>
                          {a.unrealized_pnl >= 0 ? '+' : ''}₹{a.unrealized_pnl.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </span>
                      </td>
                      <td className="py-2.5 px-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          a.ddpi_status === 'ACTIVE'
                            ? 'bg-blue-50 text-blue-700 border border-blue-200'
                            : 'bg-amber-50 text-amber-800 border border-amber-200'
                        }`}>
                          DDPI: {a.ddpi_status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* CSV Import Modal */}
      {isCSVModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-900">Import Allotment CSV for {selectedIPO?.symbol}</h3>
              <button onClick={() => { setIsCSVModalOpen(false); setCsvResult(null); }} className="text-slate-400 hover:text-slate-600 text-lg">&times;</button>
            </div>

            <div className="text-xs text-slate-600 space-y-2">
              <p>Upload a standard CSV register. Column headers supported:</p>
              <code className="block bg-slate-100 p-2 rounded text-[11px] font-mono text-slate-800">
                client_code,application_no,applied_qty,allotted_qty,cost
              </code>
            </div>

            {csvResult && (
              <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-xs text-green-800">
                <p className="font-bold">Import Result:</p>
                <p>Imported: {csvResult.imported_count} records | Skipped: {csvResult.skipped_count}</p>
                {csvResult.errors?.length > 0 && (
                  <p className="text-red-600 mt-1">{csvResult.errors.join(', ')}</p>
                )}
              </div>
            )}

            <form onSubmit={handleCSVUpload} className="space-y-4">
              <input
                type="file"
                accept=".csv"
                required
                onChange={(e) => setCsvFile(e.target.files?.[0] || null)}
                className="w-full text-xs text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-brand-50 file:text-brand-700 hover:file:bg-brand-100"
              />

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsCSVModalOpen(false)}
                  className="px-3 py-1.5 border border-slate-300 rounded text-xs text-slate-700"
                >
                  Close
                </button>
                <button
                  type="submit"
                  className="px-3 py-1.5 bg-brand-600 hover:bg-brand-700 text-white rounded text-xs font-semibold"
                >
                  Upload & Sync
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Manual Allotment Entry Modal */}
      {isManualAllotmentOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-900">Add Manual Allotment ({selectedIPO?.symbol})</h3>
              <button onClick={() => setIsManualAllotmentOpen(false)} className="text-slate-400 hover:text-slate-600 text-lg">&times;</button>
            </div>

            <form onSubmit={handleCreateManualAllotment} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-700 font-medium mb-1">Select Account</label>
                <select
                  value={manualAllotForm.account_id}
                  onChange={(e) => setManualAllotForm({ ...manualAllotForm, account_id: Number(e.target.value) })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg outline-none bg-white"
                >
                  {accounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.nickname} ({acc.masked_client_code})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-medium mb-1">Allotted Quantity</label>
                  <input
                    type="number"
                    required
                    value={manualAllotForm.allotted_quantity}
                    onChange={(e) => setManualAllotForm({ ...manualAllotForm, allotted_quantity: Number(e.target.value) })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg outline-none num-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-medium mb-1">Issue Price / Cost (₹)</label>
                  <input
                    type="number"
                    step="0.05"
                    required
                    value={manualAllotForm.acquisition_cost}
                    onChange={(e) => setManualAllotForm({ ...manualAllotForm, acquisition_cost: Number(e.target.value) })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg outline-none num-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-700 font-medium mb-1">Application Number (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. APP-89472"
                  value={manualAllotForm.application_no}
                  onChange={(e) => setManualAllotForm({ ...manualAllotForm, application_no: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg outline-none font-mono"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsManualAllotmentOpen(false)}
                  className="px-3 py-1.5 border border-slate-300 rounded text-xs text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-3 py-1.5 bg-brand-600 hover:bg-brand-700 text-white rounded text-xs font-semibold"
                >
                  Save Allotment
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add IPO Modal */}
      {isAddIPOOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-lg p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900">Add New IPO</h3>
              <button onClick={() => setIsAddIPOOpen(false)} className="text-slate-400 hover:text-slate-600 text-lg">&times;</button>
            </div>

            <form onSubmit={handleCreateIPO} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-medium mb-1">Symbol (NSE/BSE)</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. NTPCGREEN"
                    value={ipoForm.symbol}
                    onChange={(e) => setIpoForm({ ...ipoForm, symbol: e.target.value.toUpperCase() })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg uppercase font-mono outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-medium mb-1">Exchange</label>
                  <select
                    value={ipoForm.exchange}
                    onChange={(e) => setIpoForm({ ...ipoForm, exchange: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white outline-none"
                  >
                    <option value="NSE">NSE</option>
                    <option value="BSE">BSE</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate-700 font-medium mb-1">Company Full Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. NTPC Green Energy Limited"
                  value={ipoForm.company_name}
                  onChange={(e) => setIpoForm({ ...ipoForm, company_name: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-medium mb-1">Issue Price (₹)</label>
                  <input
                    type="number"
                    step="0.05"
                    required
                    value={ipoForm.issue_price}
                    onChange={(e) => setIpoForm({ ...ipoForm, issue_price: Number(e.target.value) })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg outline-none num-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-medium mb-1">Lot Size</label>
                  <input
                    type="number"
                    required
                    value={ipoForm.lot_size}
                    onChange={(e) => setIpoForm({ ...ipoForm, lot_size: Number(e.target.value) })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg outline-none num-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-medium mb-1">ISIN Number</label>
                  <input
                    type="text"
                    placeholder="e.g. INE142M01025"
                    value={ipoForm.isin}
                    onChange={(e) => setIpoForm({ ...ipoForm, isin: e.target.value.toUpperCase() })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-medium mb-1">SmartAPI Symbol Token</label>
                  <input
                    type="text"
                    placeholder="e.g. 19326"
                    value={ipoForm.symbol_token}
                    onChange={(e) => setIpoForm({ ...ipoForm, symbol_token: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono outline-none"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  id="sme_check"
                  checked={ipoForm.is_sme}
                  onChange={(e) => setIpoForm({ ...ipoForm, is_sme: e.target.checked })}
                  className="w-4 h-4 text-brand-600 rounded"
                />
                <label htmlFor="sme_check" className="text-slate-700 font-medium cursor-pointer">
                  SME Platform Issue (Fixed lot size secondary trading)
                </label>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsAddIPOOpen(false)}
                  className="px-3 py-1.5 border border-slate-300 rounded text-xs text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-brand-600 hover:bg-brand-700 text-white rounded text-xs font-semibold"
                >
                  Save IPO
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
