import type { ToolCall, ToolCallResult } from "@piddie/chat-management";
import { ActionsManager } from "@piddie/actions";
import { EventEmitter } from "@piddie/shared-types";
import type { LlmStreamChunk } from "../types";
import { ToolCallQueue } from "./ToolCallQueue";

/**
 * Execute a tool call by delegating to the ActionsManager
 * @param toolCall The tool call to execute
 * @param actionsManager The actions manager to use for execution
 * @returns The result of the tool call
 */
export async function executeToolCall(
  toolCall: ToolCall,
  actionsManager: ActionsManager
): Promise<ToolCallResult> {
  if (!toolCall || !toolCall.function || !toolCall.function.name) {
    throw new Error("Invalid tool call");
  }

  const toolName = toolCall.function.name;
  const toolArgs = toolCall.function.arguments || {};
  let parsedArgs;

  try {
    // If arguments are provided as a string, parse them to an object
    if (typeof toolArgs === "string") {
      parsedArgs = JSON.parse(toolArgs);
    } else {
      parsedArgs = toolArgs;
    }

    // Call the tool via the ActionsManager
    console.log(`[Orchestrator] Executing tool call: ${toolName}`);
    const result = await actionsManager.executeToolCall(toolName, parsedArgs);

    // Attach the result to the tool call
    toolCall.result = {
      status: result.status,
      value: result.value,
      contentType: result.contentType,
      timestamp: result.timestamp
    };

    console.log(
      `[Orchestrator] Tool call executed successfully: ${toolName}`,
      result
    );
    return result;
  } catch (error) {
    // Attach error result to the tool call
    toolCall.result = {
      status: "error",
      value: error instanceof Error ? error.message : String(error),
      contentType: "text/plain",
      timestamp: new Date()
    };

    // Return the error to be handled by the caller
    console.error(`[Orchestrator] Error executing tool call:`, error);
    throw error;
  }
}

/**
 * Helper function to generate a consistent ID for a tool call
 * @param toolCall The tool call to generate an ID for
 * @returns A string identifier for the tool call
 */
export function getToolCallId(toolCall: ToolCall): string {
  if (!toolCall || !toolCall.function) return "";

  const args =
    typeof toolCall.function.arguments === "string"
      ? toolCall.function.arguments
      : JSON.stringify(toolCall.function.arguments || {});

  return `${toolCall.function.name}-${args}`;
}

/**
 * Validates if a tool call is complete and valid for execution
 * @param toolCall The tool call to validate
 * @returns True if the tool call is valid, false otherwise
 */
export function isValidToolCall(toolCall: ToolCall): boolean {
  if (!toolCall.function || !toolCall.function.name) {
    console.log(`[Orchestrator] Skipping invalid tool call: missing name`);
    return false;
  }

  const args = toolCall.function.arguments;
  if (typeof args === "string") {
    try {
      JSON.parse(args);
    } catch {
      console.log(
        `[Orchestrator] Skipping incomplete tool call: ${toolCall.function.name} (invalid JSON arguments)`
      );
      return false;
    }
  } else if (!args || typeof args !== "object") {
    console.log(
      `[Orchestrator] Skipping incomplete tool call: ${toolCall.function.name} (missing arguments)`
    );
    return false;
  }

  return true;
}

/**
 * Processes a batch of tool calls, filtering out invalid ones
 * @param toolCalls Array of tool calls to process
 * @returns Array of valid tool calls
 */
export function filterValidToolCalls(toolCalls: ToolCall[]): ToolCall[] {
  const validCalls = toolCalls.filter((toolCall) => isValidToolCall(toolCall));

  if (validCalls.length < toolCalls.length) {
    console.log(
      `[Orchestrator] Filtered out ${toolCalls.length - validCalls.length} incomplete tool calls`
    );
  }

  return validCalls;
}

/**
 * Processes a tool call using the provided queue
 * @param toolCall The tool call to process
 * @param processedIds Set of already processed tool call IDs
 * @param toolCalls Array to add the processed tool call to
 * @param toolCallQueue Queue for processing tool calls
 * @returns True if the tool was processed, false if skipped
 */
export async function processToolCall(
  toolCall: ToolCall,
  processedIds: Set<string>,
  toolCalls: ToolCall[],
  toolCallQueue: ToolCallQueue
): Promise<boolean> {
  // Skip invalid tool calls
  if (!isValidToolCall(toolCall)) {
    return false;
  }

  const toolCallId = getToolCallId(toolCall);

  // Skip if already processed
  if (processedIds.has(toolCallId)) {
    console.log(
      `[Orchestrator] Skipping already executed tool: ${toolCall.function.name}`
    );
    return false;
  }

  // Mark as processed
  processedIds.add(toolCallId);

  try {
    console.log(
      `[Orchestrator] Starting execution of tool call: ${toolCall.function.name}`
    );

    // Enqueue for execution
    await toolCallQueue.enqueue(toolCall);

    console.log(
      `[Orchestrator] Tool call execution complete: ${toolCall.function.name}`
    );

    // Track if not already tracked
    if (!toolCalls.some((tc) => getToolCallId(tc) === toolCallId)) {
      toolCalls.push(toolCall);
    }

    return true;
  } catch (error) {
    console.error(
      `[Orchestrator] Error executing tool call: ${toolCall.function.name}`,
      error
    );
    return true; // We still consider it processed
  }
}

/**
 * Prepares and emits the end event for a stream
 * @param emitter The event emitter
 * @param toolCallQueue The tool call queue
 * @param finalData The final chunk data (if available)
 * @param toolCalls The executed tool calls
 * @param fallbackContent Fallback content if no final data is available
 */
export async function prepareAndEmitEndEvent(
  emitter: EventEmitter,
  toolCallQueue: ToolCallQueue,
  finalData: LlmStreamChunk | null,
  toolCalls: ToolCall[],
  fallbackContent: string = ""
): Promise<void> {
  // Ensure any pending tool calls are completed
  if (toolCallQueue.isActive || toolCallQueue.pendingCount > 0) {
    console.log(
      "[Orchestrator] Waiting for pending tool calls to complete before ending stream"
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  console.log(
    "[Orchestrator] Emitting end event after executing all tool calls"
  );
  console.log(
    `[Orchestrator] Tool calls included in end event: ${toolCalls.length}`
  );

  if (toolCalls.length > 0) {
    console.log(
      `[Orchestrator] Tool names: ${toolCalls.map((tc) => tc.function.name).join(", ")}`
    );
  }

  if (finalData) {
    emitter.emit("end", {
      ...finalData,
      tool_calls: toolCalls
    });
  } else {
    emitter.emit("end", {
      id: `response-${Date.now()}`,
      content: fallbackContent,
      tool_calls: toolCalls
    });
  }
}

/**
 * Format tool calls for display in system message
 * @param toolCalls Array of tool calls to format
 * @returns Formatted string for system message
 */
export function formatToolCallsForSystemMessage(toolCalls: ToolCall[]): string {
  return toolCalls
    .map((toolCall) => {
      // Format function name and arguments
      const toolName = toolCall.function.name;
      let args = "";

      if (typeof toolCall.function.arguments === "string") {
        try {
          args = JSON.stringify(
            JSON.parse(toolCall.function.arguments),
            null,
            2
          );
        } catch {
          args = toolCall.function.arguments;
        }
      } else {
        args = JSON.stringify(toolCall.function.arguments || {}, null, 2);
      }

      // Format result
      let resultFormatted = "No result available";
      if (toolCall.result) {
        const status = toolCall.result.status;
        const value =
          typeof toolCall.result.value === "object"
            ? JSON.stringify(toolCall.result.value, null, 2)
            : String(toolCall.result.value);

        resultFormatted = `${status.toUpperCase()}: ${value}`;
      }

      // Return formatted tool call
      return `Tool: ${toolName}\nArguments: ${args}\nResult: ${resultFormatted}`;
    })
    .join("\n\n");
}
