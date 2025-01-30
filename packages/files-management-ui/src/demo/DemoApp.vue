<script setup lang="ts">
import { ref, onMounted } from 'vue'
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
const syncManager = new FileSyncManager()

async function initializeBrowserSystem() {
  try {
    // Create and initialize browser file system
    const browserFs = new BrowserFileSystem({
      name: 'demo-browser',
      rootDir: '/',
    })
    await browserFs.initialize()

    // Create and initialize browser sync target
    const browserTarget = new BrowserSyncTarget('browser')
    await browserTarget.initialize(browserFs, true)

    // Create synchronized system
    const browserSystem = await createSynchronizedFileSystem({
      id: 'browser',
      title: 'Browser Storage',
      fileSystem: browserFs,
      syncTarget: browserTarget,
    })

    systems.value = [browserSystem]
  } catch (err) {
    handleUIError(err, 'Failed to initialize browser system', COMPONENT_ID)
  }
}

async function addNativeSystem() {
  try {
    // Request directory with readwrite permissions
    const dirHandle = await window.showDirectoryPicker({
      mode: 'readwrite',
    })

    // Create and initialize native file system
    const nativeFs = new BrowserNativeFileSystem({ rootHandle: dirHandle })
    await nativeFs.initialize()

    // Create and initialize native sync target
    const nativeTarget = new BrowserNativeSyncTarget('native')
    await nativeTarget.initialize(nativeFs, false)

    // Create synchronized system
    const nativeSystem = await createSynchronizedFileSystem({
      id: 'native',
      title: 'Local Files',
      fileSystem: nativeFs,
      syncTarget: nativeTarget,
    })

    // Initialize sync manager if this is the second system
    if (systems.value.length === 1) {
      try {
        // Initialize sync manager
        await syncManager.initialize({
          maxBatchSize: 10,
          inactivityDelay: 1000, // Wait 1 second for more changes
          maxRetries: 3 // Try up to 3 times on failure
        })
        
        await syncManager.registerTarget(systems.value[0].syncTarget, { role: 'primary' })
        await syncManager.registerTarget(nativeSystem.syncTarget, { role: 'secondary' })
        
        // Set up error monitoring
        const monitorSync = () => {
          const status = syncManager.getStatus()
          const pendingSync = syncManager.getPendingSync()
          
          if (status.currentFailure) {
            handleUIError(
              status.currentFailure.error,
              `Sync failed for target ${status.currentFailure.targetId}`,
              COMPONENT_ID
            )
          }
          
          if (pendingSync) {
            console.log('Pending sync:', {
              sourceTarget: pendingSync.sourceTargetId,
              pendingTargets: Array.from(pendingSync.pendingByTarget.keys())
            })
          }
        }

        // Check sync status every second
        setInterval(monitorSync, 1000)
      } catch (syncError) {
        handleUIError(syncError, 'Failed to initialize sync', COMPONENT_ID)
      }
    }

    // Add native system to the list
    systems.value = [...systems.value, nativeSystem]
  } catch (err) {
    handleUIError(err, 'Failed to initialize native system', COMPONENT_ID)
  }
}

// Initialize browser system on mount
onMounted(initializeBrowserSystem)
</script>

<template>
  <div class="demo-app">
    <header>
      <h1>File Management Demo</h1>
    </header>

    <main>
      <div v-if="systems.length === 0" class="loading panel">
        <sl-spinner></sl-spinner>
        Initializing file systems...
      </div>
      <FileExplorer v-else :systems="systems" class="panel">
        <template v-if="systems.length === 1" #after-explorer>
          <div class="empty-panel">
            <div class="empty-state">
              <sl-button variant="primary" size="large" @click="addNativeSystem">
                <sl-icon slot="prefix" name="folder"></sl-icon>
                Add Local Directory
              </sl-button>
              <p class="hint">Add a local directory to enable file synchronization</p>
            </div>
          </div>
        </template>
      </FileExplorer>
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

.panel {
  height: 100%;
  border: 1px solid var(--sl-color-neutral-200);
  border-radius: var(--sl-border-radius-medium);
  background: var(--sl-color-neutral-0);
}

.empty-panel {
  display: flex;
  align-items: center;
  justify-content: center;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sl-spacing-medium);
  padding: var(--sl-spacing-2x-large);
  text-align: center;
}

.loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--sl-spacing-medium);
  color: var(--sl-color-neutral-600);
}

.hint {
  color: var(--sl-color-neutral-600);
  font-size: var(--sl-font-size-small);
  margin: 0;
}
</style>
