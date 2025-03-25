import { createApp } from "vue";
import App from "./App.vue";
import "@shoelace-style/shoelace/dist/themes/light.css";
import "@shoelace-style/shoelace/dist/themes/dark.css";
import { router } from "./router";
import { installStores } from "./plugins/stores";

async function initializeApp() {
  const app = createApp(App);

  // Initialize stores first
  await installStores(app);

  // Then use router
  app.use(router);

  // Mount the app
  app.mount("#app");
}

// Start the application
initializeApp().catch((error) => {
  console.error("Failed to initialize application:", error);
});
