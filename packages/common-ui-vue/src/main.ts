import { createApp } from "vue";
import App from "./Demo.vue";
import "@shoelace-style/shoelace/dist/themes/light.css";
import "@shoelace-style/shoelace/dist/themes/dark.css";

const app = createApp(App);
app.mount("#app");
