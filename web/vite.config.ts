import { defineConfig, type Plugin } from "vite";
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

export default defineConfig({
  plugins: [cleanUrls()],
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        ...Object.fromEntries(PAGES.map((p) => [p, resolve(import.meta.dirname, `${p}.html`)])),
      },
    },
  },
});
