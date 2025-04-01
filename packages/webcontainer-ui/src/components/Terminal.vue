<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import type { RuntimeEnvironment } from "@piddie/runtime-environment";
import "@xterm/xterm/css/xterm.css";

const props = defineProps<{
  sessionId: string;
  runtime: RuntimeEnvironment;
  readonly?: boolean;
}>();

const emit = defineEmits<{
  terminalReady: [terminal: XTerm];
  terminalResize: [cols: number, rows: number];
}>();

const terminalRef = ref<HTMLDivElement>();
const terminal = ref<XTerm>();
let fitAddon: FitAddon;
let currentCommand = "";
let currentLine = "";

onMounted(() => {
  if (!terminalRef.value) return;

  // Initialize terminal with proper configuration
  const xterm = new XTerm({
    cursorBlink: true,
    convertEol: true,
    disableStdin: props.readonly,
    theme: {
      background: "#1e1e1e",
      foreground: "#d4d4d4",
      cursor: props.readonly ? "#00000000" : "#d4d4d4"
    },
    fontSize: 12,
    fontFamily: "Menlo, courier-new, courier, monospace"
  });

  terminal.value = xterm;

  // Add addons
  fitAddon = new FitAddon();
  const webLinksAddon = new WebLinksAddon();
  xterm.loadAddon(fitAddon);
  xterm.loadAddon(webLinksAddon);

  // Open terminal in container
  xterm.open(terminalRef.value);
  fitAddon.fit();

  // Handle terminal input
  xterm.onData((data) => {
    if (props.readonly) return;

    switch (data) {
      case "\r": // Enter
        handleEnterKey();
        break;
      case "\u007F": // Backspace
        handleBackspace();
        break;
      case "\u0003": // Ctrl+C
        handleCtrlC();
        break;
      default:
        if (
          data >= String.fromCharCode(0x20) &&
          data <= String.fromCharCode(0x7e)
        ) {
          // Only handle printable characters
          currentLine += data;
          xterm.write(data);
        }
        break;
    }
  });

  // Handle window resize
  const resizeObserver = new ResizeObserver(() => {
    if (fitAddon && terminal.value) {
      fitAddon.fit();
      emit("terminalResize", terminal.value.cols, terminal.value.rows);
    }
  });
  resizeObserver.observe(terminalRef.value);

  // Write initial prompt
  writePrompt();

  // Emit terminal ready
  emit("terminalReady", xterm);
});

onUnmounted(() => {
  if (terminal.value) {
    terminal.value.dispose();
  }
});

function writePrompt() {
  terminal.value?.write("\r\n$ ");
  currentLine = "";
}

async function handleEnterKey() {
  const command = currentLine.trim();
  if (!command) {
    writePrompt();
    return;
  }

  try {
    terminal.value?.write("\r\n");
    const result = await props.runtime.executeCommand({
      command,
      options: { sessionId: props.sessionId }
    });

    if (result.stdout) {
      terminal.value?.write(result.stdout);
    }
    if (result.stderr) {
      terminal.value?.write("\r\n" + result.stderr);
    }
  } catch (error) {
    terminal.value?.write(
      "\r\n" + (error instanceof Error ? error.message : String(error))
    );
  }

  writePrompt();
}

function handleBackspace() {
  if (currentLine.length > 0) {
    currentLine = currentLine.slice(0, -1);
    terminal.value?.write("\b \b");
  }
}

function handleCtrlC() {
  terminal.value?.write("^C");
  writePrompt();
}

// Expose methods for parent components
defineExpose({
  reloadStyles: () => {
    if (terminal.value) {
      terminal.value.options.theme = {
        background: "#1e1e1e",
        foreground: "#d4d4d4",
        cursor: props.readonly ? "#00000000" : "#d4d4d4"
      };
    }
  }
});
</script>

<template>
  <div ref="terminalRef" class="terminal-container"></div>
</template>

<style scoped>
.terminal-container {
  width: 100%;
  height: 100%;
  background-color: #1e1e1e;
}

:deep(.xterm) {
  padding: 8px;
}

:deep(.xterm-viewport) {
  overflow-y: auto;
}
</style>
