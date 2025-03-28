<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import type { Terminal as XTerm } from "@xterm/xterm";
import Terminal from "./Terminal.vue";
import type { TerminalRef } from "../types";

const props = defineProps<{
  isVisible?: boolean;
}>();

const emit = defineEmits<{
  (e: "toggle", isVisible: boolean): void;
  (e: "ready", terminal: XTerm, id: number): void;
  (e: "resize", dimensions: { cols: number; rows: number }, id: number): void;
  (e: "input", input: string, id: number): void;
}>();

// Terminal instances
const terminals = ref<TerminalRef[]>([]);
// Active terminal ID
const activeTerminalId = ref<number | null>(null);
// Terminal counter for generating unique IDs
const terminalCounter = ref(0);
// Terminal components refs
const terminalRefs = ref<Record<number, any>>({});

// Computed property for visibility
const isTerminalVisible = computed({
  get: () => props.isVisible ?? true,
  set: (value: boolean) => emit("toggle", value)
});

// Function to add a new terminal
function addTerminal() {
  const id = terminalCounter.value++;
  terminals.value.push({
    id,
    name: `Terminal ${id + 1}`,
    ready: false,
    instance: null as unknown as XTerm
  });
  activeTerminalId.value = id;
  return id;
}

// Function to handle terminal ready event
function handleTerminalReady(terminal: XTerm, id: number) {
  const terminalRef = terminals.value.find((t: TerminalRef) => t.id === id);
  if (terminalRef) {
    terminalRef.ready = true;
    terminalRef.instance = terminal;
    emit("ready", terminal, id);
  }
}

// Function to handle terminal resize event
function handleTerminalResize(
  dimensions: { cols: number; rows: number },
  id: number
) {
  emit("resize", dimensions, id);
}

// Function to handle terminal input event
function handleTerminalInput(input: string, id: number) {
  emit("input", input, id);
}

// Function to set active terminal
function setActiveTerminal(id: number) {
  activeTerminalId.value = id;
  // Focus the terminal
  setTimeout(() => {
    const terminalRef = terminalRefs.value[id];
    if (terminalRef) {
      terminalRef.focus();
    }
  }, 0);
}

// Function to toggle terminal visibility
function toggleTerminalPanel() {
  isTerminalVisible.value = !isTerminalVisible.value;
}

// Function to clear a terminal
function clearTerminal(id: number) {
  const terminalRef = terminalRefs.value[id];
  if (terminalRef) {
    terminalRef.clear();
  }
}

// Function to close a terminal tab
function closeTerminal(id: number) {
  // Get the index of the terminal to close
  const index = terminals.value.findIndex((t: TerminalRef) => t.id === id);
  if (index === -1) return;

  // Remove the terminal
  terminals.value.splice(index, 1);

  // Update active terminal if the closed one was active
  if (activeTerminalId.value === id) {
    // Select previous terminal if available, otherwise select next one
    if (index > 0) {
      activeTerminalId.value = terminals.value[index - 1].id;
    } else if (terminals.value.length > 0) {
      activeTerminalId.value = terminals.value[0].id;
    } else {
      activeTerminalId.value = null;
    }
  }
}

// Add initial terminal on mount
onMounted(() => {
  addTerminal();
});

// Expose methods
defineExpose({
  addTerminal,
  setActiveTerminal,
  clearTerminal,
  closeTerminal,
  toggleTerminalPanel,
  terminals
});
</script>

<template>
  <div class="terminal-tabs-container" :class="{ hidden: !isTerminalVisible }">
    <div class="terminal-tabs-header">
      <div class="terminal-tabs">
        <button
          v-for="terminal in terminals"
          :key="terminal.id"
          class="terminal-tab"
          :class="{ active: activeTerminalId === terminal.id }"
          @click="setActiveTerminal(terminal.id)"
        >
          {{ terminal.name }}
          <span
            class="close-tab"
            @click.stop="closeTerminal(terminal.id)"
            v-if="terminals.length > 1"
            >×</span
          >
        </button>
        <button class="add-terminal" @click="addTerminal">+</button>
      </div>
      <div class="terminal-actions">
        <button
          class="clear-terminal"
          @click="activeTerminalId !== null && clearTerminal(activeTerminalId)"
          :disabled="activeTerminalId === null"
        >
          Clear
        </button>
        <button class="toggle-terminal" @click="toggleTerminalPanel">
          {{ isTerminalVisible ? "▼" : "▲" }}
        </button>
      </div>
    </div>
    <div class="terminal-tabs-content">
      <div
        v-for="terminal in terminals"
        :key="terminal.id"
        class="terminal-tab-content"
        :class="{ active: activeTerminalId === terminal.id }"
      >
        <Terminal
          :ref="(el) => (terminalRefs[terminal.id] = el)"
          :isVisible="activeTerminalId === terminal.id && isTerminalVisible"
          :isFocusOnRender="true"
          @ready="(xterm) => handleTerminalReady(xterm, terminal.id)"
          @resize="(dims) => handleTerminalResize(dims, terminal.id)"
          @input="(input) => handleTerminalInput(input, terminal.id)"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.terminal-tabs-container {
  display: flex;
  flex-direction: column;
  height: 300px;
  background-color: var(--sl-color-neutral-50, #f5f5f5);
  border-top: 1px solid var(--sl-color-neutral-200, #e0e0e0);
  transition: height 0.3s ease;
}

.terminal-tabs-container.hidden {
  height: 32px;
}

.terminal-tabs-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background-color: var(--sl-color-neutral-100, #f0f0f0);
  border-bottom: 1px solid var(--sl-color-neutral-200, #e0e0e0);
  height: 32px;
  min-height: 32px;
  padding: 0 8px;
}

.terminal-tabs {
  display: flex;
  gap: 2px;
  overflow-x: auto;
  max-width: calc(100% - 100px);
}

.terminal-tab {
  padding: 4px 12px;
  border: none;
  background-color: var(--sl-color-neutral-200, #e0e0e0);
  border-radius: 4px 4px 0 0;
  cursor: pointer;
  white-space: nowrap;
  display: flex;
  align-items: center;
  gap: 8px;
}

.terminal-tab.active {
  background-color: var(--sl-color-neutral-0, #ffffff);
  font-weight: 500;
}

.close-tab {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  font-size: 14px;
  line-height: 1;
}

.close-tab:hover {
  background-color: var(--sl-color-neutral-300, #d0d0d0);
}

.add-terminal {
  padding: 4px 8px;
  border: none;
  background-color: var(--sl-color-neutral-200, #e0e0e0);
  border-radius: 4px 4px 0 0;
  cursor: pointer;
  font-weight: bold;
}

.terminal-actions {
  display: flex;
  gap: 4px;
}

.clear-terminal,
.toggle-terminal {
  padding: 2px 8px;
  border: none;
  background-color: var(--sl-color-neutral-200, #e0e0e0);
  border-radius: 4px;
  cursor: pointer;
}

.terminal-tabs-content {
  flex: 1;
  position: relative;
  overflow: hidden;
  background-color: var(--sl-color-neutral-0, #ffffff);
}

.terminal-tab-content {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: none;
}

.terminal-tab-content.active {
  display: block;
}

.hidden .terminal-tabs-content {
  display: none;
}
</style>
