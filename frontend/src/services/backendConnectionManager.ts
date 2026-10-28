import { api, getApiBase, TimeoutError, AuthError } from '../api';

export type ConnectionLifecycle =
  | 'APP_STARTING'
  | 'CHECKING_BACKEND'
  | 'CONNECTED'
  | 'LOADING_DATA'
  | 'READY'
  | 'RETRYING'
  | 'AUTHENTICATION_REQUIRED'
  | 'DEGRADED'
  | 'OFFLINE'
  | 'CONFIGURATION_ERROR';

export interface ConnectionState {
  lifecycle: ConnectionLifecycle;
  statusMessage: string;
  lastConnectedTimestamp: number | null;
  lastProbeLatencyMs: number | null;
  retryCount: number;
  nextRetryInSeconds: number | null;
  isWakingUp: boolean;
  isTabActive: boolean;
  backendUrl: string;
  dbStatus: string | null;
}

type ConnectionListener = (state: ConnectionState) => void;

class BackendConnectionManager {
  private state: ConnectionState;
  private listeners: Set<ConnectionListener> = new Set();
  private inFlightProbe: Promise<boolean> | null = null;
  private retryTimer: any = null;
  private countdownTimer: any = null;
  private scheduledPollTimer: any = null;
  private isDestroyed = false;

  constructor() {
    this.state = {
      lifecycle: 'APP_STARTING',
      statusMessage: 'Initializing IPOPro services...',
      lastConnectedTimestamp: null,
      lastProbeLatencyMs: null,
      retryCount: 0,
      nextRetryInSeconds: null,
      isWakingUp: false,
      isTabActive: typeof document !== 'undefined' ? !document.hidden : true,
      backendUrl: getApiBase(),
      dbStatus: null,
    };

    if (typeof window !== 'undefined') {
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
      window.addEventListener('online', this.handleOnline);
      window.addEventListener('offline', this.handleOffline);
    }
  }

  public getState(): ConnectionState {
    return { ...this.state };
  }

  public subscribe(listener: ConnectionListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    const currentState = this.getState();
    this.listeners.forEach((fn) => {
      try {
        fn(currentState);
      } catch (err) {
        console.error('Error in connection listener:', err);
      }
    });
  }

  public setLifecycle(lifecycle: ConnectionLifecycle, message?: string) {
    if (this.state.lifecycle === lifecycle && (!message || this.state.statusMessage === message)) {
      return;
    }
    this.state.lifecycle = lifecycle;
    if (message) this.state.statusMessage = message;
    this.notify();
  }

  /**
   * Initializes the manager and starts the primary health check sequence.
   */
  public async initialize(): Promise<boolean> {
    const url = getApiBase();
    this.state.backendUrl = url;

    // Validate URL syntax
    if (!url || (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('/'))) {
      this.state.lifecycle = 'CONFIGURATION_ERROR';
      this.state.statusMessage = `Invalid backend base URL configured: "${url}"`;
      this.notify();
      return false;
    }

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      this.state.lifecycle = 'OFFLINE';
      this.state.statusMessage = 'Browser is currently offline. Waiting for network connection...';
      this.notify();
      return false;
    }

    this.state.lifecycle = 'CHECKING_BACKEND';
    this.state.statusMessage = 'Connecting to IPOPro services...';
    this.notify();

    return await this.checkNow();
  }

  /**
   * Performs an immediate health check, deduplicating concurrent calls.
   */
  public async checkNow(): Promise<boolean> {
    if (this.inFlightProbe) {
      return this.inFlightProbe;
    }

    this.clearTimers();

    this.inFlightProbe = (async () => {
      try {
        const res = await api.checkHealth();
        this.state.lastProbeLatencyMs = res.latencyMs;

        if (res.ok) {
          this.state.retryCount = 0;
          this.state.nextRetryInSeconds = null;
          this.state.isWakingUp = false;
          this.state.lastConnectedTimestamp = Date.now();

          // Check DB readiness in background
          api.checkReadiness().then((ready) => {
            this.state.dbStatus = ready.database;
            if (!ready.ok) {
              this.state.lifecycle = 'DEGRADED';
              this.state.statusMessage = 'Backend connected, but database readiness check reported degradation.';
              this.notify();
            }
          });

          // Transition to CONNECTED (or remain in LOADING_DATA / READY if already running)
          if (this.state.lifecycle === 'CHECKING_BACKEND' || this.state.lifecycle === 'RETRYING' || this.state.lifecycle === 'OFFLINE') {
            this.state.lifecycle = 'CONNECTED';
            this.state.statusMessage = `Connected to backend (${res.latencyMs}ms)`;
          }

          this.scheduleNextPoll(this.state.isTabActive ? 45000 : 90000);
          this.notify();
          return true;
        }

        // Handle failure
        this.handleFailure(Boolean(res.isWakingUp), res.detail);
        return false;
      } catch (err: any) {
        if (err instanceof AuthError) {
          this.state.lifecycle = 'AUTHENTICATION_REQUIRED';
          this.state.statusMessage = 'Backend reachable, but master API key rejected. Check Settings.';
          this.notify();
          return false;
        }
        const isTimeout = err instanceof TimeoutError || (err.message && err.message.includes('timed out'));
        this.handleFailure(isTimeout, err.message);
        return false;
      } finally {
        this.inFlightProbe = null;
      }
    })();

    return this.inFlightProbe;
  }

  private handleFailure(isWakingUp: boolean, detail?: string) {
    this.state.retryCount++;
    this.state.isWakingUp = isWakingUp;

    // Calculate exponential backoff with jitter: 2s, 4s, 7s, 11s, 17s... capped at 30s
    const base = Math.min(30, Math.round(Math.pow(1.5, Math.min(this.state.retryCount, 7)) * 2));
    const jitter = Math.floor(Math.random() * 3);
    const delaySeconds = Math.min(30, base + jitter);

    this.state.lifecycle = 'RETRYING';
    this.state.nextRetryInSeconds = delaySeconds;

    if (isWakingUp) {
      this.state.statusMessage = `Backend is waking up (Render cold-start). Retrying automatically in ${delaySeconds}s...`;
    } else {
      this.state.statusMessage = `Connection interrupted. Retrying automatically in ${delaySeconds}s...`;
    }
    this.notify();

    // Start 1-second countdown ticker for UX feedback
    let remaining = delaySeconds;
    this.countdownTimer = setInterval(() => {
      remaining--;
      if (remaining > 0) {
        this.state.nextRetryInSeconds = remaining;
        if (this.state.isWakingUp) {
          this.state.statusMessage = `Backend is waking up (Render cold-start). Retrying automatically in ${remaining}s...`;
        } else {
          this.state.statusMessage = `Connection interrupted. Retrying automatically in ${remaining}s...`;
        }
        this.notify();
      } else {
        clearInterval(this.countdownTimer);
        this.countdownTimer = null;
      }
    }, 1000);

    // Schedule actual retry
    this.retryTimer = setTimeout(() => {
      if (!this.isDestroyed) {
        this.checkNow();
      }
    }, delaySeconds * 1000);
  }

  private scheduleNextPoll(intervalMs: number) {
    this.clearTimers();
    this.scheduledPollTimer = setTimeout(() => {
      if (!this.isDestroyed) {
        this.checkNow();
      }
    }, intervalMs);
  }

  private clearTimers() {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
    if (this.scheduledPollTimer) {
      clearTimeout(this.scheduledPollTimer);
      this.scheduledPollTimer = null;
    }
  }

  private handleVisibilityChange = () => {
    if (typeof document === 'undefined') return;
    const isVisible = !document.hidden;
    this.state.isTabActive = isVisible;

    if (isVisible) {
      // If we were retrying or our last check was >30s ago, probe immediately
      const now = Date.now();
      const lastCheck = this.state.lastConnectedTimestamp || 0;
      if (this.state.lifecycle === 'RETRYING' || this.state.lifecycle === 'OFFLINE' || now - lastCheck > 30000) {
        this.checkNow();
      } else {
        this.scheduleNextPoll(45000);
      }
    } else {
      // Slow down polling when hidden to conserve resources
      this.scheduleNextPoll(90000);
    }
    this.notify();
  };

  private handleOnline = () => {
    this.state.statusMessage = 'Network restored. Reconnecting to IPOPro services...';
    this.state.lifecycle = 'CHECKING_BACKEND';
    this.notify();
    this.checkNow();
  };

  private handleOffline = () => {
    this.clearTimers();
    this.state.lifecycle = 'OFFLINE';
    this.state.statusMessage = 'Internet connection lost. You are currently offline.';
    this.notify();
  };

  public destroy() {
    this.isDestroyed = true;
    this.clearTimers();
    this.listeners.clear();
    if (typeof window !== 'undefined') {
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
      window.removeEventListener('online', this.handleOnline);
      window.removeEventListener('offline', this.handleOffline);
    }
  }
}

export const connectionManager = new BackendConnectionManager();
