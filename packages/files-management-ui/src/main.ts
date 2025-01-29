import { createApp } from 'vue'
import DemoApp from './demo/DemoApp.vue'
import { setBasePath } from '@shoelace-style/shoelace/dist/utilities/base-path'
import './assets/main.css'

// Set the base path for Shoelace assets
setBasePath('node_modules/@shoelace-style/shoelace/dist')

// Create and mount the Vue app
createApp(DemoApp).mount('#app')
