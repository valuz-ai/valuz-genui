import path from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const resolvePath = (segment: string) => path.resolve(__dirname, segment);

export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: {
      "@valuz-genui/a2ui/catalog": resolvePath("./packages/a2ui/src/catalog/index.ts"),
      "@valuz-genui/a2ui/react": resolvePath("./packages/a2ui/src/react/index.ts"),
      "@valuz-genui/a2ui/stream": resolvePath("./packages/a2ui/src/stream/index.ts"),
      "@valuz-genui/a2ui/theme": resolvePath("./packages/a2ui/src/theme/index.ts"),
      "@valuz-genui/a2ui/gallery": resolvePath("./packages/a2ui/src/gallery/index.ts"),
      "@valuz-genui/a2ui": resolvePath("./packages/a2ui/src/index.ts"),
      "@valuz-genui/core": resolvePath("./packages/core/src/index.ts"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: [resolvePath("./vitest.setup.ts")],
    server: {
      deps: {
        inline: [/@a2ui\//],
      },
    },
    include: [
      `${resolvePath("./packages")}/*/src/**/*.test.{ts,tsx}`,
      `${resolvePath("./apps")}/*/src/**/*.test.{ts,tsx}`,
    ],
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
