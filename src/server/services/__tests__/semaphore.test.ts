import { describe, it, expect } from "vitest";
import { Semaphore } from "../semaphore.js";

describe("Semaphore", () => {
  it("allows up to max concurrent acquires immediately", async () => {
    const sem = new Semaphore(3);
    // First 3 should resolve instantly
    await sem.acquire();
    await sem.acquire();
    await sem.acquire();
    // Clean up
    sem.release();
    sem.release();
    sem.release();
  });

  it("blocks the (max+1)th acquire until release", async () => {
    const sem = new Semaphore(3);
    await sem.acquire();
    await sem.acquire();
    await sem.acquire();

    let fourthResolved = false;
    const fourth = sem.acquire().then(() => {
      fourthResolved = true;
    });

    // Give microtasks a chance to flush
    await Promise.resolve();
    expect(fourthResolved).toBe(false);

    sem.release();
    await fourth;
    expect(fourthResolved).toBe(true);

    // Clean up
    sem.release();
    sem.release();
    sem.release();
  });

  it("wakes waiters in FIFO order", async () => {
    const sem = new Semaphore(1);
    await sem.acquire();

    const order: number[] = [];
    const p1 = sem.acquire().then(() => order.push(1));
    const p2 = sem.acquire().then(() => order.push(2));
    const p3 = sem.acquire().then(() => order.push(3));

    sem.release(); // wakes p1
    await p1;
    sem.release(); // wakes p2
    await p2;
    sem.release(); // wakes p3
    await p3;

    expect(order).toEqual([1, 2, 3]);

    sem.release();
  });

  it("recovers when tasks throw (finally releases)", async () => {
    const sem = new Semaphore(1);

    async function failingTask() {
      await sem.acquire();
      try {
        throw new Error("boom");
      } finally {
        sem.release();
      }
    }

    await expect(failingTask()).rejects.toThrow("boom");

    // Semaphore should be available again
    await sem.acquire(); // should not hang
    sem.release();
  });

  it("completes 10 concurrent tasks without deadlock", async () => {
    const sem = new Semaphore(3);
    let peak = 0;
    let current = 0;

    const tasks = Array.from({ length: 10 }, async (_, i) => {
      await sem.acquire();
      current++;
      if (current > peak) peak = current;
      try {
        // Simulate async work
        await new Promise((r) => setTimeout(r, 5));
        return i;
      } finally {
        current--;
        sem.release();
      }
    });

    const results = await Promise.all(tasks);
    expect(results).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("does not leak slots after timeout", async () => {
    const sem = new Semaphore(1, 50, 50); // max=1, timeout=50ms
    await sem.acquire(); // slot occupied

    // This will timeout because slot is held
    await expect(sem.acquire()).rejects.toThrow("QUEUE_TIMEOUT");

    // Release the original slot
    sem.release();

    // Slot should be available — not leaked
    await sem.acquire();
    sem.release();
  });

  it("does not leak slots when release races with timeout", async () => {
    const sem = new Semaphore(1, 50, 30); // very short timeout
    await sem.acquire();

    const results: string[] = [];
    // Queue up several waiters that will all timeout
    const waiters = Array.from({ length: 5 }, () =>
      sem.acquire().then(
        () => results.push("acquired"),
        () => results.push("timeout"),
      ),
    );

    // Wait for all to timeout
    await new Promise((r) => setTimeout(r, 60));
    await Promise.all(waiters);

    sem.release(); // release original

    // All slots should be recovered — acquire must not hang
    const acquired = await Promise.race([
      sem.acquire().then(() => true),
      new Promise<boolean>((r) => setTimeout(() => r(false), 100)),
    ]);
    expect(acquired).toBe(true);
    sem.release();
  });
});
