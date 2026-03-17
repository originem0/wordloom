// Concurrency-limiting semaphore — generic primitive, not coupled to any service.

export class Semaphore {
  private queue: (() => void)[] = [];
  private current = 0;
  constructor(
    private max: number,
    private maxQueue = 50,
    private timeoutMs = 30_000,
  ) {}
  async acquire(): Promise<void> {
    if (this.current < this.max) {
      this.current++;
      return;
    }
    if (this.queue.length >= this.maxQueue) {
      throw new Error("QUEUE_FULL");
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.queue.indexOf(resolve);
        if (idx >= 0) this.queue.splice(idx, 1);
        reject(new Error("QUEUE_TIMEOUT"));
      }, this.timeoutMs);
      const wrapped = () => {
        clearTimeout(timer);
        resolve();
      };
      this.queue.push(wrapped);
    });
  }
  release(): void {
    this.current--;
    const next = this.queue.shift();
    if (next) {
      this.current++;
      next();
    }
  }
}
