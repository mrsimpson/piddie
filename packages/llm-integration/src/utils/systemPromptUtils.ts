/**
 * Generate a system prompt for the LLM
 * @param supportsTools Whether the LLM provider supports tools natively
 * @param mcpToolUseIndicator The MCP tool use marker
 * @returns The system prompt
 */
export function compileSystemPrompt(
    supportsTools: boolean = true,
    mcpToolUseIndicator: string
): string {
    let systemPrompt = `You are a helpful coding assistant.
  I want you to help me analyze and structure existing code as well as new artifacts.

  USE THE TOOLS!
  I will provide you with tools you can use to interact with my development environment. 
  If you utilize a tool, explain that you are doing it and why you do it.
  Make sure you populate all required parameters with the required data types of each tool you use
  You can use multiple tools in a single message if needed.
  After using a tool, continue your response based on the tool's output.
  `;

    // If the LLM doesn't support tools natively, add instructions for using tools
    if (!supportsTools) {
        systemPrompt += `\n\n
            
      When you use a tool, format EACH tool call in your response like this (one block per tool call!):

      \`\`\`json ${mcpToolUseIndicator}
      {
        "name": "tool_name",
        "arguments": {
          "arg1": "value1",
          "arg2": "value2"
        }
      }
      \`\`\`

      Simple example:

      \`\`\`json ${mcpToolUseIndicator}
      {
        "name": "search",
        "arguments": {
          "query": "What is the capital of France?"
        }
      }
      \`\`\`

      Multiple tool calls example using the same tool twice:
      \`\`\`json ${mcpToolUseIndicator}
      {
        "name": "tool1",
        "arguments": {
          "arg1": "one",
          "arg2": "two"
        }
      }
      \`\`\`

      \`\`\`json ${mcpToolUseIndicator}
      {
        "name": "tool1",
        "arguments": {
          "arg1": "three",
          "arg2": "four"
        }
      }
      \`\`\`

      Always format your tool calls exactly as shown above.
`;
    }

    return systemPrompt;
} 