import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import dts from "vite-plugin-dts";
import { resolve } from "path";

// Check if we're running the demo or building the library
const isDemoMode =
  process.env["NODE_ENV"] === "development" &&
  !process.argv.includes("--watch");

export default defineConfig({
  plugins: [
    vue(),
    dts({
      rollupTypes: true,
      tsconfigPath: "./tsconfig.app.json",
      include: ["src/**/*.ts", "src/**/*.vue"]
    })
  ]
});
