# LLM Integration Package

## Overview

Core orchestrator for LLM interactions, coordinating between different components to enhance LLM requests and managing interactions with the `litellm-proxy`. Focuses on LLM communication while delegating tool execution to the Actions package.

## Components and Responsibilities

### 1. Types (`types.ts`)

Defines core types for LLM integration:

- `LlmMessage`: Represents a message sent to the LLM.
- `LlmResponse`: Represents a response from the LLM.
- `LlmProviderConfig`: Configuration for the LLM provider.
- `LlmClient`: Interface for the LLM client.

### 2. LiteLLM LLM Client (`LiteLlmClient.ts`)

Implements the necessary interfaces to send messages and receive (streamed) responses:

- `LiteLlmClient`: Sends messages to the LiteLLM API and processes responses via the `litellm-proxy`.

### 3. Orchestrator (`Orchestrator.ts`)

The central component that:

- Enhances requests with context and tools using the ModelContextProtocol (MCP) SDK.
- Processes response streams.
- Delegates tool discovery and execution to the ActionsManager.

#### MCP Architecture

The MCP architecture follows these key principles:

1. **Separation of Concerns**: The Orchestrator focuses on LLM communication, while the ActionsManager handles tool registration and execution.

2. **Delegation Pattern**: The Orchestrator delegates all tool operations to the ActionsManager, avoiding direct MCP server interaction.

3. **Unified Tool Registry**: All available tools are registered and accessed through the ActionsManager, providing a single source of truth.

```mermaid
graph TD
    subgraph "Actions Package"
        AM[ActionsManager]
        MCH[McpHost]
        AM --> MCH
    end

    subgraph "LLM Integration"
        O[Orchestrator]
        LC[LLM Client]
    end

    subgraph "MCP Servers"
        FS[File Management MCP Server]
        RE[Runtime Environment MCP Server]
        OMS[Other MCP Servers...]
    end

    subgraph "External"
        LLM[LLM Provider]
    end

    O --> LC
    LC --> LLM
    O --> AM
    MCH --> FS
    MCH --> RE
    MCH --> OMS
```

#### MCP Host-Client-Server Interaction Flow

The interaction between components follows this pattern:

1. **Initialization Phase**:
   - The ActionsManager initializes the McpHost and registers all MCP servers
   - The Orchestrator references the ActionsManager for tool discovery and execution

2. **Request Phase**:
   - User sends a message that might require tool execution
   - Orchestrator requests available tools from the ActionsManager
   - Orchestrator enhances the message with tool definitions
   - Enhanced message is sent to the LLM

3. **Response and Tool Execution Phase**:
   - LLM generates a response that includes tool calls
   - Orchestrator detects tool calls in the response
   - Orchestrator forwards tool execution requests to the ActionsManager
   - ActionsManager routes each request to the appropriate MCP server via McpHost
   - Results of the operations are returned to the Orchestrator

4. **Result Integration Phase**:
   - Orchestrator formats a response that includes both the LLM's text and the operation results
   - Final response is returned to the user

#### MCP Tool Interaction Pattern

```mermaid
sequenceDiagram
    participant User
    participant ChatUI as Chat UI
    participant LlmStore as LLM Store
    participant Orchestrator
    participant ActionsManager
    participant McpHost
    participant LLM
    participant MCPServer as MCP Server
    participant ChatStore as Chat Store

    User->>ChatUI: Send message requiring tool use
    Note over ChatUI,LlmStore: Same initial flow as chat messages

    LlmStore->>Orchestrator: processMessageStream

    Note right of Orchestrator: Tool Discovery
    Orchestrator->>ActionsManager: getAvailableTools()
    ActionsManager->>McpHost: listTools()
    McpHost->>McpHost: Collect tools from registered servers
    McpHost-->>ActionsManager: Return available tools
    ActionsManager-->>Orchestrator: Return available tools
    
    Orchestrator->>Orchestrator: Enhance message with tool definitions
    Orchestrator->>Orchestrator: Add system prompt with tool usage instructions
    Orchestrator->>LLM: Send enhanced request with tool definitions

    LLM-->>Orchestrator: Response with tool call

    Note right of Orchestrator: Tool Execution Phase
    Orchestrator->>Orchestrator: Parse tool call from response
    Orchestrator->>ActionsManager: executeToolCall(toolName, arguments)
    ActionsManager->>McpHost: executeToolCall(toolName, arguments)
    McpHost->>MCPServer: Execute tool call with arguments
    MCPServer-->>McpHost: Return tool execution result
    McpHost-->>ActionsManager: Return tool execution result
    ActionsManager-->>Orchestrator: Return tool execution result

    Orchestrator-->>LlmStore: Emit chunk with tool call
    LlmStore->>ChatStore: updateMessageToolCalls
    ChatStore-->>ChatUI: Display tool call in UI

    Note right of Orchestrator: Result Integration Phase
    Orchestrator-->>LlmStore: Continue with response text
    LlmStore->>ChatStore: updateMessageContent
    ChatStore-->>ChatUI: Update message content

    Note over LlmStore,ChatStore: Final persistence same as chat messages

    ChatUI-->>User: Display complete response with tool calls
```

#### System Prompt and Tool Definition

The Orchestrator injects a system prompt that instructs the LLM about available tools. This prompt:

1. Defines the available operations (file management, code execution, etc.)
2. Provides usage guidelines and examples
3. Sets expectations for when and how to use these tools

The system prompt is combined with formal tool definitions that specify:

- Tool names and descriptions
- Required and optional parameters
- Expected return values

#### MCP Integration for File Management

The architecture delegates file management operations to the ActionsManager, which manages the File Management MCP Server:

```mermaid
graph TD
    subgraph "Workbench"
        UI[User Interface]
        FS[FileSystem Store]
    end

    subgraph "Actions"
        AM[ActionsManager]
        MCH[McpHost]
    end

    subgraph "LLM Integration"
        O[Orchestrator]
        LC[LLM Client]
    end

    subgraph "File System"
        BFS[Browser File System]
        FMCP[File Management MCP Server]
    end

    subgraph "External"
        LLM[LLM Provider]
    end

    UI --> FS
    FS --> BFS
    FS --> FMCP
    FMCP --> MCH
    MCH --> AM
    AM --> O
    O --> LC
    LC --> LLM
```

#### Dynamic Interaction for Chat Messages

In the chat interaction flow, the Orchestrator delegates tool execution to the ActionsManager:

```mermaid
sequenceDiagram
    participant User
    participant ChatUI as Chat UI
    participant LlmStore as LLM Store
    participant ChatStore as Chat Store
    participant Orchestrator
    participant ActionsManager
    participant LLM
    participant DB as Database

    User->>ChatUI: Send message
    ChatUI->>LlmStore: sendMessage(content, chatId)

    LlmStore->>ChatStore: addMessage (user message)
    ChatStore->>DB: Create user message
    DB-->>ChatStore: Return user message
    ChatStore-->>LlmStore: Return user message

    LlmStore->>ChatStore: addMessage (assistant placeholder, isEphemeral=true)
    ChatStore->>ChatStore: Store temporary message in memory
    ChatStore-->>LlmStore: Return temporary assistant message

    LlmStore->>Orchestrator: processMessageStream/processMessage
    Orchestrator->>ActionsManager: getAvailableTools()
    ActionsManager-->>Orchestrator: Return available tools
    Orchestrator->>Orchestrator: enhanceMessageWithHistoryAndTools
    Orchestrator->>LLM: Send enhanced request

    alt Streaming Response
        LLM-->>Orchestrator: Stream response chunks
        loop For each chunk with tool calls
            Orchestrator->>ActionsManager: executeToolCall(name, args)
            ActionsManager-->>Orchestrator: Return tool result
            Orchestrator-->>LlmStore: Emit chunk event with result
            LlmStore->>ChatStore: updateMessageContent/updateMessageToolCalls
            ChatStore->>ChatStore: Update temporary message in memory
            ChatStore-->>ChatUI: Reactive UI update
        end
    else Non-Streaming Response
        LLM-->>Orchestrator: Complete response with tool calls
        Orchestrator->>ActionsManager: executeToolCall(name, args)
        ActionsManager-->>Orchestrator: Return tool results
        Orchestrator-->>LlmStore: Return enhanced response
        LlmStore->>ChatStore: updateMessageContent/updateMessageToolCalls
        ChatStore->>ChatStore: Update temporary message in memory
        ChatStore-->>ChatUI: Reactive UI update
    end

    LlmStore->>ChatStore: persistEphemeralMessage
    ChatStore->>DB: Create permanent message
    ChatStore->>DB: Update with tool calls if present
    ChatStore->>ChatStore: Replace temporary message with permanent one
    ChatStore-->>ChatUI: Reactive UI update with permanent message

    ChatUI-->>User: Display complete response
```

#### File System Operations via MCP

File operations are routed through the ActionsManager, which delegates to the appropriate MCP server:

```mermaid
sequenceDiagram
    participant User
    participant ChatUI as Chat UI
    participant Orchestrator
    participant ActionsManager
    participant LLM
    participant McpHost
    participant FMMCP as Files Management MCP Server
    participant FM as Files Management
    participant BFS as Browser File System

    User->>ChatUI: Request file operation (read/write/list)
    ChatUI->>Orchestrator: Forward request (via LLM Store)

    Orchestrator->>ActionsManager: getAvailableTools()
    ActionsManager-->>Orchestrator: Return available tools (including file operations)
    Orchestrator->>Orchestrator: Enhance with file operation tools
    Orchestrator->>LLM: Send enhanced request

    LLM-->>Orchestrator: Response with file operation tool call

    Orchestrator->>ActionsManager: executeToolCall(name, args)
    ActionsManager->>McpHost: executeToolCall(name, args)
    McpHost->>FMMCP: Execute file operation tool call
    FMMCP->>FM: Delegate to Files Management component
    FM->>BFS: Perform actual file system operation
    BFS-->>FM: Return operation result
    FM-->>FMMCP: Return formatted result
    FMMCP-->>McpHost: Return tool execution result
    McpHost-->>ActionsManager: Return formatted result
    ActionsManager-->>Orchestrator: Return tool execution result

    Orchestrator-->>ChatUI: Return response with tool call and result
    ChatUI-->>User: Display file operation result
```

### 4. Main Entry Point (`index.ts`)

Exports the public API:

- `createLlmAdapter`: Function to create an LLM adapter using the provided configuration.
- Types and interfaces.

## System Diagram

```mermaid
graph TD
    subgraph Orchestration Layer
        O[Orchestrator] --> PM[Prompt Manager]
        O --> CM[Context Manager]
        O --> AM[Actions Manager]
        O --> CH[Chat Manager]
    end

    subgraph Provider Layer
        O --> P[litellm-proxy]
    end
```

## Core Responsibilities

### LLM Communication

- Handle interactions with the LLM provider:
  - Send enhanced requests
  - Process responses and streams
  - Parse tool calls from responses
  - Format tool results for display

### Request Enhancement

- Assemble enhanced requests using:
  - Chat history from Chat Manager
  - Enhanced prompts from Prompt Manager
  - Relevant context from Context Manager
  - Available tools from ActionsManager

### Tool Integration

- Discover available tools from ActionsManager
- Forward tool execution requests to ActionsManager
- Process tool execution results
- Integrate tool results into LLM responses

## External Relationships

- Uses ActionsManager for tool discovery and execution
- Manages LLM provider connections via the `litellm-proxy`
- Coordinates request enhancement flow

## Performance Considerations

- Efficient request assembly
- Smart provider selection
- Optimized context handling

## Future Enhancements

- Advanced request optimization
- Cross-provider load balancing
