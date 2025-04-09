# Piddie: Prompt-Driven Development Environment

## Introduction

Piddie is an AI-powered development environment designed to revolutionize the software development workflow. By leveraging large language models and intelligent system design, we aim to create a seamless, context-aware coding assistant that enhances developer productivity.

There are several great tools out there which are able to generate code from a prompt.

They either focus on ideation and scaffolding (e. g. bolt.new, lovable.app, v0) or continuous development (e. g. cursor.com, windsurf, VS Code with Github Co-Pilot).

However, these tools are provided as SaaS products. Their internals are closed source and often biased.

Piddie wants to build a tool which is open source, customizable and extensible, supporting both: ideation and continuous development.

## Architecture Documentation

For a detailed architectural overview, please refer to our [arc42 Architecture Documentation](docs/arc42-architecture.md). This document provides an in-depth look at the system's design principles, component interactions, and architectural decisions.

## Project Components

### Core AI Components

#### 1. [LLM Integration Package](/packages/llm-integration/README.md)

Core orchestrator (MCP Host) that coordinates context, prompts, and tools to enhance LLM interactions. Provides unified interface for multiple LLM providers.

#### 2. [Chat Management Package](/packages/chat-management/README.md)

Manages chat history and message flow, providing a clean interface for user-LLM communication.

#### 3. [Prompt Management Package](/packages/prompt-management/README.md)

MCP server that handles prompt enhancement and optimization to improve LLM interactions.

#### 4. [Context Management Package](/packages/context-management/README.md)

MCP server that provides relevant context from files, workspace, and project state.

#### 5. [Actions Package](/packages/actions/README.md)

MCP server that implements tool interfaces that LLMs can use to interact with the system.

### Development Environment

#### 6. [Files Management Package](/packages/files-management/README.md)

Implements file system operations and synchronization between browser and local environments.

#### 7. [Workbench Package](/apps/workbench/README.md)

Manages the IDE interface and user workspace state.

#### 8. [Project Management Package](/packages/project-management/README.md)

Handles project configuration, dependencies, and resource management.

## Project Setup and Monorepo Design Decisions

### Monorepo Tooling Selection

#### Chosen Solution: Turborepo with pnpm

- **Performance**: Optimized build and dependency management
- **Flexibility**: Lightweight and minimally invasive
- **Scalability**: Supports future expansion of project components

#### Key Design Principles

1. **Modular Architecture**

   - Clear separation of concerns
   - Independent package development
   - Easy maintenance and testing

2. **Dependency Management**

   - Centralized dependency control
   - Simplified version synchronization
   - Shared configuration across packages

3. **Build Optimization**
   - Intelligent caching
   - Parallel task execution
   - Minimal rebuild overhead

### Package Structure Rationale

- **Packages Directory**:

  - Hosts shared libraries and core modules
  - Enables code reuse across applications
  - Provides clear architectural boundaries

- **Independent Package Responsibilities**
  - Each package has a single, well-defined purpose
  - Minimal interdependencies
  - Easy to understand and modify

### Technology Agnostic Approach

- Avoid premature framework commitment
- Flexible structure for future technology decisions
- Focus on core system design and interactions

## Prerequisites

- Node.js (v18+)
- pnpm

## Getting Started

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/prompt-dev.git

# Install dependencies
pnpm install

# Run development mode
pnpm dev
```

## Development Scripts

- `pnpm build`: Build all packages
- `pnpm dev`: Start development servers
- `pnpm test`: Run all tests
- `pnpm lint`: Run linters
- `pnpm format`: Format code

## Technologies

- Turborepo
- pnpm
- TypeScript

## License

MIT License

## Contributing

We welcome contributions! Please see our contributing guidelines for more details.
