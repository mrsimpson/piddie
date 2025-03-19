import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./FilesManagementDemo.vue";
import "@shoelace-style/shoelace/dist/themes/light.css";
import "@shoelace-style/shoelace/dist/themes/dark.css";
import { router } from "./router";

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.mount("#app");
