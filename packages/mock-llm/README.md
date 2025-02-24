# Mock LLM

A simple mock implementation of the OpenAI API for testing purposes.

## Features

- Implements OpenAI chat completions endpoint
- Returns simple responses with received context
- Excludes chat history from response

## Development

1. Install dependencies:

```bash
pnpm install
```

2. Start development server:

```bash
pnpm dev
```

This will:

- Watch TypeScript files and recompile on changes
- Restart server when compiled files change
- Start server on port 3000 (or PORT from env)

## Usage

Make requests to the running server:

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4",
    "messages": [
      {"role": "user", "content": "Hello"}
    ]
  }'
```

## Response Format

The server returns responses in OpenAI format:

```json
{
  "id": "mock-1234567890",
  "object": "chat.completion",
  "created": 1234567890,
  "model": "gpt-4",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "got your message. Context: {...}"
      },
      "finish_reason": "stop"
    }
  ]
}
```
