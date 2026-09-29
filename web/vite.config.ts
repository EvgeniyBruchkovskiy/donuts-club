import { defineConfig, type Plugin } from "vite";
import { resolve } from "node:path";

/** Dev/preview: serve /account like Firebase Hosting's cleanUrls does. */
const cleanUrls = (): Plugin => {
  const rewrite = (req: { url?: string }, _res: unknown, next: () => void) => {
    if (req.url === "/account" || req.url?.startsWith("/account?")) req.url = req.url.replace("/account", "/account.html");
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
        account: resolve(import.meta.dirname, "account.html"),
      },
    },
  },
});
