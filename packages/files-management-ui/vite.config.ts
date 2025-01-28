import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
    plugins: [
        vue({
            template: {
                compilerOptions: {
                    // Treat all sl- tags as custom elements
                    isCustomElement: (tag) => tag.startsWith('sl-')
                }
            },
            script: {
                defineModel: true,
                propsDestructure: true
            }
        })
    ],
    build: {
        target: 'esnext',
        lib: {
            entry: 'src/index.ts',
            name: 'FilesManagementUI',
            fileName: 'files-management-ui'
        },
        rollupOptions: {
            external: [
                'vue',
                '@piddie/files-management',
                '@piddie/shared-types',
                '@shoelace-style/shoelace'
            ],
            output: {
                globals: {
                    vue: 'Vue',
                    '@piddie/files-management': 'FilesManagement',
                    '@piddie/shared-types': 'SharedTypes',
                    '@shoelace-style/shoelace': 'Shoelace'
                }
            }
        }
    },
    // Copy Shoelace assets to public directory
    publicDir: resolve(__dirname, 'public'),
    define: {
        'process.env': {}
    },
    resolve: {
        alias: {
            'vue': 'vue/dist/vue.esm-bundler.js'
        }
    }
}); 