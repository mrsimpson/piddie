<script setup lang="ts">
import type { SynchronizedFileSystem } from '../types/file-explorer'
import type { FileChangeInfo } from '@piddie/shared-types'
import { BrowserSyncTarget, BrowserNativeSyncTarget } from '@piddie/files-management'
import { WATCHER_PRIORITIES } from '@piddie/shared-types'
import FileSystemExplorer from './FileSystemExplorer.vue'
import SyncTargetStatus from './SyncTargetStatus.vue'
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { handleUIError } from '../utils/error-handling'

const COMPONENT_ID = 'FileSystem'
const props = defineProps<{
  system: SynchronizedFileSystem
}>()

const explorerRef = ref<InstanceType<typeof FileSystemExplorer> | null>(null)
const uiSyncTarget = ref<BrowserSyncTarget | BrowserNativeSyncTarget | null>(null)

// Initialize UI sync target
async function initializeUISyncTarget() {
  try {
    // Create UI sync target of the same type as the main sync target
    uiSyncTarget.value = props.system.syncTarget instanceof BrowserNativeSyncTarget
      ? new BrowserNativeSyncTarget(`ui-${props.system.id}`)
      : new BrowserSyncTarget(`ui-${props.system.id}`)
    
    // Initialize with the SAME file system instance as the main sync target
    await uiSyncTarget.value.initialize(props.system.fileSystem, false)
    console.log(`UI sync target initialized for ${props.system.id} with existing file system`)
    
    // Set up watching only after successful initialization
    await setupWatcher()
  } catch (err) {
    console.error(`Failed to initialize UI sync target for ${props.system.id}:`, err)
    handleUIError(err, 'Failed to initialize UI sync target', COMPONENT_ID)
    throw err // Re-throw to handle in mount
  }
}

// Set up watcher
async function setupWatcher() {
  if (!uiSyncTarget.value) {
    throw new Error('UI sync target not initialized')
  }

  try {
    await uiSyncTarget.value.watch(
      async (changes: FileChangeInfo[]) => {
        console.log(`UI update triggered for ${props.system.id}`)
        if (explorerRef.value) {
          await explorerRef.value.handleFileChanges(changes)
        }
      },
      {
        priority: WATCHER_PRIORITIES.UI_UPDATES,
        metadata: {
          registeredBy: 'FileSystem',
          type: 'ui-watcher',
          systemId: props.system.id
        }
      }
    )
    console.log(`Watcher set up for ${props.system.id}`)
  } catch (err) {
    console.error(`Failed to set up watcher for ${props.system.id}:`, err)
    handleUIError(err, 'Failed to set up file watcher', COMPONENT_ID)
    throw err
  }
}

// Clean up sync target
async function cleanupSyncTarget() {
  if (uiSyncTarget.value) {
    try {
      // Unwatch to stop receiving updates and clean up
      await uiSyncTarget.value.unwatch()
      console.log(`UI sync target cleaned up for ${props.system.id}`)
    } catch (err) {
      console.error(`Error cleaning up UI sync target for ${props.system.id}:`, err)
      handleUIError(err, 'Error during sync target cleanup', COMPONENT_ID)
    } finally {
      uiSyncTarget.value = null
    }
  }
}

// Component lifecycle
onMounted(async () => {
  try {
    await initializeUISyncTarget()
  } catch (err) {
    // Error already handled in initializeUISyncTarget
    console.error('Failed to set up UI sync target during mount:', err)
  }
})

onBeforeUnmount(async () => {
  await cleanupSyncTarget()
})
</script>

<template>
  <div class="file-system">
    <header>
      <h2>{{ system.title }}</h2>
    </header>
    <FileSystemExplorer 
      :file-system="system.fileSystem" 
      :sync-target="system.syncTarget"
      :title="system.title" 
      class="explorer"
      ref="explorerRef"
    />
    <SyncTargetStatus :target="system.syncTarget" class="sync-status" />
  </div>
</template>

<style scoped>
.file-system {
  display: flex;
  flex-direction: column;
  height: 100%;
  border: 1px solid var(--sl-color-neutral-200);
  border-radius: var(--sl-border-radius-medium);
  background: var(--sl-color-neutral-0);
}

header {
  padding: var(--sl-spacing-small) var(--sl-spacing-medium);
  border-bottom: 1px solid var(--sl-color-neutral-200);
}

h2 {
  margin: 0;
  font-size: var(--sl-font-size-large);
  color: var(--sl-color-neutral-900);
}

.explorer {
  flex: 1;
  min-height: 0;
  padding: var(--sl-spacing-small);
}

.sync-status {
  padding: var(--sl-spacing-small);
  border-top: 1px solid var(--sl-color-neutral-200);
}
</style> 