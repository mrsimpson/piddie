/**
 * Base interface for all MCP capabilities
 */
export interface MCPCapability {
  /** Unique identifier for this capability */
  id: string;
  /** Human readable name */
  name: string;
  /** Description of what this capability does */
  description: string;
}

/**
 * Represents an MCP server that provides capabilities
 */
export interface MCPServer {
  /** Unique identifier for this server */
  id: string;
  /** The capabilities this server provides */
  capabilities: MCPCapability[];
  /** Connect to the server */
  connect(): Promise<void>;
  /** Disconnect from the server */
  disconnect(): Promise<void>;
}

/**
 * Base interface for MCP requests
 */
export interface MCPRequest {
  /** ID of the capability being requested */
  capabilityId: string;
  /** Request parameters */
  params: Record<string, unknown>;
}

/**
 * Base interface for MCP responses
 */
export interface MCPResponse {
  /** The data returned */
  data: unknown;
  /** Any metadata about the response */
  metadata?: Record<string, unknown>;
}
