<script setup lang="ts">
import { storeToRefs } from "pinia";
import { useThemeStore } from "../stores/theme";
import "@shoelace-style/shoelace/dist/components/icon-button/icon-button.js";

const themeStore = useThemeStore();
const { theme } = storeToRefs(themeStore);
</script>

<template>
  <sl-icon-button
    :name="theme === 'dark' ? 'sun' : 'moon'"
    label="Toggle theme"
    @click="themeStore.toggleTheme()"
  />
</template>

<style scoped>
sl-icon-button::part(base) {
  color: inherit;
  font-size: 1.2rem;
}

sl-icon-button::part(base):hover {
  background: var(--sl-color-neutral-100);
}
</style>
