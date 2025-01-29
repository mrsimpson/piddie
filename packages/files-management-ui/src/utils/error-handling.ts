import { useErrorStore } from '../stores/error-store'

/**
 * Error handling utility for UI components
 * @param err - The error object
 * @param userMessage - User-friendly message to display
 * @param componentId - Optional identifier for the component raising the error
 */
export function handleUIError(err: unknown, userMessage: string, componentId?: string) {
    const errorStore = useErrorStore()
    errorStore.addError(userMessage, err, componentId)
    console.error(`[${componentId || 'unknown'}] ${userMessage}:`, err)
}
