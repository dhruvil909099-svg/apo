import {
  Account, AccountCreatePayload, IPO, Allotment, Order,
  MarketQuote, ConsolidatedHolding, AccountPortfolio,
  BulkOrderPreview, RiskLimit, AuditLog, DashboardSummary
} from './types';

const API_BASE = '/api/v1';
const DEFAULT_KEY = 'ipopro-secure-master-key-2026';

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
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
      ...options?.headers,
    },
    ...options,
  });

  if (!response.ok) {
    let errorDetail = `Request failed with status ${response.status}`;
    try {
      const errObj = await response.json();
      errorDetail = errObj.detail || errObj.message || errorDetail;
    } catch {
      // ignore
    }
    throw new Error(errorDetail);
  }

  return response.json();
}

export const api = {
  // Dashboard Summary KPI
  getSummary: () => fetchJson<DashboardSummary>(`${API_BASE}/audit/summary`),

  // Accounts
  getAccounts: (group?: string, status?: string) => {
    const params = new URLSearchParams();
    if (group && group !== 'All') params.append('group', group);
    if (status) params.append('status_filter', status);
    const query = params.toString() ? `?${params.toString()}` : '';
    return fetchJson<Account[]>(`${API_BASE}/accounts${query}`);
  },
  createAccount: (data: AccountCreatePayload) => fetchJson<Account>(`${API_BASE}/accounts`, {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  updateAccount: (id: number, data: Partial<Account>) => fetchJson<Account>(`${API_BASE}/accounts/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  }),
  deleteAccount: (id: number) => fetch(`${API_BASE}/accounts/${id}`, { method: 'DELETE', headers: getAuthHeaders() }),
  testAccount: (id: number) => fetchJson<{ success: boolean; message: string; auth_status: string; ddpi_status: string }>(
    `${API_BASE}/accounts/${id}/test`,
    { method: 'POST' }
  ),
  batchCreateDemoAccounts: (count: number = 10) => fetchJson<{ message: string; count: number }>(
    `${API_BASE}/accounts/batch-create-demo?count=${count}`,
    { method: 'POST' }
  ),

  // IPOs
  getIPOs: (status?: string) => {
    const query = status && status !== 'ALL' ? `?status_filter=${status}` : '';
    return fetchJson<IPO[]>(`${API_BASE}/ipos${query}`);
  },
  createIPO: (data: Partial<IPO>) => fetchJson<IPO>(`${API_BASE}/ipos`, {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  getIPO: (id: number) => fetchJson<IPO>(`${API_BASE}/ipos/${id}`),
  getIPOAllotments: (id: number) => fetchJson<Allotment[]>(`${API_BASE}/ipos/${id}/allotments`),
  createAllotment: (ipoId: number, data: any) => fetchJson<Allotment>(`${API_BASE}/ipos/${ipoId}/allotments`, {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  importCSV: async (ipoId: number, file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(`${API_BASE}/ipos/${ipoId}/import-csv`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) throw new Error('CSV upload failed');
    return res.json();
  },

  // Market Data
  getQuotes: () => fetchJson<MarketQuote[]>(`${API_BASE}/market/quotes`),
  getMarketCandles: (symbol: string, interval = 'ONE_DAY', rangePeriod = '1M') => fetchJson<import('./types').MarketCandleResponse>(
    `${API_BASE}/market/candles?symbol=${encodeURIComponent(symbol)}&interval=${interval}&range_period=${rangePeriod}`
  ),
  updatePrice: (symbol: string, price: number) => fetchJson<any>(
    `${API_BASE}/market/update-price?symbol=${encodeURIComponent(symbol)}&price=${price}`,
    { method: 'POST' }
  ),

  // Portfolio
  getConsolidatedPortfolio: (accountIds?: number[]) => {
    const query = accountIds && accountIds.length > 0 ? `?account_ids=${accountIds.join(',')}` : '';
    return fetchJson<import('./types').ConsolidatedPortfolioResponse>(`${API_BASE}/portfolio/consolidated${query}`);
  },
  getAccountPortfolios: () => fetchJson<AccountPortfolio[]>(`${API_BASE}/portfolio/accounts`),
  syncPortfolio: () => fetchJson<{ success: boolean; accounts_synced: number; accounts_failed: number; timestamp: string }>(
    `${API_BASE}/portfolio/sync`,
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
    return fetchJson<Order[]>(`${API_BASE}/orders${query}`);
  },
  placeSingleOrder: (order: any) => fetchJson<Order>(`${API_BASE}/orders/single`, {
    method: 'POST',
    body: JSON.stringify(order),
  }),
  prepareBulkOrders: (payload: any) => fetchJson<BulkOrderPreview>(`${API_BASE}/orders/bulk-prepare`, {
    method: 'POST',
    body: JSON.stringify(payload),
  }),
  executeBulkOrders: (batchId: string, confirmed: boolean) => fetchJson<any>(`${API_BASE}/orders/bulk-execute`, {
    method: 'POST',
    body: JSON.stringify({ batch_id: batchId, operator_confirmed: confirmed }),
  }),
  cancelOrder: (id: number) => fetchJson<any>(`${API_BASE}/orders/${id}/cancel`, { method: 'POST' }),

  // Risk Management
  getRiskLimits: () => fetchJson<RiskLimit>(`${API_BASE}/risk`),
  updateRiskLimits: (data: Partial<RiskLimit>) => fetchJson<RiskLimit>(`${API_BASE}/risk`, {
    method: 'PUT',
    body: JSON.stringify(data),
  }),
  toggleEmergencyHalt: () => fetchJson<{ emergency_trading_disabled: boolean; message: string }>(
    `${API_BASE}/risk/emergency-halt`,
    { method: 'POST' }
  ),

  // Audit Logs
  getAuditLogs: (limit: number = 50, offset: number = 0, eventType?: string) => {
    const sp = new URLSearchParams({ limit: limit.toString(), offset: offset.toString() });
    if (eventType) sp.append('event_type', eventType);
    return fetchJson<AuditLog[]>(`${API_BASE}/audit/logs?${sp.toString()}`);
  },
};
