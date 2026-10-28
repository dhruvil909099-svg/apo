type TaskCallback = () => Promise<any>;

interface ScheduledTask {
  id: string;
  intervalMs: number;
  fn: TaskCallback;
  lastExecuted: number | null;
  timer: any;
  inFlightPromise: Promise<any> | null;
}

class RefreshScheduler {
  private tasks: Map<string, ScheduledTask> = new Map();
  private isPaused = false;
  private isDestroyed = false;

  constructor() {
    if (typeof window !== 'undefined') {
      document.addEventListener('visibilitychange', this.handleVisibility);
    }
  }

  /**
   * Registers a periodic task. Replaces any existing task with the same ID.
   */
  public register(id: string, intervalMs: number, fn: TaskCallback): void {
    this.unregister(id);

    const task: ScheduledTask = {
      id,
      intervalMs,
      fn,
      lastExecuted: null,
      timer: null,
      inFlightPromise: null,
    };

    this.tasks.set(id, task);
    this.schedule(task);
  }

  /**
   * Triggers a task immediately. If the task is already running, joins the in-flight execution.
   */
  public async trigger(id: string): Promise<any> {
    const task = this.tasks.get(id);
    if (!task) return;

    if (task.inFlightPromise) {
      return task.inFlightPromise;
    }

    return this.execute(task);
  }

  private async execute(task: ScheduledTask): Promise<any> {
    if (task.inFlightPromise) {
      return task.inFlightPromise;
    }

    task.inFlightPromise = (async () => {
      try {
        const result = await task.fn();
        task.lastExecuted = Date.now();
        return result;
      } catch (err) {
        console.warn(`[RefreshScheduler] Task "${task.id}" execution error:`, err);
      } finally {
        task.inFlightPromise = null;
        if (!this.isPaused && !this.isDestroyed) {
          this.schedule(task);
        }
      }
    })();

    return task.inFlightPromise;
  }

  private schedule(task: ScheduledTask): void {
    if (task.timer) {
      clearTimeout(task.timer);
      task.timer = null;
    }

    if (this.isPaused || this.isDestroyed) return;

    task.timer = setTimeout(() => {
      if (!this.isPaused && !this.isDestroyed) {
        this.execute(task);
      }
    }, task.intervalMs);
  }

  private handleVisibility = () => {
    if (typeof document === 'undefined') return;
    const isVisible = !document.hidden;

    if (isVisible) {
      this.isPaused = false;
      // When user returns to tab, run any task that is stale (has been longer than intervalMs since last execution)
      const now = Date.now();
      this.tasks.forEach((task) => {
        const elapsed = now - (task.lastExecuted || 0);
        if (elapsed >= task.intervalMs) {
          this.execute(task);
        } else {
          this.schedule(task);
        }
      });
    } else {
      this.isPaused = true;
      // Pause all timers while tab is inactive
      this.tasks.forEach((task) => {
        if (task.timer) {
          clearTimeout(task.timer);
          task.timer = null;
        }
      });
    }
  };

  public unregister(id: string): void {
    const existing = this.tasks.get(id);
    if (existing) {
      if (existing.timer) clearTimeout(existing.timer);
      this.tasks.delete(id);
    }
  }

  public destroy(): void {
    this.isDestroyed = true;
    this.tasks.forEach((task) => {
      if (task.timer) clearTimeout(task.timer);
    });
    this.tasks.clear();
    if (typeof window !== 'undefined') {
      document.removeEventListener('visibilitychange', this.handleVisibility);
    }
  }
}

export const refreshScheduler = new RefreshScheduler();
