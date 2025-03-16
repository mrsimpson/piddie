# LLM Integration Package

This package provides integration with various Large Language Model (LLM) providers for the Piddie application.

## Supported Providers

- **OpenAI**: Integration with OpenAI's API for models like GPT-3.5 and GPT-4
- **Ollama**: Integration with Ollama for running open-source models locally
- **Mock**: A mock client for testing and development

## Architecture

The package follows a client-adapter pattern:

- **Clients**: Implement the `LlmClient` interface to communicate with specific LLM providers
- **Orchestrator**: Manages multiple LLM providers and routes messages to the appropriate client
- **EventEmitter**: Provides event-based communication for streaming responses

## Usage

### Basic Usage

```typescript
import { createLlmAdapter } from "@piddie/llm-integration";

// Create an adapter with a default provider
const adapter = createLlmAdapter({
  name: "OpenAI",
  description: "OpenAI API",
  apiKey: "your-api-key",
  model: "gpt-3.5-turbo",
  provider: "openai"
});

// Send a message
const response = await adapter.processMessage({
  id: "message-id",
  chatId: "chat-id",
  content: "Hello, world!",
  role: "user",
  status: "sent",
  created: new Date(),
  provider: "openai"
});
```

### Streaming Responses

```typescript
import { createLlmAdapter } from "@piddie/llm-integration";

// Create an adapter
const adapter = createLlmAdapter({
  name: "Ollama",
  description: "Local Ollama instance",
  apiKey: "", // Not required for Ollama
  model: "llama2",
  baseUrl: "http://localhost:11434",
  provider: "ollama"
});

// Stream a message
const response = await adapter.processMessageStream(
  {
    id: "message-id",
    chatId: "chat-id",
    content: "Hello, world!",
    role: "user",
    status: "sent",
    created: new Date(),
    provider: "ollama"
  },
  (chunk) => {
    console.log("Received chunk:", chunk.content);
  }
);
```

### Multiple Providers

```typescript
import { Orchestrator } from "@piddie/llm-integration";
import { OpenAiClient } from "@piddie/llm-integration";
import { OllamaClient } from "@piddie/llm-integration";

// Create clients
const openaiClient = new OpenAiClient({
  name: "OpenAI",
  description: "OpenAI API",
  apiKey: "your-api-key",
  model: "gpt-3.5-turbo"
});

const ollamaClient = new OllamaClient({
  name: "Ollama",
  description: "Local Ollama instance",
  apiKey: "", // Not required for Ollama
  model: "llama2",
  baseUrl: "http://localhost:11434"
});

// Create orchestrator with default client
const orchestrator = new Orchestrator(openaiClient);

// Register additional providers
orchestrator.registerLlmProvider("ollama", {
  name: "Ollama",
  description: "Local Ollama instance",
  apiKey: "",
  model: "llama2",
  baseUrl: "http://localhost:11434",
  provider: "ollama",
  client: ollamaClient
});

// Use a specific provider
const response = await orchestrator.processMessage({
  id: "message-id",
  chatId: "chat-id",
  content: "Hello, world!",
  role: "user",
  status: "sent",
  created: new Date(),
  provider: "ollama" // This will route to the Ollama client
});
```

## Ollama Integration

The Ollama client allows you to use locally running LLMs through the Ollama API. To use it:

1. Install and run Ollama from [ollama.ai](https://ollama.ai)
2. Pull a model: `ollama pull llama2`
3. Configure the client with the model name and base URL

### Configuration Options

```typescript
const ollamaConfig = {
  name: "Ollama",
  description: "Local Ollama instance",
  apiKey: "", // Not required but kept for interface compatibility
  model: "llama2", // The model to use
  baseUrl: "http://localhost:11434", // Default Ollama API URL
  provider: "ollama"
};
```

### Available Models

The model name should match one of the models you've pulled in Ollama. Common models include:

- `llama2`
- `mistral`
- `vicuna`
- `orca-mini`
- `phi`

Check the Ollama documentation for the full list of available models.

## Development

### Adding a New Provider

To add a new LLM provider:

1. Create a new client class that implements the `LlmClient` interface
2. Update the `createLlmClient` function in `index.ts` to support the new provider
3. Export the new client from `index.ts`
4. Add tests for the new client

### Testing

Run tests with:

```bash
pnpm test
```
