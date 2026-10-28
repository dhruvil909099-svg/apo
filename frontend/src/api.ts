import {
  Account, AccountCreatePayload, IPO, Allotment, Order,
  MarketQuote, ConsolidatedHolding, AccountPortfolio,
  BulkOrderPreview, RiskLimit, AuditLog, DashboardSummary
} from './types';

const DEFAULT_API_BASE = 'https://apo-wubq.onrender.com/api/v1';
const DEFAULT_KEY = 'ipopro-secure-master-key-2026';

export function getApiBase(): string {
  if (typeof window !== 'undefined') {
    const custom = localStorage.getItem('ipopro_api_base');
    if (custom && custom.trim()) {
      return custom.trim().replace(/\/+$/, '');
    }
  }
  return ((import.meta as any).env?.VITE_API_BASE as string) || DEFAULT_API_BASE;
}

export function setApiBase(url: string): void {
  if (typeof window !== 'undefined') {
    if (!url || !url.trim() || url.trim() === DEFAULT_API_BASE) {
      localStorage.removeItem('ipopro_api_base');
    } else {
      localStorage.setItem('ipopro_api_base', url.trim().replace(/\/+$/, ''));
    }
  }
}

export function getWebSocketUrl(): string {
  const base = getApiBase();
  if (base.startsWith('http://') || base.startsWith('https://')) {
    const wsBase = base.replace(/^http/, 'ws');
    return `${wsBase}/market/ws`;
  }
  const protocol = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = typeof window !== 'undefined' ? window.location.host : 'localhost';
  return `${protocol}//${host}${base}/market/ws`;
}

export function getAuthHeaders(): Record<string, string> {
  const stored = typeof window !== 'undefined' ? localStorage.getItem('ipopro_api_key') : null;
  const key = stored || DEFAULT_KEY;
  return {
    'X-API-Key': key,
    'Authorization': `Bearer ${key}`
  };
}

export function setApiKey(key: string): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem('ipopro_api_key', key);
  }
}

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders(),
        ...options?.headers,
      },
      ...options,
    });
  } catch (netErr: any) {
    throw new Error(`Unable to reach backend server at "${url}". Please verify your network connection or Backend API URL in Settings.`);
  }

  const contentType = response.headers.get('content-type') || '';
  const isHtml = contentType.includes('text/html');

  if (!response.ok) {
    let errorDetail = `Request failed with status ${response.status}`;
    if (isHtml) {
      errorDetail = `Backend API server not found at "${url}" (HTTP ${response.status}). Hostinger returned an HTML page instead of API JSON. Please configure your live Backend API URL in Settings.`;
    } else {
      try {
        const errObj = await response.json();
        errorDetail = errObj.detail || errObj.message || errorDetail;
      } catch {
        // ignore
      }
    }
    throw new Error(errorDetail);
  }

  if (isHtml) {
    const text = await response.text();
    if (text.trim().startsWith('<') || text.includes('<!doctype') || text.includes('<html')) {
      throw new Error(
        `Backend API server is not running on Hostinger. The server returned index.html instead of FastAPI JSON. Please configure your live Backend API URL in Settings.`
      );
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`Invalid non-JSON response from backend server at "${url}".`);
    }
  }

  return response.json();
}

export const api = {
  // Health & connectivity check
  checkHealth: async (baseUrl?: string): Promise<{ ok: boolean; statusText: string; latencyMs: number }> => {
    const base = baseUrl || getApiBase();
    const start = performance.now();
    try {
      const res = await fetch(`${base}/audit/summary`, {
        headers: getAuthHeaders(),
      });
      const latencyMs = Math.round(performance.now() - start);
      const contentType = res.headers.get('content-type') || '';
      if (!res.ok) {
        return { ok: false, statusText: `HTTP ${res.status}`, latencyMs };
      }
      if (contentType.includes('text/html')) {
        return { ok: false, statusText: 'Returned HTML (FastAPI not found)', latencyMs };
      }
      await res.json();
      return { ok: true, statusText: 'Online', latencyMs };
    } catch (err: any) {
      return { ok: false, statusText: err.message || 'Offline', latencyMs: Math.round(performance.now() - start) };
    }
  },

  // Dashboard Summary KPI
  getSummary: () => fetchJson<DashboardSummary>(`${getApiBase()}/audit/summary`),

  // Accounts
  getAccounts: (group?: string, status?: string) => {
    const params = new URLSearchParams();
    if (group && group !== 'All') params.append('group', group);
    if (status) params.append('status_filter', status);
    const query = params.toString() ? `?${params.toString()}` : '';
    return fetchJson<Account[]>(`${getApiBase()}/accounts${query}`);
  },
  createAccount: (data: AccountCreatePayload) => fetchJson<Account>(`${getApiBase()}/accounts`, {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  updateAccount: (id: number, data: Partial<Account>) => fetchJson<Account>(`${getApiBase()}/accounts/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  }),
  deleteAccount: (id: number) => fetch(`${getApiBase()}/accounts/${id}`, { method: 'DELETE', headers: getAuthHeaders() }),
  testAccount: (id: number) => fetchJson<{ success: boolean; message: string; auth_status: string; ddpi_status: string }>(
    `${getApiBase()}/accounts/${id}/test`,
    { method: 'POST' }
  ),
  batchCreateDemoAccounts: (count: number = 10) => fetchJson<{ message: string; count: number }>(
    `${getApiBase()}/accounts/batch-create-demo?count=${count}`,
    { method: 'POST' }
  ),

  // IPOs
  getIPOs: (status?: string) => {
    const query = status && status !== 'ALL' ? `?status_filter=${status}` : '';
    return fetchJson<IPO[]>(`${getApiBase()}/ipos${query}`);
  },
  createIPO: (data: Partial<IPO>) => fetchJson<IPO>(`${getApiBase()}/ipos`, {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  getIPO: (id: number) => fetchJson<IPO>(`${getApiBase()}/ipos/${id}`),
  getIPOAllotments: (id: number) => fetchJson<Allotment[]>(`${getApiBase()}/ipos/${id}/allotments`),
  createAllotment: (ipoId: number, data: any) => fetchJson<Allotment>(`${getApiBase()}/ipos/${ipoId}/allotments`, {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  importCSV: async (ipoId: number, file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(`${getApiBase()}/ipos/${ipoId}/import-csv`, {
      method: 'POST',
      body: formData,
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error('CSV upload failed');
    return res.json();
  },

  // Market Data
  getQuotes: () => fetchJson<MarketQuote[]>(`${getApiBase()}/market/quotes`),
  getMarketCandles: (symbol: string, interval = 'ONE_DAY', rangePeriod = '1M') => fetchJson<import('./types').MarketCandleResponse>(
    `${getApiBase()}/market/candles?symbol=${encodeURIComponent(symbol)}&interval=${interval}&range_period=${rangePeriod}`
  ),
  updatePrice: (symbol: string, price: number) => fetchJson<any>(
    `${getApiBase()}/market/update-price?symbol=${encodeURIComponent(symbol)}&price=${price}`,
    { method: 'POST' }
  ),

  // Portfolio
  getConsolidatedPortfolio: (accountIds?: number[]) => {
    const query = accountIds && accountIds.length > 0 ? `?account_ids=${accountIds.join(',')}` : '';
    return fetchJson<import('./types').ConsolidatedPortfolioResponse>(`${getApiBase()}/portfolio/consolidated${query}`);
  },
  getAccountPortfolios: () => fetchJson<AccountPortfolio[]>(`${getApiBase()}/portfolio/accounts`),
  syncPortfolio: () => fetchJson<{ success: boolean; accounts_synced: number; accounts_failed: number; timestamp: string }>(
    `${getApiBase()}/portfolio/sync`,
    { method: 'POST' }
  ),

  // Orders
  getOrders: (params?: { account_id?: number; status_filter?: string; symbol?: string; batch_id?: string }) => {
    const sp = new URLSearchParams();
    if (params?.account_id) sp.append('account_id', params.account_id.toString());
    if (params?.status_filter && params.status_filter !== 'ALL') sp.append('status_filter', params.status_filter);
    if (params?.symbol) sp.append('symbol', params.symbol);
    if (params?.batch_id) sp.append('batch_id', params.batch_id);
    const query = sp.toString() ? `?${sp.toString()}` : '';
    return fetchJson<Order[]>(`${getApiBase()}/orders${query}`);
  },
  placeSingleOrder: (order: any) => fetchJson<Order>(`${getApiBase()}/orders/single`, {
    method: 'POST',
    body: JSON.stringify(order),
  }),
  prepareBulkOrders: (payload: any) => fetchJson<BulkOrderPreview>(`${getApiBase()}/orders/bulk-prepare`, {
    method: 'POST',
    body: JSON.stringify(payload),
  }),
  executeBulkOrders: (batchId: string, confirmed: boolean) => fetchJson<any>(`${getApiBase()}/orders/bulk-execute`, {
    method: 'POST',
    body: JSON.stringify({ batch_id: batchId, operator_confirmed: confirmed }),
  }),
  cancelOrder: (id: number) => fetchJson<any>(`${getApiBase()}/orders/${id}/cancel`, { method: 'POST' }),

  // Risk Management
  getRiskLimits: () => fetchJson<RiskLimit>(`${getApiBase()}/risk`),
  updateRiskLimits: (data: Partial<RiskLimit>) => fetchJson<RiskLimit>(`${getApiBase()}/risk`, {
    method: 'PUT',
    body: JSON.stringify(data),
  }),
  toggleEmergencyHalt: () => fetchJson<{ emergency_trading_disabled: boolean; message: string }>(
    `${getApiBase()}/risk/emergency-halt`,
    { method: 'POST' }
  ),

  // Audit Logs
  getAuditLogs: (limit: number = 50, offset: number = 0, eventType?: string) => {
    const sp = new URLSearchParams({ limit: limit.toString(), offset: offset.toString() });
    if (eventType) sp.append('event_type', eventType);
    return fetchJson<AuditLog[]>(`${getApiBase()}/audit/logs?${sp.toString()}`);
  },
};
