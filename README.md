# Piddie: Prompt-Driven Development Environment

## Introduction

Piddie is an AI-powered development environment designed to revolutionize the software development workflow. By leveraging large language models and intelligent system design, we aim to create a seamless, context-aware coding assistant that enhances developer productivity.

There are several great tools out there which are able to generate code from a prompt.

They either focus on ideation and scaffolding (e. g. bolt.new, lovable.app, v0) or continuous development (e. g. cursor.com, windsurf, VS Code with Github Co-Pilot).

However, these tools are provided as SaaS products. Their internals are closed source and often biased.

Piddie wants to build a tool which is open source, customizable and extensible, supporting both: ideation and continuous development.

## Compared to bolt.diy

[bolt.diy](https://bolt.diy) is the official fork of the bolt.new prototype codebase which has been initially published by Stackblitz under MIT license.
It's an awesome community project, enabling the bolt.new basic experience with own LLMs.

As a project that gained a lot of attention and PRs, devs naturally cared more about features than about re-architecting it.

To me as a contributor to bolt.diy, this lack of a coherent, documented architecture makes it tricky to properly integrate new features.

Thus, I started from scratch with the goal to provide a proof-of-architecture that might be the foundation for bolt.diy in a later iteration. The following ideas make it different to the current bolt.diy code base:

- Files first. An essential thought was that a tool like Bolt needs to be able to manage files living in multiple environments. Thus, I started with managing storage using browser APIs and sync it across persistences (browser, container, local disk).
- Clear separation of concerns for files and chat. In order to be able to go back and forth in history, we need to be able to git-like manage files and reference those snapshots (commits) from states of the chat.
- No Mega-Prompt and explicit tools. Bolt.diy relies heavily on the prompt being properly interpreted. Particularly many smaller (local) llm struggle with that. Thus, I started from scratch with a minimal prompt and using the `tools` for propagating this information via native APIs.
- Client-side only. I wanted the whole app to be living inside the browser. This made it necessry to externalize the LLM selection and proxying. I used litellm-proxy for that.
- Documentation ond prompt-driven-developability: I wanted to use this project as sample how to develop "serious" applications with the massive help of prompts. Therefore, I started "architecture and docs first" which allows Cursor, Windsurf, Cline et. al. to pick it up – and you to read it ;)

## Architecture Documentation

For a detailed architectural overview, please refer to our [arc42 Architecture Documentation](docs/arc42-architecture.md). This document provides an in-depth look at the system's design principles, component interactions, and architectural decisions.

## Project Components

### Development Environment

#### [Files Management Package](/packages/files-management/README.md)


Implements file system operations and synchronization between browser and local environments.
Provides a mechanism for typical version control (commits, branches, ...).

#### [Chat Management Package](/packages/chat-management/README.md)

Manages chat history and message flow, providing a clean interface for user-LLM communication. It persists the conversation in the Browser and refers to file-snapshots for time-travel-capabilities.

#### [Project Management Package](/packages/project-management/README.md)

Each project refers to a chat and a file system. This package handles project configuration, dependencies, and resource management.

### Core AI Components

#### [LLM Integration](/packages/llm-integration/README.md)

Interaction with the LLMs, providing necessary adapters.
At its core, an orchestrator with an MCP host coordinates context, prompts, and tools to enhance LLM interactions.

#### [Prompt Management](/packages/prompt-management/README.md)

Handles prompt enhancement and optimization to improve LLM interactions.

#### [Context Management](/packages/context-management/README.md)

Provides relevant context from files, workspace, and project state.

#### [Actions](/packages/actions/README.md)

Provides an MCP host to register internal and additional tools. Executes the tools and interprets the results.

### Apps

The repository comes with the following user interfaces

#### [Workbench](/apps/workbench/README.md)

The main IDE interface, integrating chat, files management and a webcontainer based runtime.

#### [Files Management Demo](/apps/demo-files-management/README.md)

I sophisticated UI demonstrating the capabilities of the file management system, synchronisation and gitignore-integration.

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
git clone https://github.com/mrsimpson/piddie.git

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
