import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "dist/mcp",
    emptyOutDir: true,
    cssCodeSplit: false,
    lib: {
      entry: resolve(__dirname, "src/mcp-main.tsx"),
      formats: ["es"],
      fileName: "app",
    },
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
});
