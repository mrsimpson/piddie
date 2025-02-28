# LLM Integration Implementation Plan

## Overview

This document outlines the implementation plan for the LLM Integration package, which serves as the core orchestrator for LLM interactions in the web-based code editor.

## Core Components

### 1. Types (`types.ts`)

We'll be using the OpenAI llm interaction definition all along (from the `openai` npm package).
Lateron, we might use other LLMs, but the LiteLLM proxy will adapt them to the OpenAI format.
Therefore, we don't need any adapters for particular LLM providers.

Define the core types for LLM integration:

- Message interfaces for LLM interactions. We shall consume the chat management types and internally map them
- Content block interfaces (text, image, tool use)
- Request and response interfaces
- Provider configuration interfaces
- Stream handling interfaces

### 2. OpenAI LLM client

Implement the necessary interfaces to send messages and receive (streamed) responses.

### 3. Orchestrator (`orchestrator.ts`)

The central component that:

- Enhances requests with context and tools
- Processes response streams
- Implements MCP host functionality

#### MCP Host Implementation Details

The Orchestrator will implement MCP host functionality by:

- Registering tool definitions with the LLM client
- Processing tool calls in LLM responses
- Executing tool calls using the appropriate components
- Formatting responses with tool call results

#### Tool Definition and Execution

The Orchestrator will define tools for common operations:

1. File Management Tools:
   - read_file: Read the contents of a file
   - write_file: Write content to a file
   - list_files: List files in a directory
   - delete_item: Delete a file or directory
   - create_directory: Create a new directory

2. Tool Execution Process:
   - Parse tool calls from LLM responses
   - Validate tool parameters
   - Execute the appropriate operation
   - Capture operation results
   - Format results for inclusion in the response

#### System Prompt Integration

The Orchestrator will construct system prompts that:

1. Inform the LLM about available tools
2. Provide guidelines on when and how to use these tools
3. Set expectations for the LLM's behavior

For file management, the system prompt will:
- List available file operations
- Provide examples of how to use file operations
- Instruct the LLM to use file operations when appropriate

### 4. Main Entry Point (`index.ts`)

Exports the public API:

- `createLlmAdapter` function
- Types and interfaces

## Integration with Other Components

### Context Management

The LLM Integration package will interact with the Context Management package through MCP:

- Request context for enhancing LLM requests
- Pass context to LLM providers

### Actions Management

The LLM Integration package will interact with the Actions Management package through MCP:

- Request available tools
- Pass tool definitions to LLM providers
- Forward tool use requests to the Actions Manager

### File Management Integration

The LLM Integration package will interact with the Files Management package:

- Receive the BrowserFileSystem instance from the workbench
- Implement file operation tools (read, write, list, delete, create)
- Execute file operations on behalf of the LLM
- Handle file operation errors

## Implementation Phases

### Phase 1: Core Types and Basic Client

1. Define all necessary types in `types.ts`
2. Implement the basic LLM client for OpenAI

### Phase 2: Orchestrator Implementation

1. Implement the basic Orchestrator
2. Add chat history integration
3. Implement streaming support

### Phase 3: MCP Host Implementation

1. Implement MCP host functionality
2. Define tool interfaces
3. Implement tool execution

### Phase 4: File Management Integration

1. Add BrowserFileSystem integration
2. Implement file operation tools
3. Add system prompt for file operations
4. Test file operations with the LLM
