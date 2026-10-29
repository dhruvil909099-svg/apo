import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Users, Plus, RefreshCw, CheckCircle2, AlertTriangle,
  Lock, Trash2, Power, Search, ShieldCheck, Eye,
  PieChart, Activity, Sliders, ChevronDown, ChevronRight,
  ExternalLink, Wallet, TrendingUp, TrendingDown, Clock,
  ArrowUpRight, Shield, AlertCircle, X, KeyRound, Radio,
  Filter, ArrowUpDown, SlidersHorizontal, Check, RefreshCcw
} from 'lucide-react';
import {
  Account, AccountCreatePayload, AccountOverviewResponse,
  AccountHoldingItem, AccountPositionItem, AccountOrderItem,
  AccountTradeItem, ConsolidatedHolding, AuditLog
} from '../types';
import { api, getWebSocketUrl } from '../api';
import { HoldingsTable } from '../components/HoldingsTable';
import { OrderTicketModal } from '../components/OrderTicketModal';
import { StockDetailsModal } from '../components/StockDetailsModal';

interface AccountsViewProps {
  accounts: Account[];
  onRefresh: () => void;
}

type MainTab = 'overview' | 'portfolio' | 'activity' | 'reconnect';
type DrawerTab = 'overview' | 'holdings' | 'positions' | 'orders' | 'trades' | 'markets' | 'watchlist' | 'security';
type CapitalFilter = 'all' | 'live' | 'demo';

export const AccountsView: React.FC<AccountsViewProps> = ({ accounts, onRefresh }) => {
  // Navigation & Filtering
  const [activeTab, setActiveTab] = useState<MainTab>('overview');
  const [selectedGroup, setSelectedGroup] = useState<string>('All');
  const [capitalFilter, setCapitalFilter] = useState<CapitalFilter>('live');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Modals & Drawers
  const [isAddModalOpen, setIsAddModalOpen] = useState<boolean>(false);
  const [selectedAccountForDrawer, setSelectedAccountForDrawer] = useState<Account | null>(null);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>('overview');

  // Markets & Watchlist in Drawer
  const [drawerMarketsSearch, setDrawerMarketsSearch] = useState<string>('');
  const [drawerMarketsSegment, setDrawerMarketsSegment] = useState<'ALL' | 'NSE' | 'BSE' | 'FUTURES' | 'OPTIONS' | 'MCX'>('ALL');
  const [drawerMarketsLetter, setDrawerMarketsLetter] = useState<string>('ALL');
  const [drawerMarketsResults, setDrawerMarketsResults] = useState<import('../types').MarketInstrument[]>([]);
  const [isLoadingDrawerMarkets, setIsLoadingDrawerMarkets] = useState<boolean>(false);
  const [drawerWatchlists, setDrawerWatchlists] = useState<import('../types').Watchlist[]>([]);
  const [isLoadingDrawerWatchlist, setIsLoadingDrawerWatchlist] = useState<boolean>(false);

  // Drawer Data States
  const [drawerOverview, setDrawerOverview] = useState<AccountOverviewResponse | null>(null);
  const [drawerHoldings, setDrawerHoldings] = useState<AccountHoldingItem[]>([]);
  const [drawerPositions, setDrawerPositions] = useState<AccountPositionItem[]>([]);
  const [drawerOrders, setDrawerOrders] = useState<AccountOrderItem[]>([]);
  const [drawerTrades, setDrawerTrades] = useState<AccountTradeItem[]>([]);
  const [isLoadingDrawer, setIsLoadingDrawer] = useState<boolean>(false);
  const [drawerError, setDrawerError] = useState<string | null>(null);
  const [drawerHoldingsError, setDrawerHoldingsError] = useState<string | null>(null);
  const [drawerPositionsError, setDrawerPositionsError] = useState<string | null>(null);
  const [drawerOrdersError, setDrawerOrdersError] = useState<string | null>(null);
  const [drawerTradesError, setDrawerTradesError] = useState<string | null>(null);
  const [isDrawerSessionExpired, setIsDrawerSessionExpired] = useState<boolean>(false);

  // Order Ticket & Stock Details Modal states
  const [selectedStockForOrder, setSelectedStockForOrder] = useState<AccountHoldingItem | null>(null);
  const [orderTicketSide, setOrderTicketSide] = useState<'BUY' | 'SELL'>('BUY');
  const [isOrderTicketOpen, setIsOrderTicketOpen] = useState<boolean>(false);

  const [selectedStockForDetails, setSelectedStockForDetails] = useState<AccountHoldingItem | null>(null);
  const [detailsModalView, setDetailsModalView] = useState<'depth' | 'chart' | 'details' | 'corporate'>('details');
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState<boolean>(false);

  // Real-time telemetry & caching
  const [drawerDataFreshness, setDrawerDataFreshness] = useState<'LIVE' | 'SYNCING' | 'CACHED' | 'STALE' | 'DISCONNECTED'>('CACHED');
  const [lastSyncTimestamp, setLastSyncTimestamp] = useState<string | null>(null);
  const [orderSuccessBanner, setOrderSuccessBanner] = useState<string | null>(null);

  // Order Book & Trade Book search / filters
  const [orderSearchQuery, setOrderSearchQuery] = useState<string>('');
  const [orderStatusFilter, setOrderStatusFilter] = useState<string>('ALL');
  const [tradeSearchQuery, setTradeSearchQuery] = useState<string>('');

  const drawerCacheRef = useRef<Record<number, {
    overview?: AccountOverviewResponse;
    holdings?: AccountHoldingItem[];
    positions?: AccountPositionItem[];
    orders?: AccountOrderItem[];
    trades?: AccountTradeItem[];
    lastFetched?: number;
  }>>({});

  // Sync & Cooldown State (Rate limit protection)
  const [syncingAccountIds, setSyncingAccountIds] = useState<Set<number>>(new Set());
  const [cooldowns, setCooldowns] = useState<Record<number, number>>({});
  const [testingAccountId, setTestingAccountId] = useState<number | null>(null);
  const [testResult, setTestResult] = useState<{ id: number; success: boolean; msg: string } | null>(null);

  // Consolidated Portfolio State
  const [portfolioHoldings, setPortfolioHoldings] = useState<ConsolidatedHolding[]>([]);
  const [portfolioTotals, setPortfolioTotals] = useState<{ totalVal: number; totalCost: number; totalPnl: number; pnlPct: number }>({
    totalVal: 0, totalCost: 0, totalPnl: 0, pnlPct: 0
  });
  const [isLoadingPortfolio, setIsLoadingPortfolio] = useState<boolean>(false);
  const [expandedPortfolioKeys, setExpandedPortfolioKeys] = useState<Set<string>>(new Set());

  // Activity Feed State
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [isLoadingActivity, setIsLoadingActivity] = useState<boolean>(false);
  const [activityEventType, setActivityEventType] = useState<string>('ALL');

  // Form State for Adding Account
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

  // Form State for Credential Rotation & Reconnect
  // Form State for Reconnecting Full Credentials
  const [rotationAccount, setRotationAccount] = useState<Account | null>(null);
  const [rotationData, setRotationData] = useState({ client_code: '', api_key: '', pin: '', totp_secret: '' });
  const [isRotating, setIsRotating] = useState(false);
  const [rotationError, setRotationError] = useState<string | null>(null);

  const handleAutoReconnect = async (acc: Account) => {
    setTestingAccountId(acc.id);
    try {
      const res = await api.testAccount(acc.id);
      if (res.success) {
        onRefresh();
      } else {
        setRotationAccount(acc);
        setRotationError(res.message || 'Auto-reconnect failed. Please update your full credentials below.');
      }
    } catch (err: any) {
      setRotationAccount(acc);
      setRotationError(err.message || 'Auto-reconnect failed. Please update your full credentials below.');
    } finally {
      setTestingAccountId(null);
    }
  };

  const groups = ['All', 'Family', 'Friends', 'Demo Pool', 'Custom'];


  // Cooldown timer ticker
  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      setCooldowns((prev) => {
        let changed = false;
        const next: Record<number, number> = {};
        for (const [id, expireTime] of Object.entries(prev)) {
          if (expireTime > now) {
            next[Number(id)] = expireTime;
          } else {
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Filter accounts based on group, capital type (live vs demo), and search query
  const filteredAccounts = useMemo(() => {
    return accounts.filter((acc) => {
      const matchesGroup = selectedGroup === 'All' || acc.account_group === selectedGroup;
      const matchesCapital =
        capitalFilter === 'all'
          ? true
          : capitalFilter === 'live'
          ? !acc.is_demo
          : acc.is_demo;
      const matchesSearch =
        acc.nickname.toLowerCase().includes(searchQuery.toLowerCase()) ||
        acc.masked_client_code.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesGroup && matchesCapital && matchesSearch;
    });
  }, [accounts, selectedGroup, capitalFilter, searchQuery]);

  // Summary Metrics with strict Real vs Demo separation
  const metrics = useMemo(() => {
    const liveAccounts = accounts.filter((a) => !a.is_demo);
    const demoAccounts = accounts.filter((a) => a.is_demo);

    const connectedLive = liveAccounts.filter((a) => a.auth_status === 'CONNECTED').length;
    const errorLive = liveAccounts.filter((a) => a.auth_status === 'ERROR' || a.auth_status === 'EXPIRED').length;

    // Verified available cash (only count verified live balances)
    const verifiedLiveCash = liveAccounts
      .filter((a) => a.auth_status === 'CONNECTED')
      .reduce((sum, a) => sum + (a.available_cash || 0), 0);

    const demoCash = demoAccounts.reduce((sum, a) => sum + (a.available_cash || 0), 0);

    return {
      totalLive: liveAccounts.length,
      connectedLive,
      errorLive,
      totalDemo: demoAccounts.length,
      verifiedLiveCash,
      demoCash,
    };
  }, [accounts]);

  // Fetch drawer data with staged loading & rate-limit pacing
  const fetchDrawerData = useCallback(async (account: Account, isInitial: boolean = false) => {
    setIsLoadingDrawer(true);
    setDrawerError(null);
    setDrawerHoldingsError(null);
    setDrawerPositionsError(null);
    setDrawerOrdersError(null);
    setDrawerTradesError(null);
    setIsDrawerSessionExpired(false);
    setDrawerDataFreshness('SYNCING');

    // Staged Priority 0: Fast retrieval of cached-only holdings from DB if in-memory cache was empty
    if (isInitial && drawerHoldings.length === 0) {
      try {
        const cachedSnap = await api.getAccountHoldings(account.id, true);
        if (cachedSnap && cachedSnap.length > 0) {
          setDrawerHoldings(cachedSnap);
          setDrawerDataFreshness('CACHED');
        }
      } catch {
        // Cached snapshot fetch is opportunistic
      }
    }

    try {
      // Staged Priority 1: Account overview & fresh holdings
      const [ovRes, hdRes] = await Promise.allSettled([
        api.getAccountOverview(account.id),
        api.getAccountHoldings(account.id, false),
      ]);

      if (ovRes.status === 'fulfilled') {
        setDrawerOverview(ovRes.value);
      } else {
        const msg = ovRes.reason?.message || '';
        if (msg.includes('401') || msg.toLowerCase().includes('expired')) {
          setIsDrawerSessionExpired(true);
        }
      }

      if (hdRes.status === 'fulfilled') {
        setDrawerHoldings(hdRes.value);
        setDrawerHoldingsError(null);
      } else {
        const errMsg = hdRes.reason?.message || 'Failed to load delivery holdings';
        setDrawerHoldingsError(errMsg);
        if (hdRes.reason?.status === 401 || errMsg.toLowerCase().includes('expired')) {
          setIsDrawerSessionExpired(true);
        }
      }

      // Staged Priority 2: Small 60ms pacing to prevent concurrent upstream broker rate-limiting
      await new Promise((r) => setTimeout(r, 60));

      const [posRes, ordRes, trRes] = await Promise.allSettled([
        api.getAccountPositions(account.id),
        api.getAccountOrders(account.id),
        api.getAccountTrades(account.id),
      ]);

      if (posRes.status === 'fulfilled') {
        setDrawerPositions(posRes.value);
        setDrawerPositionsError(null);
      } else {
        setDrawerPositions([]);
        const errMsg = posRes.reason?.message || 'Failed to load derivative positions';
        setDrawerPositionsError(errMsg);
        if (posRes.reason?.status === 401 || errMsg.toLowerCase().includes('expired')) {
          setIsDrawerSessionExpired(true);
        }
      }

      if (ordRes.status === 'fulfilled') {
        setDrawerOrders(ordRes.value);
        setDrawerOrdersError(null);
      } else {
        setDrawerOrders([]);
        setDrawerOrdersError(ordRes.reason?.message || 'Failed to load order book');
      }

      if (trRes.status === 'fulfilled') {
        setDrawerTrades(trRes.value);
        setDrawerTradesError(null);
      } else {
        setDrawerTrades([]);
        setDrawerTradesError(trRes.reason?.message || 'Failed to load trade executions');
      }

      // Update in-memory persistent cache for this account
      drawerCacheRef.current[account.id] = {
        overview: ovRes.status === 'fulfilled' ? ovRes.value : drawerCacheRef.current[account.id]?.overview,
        holdings: hdRes.status === 'fulfilled' ? hdRes.value : drawerCacheRef.current[account.id]?.holdings,
        positions: posRes.status === 'fulfilled' ? posRes.value : drawerCacheRef.current[account.id]?.positions,
        orders: ordRes.status === 'fulfilled' ? ordRes.value : drawerCacheRef.current[account.id]?.orders,
        trades: trRes.status === 'fulfilled' ? trRes.value : drawerCacheRef.current[account.id]?.trades,
        lastFetched: Date.now(),
      };

      setLastSyncTimestamp(new Date().toLocaleTimeString('en-IN', { hour12: false }) + ' IST');
      const isAccountLive = !account.is_demo && account.auth_status === 'CONNECTED' && (ovRes.status !== 'fulfilled' || !ovRes.value?.is_disconnected);
      if (account.is_demo) {
        setDrawerDataFreshness('CACHED');
      } else if (!isAccountLive) {
        setDrawerDataFreshness('DISCONNECTED');
      } else {
        setDrawerDataFreshness('LIVE');
      }
    } catch (err: any) {
      setDrawerError(err.message || 'Failed to fetch account drawer details.');
      setDrawerDataFreshness('STALE');
    } finally {
      setIsLoadingDrawer(false);
    }
  }, [drawerHoldings.length]);

  const openAccountDrawer = (acc: Account, initialTab: DrawerTab = 'overview') => {
    setSelectedAccountForDrawer(acc);
    setDrawerTab(initialTab);

    // Instant load from memory cache if available (< 20ms)
    const cached = drawerCacheRef.current[acc.id];
    if (cached) {
      if (cached.overview) setDrawerOverview(cached.overview);
      if (cached.holdings) setDrawerHoldings(cached.holdings);
      if (cached.positions) setDrawerPositions(cached.positions);
      if (cached.orders) setDrawerOrders(cached.orders);
      if (cached.trades) setDrawerTrades(cached.trades);
      setDrawerDataFreshness('CACHED');
      if (cached.lastFetched) {
        setLastSyncTimestamp(new Date(cached.lastFetched).toLocaleTimeString('en-IN', { hour12: false }) + ' IST');
      }
    } else {
      // Instant zero-latency fallback overview from account object (eliminates blank spinner)
      setDrawerOverview({
        account_id: acc.id,
        nickname: acc.nickname,
        masked_client_code: acc.masked_client_code,
        account_group: acc.account_group,
        is_enabled: acc.is_enabled,
        is_demo: acc.is_demo,
        auth_status: acc.auth_status,
        ddpi_status: acc.ddpi_status,
        edis_authorized_today: acc.edis_authorized_today,
        available_cash: acc.available_cash,
        total_margin: acc.available_cash,
        utilized_margin: 0,
        total_holdings_count: 0,
        total_holdings_value: 0,
        total_positions_count: 0,
        last_sync_time: acc.last_sync_time,
        data_source: 'ANGEL_ONE_SMARTAPI',
        stale_data_warning: false,
        trading_enabled: acc.auth_status === 'CONNECTED',
        holdings_freshness: 'CACHED',
        market_price_freshness: 'LIVE',
        is_disconnected: acc.auth_status !== 'CONNECTED'
      });
    }

    // Trigger non-blocking staged refresh
    fetchDrawerData(acc, !cached);
  };

  const closeAccountDrawer = () => {
    setSelectedAccountForDrawer(null);
    setDrawerOverview(null);
    setDrawerHoldings([]);
    setDrawerPositions([]);
    setDrawerOrders([]);
    setDrawerTrades([]);
    setDrawerHoldingsError(null);
    setDrawerPositionsError(null);
    setDrawerOrdersError(null);
    setDrawerTradesError(null);
    setIsDrawerSessionExpired(false);
    setDrawerDataFreshness('CACHED');
  };

  // WebSocket Live Price Streaming and Order Book real-time synchronization
  useEffect(() => {
    let ws: WebSocket | null = null;
    let isSubscribed = true;
    let reconnectTimer: any = null;
    let reconnectDelay = 2000;

    const connectWs = () => {
      try {
        const wsUrl = getWebSocketUrl();
        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          if (isSubscribed) {
            setDrawerDataFreshness('LIVE');
            reconnectDelay = 2000;
          }
        };

        ws.onmessage = (event) => {
          if (!isSubscribed) return;
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'TICK' && msg.symbol && typeof msg.ltp === 'number') {
              const sym = msg.symbol.replace('-EQ', '').toUpperCase();
              const tickLtp = msg.ltp;

              // 1. Update Drawer Holdings in real time
              setDrawerHoldings((prev) => {
                let changed = false;
                const updated = prev.map((h) => {
                  const hSym = (h.trading_symbol || h.symbol).replace('-EQ', '').toUpperCase();
                  if (hSym === sym) {
                    changed = true;
                    const newVal = Math.round(h.quantity * tickLtp * 100) / 100;
                    const cost = h.invested_amount || (h.average_price * h.quantity);
                    const newPnl = Math.round((newVal - cost) * 100) / 100;
                    const newPnlPct = cost > 0 ? Math.round((newPnl / cost) * 10000) / 100 : 0.0;
                    const dayPnl = h.close_price ? Math.round((tickLtp - h.close_price) * h.quantity * 100) / 100 : h.day_pnl;
                    const dayPnlPct = h.close_price ? Math.round(((tickLtp - h.close_price) / h.close_price) * 10000) / 100 : h.day_pnl_percentage;

                    return {
                      ...h,
                      current_ltp: tickLtp,
                      valuation: newVal,
                      unrealized_pnl: newPnl,
                      pnl_percentage: newPnlPct,
                      day_pnl: dayPnl,
                      day_pnl_percentage: dayPnlPct,
                      is_market_price_live: true,
                    };
                  }
                  return h;
                });

                if (changed) {
                  const totalVal = updated.reduce((sum, item) => sum + (item.valuation || 0), 0);
                  setDrawerOverview((prevOv) => prevOv ? {
                    ...prevOv,
                    total_holdings_value: Math.round(totalVal * 100) / 100,
                  } : null);
                }
                return updated;
              });

              // 2. Update active Chart & Details modal live if currently open
              setSelectedStockForDetails((prev) => {
                if (!prev) return null;
                const prevSym = (prev.trading_symbol || prev.symbol).replace('-EQ', '').toUpperCase();
                if (prevSym === sym) {
                  const dayPnl = prev.close_price ? Math.round((tickLtp - prev.close_price) * prev.quantity * 100) / 100 : prev.day_pnl;
                  const dayPnlPct = prev.close_price ? Math.round(((tickLtp - prev.close_price) / prev.close_price) * 10000) / 100 : prev.day_pnl_percentage;
                  return {
                    ...prev,
                    current_ltp: tickLtp,
                    day_pnl: dayPnl,
                    day_pnl_percentage: dayPnlPct,
                    valuation: Math.round(prev.quantity * tickLtp * 100) / 100,
                  };
                }
                return prev;
              });

              // 2b. Update Markets & Search search results in real time
              setDrawerMarketsResults((prev) => {
                if (!prev || prev.length === 0) return prev;
                let mChanged = false;
                const mUpdated = prev.map((item) => {
                  const itemSym = item.tradingsymbol.replace('-EQ', '').toUpperCase();
                  if (itemSym === sym || item.symbol_token === msg.symbol_token) {
                    mChanged = true;
                    return {
                      ...item,
                      current_ltp: tickLtp,
                      day_change: msg.change ?? item.day_change,
                      day_change_percentage: msg.change_percent ?? item.day_change_percentage,
                    };
                  }
                  return item;
                });
                return mChanged ? mUpdated : prev;
              });

              // 3. Update Consolidated Portfolio tab holdings & totals in real time
              setPortfolioHoldings((prev) => {
                let pChanged = false;
                const pUpdated = prev.map((h) => {
                  const hSym = h.symbol.replace('-EQ', '').toUpperCase();
                  if (hSym === sym) {
                    pChanged = true;
                    const newMktVal = Math.round(h.total_quantity * tickLtp * 100) / 100;
                    const newPnl = Math.round((newMktVal - h.total_cost) * 100) / 100;
                    const newPnlPct = h.total_cost > 0 ? Math.round((newPnl / h.total_cost) * 10000) / 100 : 0.0;
                    return {
                      ...h,
                      current_ltp: tickLtp,
                      market_value: newMktVal,
                      unrealized_pnl: newPnl,
                      pnl_percentage: newPnlPct,
                      last_updated: new Date().toLocaleTimeString('en-IN', { hour12: false }) + ' IST'
                    };
                  }
                  return h;
                });

                if (pChanged) {
                  const totVal = pUpdated.reduce((s, x) => s + (x.market_value || 0), 0);
                  const totCost = pUpdated.reduce((s, x) => s + (x.total_cost || 0), 0);
                  const totPnl = totVal - totCost;
                  const pnlPct = totCost > 0 ? (totPnl / totCost) * 100 : 0;
                  setPortfolioTotals({
                    totalVal: Math.round(totVal * 100) / 100,
                    totalCost: Math.round(totCost * 100) / 100,
                    totalPnl: Math.round(totPnl * 100) / 100,
                    pnlPct: Math.round(pnlPct * 100) / 100
                  });
                }
                return pUpdated;
              });
            } else if (msg.type === 'ORDER_UPDATE' && msg.order) {
              setDrawerOrders((prev) => {
                const idx = prev.findIndex((o) => o.order_id === msg.order.order_id);
                if (idx >= 0) {
                  const copy = [...prev];
                  copy[idx] = { ...copy[idx], ...msg.order };
                  return copy;
                } else {
                  return [msg.order, ...prev];
                }
              });
            }
          } catch {
            // ignore parsing error
          }
        };

        ws.onerror = () => {
          if (isSubscribed) setDrawerDataFreshness('CACHED');
        };

        ws.onclose = () => {
          if (isSubscribed) {
            setDrawerDataFreshness('DISCONNECTED');
            // Reconnect with gentle backoff (2s, 4s, 8s, max 15s)
            reconnectTimer = setTimeout(connectWs, reconnectDelay);
            reconnectDelay = Math.min(reconnectDelay * 1.5, 15000);
          }
        };
      } catch {
        // WebSocket initialization failure
      }
    };

    connectWs();

    return () => {
      isSubscribed = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws) ws.close();
    };
  }, [selectedAccountForDrawer]);

  // Filtered Orders for Order Book
  const filteredDrawerOrders = useMemo(() => {
    return drawerOrders.filter((o) => {
      const matchesSearch =
        o.symbol.toLowerCase().includes(orderSearchQuery.toLowerCase()) ||
        o.order_id.toLowerCase().includes(orderSearchQuery.toLowerCase());
      if (!matchesSearch) return false;

      if (orderStatusFilter === 'ALL') return true;
      if (orderStatusFilter === 'OPEN') return ['OPEN', 'PENDING', 'TRIGGER PENDING', 'VALIDATION PENDING'].includes(o.status.toUpperCase());
      if (orderStatusFilter === 'COMPLETE') return ['COMPLETE', 'EXECUTED', 'TRADED'].includes(o.status.toUpperCase());
      if (orderStatusFilter === 'CANCELLED') return ['CANCELLED', 'CANCELED'].includes(o.status.toUpperCase());
      if (orderStatusFilter === 'REJECTED') return ['REJECTED', 'FAILED'].includes(o.status.toUpperCase());
      return true;
    });
  }, [drawerOrders, orderSearchQuery, orderStatusFilter]);

  // Filtered Trades for Trade Book
  const filteredDrawerTrades = useMemo(() => {
    return drawerTrades.filter((t) => {
      return (
        t.symbol.toLowerCase().includes(tradeSearchQuery.toLowerCase()) ||
        t.fill_id.toLowerCase().includes(tradeSearchQuery.toLowerCase()) ||
        t.order_id.toLowerCase().includes(tradeSearchQuery.toLowerCase())
      );
    });
  }, [drawerTrades, tradeSearchQuery]);

  // Synchronize on-demand with rate limit protection
  const handleSyncAccount = async (accId: number) => {
    const now = Date.now();
    if (cooldowns[accId] && cooldowns[accId] > now) {
      const remainingSec = Math.ceil((cooldowns[accId] - now) / 1000);
      alert(`Rate limit cooldown active. Please wait ${remainingSec}s before retrying.`);
      return;
    }

    setSyncingAccountIds((prev) => new Set(prev).add(accId));
    try {
      const res = await api.syncAccount(accId);
      // Set 5-second cooldown
      setCooldowns((prev) => ({ ...prev, [accId]: Date.now() + 5000 }));
      onRefresh();
      if (selectedAccountForDrawer?.id === accId) {
        fetchDrawerData(selectedAccountForDrawer);
      }
    } catch (err: any) {
      alert(`Account sync failed: ${err.message}`);
    } finally {
      setSyncingAccountIds((prev) => {
        const next = new Set(prev);
        next.delete(accId);
        return next;
      });
    }
  };

  // Toggle DDPI status manually based on Angel One mobile app status
  const handleToggleDdpi = async (acc: Account) => {
    try {
      const nextStatus = acc.ddpi_status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
      await api.updateAccount(acc.id, { ddpi_status: nextStatus });
      onRefresh();
      if (selectedAccountForDrawer?.id === acc.id) {
        setSelectedAccountForDrawer((prev) => prev ? { ...prev, ddpi_status: nextStatus } : null);
        if (drawerOverview) {
          setDrawerOverview((prev: any) => prev ? { ...prev, ddpi_status: nextStatus } : null);
        }
      }
    } catch (err: any) {
      alert(`Failed to update DDPI status: ${err.message}`);
    }
  };

  // Test SmartAPI connectivity with rate-limiting and optional TOTP
  const handleTestConnection = async (accId: number, totpCode?: string) => {
    const now = Date.now();
    if (cooldowns[accId] && cooldowns[accId] > now) {
      const remainingSec = Math.ceil((cooldowns[accId] - now) / 1000);
      alert(`Rate limit protection active. Please wait ${remainingSec}s before retrying.`);
      return;
    }

    setTestingAccountId(accId);
    setTestResult(null);
    try {
      const res = await api.testAccount(accId, totpCode);
      setTestResult({ id: accId, success: res.success, msg: res.message });
      setCooldowns((prev) => ({ ...prev, [accId]: Date.now() + 3000 }));
      onRefresh();
      if (selectedAccountForDrawer?.id === accId) {
        fetchDrawerData(selectedAccountForDrawer);
      }
      return res;
    } catch (err: any) {
      setTestResult({ id: accId, success: false, msg: err.message });
      return { success: false, message: err.message };
    } finally {
      setTestingAccountId(null);
    }
  };

  // Consolidated Portfolio fetch
  const fetchConsolidatedPortfolio = useCallback(async () => {
    setIsLoadingPortfolio(true);
    try {
      let targetIds: number[] | undefined = undefined;
      if (capitalFilter === 'live') {
        targetIds = accounts.filter((a) => !a.is_demo && a.is_enabled).map((a) => a.id);
      } else if (capitalFilter === 'demo') {
        targetIds = accounts.filter((a) => a.is_demo && a.is_enabled).map((a) => a.id);
      } else {
        targetIds = accounts.filter((a) => a.is_enabled).map((a) => a.id);
      }

      const res = await api.getConsolidatedPortfolio(targetIds);
      setPortfolioHoldings(res.holdings || []);
      setPortfolioTotals({
        totalVal: res.summary?.total_current_value || 0,
        totalCost: res.summary?.total_investment_cost || 0,
        totalPnl: res.summary?.unrealized_pnl || 0,
        pnlPct: res.summary?.unrealized_pnl_percentage || 0,
      });
    } catch (err) {
      console.error('Failed to load consolidated portfolio:', err);
    } finally {
      setIsLoadingPortfolio(false);
    }
  }, [accounts, capitalFilter]);

  // Activity logs fetch
  const fetchActivityLogs = useCallback(async () => {
    setIsLoadingActivity(true);
    try {
      const ev = activityEventType === 'ALL' ? undefined : activityEventType;
      const logs = await api.getAuditLogs(40, 0, ev);
      setAuditLogs(logs);
    } catch (err) {
      console.error('Failed to load activity logs:', err);
    } finally {
      setIsLoadingActivity(false);
    }
  }, [activityEventType]);

  useEffect(() => {
    if (activeTab === 'portfolio') {
      fetchConsolidatedPortfolio();
    } else if (activeTab === 'activity') {
      fetchActivityLogs();
    }
  }, [activeTab, fetchConsolidatedPortfolio, fetchActivityLogs]);

  // Drawer Markets search effect
  useEffect(() => {
    if (drawerTab !== 'markets') return;
    let isSubscribed = true;
    const fetchMarkets = async () => {
      setIsLoadingDrawerMarkets(true);
      try {
        let exchange: string | undefined = undefined;
        let segment: string | undefined = undefined;
        if (drawerMarketsSegment === 'NSE') { exchange = 'NSE'; segment = 'EQUITY'; }
        else if (drawerMarketsSegment === 'BSE') { exchange = 'BSE'; segment = 'EQUITY'; }
        else if (drawerMarketsSegment === 'FUTURES') { segment = 'FUTURES'; }
        else if (drawerMarketsSegment === 'OPTIONS') { segment = 'OPTIONS'; }
        else if (drawerMarketsSegment === 'MCX') { exchange = 'MCX'; segment = 'COMMODITY'; }

        const letter = drawerMarketsLetter !== 'ALL' ? drawerMarketsLetter : undefined;
        const res = await api.searchInstruments({
          query: drawerMarketsSearch || undefined,
          exchange,
          segment,
          letter,
          limit: 30,
          offset: 0
        });
        if (isSubscribed) {
          setDrawerMarketsResults(res.instruments || []);
          // Auto-fetch quotes for searched instruments
          if (res.instruments && res.instruments.length > 0) {
            const tokens = res.instruments
              .filter((i) => i.symbol_token && i.exchange)
              .map((i) => ({ exchange: i.exchange, symbol_token: i.symbol_token }));
            if (tokens.length > 0) {
              api.getBatchMarketQuotes(tokens.slice(0, 50), 'FULL').then((qRes) => {
                if (!isSubscribed || !qRes?.fetched) return;
                const qMap = new Map<string, any>();
                for (const q of qRes.fetched) {
                  if (q.symbol_token) qMap.set(String(q.symbol_token), q);
                  if (q.trading_symbol) qMap.set(q.trading_symbol.replace('-EQ', '').toUpperCase(), q);
                }
                setDrawerMarketsResults((prev) =>
                  prev.map((item) => {
                    const q = (item.symbol_token ? qMap.get(String(item.symbol_token)) : undefined) ||
                              qMap.get(item.tradingsymbol.replace('-EQ', '').toUpperCase());
                    if (q && q.ltp) {
                      const netChg = q.net_change ?? q.change ?? (q.previous_close ? q.ltp - q.previous_close : undefined);
                      const pctChg = q.percent_change ?? q.change_percent ?? (q.previous_close && netChg ? (netChg / q.previous_close) * 100 : undefined);
                      return {
                        ...item,
                        current_ltp: q.ltp,
                        day_change: netChg !== undefined ? Number(netChg) : item.day_change,
                        day_change_percentage: pctChg !== undefined ? Number(pctChg) : item.day_change_percentage,
                      };
                    }
                    return item;
                  })
                );
              }).catch(() => {});
            }
          }
        }
      } catch (err) {
        console.error('Failed to search markets for account drawer:', err);
      } finally {
        if (isSubscribed) setIsLoadingDrawerMarkets(false);
      }
    };

    const t = setTimeout(fetchMarkets, 200);
    return () => { isSubscribed = false; clearTimeout(t); };
  }, [drawerTab, drawerMarketsSearch, drawerMarketsSegment, drawerMarketsLetter]);

  // Drawer Watchlist fetch effect
  useEffect(() => {
    if (drawerTab !== 'watchlist') return;
    let isSubscribed = true;
    const fetchWatchlists = async () => {
      setIsLoadingDrawerWatchlist(true);
      try {
        const wl = await api.getWatchlists();
        if (isSubscribed) {
          setDrawerWatchlists(wl || []);
        }
      } catch (err) {
        console.error('Failed to load watchlists for account drawer:', err);
      } finally {
        if (isSubscribed) setIsLoadingDrawerWatchlist(false);
      }
    };
    fetchWatchlists();
    return () => { isSubscribed = false; };
  }, [drawerTab]);


  const togglePortfolioExpand = (key: string) => {
    setExpandedPortfolioKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

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

  const handleRotateCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rotationAccount) return;
    setIsRotating(true);
    setRotationError(null);
    try {
      const client_code = rotationData.client_code.trim().toUpperCase();
      const api_key = rotationData.api_key.trim();
      const pin = rotationData.pin.trim();
      let cleanTotp = rotationData.totp_secret.trim().replace(/\s+/g, '').replace(/-/g, '').toUpperCase();
      if (cleanTotp.length > 26 && /^[A-Z2-7]{26}$/.test(cleanTotp.slice(-26))) {
        cleanTotp = cleanTotp.slice(-26);
      }

      if (!client_code || !api_key || !pin || !cleanTotp) {
        setRotationError('All credentials (Client Code, API Key, PIN, and Base32 TOTP Secret) are required.');
        setIsRotating(false);
        return;
      }

      const res = await api.reconnectAccount(rotationAccount.id, {
        client_code,
        api_key,
        pin,
        totp_secret: cleanTotp
      });
      if (res.auth_status === 'CONNECTED') {
        setRotationAccount(null);
        setRotationData({ client_code: '', api_key: '', pin: '', totp_secret: '' });
        onRefresh();
      } else {
        setRotationError(res.last_auth_error || 'Connection verification failed with Angel One.');
        onRefresh();
      }
    } catch (err: any) {
      setRotationError(err.message || 'Failed to reconnect account.');
    } finally {
      setIsRotating(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (confirm('Are you sure you want to remove this account profile? Encrypted credentials will be permanently erased.')) {
      try {
        await api.deleteAccount(id);
        onRefresh();
        if (selectedAccountForDrawer?.id === id) closeAccountDrawer();
      } catch (err: any) {
        alert(`Error deleting account: ${err.message}`);
      }
    }
  };

  const handleToggleEnable = async (acc: Account) => {
    try {
      await api.updateAccount(acc.id, { is_enabled: !acc.is_enabled });
      onRefresh();
    } catch (err: any) {
      alert(`Error updating account status: ${err.message}`);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Command Center Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="text-xl font-bold text-slate-900 tracking-tight">Account Command Center</h2>
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
              Angel One SmartAPI
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Multi-demat authentication, verified holdings, derivative positions, and live synchronizations
          </p>
        </div>

        {/* Global Controls & Add Button */}
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => onRefresh()}
            className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold border border-slate-200 transition-colors flex items-center gap-1.5"
            title="Refresh All Account Statuses"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Refresh</span>
          </button>
          <button
            onClick={() => setIsAddModalOpen(true)}
            className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            <span>Connect Angel One Account</span>
          </button>
        </div>
      </div>

      {/* Persistent Disconnection Banner */}
      {accounts.some(a => !a.is_demo && a.auth_status !== 'CONNECTED') && (
        <div className="p-4 bg-amber-50 border border-amber-300 rounded-xl flex items-start sm:items-center justify-between gap-3 text-amber-900 shadow-xs">
          <div className="flex items-start sm:items-center gap-3">
            <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5 sm:mt-0" />
            <div>
              <p className="text-xs font-bold text-amber-950">
                Historical data is available. Live updates and account modifications are disabled until reconnection.
              </p>
              <p className="text-[11px] text-amber-800 mt-0.5">
                One or more Angel One client accounts are disconnected or require reauthentication. Mutating operations and live data polling are suspended. Click Reconnect to update full credentials.
              </p>
            </div>
          </div>
          <span className="text-[10px] uppercase font-bold bg-amber-200 text-amber-900 px-2 py-0.5 rounded border border-amber-300 shrink-0">
            Historical Data Preserved
          </span>
        </div>
      )}

      {/* KPI Cards Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
            <span>Live Connected Accounts</span>
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          </div>
          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-2xl font-bold text-slate-900">{metrics.connectedLive}</span>
            <span className="text-xs text-slate-400 font-normal">/ {metrics.totalLive} authorized</span>
          </div>
          <div className="text-[11px] text-slate-500 mt-1 flex items-center gap-1.5">
            {metrics.errorLive > 0 ? (
              <span className="text-rose-600 font-semibold">{metrics.errorLive} require reconnection</span>
            ) : (
              <span className="text-emerald-600 font-medium">All live sessions healthy</span>
            )}
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
            <span>Verified Available Cash</span>
            <Wallet className="w-4 h-4 text-slate-400" />
          </div>
          <div className="text-2xl font-bold text-slate-900 mt-2 font-mono">
            ₹{metrics.verifiedLiveCash.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            RMS funds across verified live accounts
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
            <span>Consolidated Portfolio</span>
            <PieChart className="w-4 h-4 text-slate-400" />
          </div>
          <div className="text-2xl font-bold text-slate-900 mt-2 font-mono">
            ₹{portfolioTotals.totalVal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[11px] mt-1 flex items-center gap-1.5 font-medium">
            <span className={portfolioTotals.totalPnl >= 0 ? 'text-emerald-600' : 'text-rose-600'}>
              {portfolioTotals.totalPnl >= 0 ? '+' : ''}₹{portfolioTotals.totalPnl.toLocaleString('en-IN', { minimumFractionDigits: 2 })} ({portfolioTotals.pnlPct}%)
            </span>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
            <span>Simulated / Demo Accounts</span>
            <ShieldCheck className="w-4 h-4 text-amber-500" />
          </div>
          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-2xl font-bold text-slate-900">{metrics.totalDemo}</span>
            <span className="text-xs text-amber-700 bg-amber-50 font-semibold px-2 py-0.5 rounded border border-amber-200">
              Isolated
            </span>
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            Protected paper trading buffer pool
          </div>
        </div>
      </div>

      {/* Main Tabs Navigation */}
      <div className="flex items-center gap-2 border-b border-slate-200">
        <button
          onClick={() => setActiveTab('overview')}
          className={`pb-3 px-3 text-xs font-semibold flex items-center gap-2 border-b-2 transition-all ${
            activeTab === 'overview'
              ? 'border-brand-600 text-brand-600'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>Accounts Overview</span>
          <span className="text-[10px] bg-slate-100 text-slate-700 px-1.5 py-0.2 rounded font-bold">
            {filteredAccounts.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('portfolio')}
          className={`pb-3 px-3 text-xs font-semibold flex items-center gap-2 border-b-2 transition-all ${
            activeTab === 'portfolio'
              ? 'border-brand-600 text-brand-600'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          <PieChart className="w-4 h-4" />
          <span>Consolidated Portfolio</span>
        </button>

        <button
          onClick={() => setActiveTab('activity')}
          className={`pb-3 px-3 text-xs font-semibold flex items-center gap-2 border-b-2 transition-all ${
            activeTab === 'activity'
              ? 'border-brand-600 text-brand-600'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          <Activity className="w-4 h-4" />
          <span>Live Activity & Audit</span>
        </button>

        <button
          onClick={() => setActiveTab('reconnect')}
          className={`pb-3 px-3 text-xs font-semibold flex items-center gap-2 border-b-2 transition-all ${
            activeTab === 'reconnect'
              ? 'border-brand-600 text-brand-600'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          <KeyRound className="w-4 h-4" />
          <span>Connection Health</span>
          {metrics.errorLive > 0 && (
            <span className="text-[10px] bg-rose-100 text-rose-700 px-1.5 py-0.2 rounded font-bold">
              {metrics.errorLive}
            </span>
          )}
        </button>
      </div>

      {/* TAB 1: ACCOUNTS OVERVIEW */}
      {activeTab === 'overview' && (
        <div className="space-y-4">
          {/* Controls Bar: Capital Filter, Search & Group Filters */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
            {/* Capital Isolation Selector */}
            <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-lg">
              <button
                onClick={() => setCapitalFilter('live')}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                  capitalFilter === 'live'
                    ? 'bg-white text-emerald-700 shadow-xs font-bold border border-slate-200'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Live Accounts (Real Funds)
              </button>
              <button
                onClick={() => setCapitalFilter('all')}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                  capitalFilter === 'all'
                    ? 'bg-white text-slate-900 shadow-xs font-bold border border-slate-200'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                All Accounts
              </button>
              <button
                onClick={() => setCapitalFilter('demo')}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                  capitalFilter === 'demo'
                    ? 'bg-white text-amber-700 shadow-xs font-bold border border-slate-200'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Demo Pool Only
              </button>
            </div>

            {/* Search & Groups */}
            <div className="flex items-center gap-3 w-full sm:w-auto">
              <div className="relative w-full sm:w-60">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  placeholder="Filter nickname or client..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </div>

              <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg">
                {groups.map((g) => (
                  <button
                    key={g}
                    onClick={() => setSelectedGroup(g)}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
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
          </div>

          {/* Accounts Table */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider font-semibold border-b border-slate-200 text-[10px]">
                  <tr>
                    <th className="py-3 px-4">Account Profile</th>
                    <th className="py-3 px-4">Masked Client Code</th>
                    <th className="py-3 px-4">Group</th>
                    <th className="py-3 px-4">Connection Health</th>
                    <th className="py-3 px-4">DDPI / eDIS</th>
                    <th className="py-3 px-4">Available Cash</th>
                    <th className="py-3 px-4">Last Sync</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredAccounts.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-12 text-center text-slate-400">
                        <Users className="w-8 h-8 mx-auto text-slate-300 mb-2" />
                        <p className="font-semibold text-slate-600">No accounts match the current filter</p>
                        <p className="text-xs text-slate-400 mt-0.5">Try adjusting your search query or capital filter</p>
                      </td>
                    </tr>
                  ) : (
                    filteredAccounts.map((acc) => {
                      const isSyncing = syncingAccountIds.has(acc.id);
                      const isTesting = testingAccountId === acc.id;
                      const hasCooldown = Boolean(cooldowns[acc.id] && cooldowns[acc.id] > Date.now());

                      return (
                        <tr key={acc.id} className="hover:bg-slate-50/80 transition-colors">
                          <td className="py-3.5 px-4 font-semibold text-slate-900">
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => openAccountDrawer(acc)}
                                className="font-semibold text-slate-900 hover:text-brand-600 transition-colors text-left flex items-center gap-1.5"
                              >
                                <span>{acc.nickname}</span>
                                <ExternalLink className="w-3 h-3 text-slate-400" />
                              </button>
                              {acc.is_demo ? (
                                <span className="text-[9px] bg-amber-50 text-amber-800 font-bold px-1.5 py-0.2 rounded border border-amber-200">
                                  SIMULATED
                                </span>
                              ) : (
                                <span className="text-[9px] bg-emerald-50 text-emerald-800 font-bold px-1.5 py-0.2 rounded border border-emerald-200">
                                  LIVE
                                </span>
                              )}
                            </div>
                          </td>

                          <td className="py-3.5 px-4 font-mono text-slate-600 font-medium">
                            {acc.masked_client_code}
                          </td>

                          <td className="py-3.5 px-4">
                            <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-700">
                              {acc.account_group}
                            </span>
                          </td>

                          <td className="py-3.5 px-4">
                            <div className="flex flex-col items-start gap-1">
                              <button
                                onClick={() => {
                                  if (acc.auth_status === 'ERROR' || acc.auth_status === 'EXPIRED') {
                                    setRotationAccount(acc);
                                    setRotationData({ client_code: '', api_key: '', pin: '', totp_secret: '' });
                                  }
                                }}
                                className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold transition-all ${
                                  acc.auth_status === 'CONNECTED'
                                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                    : acc.auth_status === 'ERROR'
                                    ? 'bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 cursor-pointer'
                                    : 'bg-slate-100 text-slate-600 border border-slate-200'
                                }`}
                                title={acc.auth_status === 'ERROR' ? 'Click to reconnect credentials' : undefined}
                              >
                                <span className={`w-1.5 h-1.5 rounded-full ${
                                  acc.auth_status === 'CONNECTED' ? 'bg-emerald-500' : 'bg-rose-500'
                                }`} />
                                {acc.auth_status}
                              </button>
                              {acc.auth_status === 'ERROR' && acc.last_auth_error && (
                                <span
                                  className="text-[10px] text-rose-600 max-w-[170px] truncate leading-tight cursor-help font-medium"
                                  title={acc.last_auth_error}
                                >
                                  {acc.last_auth_error}
                                </span>
                              )}
                            </div>
                          </td>

                          <td className="py-3.5 px-4">
                            <div className="flex items-center gap-1.5">
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-bold cursor-help ${
                                  acc.ddpi_status === 'ACTIVE'
                                    ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                    : 'bg-amber-50 text-amber-800 border border-amber-200'
                                }`}
                                title="SmartAPI does not expose DDPI flags directly. Check Angel One app (Profile -> DDPI Status). Click Inspect to toggle."
                              >
                                DDPI: {acc.ddpi_status}
                              </span>
                            </div>
                          </td>

                          <td className="py-3.5 px-4 font-mono font-medium text-slate-800">
                            {acc.auth_status === 'CONNECTED' && acc.last_sync_time && acc.available_cash !== null && acc.available_cash !== undefined ? (
                              `₹${acc.available_cash.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
                            ) : (
                              <span className="text-slate-400 font-normal italic text-[11px]">Unverified</span>
                            )}
                          </td>

                          <td className="py-3.5 px-4 text-slate-500 text-[11px]">
                            {acc.last_sync_time ? (
                              <div className="flex items-center gap-1">
                                <Clock className="w-3 h-3 text-slate-400" />
                                <span>{new Date(acc.last_sync_time).toLocaleTimeString('en-IN', { hour12: false })}</span>
                              </div>
                            ) : (
                              <span className="text-amber-600 font-medium text-[10px]">Awaiting Sync</span>
                            )}
                          </td>

                          <td className="py-3.5 px-4 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              {acc.auth_status !== 'CONNECTED' ? (
                                <div className="flex items-center gap-1">
                                  <button
                                    onClick={() => handleAutoReconnect(acc)}
                                    disabled={testingAccountId === acc.id}
                                    className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-[11px] font-semibold transition-colors flex items-center gap-1 shadow-xs disabled:opacity-50"
                                    title="Auto-connect using saved TOTP Secret (Zero OTP Prompts)"
                                  >
                                    <RefreshCw className={`w-3 h-3 ${testingAccountId === acc.id ? 'animate-spin' : ''}`} />
                                    <span>{testingAccountId === acc.id ? 'Connecting...' : 'Auto-Connect'}</span>
                                  </button>
                                  <button
                                    onClick={() => {
                                      setRotationAccount(acc);
                                      setRotationData({ client_code: '', api_key: '', pin: '', totp_secret: '' });
                                    }}
                                    className="px-2 py-1 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 rounded text-[11px] font-semibold transition-colors flex items-center gap-1"
                                    title="Reconnect Account with Full Credentials"
                                  >
                                    <KeyRound className="w-3 h-3 text-amber-600" />
                                    <span>Reconnect</span>
                                  </button>
                                </div>
                              ) : (

                                <button
                                  onClick={() => handleSyncAccount(acc.id)}
                                  disabled={isSyncing || hasCooldown}
                                  className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-[11px] font-semibold transition-colors flex items-center gap-1 disabled:opacity-50"
                                  title="Sync live RMS balance and holdings without placing orders"
                                >
                                  <RefreshCw className={`w-3 h-3 ${isSyncing ? 'animate-spin' : ''}`} />
                                  <span>{isSyncing ? 'Syncing...' : hasCooldown ? 'Cooling' : 'Sync'}</span>
                                </button>
                              )}

                              <button
                                onClick={() => openAccountDrawer(acc)}
                                className="px-2.5 py-1 bg-brand-50 hover:bg-brand-100 text-brand-700 rounded text-[11px] font-semibold transition-colors flex items-center gap-1"
                                title="Inspect Account Command Drawer"
                              >
                                <Eye className="w-3 h-3" />
                                <span>Inspect</span>
                              </button>

                              <button
                                onClick={() => handleToggleEnable(acc)}
                                className={`p-1.5 rounded transition-colors ${
                                  acc.is_enabled ? 'text-emerald-600 hover:bg-emerald-50' : 'text-slate-400 hover:bg-slate-100'
                                }`}
                                title={acc.is_enabled ? 'Disable Account' : 'Enable Account'}
                              >
                                <Power className="w-3.5 h-3.5" />
                              </button>

                              <button
                                onClick={() => handleDelete(acc.id)}
                                className="p-1.5 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                                title="Delete Account Connection"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: CONSOLIDATED PORTFOLIO */}
      {activeTab === 'portfolio' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
            <div>
              <h3 className="text-sm font-bold text-slate-900 tracking-tight">Combined Verified Demat Holdings</h3>
              <p className="text-xs text-slate-500">Aggregated delivery shares across accounts with expandable breakdown</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => fetchConsolidatedPortfolio()}
                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold border border-slate-200 transition-colors flex items-center gap-1"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoadingPortfolio ? 'animate-spin' : ''}`} />
                <span>Refresh Portfolio</span>
              </button>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider font-semibold border-b border-slate-200 text-[10px]">
                  <tr>
                    <th className="py-3 px-4 w-8"></th>
                    <th className="py-3 px-4">Instrument</th>
                    <th className="py-3 px-4">ISIN</th>
                    <th className="py-3 px-4 text-right">Total Shares</th>
                    <th className="py-3 px-4 text-right">Avg Price</th>
                    <th className="py-3 px-4 text-right">Current LTP</th>
                    <th className="py-3 px-4 text-right">Market Valuation</th>
                    <th className="py-3 px-4 text-right">Unrealized P&L</th>
                    <th className="py-3 px-4 text-center">Accounts</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {portfolioHoldings.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-12 text-center text-slate-400">
                        <PieChart className="w-8 h-8 mx-auto text-slate-300 mb-2" />
                        <p className="font-semibold text-slate-600">No consolidated holdings found</p>
                        <p className="text-xs text-slate-400 mt-0.5">Allotment and delivery positions will appear here once verified</p>
                      </td>
                    </tr>
                  ) : (
                    portfolioHoldings.map((h, idx) => {
                      const itemKey = h.key || h.isin || h.symbol || `holding-${idx}`;
                      const isExpanded = expandedPortfolioKeys.has(itemKey);
                      return (
                        <React.Fragment key={itemKey}>
                          <tr
                            onClick={() => togglePortfolioExpand(itemKey)}
                            className="hover:bg-slate-50/80 cursor-pointer transition-colors"
                          >
                            <td className="py-3.5 px-4 text-slate-400">
                              {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                            </td>
                            <td className="py-3.5 px-4 font-semibold text-slate-900">
                              <div>{h.symbol}</div>
                              <div className="text-[10px] text-slate-500 font-normal">{h.company_name}</div>
                            </td>
                            <td className="py-3.5 px-4 font-mono text-slate-500">{h.isin}</td>
                            <td className="py-3.5 px-4 text-right font-mono font-medium">{h.total_quantity}</td>
                            <td className="py-3.5 px-4 text-right font-mono">₹{h.average_cost.toFixed(2)}</td>
                            <td className="py-3.5 px-4 text-right font-mono font-bold text-slate-900">₹{h.current_ltp.toFixed(2)}</td>
                            <td className="py-3.5 px-4 text-right font-mono font-bold text-slate-900">
                              ₹{h.market_value.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                            </td>
                            <td className="py-3.5 px-4 text-right font-mono">
                              <span className={`font-semibold ${h.unrealized_pnl >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                {h.unrealized_pnl >= 0 ? '+' : ''}₹{h.unrealized_pnl.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                              </span>
                              <div className={`text-[10px] ${h.unrealized_pnl >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                ({h.pnl_percentage}%)
                              </div>
                            </td>
                            <td className="py-3.5 px-4 text-center">
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700">
                                {h.accounts_count} {h.accounts_count === 1 ? 'Account' : 'Accounts'}
                              </span>
                            </td>
                          </tr>

                          {/* Expandable Per-Account Breakdown */}
                          {isExpanded && h.accounts_breakdown && (
                            <tr>
                              <td colSpan={9} className="bg-slate-50 p-4 border-y border-slate-200">
                                <div className="text-xs font-bold text-slate-700 mb-2">Account-Level Share Distribution</div>
                                <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                                  <table className="w-full text-left text-xs">
                                    <thead className="bg-slate-100 text-slate-500 text-[10px] font-semibold uppercase">
                                      <tr>
                                        <th className="py-2 px-3">Account Nickname</th>
                                        <th className="py-2 px-3">Masked Code</th>
                                        <th className="py-2 px-3">Group</th>
                                        <th className="py-2 px-3 text-right">Quantity</th>
                                        <th className="py-2 px-3 text-right">Avg Cost</th>
                                        <th className="py-2 px-3 text-right">Current Value</th>
                                        <th className="py-2 px-3 text-right">P&L</th>
                                        <th className="py-2 px-3 text-center">DDPI Status</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 text-[11px]">
                                      {h.accounts_breakdown.map((ab) => (
                                        <tr key={ab.account_id} className="hover:bg-slate-50">
                                          <td className="py-2 px-3 font-semibold text-slate-900">{ab.nickname}</td>
                                          <td className="py-2 px-3 font-mono text-slate-600">{ab.masked_client_code}</td>
                                          <td className="py-2 px-3 text-slate-600">{ab.account_group}</td>
                                          <td className="py-2 px-3 text-right font-mono font-medium">{ab.quantity}</td>
                                          <td className="py-2 px-3 text-right font-mono">₹{ab.acquisition_cost.toFixed(2)}</td>
                                          <td className="py-2 px-3 text-right font-mono font-bold text-slate-900">
                                            ₹{ab.market_value.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                                          </td>
                                          <td className={`py-2 px-3 text-right font-mono font-semibold ${
                                            ab.unrealized_pnl >= 0 ? 'text-emerald-600' : 'text-rose-600'
                                          }`}>
                                            {ab.unrealized_pnl >= 0 ? '+' : ''}₹{ab.unrealized_pnl.toFixed(2)} ({ab.pnl_percentage}%)
                                          </td>
                                          <td className="py-2 px-3 text-center">
                                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                              ab.ddpi_status === 'ACTIVE'
                                                ? 'bg-blue-50 text-blue-700'
                                                : 'bg-amber-50 text-amber-700'
                                            }`}>
                                              {ab.ddpi_status}
                                            </span>
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: LIVE ACTIVITY & AUDIT */}
      {activeTab === 'activity' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
            <div>
              <h3 className="text-sm font-bold text-slate-900 tracking-tight">Audit & Synchronization Activity Log</h3>
              <p className="text-xs text-slate-500">Real server-side audit events recorded during session and broker syncs</p>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={activityEventType}
                onChange={(e) => setActivityEventType(e.target.value)}
                className="px-3 py-1.5 bg-slate-100 border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 outline-none"
              >
                <option value="ALL">All Event Types</option>
                <option value="ACCOUNT_SYNCED">Sync Events (ACCOUNT_SYNCED)</option>
                <option value="CONNECTION_TEST">Connection Tests</option>
                <option value="ORDER_EXECUTED">Executed Trades</option>
              </select>
              <button
                onClick={() => fetchActivityLogs()}
                className="px-3 py-1.5 bg-brand-600 text-white rounded-lg text-xs font-semibold shadow-xs hover:bg-brand-700 transition-colors flex items-center gap-1"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoadingActivity ? 'animate-spin' : ''}`} />
                <span>Refresh Logs</span>
              </button>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="divide-y divide-slate-100">
              {auditLogs.length === 0 ? (
                <div className="py-12 text-center text-slate-400">
                  <Activity className="w-8 h-8 mx-auto text-slate-300 mb-2" />
                  <p className="font-semibold text-slate-600">No activity events recorded</p>
                  <p className="text-xs text-slate-400 mt-0.5">Events are automatically logged when accounts synchronize or connect</p>
                </div>
              ) : (
                auditLogs.map((log) => (
                  <div key={log.id} className="p-4 flex items-start justify-between gap-4 hover:bg-slate-50 transition-colors">
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-slate-600 mt-0.5 flex-shrink-0">
                        <Activity className="w-4 h-4 text-brand-600" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-xs text-slate-900">{log.event_type}</span>
                          <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.2 rounded font-mono font-medium">
                            Operator: {log.operator}
                          </span>
                        </div>
                        <p className="text-xs text-slate-600 mt-1 font-mono">
                          {log.details ? JSON.stringify(log.details) : '—'}
                        </p>
                      </div>
                    </div>
                    <div className="text-[11px] text-slate-400 flex items-center gap-1 whitespace-nowrap">
                      <Clock className="w-3 h-3 text-slate-400" />
                      <span>{new Date(log.timestamp).toLocaleString('en-IN', { hour12: false })}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: CONNECTION HEALTH & RECONNECT */}
      {activeTab === 'reconnect' && (
        <div className="space-y-4">
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
            <h3 className="text-sm font-bold text-slate-900 tracking-tight">Angel One Connection Health & Credential Rotation</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Monitor session validity, inspect DDPI statuses, and safely rotate SmartAPI keys or TOTP secrets
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {accounts.map((acc) => {
              const isHealthy = acc.auth_status === 'CONNECTED';
              return (
                <div key={acc.id} className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs space-y-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-slate-900">{acc.nickname}</span>
                        {acc.is_demo ? (
                          <span className="text-[9px] bg-amber-50 text-amber-700 font-bold px-1.5 py-0.5 rounded border border-amber-200">
                            SIMULATED
                          </span>
                        ) : (
                          <span className="text-[9px] bg-emerald-50 text-emerald-700 font-bold px-1.5 py-0.5 rounded border border-emerald-200">
                            LIVE
                          </span>
                        )}
                      </div>
                      <div className="text-xs font-mono text-slate-500 mt-0.5">Client Code: {acc.masked_client_code}</div>
                    </div>
                    <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                      isHealthy
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        : 'bg-rose-50 text-rose-700 border border-rose-200'
                    }`}>
                      {acc.auth_status}
                    </span>
                  </div>

                  <div className="p-3 bg-slate-50 rounded-lg text-xs space-y-2 border border-slate-200/60 font-mono">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 font-sans">
                        <span className="text-slate-500 font-mono">DDPI Status:</span>
                        <span className="text-[10px] text-slate-400 font-sans" title="User-recorded status (App-Managed). SmartAPI does not expose live DDPI verification flags. Verify status in Angel One mobile app (Profile -> DDPI Status).">(User-Recorded)</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          acc.ddpi_status === 'ACTIVE'
                            ? 'bg-blue-50 text-blue-700 border border-blue-200'
                            : 'bg-amber-50 text-amber-800 border border-amber-200'
                        }`}>
                          {acc.ddpi_status}
                        </span>
                        <button
                          onClick={() => handleToggleDdpi(acc)}
                          className="px-2 py-0.5 bg-white hover:bg-slate-100 text-slate-700 text-[10px] font-semibold rounded border border-slate-300 transition-colors shadow-2xs font-sans"
                          title="Record DDPI status based on your Angel One mobile app verification"
                        >
                          {acc.ddpi_status === 'ACTIVE' ? 'Set Inactive' : 'Mark Active'}
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Last Successful Sync:</span>
                      <span className="text-slate-800">{acc.last_sync_time ? new Date(acc.last_sync_time).toLocaleString('en-IN') : 'None'}</span>
                    </div>
                    {acc.last_auth_error && (
                      <div className="pt-2 border-t border-slate-200 text-rose-600 font-sans text-[11px]">
                        Last Error: {acc.last_auth_error}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                    <button
                      onClick={() => {
                        setRotationAccount(acc);
                        setRotationError(null);
                        setRotationData({ client_code: '', api_key: '', pin: '', totp_secret: '' });
                      }}
                      className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5"
                    >
                      <Lock className="w-3.5 h-3.5" />
                      <span>{acc.auth_status === 'CONNECTED' ? 'Rotate Credentials' : 'Reconnect'}</span>
                    </button>
                    <button
                      onClick={() => handleTestConnection(acc.id)}
                      disabled={testingAccountId === acc.id}
                      className="px-3.5 py-1.5 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors flex items-center gap-1.5 disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${testingAccountId === acc.id ? 'animate-spin' : ''}`} />
                      <span>{testingAccountId === acc.id ? 'Testing...' : 'Test Connection'}</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ACCOUNT COMMAND CENTER DRAWER */}
      {selectedAccountForDrawer && (
        <div className="fixed inset-0 z-50 overflow-hidden bg-black/50 flex justify-end">
          <div className="w-full max-w-5xl lg:max-w-6xl xl:max-w-7xl bg-white h-full shadow-2xl flex flex-col border-l border-slate-200 animate-in slide-in-from-right duration-200">
            {/* Drawer Header */}
            <div className="p-4 px-6 border-b border-slate-200 flex items-center justify-between bg-slate-50/70">
              <div className="flex items-center gap-3.5">
                <div className="w-10 h-10 rounded-xl bg-brand-50 border border-brand-200 flex items-center justify-center text-brand-600 font-bold flex-shrink-0">
                  <Users className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-base font-bold text-slate-900">{selectedAccountForDrawer.nickname}</h3>
                    {selectedAccountForDrawer.is_demo ? (
                      <span className="text-[10px] bg-amber-50 text-amber-700 font-bold px-2 py-0.5 rounded border border-amber-200">
                        SIMULATED
                      </span>
                    ) : (
                      <span className="text-[10px] bg-emerald-50 text-emerald-700 font-bold px-2 py-0.5 rounded border border-emerald-200">
                        LIVE DEMAT
                      </span>
                    )}
                    {/* Live Data Freshness Badge */}
                    {!selectedAccountForDrawer.is_demo && selectedAccountForDrawer.auth_status === 'CONNECTED' && !isDrawerSessionExpired && drawerDataFreshness === 'LIVE' && (
                      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        LIVE STREAM
                      </span>
                    )}
                    {drawerDataFreshness === 'SYNCING' && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                        <RefreshCw className="w-2.5 h-2.5 animate-spin text-blue-600" />
                        SYNCING BROKER
                      </span>
                    )}
                    {drawerDataFreshness === 'CACHED' && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                        <Clock className="w-2.5 h-2.5 text-amber-600" />
                        CACHED SNAPSHOT
                      </span>
                    )}
                    {drawerDataFreshness === 'STALE' && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-orange-50 text-orange-700 border border-orange-200">
                        <AlertTriangle className="w-2.5 h-2.5 text-orange-600" />
                        STALE DATA
                      </span>
                    )}
                    {(drawerDataFreshness === 'DISCONNECTED' || selectedAccountForDrawer.auth_status !== 'CONNECTED' || isDrawerSessionExpired) && drawerDataFreshness !== 'SYNCING' && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-300">
                        {isDrawerSessionExpired ? 'SESSION EXPIRED' : selectedAccountForDrawer.auth_status === 'ERROR' ? 'AUTH ERROR' : 'DISCONNECTED'}
                      </span>
                    )}
                    {lastSyncTimestamp && (
                      <span className="text-[10px] text-slate-400 font-mono hidden sm:inline">
                        • {lastSyncTimestamp}
                      </span>
                    )}
                  </div>
                  <div className="text-xs font-mono text-slate-500 mt-0.5">
                    Client Code: <span className="font-semibold text-slate-700">{selectedAccountForDrawer.masked_client_code}</span> | Group: {selectedAccountForDrawer.account_group}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => fetchDrawerData(selectedAccountForDrawer, false)}
                  disabled={isLoadingDrawer}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold flex items-center gap-1 transition-colors"
                  title="Force refresh account data from Angel One"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoadingDrawer ? 'animate-spin text-brand-600' : ''}`} />
                  <span className="hidden sm:inline">Refresh</span>
                </button>
                <button
                  onClick={closeAccountDrawer}
                  className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Notification Banner */}
            {orderSuccessBanner && (
              <div className="mx-6 mt-3 p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-800 flex items-center justify-between animate-in fade-in">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                  <span className="font-semibold">{orderSuccessBanner}</span>
                </div>
                <button onClick={() => setOrderSuccessBanner(null)} className="text-emerald-600 hover:text-emerald-800">
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Drawer Tabs (Angel One Style 8-Tab Terminal) */}
            <div className="flex items-center gap-1 px-6 border-b border-slate-200 bg-white overflow-x-auto">
              {(['overview', 'holdings', 'positions', 'orders', 'trades', 'markets', 'watchlist', 'security'] as DrawerTab[]).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setDrawerTab(tab)}
                  className={`py-3 px-3.5 text-xs font-semibold capitalize border-b-2 whitespace-nowrap transition-all flex items-center gap-1.5 ${
                    drawerTab === tab
                      ? 'border-brand-600 text-brand-600'
                      : 'border-transparent text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <span>
                    {tab === 'orders'
                      ? 'Order Book'
                      : tab === 'trades'
                      ? 'Executed Trades'
                      : tab === 'markets'
                      ? 'Markets / Search & Trade'
                      : tab === 'watchlist'
                      ? 'Watchlist'
                      : tab}
                  </span>
                  {tab === 'holdings' && drawerHoldings.length > 0 && (
                    <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-100 text-slate-700 font-mono font-bold">
                      {drawerHoldings.length}
                    </span>
                  )}
                  {tab === 'orders' && drawerOrders.length > 0 && (
                    <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-100 text-slate-700 font-mono font-bold">
                      {drawerOrders.length}
                    </span>
                  )}
                  {tab === 'trades' && drawerTrades.length > 0 && (
                    <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-emerald-50 text-emerald-700 font-mono font-bold">
                      {drawerTrades.length}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Drawer Body */}
            <div className="p-6 flex-1 overflow-y-auto space-y-4">
              {isLoadingDrawer && !drawerOverview && drawerHoldings.length === 0 ? (
                <div className="py-24 text-center text-slate-400">
                  <RefreshCw className="w-8 h-8 animate-spin mx-auto text-brand-600 mb-2" />
                  <p className="text-xs font-semibold text-slate-600">Retrieving verified broker data...</p>
                </div>
              ) : drawerError ? (
                <div className="p-4 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700 flex items-center justify-between">
                  <span>{drawerError}</span>
                  <button
                    onClick={() => fetchDrawerData(selectedAccountForDrawer, false)}
                    className="px-2.5 py-1 bg-rose-600 text-white rounded text-xs font-bold"
                  >
                    Retry
                  </button>
                </div>
              ) : (
                <>
                  {/* TAB: DRAWER OVERVIEW */}
                  {drawerTab === 'overview' && (
                    <div className="space-y-4">
                      {drawerOverview?.stale_data_warning && (
                        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-center justify-between text-xs text-amber-900">
                          <div className="flex items-center gap-2">
                            <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
                            <span>Data may be outdated (last synchronization was over 12 hours ago or pending).</span>
                          </div>
                          <button
                            onClick={() => handleSyncAccount(selectedAccountForDrawer.id)}
                            className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded text-[11px] font-bold"
                          >
                            Sync Now
                          </button>
                        </div>
                      )}

                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
                          <div className="text-[11px] text-slate-500 font-medium">Available Cash (RMS)</div>
                          <div className="text-xl font-bold font-mono text-slate-900 mt-1">
                            {drawerOverview?.available_cash !== null && drawerOverview?.available_cash !== undefined ? (
                              `₹${drawerOverview.available_cash.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
                            ) : (
                              <span className="text-slate-400 text-sm font-normal">Awaiting Sync</span>
                            )}
                          </div>
                        </div>

                        <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
                          <div className="text-[11px] text-slate-500 font-medium">Delivery Holdings Value</div>
                          <div className="text-xl font-bold font-mono text-slate-900 mt-1">
                            ₹{drawerOverview?.total_holdings_value.toLocaleString('en-IN', { minimumFractionDigits: 2 }) || '0.00'}
                          </div>
                          <div className="text-[10px] text-slate-500 mt-0.5">{drawerOverview?.total_holdings_count || drawerHoldings.length} unique instruments</div>
                        </div>

                        <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
                          <div className="text-[11px] text-slate-500 font-medium">Total Unrealized P&L</div>
                          {(() => {
                            const totVal = drawerHoldings.reduce((s, h) => s + (h.valuation || 0), 0);
                            const totCost = drawerHoldings.reduce((s, h) => s + (h.invested_amount || (h.average_price * h.quantity)), 0);
                            const totPnl = totVal - totCost;
                            const totPct = totCost > 0 ? (totPnl / totCost) * 100 : 0;
                            return (
                              <div className={`text-xl font-bold font-mono mt-1 ${totPnl >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                {totPnl >= 0 ? '+' : ''}₹{totPnl.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                <span className="text-xs font-semibold ml-1">({totPct >= 0 ? '+' : ''}{totPct.toFixed(2)}%)</span>
                              </div>
                            );
                          })()}
                          <div className="text-[10px] text-slate-500 mt-0.5">Overall Demat ledger return</div>
                        </div>

                        <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
                          <div className="text-[11px] text-slate-500 font-medium">Day's P&L</div>
                          {(() => {
                            const dayPnl = drawerHoldings.reduce((s, h) => s + (h.day_pnl || 0), 0);
                            return (
                              <div className={`text-xl font-bold font-mono mt-1 ${dayPnl >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                {dayPnl >= 0 ? '+' : ''}₹{dayPnl.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </div>
                            );
                          })()}
                          <div className="text-[10px] text-slate-500 mt-0.5">Today's market move</div>
                        </div>
                      </div>

                      <div className="p-4 bg-white rounded-xl border border-slate-200 space-y-2.5 text-xs">
                        <div className="font-bold text-slate-900 border-b border-slate-100 pb-2">Profile & Health Audit</div>
                        <div className="flex items-center justify-between py-1">
                          <span className="text-slate-500">Connection State:</span>
                          <span className="font-bold text-slate-800">{drawerOverview?.auth_status || 'UNKNOWN'}</span>
                        </div>
                        <div className="flex items-center justify-between py-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-slate-500">DDPI Status:</span>
                            <span className="text-[10px] text-slate-400" title="User-recorded status (App-Managed). SmartAPI does not expose live DDPI verification flags. Verify in Angel One App (Profile -> DDPI Status).">(User-Recorded)</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`font-bold px-2 py-0.5 rounded text-[11px] ${
                              (drawerOverview?.ddpi_status || selectedAccountForDrawer?.ddpi_status) === 'ACTIVE'
                                ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                : 'bg-amber-50 text-amber-800 border border-amber-200'
                            }`}>
                              {drawerOverview?.ddpi_status || selectedAccountForDrawer?.ddpi_status || 'UNKNOWN'}
                            </span>
                            {selectedAccountForDrawer && (
                              <button
                                onClick={() => handleToggleDdpi(selectedAccountForDrawer)}
                                className="px-2 py-0.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px] font-semibold rounded border border-slate-300 transition-colors shadow-2xs"
                                title="Record DDPI status based on your Angel One mobile app verification"
                              >
                                {(drawerOverview?.ddpi_status || selectedAccountForDrawer.ddpi_status) === 'ACTIVE' ? 'Set Inactive' : 'Mark Active'}
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center justify-between py-1">
                          <span className="text-slate-500">eDIS Authorized Today:</span>
                          <span className="font-bold text-slate-800">{drawerOverview?.edis_authorized_today ? 'Yes' : 'No (TPIN Needed)'}</span>
                        </div>
                        <div className="flex items-center justify-between py-1">
                          <span className="text-slate-500">Last Synchronized:</span>
                          <span className="font-mono text-slate-800">
                            {drawerOverview?.last_sync_time ? new Date(drawerOverview.last_sync_time).toLocaleString('en-IN') : 'None'}
                          </span>
                        </div>
                        <div className="flex items-center justify-between py-1">
                          <span className="text-slate-500">Source:</span>
                          <span className="font-mono text-brand-700 bg-brand-50 px-2 py-0.5 rounded font-semibold text-[10px]">
                            {drawerOverview?.data_source || 'ANGEL_ONE_SMARTAPI'}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* TAB: HOLDINGS (Advanced Angel One Terminal) */}
                  {drawerTab === 'holdings' && (
                    <div>
                      {isDrawerSessionExpired ? (
                        <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl flex items-center justify-between">
                          <div>
                            <div className="font-bold text-xs text-rose-800 flex items-center gap-1.5">
                              <AlertCircle className="w-3.5 h-3.5 text-rose-600" />
                              <span>Angel One Session Expired</span>
                            </div>
                            <p className="text-[11px] text-rose-600 mt-0.5">
                              SmartAPI token has expired. Reconnect credentials to refresh live delivery holdings.
                            </p>
                          </div>
                          <button
                            onClick={() => {
                              setRotationAccount(selectedAccountForDrawer);
                              setRotationError(null);
                              setRotationData({ client_code: '', api_key: '', pin: '', totp_secret: '' });
                            }}
                            className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded text-xs font-bold shadow-xs flex items-center gap-1.5"
                          >
                            <KeyRound className="w-3.5 h-3.5" />
                            <span>Reconnect</span>
                          </button>
                        </div>
                      ) : (
                        <HoldingsTable
                          holdings={drawerHoldings}
                          isLoading={isLoadingDrawer}
                          onRefresh={() => fetchDrawerData(selectedAccountForDrawer, false)}
                          onOpenOrderTicket={(holding: AccountHoldingItem, side: 'BUY' | 'SELL') => {
                            setSelectedStockForOrder(holding);
                            setOrderTicketSide(side);
                            setIsOrderTicketOpen(true);
                          }}
                          onOpenDetailsModal={(holding: AccountHoldingItem, view: 'depth' | 'chart' | 'details' | 'corporate') => {
                            setSelectedStockForDetails(holding);
                            setDetailsModalView(view);
                            setIsDetailsModalOpen(true);
                          }}
                        />
                      )}
                    </div>
                  )}

                  {/* TAB: POSITIONS */}
                  {drawerTab === 'positions' && (
                    <div className="space-y-3">
                      <div className="text-xs text-slate-500 flex items-center justify-between">
                        <span>Intraday & F&O open positions (Strictly separated from Demat holdings)</span>
                        <span className="font-mono text-[11px] font-bold">{drawerPositions.length} Positions</span>
                      </div>
                      {isDrawerSessionExpired ? (
                        <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl flex items-center justify-between">
                          <span className="text-xs text-rose-700 font-semibold">Angel One broker session expired. Reconnect credentials to view open intraday positions.</span>
                          <button
                            onClick={() => {
                              setRotationAccount(selectedAccountForDrawer);
                              setRotationData({ client_code: '', api_key: '', pin: '', totp_secret: '' });
                            }}
                            className="px-2.5 py-1 bg-rose-600 text-white rounded text-[11px] font-bold"
                          >
                            Reconnect
                          </button>
                        </div>
                      ) : drawerPositionsError ? (
                        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900 flex items-center justify-between">
                          <span>{drawerPositionsError}</span>
                          <button
                            onClick={() => fetchDrawerData(selectedAccountForDrawer, false)}
                            className="px-2.5 py-1 bg-amber-600 text-white rounded text-[11px] font-bold"
                          >
                            Retry
                          </button>
                        </div>
                      ) : drawerPositions.length === 0 ? (
                        <div className="py-16 text-center text-slate-400 bg-slate-50 rounded-xl border border-slate-200">
                          <Activity className="w-8 h-8 mx-auto text-slate-300 mb-2" />
                          <p className="font-semibold text-slate-600">No open derivative or intraday positions</p>
                          <p className="text-xs text-slate-400 mt-0.5">Angel One /order/v1/getPosition currently reports 0 open contracts</p>
                        </div>
                      ) : (
                        <div className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-2xs">
                          <table className="w-full text-left text-xs">
                            <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] font-semibold">
                              <tr>
                                <th className="py-2.5 px-3">Symbol</th>
                                <th className="py-2.5 px-3">Product</th>
                                <th className="py-2.5 px-3 text-right">Net Qty</th>
                                <th className="py-2.5 px-4 text-right">Price</th>
                                <th className="py-2.5 px-3 text-right">Unrealized P&L</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 text-[11px]">
                              {drawerPositions.map((p, idx) => (
                                <tr key={idx} className="hover:bg-slate-50">
                                  <td className="py-2.5 px-3 font-semibold text-slate-900">{p.symbol}</td>
                                  <td className="py-2.5 px-3 font-mono text-[10px] text-slate-600">{p.product_type}</td>
                                  <td className="py-2.5 px-3 text-right font-mono font-medium">{p.net_quantity}</td>
                                  <td className="py-2.5 px-3 text-right font-mono font-bold">₹{p.current_ltp?.toFixed(2) || '—'}</td>
                                  <td className={`py-2.5 px-3 text-right font-mono font-semibold ${
                                    (p.unrealized_pnl || 0) >= 0 ? 'text-emerald-600' : 'text-rose-600'
                                  }`}>
                                    {(p.unrealized_pnl || 0) >= 0 ? '+' : ''}₹{p.unrealized_pnl?.toFixed(2) || '0.00'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}

                  {/* TAB: ORDER BOOK (Angel One Enhanced) */}
                  {drawerTab === 'orders' && (
                    <div className="space-y-3">
                      {/* Order Book Toolbar */}
                      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 pb-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {(['ALL', 'OPEN', 'COMPLETE', 'CANCELLED', 'REJECTED'] as const).map((st) => (
                            <button
                              key={st}
                              onClick={() => setOrderStatusFilter(st)}
                              className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors ${
                                orderStatusFilter === st
                                  ? 'bg-slate-900 text-white shadow-2xs'
                                  : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                              }`}
                            >
                              {st === 'ALL' ? 'All Orders' : st}
                            </button>
                          ))}
                        </div>

                        <div className="flex items-center gap-2">
                          <div className="relative">
                            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                            <input
                              type="text"
                              placeholder="Search symbol or Order ID..."
                              value={orderSearchQuery}
                              onChange={(e) => setOrderSearchQuery(e.target.value)}
                              className="pl-8 pr-3 py-1 text-xs border border-slate-300 rounded-lg outline-none focus:ring-1 focus:ring-brand-500 w-44"
                            />
                          </div>
                          <button
                            onClick={() => fetchDrawerData(selectedAccountForDrawer, false)}
                            disabled={isLoadingDrawer}
                            className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 text-xs transition-colors"
                            title="Refresh Order Book"
                          >
                            <RefreshCw className={`w-3.5 h-3.5 ${isLoadingDrawer ? 'animate-spin text-brand-600' : ''}`} />
                          </button>
                        </div>
                      </div>

                      {drawerOrdersError ? (
                        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900 flex items-center justify-between">
                          <span>{drawerOrdersError}</span>
                          <button
                            onClick={() => fetchDrawerData(selectedAccountForDrawer, false)}
                            className="px-2.5 py-1 bg-amber-600 text-white rounded text-[11px] font-bold"
                          >
                            Retry
                          </button>
                        </div>
                      ) : filteredDrawerOrders.length === 0 ? (
                        <div className="py-16 text-center text-slate-400 bg-slate-50 rounded-xl border border-slate-200">
                          <Clock className="w-8 h-8 mx-auto text-slate-300 mb-2" />
                          <p className="font-semibold text-slate-600">No orders available for the selected period.</p>
                          <p className="text-xs text-slate-400 mt-0.5">
                            {orderSearchQuery || orderStatusFilter !== 'ALL'
                              ? 'Try adjusting your search query or status filter.'
                              : 'Angel One /order/v1/getOrderBook reports 0 orders for this trading session.'}
                          </p>
                        </div>
                      ) : (
                        <div className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-2xs">
                          <table className="w-full text-left text-xs">
                            <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] font-semibold border-b border-slate-200">
                              <tr>
                                <th className="py-2.5 px-3">Order ID</th>
                                <th className="py-2.5 px-3">Time</th>
                                <th className="py-2.5 px-3">Symbol</th>
                                <th className="py-2.5 px-3 text-center">Side</th>
                                <th className="py-2.5 px-3">Type / Product</th>
                                <th className="py-2.5 px-3 text-right">Qty</th>
                                <th className="py-2.5 px-3 text-right">Price</th>
                                <th className="py-2.5 px-3 text-center">Status</th>
                                <th className="py-2.5 px-3">Notes</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 text-[11px]">
                              {filteredDrawerOrders.map((o) => {
                                const isBuy = o.transaction_type === 'BUY';
                                const isComplete = ['COMPLETE', 'EXECUTED', 'TRADED'].includes(o.status.toUpperCase());
                                const isPending = ['OPEN', 'PENDING', 'TRIGGER PENDING'].includes(o.status.toUpperCase());
                                const isRejected = ['REJECTED', 'FAILED'].includes(o.status.toUpperCase());

                                return (
                                  <tr key={o.order_id} className="hover:bg-slate-50">
                                    <td className="py-2.5 px-3 font-mono text-slate-600 text-[10px]">{o.order_id}</td>
                                    <td className="py-2.5 px-3 text-slate-500 text-[10px] whitespace-nowrap">
                                      {o.order_timestamp ? new Date(o.order_timestamp).toLocaleTimeString('en-IN') : '—'}
                                    </td>
                                    <td className="py-2.5 px-3">
                                      <div className="font-semibold text-slate-900">{o.symbol}</div>
                                      <div className="text-[10px] text-slate-400 font-mono">{o.exchange || 'NSE'}</div>
                                    </td>
                                    <td className="py-2.5 px-3 text-center">
                                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                        isBuy ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'
                                      }`}>
                                        {o.transaction_type}
                                      </span>
                                    </td>
                                    <td className="py-2.5 px-3">
                                      <div className="text-slate-700 font-medium">{o.order_type || 'LIMIT'}</div>
                                      <div className="text-[10px] text-slate-400 font-mono">{o.product_type || 'DELIVERY'}</div>
                                    </td>
                                    <td className="py-2.5 px-3 text-right font-mono">
                                      <span className="font-semibold text-slate-900">{o.filled_quantity ?? o.quantity}</span>
                                      <span className="text-slate-400">/{o.quantity}</span>
                                    </td>
                                    <td className="py-2.5 px-3 text-right font-mono">
                                      <div className="font-semibold text-slate-900">₹{o.price?.toFixed(2) || '0.00'}</div>
                                      {o.average_price && o.average_price > 0 && o.average_price !== o.price && (
                                        <div className="text-[10px] text-slate-400">Avg ₹{o.average_price.toFixed(2)}</div>
                                      )}
                                    </td>
                                    <td className="py-2.5 px-3 text-center">
                                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                        isComplete
                                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                          : isPending
                                          ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                          : isRejected
                                          ? 'bg-rose-50 text-rose-700 border border-rose-200'
                                          : 'bg-slate-100 text-slate-700'
                                      }`}>
                                        {o.status}
                                      </span>
                                    </td>
                                    <td className="py-2.5 px-3 text-slate-500 text-[10px] max-w-xs truncate" title={o.rejection_reason || ''}>
                                      {o.rejection_reason || '—'}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}

                  {/* TAB: EXECUTED TRADES (Official Trade Book) */}
                  {drawerTab === 'trades' && (
                    <div className="space-y-3">
                      <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-900 text-xs flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                          <span>
                            <strong>Official Broker Trade Book:</strong> Confirmed executed fills only (`/order/v1/getTradeBook`). Unexecuted and pending orders strictly excluded.
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="relative">
                            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                            <input
                              type="text"
                              placeholder="Search trade..."
                              value={tradeSearchQuery}
                              onChange={(e) => setTradeSearchQuery(e.target.value)}
                              className="pl-8 pr-2.5 py-1 text-xs border border-emerald-300 rounded-lg outline-none bg-white w-36"
                            />
                          </div>
                          <button
                            onClick={() => fetchDrawerData(selectedAccountForDrawer, false)}
                            disabled={isLoadingDrawer}
                            className="p-1 rounded-lg border border-emerald-300 bg-white hover:bg-emerald-100 text-emerald-800 transition-colors"
                            title="Refresh Trade Book"
                          >
                            <RefreshCw className={`w-3.5 h-3.5 ${isLoadingDrawer ? 'animate-spin' : ''}`} />
                          </button>
                        </div>
                      </div>

                      {drawerTradesError ? (
                        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900 flex items-center justify-between">
                          <span>{drawerTradesError}</span>
                          <button
                            onClick={() => fetchDrawerData(selectedAccountForDrawer, false)}
                            className="px-2.5 py-1 bg-amber-600 text-white rounded text-[11px] font-bold"
                          >
                            Retry
                          </button>
                        </div>
                      ) : filteredDrawerTrades.length === 0 ? (
                        <div className="py-16 text-center text-slate-400 bg-slate-50 rounded-xl border border-slate-200">
                          <CheckCircle2 className="w-8 h-8 mx-auto text-slate-300 mb-2" />
                          <p className="font-semibold text-slate-600">No executed trade fills today</p>
                          <p className="text-xs text-slate-400 mt-0.5">Confirmed fills will automatically appear here once filled on exchange.</p>
                        </div>
                      ) : (
                        <div className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-2xs">
                          <table className="w-full text-left text-xs">
                            <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] font-semibold border-b border-slate-200">
                              <tr>
                                <th className="py-2.5 px-3">Fill ID</th>
                                <th className="py-2.5 px-3">Order ID</th>
                                <th className="py-2.5 px-3">Time</th>
                                <th className="py-2.5 px-3">Symbol</th>
                                <th className="py-2.5 px-3 text-center">Side</th>
                                <th className="py-2.5 px-3 text-right">Fill Qty</th>
                                <th className="py-2.5 px-3 text-right">Fill Price</th>
                                <th className="py-2.5 px-3 text-right">Trade Value</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 text-[11px]">
                              {filteredDrawerTrades.map((t) => {
                                const tradeVal = t.trade_value || (t.fill_quantity * t.fill_price);
                                return (
                                  <tr key={t.fill_id} className="hover:bg-slate-50">
                                    <td className="py-2.5 px-3 font-mono text-emerald-700 font-bold text-[10px]">{t.fill_id}</td>
                                    <td className="py-2.5 px-3 font-mono text-slate-600 text-[10px]">{t.order_id}</td>
                                    <td className="py-2.5 px-3 text-slate-500 text-[10px] whitespace-nowrap">
                                      {t.trade_time ? new Date(t.trade_time).toLocaleTimeString('en-IN') : '—'}
                                    </td>
                                    <td className="py-2.5 px-3">
                                      <div className="font-semibold text-slate-900">{t.symbol}</div>
                                      <div className="text-[10px] text-slate-400 font-mono">{t.exchange || 'NSE'}</div>
                                    </td>
                                    <td className="py-2.5 px-3 text-center">
                                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                        t.transaction_type === 'BUY' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'
                                      }`}>
                                        {t.transaction_type}
                                      </span>
                                    </td>
                                    <td className="py-2.5 px-3 text-right font-mono font-medium">{t.fill_quantity}</td>
                                    <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">₹{t.fill_price.toFixed(2)}</td>
                                    <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">
                                      ₹{tradeVal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}

                  {/* TAB: MARKETS / SEARCH & TRADE (Account Specific Trading) */}
                  {drawerTab === 'markets' && (
                    <div className="space-y-4">
                      <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <h4 className="font-bold text-xs text-slate-900">Exchange Discovery & Quick Trade</h4>
                            <p className="text-[11px] text-slate-500">
                              Search 151,000+ exchange instruments and execute directly for <strong>{selectedAccountForDrawer.nickname}</strong>.
                            </p>
                          </div>
                          <div className="relative w-64">
                            <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
                            <input
                              type="text"
                              placeholder="Search stock, F&O, MCX..."
                              value={drawerMarketsSearch}
                              onChange={(e) => setDrawerMarketsSearch(e.target.value)}
                              className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-brand-500"
                            />
                          </div>
                        </div>

                        {/* Segment Filter Pills */}
                        <div className="flex items-center gap-1.5 overflow-x-auto text-[11px] pt-1">
                          {(['ALL', 'NSE', 'BSE', 'FUTURES', 'OPTIONS', 'MCX'] as const).map((seg) => (
                            <button
                              key={seg}
                              onClick={() => setDrawerMarketsSegment(seg)}
                              className={`px-2.5 py-1 rounded-md font-semibold transition-colors ${
                                drawerMarketsSegment === seg
                                  ? 'bg-slate-900 text-white'
                                  : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                              }`}
                            >
                              {seg === 'ALL' ? 'All Segments' : seg}
                            </button>
                          ))}
                        </div>

                        {/* A-Z Letter Selector */}
                        <div className="flex items-center gap-1 overflow-x-auto pt-1 text-[10px]">
                          <span className="text-slate-400 font-semibold px-0.5">A–Z:</span>
                          {['ALL', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'].map((ltr) => (
                            <button
                              key={ltr}
                              onClick={() => setDrawerMarketsLetter(ltr)}
                              className={`px-1.5 py-0.5 rounded transition-colors font-medium ${
                                drawerMarketsLetter === ltr
                                  ? 'bg-brand-600 text-white font-bold'
                                  : 'text-slate-600 hover:bg-slate-200'
                              }`}
                            >
                              {ltr}
                            </button>
                          ))}
                        </div>
                      </div>

                      {isLoadingDrawerMarkets ? (
                        <div className="py-16 text-center text-xs text-slate-400">
                          <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-brand-600" />
                          <span>Searching authoritative instrument master...</span>
                        </div>
                      ) : drawerMarketsResults.length === 0 ? (
                        <div className="py-16 text-center text-xs text-slate-400 bg-slate-50 rounded-xl border border-slate-200">
                          <Search className="w-6 h-6 mx-auto text-slate-300 mb-1" />
                          <p className="font-semibold text-slate-600">No matching exchange instruments found</p>
                          <p className="text-[11px] text-slate-400">Try modifying your query or segment filter above</p>
                        </div>
                      ) : (
                        <div className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-2xs">
                          <table className="w-full text-left text-xs">
                            <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] font-semibold border-b border-slate-200">
                              <tr>
                                <th className="py-2.5 px-3">Symbol / Company</th>
                                <th className="py-2.5 px-3">Segment</th>
                                <th className="py-2.5 px-3">Type</th>
                                <th className="py-2.5 px-3 text-right">Lot Size</th>
                                <th className="py-2.5 px-4 text-right">Price</th>
                                <th className="py-2.5 px-4 text-center">Trade Actions</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 text-[11px]">
                              {drawerMarketsResults.map((inst) => (
                                <tr key={`${inst.exchange}_${inst.symbol_token}`} className="hover:bg-slate-50">
                                  <td className="py-2.5 px-3">
                                    <div className="font-bold text-slate-900">{inst.tradingsymbol}</div>
                                    <div className="text-[10px] text-slate-500 truncate max-w-xs">{inst.name}</div>
                                  </td>
                                  <td className="py-2.5 px-3">
                                    <span className="font-semibold text-slate-700">{inst.exchange}</span>
                                    <span className="ml-1 text-[10px] px-1 py-0.2 rounded bg-slate-100 text-slate-600">
                                      {inst.segment}
                                    </span>
                                  </td>
                                  <td className="py-2.5 px-3 text-slate-600">
                                    {inst.instrument_type}
                                    {inst.strike ? ` (₹${inst.strike})` : ''}
                                  </td>
                                  <td className="py-2.5 px-3 text-right font-mono text-slate-700">
                                    {inst.lot_size}
                                  </td>
                                  <td className="py-2.5 px-4 text-right font-mono">
                                    {inst.current_ltp ? (
                                      <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
                                        <span className="font-bold text-slate-900 text-xs">
                                          ₹{inst.current_ltp.toFixed(2)}
                                        </span>
                                        {inst.day_change !== undefined && inst.day_change !== null && (
                                          <span className={`text-[11px] font-semibold flex items-center gap-0.5 ${inst.day_change >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                            <span className="text-[9px]">{inst.day_change >= 0 ? '▲' : '▼'}</span>
                                            <span>{inst.day_change >= 0 ? '+' : ''}{inst.day_change.toFixed(2)} ({inst.day_change_percentage ? `${inst.day_change_percentage >= 0 ? '+' : ''}${inst.day_change_percentage.toFixed(2)}%` : '0.00%'})</span>
                                          </span>
                                        )}
                                      </div>
                                    ) : (
                                      <span className="text-slate-400 text-xs font-normal">—</span>
                                    )}
                                  </td>
                                  <td className="py-2.5 px-4 text-center">
                                    <div className="flex items-center justify-center gap-1.5">
                                      <button
                                        onClick={() => {
                                          setSelectedStockForDetails({
                                            account_id: selectedAccountForDrawer.id,
                                            symbol: inst.tradingsymbol,
                                            trading_symbol: inst.tradingsymbol,
                                            company_name: inst.name,
                                            exchange: inst.exchange,
                                            symbol_token: inst.symbol_token,
                                            quantity: 0,
                                            average_price: inst.current_ltp ?? 0,
                                            current_ltp: inst.current_ltp ?? undefined,
                                            source_type: 'SNAPSHOT'
                                          });
                                          setDetailsModalView('chart');
                                          setIsDetailsModalOpen(true);
                                        }}
                                        className="px-2 py-1 text-[11px] rounded border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-medium"
                                      >
                                        Chart
                                      </button>
                                      <button
                                        onClick={() => {
                                          setSelectedStockForOrder({
                                            account_id: selectedAccountForDrawer.id,
                                            symbol: inst.tradingsymbol,
                                            trading_symbol: inst.tradingsymbol,
                                            company_name: inst.name,
                                            exchange: inst.exchange,
                                            symbol_token: inst.symbol_token,
                                            quantity: 0,
                                            average_price: inst.current_ltp ?? 0,
                                            current_ltp: inst.current_ltp ?? undefined,
                                            source_type: 'SNAPSHOT'
                                          });
                                          setOrderTicketSide('BUY');
                                          setIsOrderTicketOpen(true);
                                        }}
                                        className="px-2.5 py-1 text-[11px] rounded bg-emerald-600 hover:bg-emerald-700 font-bold text-white shadow-2xs"
                                      >
                                        Buy
                                      </button>
                                      <button
                                        onClick={() => {
                                          setSelectedStockForOrder({
                                            account_id: selectedAccountForDrawer.id,
                                            symbol: inst.tradingsymbol,
                                            trading_symbol: inst.tradingsymbol,
                                            company_name: inst.name,
                                            exchange: inst.exchange,
                                            symbol_token: inst.symbol_token,
                                            quantity: 0,
                                            average_price: inst.current_ltp ?? 0,
                                            current_ltp: inst.current_ltp ?? undefined,
                                            source_type: 'SNAPSHOT'
                                          });
                                          setOrderTicketSide('SELL');
                                          setIsOrderTicketOpen(true);
                                        }}
                                        className="px-2.5 py-1 text-[11px] rounded bg-rose-600 hover:bg-rose-700 font-bold text-white shadow-2xs"
                                      >
                                        Sell
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}

                  {/* TAB: WATCHLIST */}
                  {drawerTab === 'watchlist' && (
                    <div className="space-y-4">
                      <div className="border-b border-slate-100 pb-2 flex items-center justify-between">
                        <div>
                          <h4 className="font-bold text-xs text-slate-900">Monitored Watchlists</h4>
                          <p className="text-[11px] text-slate-500">Quick market access for securities tracked by your account portfolio.</p>
                        </div>
                      </div>

                      {isLoadingDrawerWatchlist ? (
                        <div className="py-16 text-center text-xs text-slate-400">
                          <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-brand-600" />
                          <span>Loading watchlists...</span>
                        </div>
                      ) : drawerWatchlists.length === 0 ? (
                        <div className="py-16 text-center text-slate-400 bg-slate-50 rounded-xl border border-slate-200">
                          <Eye className="w-6 h-6 mx-auto text-slate-300 mb-1" />
                          <p className="font-semibold text-slate-600">No watchlists configured</p>
                          <p className="text-[11px] text-slate-400">Add securities to watchlists from the Stock Explorer or Markets tab</p>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {drawerWatchlists.map((wl) => (
                            <div key={wl.id} className="p-4 bg-white rounded-xl border border-slate-200 space-y-3">
                              <div className="flex items-center justify-between">
                                <span className="font-bold text-xs text-slate-900">{wl.name}</span>
                                <span className="text-[10px] text-slate-400 font-mono font-medium">
                                  {wl.items?.length || 0} items
                                </span>
                              </div>
                              {wl.items && wl.items.length > 0 && (
                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                  {wl.items.map((item) => (
                                    <div
                                      key={item.id}
                                      className="p-2.5 rounded-lg border border-slate-200 hover:border-slate-300 bg-slate-50 flex items-center justify-between"
                                    >
                                      <div>
                                        <span className="font-bold text-xs text-slate-900">{item.symbol}</span>
                                        <span className="text-[10px] text-slate-400 block">{item.exchange || 'NSE'}</span>
                                      </div>
                                      <button
                                        onClick={() => {
                                          setSelectedStockForOrder({
                                            account_id: selectedAccountForDrawer.id,
                                            symbol: item.symbol,
                                            trading_symbol: item.symbol,
                                            company_name: item.symbol,
                                            exchange: item.exchange || 'NSE',
                                            quantity: 0,
                                            average_price: 100,
                                            current_ltp: 100,
                                            source_type: 'SNAPSHOT'
                                          });
                                          setOrderTicketSide('BUY');
                                          setIsOrderTicketOpen(true);
                                        }}
                                        className="px-2 py-0.5 text-[10px] font-bold rounded bg-brand-600 text-white hover:bg-brand-700"
                                      >
                                        Trade
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* TAB: SECURITY & CREDENTIALS */}
                  {drawerTab === 'security' && (
                    <div className="space-y-4 text-xs">
                      <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-2.5">
                        <div className="font-bold text-slate-900 border-b border-slate-200 pb-2">Cryptographic Protection</div>
                        <div className="flex items-center justify-between">
                          <span className="text-slate-500">Encryption Method:</span>
                          <span className="font-mono text-slate-800 font-semibold">AES-256 Fernet (CBC + HMAC-SHA256)</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-slate-500">Key Protection:</span>
                          <span className="font-semibold text-emerald-600">Environment Managed (Render Kept)</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-slate-500">Client Code Presentation:</span>
                          <span className="font-mono text-slate-800 font-semibold">{selectedAccountForDrawer.masked_client_code}</span>
                        </div>
                      </div>

                      <div className="flex justify-end pt-2">
                        <button
                          onClick={() => {
                            setRotationAccount(selectedAccountForDrawer);
                            setRotationData({ client_code: '', api_key: '', pin: '', totp_secret: '' });
                          }}
                          className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-lg font-semibold shadow-xs transition-colors flex items-center gap-1.5"
                        >
                          <Lock className="w-4 h-4" />
                          <span>Rotate Encrypted Credentials</span>
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Drawer Footer Actions */}
            <div className="p-4 px-6 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
              <div className="text-[11px] text-slate-400">
                Account ID #{selectedAccountForDrawer.id} • {selectedAccountForDrawer.nickname}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleSyncAccount(selectedAccountForDrawer.id)}
                  disabled={syncingAccountIds.has(selectedAccountForDrawer.id)}
                  className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${syncingAccountIds.has(selectedAccountForDrawer.id) ? 'animate-spin' : ''}`} />
                  <span>Sync Account</span>
                </button>
                <button
                  onClick={closeAccountDrawer}
                  className="px-4 py-1.5 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-xs font-semibold transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CONNECT ACCOUNT MODAL */}
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

            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg flex items-start gap-2.5 text-xs text-blue-900">
              <ShieldCheck className="w-4 h-4 text-brand-600 flex-shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold">Zero-Plaintext Security:</span> Credentials are encrypted at rest using AES-256 Fernet. Raw PINs and TOTP keys are never exposed in responses or logs.
              </div>
            </div>

            {formError && (
              <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700">
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
                  <label className="block text-slate-700 font-medium mb-1">Account PIN</label>
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
                  className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-lg font-semibold shadow-xs transition-colors disabled:opacity-50"
                >
                  {isSubmitting ? 'Encrypting & Saving...' : 'Save & Authorize'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* PERMANENT CREDENTIALS SETUP (1-TIME SETUP - NEVER ASK AGAIN) */}
      {rotationAccount && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900 tracking-tight">
                  Reconnect Account — Update Full Credentials
                </h3>
                <p className="text-xs text-slate-500">{rotationAccount.nickname} ({rotationAccount.masked_client_code})</p>
              </div>
              <button
                onClick={() => setRotationAccount(null)}
                className="text-slate-400 hover:text-slate-600 text-lg leading-none"
              >
                &times;
              </button>
            </div>

            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-800 text-xs leading-relaxed flex items-start gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
              <div>
                <strong>Zero 6-Digit OTP Reconnection:</strong> Submit full credentials to restore live connection. IPOPro computes 2FA codes automatically in the background from your permanent Base32 key — never prompting for temporary 6-digit codes again!
              </div>
            </div>

            {rotationAccount.last_auth_error && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs space-y-1">
                <div className="font-semibold text-rose-800 flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0" />
                  <span>Broker Diagnostic</span>
                </div>
                <p className="text-rose-700 font-mono text-[11px] leading-relaxed break-words">
                  {rotationAccount.last_auth_error}
                </p>
              </div>
            )}

            {rotationError && (
              <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700 font-medium">
                {rotationError}
              </div>
            )}

            <form onSubmit={handleRotateCredentials} className="space-y-3.5 text-xs">
              <div>
                <label className="block text-slate-700 font-medium mb-1">
                  Client Code <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder={`e.g. ${rotationAccount.masked_client_code.replace(/\*/g, 'X')}`}
                  value={rotationData.client_code}
                  onChange={(e) => setRotationData({ ...rotationData, client_code: e.target.value.toUpperCase() })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-1 focus:ring-brand-500 outline-none font-mono uppercase"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-medium mb-1">
                  SmartAPI API Key <span className="text-rose-500">*</span> <span className="text-slate-400 font-normal">(from smartapi.angelone.in)</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="Enter your Angel One SmartAPI App API Key"
                  value={rotationData.api_key}
                  onChange={(e) => setRotationData({ ...rotationData, api_key: e.target.value.trim() })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-1 focus:ring-brand-500 outline-none font-mono"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-medium mb-1">
                  Account PIN / Password <span className="text-rose-500">*</span> <span className="text-slate-400 font-normal">(4-digit trading PIN)</span>
                </label>
                <input
                  type="password"
                  required
                  placeholder="Enter 4-digit Angel One PIN"
                  value={rotationData.pin}
                  onChange={(e) => setRotationData({ ...rotationData, pin: e.target.value.trim() })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-1 focus:ring-brand-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-medium mb-1">
                  TOTP Secret Key (Base32) <span className="text-rose-500">*</span> <span className="text-slate-400 font-normal">(from 'Enable TOTP' QR code)</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. 23VPIQU5UOZ3ZN5ODGMV2GDX4E"
                  value={rotationData.totp_secret}
                  onChange={(e) => {
                    let val = e.target.value.trim().replace(/\s+/g, '').replace(/-/g, '').toUpperCase();
                    if (val.length > 26 && /^[A-Z2-7]{26}$/.test(val.slice(-26))) {
                      val = val.slice(-26);
                    }
                    setRotationData({ ...rotationData, totp_secret: val });
                  }}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-1 focus:ring-brand-500 outline-none font-mono"
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  Enter the permanent Base32 secret string from Angel One TOTP setup. The backend will calculate 6-digit codes automatically forever.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setRotationAccount(null)}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isRotating}
                  className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-lg font-semibold shadow-xs transition-colors disabled:opacity-50 flex items-center gap-1.5"
                >
                  <KeyRound className="w-3.5 h-3.5" />
                  <span>{isRotating ? 'Authenticating & Restoring Connection...' : 'Save Credentials & Reconnect'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ORDER TICKET MODAL */}
      {isOrderTicketOpen && selectedAccountForDrawer && selectedStockForOrder && (
        <OrderTicketModal
          account={selectedAccountForDrawer}
          holding={selectedStockForOrder}
          defaultSide={orderTicketSide}
          isOpen={isOrderTicketOpen}
          onClose={() => {
            setIsOrderTicketOpen(false);
            setSelectedStockForOrder(null);
          }}
          onOrderSuccess={(orderMsg: string) => {
            setOrderSuccessBanner(orderMsg);
            setTimeout(() => setOrderSuccessBanner(null), 6000);
            api.getAccountOrders(selectedAccountForDrawer.id).then((ords) => setDrawerOrders(ords)).catch(() => {});
          }}
        />
      )}

      {/* STOCK DETAILS & MARKET DEPTH MODAL */}
      {isDetailsModalOpen && selectedStockForDetails && (
        <StockDetailsModal
          holding={selectedStockForDetails}
          activeView={detailsModalView}
          isOpen={isDetailsModalOpen}
          onClose={() => {
            setIsDetailsModalOpen(false);
            setSelectedStockForDetails(null);
          }}
          onOpenOrderTicket={(holding: AccountHoldingItem, side: 'BUY' | 'SELL') => {
            setIsDetailsModalOpen(false);
            setSelectedStockForOrder(holding);
            setOrderTicketSide(side);
            setIsOrderTicketOpen(true);
          }}
        />
      )}
    </div>
  );
};
