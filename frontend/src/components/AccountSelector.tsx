import React, { useState, useMemo } from 'react';
import { Users, Search, Check, CheckSquare, Square, ChevronDown } from 'lucide-react';
import { Account } from '../types';

interface AccountSelectorProps {
  accounts: Account[];
  mode: 'single' | 'multi';
  selectedAccountId?: number; // for single mode
  selectedAccountIds?: number[]; // for multi mode
  onSelectAccount?: (id: number) => void; // single mode callback
  onToggleAccount?: (id: number) => void; // multi mode callback
  onSelectAll?: () => void;
  onClearAll?: () => void;
  label?: string;
  disabled?: boolean;
}

export const AccountSelector: React.FC<AccountSelectorProps> = ({
  accounts,
  mode,
  selectedAccountId,
  selectedAccountIds = [],
  onSelectAccount,
  onToggleAccount,
  onSelectAll,
  onClearAll,
  label,
  disabled = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');

  const filteredAccounts = useMemo(() => {
    return accounts.filter(
      (a) =>
        a.nickname.toLowerCase().includes(search.toLowerCase()) ||
        a.masked_client_code.toLowerCase().includes(search.toLowerCase()) ||
        a.account_group.toLowerCase().includes(search.toLowerCase())
    );
  }, [accounts, search]);

  const activeAccount = accounts.find((a) => a.id === selectedAccountId);

  return (
    <div className="relative inline-block text-left w-full sm:w-auto">
      {/* Header Scope Badge Button */}
      <button
        type="button"
        disabled={disabled || accounts.length === 0}
        onClick={() => setIsOpen(!isOpen)}
        className="w-full sm:w-auto px-3.5 py-2 bg-white border border-slate-200 hover:border-slate-300 rounded-lg shadow-2xs text-xs font-medium text-slate-800 flex items-center justify-between gap-3 transition-colors disabled:opacity-50"
      >
        <div className="flex items-center gap-2">
          <Users className="w-3.5 h-3.5 text-brand-600" />
          <span className="text-slate-500 font-normal">{label || 'Account Scope:'}</span>
          <span className="font-bold text-slate-900">
            {mode === 'single'
              ? activeAccount
                ? `${activeAccount.nickname} (${activeAccount.masked_client_code})`
                : 'Select Account'
              : selectedAccountIds.length === accounts.length && accounts.length > 0
              ? `All ${accounts.length} Accounts`
              : `${selectedAccountIds.length} of ${accounts.length} Selected`}
          </span>
        </div>
        <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setIsOpen(false)} />
          <div className="absolute right-0 sm:left-0 mt-1.5 w-72 sm:w-80 bg-white border border-slate-200 rounded-xl shadow-lg z-30 p-2.5 space-y-2">
            {/* Search Box */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
              <input
                type="text"
                placeholder="Search account name, code..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-8 pr-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-brand-500"
              />
            </div>

            {/* Multi-mode Quick Actions */}
            {mode === 'multi' && (
              <div className="flex items-center justify-between px-1 text-[11px] font-semibold text-brand-600 border-b border-slate-100 pb-1.5">
                <button
                  type="button"
                  onClick={() => {
                    onSelectAll && onSelectAll();
                  }}
                  className="hover:text-brand-800"
                >
                  Select All ({accounts.length})
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onClearAll && onClearAll();
                  }}
                  className="text-slate-400 hover:text-slate-600"
                >
                  Clear All
                </button>
              </div>
            )}

            {/* Accounts List */}
            <div className="max-h-56 overflow-y-auto divide-y divide-slate-100">
              {filteredAccounts.length === 0 ? (
                <div className="py-4 text-center text-xs text-slate-400">No matching accounts found</div>
              ) : (
                filteredAccounts.map((acc) => {
                  const isSelected =
                    mode === 'single'
                      ? selectedAccountId === acc.id
                      : selectedAccountIds.includes(acc.id);

                  return (
                    <div
                      key={acc.id}
                      onClick={() => {
                        if (mode === 'single') {
                          onSelectAccount && onSelectAccount(acc.id);
                          setIsOpen(false);
                        } else {
                          onToggleAccount && onToggleAccount(acc.id);
                        }
                      }}
                      className={`p-2 rounded-lg cursor-pointer flex items-center justify-between text-xs transition-colors ${
                        isSelected ? 'bg-brand-50/70 text-slate-900' : 'hover:bg-slate-50 text-slate-700'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {mode === 'multi' ? (
                          isSelected ? (
                            <CheckSquare className="w-4 h-4 text-brand-600 flex-shrink-0" />
                          ) : (
                            <Square className="w-4 h-4 text-slate-400 flex-shrink-0" />
                          )
                        ) : null}
                        <div className="truncate">
                          <div className="font-bold text-slate-900 truncate">{acc.nickname}</div>
                          <div className="text-[10px] text-slate-400 font-mono flex items-center gap-1.5">
                            <span>{acc.masked_client_code}</span>
                            <span>•</span>
                            <span>{acc.account_group}</span>
                          </div>
                        </div>
                      </div>

                      {mode === 'single' && isSelected && (
                        <Check className="w-4 h-4 text-brand-600 flex-shrink-0" />
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
