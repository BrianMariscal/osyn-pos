import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
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
        globPatterns: ["**/*.{js,css,html,svg,woff2}"],
        navigateFallback: "index.html",
        cleanupOutdatedCaches: true,
        navigateFallbackDenylist: [/^\/api\//]
      }
    })
  ],
  define: {
    // Versión visible en el menú de cuenta: fecha y hora de la compilación (hora de México)
    __APP_VERSION__: JSON.stringify(
      new Date().toLocaleString("sv-SE", { timeZone: "America/Mexico_City" }).slice(0, 16).replace(" ", " · ")
    )
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
