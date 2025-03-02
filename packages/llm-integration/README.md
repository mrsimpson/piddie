# LLM Integration Package

## Overview

Core orchestrator for LLM interactions, coordinating between different components to enhance LLM requests and managing interactions with the `litellm-proxy`.

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
- Implements MCP host functionality.

#### System Prompt and Tool Definition

The Orchestrator injects a system prompt that instructs the LLM about available file management tools. This prompt:

1. Defines the available file operations (read, write, list, delete, create)
2. Provides usage guidelines and examples
3. Sets expectations for when and how to use these tools

The system prompt is combined with formal tool definitions that specify:

- Tool names and descriptions
- Required and optional parameters
- Expected return values

#### MCP Integration for File Management

The Orchestrator serves as an MCP host that connects the LLM with file management capabilities. This integration enables the LLM to read, write, and manipulate files in the browser's file system.

```mermaid
graph TD
    subgraph "Workbench"
        UI[User Interface]
        FS[FileSystem Store]
    end

    subgraph "LLM Integration"
        O[Orchestrator]
        LC[LLM Client]
    end

    subgraph "File System"
        BFS[Browser File System]
    end

    subgraph "External"
        LLM[LLM Provider]
    end

    UI --> FS
    FS --> BFS
    FS --> O
    O --> LC
    LC --> LLM
    O --> BFS
```

#### Dynamic Interaction for File Writing

```mermaid
sequenceDiagram
    participant User
    participant Workbench
    participant Orchestrator as Orchestrator (MCP Host)
    participant LLM
    participant BFS as Browser File System

    User->>Workbench: Request to write code
    Workbench->>Orchestrator: Forward request

    Orchestrator->>Orchestrator: Enhance with system prompt & tools
    Orchestrator->>LLM: Send enhanced request

    LLM->>Orchestrator: Response with write_file tool call

    Orchestrator->>BFS: Execute write_file operation
    BFS->>Orchestrator: Operation result

    Orchestrator->>Orchestrator: Format response with results
    Orchestrator->>Workbench: Return enhanced response
    Workbench->>User: Display response
```

#### MCP Host-Client-Server Interaction Flow

For file operations (e.g., writing files), the interaction follows this sequence:

1. **Initialization Phase**:

   - The Orchestrator (MCP Host) receives the BrowserFileSystem instance from the workbench
   - Tool definitions are registered with the LLM client
   - System prompt is configured to instruct the LLM about available tools

2. **Request Phase**:

   - User sends a message requesting a file operation
   - Orchestrator enhances the message with context and tool definitions
   - Enhanced message is sent to the LLM

3. **Response and Tool Execution Phase**:

   - LLM generates a response that includes a tool call (e.g., write_file)
   - Orchestrator detects the tool call in the response
   - Orchestrator executes the file operation using the BrowserFileSystem
   - Results of the operation are captured

4. **Result Integration Phase**:
   - Orchestrator formats a new response that includes both the LLM's text and the operation results
   - Final response is returned to the user

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

### MCP Host Implementation

- Coordinate with MCP servers:
  - Chat Manager for message history
  - Prompt Manager for enhancement
  - Context Manager for relevant context
  - Actions Manager for available tools

### Request Enhancement

- Assemble enhanced requests using:
  - Chat history
  - Enhanced prompts
  - Relevant context
  - Available tools

### LLM interaction

- Handle interactions with the `litellm-proxy`
- Manage API connections
- Handle rate limiting
- Format provider-specific requests

## External Relationships

- Acts as MCP Host for other components
- Manages LLM provider connections via the `litellm-proxy`
- Coordinates request enhancement flow

## Performance Considerations

- Efficient request assembly
- Smart provider selection
- Optimized context handling

## Future Enhancements

- Advanced request optimization
- Cross-provider load balancing
