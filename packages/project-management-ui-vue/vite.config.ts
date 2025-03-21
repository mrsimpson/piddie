import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import dts from "vite-plugin-dts";
import { resolve } from "path";

// Check if we're running the demo or building the library
const isDemoMode = process.env["NODE_ENV"] === 'development' && !process.argv.includes('--watch');

export default defineConfig({
    plugins: [
        vue(),
        dts({
            rollupTypes: true,
            tsconfigPath: "./tsconfig.app.json",
            include: ['src/**/*.ts', 'src/**/*.vue'],
        })
    ],
    // When not in demo mode, build as a library
    build: isDemoMode ? {} : {
        lib: {
            entry: resolve(__dirname, "src/index.ts"),
            name: "ProjectManagementUI",
            fileName: (format) => `index.${format}.js`,
            formats: ['es', 'umd']
        },
        outDir: "dist",
        // Extract CSS to a separate file
        cssCodeSplit: false,
        emptyOutDir: true,
        rollupOptions: {
            external: ["vue", "pinia", "vue-router", "@shoelace-style/shoelace"],
            output: {
                // Name the CSS file consistently
                assetFileNames: (assetInfo) => {
                    if ((assetInfo.names && assetInfo.names.some(name => name.endsWith('.css'))) ||
                        (assetInfo.name && assetInfo.name.endsWith('.css'))) {
                        return 'style.css';
                    }
                    return 'assets/[name][extname]';
                },
                globals: {
                    vue: "Vue",
                    pinia: "Pinia",
                    "vue-router": "VueRouter",
                    "@shoelace-style/shoelace": "Shoelace"
                }
            }
        }
    }
});