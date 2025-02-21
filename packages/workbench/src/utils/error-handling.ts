/**
 * Handles UI errors in a consistent way across the application
 * @param err - The error object
 * @param userMessage - User-friendly message to display
 * @param componentId - Optional identifier for the component raising the error
 */
export function handleUIError(
  err: unknown,
  userMessage: string,
  componentId?: string
) {
  const error = err instanceof Error ? err : new Error(String(err));
  console.error(`[${componentId || "Unknown"}] ${userMessage}:`, error);
  // TODO: Add error notification system
}
