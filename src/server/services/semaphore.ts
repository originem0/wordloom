// Concurrency-limiting semaphore — generic primitive, not coupled to any service.

export class Semaphore {
  private queue: (() => void)[] = [];
  private current = 0;
  constructor(private max: number) {}
  async acquire(): Promise<void> {
    if (this.current < this.max) {
      this.current++;
      return;
    }
    return new Promise((resolve) => this.queue.push(resolve));
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
