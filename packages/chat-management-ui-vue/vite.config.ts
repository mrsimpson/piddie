import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import dts from "vite-plugin-dts";
import { resolve } from "path";
import type { UserConfig } from 'vite';
// import { viteStaticCopy } from "vite-plugin-static-copy";

// Check if we're running the demo or building the library
const isDemoMode = process.env["NODE_ENV"] === 'development' && !process.argv.includes('--watch');

export default defineConfig({
    plugins: [
        vue({
            // Enable CSS extraction from Vue components
            template: {
                compilerOptions: {
                    isCustomElement: (tag) => tag.startsWith("sl-")
                }
            }
        }),
        dts({
            include: ["src/**/*.ts", "src/**/*.vue"],
            outDir: "dist",
            staticImport: true,
            insertTypesEntry: true,
            copyDtsFiles: true,
            rollupTypes: true,
            compilerOptions: {
                skipLibCheck: true,
                declaration: true,
                declarationMap: true
            },
            // Ensure Vue components are properly typed
            beforeWriteFile: (filePath, content) => {
                // Ensure we're not creating empty type files
                if (filePath.endsWith('index.d.ts') && content.trim() === 'export { }') {
                    // Include explicit component exports
                    return {
                        filePath,
                        content: `import { DefineComponent } from 'vue';\n` +
                            `import { Message, MessageStatus } from '@piddie/chat-management';\n\n` +
                            `export declare const MessagesList: DefineComponent<{\n` +
                            `    messages: Message[];\n` +
                            `}, {}, any>;\n\n` +
                            `export declare const SimpleChatInput: DefineComponent<{\n` +
                            `    disabled?: boolean;\n` +
                            `    placeholder?: string;\n` +
                            `}, {}, any>;\n\n` +
                            `export declare const useChatStore: () => any;\n`
                    };
                }
                return { filePath, content };
            }
        }),
        // Removing the static copy plugin as it's causing build issues
        // viteStaticCopy({
        //     targets: [
        //         {
        //             src: "node_modules/@shoelace-style/shoelace/dist/assets/icons",
        //             dest: "assets"
        //         }
        //     ]
        // })
    ],
    // When not in demo mode, build as a library
    build: isDemoMode ? {} : {
        lib: {
            entry: resolve(__dirname, "src/index.ts"),
            name: "ChatManagementUI",
            fileName: (format) => `index.${format}.js`,
            formats: ['es', 'umd']
        },
        outDir: "dist",
        // Extract CSS to a separate file
        cssCodeSplit: false,
        emptyOutDir: true,
        rollupOptions: {
            external: ["vue", "pinia", "@piddie/chat-management", "vue-router", "@shoelace-style/shoelace"],
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
                    "@piddie/chat-management": "ChatManagement",
                    "vue-router": "VueRouter",
                    "@shoelace-style/shoelace": "Shoelace"
                }
            }
        }
    }
} as UserConfig);