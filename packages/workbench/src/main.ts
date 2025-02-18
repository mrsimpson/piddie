import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import { setBasePath } from "@shoelace-style/shoelace";
import "@shoelace-style/shoelace/dist/themes/light.css";
import "@shoelace-style/shoelace/dist/themes/dark.css";

setBasePath("node_modules/@shoelace-style/shoelace/dist");

const app = createApp(App);
app.use(createPinia());
app.mount("#app");
