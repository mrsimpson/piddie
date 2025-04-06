import type { ToolCall } from "@piddie/chat-management";

/**
 * A queue for managing tool calls in a FIFO manner with abort functionality
 */
export class ToolCallQueue {
    private queue: Array<{
        toolCall: ToolCall;
        resolve: (result: unknown) => void;
        reject: (error: unknown) => void;
    }> = [];
    private isProcessing = false;
    private aborted = false;
    private executeToolFn: (toolCall: ToolCall) => Promise<unknown>;

    /**
     * Creates a new ToolCallQueue
     * @param executeToolFn Function to execute tool calls
     */
    constructor(executeToolFn: (toolCall: ToolCall) => Promise<unknown>) {
        this.executeToolFn = executeToolFn;
    }

    /**
     * Adds a tool call to the queue
     * @param toolCall The tool call to add
     * @returns A promise that resolves with the tool call itself (containing the result)
     */
    async enqueue(toolCall: ToolCall): Promise<ToolCall> {
        // If the queue is aborted, reject immediately
        if (this.aborted) {
            return Promise.reject(new Error("Tool call queue has been aborted"));
        }

        // Return a promise that will be resolved when the tool call is executed
        return new Promise((resolve, reject) => {
            // Add the tool call to the queue
            this.queue.push({
                toolCall,
                resolve: () => resolve(toolCall),
                reject
            });

            // Start processing if not already doing so
            if (!this.isProcessing) {
                this.processNext();
            }
        });
    }

    /**
     * Processes the next tool call in the queue
     */
    private async processNext(): Promise<void> {
        // If the queue is empty or aborted, stop processing
        if (this.queue.length === 0 || this.aborted) {
            this.isProcessing = false;
            return;
        }

        // Mark as processing
        this.isProcessing = true;

        // Get the next tool call from the queue
        const { toolCall, resolve, reject } = this.queue.shift()!;

        try {
            // Execute the tool call
            await this.executeToolFn(toolCall);
            // Resolve the promise with the tool call itself (now containing the result)
            resolve(toolCall);
        } catch (error) {
            // Reject the promise with the error
            reject(error);
        } finally {
            // Process the next tool call
            this.processNext();
        }
    }

    /**
     * Gets the number of pending tool calls in the queue
     * @returns The number of pending tool calls
     */
    get pendingCount(): number {
        return this.queue.length;
    }

    /**
     * Checks if the queue is currently processing a tool call
     * @returns True if the queue is processing, false otherwise
     */
    get isActive(): boolean {
        return this.isProcessing;
    }

    /**
     * Aborts all pending tool calls in the queue
     */
    abort(): void {
        // Set the aborted flag
        this.aborted = true;

        // Reject all pending promises
        for (const { reject } of this.queue) {
            reject(new Error("Tool call aborted"));
        }

        // Clear the queue
        this.queue = [];
    }

    /**
     * Resets the queue to its initial state
     */
    reset(): void {
        this.aborted = false;
        this.isProcessing = false;
        this.queue = [];
    }
} 