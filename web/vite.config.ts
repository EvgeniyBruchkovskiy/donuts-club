import { defineConfig, loadEnv, type Plugin } from "vite";
import { resolve } from "node:path";

const PAGES = ["account", "feedback", "staff"];

/** Dev/preview: serve /account, /feedback, /staff like Firebase Hosting's cleanUrls does. */
const cleanUrls = (): Plugin => {
  const rewrite = (req: { url?: string }, _res: unknown, next: () => void) => {
    const m = /^\/([a-z]+)(\?.*)?$/.exec(req.url ?? "");
    if (m && PAGES.includes(m[1])) req.url = `/${m[1]}.html${m[2] ?? ""}`;
    next();
  };
  return {
    name: "clean-urls",
    configureServer: (s) => void s.middlewares.use(rewrite),
    configurePreviewServer: (s) => void s.middlewares.use(rewrite),
  };
};

/** Where /api/reviews goes in dev (prod has a Hosting rewrite to the publicReviews function). */
function reviewsApi(env: Record<string, string>): string {
  if (env.VITE_REVIEWS_API) return env.VITE_REVIEWS_API;
  if (env.VITE_USE_EMULATORS === "1") return "http://127.0.0.1:5001/named-vine-322614/europe-central2/publicReviews";
  return "https://europe-central2-named-vine-322614.cloudfunctions.net/publicReviews";
}

export default defineConfig(({ mode }) => ({
  plugins: [cleanUrls()],
  server: {
    proxy: {
      "/api/reviews": { target: reviewsApi(loadEnv(mode, import.meta.dirname, "VITE_")), changeOrigin: true, rewrite: () => "" },
    },
  },
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        ...Object.fromEntries(PAGES.map((p) => [p, resolve(import.meta.dirname, `${p}.html`)])),
      },
    },
  },
}));
