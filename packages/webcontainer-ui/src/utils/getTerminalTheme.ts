import type { ITheme, TerminalThemeOptions } from "../types";

/**
 * Returns a theme configuration for the terminal
 * @param options Theme options
 * @returns ITheme configuration for XTerm
 */
export function getTerminalTheme(options: TerminalThemeOptions = {}): ITheme {
  const isDark = options.isDark ?? true;
  const primary = options.primary ?? "#4169e1"; // royal blue
  const background = options.background ?? (isDark ? "#1e1e1e" : "#ffffff");
  const foreground = options.foreground ?? (isDark ? "#f0f0f0" : "#333333");

  return {
    foreground,
    background,
    cursor: primary,
    black: isDark ? "#000000" : "#555555",
    red: "#e06c75",
    green: "#98c379",
    yellow: "#e5c07b",
    blue: "#61afef",
    magenta: "#c678dd",
    cyan: "#56b6c2",
    white: isDark ? "#abb2bf" : "#eaeaea",
    brightBlack: "#5c6370",
    brightRed: "#e06c75",
    brightGreen: "#98c379",
    brightYellow: "#e5c07b",
    brightBlue: "#61afef",
    brightMagenta: "#c678dd",
    brightCyan: "#56b6c2",
    brightWhite: isDark ? "#ffffff" : "#ffffff"
  };
}
