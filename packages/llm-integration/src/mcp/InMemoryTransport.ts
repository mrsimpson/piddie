import type { Message, Transport } from "./McpHost";

/**
 * A custom MCP transport that works entirely in-memory
 */
export class InMemoryTransport implements Transport {
  private messageHandler?: (message: Message) => void;
  private errorHandler?: (error: Error) => void;
  private closeHandler?: () => void;

  // The server-side handler that will process messages
  private serverHandler?: (message: Message) => Promise<Message>;

  constructor() {}

  /**
   * Connect the transport to a server handler
   * @param handler The server handler function
   */
  connectToServer(handler: (message: Message) => Promise<Message>): void {
    this.serverHandler = handler;
  }

  /**
   * Client-side method to send a message to the server
   * @param message The message to send
   */
  send(message: Message): void {
    if (!this.serverHandler) {
      if (this.errorHandler) {
        this.errorHandler(new Error("Transport not connected to a server"));
      }
      return;
    }

    // Direct method call to the server handler
    this.serverHandler(message)
      .then((response) => {
        // Call the message handler with the response
        if (this.messageHandler) {
          this.messageHandler(response);
        }
      })
      .catch((error) => {
        // Handle any errors
        if (this.errorHandler) {
          this.errorHandler(
            error instanceof Error ? error : new Error(String(error))
          );
        }
      });
  }

  /**
   * Register a handler for incoming messages
   * @param handler The handler function
   */
  onMessage(handler: (message: Message) => void): void {
    this.messageHandler = handler;
  }

  /**
   * Set the message handler (for backward compatibility)
   */
  set onmessage(handler: (message: Message) => void) {
    this.messageHandler = handler;
  }

  /**
   * Set the error handler
   */
  set onerror(handler: (error: Error) => void) {
    this.errorHandler = handler;
  }

  /**
   * Set the close handler
   */
  set onclose(handler: () => void) {
    this.closeHandler = handler;
  }

  /**
   * Close the transport
   */
  close(): void {
    if (this.closeHandler) {
      this.closeHandler();
    }
  }
}
