<script setup lang="ts">
import { ref, watch } from "vue";
import type { Terminal as XTerm } from "@xterm/xterm";
import type { WebContainerProcess } from "@webcontainer/api";
import TerminalTabs from "./TerminalTabs.vue";
import type { RuntimeEnvironmentManager } from "../types";

const props = defineProps<{
  isVisible?: boolean;
  runtimeManager: RuntimeEnvironmentManager;
}>();

const emit = defineEmits<{
  (e: "toggle", isVisible: boolean): void;
  (e: "command", command: string, output: string): void;
}>();

// Interface for terminal state
interface TerminalState {
  id: number;
  process: WebContainerProcess | null;
  currentCommand: string;
  currentDirectory: string;
  commandHistory: string[];
  historyPosition: number;
}

// Terminal instances
const terminals = ref<TerminalState[]>([]);

// Reference to the TerminalTabs component
const terminalTabsRef = ref<InstanceType<typeof TerminalTabs> | null>(null);

// Current command
const currentCommand = ref("");

// Current working directory for each terminal
const currentDirectories = ref<Record<number, string>>({});

// Terminal visibility computed
const isTerminalVisible = ref(props.isVisible ?? true);

// Function to handle terminal ready
async function handleTerminalReady(xterm: XTerm, id: number) {
  // Initialize the current directory
  let cwd = "/";
  if (props.runtimeManager) {
    try {
      cwd = await props.runtimeManager.getWorkingDirectory();
    } catch (error) {
      console.error("Error getting working directory:", error);
    }
  }

  // Create a new terminal entry
  terminals.value.push({
    id,
    process: null,
    currentCommand: "",
    currentDirectory: cwd,
    commandHistory: [],
    historyPosition: -1
  });

  currentDirectories.value[id] = cwd;

  // Write the prompt
  writePrompt(xterm, cwd);
}

// Function to handle terminal resize
function handleTerminalResize(
  dimensions: { cols: number; rows: number },
  id: number
) {
  // Handle resize if needed
  const terminal = terminals.value.find((t: TerminalState) => t.id === id);
  if (terminal && terminal.process) {
    try {
      terminal.process.resize({
        cols: dimensions.cols,
        rows: dimensions.rows
      });
    } catch (error) {
      console.error("Error resizing terminal:", error);
    }
  }
}

// Function to handle terminal input
async function handleTerminalInput(input: string, id: number) {
  const terminal = terminals.value.find((t: TerminalState) => t.id === id);
  if (!terminal) return;

  const termRef = terminalTabsRef.value?.terminals?.find(
    (t: any) => t.id === id
  );
  if (!termRef || !termRef.instance) return;

  const xterm = termRef.instance;

  // Get current process
  const runningProcess = terminal.process;

  if (runningProcess && runningProcess.output) {
    // If there's a running process, just write to its stdin
    try {
      // TypeScript may not know about write method on WebContainerProcess
      // We know the process has stdin that accepts write
      await (runningProcess as any).write(input);
    } catch (error) {
      console.error("Error writing to process stdin:", error);
    }
    return;
  }

  // Handle special keys
  if (input === "\r") {
    // Enter key
    xterm.write("\r\n");

    // Get the current command
    const command = terminal.currentCommand.trim();
    terminal.currentCommand = "";

    if (command) {
      // Add to history
      terminal.commandHistory.push(command);
      terminal.historyPosition = terminal.commandHistory.length;

      // Execute command
      if (command === "clear") {
        xterm.clear();
      } else if (command.startsWith("cd ")) {
        // Handle directory change
        await changeDirectory(command.slice(3), id, xterm);
      } else {
        // Execute command in the container
        await executeCommand(command, id, xterm);
      }
    }

    // Write prompt after command execution
    writePrompt(xterm, terminal.currentDirectory);
  } else if (input === "\u007F") {
    // Backspace
    const cmd = terminal.currentCommand;
    if (cmd.length > 0) {
      terminal.currentCommand = cmd.slice(0, -1);
      xterm.write("\b \b"); // Move back, write space, move back again
    }
  } else if (input === "\u001b[A") {
    // Up arrow
    // Navigate command history (backwards)
    if (terminal.historyPosition > 0) {
      terminal.historyPosition--;
      // Clear current line
      clearCurrentLine(xterm, terminal.currentCommand);
      // Set command from history
      terminal.currentCommand =
        terminal.commandHistory[terminal.historyPosition];
      // Write the command
      xterm.write(terminal.currentCommand);
    }
  } else if (input === "\u001b[B") {
    // Down arrow
    // Navigate command history (forwards)
    if (terminal.historyPosition < terminal.commandHistory.length - 1) {
      terminal.historyPosition++;
      // Clear current line
      clearCurrentLine(xterm, terminal.currentCommand);
      // Set command from history
      terminal.currentCommand =
        terminal.commandHistory[terminal.historyPosition];
      // Write the command
      xterm.write(terminal.currentCommand);
    } else if (
      terminal.historyPosition ===
      terminal.commandHistory.length - 1
    ) {
      terminal.historyPosition = terminal.commandHistory.length;
      // Clear current line
      clearCurrentLine(xterm, terminal.currentCommand);
      // Clear command
      terminal.currentCommand = "";
    }
  } else {
    // Regular input
    terminal.currentCommand += input;
    xterm.write(input);
  }
}

// Function to clear the current line
function clearCurrentLine(xterm: XTerm, command: string) {
  // Move cursor to beginning of line
  xterm.write("\r");
  // Clear line
  xterm.write("\x1b[K");
  // Write prompt
  const directory =
    currentDirectories.value[getTerminalIdByXterm(xterm)] || "/";
  writePrompt(xterm, directory);
}

// Helper function to get terminal ID by XTerm instance
function getTerminalIdByXterm(xterm: XTerm): number {
  const termRef = terminalTabsRef.value?.terminals?.find(
    (t: any) => t.instance === xterm
  );
  return termRef?.id || 0;
}

// Function to write the command prompt
function writePrompt(xterm: XTerm, directory: string) {
  const promptText = `${directory} $ `;
  xterm.write(promptText);
}

// Function to execute a command
async function executeCommand(command: string, id: number, xterm: XTerm) {
  if (!props.runtimeManager) {
    xterm.write("\r\nRuntime manager not available\r\n");
    return;
  }

  const terminal = terminals.value.find((t: TerminalState) => t.id === id);
  if (!terminal) return;

  try {
    // Execute the command
    const process = await props.runtimeManager.executeCommand(
      command,
      terminal.currentDirectory
    );
    terminal.process = process;

    // Capture output
    let output = "";

    // Set up event handlers for the process
    process.output.pipeTo(
      new WritableStream({
        write(data) {
          output += data;
          xterm.write(data);
        }
      })
    );

    // Wait for the process to exit
    const exitCode = await process.exit;

    // Clear the process reference
    terminal.process = null;

    // Emit the command executed event
    emit("command", command, output);

    // Log the exit code if it's not 0
    if (exitCode !== 0) {
      console.log(`Command exited with code ${exitCode}`);
    }
  } catch (error) {
    console.error("Error executing command:", error);
    xterm.write(
      `\r\nError: ${error instanceof Error ? error.message : String(error)}\r\n`
    );
  }
}

// Function to change directory
async function changeDirectory(path: string, id: number, xterm: XTerm) {
  if (!props.runtimeManager) {
    xterm.write("\r\nRuntime manager not available\r\n");
    return;
  }

  const terminal = terminals.value.find((t: TerminalState) => t.id === id);
  if (!terminal) return;

  try {
    // Change directory in the container
    await props.runtimeManager.setWorkingDirectory(path);

    // Get the new working directory
    const newDirectory = await props.runtimeManager.getWorkingDirectory();

    // Update the terminal's current directory
    terminal.currentDirectory = newDirectory;
    currentDirectories.value[id] = newDirectory;
  } catch (error) {
    console.error("Error changing directory:", error);
    xterm.write(
      `\r\nError: ${error instanceof Error ? error.message : String(error)}\r\n`
    );
  }
}

// Function to toggle terminal visibility
function toggleTerminal(isVisible: boolean) {
  emit("toggle", isVisible);
  isTerminalVisible.value = isVisible;
}

// Watch for visibility changes from props
watch(
  () => props.isVisible,
  (newValue: boolean | undefined) => {
    if (terminalTabsRef.value) {
      if (newValue === false && isTerminalVisible.value) {
        terminalTabsRef.value.toggleTerminalPanel();
        isTerminalVisible.value = false;
      } else if (newValue === true && !isTerminalVisible.value) {
        terminalTabsRef.value.toggleTerminalPanel();
        isTerminalVisible.value = true;
      }
    }
  }
);

// Expose methods
defineExpose({
  executeCommand,
  changeDirectory,
  toggleTerminal
});
</script>

<template>
  <TerminalTabs
    ref="terminalTabsRef"
    :isVisible="isTerminalVisible"
    @toggle="toggleTerminal"
    @ready="handleTerminalReady"
    @resize="handleTerminalResize"
    @input="handleTerminalInput"
  />
</template>
