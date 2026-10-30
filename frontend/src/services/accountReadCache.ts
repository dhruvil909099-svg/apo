import {
  AccountOverviewResponse,
  AccountHoldingItem,
  AccountPositionItem,
  AccountOrderItem,
  AccountTradeItem,
  AccountFundsResponse,
  AccountActivityLogResponse
} from '../types';

export interface CacheEntry<T> {
  data: T;
  timestamp: number;
  isCachedSnapshot?: boolean;
}

export interface AccountDrawerCache {
  overview?: CacheEntry<AccountOverviewResponse>;
  holdings?: CacheEntry<AccountHoldingItem[]>;
  positions?: CacheEntry<AccountPositionItem[]>;
  orders?: CacheEntry<AccountOrderItem[]>;
  trades?: CacheEntry<AccountTradeItem[]>;
  funds?: CacheEntry<AccountFundsResponse>;
  activityLog?: CacheEntry<AccountActivityLogResponse>;
}

// TTL in milliseconds per category to guarantee data freshness and safety
export const CACHE_TTL_MS = {
  overview: 60 * 1000,       // 1 minute
  holdings: 120 * 1000,      // 2 minutes
  positions: 30 * 1000,      // 30 seconds
  orders: 15 * 1000,         // 15 seconds (dynamic order status)
  trades: 30 * 1000,         // 30 seconds
  funds: 45 * 1000,          // 45 seconds
  activityLog: 60 * 1000,    // 1 minute
} as const;

class AccountReadCacheService {
  private cache = new Map<number, AccountDrawerCache>();
  private inFlightRequests = new Map<string, Promise<any>>();

  public isFresh(entry?: CacheEntry<any>, ttlMs: number = 60000): boolean {
    if (!entry) return false;
    return Date.now() - entry.timestamp < ttlMs;
  }

  public getAccount(accountId: number): AccountDrawerCache | undefined {
    return this.cache.get(accountId);
  }

  public getItem<K extends keyof AccountDrawerCache>(
    accountId: number,
    key: K,
    ttlMs: number = CACHE_TTL_MS[key] ?? 60000
  ): AccountDrawerCache[K] | undefined {
    const accountCache = this.cache.get(accountId);
    if (!accountCache) return undefined;
    const item = accountCache[key];
    if (item && this.isFresh(item, ttlMs)) {
      return item;
    }
    return undefined;
  }

  public setItem<K extends keyof AccountDrawerCache>(
    accountId: number,
    key: K,
    data: any,
    isCachedSnapshot: boolean = false
  ): void {
    let accountCache = this.cache.get(accountId);
    if (!accountCache) {
      accountCache = {};
      this.cache.set(accountId, accountCache);
    }
    accountCache[key] = {
      data,
      timestamp: Date.now(),
      isCachedSnapshot
    } as any;
  }

  public invalidate(accountId: number, key?: keyof AccountDrawerCache): void {
    const accountCache = this.cache.get(accountId);
    if (!accountCache) return;
    if (key) {
      delete accountCache[key];
    } else {
      this.cache.delete(accountId);
    }
  }

  public clearAll(): void {
    this.cache.clear();
    this.inFlightRequests.clear();
  }

  // Request deduplication for identical concurrent fetches
  public async deduplicate<T>(
    key: string,
    fetcher: () => Promise<T>
  ): Promise<T> {
    const existing = this.inFlightRequests.get(key);
    if (existing) {
      return existing as Promise<T>;
    }
    const promise = (async () => {
      try {
        return await fetcher();
      } finally {
        this.inFlightRequests.delete(key);
      }
    })();
    this.inFlightRequests.set(key, promise);
    return promise;
  }
}

export const accountReadCache = new AccountReadCacheService();
