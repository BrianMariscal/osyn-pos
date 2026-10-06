import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// Versión de la compilación: fecha y hora (hora de México). Se usa en el menú
// de cuenta y en /version.json para saber si hay una versión nueva.
const APP_VERSION = new Date().toLocaleString("sv-SE", { timeZone: "America/Mexico_City" }).slice(0, 16).replace(" ", " · ");

export default defineConfig({
  plugins: [
    {
      name: "version-json",
      generateBundle() {
        this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ version: APP_VERSION }) });
      }
    },
    VitePWA({
      registerType: "prompt",
      includeAssets: ["config.js", "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png"],
      manifest: {
        name: "Abarrotes POS",
        short_name: "Abarrotes",
        id: "/",
        dir: "ltr",
        lang: "es",
        description: "Administración de tu tienda: ventas, inventario, fiado, gastos y cortes por sucursal.",
        categories: ["business", "shopping"],
        start_url: "./",
        scope: "/",
        display: "standalone",
        display_override: ["standalone", "minimal-ui"],
        orientation: "portrait-primary",
        background_color: "#eef3f8",
        theme_color: "#2f6398",
        launch_handler: { client_mode: "navigate-existing" },
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          { src: "icons/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }
        ],
        shortcuts: [
          {
            name: "Nueva venta",
            short_name: "Venta",
            description: "Abrir el punto de venta",
            url: "/?tab=venta",
            icons: [{ src: "icons/icon-192.png", sizes: "192x192", type: "image/png" }]
          },
          {
            name: "Fiado",
            short_name: "Fiado",
            description: "Clientes y saldos de fiado",
            url: "/?tab=fiado",
            icons: [{ src: "icons/icon-192.png", sizes: "192x192", type: "image/png" }]
          },
          {
            name: "Corte de caja",
            short_name: "Corte",
            description: "Cerrar la caja del día",
            url: "/?tab=corte",
            icons: [{ src: "icons/icon-192.png", sizes: "192x192", type: "image/png" }]
          }
        ]
      },
      workbox: {
        // index.html NO se precachea: con internet la página se pide al servidor
        // (siempre la versión actual); sin internet se usa la última copia.
        globPatterns: ["**/*.{js,css,svg,woff2}"],
        navigateFallback: null,
        cleanupOutdatedCaches: true,
        skipWaiting: true,
        clientsClaim: true,
        runtimeCaching: [
          {
            urlPattern: ({ request, url }) => request.mode === "navigate" && !url.pathname.startsWith("/api/"),
            handler: "NetworkFirst",
            options: {
              cacheName: "paginas",
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 5 }
            }
          }
        ]
      }
    })
  ],
  define: {
    // Versión visible en el menú de cuenta: fecha y hora de la compilación (hora de México)
    __APP_VERSION__: JSON.stringify(APP_VERSION)
  },
  build: {
    target: "es2020"
  },
  server: {
    // En `npm run dev` los endpoints /api/* no existen: se delegan a producción.
    proxy: {
      "/api": {
        target: "https://abarrotes-pos-fawn.vercel.app",
        changeOrigin: true,
        secure: true
      }
    }
  }
});
