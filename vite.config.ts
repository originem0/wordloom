import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { VitePWA } from "vite-plugin-pwa"
import { runtimeCaching } from "./tools/pwa-cache.ts"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "prompt",
      // index.html links the install manifest in public/ for both dev and production.
      manifest: false,
      includeAssets: ["manifest.json"],
      workbox: {
        cacheId: "wordloom",
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        runtimeCaching,
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  build: {
    outDir: "dist/client",
    rollupOptions: {
      output: {
        // Keep dependency code in a separate chunk so its hash survives app-code
        // deploys — with immutable asset caching, returning visitors only
        // re-download the (small) app chunks.
        manualChunks(id) {
          if (id.includes("node_modules")) return "vendor";
        },
      },
    },
  },
  server: {
    proxy: {
      // xfwd: the API is told whom a proxied request came from. The switch that
      // opens the expression library to this machine alone goes by it.
      "/api": { target: "http://localhost:3001", xfwd: true },
    },
  },
})
