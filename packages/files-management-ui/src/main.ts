import { createApp } from "vue";
import DemoApp from "./demo/DemoApp.vue";
//@ts-ignore-next-line - don't know why this is not working – I can find the types and at runtime it works
import { setBasePath } from "@shoelace-style/shoelace/dist/utilities/base-path";
import "./assets/main.css";

// Set the base path for Shoelace assets
setBasePath("node_modules/@shoelace-style/shoelace/dist");

// Create and mount the Vue app
createApp(DemoApp).mount("#app");
