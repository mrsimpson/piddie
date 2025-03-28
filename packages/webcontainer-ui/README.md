# WebContainer UI Components for Piddie

This package provides Vue UI components for integrating WebContainer with Piddie's Prompt-Driven Development Environment.

## Components

### Terminal

A basic terminal component that wraps [xterm.js](https://xtermjs.org/) with Vue.

```vue
<template>
  <Terminal
    :options="{ fontFamily: 'monospace', fontSize: 14 }"
    :isVisible="true"
    :isFocusOnRender="true"
    @ready="handleTerminalReady"
    @resize="handleTerminalResize"
    @input="handleTerminalInput"
  />
</template>

<script setup>
import { Terminal } from '@piddie/webcontainer-ui';

function handleTerminalReady(terminal) {
  terminal.write('Terminal is ready!\r\n');
}

function handleTerminalResize(dimensions) {
  console.log(`Terminal resized to ${dimensions.cols}x${dimensions.rows}`);
}

function handleTerminalInput(input) {
  console.log(`User typed: ${input}`);
}
</script>
```

### TerminalTabs

A component that manages multiple terminal instances with tabs.

```vue
<template>
  <TerminalTabs
    :isVisible="true"
    @toggle="handleToggle"
    @ready="handleTerminalReady"
    @resize="handleTerminalResize"
    @input="handleTerminalInput"
  />
</template>

<script setup>
import { TerminalTabs } from '@piddie/webcontainer-ui';

function handleToggle(isVisible) {
  console.log(`Terminal visibility toggled: ${isVisible}`);
}

function handleTerminalReady(terminal, id) {
  console.log(`Terminal ${id} is ready!`);
}

function handleTerminalResize(dimensions, id) {
  console.log(`Terminal ${id} resized to ${dimensions.cols}x${dimensions.rows}`);
}

function handleTerminalInput(input, id) {
  console.log(`User typed in terminal ${id}: ${input}`);
}
</script>
```

### CommandTerminal

A high-level component that integrates with the runtime environment to execute commands in the WebContainer.

```vue
<template>
  <CommandTerminal
    :isVisible="true"
    @toggle="handleToggle"
    @command="handleCommandExecuted"
  />
</template>

<script setup>
import { CommandTerminal } from '@piddie/webcontainer-ui';
import { inject } from 'vue';
import { RuntimeEnvironmentManager } from '@piddie/runtime-environment';

// Inject the runtime manager from the app
const runtimeManager = inject('runtimeManager');

function handleToggle(isVisible) {
  console.log(`Terminal visibility toggled: ${isVisible}`);
}

function handleCommandExecuted(command, output) {
  console.log(`Command executed: ${command}`);
  console.log(`Output: ${output}`);
}
</script>
```

## Utilities

### getTerminalTheme

A utility function to generate a theme configuration for xterm.js.

```ts
import { getTerminalTheme } from '@piddie/webcontainer-ui';

// Default theme (dark)
const theme = getTerminalTheme();

// Light theme
const lightTheme = getTerminalTheme({ isDark: false });

// Custom theme
const customTheme = getTerminalTheme({
  isDark: true,
  primary: '#ff5722',
  background: '#121212',
  foreground: '#ffffff'
});
```

## Integration with Runtime Environment

The `CommandTerminal` component expects a `RuntimeEnvironmentManager` instance to be available via Vue's injection system. This manager provides methods for executing commands, getting the working directory, and changing directories within the WebContainer.

```ts
// In your main app component
import { ref, provide } from 'vue';
import { WebContainer } from '@webcontainer/api';
import { RuntimeEnvironmentManager } from '@piddie/runtime-environment';

// Initialize WebContainer
const webContainerInstance = ref(null);
const runtimeManager = ref(null);

async function initializeWebContainer() {
  const container = await WebContainer.boot();
  webContainerInstance.value = container;
  
  // Initialize RuntimeEnvironmentManager with the container
  runtimeManager.value = RuntimeEnvironmentManager.withWebContainer(container);
  
  // Provide to components
  provide('runtimeManager', runtimeManager.value);
}

onMounted(initializeWebContainer);
```

## Development

### Install Dependencies

```bash
pnpm install
```

### Build the Package

```bash
pnpm build
```

### Run Tests

```bash
pnpm test
``` 