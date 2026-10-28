import React, { useState } from 'react';
import {
  Users, Plus, RefreshCw, CheckCircle2, AlertTriangle,
  Lock, Trash2, Power, Search, ShieldCheck
} from 'lucide-react';
import { Account, AccountCreatePayload } from '../types';
import { api } from '../api';

interface AccountsViewProps {
  accounts: Account[];
  onRefresh: () => void;
}

export const AccountsView: React.FC<AccountsViewProps> = ({ accounts, onRefresh }) => {
  const [selectedGroup, setSelectedGroup] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isAddModalOpen, setIsAddModalOpen] = useState<boolean>(false);
  const [testingAccountId, setTestingAccountId] = useState<number | null>(null);
  const [testResult, setTestResult] = useState<{ id: number; success: boolean; msg: string } | null>(null);

  // Form State
  const [formData, setFormData] = useState<AccountCreatePayload>({
    nickname: '',
    client_code: '',
    account_group: 'Family',
    api_key: '',
    pin: '',
    totp_secret: '',
    is_demo: false,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const groups = ['All', 'Family', 'Friends', 'Demo Pool'];

  const filteredAccounts = accounts.filter((acc) => {
    const matchesGroup = selectedGroup === 'All' || acc.account_group === selectedGroup;
    const matchesSearch =
      acc.nickname.toLowerCase().includes(searchQuery.toLowerCase()) ||
      acc.masked_client_code.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesGroup && matchesSearch;
  });

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setFormError(null);
    try {
      await api.createAccount(formData);
      setIsAddModalOpen(false);
      setFormData({
        nickname: '',
        client_code: '',
        account_group: 'Family',
        api_key: '',
        pin: '',
        totp_secret: '',
        is_demo: false,
      });
      onRefresh();
    } catch (err: any) {
      setFormError(err.message || 'Failed to create account.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleTestConnection = async (accId: number) => {
    setTestingAccountId(accId);
    setTestResult(null);
    try {
      const res = await api.testAccount(accId);
      setTestResult({ id: accId, success: res.success, msg: res.message });
      onRefresh();
    } catch (err: any) {
      setTestResult({ id: accId, success: false, msg: err.message });
    } finally {
      setTestingAccountId(null);
    }
  };

  const handleToggleEnable = async (acc: Account) => {
    try {
      await api.updateAccount(acc.id, { is_enabled: !acc.is_enabled });
      onRefresh();
    } catch (err: any) {
      alert(`Error toggling account: ${err.message}`);
    }
  };

  const handleDelete = async (id: number) => {
    if (confirm('Are you sure you want to remove this account connection?')) {
      try {
        await api.deleteAccount(id);
        onRefresh();
      } catch (err: any) {
        alert(`Error deleting account: ${err.message}`);
      }
    }
  };

  const handleBatchDemo = async () => {
    if (confirm('Generate 10 synthetic demo accounts for bulk operation stress testing?')) {
      try {
        await api.batchCreateDemoAccounts(10);
        onRefresh();
      } catch (err: any) {
        alert(err.message);
      }
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Controls Bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
        {/* Search & Groups */}
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <div className="relative w-full sm:w-64">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Search by nickname or code..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>

          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg">
            {groups.map((g) => (
              <button
                key={g}
                onClick={() => setSelectedGroup(g)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  selectedGroup === g
                    ? 'bg-white text-slate-900 shadow-xs font-bold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {g}
              </button>
            ))}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
          <button
            onClick={handleBatchDemo}
            className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold border border-slate-300 transition-colors"
          >
            +10 Demo Accounts (Stress Test)
          </button>
          <button
            onClick={() => setIsAddModalOpen(true)}
            className="px-3.5 py-1.5 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-xs font-semibold shadow-sm transition-colors flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            <span>Connect Account</span>
          </button>
        </div>
      </div>

      {/* Accounts Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider font-semibold border-b border-slate-200 text-[10px]">
              <tr>
                <th className="py-3 px-4">Nickname</th>
                <th className="py-3 px-4">Masked Client ID</th>
                <th className="py-3 px-4">Group</th>
                <th className="py-3 px-4">Connection Status</th>
                <th className="py-3 px-4">DDPI / eDIS Status</th>
                <th className="py-3 px-4">Available Cash</th>
                <th className="py-3 px-4">Last Sync</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredAccounts.map((acc) => {
                const isTesting = testingAccountId === acc.id;
                const result = testResult?.id === acc.id ? testResult : null;

                return (
                  <tr key={acc.id} className="tr-hover">
                    <td className="py-3 px-4 font-semibold text-slate-900">
                      <div className="flex items-center gap-2">
                        <span>{acc.nickname}</span>
                        {acc.is_demo && (
                          <span className="text-[9px] bg-amber-100 text-amber-800 font-bold px-1.5 py-0.2 rounded border border-amber-200">
                            DEMO
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-600 font-medium">
                      {acc.masked_client_code}
                    </td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-700">
                        {acc.account_group}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        acc.auth_status === 'CONNECTED'
                          ? 'bg-finGreen-bg text-finGreen-text border border-finGreen-border'
                          : acc.auth_status === 'ERROR'
                          ? 'bg-finRed-bg text-finRed-text border border-finRed-border'
                          : 'bg-slate-100 text-slate-600'
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${
                          acc.auth_status === 'CONNECTED' ? 'bg-finGreen' : 'bg-red-500'
                        }`} />
                        {acc.auth_status}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={async () => {
                            const nextStatus = acc.ddpi_status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
                            try {
                              await api.updateAccount(acc.id, { ddpi_status: nextStatus });
                              onRefresh();
                            } catch (e: any) {
                              alert(`Could not update DDPI status: ${e.message}`);
                            }
                          }}
                          title="Click to toggle DDPI Status (ACTIVE / INACTIVE)"
                          className={`px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer transition-colors ${
                            acc.ddpi_status === 'ACTIVE'
                              ? 'bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100'
                              : 'bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100'
                          }`}
                        >
                          DDPI: {acc.ddpi_status}
                        </button>
                        {acc.ddpi_status !== 'ACTIVE' && (
                          <span className={`text-[9px] px-1 py-0.5 rounded ${
                            acc.edis_authorized_today ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-500'
                          }`}>
                            {acc.edis_authorized_today ? 'eDIS OK' : 'TPIN Req.'}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4 num-mono font-medium text-slate-800">
                      ₹{acc.available_cash.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-3 px-4 text-slate-400 text-[11px]">
                      {acc.last_sync_time
                        ? new Date(acc.last_sync_time).toLocaleTimeString('en-IN', { hour12: false })
                        : '—'}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => handleTestConnection(acc.id)}
                          disabled={isTesting}
                          className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-[11px] font-medium transition-colors flex items-center gap-1 disabled:opacity-50"
                          title="Test SmartAPI Authentication"
                        >
                          <RefreshCw className={`w-3 h-3 ${isTesting ? 'animate-spin' : ''}`} />
                          <span>Test</span>
                        </button>
                        <button
                          onClick={() => handleToggleEnable(acc)}
                          className={`p-1 rounded transition-colors ${
                            acc.is_enabled ? 'text-finGreen hover:bg-finGreen-bg' : 'text-slate-400 hover:bg-slate-100'
                          }`}
                          title={acc.is_enabled ? 'Disable Account' : 'Enable Account'}
                        >
                          <Power className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(acc.id)}
                          className="p-1 rounded text-slate-400 hover:text-finRed hover:bg-finRed-bg transition-colors"
                          title="Delete Connection"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      {result && (
                        <div className={`text-[10px] mt-1 ${result.success ? 'text-finGreen' : 'text-finRed'}`}>
                          {result.msg}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Account Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-lg p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900 tracking-tight">Connect Angel One Demat Account</h3>
                <p className="text-xs text-slate-500">Each account requires its own SmartAPI developer credentials</p>
              </div>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-lg leading-none"
              >
                &times;
              </button>
            </div>

            {/* Security Notice */}
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg flex items-start gap-2.5 text-xs text-blue-900">
              <ShieldCheck className="w-4 h-4 text-brand-600 flex-shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold">Zero-Plaintext Security:</span> Credentials are encrypted at rest using AES-256-GCM. Raw PINs and TOTP keys are never sent to or visible in the frontend.
              </div>
            </div>

            {formError && (
              <div className="p-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
                {formError}
              </div>
            )}

            <form onSubmit={handleCreateAccount} className="space-y-3.5 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-medium mb-1">Account Nickname</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Dad Retirement Demat"
                    value={formData.nickname}
                    onChange={(e) => setFormData({ ...formData, nickname: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-1 focus:ring-brand-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-medium mb-1">Client Code</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. A123456"
                    value={formData.client_code}
                    onChange={(e) => setFormData({ ...formData, client_code: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-1 focus:ring-brand-500 outline-none uppercase font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-medium mb-1">Account Group</label>
                  <select
                    value={formData.account_group}
                    onChange={(e) => setFormData({ ...formData, account_group: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-1 focus:ring-brand-500 outline-none bg-white"
                  >
                    <option value="Family">Family</option>
                    <option value="Friends">Friends</option>
                    <option value="Demo Pool">Demo Pool</option>
                    <option value="Custom">Custom</option>
                  </select>
                </div>
                <div className="flex items-center gap-2 pt-6">
                  <input
                    type="checkbox"
                    id="is_demo_chk"
                    checked={formData.is_demo}
                    onChange={(e) => setFormData({ ...formData, is_demo: e.target.checked })}
                    className="w-4 h-4 text-brand-600 rounded"
                  />
                  <label htmlFor="is_demo_chk" className="text-slate-700 font-medium cursor-pointer">
                    Demo / Paper Trading Account
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-slate-700 font-medium mb-1">SmartAPI API Key</label>
                <input
                  type="text"
                  required
                  placeholder="Application API Key from SmartAPI portal"
                  value={formData.api_key}
                  onChange={(e) => setFormData({ ...formData, api_key: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-1 focus:ring-brand-500 outline-none font-mono"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-medium mb-1">Account PIN / Password</label>
                  <input
                    type="password"
                    required
                    placeholder="4-digit PIN"
                    value={formData.pin}
                    onChange={(e) => setFormData({ ...formData, pin: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-1 focus:ring-brand-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-medium mb-1">TOTP Secret String</label>
                  <input
                    type="text"
                    required
                    placeholder="Base32 key from QR code"
                    value={formData.totp_secret}
                    onChange={(e) => setFormData({ ...formData, totp_secret: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-1 focus:ring-brand-500 outline-none font-mono"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-lg font-semibold shadow-sm transition-colors disabled:opacity-50"
                >
                  {isSubmitting ? 'Saving Encrypted Profile...' : 'Save & Authorize'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
