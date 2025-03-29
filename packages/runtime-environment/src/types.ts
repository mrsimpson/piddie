/**
 * Represents the result of a command execution
 */
export interface CommandResult {
  /** Exit code of the command (0 typically means success) */
  exitCode: number;
  /** Standard output from the command */
  stdout: string;
  /** Standard error output from the command */
  stderr: string;
  /** Whether the command completed successfully */
  success: boolean;
}

/**
 * Options for command execution
 */
export interface CommandOptions {
  /** Working directory for the command */
  cwd?: string;
  /** Environment variables to set for the command */
  env?: Record<string, string>;
  /** Maximum execution time in milliseconds before timeout */
  timeout?: number;
}

/**
 * Base interface for any runtime environment provider
 */
export interface RuntimeEnvironmentProvider {
  /**
   * Executes a command in the runtime environment
   * @param command The command to execute
   * @param options Command execution options
   * @returns Promise resolving to the command result
   */
  executeCommand(
    command: string,
    options?: CommandOptions
  ): Promise<CommandResult>;

  /**
   * Initializes the runtime environment
   * @returns Promise that resolves when environment is ready
   */
  initialize(): Promise<void>;

  /**
   * Checks if the runtime environment is ready
   * @returns True if ready, false otherwise
   */
  isReady(): boolean;
}

/**
 * Command execution request interface for the RuntimeEnvironment
 */
export interface ExecuteCommandRequest {
  /** The command to execute */
  command: string;
  /** Options for command execution */
  options?: CommandOptions;
}

/**
 * Core interface for runtime environment operations
 */
export interface RuntimeEnvironment {
  /**
   * Executes a command in the runtime environment
   * @param request The command execution request
   * @returns Promise resolving to the command result
   */
  executeCommand(request: ExecuteCommandRequest): Promise<CommandResult>;
}
