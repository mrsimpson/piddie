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

### 1. [Chat Context Package](/packages/chat-context/README.md)

Manages conversational context and prompt generation, serving as the intelligent communication layer of the system.

### 2. [LLM Integration Package](/packages/llm-integration/README.md)

Provides a unified, extensible interface for interacting with multiple Large Language Model providers.

### 3. [File System Package](/packages/file-system/README.md)

Implements a robust file management system with comprehensive synchronization capabilities across browser and local file systems.

### 4. [Actions Package](/packages/actions/README.md)

Interprets and executes various types of actions derived from LLM responses, offering a flexible action management system.

### 5. [Error Resolution Package](/packages/error-resolution/README.md)

Provides intelligent error handling and resolution through structured context and LLM-assisted debugging.

### 6. [Workbench Package](/packages/workbench/README.md)

Manages the overall IDE workspace state, persisting user preferences and session information.

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
