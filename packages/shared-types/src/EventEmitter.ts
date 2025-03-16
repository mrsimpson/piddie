/**
 * A simple EventEmitter implementation for browser environments
 */
export class EventEmitter {
  private events: Record<string, Array<(data: unknown) => void>> = {};

  /**
   * Register an event handler
   * @param event The event name
   * @param listener The event listener function
   * @returns This instance for chaining
   */
  on(event: string, listener: (data: unknown) => void): EventEmitter {
    if (!this.events[event]) {
      this.events[event] = [];
    }
    this.events[event].push(listener);
    return this;
  }

  /**
   * Emit an event with data
   * @param event The event name
   * @param data The data to pass to listeners
   */
  emit(event: string, data?: unknown): void {
    const listeners = this.events[event];
    if (listeners) {
      listeners.forEach((listener) => listener(data));
    }
  }

  /**
   * Remove an event listener
   * @param event The event name
   * @param listener The listener to remove
   * @returns This instance for chaining
   */
  off(event: string, listener: (data: unknown) => void): EventEmitter {
    const listeners = this.events[event];
    if (listeners) {
      this.events[event] = listeners.filter((l) => l !== listener);
    }
    return this;
  }

  /**
   * Register a one-time event handler
   * @param event The event name
   * @param listener The event listener function
   * @returns This instance for chaining
   */
  once(event: string, listener: (data: unknown) => void): EventEmitter {
    const onceWrapper = (data: unknown) => {
      listener(data);
      this.off(event, onceWrapper);
    };
    return this.on(event, onceWrapper);
  }

  /**
   * Remove all listeners for an event
   * @param event The event name
   * @returns This instance for chaining
   */
  removeAllListeners(event?: string): EventEmitter {
    if (event) {
      delete this.events[event];
    } else {
      this.events = {};
    }
    return this;
  }
}
