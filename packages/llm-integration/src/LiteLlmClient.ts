import OpenAI from "openai";
import { v4 as uuidv4 } from "uuid";
import { EventEmitter } from "@piddie/shared-types";
import type {
  ChatCompletionAssistantMessageParam,
  ChatCompletionSystemMessageParam,
  ChatCompletionUserMessageParam,
  ChatCompletionRole
} from "openai/resources/chat";
import type {
  LlmMessage,
  LlmProviderConfig,
  LlmResponse,
  LlmStreamChunk
} from "./types";
import { LlmStreamEvent } from "./types";
import { BaseLlmClient, ToolSupportStatus } from "./BaseLlmClient";

/**
 * Client implementation for the LiteLLM API
 */
export class LiteLlmClient extends BaseLlmClient {
  private openai: OpenAI;

  /**
   * Creates a new LiteLlmClient
   * @param config The LLM provider configuration
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(config: LlmProviderConfig) {
    super(config);
    this.openai = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
      dangerouslyAllowBrowser:
        this.isLocalhostCommunication(config) || !config.baseUrl
    });
  }

  private isLocalhostCommunication(config: LlmProviderConfig) {
    return (
      config.baseUrl?.includes("localhost") ||
      config.baseUrl?.includes("127.0.0.1") ||
      config.baseUrl?.includes("::1")
    );
  }

  /**
   * Sends a message to the LLM and returns a response
   * @param message The message to send
   * @returns The response from the LLM
   */
  async sendMessage(message: LlmMessage): Promise<LlmResponse> {
    // Enhance message with tool instructions if needed
    const { message: enhancedMessage, hasNativeToolsSupport } =
      await this.addProvidedTools(message);

    // Use the messages array if provided, otherwise convert the single message
    const messages = enhancedMessage.messages || [
      this.convertToOpenAIMessage(enhancedMessage)
    ];

    try {
      // Use OpenAI SDK to send the request
      const completion = await this.openai.chat.completions.create({
        model: this.getSelectedModel(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        messages: messages as any,
        tools: hasNativeToolsSupport
          ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (enhancedMessage.tools as any)
          : undefined
      });

      // Extract the response data
      const choice = completion.choices[0];
      if (!choice || !choice.message) {
        throw new Error("No response from OpenAI");
      }
      const responseMessage = choice.message;
      const responseContent = responseMessage.content || "";

      // Process tool calls based on whether native tool support is available
      let processedToolCalls: Array<{
        function: {
          name: string;
          arguments: string | Record<string, unknown>;
        };
      }> = [];

      if (
        this.toolSupportStatus === ToolSupportStatus.NATIVE &&
        responseMessage.tool_calls
      ) {
        // Native tool support - process the tool_calls from the response
        processedToolCalls = responseMessage.tool_calls.map((toolCall) => {
          try {
            // Try to parse arguments as JSON
            const parsedArgs = JSON.parse(toolCall.function.arguments);
            return {
              function: {
                name: toolCall.function.name,
                arguments: parsedArgs
              }
            };
          } catch (error) {
            // If parsing fails, return the original string
            console.warn("Error parsing tool call arguments:", error);
            return {
              function: {
                name: toolCall.function.name,
                arguments: toolCall.function.arguments
              }
            };
          }
        });
      }

      // Create the LLM response
      const response: LlmResponse = {
        id: completion.id,
        chatId: enhancedMessage.chatId,
        content: responseContent,
        role: responseMessage.role as ChatCompletionRole,
        created: new Date(completion.created * 1000), // Convert timestamp to Date
        parentId: enhancedMessage.id,
        tool_calls: processedToolCalls.length > 0 ? processedToolCalls : []
      };

      // Post-process the response to extract tool calls if needed
      return this.postProcessResponse(response);
    } catch (error) {
      console.error("Error sending message to OpenAI:", error);
      throw new Error(
        `OpenAI API error: ${error instanceof Error ? error.message : String(error)}`
      );
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
      id: uuidv4(),
      chatId: message.chatId,
      content: "",
      role: "assistant",
      created: new Date(),
      parentId: message.id,
      tool_calls: []
    };

    // Map to track tool calls by index
    const toolCallsMap: Record<
      number,
      {
        name: string;
        arguments: string;
      }
    > = {};

    // Start the streaming request
    const streamRequest = async () => {
      try {
        // Enhance message with tool instructions if needed
        const { message: enhancedMessage } =
          await this.addProvidedTools(message);

        // Use the messages array if provided, otherwise convert the single message
        const messages = enhancedMessage.messages || [
          this.convertToOpenAIMessage(enhancedMessage)
        ];

        // Determine if we should include tools in the request
        const includeTools = this.shouldIncludeToolsInRequest(enhancedMessage);

        console.log("[LiteLlmClient] Starting streaming request");

        // Use OpenAI SDK with streaming
        const stream = await this.openai.chat.completions.create({
          model: this.getSelectedModel(),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          messages: messages as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          tools: includeTools ? (enhancedMessage.tools as any) : undefined,
          stream: true
        });

        // Process the stream
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta;

          if (!delta) continue;

          // Handle content updates - emit immediately for responsive UI
          if (delta.content) {
            response.content += delta.content;

            // For streaming, we don't try to extract tool calls from each chunk
            // as the JSON might be incomplete. We'll do it at the end.
            const streamChunk: LlmStreamChunk = {
              content: delta.content,
              isFinal: false
            };

            // Use setTimeout to ensure the event loop can process UI updates
            setTimeout(() => {
              eventEmitter.emit(LlmStreamEvent.DATA, streamChunk);
            }, 0);
          }

          // Handle tool calls (only for native tool support)
          if (
            this.toolSupportStatus === ToolSupportStatus.NATIVE &&
            delta.tool_calls &&
            delta.tool_calls.length > 0
          ) {
            let updated = false;

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
                updated = true;
              }

              // Update arguments if provided
              if (toolCall.function?.arguments) {
                toolCallsMap[index].arguments += toolCall.function.arguments;
                updated = true;
              }
            }

            // Only emit if there was an update
            if (updated) {
              // Convert map to array of tool calls
              const currentToolCalls = Object.values(toolCallsMap)
                .filter((tc) => tc.name) // Only include tool calls with a name
                .map((tc) => {
                  // Try to parse arguments as JSON if it looks complete
                  if (
                    tc.arguments &&
                    tc.arguments.trim().startsWith("{") &&
                    tc.arguments.trim().endsWith("}")
                  ) {
                    try {
                      const parsedArgs = JSON.parse(tc.arguments);
                      return {
                        function: {
                          name: tc.name,
                          arguments: parsedArgs
                        }
                      };
                    } catch (error) {
                      // If parsing fails, return the original string
                      console.warn("Error parsing tool call arguments:", error);
                      return {
                        function: {
                          name: tc.name,
                          arguments: tc.arguments
                        }
                      };
                    }
                  } else {
                    // If it doesn't look like complete JSON, return the original string
                    return {
                      function: {
                        name: tc.name,
                        arguments: tc.arguments
                      }
                    };
                  }
                });

              // Update the response
              response.tool_calls = currentToolCalls;

              // Emit a chunk with the tool calls - use setTimeout for responsiveness
              setTimeout(() => {
                const streamChunk: LlmStreamChunk = {
                  content: "",
                  tool_calls: currentToolCalls,
                  isFinal: false
                };
                eventEmitter.emit(LlmStreamEvent.DATA, streamChunk);
              }, 0);
            }
          }

          // Check if this is the final chunk
          if (chunk.choices[0]?.finish_reason) {
            // Final processing based on tool support type
            if (
              this.toolSupportStatus === ToolSupportStatus.NATIVE &&
              Object.keys(toolCallsMap).length > 0
            ) {
              // Process native tool calls
              const finalToolCalls = Object.values(toolCallsMap)
                .filter((tc) => tc.name)
                .map((tc) => {
                  if (
                    tc.arguments &&
                    tc.arguments.trim().startsWith("{") &&
                    tc.arguments.trim().endsWith("}")
                  ) {
                    try {
                      const parsedArgs = JSON.parse(tc.arguments);
                      return {
                        function: {
                          name: tc.name,
                          arguments: parsedArgs
                        }
                      };
                    } catch (error) {
                      // If parsing fails, return the original string
                      console.warn("Error parsing tool call arguments:", error);
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

            // Post-process the response to extract tool calls from text if needed
            const processedResponse = this.postProcessResponse(response);

            // Send a final chunk with isFinal=true
            const finalChunk: LlmStreamChunk = {
              content: processedResponse.content,
              ...(processedResponse.tool_calls &&
              processedResponse.tool_calls.length > 0
                ? { tool_calls: processedResponse.tool_calls }
                : {}),
              isFinal: true
            };
            eventEmitter.emit(LlmStreamEvent.DATA, finalChunk);

            // Emit the end event when the stream is complete
            eventEmitter.emit(LlmStreamEvent.END, processedResponse);
            return;
          }
        }

        // If we get here, the stream ended without a finish_reason
        // Final processing based on tool support type
        if (
          this.toolSupportStatus === ToolSupportStatus.NATIVE &&
          Object.keys(toolCallsMap).length > 0
        ) {
          // Process native tool calls
          const finalToolCalls = Object.values(toolCallsMap)
            .filter((tc) => tc.name)
            .map((tc) => {
              if (
                tc.arguments &&
                tc.arguments.trim().startsWith("{") &&
                tc.arguments.trim().endsWith("}")
              ) {
                try {
                  const parsedArgs = JSON.parse(tc.arguments);
                  return {
                    function: {
                      name: tc.name,
                      arguments: parsedArgs
                    }
                  };
                } catch (error) {
                  // If parsing fails, return the original string
                  console.warn("Error parsing tool call arguments:", error);
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

        // Post-process the response to extract tool calls from text if needed
        const processedResponse = this.postProcessResponse(response);

        // Send a final chunk with isFinal=true
        const finalChunk: LlmStreamChunk = {
          content: processedResponse.content,
          ...(processedResponse.tool_calls &&
          processedResponse.tool_calls.length > 0
            ? { tool_calls: processedResponse.tool_calls }
            : {}),
          isFinal: true
        };
        eventEmitter.emit(LlmStreamEvent.DATA, finalChunk);

        // Emit the end event when the stream is complete
        eventEmitter.emit(LlmStreamEvent.END, processedResponse);
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
      // Try to send a message with a tool
      await this.openai.chat.completions.create({
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
      const errorMessage =
        error instanceof Error ? error.message : String(error);
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
