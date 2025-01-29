<script setup lang="ts">
import { ref } from 'vue'
import type { SynchronizedFileSystem } from '../types/file-explorer'
import { createSynchronizedFileSystem } from '../types/file-explorer'
import {
  FileSyncManager,
  BrowserFileSystem,
  BrowserNativeFileSystem,
  BrowserSyncTarget,
  BrowserNativeSyncTarget,
} from '@piddie/files-management'
import FileExplorer from '../components/FileExplorer.vue'
import ErrorDisplay from '../components/ErrorDisplay.vue'
import { handleUIError } from '../utils/error-handling'

const COMPONENT_ID = 'DemoApp'
const systems = ref<SynchronizedFileSystem[]>([])
const dirHandle = ref<FileSystemDirectoryHandle | null>(null)

async function initializeFileSystems() {
  try {
    // Create file systems
    const browserFs = new BrowserFileSystem({
      name: 'demo-browser-' + Date.now(), // Use unique name to avoid conflicts
      rootDir: '/',
    })

    if (!dirHandle.value) {
      throw new Error('No directory handle available')
    }

    const nativeFs = new BrowserNativeFileSystem({ rootHandle: dirHandle.value })

    // Initialize file systems
    await browserFs.initialize()
    await nativeFs.initialize()

    // Create sync targets
    const browserTarget = new BrowserSyncTarget('browser')
    const nativeTarget = new BrowserNativeSyncTarget('native')

    // Create synchronized systems
    const [browserSystem, nativeSystem] = await Promise.all([
      createSynchronizedFileSystem({
        id: 'browser',
        title: 'Browser Storage',
        fileSystem: browserFs,
        syncTarget: browserTarget,
      }),
      createSynchronizedFileSystem({
        id: 'native',
        title: 'Local Files',
        fileSystem: nativeFs,
        syncTarget: nativeTarget,
      }),
    ])

    // Initialize sync manager
    const syncManager = new FileSyncManager()
    syncManager.registerTarget(browserSystem.syncTarget, { role: 'primary' })
    syncManager.registerTarget(nativeSystem.syncTarget, { role: 'secondary' })

    // Store systems for the UI
    systems.value = [browserSystem, nativeSystem]
  } catch (err) {
    handleUIError(err, 'Failed to initialize systems', COMPONENT_ID)
  }
}

async function handleSelectDirectory() {
  try {
    // Request directory with readwrite permissions
    dirHandle.value = await window.showDirectoryPicker({
      mode: 'readwrite',
    })
    await initializeFileSystems()
  } catch (err) {
    handleUIError(err, 'Failed to get directory access', COMPONENT_ID)
  }
}
</script>

<template>
  <div class="demo-app">
    <header>
      <h1>File Management Demo</h1>
    </header>

    <main>
      <div v-if="!dirHandle" class="select-directory">
        <sl-button variant="primary" @click="handleSelectDirectory">
          <sl-icon slot="prefix" name="folder"></sl-icon>
          Select Directory
        </sl-button>
        <p class="hint">Select a directory to start syncing files</p>
      </div>
      <div v-else-if="systems.length === 0" class="loading">
        <sl-spinner></sl-spinner>
        Initializing file systems...
      </div>
      <FileExplorer v-else :systems="systems" />
    </main>

    <ErrorDisplay />
  </div>
</template>

<style scoped>
.demo-app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  padding: var(--sl-spacing-medium);
}

header {
  margin-bottom: var(--sl-spacing-medium);
}

h1 {
  font-size: var(--sl-font-size-2x-large);
  margin: 0;
}

main {
  flex: 1;
  min-height: 0;
}

.error {
  padding: var(--sl-spacing-large);
  color: var(--sl-color-danger-600);
  text-align: center;
}

.loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--sl-spacing-medium);
  height: 100%;
  color: var(--sl-color-neutral-600);
}

.select-directory {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--sl-spacing-medium);
  height: 100%;
}

.hint {
  color: var(--sl-color-neutral-600);
  font-size: var(--sl-font-size-small);
}
</style>
