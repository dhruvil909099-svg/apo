import React, { useState, useEffect, useCallback, useRef, Suspense, lazy } from 'react';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { DashboardView } from './views/DashboardView';
import { DashboardSummary, Account, IPO, Order, MarketQuote } from './types';
import { api, getWebSocketUrl } from './api';
import { connectionManager, ConnectionState } from './services/backendConnectionManager';
import { refreshScheduler } from './services/refreshScheduler';
import { accountReadCache } from './services/accountReadCache';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { LoginModal } from './components/LoginModal';

// Route-level Code Splitting for heavy views
const AccountsView = lazy(() => import('./views/AccountsView').then(m => ({ default: m.AccountsView })));
const IPOTrackerView = lazy(() => import('./views/IPOTrackerView').then(m => ({ default: m.IPOTrackerView })));
const MarketWatchView = lazy(() => import('./views/MarketWatchView').then(m => ({ default: m.MarketWatchView })));
const PortfolioView = lazy(() => import('./views/PortfolioView').then(m => ({ default: m.PortfolioView })));
const BulkOrderView = lazy(() => import('./views/BulkOrderView').then(m => ({ default: m.BulkOrderView })));
const OrdersView = lazy(() => import('./views/OrdersView').then(m => ({ default: m.OrdersView })));
const RiskView = lazy(() => import('./views/RiskView').then(m => ({ default: m.RiskView })));
const AlertsView = lazy(() => import('./views/AlertsView').then(m => ({ default: m.AlertsView })));
const SettingsView = lazy(() => import('./views/SettingsView').then(m => ({ default: m.SettingsView })));
const SingleAccountTasksView = lazy(() => import('./views/SingleAccountTasksView').then(m => ({ default: m.SingleAccountTasksView })));
const BulkOperationsView = lazy(() => import('./views/BulkOperationsView').then(m => ({ default: m.BulkOperationsView })));
const StockExplorerView = lazy(() => import('./views/StockExplorerView').then(m => ({ default: m.StockExplorerView })));
const ExportCenterView = lazy(() => import('./views/ExportCenterView').then(m => ({ default: m.ExportCenterView })));
const AIChatView = lazy(() => import('./views/AIChatView').then(m => ({ default: m.AIChatView })));

const ViewSuspenseFallback: React.FC = () => (
  <div className="flex-1 flex flex-col items-center justify-center min-h-[400px] text-slate-400 bg-slate-50/50 rounded-xl">
    <RefreshCw className="w-6 h-6 animate-spin text-[#5b7cfa] mb-2" />
    <span className="text-xs font-medium text-slate-500">Loading module…</span>
  </div>
);

export const App: React.FC = () => {
  const [currentTab, setCurrentTab] = useState<string>('dashboard');
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [ipos, setIpos] = useState<IPO[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [quotes, setQuotes] = useState<MarketQuote[]>([]);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [connState, setConnState] = useState<ConnectionState>(connectionManager.getState());

  // User authentication session state
  const [currentUser, setCurrentUser] = useState<{ id?: number; username: string; role: string } | null>(() => {
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem('ipopro_user');
        return stored ? JSON.parse(stored) : null;
      } catch {
        return null;
      }
    }
    return null;
  });
  const [isLoginModalOpen, setIsLoginModalOpen] = useState<boolean>(false);

  // Cross-view post-order navigation states (Parts 4 & 5)
  const [targetAccountNavigation, setTargetAccountNavigation] = useState<{
    accountId: number;
    initialTab?: string;
    highlightSymbol?: string;
    banner?: string;
  } | null>(null);

  const [targetPortfolioBatch, setTargetPortfolioBatch] = useState<{
    batchId?: string;
    totalOrders?: number;
    successCount?: number;
    failedCount?: number;
    symbol?: string;
    accounts?: Array<{ accountId: number; nickname: string; status: string; orderId?: string; error?: string }>;
  } | null>(null);

  const hasInitiallyLoaded = useRef(false);

  // Subscribe to Connection Manager
  useEffect(() => {
    const unsub = connectionManager.subscribe((st) => {
      setConnState(st);
    });
    connectionManager.initialize();
    return () => unsub();
  }, []);

  // Verify and sync authenticated user session
  useEffect(() => {
    api.getBootstrapStatus()
      .then((st) => {
        if (st.initial_setup_required) {
          setIsLoginModalOpen(true);
        }
      })
      .catch(() => {});

    api.getMe()
      .then((res: any) => {
        if (res && res.authenticated) {
          setCurrentUser(res.user || { username: res.username || 'Operator', role: res.role || 'USER' });
          if (res.must_change_password) {
            setIsLoginModalOpen(true);
          }
        }
      })
      .catch((err: any) => {
        if (err?.status === 401) {
          setCurrentUser(null);
        }
      });
  }, []);

  const handleLogout = async () => {
    accountReadCache.clearAll();
    await api.logout();
    setCurrentUser(null);
    fetchAllData(true);
  };

  // Resilient independent data loading with fast single-roundtrip bootstrap optimization
  const fetchAllData = useCallback(async (isManual = false) => {
    setIsRefreshing(true);
    connectionManager.setLifecycle('LOADING_DATA', 'Synchronizing dashboard records...');

    try {
      // 1. Fast path: Attempt unified bootstrap in a single network round trip
      try {
        const boot = await api.getBootstrap();
        if (boot && boot.summary) {
          setSummary(boot.summary);
          if (Array.isArray(boot.accounts)) setAccounts(boot.accounts);
          if (Array.isArray(boot.ipos)) setIpos(boot.ipos);
          if (Array.isArray(boot.quotes)) setQuotes(boot.quotes);
          // Fetch orders in parallel non-blocking
          api.getOrders().then(o => Array.isArray(o) && setOrders(o)).catch(() => {});
          setLastUpdated(new Date());
          connectionManager.setLifecycle('READY', 'All dashboard sections synchronized');
          setIsRefreshing(false);
          return;
        }
      } catch (bootErr) {
        // Fall back to multi-endpoint parallel fetching if bootstrap is unavailable
      }

      // 2. Resilient parallel fallback
      const [sumRes, accRes, ipoRes, ordRes, quoteRes] = await Promise.allSettled([
        api.getSummary(),
        api.getAccounts(),
        api.getIPOs(),
        api.getOrders(),
        api.getQuotes(),
      ]);

      let atLeastOneSuccess = false;

      if (sumRes.status === 'fulfilled') {
        setSummary(sumRes.value);
        atLeastOneSuccess = true;
      } else {
        console.warn('[App] Failed to load summary:', sumRes.reason);
      }

      if (accRes.status === 'fulfilled') {
        setAccounts(accRes.value);
        atLeastOneSuccess = true;
      } else {
        console.warn('[App] Failed to load accounts:', accRes.reason);
      }

      if (ipoRes.status === 'fulfilled') {
        setIpos(ipoRes.value);
        atLeastOneSuccess = true;
      } else {
        console.warn('[App] Failed to load IPOs:', ipoRes.reason);
      }

      if (ordRes.status === 'fulfilled') {
        setOrders(ordRes.value);
        atLeastOneSuccess = true;
      } else {
        console.warn('[App] Failed to load orders:', ordRes.reason);
      }

      if (quoteRes.status === 'fulfilled') {
        setQuotes(quoteRes.value);
        atLeastOneSuccess = true;
      } else {
        console.warn('[App] Failed to load quotes:', quoteRes.reason);
      }

      if (atLeastOneSuccess) {
        setLastUpdated(new Date());
        connectionManager.setLifecycle('READY', 'All dashboard sections synchronized');
      }
    } catch (err: any) {
      console.error('[App] Unexpected error in fetchAllData:', err);
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  // When connection manager reports CONNECTED for the first time, auto-fetch all data
  useEffect(() => {
    if (
      (connState.lifecycle === 'CONNECTED' || connState.lifecycle === 'READY') &&
      !hasInitiallyLoaded.current
    ) {
      hasInitiallyLoaded.current = true;
      fetchAllData();
    }
  }, [connState.lifecycle, fetchAllData]);

  // Register scheduled background tasks
  useEffect(() => {
    // 1. Dashboard summary refresh (every 30s)
    refreshScheduler.register('summary', 30000, async () => {
      try {
        const sum = await api.getSummary();
        setSummary(sum);
        setLastUpdated(new Date());
      } catch (e) {
        // preserve last-known
      }
    });

    // 2. Accounts list auto-update (every 30s)
    refreshScheduler.register('accounts', 30000, async () => {
      try {
        const accs = await api.getAccounts();
        setAccounts(accs);
      } catch (e) {
        // preserve last-known
      }
    });

    // 3. IPO catalog refresh (every 5 minutes)
    refreshScheduler.register('ipos', 300000, async () => {
      try {
        const ipoList = await api.getIPOs();
        setIpos(ipoList);
      } catch (e) {
        // preserve last-known
      }
    });

    return () => {
      refreshScheduler.destroy();
    };
  }, []);

  const currentTabRef = useRef(currentTab);
  currentTabRef.current = currentTab;
  const pendingTicksRef = useRef<Record<string, { ltp: number; timestamp?: string }>>({});

  // Scoped & Throttled Live WebSocket Tick Streaming
  useEffect(() => {
    const wsUrl = getWebSocketUrl();
    let ws: WebSocket;
    let flushInterval: any = null;

    try {
      ws = new WebSocket(wsUrl);
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'TICK' && msg.symbol && typeof msg.ltp === 'number') {
            // Buffer tick without triggering root component re-renders
            pendingTicksRef.current[msg.symbol] = { ltp: msg.ltp, timestamp: msg.timestamp };
          }
        } catch {
          // ignore malformed tick
        }
      };

      // Throttled flush: only re-render root quotes once every 1,500ms AND only when on dashboard/market-watch
      flushInterval = setInterval(() => {
        const symbols = Object.keys(pendingTicksRef.current);
        if (!symbols.length) return;
        const active = currentTabRef.current;
        if (active !== 'dashboard' && active !== 'market-watch') {
          // Inactive views do not re-render root App for ticker cards
          return;
        }

        const buffer = { ...pendingTicksRef.current };
        pendingTicksRef.current = {};

        setQuotes((prev) => {
          let changed = false;
          const next = prev.map((q) => {
            const update = buffer[q.symbol];
            if (update && (update.ltp !== q.ltp || update.timestamp !== q.timestamp)) {
              changed = true;
              return { ...q, ltp: update.ltp, timestamp: update.timestamp || q.timestamp };
            }
            return q;
          });
          return changed ? next : prev;
        });
      }, 1500);

      ws.onopen = () => {
        const pingInterval = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send('ping');
          }
        }, 15000);
        ws.onclose = () => clearInterval(pingInterval);
      };
    } catch {
      console.warn('[App] WebSocket connection skipped in current environment');
    }

    return () => {
      if (flushInterval) clearInterval(flushInterval);
      if (ws) ws.close();
    };
  }, []);

  const handleToggleKillSwitch = async () => {
    try {
      const res = await api.toggleEmergencyHalt();
      if (summary) {
        setSummary({ ...summary, emergency_trading_disabled: res.emergency_trading_disabled });
      }
      fetchAllData(true);
    } catch (err: any) {
      alert(`Error toggling emergency halt: ${err.message}`);
    }
  };

  const handleManualRefresh = () => {
    connectionManager.checkNow();
    fetchAllData(true);
  };

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden font-sans">
      {/* Dark Navy Sidebar */}
      <Sidebar
        currentTab={currentTab}
        setCurrentTab={setCurrentTab}
        summary={summary}
        onToggleHalt={handleToggleKillSwitch}
      />

      {/* Main Content Workspace */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header */}
        <Header
          currentTab={currentTab}
          summary={summary}
          accounts={accounts}
          onRefresh={handleManualRefresh}
          isRefreshing={isRefreshing}
          lastUpdated={lastUpdated}
          currentUser={currentUser}
          onOpenLogin={() => setIsLoginModalOpen(true)}
          onLogout={handleLogout}
        />

        {/* Transient Connection Notification Strip */}
        {connState.lifecycle === 'RETRYING' && (
          <div className="bg-amber-50 border-b border-amber-200 px-6 py-2 flex items-center justify-between text-xs text-amber-900 transition-all">
            <div className="flex items-center gap-2">
              <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-600" />
              <span>{connState.statusMessage}</span>
            </div>
            <button
              onClick={() => connectionManager.checkNow()}
              className="text-[11px] font-semibold underline text-amber-800 hover:text-amber-950"
            >
              Check Now
            </button>
          </div>
        )}

        {connState.lifecycle === 'OFFLINE' && (
          <div className="bg-slate-100 border-b border-slate-300 px-6 py-2 flex items-center justify-between text-xs text-slate-800 transition-all">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-3.5 h-3.5 text-slate-500" />
              <span>{connState.statusMessage}</span>
            </div>
            <button
              onClick={() => connectionManager.checkNow()}
              className="text-[11px] font-semibold underline text-slate-700 hover:text-slate-900"
            >
              Retry Connection
            </button>
          </div>
        )}

        {/* Tab Content Container */}
        <main className="flex-1 overflow-y-auto p-6">
          <div className="max-w-7xl mx-auto">
            <Suspense fallback={<ViewSuspenseFallback />}>
              {currentTab === 'dashboard' && (
                <DashboardView
                  summary={summary}
                  ipos={ipos}
                  orders={orders}
                  accounts={accounts}
                  onNavigate={(tab) => setCurrentTab(tab)}
                  onRefresh={handleManualRefresh}
                  lastUpdated={lastUpdated}
                />
              )}
              {currentTab === 'accounts' && (
                <AccountsView
                  accounts={accounts}
                  onRefresh={handleManualRefresh}
                  targetAccountNavigation={targetAccountNavigation}
                  onClearTargetNavigation={() => setTargetAccountNavigation(null)}
                />
              )}
              {currentTab === 'ipo-tracker' && (
                <IPOTrackerView ipos={ipos} accounts={accounts} onRefresh={handleManualRefresh} />
              )}
              {currentTab === 'market-watch' && (
                <MarketWatchView quotes={quotes} onRefresh={handleManualRefresh} />
              )}
              {currentTab === 'portfolio' && (
                <PortfolioView
                  batchContext={targetPortfolioBatch}
                  onClearBatchContext={() => setTargetPortfolioBatch(null)}
                  onNavigateToAccount={(accId, tab, sym) => {
                    setTargetAccountNavigation({
                      accountId: accId,
                      initialTab: tab,
                      highlightSymbol: sym
                    });
                    setCurrentTab('accounts');
                  }}
                />
              )}
              {currentTab === 'stock-explorer' && (
                <StockExplorerView
                  ipos={ipos}
                  quotes={quotes}
                  onNavigateToBulkOrders={() => setCurrentTab('bulk-orders')}
                  onNavigateToAccount={(nav) => {
                    setTargetAccountNavigation(nav);
                    setCurrentTab('accounts');
                  }}
                  onNavigateToPortfolioBatch={(batch) => {
                    setTargetPortfolioBatch(batch);
                    setCurrentTab('portfolio');
                  }}
                />
              )}
              {currentTab === 'single-account-tasks' && (
                <SingleAccountTasksView
                  accounts={accounts}
                  ipos={ipos}
                  onRefresh={handleManualRefresh}
                />
              )}
              {currentTab === 'bulk-operations' && (
                <BulkOperationsView
                  accounts={accounts}
                  ipos={ipos}
                  onRefresh={handleManualRefresh}
                  onNavigateToBulkOrders={() => setCurrentTab('bulk-orders')}
                />
              )}
              {currentTab === 'bulk-orders' && (
                <BulkOrderView
                  ipos={ipos}
                  accounts={accounts}
                  onOrderPlaced={handleManualRefresh}
                  onNavigateToBatchActivity={(batch) => {
                    setTargetPortfolioBatch(batch);
                    setCurrentTab('portfolio');
                  }}
                />
              )}
              {currentTab === 'orders' && (
                <OrdersView orders={orders} accounts={accounts} onRefresh={handleManualRefresh} />
              )}
              {currentTab === 'reports' && (
                <ExportCenterView
                  accounts={accounts}
                  ipos={ipos}
                  orders={orders}
                />
              )}
              {currentTab === 'risk' && <RiskView onRefresh={handleManualRefresh} />}
              {currentTab === 'alerts' && <AlertsView />}
              {currentTab === 'ai-chat' && <AIChatView />}
              {currentTab === 'settings' && <SettingsView summary={summary} />}
            </Suspense>
          </div>
        </main>
      </div>

      <LoginModal
        isOpen={isLoginModalOpen}
        onClose={() => setIsLoginModalOpen(false)}
        onLoginSuccess={(u) => {
          setCurrentUser(u);
          fetchAllData(true);
        }}
      />
    </div>
  );
};
export default App;
