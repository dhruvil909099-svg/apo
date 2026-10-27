import React, { useState, useEffect } from 'react';
import {
  User, CheckCircle2, AlertCircle, RefreshCw,
  Shield, Layers, TrendingUp, Download, KeyRound,
  FileSpreadsheet, ArrowRight
} from 'lucide-react';
import { Account, Allotment, IPO } from '../types';
import { AccountSelector } from '../components/AccountSelector';
import { api } from '../api';

interface SingleAccountTasksViewProps {
  accounts: Account[];
  ipos: IPO[];
  onRefresh: () => void;
}

export const SingleAccountTasksView: React.FC<SingleAccountTasksViewProps> = ({
  accounts,
  ipos,
  onRefresh
}) => {
  const [selectedAccountId, setSelectedAccountId] = useState<number>(
    accounts[0]?.id || 0
  );
  const [isProcessing, setIsProcessing] = useState(false);
  const [taskStatus, setTaskStatus] = useState<{
    type: 'success' | 'error' | 'info';
    message: string;
    details?: string;
  } | null>(null);

  const [activeTab, setActiveTab] = useState<'holdings' | 'ipos' | 'overview'>('overview');
  const [accountAllotments, setAccountAllotments] = useState<Allotment[]>([]);
  const [isLoadingAllotments, setIsLoadingAllotments] = useState(false);

  const selectedAccount = accounts.find((a) => a.id === selectedAccountId);

  // Sync state if accounts change
  useEffect(() => {
    if (accounts.length > 0 && !selectedAccountId) {
      setSelectedAccountId(accounts[0].id);
    }
  }, [accounts, selectedAccountId]);

  // Load account's specific allotments
  useEffect(() => {
    if (!selectedAccountId) return;
    const fetchAccountData = async () => {
      setIsLoadingAllotments(true);
      try {
        // Query allotments across all IPOs for this account
        const allAllotments: Allotment[] = [];
        for (const ipo of ipos) {
          try {
            const allotList = await api.getIPOAllotments(ipo.id);
            const forAcc = allotList.filter(a => a.account_id === selectedAccountId);
            allAllotments.push(...forAcc);
          } catch {
            // ignore
          }
        }
        setAccountAllotments(allAllotments);
      } catch (err) {
        console.error('Error fetching account allotments:', err);
      } finally {
        setIsLoadingAllotments(false);
      }
    };
    fetchAccountData();
  }, [selectedAccountId, ipos]);

  // Task Actions
  const handleTestAuth = async () => {
    if (!selectedAccount) return;
    setIsProcessing(true);
    setTaskStatus(null);
    try {
      const res = await api.testAccount(selectedAccount.id);
      if (res.success) {
        setTaskStatus({
          type: 'success',
          message: `Authentication Successful for ${selectedAccount.nickname}`,
          details: `SmartAPI session verified. DDPI Status: ${res.ddpi_status || 'ACTIVE'}.`
        });
      } else {
        setTaskStatus({
          type: 'error',
          message: `Authentication Failed: ${res.message}`,
          details: 'Please check your registered MPIN, TOTP secret, and API key.'
        });
      }
      onRefresh();
    } catch (err: any) {
      setTaskStatus({
        type: 'error',
        message: 'Network / Server Error',
        details: err.message
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSyncHoldings = async () => {
    if (!selectedAccount) return;
    setIsProcessing(true);
    setTaskStatus(null);
    try {
      const res = await api.syncPortfolio();
      setTaskStatus({
        type: 'success',
        message: `Holdings Synchronized for ${selectedAccount.nickname}`,
        details: `Last sync completed at ${res.timestamp}. Demat ledger refreshed.`
      });
      onRefresh();
    } catch (err: any) {
      setTaskStatus({
        type: 'error',
        message: 'Sync Failed',
        details: err.message
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleExportAccountHoldings = () => {
    if (!selectedAccount || accountAllotments.length === 0) return;
    const headers = ['Symbol', 'Application No', 'Allotted Qty', 'Acquisition Cost', 'LTP', 'Market Value', 'Unrealized PnL'];
    const rows = accountAllotments.map(a => [
      a.ipo_symbol,
      a.application_no || '—',
      a.allotted_quantity,
      a.acquisition_cost.toFixed(2),
      (a.current_ltp || 0).toFixed(2),
      a.market_value.toFixed(2),
      a.unrealized_pnl.toFixed(2)
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `${selectedAccount.nickname}_Holdings_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (accounts.length === 0) {
    return (
      <div className="bg-white p-12 rounded-xl border border-slate-200 text-center space-y-3">
        <User className="w-10 h-10 text-slate-300 mx-auto" />
        <h3 className="text-sm font-bold text-slate-800">No Connected Accounts Found</h3>
        <p className="text-xs text-slate-500 max-w-sm mx-auto">
          Please register at least one Angel One broker account in the Accounts tab to perform single-account operations.
        </p>
      </div>
    );
  }

  const isConnected = selectedAccount?.auth_status === 'CONNECTED';

  return (
    <div className="space-y-6">
      {/* Top Header & Account Scope Selector */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold text-slate-900">Single Account Operations</h1>
              <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-brand-50 text-brand-700 border border-brand-200">
                Focused Mode
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Perform isolated tasks on one specific Demat account without affecting other family members.
            </p>
          </div>

          {/* Account Selector Restricted strictly to Single Mode */}
          <div className="flex items-center gap-2">
            <AccountSelector
              accounts={accounts}
              mode="single"
              selectedAccountId={selectedAccountId}
              onSelectAccount={(id) => {
                setSelectedAccountId(id);
                setTaskStatus(null);
              }}
              label="Selected Account:"
            />
          </div>
        </div>

        {/* Selected Account Profile Bar */}
        {selectedAccount && (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 pt-4 border-t border-slate-100 text-xs">
            <div>
              <span className="text-slate-400 text-[11px]">Nickname:</span>
              <div className="font-bold text-slate-900 mt-0.5">{selectedAccount.nickname}</div>
            </div>
            <div>
              <span className="text-slate-400 text-[11px]">Masked Client Code:</span>
              <div className="font-mono font-bold text-slate-800 mt-0.5">{selectedAccount.masked_client_code}</div>
            </div>
            <div>
              <span className="text-slate-400 text-[11px]">Connection Status:</span>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
                <span className={`font-bold ${isConnected ? 'text-emerald-700' : 'text-rose-600'}`}>
                  {selectedAccount.auth_status}
                </span>
              </div>
            </div>
            <div>
              <span className="text-slate-400 text-[11px]">Depository DDPI:</span>
              <div className={`font-semibold mt-0.5 ${selectedAccount.ddpi_status === 'ACTIVE' ? 'text-blue-600' : 'text-amber-600'}`}>
                DDPI {selectedAccount.ddpi_status}
              </div>
            </div>
            <div>
              <span className="text-slate-400 text-[11px]">Available Cash Margin:</span>
              <div className="font-bold text-slate-900 num-mono mt-0.5">
                ₹{selectedAccount.available_cash.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Operation Feedback Alert */}
      {taskStatus && (
        <div
          className={`p-4 rounded-xl border flex items-start gap-3 text-xs ${
            taskStatus.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : taskStatus.type === 'error'
              ? 'bg-rose-50 border-rose-200 text-rose-800'
              : 'bg-blue-50 border-blue-200 text-blue-800'
          }`}
        >
          {taskStatus.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 flex-shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-rose-600 mt-0.5 flex-shrink-0" />
          )}
          <div>
            <div className="font-bold">{taskStatus.message}</div>
            {taskStatus.details && <div className="mt-0.5 text-slate-600 font-medium">{taskStatus.details}</div>}
          </div>
        </div>
      )}

      {/* Grouped Task Action Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Card 1: Account & Auth Tasks */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
            <KeyRound className="w-4 h-4 text-brand-600" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900">Account & Security</h3>
          </div>
          <p className="text-xs text-slate-500">
            Test TOTP token generation, verify Angel One session token, and validate depository permissions.
          </p>

          <div className="space-y-2 pt-2">
            <button
              onClick={handleTestAuth}
              disabled={isProcessing}
              className="w-full py-2 px-3 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold flex items-center justify-between transition-colors disabled:opacity-50"
            >
              <div className="flex items-center gap-2">
                <Shield className="w-3.5 h-3.5 text-emerald-400" />
                <span>Test SmartAPI Session</span>
              </div>
              <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
            </button>

            <button
              onClick={handleSyncHoldings}
              disabled={isProcessing}
              className="w-full py-2 px-3 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-semibold flex items-center justify-between transition-colors disabled:opacity-50"
            >
              <div className="flex items-center gap-2">
                <RefreshCw className={`w-3.5 h-3.5 text-brand-600 ${isProcessing ? 'animate-spin' : ''}`} />
                <span>Sync Account Demat Holdings</span>
              </div>
              <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
            </button>
          </div>
        </div>

        {/* Card 2: Holdings & Portfolio Tasks */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
            <Layers className="w-4 h-4 text-emerald-600" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900">Portfolio & Positions</h3>
          </div>
          <p className="text-xs text-slate-500">
            Inspect all credited IPO shares, calculate unrealized mark-to-market return, and review quantities.
          </p>

          <div className="space-y-2 pt-2">
            <button
              onClick={() => setActiveTab('holdings')}
              className={`w-full py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-between transition-colors ${
                activeTab === 'holdings'
                  ? 'bg-brand-600 text-white shadow-xs'
                  : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              <span>View Account Holdings ({accountAllotments.length})</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>

            <button
              onClick={handleExportAccountHoldings}
              disabled={accountAllotments.length === 0}
              className="w-full py-2 px-3 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-semibold flex items-center justify-between transition-colors disabled:opacity-50"
            >
              <div className="flex items-center gap-2">
                <Download className="w-3.5 h-3.5 text-slate-500" />
                <span>Export Holdings CSV</span>
              </div>
              <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
            </button>
          </div>
        </div>

        {/* Card 3: IPO Application Tasks */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
            <TrendingUp className="w-4 h-4 text-purple-600" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900">IPO Applications</h3>
          </div>
          <p className="text-xs text-slate-500">
            Check application records, allotment category (Retail / HNI), and confirmed allotment lot counts.
          </p>

          <div className="space-y-2 pt-2">
            <button
              onClick={() => setActiveTab('ipos')}
              className={`w-full py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-between transition-colors ${
                activeTab === 'ipos'
                  ? 'bg-brand-600 text-white shadow-xs'
                  : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              <span>Review IPO Allotments ({accountAllotments.length})</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Account Data Table View (Holdings or IPO Allotments) */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
            {activeTab === 'holdings' ? 'Active Demat Holdings' : 'IPO Allotment History'} — {selectedAccount?.nickname}
          </h3>
          <span className="text-[11px] text-slate-500 font-medium">
            {accountAllotments.length} Record{accountAllotments.length === 1 ? '' : 's'}
          </span>
        </div>

        {isLoadingAllotments ? (
          <div className="py-12 text-center text-xs text-slate-400">Loading account records...</div>
        ) : accountAllotments.length === 0 ? (
          <div className="py-12 text-center text-xs text-slate-400">
            No holdings or IPO records found for this account.
          </div>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase text-slate-500 border-b border-slate-100 font-semibold">
              <tr>
                <th className="py-3 px-4">Symbol / Stock</th>
                <th className="py-3 px-3">Application No</th>
                <th className="py-3 px-3 text-right">Quantity</th>
                <th className="py-3 px-3 text-right">Acquisition Cost</th>
                <th className="py-3 px-3 text-right">Current LTP</th>
                <th className="py-3 px-4 text-right">Market Value</th>
                <th className="py-3 px-4 text-right">Unrealized P&L</th>
                <th className="py-3 px-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {accountAllotments.map((item) => {
                const isPositive = item.unrealized_pnl >= 0;
                return (
                  <tr key={item.id} className="hover:bg-slate-50/70">
                    <td className="py-3 px-4 font-bold text-slate-900">{item.ipo_symbol}</td>
                    <td className="py-3 px-3 font-mono text-slate-500">{item.application_no || '—'}</td>
                    <td className="py-3 px-3 num-mono font-bold text-slate-900 text-right">{item.allotted_quantity}</td>
                    <td className="py-3 px-3 num-mono text-slate-700 text-right">₹{item.acquisition_cost.toFixed(2)}</td>
                    <td className="py-3 px-3 num-mono font-bold text-slate-900 text-right">₹{(item.current_ltp || 0).toFixed(2)}</td>
                    <td className="py-3 px-4 num-mono font-bold text-slate-900 text-right">
                      ₹{item.market_value.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className={`font-bold num-mono ${isPositive ? 'text-finGreen' : 'text-finRed'}`}>
                        {isPositive ? '+' : ''}₹{item.unrealized_pnl.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </div>
                      <div className={`text-[10px] font-bold num-mono ${isPositive ? 'text-finGreen' : 'text-finRed'}`}>
                        {isPositive ? '+' : ''}{item.pnl_percentage.toFixed(2)}%
                      </div>
                    </td>
                    <td className="py-3 px-3 text-center">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        {item.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
