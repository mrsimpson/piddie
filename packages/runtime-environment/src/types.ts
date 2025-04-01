import type { FileSystem } from "@piddie/shared-types";

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
   * Initialize the runtime environment provider
   */
  initialize(): Promise<void>;

  /**
   * Execute a command in the runtime environment
   */
  executeCommand(
    command: string,
    options?: CommandOptions
  ): Promise<CommandResult>;

  /**
   * Check if the runtime environment is ready
   */
  isReady(): boolean;

  /**
   * Get the file system associated with this runtime environment
   */
  getFileSystem(): FileSystem;

  /**
   * Dispose the runtime environment provider
   */
  dispose(): Promise<void>;
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

  /**
   * Get the file system associated with this runtime environment
   * @returns The file system instance
   */
  getFileSystem(): FileSystem;
}
