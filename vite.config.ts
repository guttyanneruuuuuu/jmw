import { defineConfig } from "vite";

export default defineConfig({
  base: "/jmw/",
  server: {
    host: "127.0.0.1",
    port: 5173
  },
  preview: {
    host: "127.0.0.1",
    port: 4173
  },
  build: {
    target: "es2022",
    sourcemap: true
  }
});
