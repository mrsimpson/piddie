import type {
  LlmMessage,
  LlmResponse,
  LlmStreamChunk
} from "./types";
import { LlmStreamEvent } from "./types";
import { EventEmitter } from "@piddie/shared-types";
import type {
  ChatCompletionRole,
  ChatCompletionUserMessageParam,
  ChatCompletionAssistantMessageParam,
  ChatCompletionSystemMessageParam
} from "openai/resources/chat";
import { BaseLlmClient } from "./BaseLlmClient";
import OpenAI from "openai";
import { MessageStatus } from "@piddie/chat-management";

/**
 * Client implementation for the LiteLLM API
 */
export class LiteLlmClient extends BaseLlmClient {
  private openai: OpenAI;

  constructor(config: any) {
    super(config);

    // Check if the baseUrl is a localhost URL
    const isLocalhost = !!(this.config.baseUrl && (
      this.config.baseUrl.includes('localhost') ||
      this.config.baseUrl.includes('127.0.0.1') ||
      this.config.baseUrl.includes('::1')
    ));

    // Initialize OpenAI client with dangerouslyAllowBrowser option for localhost
    this.openai = new OpenAI({
      apiKey: this.config.apiKey,
      baseURL: this.config.baseUrl,
      // Allow browser usage when connecting to localhost
      // This is safe because we're only connecting to a local server
      // and not exposing API keys to potential attackers
      dangerouslyAllowBrowser: isLocalhost
    });
  }

  /**
   * Sends a message to the LLM and returns a response
   * @param message The message to send
   * @returns The response from the LLM
   */
  async sendMessage(message: LlmMessage): Promise<LlmResponse> {
    // Enhance message with tool instructions if needed
    const enhancedMessage = await this.addProvidedTools(message);

    // Use the messages array if provided, otherwise convert the single message
    const messages = enhancedMessage.messages || [this.convertToOpenAIMessage(enhancedMessage)];

    // Determine if we should include tools in the request
    const includeTools = this.shouldIncludeToolsInRequest(enhancedMessage);

    try {
      // Use OpenAI SDK to send the request
      const completion = await this.openai.chat.completions.create({
        model: this.getSelectedModel(),
        messages: messages as any,
        tools: includeTools ? enhancedMessage.tools as any : undefined
      });

      // Extract the response data
      const choice = completion.choices[0];
      if (!choice || !choice.message) {
        throw new Error("No response from OpenAI");
      }
      const responseMessage = choice.message;

      // Process tool calls if present
      const toolCalls = responseMessage.tool_calls || [];
      const processedToolCalls = toolCalls.map(toolCall => {
        try {
          // Try to parse arguments as JSON
          const parsedArgs = JSON.parse(toolCall.function.arguments);
          return {
            function: {
              name: toolCall.function.name,
              arguments: parsedArgs
            }
          };
        } catch (e) {
          // If parsing fails, return the original string
          return {
            function: {
              name: toolCall.function.name,
              arguments: toolCall.function.arguments
            }
          };
        }
      });

      // Create and return the LLM response
      return {
        id: completion.id,
        chatId: enhancedMessage.chatId,
        content: responseMessage.content || "",
        role: responseMessage.role as ChatCompletionRole,
        created: new Date(completion.created * 1000), // Convert timestamp to Date
        parentId: enhancedMessage.id,
        tool_calls: processedToolCalls.length > 0 ? processedToolCalls : []
      };
    } catch (error) {
      console.error("Error sending message to OpenAI:", error);
      throw new Error(`OpenAI API error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Sends a message to the LLM and streams the response
   * @param message The message to send
   * @returns An event emitter that emits 'data', 'end', and 'error' events
   */
  streamMessage(message: LlmMessage): EventEmitter {
    const eventEmitter = new EventEmitter();

    // Create a response object to accumulate content
    const response: LlmResponse = {
      id: crypto.randomUUID(),
      chatId: message.chatId,
      content: "",
      role: "assistant",
      created: new Date(),
      parentId: message.id,
      tool_calls: []
    };

    // Map to track tool calls by index
    const toolCallsMap: Record<number, {
      name: string;
      arguments: string;
    }> = {};

    // Start the streaming request
    const streamRequest = async () => {
      try {
        // Enhance message with tool instructions if needed
        const enhancedMessage = await this.addProvidedTools(message);

        // Use the messages array if provided, otherwise convert the single message
        const messages = enhancedMessage.messages || [
          this.convertToOpenAIMessage(enhancedMessage)
        ];

        // Determine if we should include tools in the request
        const includeTools = this.shouldIncludeToolsInRequest(enhancedMessage);

        // Use OpenAI SDK with streaming
        const stream = await this.openai.chat.completions.create({
          model: this.getSelectedModel(),
          messages: messages as any,
          tools: includeTools ? enhancedMessage.tools as any : undefined,
          stream: true
        });

        // Process the stream
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta;

          if (!delta) continue;

          // Handle content updates
          if (delta.content) {
            response.content += delta.content;
            const streamChunk: LlmStreamChunk = {
              content: delta.content,
              isFinal: false
            };
            eventEmitter.emit(LlmStreamEvent.DATA, streamChunk);
          }

          // Handle tool calls
          if (delta.tool_calls && delta.tool_calls.length > 0) {

            for (const toolCall of delta.tool_calls) {
              const index = toolCall.index || 0;

              // Initialize tool call if it doesn't exist
              if (!toolCallsMap[index]) {
                toolCallsMap[index] = {
                  name: "",
                  arguments: ""
                };
              }

              // Update name if provided
              if (toolCall.function?.name) {
                toolCallsMap[index].name += toolCall.function.name;
              }

              // Update arguments if provided
              if (toolCall.function?.arguments) {
                toolCallsMap[index].arguments += toolCall.function.arguments;
              }
            }
          }

          // Check if this is the final chunk
          if (chunk.choices[0]?.finish_reason) {
            // Final processing of tool calls
            if (Object.keys(toolCallsMap).length > 0) {
              const finalToolCalls = Object.values(toolCallsMap)
                .filter(tc => tc.name)
                .map(tc => {
                  if (tc.arguments &&
                    tc.arguments.trim().startsWith('{') &&
                    tc.arguments.trim().endsWith('}')) {
                    try {
                      return {
                        function: {
                          name: tc.name,
                          arguments: JSON.parse(tc.arguments)
                        }
                      };
                    } catch (e) {
                      return {
                        function: {
                          name: tc.name,
                          arguments: tc.arguments
                        }
                      };
                    }
                  } else {
                    return {
                      function: {
                        name: tc.name,
                        arguments: tc.arguments
                      }
                    };
                  }
                });

              response.tool_calls = finalToolCalls;
            }

            // Send a final chunk with isFinal=true
            const finalChunk: LlmStreamChunk = {
              content: response.content,
              ...(response.tool_calls && response.tool_calls.length > 0 ? { tool_calls: response.tool_calls } : {}),
              isFinal: true
            };
            eventEmitter.emit(LlmStreamEvent.DATA, finalChunk);

            // Emit the end event when the stream is complete
            eventEmitter.emit(LlmStreamEvent.END, response);
            return;
          }
        }

        // If we get here, the stream ended without a finish_reason
        // Final processing of tool calls
        if (Object.keys(toolCallsMap).length > 0) {
          const finalToolCalls = Object.values(toolCallsMap)
            .filter(tc => tc.name)
            .map(tc => {
              if (tc.arguments &&
                tc.arguments.trim().startsWith('{') &&
                tc.arguments.trim().endsWith('}')) {
                try {
                  return {
                    function: {
                      name: tc.name,
                      arguments: JSON.parse(tc.arguments)
                    }
                  };
                } catch (e) {
                  return {
                    function: {
                      name: tc.name,
                      arguments: tc.arguments
                    }
                  };
                }
              } else {
                return {
                  function: {
                    name: tc.name,
                    arguments: tc.arguments
                  }
                };
              }
            });

          response.tool_calls = finalToolCalls;
        }

        // Send a final chunk with isFinal=true
        const finalChunk: LlmStreamChunk = {
          content: response.content,
          ...(response.tool_calls && response.tool_calls.length > 0 ? { tool_calls: response.tool_calls } : {}),
          isFinal: true
        };
        eventEmitter.emit(LlmStreamEvent.DATA, finalChunk);

        // Emit the end event when the stream is complete
        eventEmitter.emit(LlmStreamEvent.END, response);
      } catch (error) {
        console.error("Error streaming response:", error);

        // Emit the error
        eventEmitter.emit(LlmStreamEvent.ERROR, error);
      }
    };

    // Start the streaming process
    streamRequest();

    // Return the event emitter
    return eventEmitter;
  }

  /**
   * Converts an LlmMessage to an OpenAI message
   * @param message The message to convert
   * @returns The OpenAI message
   */
  private convertToOpenAIMessage(
    message: LlmMessage
  ):
    | ChatCompletionUserMessageParam
    | ChatCompletionAssistantMessageParam
    | ChatCompletionSystemMessageParam {
    switch (message.role) {
      case "user":
        return {
          role: "user",
          content: message.content
        };
      case "assistant":
        return {
          role: "assistant",
          content: message.content
        };
      case "system":
        return {
          role: "system",
          content: message.content
        };
      default:
        return {
          role: "user",
          content: message.content
        };
    }
  }

  /**
   * Checks if the LLM supports function calling/tools directly
   * @returns A promise that resolves to true if tools are supported, false otherwise
   */
  protected override async checkToolSupportDirectly(): Promise<boolean> {
    try {
      // Create a simple test message
      const testMessage: LlmMessage = {
        id: "test",
        chatId: "test",
        content: "Hello",
        role: "user",
        status: MessageStatus.SENT,
        created: new Date(),
        provider: "litellm",
        tools: [
          {
            type: "function",
            function: {
              name: "test_function",
              description: "A test function",
              parameters: {
                type: "object",
                properties: {
                  test: {
                    type: "string"
                  }
                }
              }
            }
          }
        ]
      };

      // Try to send a message with a tool
      const response = await this.openai.chat.completions.create({
        model: this.getSelectedModel(),
        messages: [{ role: "user", content: "Hello" }],
        tools: [
          {
            type: "function",
            function: {
              name: "test_function",
              description: "A test function",
              parameters: {
                type: "object",
                properties: {
                  test: {
                    type: "string"
                  }
                }
              }
            }
          }
        ],
        stream: false
      });

      // If we get here, tools are supported
      return true;
    } catch (error) {
      // Check if the error is related to tools not being supported
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (
        errorMessage.includes("tools") &&
        errorMessage.includes("not supported")
      ) {
        return false;
      }

      // If it's some other error, assume tools are not supported
      console.error("Error checking tool support:", error);
      return false;
    }
  }
}
