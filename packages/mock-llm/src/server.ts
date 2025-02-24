import express from "express";
import type { Request, Response } from "express";

const app = express();
app.use(express.json());

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
}

interface ChatCompletionResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: ChatMessage;
    finish_reason: string;
  }>;
}

app.post("/v1/chat/completions", (req: Request, res: Response): void => {
  const body = req.body as ChatCompletionRequest;

  if (!body?.messages?.length) {
    res.status(400).json({ error: "No messages provided" });
    return;
  }

  const lastMessage = body.messages[body.messages.length - 1];
  if (!lastMessage?.content) {
    res.status(400).json({ error: "Invalid message format" });
    return;
  }

  // Create response excluding history
  const response: ChatCompletionResponse = {
    id: `mock-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: body.model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: `got your message. Context: ${JSON.stringify({
            model: body.model,
            lastMessage: lastMessage.content
          })}`
        },
        finish_reason: "stop"
      }
    ]
  };

  res.json(response);
});

const port = process.env["PORT"] || 9100;
app.listen(port, () => {
  console.log(`Mock LLM server running on port ${port}`);
});
