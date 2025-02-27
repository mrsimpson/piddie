import type { LlmClient, LlmMessage, LlmResponse } from "./types";
import { LlmStreamEvent } from "./types";
import { type ChatManager, MessageStatus } from "@piddie/chat-management";
import { EventEmitter } from "./event-emitter";

export class Orchestrator {
  private client: LlmClient;
  private chatManager: ChatManager;

  /**
   * Creates a new Orchestrator instance
   * @param client The LLM client to use
   * @param chatManager The chat manager for conversation history
   */
  constructor(client: LlmClient, chatManager: ChatManager) {
    this.client = client;
    this.chatManager = chatManager;
  }

  /**
   * Processes a message by enhancing it with context and tools before sending to the LLM
   * @param message The message to process
   * @returns The LLM response
   */
  async processMessage(message: LlmMessage): Promise<LlmResponse> {
    try {
      // Get chat history if chat manager is available
      const chatHistory = await this.getChatHistory(message.chatId);

      // Enhance message with context and tools
      const enhancedMessage = await this.enhanceMessageWithContext(
        message,
        chatHistory
      );

      // Send message to LLM
      const response = await this.client.sendMessage(enhancedMessage);

      // Process response for tool calls or other special handling
      const processedResponse = await this.processLlmResponse(response);

      // Update message status
      try {
        await this.chatManager.updateMessageStatus(
          message.chatId,
          processedResponse.parentId || message.id, // Use the parent ID from the response if available
          MessageStatus.SENT
        );
      } catch (statusError) {
        console.error("Error updating message status:", statusError);
        // Continue despite status update error
      }

      return processedResponse;
    } catch (error) {
      console.error("Error processing message:", error);

      // Update message status to ERROR
      try {
        await this.chatManager.updateMessageStatus(
          message.chatId,
          message.id,
          MessageStatus.ERROR
        );
      } catch (statusError) {
        console.error("Error updating message status:", statusError);
        // Continue despite status update error
      }

      throw error;
    }
  }

  /**
   * Processes a message by enhancing it with context and tools before streaming the response from the LLM
   * @param message The message to process
   * @returns An event emitter that emits 'data', 'end', and 'error' events
   */
  async processMessageStream(message: LlmMessage): Promise<EventEmitter> {
    const eventEmitter = new EventEmitter();

    try {
      // Get chat history
      const chatHistory = await this.getChatHistory(message.chatId);

      // Enhance message with context and tools
      const enhancedMessage = await this.enhanceMessageWithContext(
        message,
        chatHistory
      );

      // Stream message to LLM
      const stream = this.client.streamMessage(enhancedMessage);

      // Process stream chunks
      let fullResponse: LlmResponse | null = null;

      stream.on(LlmStreamEvent.DATA, async (chunk: LlmResponse) => {
        // Process chunk for tool calls or other special handling
        const processedChunk = await this.processLlmResponseChunk(chunk);
        eventEmitter.emit(LlmStreamEvent.DATA, processedChunk);
      });

      stream.on(LlmStreamEvent.END, async (response: LlmResponse) => {
        try {
          // Process final response
          fullResponse = await this.processLlmResponse(response);

          // Update message status
          try {
            await this.chatManager.updateMessageStatus(
              message.chatId,
              fullResponse.parentId || message.id, // Use the parent ID from the response if available
              MessageStatus.SENT
            );
          } catch (statusError) {
            console.error("Error updating message status:", statusError);
            // Continue despite status update error
          }
        } catch (processingError) {
          console.error("Error processing final response:", processingError);
          fullResponse = response; // Use original response if processing fails
        } finally {
          // Always emit the END event, even if there were errors
          eventEmitter.emit(LlmStreamEvent.END, fullResponse || response);
        }
      });

      stream.on(LlmStreamEvent.ERROR, async (error: Error) => {
        console.error("Error streaming response:", error);

        // Update message status to ERROR
        try {
          await this.chatManager.updateMessageStatus(
            message.chatId,
            message.id,
            MessageStatus.ERROR
          );
        } catch (statusError) {
          console.error("Error updating message status:", statusError);
          // Continue despite status update error
        }

        eventEmitter.emit(LlmStreamEvent.ERROR, error);
      });
    } catch (error) {
      console.error("Error setting up message stream:", error);

      // Update message status to ERROR
      try {
        await this.chatManager.updateMessageStatus(
          message.chatId,
          message.id,
          MessageStatus.ERROR
        );
      } catch (statusError) {
        console.error("Error updating message status:", statusError);
        // Continue despite status update error
      }

      eventEmitter.emit(LlmStreamEvent.ERROR, error);
    }

    return eventEmitter;
  }

  /**
   * Gets the chat history for a chat
   * @param chatId The ID of the chat
   * @returns The chat history as LLM messages
   */
  private async getChatHistory(chatId: string): Promise<LlmMessage[]> {
    let chatHistory: LlmMessage[] = [];

    try {
      const chat = await this.chatManager.getChat(chatId);
      // Convert chat messages to LLM messages
      chatHistory = chat.messages.map((m) => ({
        id: m.id,
        chatId: m.chatId,
        content: m.content,
        role: m.role,
        status: m.status,
        created: m.created,
        parentId: m.parentId
      }));
    } catch (error) {
      console.error("Error getting chat history:", error);
    }

    return chatHistory;
  }

  /**
   * Enhances a message with context and tools using the MCP
   * @param message The message to enhance
   * @param chatHistory The chat history for context
   * @returns The enhanced message
   */
  private async enhanceMessageWithContext(
    message: LlmMessage,
    chatHistory: LlmMessage[]
  ): Promise<LlmMessage> {
    // This is where we would use the MCP to enhance the message
    // For now, we'll just add the chat history to the message content

    // In a real implementation, we would:
    // 1. Get relevant context from the context manager
    // 2. Get available tools from the actions manager
    // 3. Format the message with the context and tools

    return {
      ...message,
      content: `
Chat History:
${chatHistory.map((m) => `${m.role}: ${m.content}`).join("\n")}

User Message:
${message.content}
      `.trim()
    };
  }

  /**
   * Processes an LLM response for tool calls or other special handling
   * @param response The LLM response to process
   * @returns The processed response
   */
  private async processLlmResponse(
    response: LlmResponse
  ): Promise<LlmResponse> {
    // This is where we would use the MCP to process the response
    // For now, we'll just return the response as-is

    // In a real implementation, we would:
    // 1. Check for tool calls in the response
    // 2. Execute the tool calls using the actions manager
    // 3. Format the response with the tool call results

    return response;
  }

  /**
   * Processes an LLM response chunk for tool calls or other special handling
   * @param chunk The LLM response chunk to process
   * @returns The processed chunk
   */
  private async processLlmResponseChunk(
    chunk: LlmResponse
  ): Promise<LlmResponse> {
    // This is where we would use the MCP to process the response chunk
    // For now, we'll just return the chunk as-is

    // In a real implementation, we would:
    // 1. Check for partial tool calls in the chunk
    // 2. Accumulate tool call data
    // 3. Execute complete tool calls when ready

    return chunk;
  }
}
