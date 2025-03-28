// Components
export { default as Terminal } from "./components/Terminal.vue";
export { default as TerminalTabs } from "./components/TerminalTabs.vue";
export { default as CommandTerminal } from "./components/CommandTerminal.vue";

// Utils
export { getTerminalTheme } from "./utils/getTerminalTheme";

// Types
export type {
  ITheme,
  TerminalOptions,
  TerminalRef,
  TerminalThemeOptions,
  RuntimeEnvironmentManager
} from "./types";
