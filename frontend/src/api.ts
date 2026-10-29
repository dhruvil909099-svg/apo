import {
  Account, AccountCreatePayload, IPO, Allotment, Order,
  MarketQuote, ConsolidatedHolding, AccountPortfolio,
  BulkOrderPreview, RiskLimit, AuditLog, DashboardSummary,
  AccountOverviewResponse, AccountHoldingItem, AccountPositionItem,
  AccountOrderItem, AccountTradeItem, AccountSyncResponse
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

export class ApiError extends Error {
  status: number;
  statusText: string;
  detail?: string;
  constructor(message: string, status: number, statusText: string, detail?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.statusText = statusText;
    this.detail = detail;
  }
}

export class NetworkError extends Error {
  constructor(message: string, public originalError?: any) {
    super(message);
    this.name = 'NetworkError';
  }
}

export class TimeoutError extends Error {
  constructor(message: string, public timeoutMs: number) {
    super(message);
    this.name = 'TimeoutError';
  }
}

export class AuthError extends ApiError {
  constructor(message: string, status: number = 401, detail?: string) {
    super(message, status, 'Unauthorized', detail);
    this.name = 'AuthError';
  }
}

export class RateLimitError extends ApiError {
  constructor(message: string, public retryAfterSeconds?: number) {
    super(message, 429, 'Too Many Requests');
    this.name = 'RateLimitError';
  }
}

export interface FetchOptions extends RequestInit {
  timeoutMs?: number;
  skipDeduplication?: boolean;
  retries?: number;
}

// In-flight request pooling for GET requests
const inFlightRequests = new Map<string, Promise<any>>();

async function fetchJson<T>(url: string, options?: FetchOptions): Promise<T> {
  const method = (options?.method || 'GET').toUpperCase();
  const isGet = method === 'GET';
  const dedupKey = isGet && !options?.skipDeduplication ? `${method}:${url}` : null;

  if (dedupKey && inFlightRequests.has(dedupKey)) {
    return inFlightRequests.get(dedupKey) as Promise<T>;
  }

  const executionPromise = (async () => {
    const timeoutMs = options?.timeoutMs || 15000;
    const maxRetries = options?.retries !== undefined ? options.retries : (isGet ? 1 : 0);

    let attempt = 0;
    while (attempt <= maxRetries) {
      attempt++;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(url, {
          headers: {
            'Content-Type': 'application/json',
            ...getAuthHeaders(),
            ...options?.headers,
          },
          signal: controller.signal,
          ...options,
        });
        clearTimeout(timeoutId);

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

          if (response.status === 401 || response.status === 403) {
            throw new AuthError(errorDetail, response.status, errorDetail);
          }
          if (response.status === 429) {
            const retryAfter = response.headers.get('retry-after');
            throw new RateLimitError(errorDetail, retryAfter ? parseInt(retryAfter, 10) : undefined);
          }
          if (response.status >= 500 && attempt <= maxRetries && isGet) {
            await new Promise((r) => setTimeout(r, 1000));
            continue;
          }

          throw new ApiError(errorDetail, response.status, response.statusText, errorDetail);
        }

        if (isHtml) {
          const text = await response.text();
          if (text.trim().startsWith('<') || text.includes('<!doctype') || text.includes('<html')) {
            throw new ApiError(
              `Backend API server returned index.html instead of FastAPI JSON. Check Backend API URL in Settings.`,
              200,
              'HTML_RECEIVED'
            );
          }
          try {
            return JSON.parse(text);
          } catch {
            throw new ApiError(`Invalid non-JSON response from backend server at "${url}".`, 200, 'MALFORMED_JSON');
          }
        }

        return await response.json();
      } catch (err: any) {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') {
          if (attempt <= maxRetries && isGet) {
            await new Promise((r) => setTimeout(r, 1000));
            continue;
          }
          throw new TimeoutError(`Request timed out after ${timeoutMs}ms for "${url}".`, timeoutMs);
        }
        if (err instanceof ApiError) {
          throw err;
        }
        if (attempt <= maxRetries && isGet) {
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }
        throw new NetworkError(`Unable to reach backend server at "${url}". ${err.message || ''}`, err);
      }
    }
    throw new NetworkError(`Failed to complete request to "${url}" after retries.`);
  })();

  if (dedupKey) {
    inFlightRequests.set(dedupKey, executionPromise);
    executionPromise.finally(() => {
      inFlightRequests.delete(dedupKey);
    });
  }

  return executionPromise;
}

export const api = {
  // Lightweight health probe using /api/v1/health
  checkHealth: async (
    baseUrl?: string
  ): Promise<{ ok: boolean; status: string; latencyMs: number; isWakingUp?: boolean; detail?: string }> => {
    const base = (baseUrl || getApiBase()).replace(/\/+$/, '');
    const start = performance.now();
    try {
      const res = await fetchJson<{ status: string; app_name: string; version: string }>(`${base}/health`, {
        timeoutMs: 35000, // accommodate Render cold-start wakeups
        skipDeduplication: true,
        retries: 0,
      });
      const latencyMs = Math.round(performance.now() - start);
      return { ok: true, status: res.status || 'UP', latencyMs };
    } catch (err: any) {
      const latencyMs = Math.round(performance.now() - start);
      const isTimeout = err instanceof TimeoutError || err.name === 'TimeoutError';
      const isWakingUp = isTimeout || (err.message && err.message.toLowerCase().includes('timeout'));
      return {
        ok: false,
        status: isWakingUp ? 'WAKING_UP' : 'OFFLINE',
        latencyMs,
        isWakingUp,
        detail: err.message,
      };
    }
  },

  // Readiness probe verifying database and dependencies
  checkReadiness: async (
    baseUrl?: string
  ): Promise<{
    ok: boolean;
    status: string;
    database: string;
    database_engine?: string;
    storage_type?: string;
    latencyMs: number;
  }> => {
    const base = (baseUrl || getApiBase()).replace(/\/+$/, '');
    const start = performance.now();
    try {
      const res = await fetchJson<{
        status: string;
        database: string;
        database_engine?: string;
        storage_type?: string;
      }>(`${base}/health/ready`, {
        timeoutMs: 15000,
        skipDeduplication: true,
        retries: 0,
      });
      return {
        ok: res.status === 'READY',
        status: res.status,
        database: res.database || 'CONNECTED',
        database_engine: res.database_engine,
        storage_type: res.storage_type,
        latencyMs: Math.round(performance.now() - start),
      };
    } catch (err: any) {
      return {
        ok: false,
        status: 'DEGRADED',
        database: 'UNAVAILABLE',
        latencyMs: Math.round(performance.now() - start),
      };
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
  updateAccount: (id: number, data: Record<string, any>) => fetchJson<Account>(`${getApiBase()}/accounts/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  }),
  reconnectAccount: (id: number, data: { client_code: string; api_key: string; pin: string; totp_secret: string }) => fetchJson<Account>(
    `${getApiBase()}/accounts/${id}/reconnect`,
    {
      method: 'POST',
      body: JSON.stringify(data),
    }
  ),
  deleteAccount: (id: number) => fetch(`${getApiBase()}/accounts/${id}`, { method: 'DELETE', headers: getAuthHeaders() }),
  testAccount: (id: number, totpCode?: string) => fetchJson<{ success: boolean; message: string; auth_status: string; ddpi_status: string }>(
    `${getApiBase()}/accounts/${id}/test`,
    {
      method: 'POST',
      body: JSON.stringify(totpCode ? { totp_code: totpCode } : {})
    }
  ),
  batchCreateDemoAccounts: (count: number = 10) => fetchJson<{ message: string; count: number }>(
    `${getApiBase()}/accounts/batch-create-demo?count=${count}`,
    { method: 'POST' }
  ),
  getAccountOverview: (id: number) => fetchJson<AccountOverviewResponse>(`${getApiBase()}/accounts/${id}/overview`),
  getAccountHoldings: (id: number, cachedOnly: boolean = false) => fetchJson<AccountHoldingItem[]>(
    `${getApiBase()}/accounts/${id}/holdings${cachedOnly ? '?cached_only=true' : ''}`
  ),
  getAccountPositions: (id: number) => fetchJson<AccountPositionItem[]>(`${getApiBase()}/accounts/${id}/positions`),
  getAccountOrders: (id: number) => fetchJson<AccountOrderItem[]>(`${getApiBase()}/accounts/${id}/orders`),
  getAccountTrades: (id: number) => fetchJson<AccountTradeItem[]>(`${getApiBase()}/accounts/${id}/trades`),
  syncAccount: (id: number) => fetchJson<AccountSyncResponse>(`${getApiBase()}/accounts/${id}/sync`, { method: 'POST' }),

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
  deleteIPO: (id: number) => fetchJson<{ success: boolean; message: string }>(`${getApiBase()}/ipos/${id}`, {
    method: 'DELETE',
  }),
  getIPOAllotments: (id: number) => fetchJson<Allotment[]>(`${getApiBase()}/ipos/${id}/allotments`),
  createAllotment: (ipoId: number, data: any) => fetchJson<Allotment>(`${getApiBase()}/ipos/${ipoId}/allotments`, {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  deleteIPOAllotment: (ipoId: number, allotmentId: number) => fetchJson<{ success: boolean; message: string }>(
    `${getApiBase()}/ipos/${ipoId}/allotments/${allotmentId}`,
    { method: 'DELETE' }
  ),
  importCSV: async (ipoId: number, file: File): Promise<import('./types').CSVImportSummary> => {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(`${getApiBase()}/ipos/${ipoId}/import-csv`, {
      method: 'POST',
      body: formData,
      headers: getAuthHeaders(),
    });
    if (!res.ok) {
      let msg = `CSV upload failed (${res.status})`;
      try {
        const errObj = await res.json();
        msg = errObj.detail || msg;
      } catch {
        // ignore
      }
      throw new Error(msg);
    }
    return res.json();
  },
  exportIPOAllotmentsCSV: async (ipoId: number, symbol: string): Promise<void> => {
    const res = await fetch(`${getApiBase()}/ipos/${ipoId}/export-csv`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) {
      throw new Error(`Failed to export CSV (HTTP ${res.status})`);
    }
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `allotments_${symbol.toLowerCase()}.csv`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  },
  syncIPOFeed: () => fetchJson<{
    success: boolean;
    created_count: number;
    updated_count: number;
    skipped_count: number;
    total_catalog_size: number;
    source: string;
    last_sync_at: string;
  }>(`${getApiBase()}/ipos/sync-feed`, { method: 'POST' }),
  getIPOFeedStatus: () => fetchJson<{
    is_running: boolean;
    interval_seconds: number;
    total_runs: number;
    total_errors: number;
    last_run_status: string;
    last_run_message: string;
    last_run_timestamp?: string;
  }>(`${getApiBase()}/ipos/feed-status`),
  prepareIPOApplications: (payload: {
    ipo_id: number;
    account_ids: number[];
    lots: number;
    category?: string;
    bid_price?: number;
    save_drafts?: boolean;
  }) => fetchJson<import('./types').IPOPrepareApplicationResponse>(
    `${getApiBase()}/ipos/prepare-applications`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    }
  ),
  getAllApplications: (params?: { account_id?: number; status_filter?: string; mandate_filter?: string; is_sme?: boolean }) => {
    const sp = new URLSearchParams();
    if (params?.account_id) sp.append('account_id', params.account_id.toString());
    if (params?.status_filter) sp.append('status_filter', params.status_filter);
    if (params?.mandate_filter) sp.append('mandate_filter', params.mandate_filter);
    if (params?.is_sme !== undefined) sp.append('is_sme', params.is_sme.toString());
    const query = sp.toString() ? `?${sp.toString()}` : '';
    return fetchJson<Allotment[]>(`${getApiBase()}/ipos/applications/all${query}`);
  },
  updateApplicationStatus: (allotmentId: number, data: Partial<Allotment>) => fetchJson<Allotment>(
    `${getApiBase()}/ipos/applications/${allotmentId}`,
    {
      method: 'PATCH',
      body: JSON.stringify(data),
    }
  ),
  recordApplicationHandoff: (data: {
    allotment_id: number;
    preparation_status?: string;
    broker_application_status?: string;
    application_no?: string;
    upi_mandate_reference?: string;
    mandate_status?: string;
    verification_source?: string;
  }) => fetchJson<Allotment>(
    `${getApiBase()}/ipos/applications/handoff`,
    {
      method: 'POST',
      body: JSON.stringify(data),
    }
  ),

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
  getConsolidatedPortfolio: (accountIds?: number[], capitalType?: string) => {
    const params = new URLSearchParams();
    if (accountIds && accountIds.length > 0) params.append('account_ids', accountIds.join(','));
    if (capitalType) params.append('capital_type', capitalType);
    const query = params.toString() ? `?${params.toString()}` : '';
    return fetchJson<import('./types').ConsolidatedPortfolioResponse>(`${getApiBase()}/portfolio/consolidated${query}`);
  },
  getHoldingDetail: (symbol: string) => fetchJson<import('./types').HoldingDetailResponse>(
    `${getApiBase()}/portfolio/holding/${encodeURIComponent(symbol)}`
  ),
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
  previewSingleOrder: (payload: import('./types').OrderPreviewPayload) => fetchJson<import('./types').OrderPreviewResponse>(
    `${getApiBase()}/orders/preview`,
    { method: 'POST', body: JSON.stringify(payload) }
  ),
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
  getAuditLogs: (limit: number = 50, offset: number = 0, eventType?: string, accountId?: number) => {
    const sp = new URLSearchParams({ limit: limit.toString(), offset: offset.toString() });
    if (eventType && eventType !== 'ALL') sp.append('event_type', eventType);
    if (accountId) sp.append('account_id', accountId.toString());
    return fetchJson<AuditLog[]>(`${getApiBase()}/audit/logs?${sp.toString()}`);
  },

  // Users & Admin CRUD
  getUsers: (params?: { limit?: number; offset?: number; role?: string; search?: string }) => {
    const sp = new URLSearchParams();
    if (params?.limit) sp.append('limit', params.limit.toString());
    if (params?.offset) sp.append('offset', params.offset.toString());
    if (params?.role) sp.append('role', params.role);
    if (params?.search) sp.append('search', params.search);
    const query = sp.toString() ? `?${sp.toString()}` : '';
    return fetchJson<{ total: number; items: import('./types').AppUser[] }>(`${getApiBase()}/users${query}`);
  },
  createUser: (data: { username: string; email: string; password: string; role?: string }) => fetchJson<import('./types').AppUser>(
    `${getApiBase()}/users`,
    { method: 'POST', body: JSON.stringify(data) }
  ),
  updateUser: (id: number, data: Partial<{ username: string; email: string; password: string; role: string; is_active: boolean }>) => fetchJson<import('./types').AppUser>(
    `${getApiBase()}/users/${id}`,
    { method: 'PUT', body: JSON.stringify(data) }
  ),
  deleteUser: (id: number) => fetchJson<void>(`${getApiBase()}/users/${id}`, { method: 'DELETE' }),

  // Watchlists CRUD
  getWatchlists: () => fetchJson<import('./types').Watchlist[]>(`${getApiBase()}/watchlists`),
  createWatchlist: (data: { name: string; description?: string }) => fetchJson<import('./types').Watchlist>(
    `${getApiBase()}/watchlists`,
    { method: 'POST', body: JSON.stringify(data) }
  ),
  updateWatchlist: (id: number, data: { name?: string; description?: string }) => fetchJson<import('./types').Watchlist>(
    `${getApiBase()}/watchlists/${id}`,
    { method: 'PUT', body: JSON.stringify(data) }
  ),
  deleteWatchlist: (id: number) => fetchJson<void>(`${getApiBase()}/watchlists/${id}`, { method: 'DELETE' }),
  addWatchlistItem: (watchlistId: number, data: { symbol: string; exchange?: string; symbol_token?: string; notes?: string }) => fetchJson<import('./types').WatchlistItem>(
    `${getApiBase()}/watchlists/${watchlistId}/items`,
    { method: 'POST', body: JSON.stringify(data) }
  ),
  removeWatchlistItem: (watchlistId: number, itemId: number) => fetchJson<void>(
    `${getApiBase()}/watchlists/${watchlistId}/items/${itemId}`,
    { method: 'DELETE' }
  ),

  // Portfolio Notes & Tags CRUD
  getPortfolioNotes: (params?: { symbol?: string; account_id?: number; tag?: string }) => {
    const sp = new URLSearchParams();
    if (params?.symbol) sp.append('symbol', params.symbol);
    if (params?.account_id) sp.append('account_id', params.account_id.toString());
    if (params?.tag) sp.append('tag', params.tag);
    const query = sp.toString() ? `?${sp.toString()}` : '';
    return fetchJson<import('./types').PortfolioNote[]>(`${getApiBase()}/portfolio/notes${query}`);
  },
  createPortfolioNote: (data: { account_id?: number; symbol?: string; tag?: string; content: string }) => fetchJson<import('./types').PortfolioNote>(
    `${getApiBase()}/portfolio/notes`,
    { method: 'POST', body: JSON.stringify(data) }
  ),
  updatePortfolioNote: (id: number, data: { tag?: string; content?: string }) => fetchJson<import('./types').PortfolioNote>(
    `${getApiBase()}/portfolio/notes/${id}`,
    { method: 'PUT', body: JSON.stringify(data) }
  ),
  deletePortfolioNote: (id: number) => fetchJson<void>(`${getApiBase()}/portfolio/notes/${id}`, { method: 'DELETE' }),

  // Notifications CRUD
  getNotifications: (unreadOnly: boolean = false) => fetchJson<import('./types').AppNotification[]>(
    `${getApiBase()}/notifications?unread_only=${unreadOnly}`
  ),
  createNotification: (data: { title: string; message: string; notification_type?: string }) => fetchJson<import('./types').AppNotification>(
    `${getApiBase()}/notifications`,
    { method: 'POST', body: JSON.stringify(data) }
  ),
  markNotificationRead: (id: number) => fetchJson<import('./types').AppNotification>(
    `${getApiBase()}/notifications/${id}/read`,
    { method: 'POST' }
  ),
  deleteNotification: (id: number) => fetchJson<void>(`${getApiBase()}/notifications/${id}`, { method: 'DELETE' }),

  // AI Chat Assistant
  sendChatMessage: (message: string, sessionId?: string) => fetchJson<import('./types').ChatMessage>(
    `${getApiBase()}/chat/message`,
    { method: 'POST', body: JSON.stringify({ message, session_id: sessionId }) }
  ),
  getChatHistory: (sessionId: string) => fetchJson<{ session_id: string; messages: import('./types').ChatMessage[] }>(
    `${getApiBase()}/chat/history?session_id=${encodeURIComponent(sessionId)}`
  ),
  clearChatHistory: (sessionId: string) => fetchJson<void>(
    `${getApiBase()}/chat/history?session_id=${encodeURIComponent(sessionId)}`,
    { method: 'DELETE' }
  ),
  getChatContext: () => fetchJson<any>(`${getApiBase()}/chat/context`),

  // Operations & Auto-Data Engine
  getOrchestrationStatus: () => fetchJson<import('./types').OrchestrationStatusResponse>(`${getApiBase()}/operations/status`),
  triggerAutoRefresh: (force: boolean = false) => fetchJson<import('./types').AutoRefreshResponse>(
    `${getApiBase()}/operations/auto-refresh`,
    { method: 'POST', body: JSON.stringify({ force }) }
  ),
  getOperationsDiagnostics: () => fetchJson<import('./types').AIOpsDiagnosticsResponse>(`${getApiBase()}/operations/diagnostics`),
  executeRemediation: (action: string, payload: Record<string, any> = {}) => fetchJson<{ success: boolean; action: string; message: string; details?: any }>(
    `${getApiBase()}/operations/remediate`,
    { method: 'POST', body: JSON.stringify({ action, payload }) }
  ),

  // Market & Genuine Angel One Instruments Catalog
  searchInstruments: (params?: {
    query?: string;
    exchange?: string;
    segment?: string;
    instrument_type?: string;
    letter?: string;
    underlying?: string;
    limit?: number;
    offset?: number;
  }) => {
    const sp = new URLSearchParams();
    if (params?.query) sp.append('query', params.query);
    if (params?.exchange) sp.append('exchange', params.exchange);
    if (params?.segment) sp.append('segment', params.segment);
    if (params?.instrument_type) sp.append('instrument_type', params.instrument_type);
    if (params?.letter) sp.append('letter', params.letter);
    if (params?.underlying) sp.append('underlying', params.underlying);
    if (params?.limit) sp.append('limit', params.limit.toString());
    if (params?.offset) sp.append('offset', params.offset.toString());
    const qs = sp.toString() ? `?${sp.toString()}` : '';
    return fetchJson<{
      total_count: number;
      limit: number;
      offset: number;
      has_more: boolean;
      instruments: import('./types').MarketInstrument[];
    }>(`${getApiBase()}/market/instruments/search${qs}`);
  },

  getPopularInstruments: () => fetchJson<import('./types').MarketInstrument[]>(`${getApiBase()}/market/instruments/popular`),

  getOptionChain: (underlying: string = 'NIFTY', expiryDate?: string) => {
    const sp = new URLSearchParams({ underlying });
    if (expiryDate) sp.append('expiry_date', expiryDate);
    return fetchJson<import('./types').OptionChainResponse>(`${getApiBase()}/market/instruments/option-chain?${sp.toString()}`);
  },

  getCommodities: () => fetchJson<import('./types').CommodityContract[]>(`${getApiBase()}/market/instruments/commodities`),

  getMarketSessionStatus: () => fetchJson<import('./types').MarketSessionStatus>(`${getApiBase()}/market/session-status`),

  getCatalogSummary: () => fetchJson<import('./types').CatalogSummaryResponse>(`${getApiBase()}/market/catalog/summary`),

  syncInstrumentsCatalog: () => fetchJson<{ status: string; total_persisted: number; counts_by_exchange: Record<string, number> }>(
    `${getApiBase()}/market/instruments/sync`,
    { method: 'POST' }
  ),

  getSingleMarketQuote: (symbol: string, exchange: string = 'NSE') => fetchJson<any>(
    `${getApiBase()}/market/quote?symbol=${encodeURIComponent(symbol)}&exchange=${encodeURIComponent(exchange)}`
  ),

  getBatchMarketQuotes: (instruments: Array<{ exchange: string; symbol_token: string }>, mode: string = 'FULL') => fetchJson<{
    mode: string;
    fetched: any[];
    unfetched: any[];
    status?: string;
  }>(`${getApiBase()}/market/quotes/batch`, {
    method: 'POST',
    body: JSON.stringify({ instruments, mode })
  }),
};

