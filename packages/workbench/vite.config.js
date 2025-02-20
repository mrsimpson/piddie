import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import VueDevTools from 'vite-plugin-vue-devtools';
import { viteStaticCopy } from 'vite-plugin-static-copy';
const iconsPath = 'node_modules/@shoelace-style/shoelace/dist/assets/icons';
// https://vitejs.dev/config/
export default defineConfig({
    plugins: [
        vue({
            template: {
                compilerOptions: {
                    // Tell Vue to ignore all components that start with 'sl-'
                    isCustomElement: tag => tag.startsWith('sl-')
                }
            }
        }),
        viteStaticCopy({
            targets: [
                {
                    src: iconsPath,
                    dest: 'assets',
                },
            ],
        }),
        VueDevTools(),
    ],
    resolve: {
        alias: [
            {
                find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url))
            },
            {
                find: /\/assets\/icons\/(.+)/,
                replacement: `${iconsPath}/$1`,
            }
        ]
    },
    optimizeDeps: {
        exclude: ['@piddie/project-management', '@piddie/chat-context', '@piddie/files-management']
    }
});
