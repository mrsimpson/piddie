import type { Terminal as XTerm } from "@xterm/xterm";
import type { WebContainer, WebContainerProcess } from "@webcontainer/api";

export interface TerminalRef {
  instance: XTerm;
  ready: boolean;
  id: number;
  name: string;
}

export interface RuntimeEnvironmentManager {
  container: WebContainer;
  executeCommand(command: string, cwd?: string): Promise<WebContainerProcess>;
  getWorkingDirectory(): Promise<string>;
  setWorkingDirectory(path: string): Promise<void>;
}

export interface TerminalOptions {
  fontFamily?: string;
  fontSize?: number;
  lineHeight?: number;
  cursorBlink?: boolean;
  cursorStyle?: "block" | "underline" | "bar";
  theme?: ITheme;
}

export interface ITheme {
  foreground?: string;
  background?: string;
  cursor?: string;
  black?: string;
  red?: string;
  green?: string;
  yellow?: string;
  blue?: string;
  magenta?: string;
  cyan?: string;
  white?: string;
  brightBlack?: string;
  brightRed?: string;
  brightGreen?: string;
  brightYellow?: string;
  brightBlue?: string;
  brightMagenta?: string;
  brightCyan?: string;
  brightWhite?: string;
}

export interface TerminalThemeOptions {
  isDark?: boolean;
  primary?: string;
  background?: string;
  foreground?: string;
}
