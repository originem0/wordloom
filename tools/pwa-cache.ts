/** Only these public API responses are available to offline readers. Workbox
 * serializes the matcher into the worker, so it must use only its arguments. */
export const runtimeCaching = [{
  urlPattern: ({ url, sameOrigin }: { url: URL; sameOrigin: boolean }) =>
    sameOrigin && /^\/api\/cards(?:\/\d+)?$/.test(url.pathname),
  handler: "NetworkFirst" as const,
  options: {
    cacheName: "wordloom-cards-cache",
    expiration: { maxEntries: 100, maxAgeSeconds: 7 * 24 * 60 * 60 },
    cacheableResponse: { statuses: [200] },
  },
}];
