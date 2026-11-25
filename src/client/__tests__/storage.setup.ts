// Vitest makes window an alias of the test global. Node 26's localStorage
// accessor then hides jsdom's storage, so use the actual DOM window in tests.
// Node-only server tests do not expose jsdom and keep their globals intact.
const domWindow = (globalThis as typeof globalThis & { jsdom?: { window: Window } }).jsdom?.window;
if (domWindow) {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get: () => domWindow.localStorage,
  });
}
