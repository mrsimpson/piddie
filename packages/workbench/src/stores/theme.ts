import { ref } from 'vue';
import { defineStore } from 'pinia';

export type Theme = 'light' | 'dark';

export const useThemeStore = defineStore('theme', () => {
  const theme = ref<Theme>(
    window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  );

  function setTheme(newTheme: Theme) {
    theme.value = newTheme;
    document.documentElement.setAttribute('data-theme', newTheme);
    document.documentElement.classList.toggle('sl-theme-dark', newTheme === 'dark');
    document.documentElement.classList.toggle('sl-theme-light', newTheme === 'light');
  }

  function toggleTheme() {
    setTheme(theme.value === 'light' ? 'dark' : 'light');
  }

  // Initialize theme
  setTheme(theme.value);

  return {
    theme,
    setTheme,
    toggleTheme,
  };
});
