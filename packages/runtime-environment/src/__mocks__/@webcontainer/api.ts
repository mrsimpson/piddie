/**
 * Mock implementation of the WebContainer API for testing
 */

// For simulating the Process
class MockProcess {
  private _exitCode: number;
  private _stdout: string;
  private _outputController: ReadableStreamDefaultController<string> | null =
    null;

  public output: ReadableStream<string>;

  constructor(exitCode: number, stdout: string) {
    this._exitCode = exitCode;
    this._stdout = stdout;

    this.output = new ReadableStream<string>({
      start: (controller) => {
        this._outputController = controller;
        if (this._stdout) {
          controller.enqueue(this._stdout);
        }
      }
    });
  }

  get exit(): Promise<number> {
    return Promise.resolve(this._exitCode);
  }
}

// Mock WebContainer class
export class WebContainer {
  private static instance: WebContainer | null = null;
  private _isBooted = false;
  private _commandResponses: Map<string, { exitCode: number; stdout: string }> =
    new Map();
  private _eventListeners: Map<string, Array<(...args: unknown[]) => void>> =
    new Map();

  // Singleton pattern for the mock
  public static async boot(): Promise<WebContainer> {
    if (!this.instance) {
      this.instance = new WebContainer();
    }

    this.instance._isBooted = true;
    return this.instance;
  }

  // For testing: reset the singleton
  public static reset(): void {
    this.instance = null;
  }

  // For testing: configure how commands should respond
  public static mockCommandResponse(
    command: string,
    exitCode: number,
    stdout: string
  ): void {
    if (!this.instance) {
      this.instance = new WebContainer();
    }

    this.instance._commandResponses.set(command, { exitCode, stdout });
  }

  // For testing: trigger server-ready event
  public static triggerServerReady(port: number, url: string): void {
    if (this.instance) {
      this.instance._triggerEvent("server-ready", port, url);
    }
  }

  public async spawn(
    command: string,
    args: string[] = []
  ): Promise<MockProcess> {
    const fullCommand = `${command} ${args.join(" ")}`.trim();
    const response = this._commandResponses.get(fullCommand) || {
      exitCode: 1,
      stdout: ""
    };

    return new MockProcess(response.exitCode, response.stdout);
  }

  public async mount(): Promise<void> {
    // Mock implementation does nothing
    return Promise.resolve();
  }

  public on(event: string, callback: (...args: unknown[]) => void): void {
    if (!this._eventListeners.has(event)) {
      this._eventListeners.set(event, []);
    }

    this._eventListeners.get(event)!.push(callback);
  }

  private _triggerEvent(event: string, ...args: unknown[]): void {
    const listeners = this._eventListeners.get(event) || [];
    for (const listener of listeners) {
      listener(...args);
    }
  }
}
