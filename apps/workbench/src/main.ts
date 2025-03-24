import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import "@shoelace-style/shoelace/dist/themes/light.css";
import "@shoelace-style/shoelace/dist/themes/dark.css";
import { router } from "./router";
import { installStores } from "./plugins/stores";

const app = createApp(App);
const pinia = createPinia();
app.use(pinia);
app.use(router);
installStores(app);
app.mount("#app");
