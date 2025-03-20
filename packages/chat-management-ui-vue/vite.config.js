import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import dts from "vite-plugin-dts";
import { resolve } from "path";
import { viteStaticCopy } from "vite-plugin-static-copy";

const iconsPath = "node_modules/@shoelace-style/shoelace/dist/assets/icons";

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [
        vue({
            template: {
                compilerOptions: {
                    // Tell Vue to ignore all components that start with 'sl-'
                    isCustomElement: (tag) => tag.startsWith("sl-")
                }
            }
        }),
        dts({
            include: ["src/**/*.ts", "src/**/*.vue"],
            outDir: "dist",
            staticImport: true,
            insertTypesEntry: true,
        }),
        viteStaticCopy({
            targets: [
                {
                    src: iconsPath,
                    dest: "assets"
                }
            ]
        })
    ],
    resolve: {
        alias: {
            "@": fileURLToPath(new URL("./src", import.meta.url)),
        }
    },
    build: {
        lib: {
            // Set the entry point (required)
            entry: resolve(__dirname, "src/index.ts"),
            // Name of the library (required)
            name: "ChatManagementUI",
            // File name for generated bundles
            fileName: (format) => `index.${format}.js`,
            // Generate ESM & UMD formats
            formats: ["es", "umd"],
        },
        // Ensure the CSS is extracted
        cssCodeSplit: true,
        // Generate source maps
        sourcemap: true,
        // Clear the output directory before building
        emptyOutDir: true,
        // Don't minify for clearer debugging
        minify: false,
        // Customize Rollup bundling
        rollupOptions: {
            // Make sure to externalize dependencies that shouldn't be bundled
            external: [
                "vue",
                "pinia",
                "vue-router",
                "@shoelace-style/shoelace",
                "@piddie/chat-management"
            ],
            output: {
                // Provide globals for UMD build
                globals: {
                    vue: "Vue",
                    pinia: "Pinia",
                    "vue-router": "VueRouter",
                    "@shoelace-style/shoelace": "Shoelace",
                    "@piddie/chat-management": "ChatManagement"
                },
                // Extract CSS to separate files
                assetFileNames: 'assets/[name][extname]'
            }
        }
    }
});