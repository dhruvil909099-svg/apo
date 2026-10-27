import React, { useState, useEffect } from 'react';
import {
  Bell, Shield, AlertTriangle, CheckCircle2,
  Filter, Clock, RefreshCw, Lock
} from 'lucide-react';
import { AuditLog } from '../types';
import { api } from '../api';

export const AlertsView: React.FC = () => {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [filterType, setFilterType] = useState<string>('ALL');
  const [isLoading, setIsLoading] = useState(true);

  const loadLogs = async () => {
    setIsLoading(true);
    try {
      const data = await api.getAuditLogs(100, 0, filterType !== 'ALL' ? filterType : undefined);
      setLogs(data);
    } catch (err: any) {
      console.error('Error loading audit logs:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadLogs();
  }, [filterType]);

  const eventFilters = [
    { id: 'ALL', label: 'All Events' },
    { id: 'PAPER_ORDER_EXECUTED', label: 'Executed Orders' },
    { id: 'BULK_ORDERS_EXECUTED', label: 'Bulk Orders' },
    { id: 'EMERGENCY_KILL_SWITCH_ACTIVATED', label: 'Kill Switch Alerts' },
    { id: 'ACCOUNT_CREATED', label: 'Account Events' },
  ];

  return (
    <div className="space-y-6">
      {/* Top Filter Ribbon */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg">
          {eventFilters.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilterType(f.id)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                filterType === f.id
                  ? 'bg-white text-slate-900 shadow-xs font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <button
          onClick={loadLogs}
          disabled={isLoading}
          className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          <span>Refresh Audit Stream</span>
        </button>
      </div>

      {/* Logs Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="text-center py-12 text-xs text-slate-400">Loading audit records...</div>
        ) : logs.length === 0 ? (
          <div className="text-center py-12 text-xs text-slate-400">
            No audit records match the selected filter.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider font-semibold border-b border-slate-200 text-[10px]">
                <tr>
                  <th className="py-3 px-4">Event Type</th>
                  <th className="py-3 px-4">Timestamp (IST)</th>
                  <th className="py-3 px-4">Operator</th>
                  <th className="py-3 px-4">Account ID</th>
                  <th className="py-3 px-4">Sanitized Event Details (No Secrets)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {logs.map((log) => {
                  const isHalt = log.event_type.includes('KILL_SWITCH');
                  const isExec = log.event_type.includes('EXECUTED');

                  return (
                    <tr key={log.id} className="tr-hover">
                      <td className="py-3 px-4">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          isHalt
                            ? 'bg-red-100 text-red-800 border border-red-300'
                            : isExec
                            ? 'bg-finGreen-bg text-finGreen-text border border-finGreen-border'
                            : 'bg-slate-100 text-slate-700 border border-slate-200'
                        }`}>
                          {log.event_type}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-500 text-[11px]">
                        {new Date(log.timestamp).toLocaleString('en-IN', { hour12: false })}
                      </td>
                      <td className="py-3 px-4 font-semibold text-slate-800">{log.operator}</td>
                      <td className="py-3 px-4 text-slate-500">{log.account_id ? `#${log.account_id}` : 'Global'}</td>
                      <td className="py-3 px-4 font-mono text-[11px] text-slate-600 max-w-xl truncate">
                        {JSON.stringify(log.details)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
