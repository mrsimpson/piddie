import { ref, computed } from 'vue'
import type { FileSystem, SyncTarget } from '@piddie/shared-types'
import type { FileViewModel } from '../types/file-explorer'

export function useFileSystem(target: SyncTarget) {
  const currentPath = ref('/')
  const items = ref<FileViewModel[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  const fileSystem = ref<FileSystem | null>(null)

  const sortedItems = computed(() => {
    return [...items.value].sort((a, b) => {
      // Directories first
      if (a.isDirectory !== b.isDirectory) {
        return a.isDirectory ? -1 : 1
      }
      // Then alphabetically
      return a.name.localeCompare(b.name)
    })
  })

  async function initialize() {
    try {
      loading.value = true
      error.value = null

      // Initialize target with file system
      await target.initialize(fileSystem.value!)

      // Load initial directory
      await loadDirectory('/')
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to initialize file system'
    } finally {
      loading.value = false
    }
  }

  async function loadDirectory(path: string) {
    try {
      loading.value = true
      error.value = null
      currentPath.value = path

      if (!fileSystem.value) {
        throw new Error('File system not initialized')
      }

      const entries = await fileSystem.value.listDirectory(path)
      const metadataPromises = entries.map((entry) => fileSystem.value!.getMetadata(entry.path))

      const metadata = await Promise.all(metadataPromises)

      items.value = entries.map((entry, index) => {
        const meta = metadata[index]
        if (!meta) throw new Error(`No metadata for ${entry.path}`)

        return {
          path: entry.path,
          name: entry.path.split('/').pop() || '',
          isDirectory: entry.type === 'directory',
          size: meta.size,
          lastModified: meta.lastModified,
          metadata: meta,
          selected: false,
        }
      })
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load directory'
    } finally {
      loading.value = false
    }
  }

  async function navigateUp() {
    const parentPath =
      currentPath.value === '/' ? '/' : currentPath.value.split('/').slice(0, -1).join('/') || '/'
    await loadDirectory(parentPath)
  }

  async function navigateTo(path: string) {
    await loadDirectory(path)
  }

  return {
    currentPath,
    items: sortedItems,
    loading,
    error,
    initialize,
    loadDirectory,
    navigateUp,
    navigateTo,
  }
}
