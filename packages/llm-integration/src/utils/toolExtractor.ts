import type { ToolCall } from "@piddie/chat-management";

/**
 * Extract tool calls from partial text
 * @param text The text to parse
 * @param mcpToolUse The MCP tool use marker
 * @param isFinal Whether this is the final chunk of text
 * @returns Object with the updated content and extracted tool calls
 */
export function extractToolCallsFromPartialText(
    text: string,
    mcpToolUse: string = "json mcp-tool-use",
    isFinal: boolean = false
): { content: string; extractedToolCalls: ToolCall[] } {
    // Skip extraction for non-final chunks if text is too short to contain a complete tool call
    // This optimization prevents unnecessary regex processing on small chunks
    if (
        !isFinal &&
        text.length < 50 &&
        !text.includes("<tool>") &&
        !text.includes(`<${mcpToolUse}>`)
    ) {
        return { content: text, extractedToolCalls: [] };
    }

    const extractedToolCalls: ToolCall[] = [];
    let updatedContent = text;

    // MCP tool use format: ```json mcp-tool-use>...```
    // Only extract complete tool calls that have both opening and closing ```
    const completeToolCallRegex = new RegExp(
        `\`\`\`${mcpToolUse}\n(.*?)\n\`\`\``,
        "gs"
    );

    let match;
    while ((match = completeToolCallRegex.exec(text)) !== null) {
        try {
            if (match[1]) {
                const toolJson = match[1].trim();

                // Only attempt to parse if the JSON appears to be complete
                if (toolJson.includes('"name"') && toolJson.includes('"arguments"')) {
                    try {
                        const tool = JSON.parse(toolJson);

                        // Verify the tool has required fields before adding it
                        if (tool && tool.name) {
                            extractedToolCalls.push({
                                function: {
                                    name: tool.name,
                                    arguments:
                                        typeof tool.arguments === "string"
                                            ? tool.arguments
                                            : JSON.stringify(tool.arguments || {})
                                }
                            });

                            // Log successfully extracted tool call
                            console.log(
                                `[Orchestrator] Successfully extracted tool call: ${tool.name}`
                            );
                        }
                    } catch (parseError) {
                        // Only log parsing errors if this is the final chunk
                        if (isFinal) {
                            console.error("Error parsing MCP tool call:", parseError);
                        }
                        // Skip this tool call if parsing fails - it might be incomplete
                        continue;
                    }
                }
            }
        } catch (error) {
            console.error("Error processing MCP tool call:", error);
        }
    }

    // Remove complete tool calls from the content
    if (extractedToolCalls.length > 0) {
        // Remove MCP format tools
        updatedContent = updatedContent.replace(completeToolCallRegex, "");
    }

    // If this is the final chunk, try to extract incomplete tool calls
    if (isFinal) {
        // Check for incomplete MCP tool calls - this is a best effort to extract tools from partial content
        const incompleteMcpToolRegex = new RegExp(
            `\`\`\`${mcpToolUse}\n(.*?)(?:\`\`\`|$)`,
            "s"
        );
        const incompleteMcpMatch = incompleteMcpToolRegex.exec(updatedContent);

        if (incompleteMcpMatch && incompleteMcpMatch[1]) {
            try {
                const toolJson = incompleteMcpMatch[1].trim();
                // Only attempt to parse if the JSON appears to be complete
                if (toolJson.includes('"name"') && toolJson.includes('"arguments"')) {
                    try {
                        const tool = JSON.parse(toolJson);

                        if (tool && tool.name) {
                            extractedToolCalls.push({
                                function: {
                                    name: tool.name,
                                    arguments:
                                        typeof tool.arguments === "string"
                                            ? tool.arguments
                                            : JSON.stringify(tool.arguments || {})
                                }
                            });

                            // Remove the tool call from the content
                            updatedContent = updatedContent.replace(
                                incompleteMcpToolRegex,
                                ""
                            );
                            console.log(
                                `[Orchestrator] Extracted incomplete tool call in final chunk: ${tool.name}`
                            );
                        }
                    } catch {
                        // Ignore parsing errors for incomplete tool calls in final chunk
                        console.log(
                            `[Orchestrator] Failed to parse incomplete tool call JSON in final chunk`
                        );
                    }
                }
            } catch {
                // Ignore general errors for incomplete tool calls
            }
        }
    }

    // Log when we extract tools (helpful for debugging)
    if (extractedToolCalls.length > 0) {
        console.log(
            `[Orchestrator] Extracted ${extractedToolCalls.length} tool calls from text`
        );
        console.log(
            `[Orchestrator] Tool calls:`,
            extractedToolCalls.map((tc) => tc.function?.name)
        );
    }

    return { content: updatedContent.trim(), extractedToolCalls };
} 