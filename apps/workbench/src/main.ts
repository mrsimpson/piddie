import { createApp } from "vue";
import App from "./App.vue";
import "@shoelace-style/shoelace/dist/themes/light.css";
import "@shoelace-style/shoelace/dist/themes/dark.css";
import { router } from "./router";
import { installStores } from "./plugins/stores";

const app = createApp(App);
installStores(app);
app.use(router);
app.mount("#app");
