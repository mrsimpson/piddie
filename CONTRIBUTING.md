# Contributing to Piddie

Welcome to Piddie! We're excited that you want to contribute to our open-source AI-powered development environment. This guide will help you get started.

## Quick Start

```bash
# Install dependencies
pnpm i

# Start the documentation server
pnpm docs:dev  # Available at localhost:9000

# Start development of all packages
pnpm dev       # Builds and watches all packages in the monorepo
```

## Project Structure

Piddie is organized as a monorepo using pnpm workspaces. Key packages include:

- `apps/files-management-ui`: File management interface (dev server: localhost:9001)
- `apps/workbench`: Development workspace (dev server: localhost:9999)
- Additional packages for AI integration, context management, and more

## Development Setup

### Prerequisites

- Node.js >= 22
- pnpm >= 9.0.0

### Getting Started

1. Clone the repository
2. Install dependencies: `pnpm i`
3. Start development:
   - For all packages: `pnpm dev`
   - For documentation: `pnpm docs:dev`
   - For specific package: Navigate to package directory and run `ppm dev`

### Available Scripts

- `pnpm dev`: Start development mode for all packages
- `pnpm test` or `ppm t`: Run tests
- `pnpm docs:dev`: Start documentation server
- `pnpm build`: Build all packages
- `pnpm lint-format`: Check code style
- `pnpm lint-format:fix`: Fix code style issues

## Architecture

Piddie follows a modular architecture with clear separation of responsibilities. Key components:

1. **Core AI Components**

   - LLM Integration
   - Chat Management
   - Prompt Management
   - Context Management
   - Actions

2. **Development Environment**
   - Files Management
   - Workbench

For detailed architecture documentation, see `docs/arc42-architecture.md`.

## Testing

We follow a test-driven development approach:

- Write tests for all public interfaces
- Use BDD style (Given/When/Then) for module tests
- Run tests with `pnpm test`

## Code Style

- TypeScript with strong typing
- Vue 3 with Composition API for UI components
- Shoelace web components for UI elements
- Conventional commit messages
- Prettier for code formatting
- ESLint for code quality

## LLM Integration

We use litellm in a Docker container to integrate with various LLM providers. This allows for flexible provider selection and configuration.

## Getting Help

- Check the documentation at `localhost:9000` (after running `pnpm docs:dev`)
- Review package-specific README files
- Open an issue for bugs or feature requests

## License

Piddie is open source under the MIT license. By contributing, you agree to license your contributions under the same terms.
