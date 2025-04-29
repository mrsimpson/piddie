# Actions Server

## Overview

The Actions Server enables MCP clients (LLM agents) to execute tools that run in browser-based workbenches. It provides a WebSocket-based proxy system that routes tool execution requests from MCP clients to the appropriate workbench instance while maintaining security and isolation.

## Core Components

### 1. Actions Server

- Provides WebSocket endpoint for workbench connections
- Manages workbench registrations and tool mappings
- Routes tool execution requests from MCP clients to workbenches
- Exposes registered tools to MCP clients
- Supports dynamic tool registration via HTTP endpoints

### 2. ActionsProxyClient (Workbench)

- Client-side component that connects to Actions Server
- Generates and manages client secrets
- Handles WebSocket communication
- Validates and executes tool requests
- Manages tool registration and dynamic tool updates

### 3. ActionsManager (Workbench)

- Singleton manager for all actions and MCP servers
- Central entry point for tool discovery and execution
- Manages MCP server registrations
- Executes tools within the workbench sandbox
- Propagates tool registrations to the Actions Server

## System Flow

### 1. Initial Workbench Registration

```mermaid
sequenceDiagram
    participant Workbench as ActionsProxyClient
    participant Server as ActionsServer
    participant Manager as ActionsManager

    Note over Workbench: Workbench starts
    Workbench->>Manager: Get available tools
    Manager-->>Workbench: Return tool definitions
    Workbench->>Workbench: Generate clientSecret
    Workbench->>Server: POST /register-tools
    Note over Workbench: Send tool definitions
    Server->>Server: Store tool-workbench mapping
    Server->>Workbench: Return clientId
    Workbench->>Server: Connect WebSocket
    Server->>Server: Store WebSocket connection
    Workbench->>Workbench: Register ActionsManager as tool execution callback
```

### 2. Dynamic Tool Registration

```mermaid
sequenceDiagram
    participant WB as Workbench
    participant Manager as ActionsManager
    participant Client as ActionsProxyClient
    participant Server as ActionsServer

    Note over WB: New client side tool registered
    WB->>Manager: registerServer(mcpServer)
    Manager->>Manager: Store server reference
    Manager->>Manager: Invalidate tools cache
    Manager->>Manager: Get updated tools list
    Manager->>Client: addTools(clientId, updatedTools)
    Client->>Server: POST /add-tools?clientId=...
    Server->>Server: Register new tools
    Server->>Server: Update MCP tool definitions
    Note over Server: Tools now available to MCP clients
```

### 3. MCP Client Tool Execution

```mermaid
sequenceDiagram
    participant MCP as MCP Client
    participant Server as ActionsServer
    participant Workbench as ActionsProxyClient
    participant Manager as ActionsManager

    MCP->>Server: Connect via MCP
    Server->>MCP: Expose available tools

    MCP->>Server: Execute tool with clientId & clientSecret
    Server->>Workbench: Forward via WebSocket
    Workbench->>Workbench: Validate clientSecret
    Workbench->>Manager: Forward to tool handler
    Manager->>Manager: Execute in workbench sandbox
    Manager->>Workbench: Return result
    Workbench->>Server: Forward via WebSocket
    Server->>MCP: Return result
```

## Security Implementation

### Workbench Authentication

- Each workbench generates a unique clientSecret using UUID
- ClientSecret is validated by the workbench on every tool execution request
- WebSocket connections require valid clientId
- Tool requests include both clientId and clientSecret

### Message Protocol

#### Tool Request (MCP to Server)

```typescript
interface ToolRequestMessage {
  type: "TOOL_REQUEST";
  payload: {
    toolName: string;
    parameters: {
      clientId: string;
      clientSecret: string;
      [key: string]: unknown;
    };
    requestId: string;
  };
}
```

#### Tool Response (Server to MCP)

```typescript
interface ToolResponseMessage {
  type: "TOOL_RESPONSE";
  payload: {
    requestId: string;
    result: CallToolResult;
    error?: string;
  };
}
```

## Implementation Example

### 1. Server Setup

```typescript
const server = new ActionsServer({
  port: 3000,
  mcpOptions: {
    // MCP server configuration
  }
});

await server.start();
```

### 2. Workbench Integration

```typescript
// Initialize ActionsManager
const actionsManager = ActionsManager.getInstance();
await actionsManager.initialize();

// Create and configure ActionsProxyClient
const client = new ActionsProxyClient(
  "http://localhost:3000",
  "ws://localhost:3000",
  async (toolName: string, params: Record<string, unknown>) => {
    // Handle tool execution in workbench sandbox
    return { success: true };
  }
);

// Register initial tools and connect
const initialTools = await actionsManager.getAvailableTools();
const clientId = await client.registerTools(initialTools);
await client.connectWebSocket(clientId);

// Set up ActionsManager with the client
actionsManager.setActionsProxyClient(client);

// Later, when new MCP servers are registered
const newServer = new CustomMcpServer();
await actionsManager.registerServer(newServer, "custom-server");
// Tools are automatically propagated to Actions Server
```

### 3. MCP Client Usage

```typescript
// Connect to Actions Server via MCP
const mcpClient = new McpClient({
  // MCP configuration
});

// Get available tools (including dynamically added ones)
const tools = await mcpClient.listTools();

// Execute a tool
const result = await mcpClient.executeTool("writeFile", {
  clientId: "workbench-id",
  clientSecret: "workbench-secret",
  path: "/example.txt",
  content: "Hello World"
});
```

## Error Handling

- Invalid client credentials result in immediate rejection
- WebSocket connection failures trigger reconnection attempts
- Tool execution errors are properly propagated
- Connection status is monitored and reported

## Security Considerations

- Client secrets are generated and validated by the workbench
- WebSocket connections require valid client IDs
- Tool execution is sandboxed within the workbench
- All messages are validated before processing

## Summary of Improvements

The Actions Server system has been enhanced with dynamic tool registration capabilities:

1. **Initial Empty Registration**

   - Workbench can register with an initially empty tool set
   - ActionsManager tracks the clientId for future updates

2. **Dynamic Tool Updates**

   - New MCP servers automatically propagate tools to Actions Server
   - Existing WebSocket connections remain active during updates
   - MCP clients instantly see new tools without reconnection

3. **Technical Implementation**

   - New `/add-tools` HTTP endpoint on Actions Server
   - `addTools` method in ActionsProxyClient
   - Enhanced `registerServer` in ActionsManager
   - Tool cache invalidation for consistent state

4. **Benefits**
   - Smoother workbench startup (no need to wait for all tools)
   - Reduced race conditions during initialization
   - Better support for dynamically loaded plugins
   - Improved user experience with real-time tool updates
   - Simplified integration with external tool providers
