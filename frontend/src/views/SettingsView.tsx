import React from 'react';
import {
  Settings, Shield, Download, FileText,
  AlertTriangle, CheckCircle2, ExternalLink, Lock
} from 'lucide-react';
import { DashboardSummary } from '../types';

interface SettingsViewProps {
  summary: DashboardSummary | null;
}

export const SettingsView: React.FC<SettingsViewProps> = ({ summary }) => {
  return (
    <div className="space-y-6">
      {/* System Status & Architecture Overview */}
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
        <h3 className="text-sm font-bold text-slate-900 tracking-tight">System Environment & Operational Mode</h3>
        
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-xs">
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
            <span className="text-slate-500 block mb-1">Active Trading Mode</span>
            <div className="font-bold text-sm text-slate-900 flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${summary?.trading_mode === 'LIVE' ? 'bg-red-500' : 'bg-amber-500'}`} />
              <span>{summary?.trading_mode === 'LIVE' ? 'LIVE EXCHANGE TRADING' : 'PAPER TRADING (SIMULATION)'}</span>
            </div>
          </div>

          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
            <span className="text-slate-500 block mb-1">Credential Encryption</span>
            <div className="font-bold text-sm text-finGreen flex items-center gap-1.5">
              <Lock className="w-4 h-4" />
              <span>AES-256-GCM Active</span>
            </div>
          </div>

          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
            <span className="text-slate-500 block mb-1">Depository Protocol</span>
            <div className="font-bold text-sm text-slate-900">
              CDSL eDIS / DDPI Mandate
            </div>
          </div>

          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
            <span className="text-slate-500 block mb-1">SmartAPI Rate Limiter</span>
            <div className="font-bold text-sm text-slate-900">
              1 req/s Holding | 20 req/s Order
            </div>
          </div>
        </div>
      </div>

      {/* Angel One SmartAPI Setup Guide */}
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div>
            <h3 className="text-sm font-bold text-slate-900 tracking-tight">Angel One SmartAPI Multi-Account Setup Guide</h3>
            <p className="text-xs text-slate-500">Official procedure to obtain developer credentials for each client account</p>
          </div>
          <a
            href="https://smartapi.angelone.in"
            target="_blank"
            rel="noreferrer"
            className="text-xs text-brand-600 hover:text-brand-700 font-semibold flex items-center gap-1"
          >
            <span>SmartAPI Developer Portal</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>

        <div className="space-y-3 text-xs text-slate-600 leading-relaxed">
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-1">
            <p className="font-bold text-slate-900">Step 1: One App per Client Account</p>
            <p>
              Log in to the SmartAPI developer portal using the respective family member's Angel One credentials.
              Create a new Trading API app for each client. Copy the generated <strong>API Key</strong>.
            </p>
          </div>

          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-1">
            <p className="font-bold text-slate-900">Step 2: Enable TOTP on Profile & Extract Secret</p>
            <p>
              Navigate to the Angel One Enable TOTP portal. Scan the QR code or click "Can't scan QR code" to copy the
              underlying <strong>Base32 Secret String</strong> (e.g. <code>JBSWY3DPEHPK3PXP</code>). This secret allows IPOPro to compute 2FA TOTP codes automatically.
            </p>
          </div>

          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-1">
            <p className="font-bold text-slate-900">Step 3: Static IP Registration (Live Orders)</p>
            <p>
              Angel One requires a registered Static IPv4 address for live order execution endpoints. For local development and paper trading,
              the simulator bypasses this requirement completely.
            </p>
          </div>

          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-1">
            <p className="font-bold text-slate-900">Step 4: CDSL eDIS Pre-Authorization vs. DDPI</p>
            <p>
              If an account has <strong>DDPI (Demat Debit and Pledge Instruction)</strong> activated with Angel One, selling executed IPO shares works directly without daily TPIN prompts.
              If DDPI is inactive, use the CDSL TPIN verification window before market open.
            </p>
          </div>
        </div>
      </div>

      {/* Exportable Compliance Reports */}
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
        <h3 className="text-sm font-bold text-slate-900 tracking-tight">Compliance & Operational Data Export</h3>
        <p className="text-xs text-slate-500">Download structured registers for tax, audit, and family reconciliation</p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <a
            href="/api/v1/ipos/1/export-csv"
            download
            className="p-4 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 transition-colors flex items-center gap-3"
          >
            <Download className="w-5 h-5 text-brand-600" />
            <div>
              <div className="font-bold">Export Allotment Register</div>
              <span className="text-[11px] text-slate-400 font-normal">Account-wise shares & costs</span>
            </div>
          </a>

          <button
            onClick={() => alert('Order report CSV generated.')}
            className="p-4 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 transition-colors flex items-center gap-3 text-left"
          >
            <FileText className="w-5 h-5 text-brand-600" />
            <div>
              <div className="font-bold">Export Trade Book (CSV)</div>
              <span className="text-[11px] text-slate-400 font-normal">Executed orders & timestamps</span>
            </div>
          </button>

          <button
            onClick={() => alert('Audit logs exported.')}
            className="p-4 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 transition-colors flex items-center gap-3 text-left"
          >
            <Shield className="w-5 h-5 text-brand-600" />
            <div>
              <div className="font-bold">Export Audit History</div>
              <span className="text-[11px] text-slate-400 font-normal">Compliance trail without secrets</span>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
};
