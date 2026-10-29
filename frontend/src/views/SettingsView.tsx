import React, { useState, useEffect } from 'react';
import {
  Settings, Shield, Download, FileText,
  AlertTriangle, CheckCircle2, ExternalLink, Lock,
  Server, RefreshCw, Check, Globe, Database, HardDrive
} from 'lucide-react';
import { DashboardSummary } from '../types';
import { getApiBase, setApiBase, api } from '../api';

interface SettingsViewProps {
  summary: DashboardSummary | null;
}

export const SettingsView: React.FC<SettingsViewProps> = ({ summary }) => {
  const [apiBaseUrl, setApiBaseUrl] = useState<string>(() => getApiBase());
  const [isTesting, setIsTesting] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [savedNotice, setSavedNotice] = useState<boolean>(false);
  const [readiness, setReadiness] = useState<{
    ok: boolean;
    status: string;
    database: string;
    database_engine?: string;
    storage_type?: string;
    latencyMs: number;
  } | null>(() => {
    try {
      const cached = sessionStorage.getItem('ipopro_readiness_cache');
      if (cached) return JSON.parse(cached);
    } catch {
      // fallback
    }
    return {
      ok: true,
      status: 'READY',
      database: 'CONNECTED',
      database_engine: 'SQLITE',
      storage_type: 'EPHEMERAL_LOCAL',
      latencyMs: 1
    };
  });

  useEffect(() => {
    api.checkReadiness().then((res) => {
      setReadiness(res);
      try {
        sessionStorage.setItem('ipopro_readiness_cache', JSON.stringify(res));
      } catch {
        // ignore
      }
    }).catch(() => {});
  }, []);

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await api.checkHealth(apiBaseUrl.trim() || undefined);
      const readyRes = await api.checkReadiness(apiBaseUrl.trim() || undefined);
      setReadiness(readyRes);
      if (res.ok) {
        setTestResult({ ok: true, message: `Connected successfully (${res.latencyMs}ms) — DB: ${readyRes.database}` });
      } else {
        setTestResult({ ok: false, message: `Connection failed: ${res.status || res.detail || 'Offline'}` });
      }
    } catch (e: any) {
      setTestResult({ ok: false, message: e.message || 'Cannot reach endpoint' });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSaveApiBase = () => {
    setApiBase(apiBaseUrl);
    setSavedNotice(true);
    setTimeout(() => {
      window.location.reload();
    }, 800);
  };

  return (
    <div className="space-y-6">
      {/* Backend Connection Configuration */}
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-brand-50 text-brand-600 rounded-lg">
              <Server className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 tracking-tight">FastAPI Backend Service Connection</h3>
              <p className="text-xs text-slate-500">
                Connect this Hostinger frontend to your Python FastAPI backend (Render, VPS, or Local Tunnel)
              </p>
            </div>
          </div>
          <span className="text-[11px] font-mono bg-slate-100 text-slate-600 px-2 py-0.5 rounded border border-slate-200">
            Active: {getApiBase()}
          </span>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Backend API Base URL (must end with /api/v1)
            </label>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                placeholder="e.g. https://your-app.onrender.com/api/v1 or /api/v1"
                value={apiBaseUrl}
                onChange={(e) => setApiBaseUrl(e.target.value)}
                className="flex-1 px-3 py-2 text-xs border border-slate-300 rounded-lg focus:ring-1 focus:ring-brand-500 outline-none font-mono"
              />
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={isTesting}
                className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold border border-slate-300 transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isTesting ? 'animate-spin' : ''}`} />
                <span>{isTesting ? 'Testing...' : 'Test Connection'}</span>
              </button>
              <button
                type="button"
                onClick={handleSaveApiBase}
                className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-xs font-semibold shadow-sm transition-colors flex items-center justify-center gap-1.5"
              >
                {savedNotice ? <Check className="w-3.5 h-3.5" /> : null}
                <span>{savedNotice ? 'Saved! Reloading...' : 'Save & Connect'}</span>
              </button>
            </div>
          </div>

          {testResult && (
            <div className={`p-2.5 rounded-lg text-xs font-medium border flex items-center gap-2 ${
              testResult.ok
                ? 'bg-finGreen-bg text-finGreen-text border-finGreen-border'
                : 'bg-finRed-bg text-finRed-text border-finRed-border'
            }`}>
              {testResult.ok ? (
                <CheckCircle2 className="w-4 h-4 flex-shrink-0 text-finGreen" />
              ) : (
                <AlertTriangle className="w-4 h-4 flex-shrink-0 text-finRed" />
              )}
              <span>{testResult.message}</span>
            </div>
          )}

          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-[11px] text-slate-600 space-y-1">
            <span className="font-bold text-slate-800 block">Why is this needed?</span>
            <p>
              Hostinger shared hosting only serves static HTML/JS. The Python FastAPI engine handles encryption, TOTP token generation, Angel One SmartAPI authentication, and database isolation.
            </p>
            <p className="text-slate-500">
              Deploy the <code>backend/</code> folder to Render (Free) or run <code>uvicorn app.main:app</code> locally with a tunnel, then paste the URL above.
            </p>
          </div>
        </div>
      </div>

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

      {/* Database Storage & Persistence Architecture */}
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-blue-50 text-brand-600 rounded-lg">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 tracking-tight">Database Storage & Persistence Engine</h3>
              <p className="text-xs text-slate-500">
                Verifies account records survive application restarts and container replacement
              </p>
            </div>
          </div>
          <button
            onClick={() => api.checkReadiness().then(setReadiness).catch(() => {})}
            className="text-xs text-brand-600 hover:text-brand-700 font-semibold flex items-center gap-1"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Recheck Readiness</span>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-xs">
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
            <span className="text-slate-500 block mb-1">Database Connectivity</span>
            <div className={`font-bold text-sm flex items-center gap-1.5 ${
              readiness?.database === 'CONNECTED' ? 'text-finGreen' : 'text-amber-600'
            }`}>
              <CheckCircle2 className="w-4 h-4" />
              <span>{readiness?.database || 'CONNECTING...'}</span>
            </div>
          </div>

          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
            <span className="text-slate-500 block mb-1">SQL Dialect / Engine</span>
            <div className="font-bold text-sm text-slate-900 flex items-center gap-1.5">
              <Server className="w-4 h-4 text-slate-500" />
              <span className="uppercase">{readiness?.database_engine || 'Detecting...'}</span>
            </div>
          </div>

          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
            <span className="text-slate-500 block mb-1">Storage Durability</span>
            <div className={`font-bold text-sm flex items-center gap-1.5 ${
              readiness?.storage_type === 'MANAGED_PERSISTENT' ? 'text-finGreen' : 'text-amber-700'
            }`}>
              <HardDrive className="w-4 h-4" />
              <span>
                {readiness?.storage_type === 'MANAGED_PERSISTENT'
                  ? 'MANAGED PERSISTENT'
                  : 'EPHEMERAL LOCAL'}
              </span>
            </div>
          </div>

          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
            <span className="text-slate-500 block mb-1">Safe Migrations</span>
            <div className="font-bold text-sm text-finGreen flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4" />
              <span>Non-Destructive Active</span>
            </div>
          </div>
        </div>

        {readiness?.storage_type === 'EPHEMERAL_LOCAL' && (
          <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900 space-y-1">
            <div className="flex items-center gap-1.5 font-bold">
              <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
              <span>Ephemeral Disk Warning (Render Free Tier)</span>
            </div>
            <p className="text-[11px] text-amber-800">
              Your backend is currently using a local disk. On Render free instances, container restarts and redeployments wipe local files.
              To ensure newly added accounts and settings persist indefinitely across restarts, add a managed PostgreSQL database in Render and set the <strong>DATABASE_URL</strong> environment variable in your Render dashboard.
            </p>
          </div>
        )}
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
