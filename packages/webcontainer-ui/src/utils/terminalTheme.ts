import type { ITheme } from "@xterm/xterm";

/**
 * Gets CSS variable value from document root
 */
function getCssVar(token: string): string | undefined {
  const style = getComputedStyle(document.documentElement);
  return style.getPropertyValue(token) || undefined;
}

/**
 * Creates terminal theme using CSS variables
 * @param overrides Optional overrides for theme properties
 * @returns Terminal theme configuration
 */
export function getTerminalTheme(overrides?: Partial<ITheme>): ITheme {
  return {
    cursor: getCssVar("--sl-color-primary-500"),
    cursorAccent: getCssVar("--sl-color-primary-700"),
    foreground: getCssVar("--sl-color-neutral-900"),
    background: getCssVar("--sl-color-neutral-50"),
    selectionBackground: getCssVar("--sl-color-primary-200"),
    selectionForeground: getCssVar("--sl-color-neutral-900"),
    selectionInactiveBackground: getCssVar("--sl-color-neutral-200"),

    // ANSI escape code colors
    black: "#000000",
    red: "#e54b4b",
    green: "#18a979",
    yellow: "#e9c062",
    blue: "#428bca",
    magenta: "#d670d6",
    cyan: "#29b8db",
    white: "#d9d9d9",
    brightBlack: "#8c8c8c",
    brightRed: "#ff3131",
    brightGreen: "#23d18b",
    brightYellow: "#f5f543",
    brightBlue: "#5c5cff",
    brightMagenta: "#ff5cff",
    brightCyan: "#29eefa",
    brightWhite: "#ffffff",

    // Apply any custom overrides
    ...overrides
  };
}
