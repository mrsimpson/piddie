<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from "vue";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { getTerminalTheme } from "../utils/getTerminalTheme";
import type { TerminalOptions } from "../types";

// Import required CSS
import "@xterm/xterm/css/xterm.css";

const props = defineProps<{
  options?: TerminalOptions;
  isVisible?: boolean;
  isFocusOnRender?: boolean;
}>();

const emit = defineEmits<{
  (e: "ready", terminal: Terminal): void;
  (e: "resize", dimensions: { cols: number; rows: number }): void;
  (e: "input", input: string): void;
}>();

// Terminal element ref
const terminalElement = ref<HTMLElement | null>(null);
// Terminal instance
const terminal = ref<Terminal | null>(null);
// Terminal resize addon
const fitAddon = ref<FitAddon | null>(null);

// Initialize terminal
onMounted(async () => {
  if (terminalElement.value) {
    // Create terminal instance
    const term = new Terminal({
      fontFamily: props.options?.fontFamily || "monospace",
      fontSize: props.options?.fontSize || 14,
      lineHeight: props.options?.lineHeight || 1.2,
      cursorBlink: props.options?.cursorBlink ?? true,
      cursorStyle: props.options?.cursorStyle || "block",
      theme: props.options?.theme || getTerminalTheme()
    });

    // Create and load fit addon
    const fit = new FitAddon();
    term.loadAddon(fit);

    // Create and load web links addon
    const webLinks = new WebLinksAddon();
    term.loadAddon(webLinks);

    // Open terminal in the terminal element
    term.open(terminalElement.value);

    // Fit terminal to container size
    fit.fit();

    // Set references
    terminal.value = term;
    fitAddon.value = fit;

    // Handle terminal input
    term.onData((data: string) => {
      emit("input", data);
    });

    // Focus terminal if requested
    if (props.isFocusOnRender) {
      term.focus();
    }

    // Emit ready event with terminal instance
    emit("ready", term);

    // Handle window resize
    const handleResize = () => {
      if (fitAddon.value && terminal.value) {
        fitAddon.value.fit();
        const dimensions = {
          cols: terminal.value.cols,
          rows: terminal.value.rows
        };
        emit("resize", dimensions);
      }
    };

    window.addEventListener("resize", handleResize);

    // Clean up resize event listener
    onBeforeUnmount(() => {
      window.removeEventListener("resize", handleResize);
      // Dispose terminal instance
      if (terminal.value) {
        terminal.value.dispose();
      }
    });
  }
});

// Handle visibility changes
watch(
  () => props.isVisible,
  (isVisible: boolean | undefined) => {
    if (isVisible && fitAddon.value) {
      // When terminal becomes visible, refit it
      setTimeout(() => {
        fitAddon.value?.fit();
        if (terminal.value) {
          emit("resize", {
            cols: terminal.value.cols,
            rows: terminal.value.rows
          });
        }
      }, 0);
    }
  }
);

// Method to write text to the terminal
const write = (text: string) => {
  if (terminal.value) {
    terminal.value.write(text);
  }
};

// Method to clear the terminal
const clear = () => {
  if (terminal.value) {
    terminal.value.clear();
  }
};

// Method to focus the terminal
const focus = () => {
  if (terminal.value) {
    terminal.value.focus();
  }
};

// Expose methods
defineExpose({
  terminal,
  write,
  clear,
  focus
});
</script>

<template>
  <div
    ref="terminalElement"
    class="terminal-container"
    :class="{ hidden: isVisible === false }"
  ></div>
</template>

<style scoped>
.terminal-container {
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.hidden {
  display: none;
}
</style>
