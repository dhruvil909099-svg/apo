import React, { useState, useEffect, useCallback } from 'react';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { DashboardView } from './views/DashboardView';
import { AccountsView } from './views/AccountsView';
import { IPOTrackerView } from './views/IPOTrackerView';
import { MarketWatchView } from './views/MarketWatchView';
import { PortfolioView } from './views/PortfolioView';
import { BulkOrderView } from './views/BulkOrderView';
import { OrdersView } from './views/OrdersView';
import { RiskView } from './views/RiskView';
import { AlertsView } from './views/AlertsView';
import { SettingsView } from './views/SettingsView';
import { SingleAccountTasksView } from './views/SingleAccountTasksView';
import { BulkOperationsView } from './views/BulkOperationsView';
import { StockExplorerView } from './views/StockExplorerView';
import { ExportCenterView } from './views/ExportCenterView';
import { DashboardSummary, Account, IPO, Order, MarketQuote } from './types';
import { api } from './api';

export const App: React.FC = () => {
  const [currentTab, setCurrentTab] = useState<string>('dashboard');
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [ipos, setIpos] = useState<IPO[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [quotes, setQuotes] = useState<MarketQuote[]>([]);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  const refreshAllData = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const [sumData, accData, ipoData, ordData, quoteData] = await Promise.all([
        api.getSummary(),
        api.getAccounts(),
        api.getIPOs(),
        api.getOrders(),
        api.getQuotes(),
      ]);
      setSummary(sumData);
      setAccounts(accData);
      setIpos(ipoData);
      setOrders(ordData);
      setQuotes(quoteData);
    } catch (err) {
      console.error('Failed to refresh data:', err);
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    refreshAllData();

    // WebSocket connection for live tick streaming
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/v1/market/ws`;
    let ws: WebSocket;

    try {
      ws = new WebSocket(wsUrl);
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'TICK') {
            setQuotes((prev) =>
              prev.map((q) =>
                q.symbol === msg.symbol ? { ...q, ltp: msg.ltp, timestamp: msg.timestamp } : q
              )
            );
          }
        } catch (e) {
          // ignore
        }
      };
      ws.onopen = () => {
        const pingInterval = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send('ping');
          }
        }, 15000);
        ws.onclose = () => clearInterval(pingInterval);
      };
    } catch (e) {
      console.warn('WebSocket connection not supported in current environment', e);
    }

    return () => {
      if (ws) ws.close();
    };
  }, [refreshAllData]);

  const handleToggleKillSwitch = async () => {
    try {
      const res = await api.toggleEmergencyHalt();
      if (summary) {
        setSummary({ ...summary, emergency_trading_disabled: res.emergency_trading_disabled });
      }
      refreshAllData();
    } catch (err: any) {
      alert(`Error toggling emergency halt: ${err.message}`);
    }
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
          onRefresh={refreshAllData}
          isRefreshing={isRefreshing}
        />

        {/* Tab Content Container */}
        <main className="flex-1 overflow-y-auto p-6">
          <div className="max-w-7xl mx-auto">
            {currentTab === 'dashboard' && (
              <DashboardView
                summary={summary}
                ipos={ipos}
                orders={orders}
                onNavigate={(tab) => setCurrentTab(tab)}
              />
            )}
            {currentTab === 'accounts' && (
              <AccountsView accounts={accounts} onRefresh={refreshAllData} />
            )}
            {currentTab === 'ipo-tracker' && (
              <IPOTrackerView ipos={ipos} accounts={accounts} onRefresh={refreshAllData} />
            )}
            {currentTab === 'market-watch' && (
              <MarketWatchView quotes={quotes} onRefresh={refreshAllData} />
            )}
            {currentTab === 'portfolio' && <PortfolioView />}
            {currentTab === 'stock-explorer' && (
              <StockExplorerView
                ipos={ipos}
                quotes={quotes}
                onNavigateToBulkOrders={() => setCurrentTab('bulk-orders')}
              />
            )}
            {currentTab === 'single-account-tasks' && (
              <SingleAccountTasksView
                accounts={accounts}
                ipos={ipos}
                onRefresh={refreshAllData}
              />
            )}
            {currentTab === 'bulk-operations' && (
              <BulkOperationsView
                accounts={accounts}
                ipos={ipos}
                onRefresh={refreshAllData}
                onNavigateToBulkOrders={() => setCurrentTab('bulk-orders')}
              />
            )}
            {currentTab === 'bulk-orders' && (
              <BulkOrderView ipos={ipos} accounts={accounts} onOrderPlaced={refreshAllData} />
            )}
            {currentTab === 'orders' && (
              <OrdersView orders={orders} accounts={accounts} onRefresh={refreshAllData} />
            )}
            {currentTab === 'reports' && (
              <ExportCenterView
                accounts={accounts}
                ipos={ipos}
                orders={orders}
              />
            )}
            {currentTab === 'risk' && <RiskView onRefresh={refreshAllData} />}
            {currentTab === 'alerts' && <AlertsView />}
            {currentTab === 'settings' && <SettingsView summary={summary} />}
          </div>
        </main>
      </div>
    </div>
  );
};
export default App;
