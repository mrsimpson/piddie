import { describe, it, expect, vi, beforeEach, afterEach, Mock } from "vitest";
import { Orchestrator } from "../src/Orchestrator";
import { AgentManager } from "../src/AgentManager";
import { EventEmitter } from "@piddie/shared-types";
import type { ChatManager, Message, ChatCompletionRole, ToolCall } from "@piddie/chat-management";
import { MessageStatus } from "@piddie/chat-management";
import type { LlmMessage, LlmProviderConfig } from "../src/types";
import { ActionsManager } from "@piddie/actions";

// Mock the AgentManager
vi.mock("../src/AgentManager", () => ({
    AgentManager: vi.fn().mockImplementation(() => ({
        configureAgent: vi.fn(),
        resetAgent: vi.fn(),
        isAgentEnabled: vi.fn().mockReturnValue(false),
        getAgentContext: vi.fn(),
        react: vi.fn().mockResolvedValue({ type: 'complete' })
    }))
}));

// Mock ChatManager for testing
const createMockChatManager = (): ChatManager => ({
    createChat: vi.fn().mockResolvedValue({ id: "chat-1", messages: [] }),
    addMessage: vi.fn().mockImplementation(
        (
            chatId: string,
            content: string,
            role: ChatCompletionRole,
            username: string,
            parentId?: string
        ) => {
            return Promise.resolve({
                id: `msg-${Date.now()}`,
                chatId,
                content,
                role,
                status: MessageStatus.SENT,
                created: new Date(),
                username,
                parentId
            });
        }
    ),
    getChat: vi.fn().mockResolvedValue({ id: "chat-1", messages: [] }),
    listChats: vi.fn().mockResolvedValue([]),
    listProjectChats: vi.fn().mockResolvedValue([]),
    updateMessageStatus: vi.fn().mockResolvedValue(undefined),
    updateMessageContent: vi.fn().mockResolvedValue(undefined),
    updateMessage: vi.fn().mockResolvedValue(undefined),
    updateMessageToolCalls: vi.fn().mockResolvedValue(undefined),
    deleteChat: vi.fn().mockResolvedValue(undefined)
});

describe("Orchestrator Agent Integration", () => {
    let orchestrator: Orchestrator;
    let mockLlmClient: {
        sendMessage: Mock;
        streamMessage: Mock;
        checkToolSupport: Mock;
    };
    let mockChatManager: ChatManager;
    let mockActionsManager: ActionsManager;
    let mockAgentManager: AgentManager;
    let providerConfig: LlmProviderConfig;

    beforeEach(() => {
        // Create mocks
        providerConfig = {
            provider: "test",
            name: "test-provider",
            model: "test-model",
            apiKey: "test-key"
        };

        mockLlmClient = {
            sendMessage: vi.fn(),
            streamMessage: vi.fn().mockImplementation(() => {
                const emitter = new EventEmitter();
                setTimeout(() => {
                    emitter.emit("data", { content: "test response", isFinal: true });
                    emitter.emit("end", { content: "test response" });
                }, 10);
                return emitter;
            }),
            checkToolSupport: vi.fn().mockResolvedValue(true)
        };

        mockChatManager = createMockChatManager();
        mockActionsManager = {
            registerServer: vi.fn(),
            unregisterServer: vi.fn(),
            getServer: vi.fn(),
            getAvailableTools: vi.fn().mockResolvedValue([]),
            executeToolCall: vi.fn()
        } as unknown as ActionsManager;

        // Create orchestrator with mocks
        orchestrator = new Orchestrator(
            mockLlmClient,
            mockChatManager,
            mockActionsManager
        );

        // Get the mocked AgentManager instance
        mockAgentManager = (orchestrator as any).agentManager;

        // Register provider
        orchestrator.registerLlmProvider(providerConfig);
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe("Agent Integration", () => {
        const createTestMessage = (chatId: string = "chat-1"): LlmMessage => ({
            id: "msg-1",
            chatId,
            content: "test content",
            role: "user",
            status: MessageStatus.SENT,
            created: new Date(),
            provider: "test"
        });

        const createTestToolCall = (result: boolean = true): ToolCall => ({
            function: {
                name: "test_tool",
                arguments: { param: "value" }
            },
            ...(result && {
                result: {
                    status: "success",
                    value: "test result",
                    contentType: "text/plain",
                    timestamp: new Date()
                }
            })
        });

        it("should call agent.react with message and tool calls at stream end", async () => {
            const message = createTestMessage();
            const toolCall = createTestToolCall();

            // Setup mock stream that emits a tool call
            mockLlmClient.streamMessage.mockImplementation(() => {
                const emitter = new EventEmitter();
                setTimeout(() => {
                    const chunk = {
                        content: "test response",
                        tool_calls: [toolCall],
                        isFinal: true
                    };
                    emitter.emit("data", chunk);
                    emitter.emit("end", chunk);
                }, 10);
                return emitter;
            });

            // Process message
            const emitter = await orchestrator.processMessageStream(message);
            await new Promise<void>(resolve => {
                emitter.on("end", () => {
                    setTimeout(resolve, 50); // Give time for all handlers to complete
                });
            });

            // Verify agent.react was called with the message and tool calls
            expect(mockAgentManager.react).toHaveBeenCalledWith(
                message,
                [toolCall]
            );
        });

        it("should call agent.react even when no tool calls present", async () => {
            const message = createTestMessage();

            // Setup mock stream with no tool calls
            mockLlmClient.streamMessage.mockImplementation(() => {
                const emitter = new EventEmitter();
                setTimeout(() => {
                    emitter.emit("data", {
                        content: "test response",
                        isFinal: true
                    });
                    emitter.emit("end", {
                        content: "test response"
                    });
                }, 10);
                return emitter;
            });

            // Process message
            const emitter = await orchestrator.processMessageStream(message);
            await new Promise<void>(resolve => {
                emitter.on("end", () => {
                    setTimeout(resolve, 50);
                });
            });

            expect(mockAgentManager.react).toHaveBeenCalledTimes(1);
            // Verify agent.react was called with empty tool calls array
            expect(mockAgentManager.react).toHaveBeenCalledWith(message, []);
        });

        it("should create continuation messages when agent returns continue", async () => {
            const message = createTestMessage();
            const toolCall = createTestToolCall();
            const systemMessage = "Tool execution results...";

            // Setup agent to return continue
            (mockAgentManager.react as Mock).mockResolvedValueOnce({
                type: "continue",
                systemMessage
            });

            // Setup mock stream
            mockLlmClient.streamMessage.mockImplementation(() => {
                const emitter = new EventEmitter();
                setTimeout(() => {
                    emitter.emit("data", {
                        content: "test response",
                        tool_calls: [toolCall],
                        isFinal: true
                    });
                    emitter.emit("end", {
                        content: "test response",
                        tool_calls: [toolCall]
                    });
                }, 10);
                return emitter;
            });

            // Process message
            const emitter = await orchestrator.processMessageStream(message);
            await new Promise<void>(resolve => {
                emitter.on("end", () => {
                    setTimeout(resolve, 50);
                });
            });

            // Verify continuation messages were created
            expect(mockChatManager.addMessage).toHaveBeenCalledWith(
                message.chatId,
                "",
                "assistant",
                "assistant"
            );
            expect(mockChatManager.addMessage).toHaveBeenCalledWith(
                message.chatId,
                "[Auto-continuation]",
                "user",
                "system"
            );
        });

        it("should add system message when agent returns complete with message", async () => {
            const message = createTestMessage();
            const toolCall = createTestToolCall();
            const systemMessage = "Maximum roundtrips reached";

            // Setup agent to return complete with message
            (mockAgentManager.react as Mock).mockResolvedValueOnce({
                type: "complete",
                systemMessage
            });

            // Setup mock stream
            mockLlmClient.streamMessage.mockImplementation(() => {
                const emitter = new EventEmitter();
                setTimeout(() => {
                    emitter.emit("data", {
                        content: "test response",
                        tool_calls: [toolCall],
                        isFinal: true
                    });
                    emitter.emit("end", {
                        content: "test response",
                        tool_calls: [toolCall]
                    });
                }, 10);
                return emitter;
            });

            // Process message
            const emitter = await orchestrator.processMessageStream(message);
            await new Promise<void>(resolve => {
                emitter.on("end", () => {
                    setTimeout(resolve, 50);
                });
            });

            // Verify system message was added
            expect(mockChatManager.addMessage).toHaveBeenCalledWith(
                message.chatId,
                systemMessage,
                "system",
                "system"
            );
        });

        it("should handle agent errors gracefully", async () => {
            const message = createTestMessage();
            const toolCall = createTestToolCall();
            const error = new Error("Agent error");

            // Setup agent to return error
            (mockAgentManager.react as Mock).mockResolvedValueOnce({
                type: "error",
                error
            });

            // Setup mock stream
            mockLlmClient.streamMessage.mockImplementation(() => {
                const emitter = new EventEmitter();
                setTimeout(() => {
                    emitter.emit("data", {
                        content: "test response",
                        tool_calls: [toolCall],
                        isFinal: true
                    });
                    emitter.emit("end", {
                        content: "test response",
                        tool_calls: [toolCall]
                    });
                }, 10);
                return emitter;
            });

            // Process message
            const emitter = await orchestrator.processMessageStream(message);
            await new Promise<void>(resolve => {
                emitter.on("end", () => {
                    setTimeout(resolve, 50);
                });
            });

            // Verify error was handled (no error thrown)
            expect(mockChatManager.addMessage).not.toHaveBeenCalled();
        });
    });
}); 