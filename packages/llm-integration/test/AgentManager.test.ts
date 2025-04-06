import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AgentManager, AgentConfig } from "../src/AgentManager";
import { ChatCompletionRole } from "openai/resources/chat";
import { MessageStatus } from "@piddie/chat-management";
import type { Message, ToolCall, ToolCallResult } from "@piddie/chat-management";

// Mock types
interface MockChatManager {
    addMessage: (
        chatId: string,
        content: string,
        role: ChatCompletionRole,
        username: string,
        parentId?: string
    ) => Promise<Message>;
    updateMessageStatus: (
        chatId: string,
        messageId: string,
        status: MessageStatus
    ) => Promise<void>;
    updateMessage: (
        chatId: string,
        messageId: string,
        update: Partial<Message>
    ) => Promise<void>;
}

// Test helpers
const createMockToolCall = (
    name: string,
    args: Record<string, unknown>,
    result?: ToolCallResult
): ToolCall => ({
    function: {
        name,
        arguments: args
    },
    result
});

const createMockMessage = (
    id: string,
    chatId: string,
    content: string,
    role: ChatCompletionRole,
    status: MessageStatus = MessageStatus.SENT
): Message => ({
    id,
    chatId,
    content,
    role,
    status,
    created: new Date(),
    username: role,
    parentId: undefined
});

describe("AgentManager", () => {
    // Mock providers
    let mockChatManager: MockChatManager;
    let mockGetLlmProvider: (name: string) => any;
    let mockGetCompletionFn: (userMessage: Message, assistantPlaceholder: Message, providerConfig: any) => Promise<Message>;
    let agentManager: AgentManager;

    // Testing constants
    const TEST_CHAT_ID = "test-chat-id";
    const DEFAULT_PROVIDER = "test-provider";

    beforeEach(() => {
        // Create mocks
        mockChatManager = {
            addMessage: vi.fn().mockImplementation((chatId, content, role, username) =>
                Promise.resolve(createMockMessage(`${role}-${Date.now()}`, chatId, content, role))
            ),
            updateMessageStatus: vi.fn().mockResolvedValue(undefined),
            updateMessage: vi.fn().mockResolvedValue(undefined),
        };

        mockGetLlmProvider = vi.fn().mockImplementation((name) => {
            if (name === DEFAULT_PROVIDER) {
                return { provider: DEFAULT_PROVIDER };
            }
            return undefined;
        });

        mockGetCompletionFn = vi.fn().mockImplementation((userMessage, assistantPlaceholder) => {
            // Simulate a completion with a tool call
            return Promise.resolve({
                ...assistantPlaceholder,
                content: "I've processed your request",
                status: MessageStatus.SENT
            });
        });

        // Create instance
        agentManager = new AgentManager(
            mockChatManager as any,
            mockGetLlmProvider,
            mockGetCompletionFn,
            DEFAULT_PROVIDER
        );
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe("configureAgent", () => {
        it("should configure agent with default values when none provided", () => {
            agentManager.configureAgent(TEST_CHAT_ID, { enabled: true });

            const context = agentManager.getAgentContext(TEST_CHAT_ID);
            expect(context).toBeDefined();
            expect(context?.config.enabled).toBe(true);
            expect(context?.config.maxRoundtrips).toBe(10); // Default
            expect(context?.config.autoContinue).toBe(true); // Default
        });

        it("should override specific values when provided", () => {
            agentManager.configureAgent(TEST_CHAT_ID, {
                enabled: true,
                maxRoundtrips: 5,
                autoContinue: false
            });

            const context = agentManager.getAgentContext(TEST_CHAT_ID);
            expect(context?.config.enabled).toBe(true);
            expect(context?.config.maxRoundtrips).toBe(5);
            expect(context?.config.autoContinue).toBe(false);
        });

        it("should update existing configuration", () => {
            // First configuration
            agentManager.configureAgent(TEST_CHAT_ID, {
                enabled: true,
                maxRoundtrips: 5
            });

            // Update just one property
            agentManager.configureAgent(TEST_CHAT_ID, { maxRoundtrips: 8 });

            const context = agentManager.getAgentContext(TEST_CHAT_ID);
            expect(context?.config.enabled).toBe(true); // Preserved
            expect(context?.config.maxRoundtrips).toBe(8); // Updated
            expect(context?.config.autoContinue).toBe(true); // Preserved default
        });
    });

    describe("resetAgent", () => {
        it("should reset roundtrips and lastToolCalls but keep config", () => {
            // Setup agent with config
            agentManager.configureAgent(TEST_CHAT_ID, {
                enabled: true,
                maxRoundtrips: 5,
                autoContinue: false
            });

            // Manually set some context values to test reset
            const context = agentManager.getAgentContext(TEST_CHAT_ID)!;
            context.roundtrips = 3;
            context.isActive = true;
            context.lastToolCalls = [
                createMockToolCall("test-tool", { test: "arg" }, {
                    status: "success",
                    value: "result",
                    timestamp: new Date()
                })
            ];

            // Reset
            agentManager.resetAgent(TEST_CHAT_ID);

            // Check reset state
            const resetContext = agentManager.getAgentContext(TEST_CHAT_ID)!;
            expect(resetContext.roundtrips).toBe(0);
            expect(resetContext.isActive).toBe(false);
            expect(resetContext.lastToolCalls).toEqual([]);
            // But config should be preserved
            expect(resetContext.config.enabled).toBe(true);
            expect(resetContext.config.maxRoundtrips).toBe(5);
            expect(resetContext.config.autoContinue).toBe(false);
        });
    });

    describe("isAgentEnabled", () => {
        it("should return false for unconfigured chat", () => {
            expect(agentManager.isAgentEnabled("non-existent-chat")).toBe(false);
        });

        it("should return false for disabled agent", () => {
            agentManager.configureAgent(TEST_CHAT_ID, { enabled: false });
            expect(agentManager.isAgentEnabled(TEST_CHAT_ID)).toBe(false);
        });

        it("should return true for enabled agent", () => {
            agentManager.configureAgent(TEST_CHAT_ID, { enabled: true });
            expect(agentManager.isAgentEnabled(TEST_CHAT_ID)).toBe(true);
        });
    });

    describe("formatToolCallsForSystemMessage", () => {
        it("should format tool calls with results", () => {
            const toolCalls = [
                createMockToolCall("search", { query: "test" }, {
                    status: "success",
                    value: "Test result",
                    timestamp: new Date()
                })
            ];

            const formatted = agentManager.formatToolCallsForSystemMessage(toolCalls);

            expect(formatted).toContain("Tool: search");
            expect(formatted).toContain("Arguments:");
            expect(formatted).toContain('"query": "test"');
            expect(formatted).toContain("Result: SUCCESS: Test result");
        });

        it("should format multiple tool calls", () => {
            const toolCalls = [
                createMockToolCall("search", { query: "test" }, {
                    status: "success",
                    value: "Test result",
                    timestamp: new Date()
                }),
                createMockToolCall("calculate", { x: 1, y: 2 }, {
                    status: "success",
                    value: 3,
                    timestamp: new Date()
                })
            ];

            const formatted = agentManager.formatToolCallsForSystemMessage(toolCalls);

            expect(formatted).toContain("Tool: search");
            expect(formatted).toContain("Tool: calculate");
            expect(formatted).toContain('"query": "test"');
            expect(formatted).toContain('"x": 1');
            expect(formatted).toContain('"y": 2');
        });

        it("should handle tool calls without results", () => {
            const toolCalls = [
                createMockToolCall("search", { query: "test" })
            ];

            const formatted = agentManager.formatToolCallsForSystemMessage(toolCalls);

            expect(formatted).toContain("Tool: search");
            expect(formatted).toContain('"query": "test"');
            expect(formatted).toContain("Result: No result available");
        });

        it("should handle complex object results", () => {
            const toolCalls = [
                createMockToolCall("getUser", { id: 123 }, {
                    status: "success",
                    value: { name: "John", age: 30, roles: ["admin", "user"] },
                    timestamp: new Date()
                })
            ];

            const formatted = agentManager.formatToolCallsForSystemMessage(toolCalls);

            expect(formatted).toContain("Tool: getUser");
            expect(formatted).toContain('"id": 123');
            expect(formatted).toContain('"name": "John"');
            expect(formatted).toContain('"age": 30');
            expect(formatted).toContain('"roles": [');
            expect(formatted).toContain('"admin"');
        });
    });

    describe("createToolResultSystemMessage", () => {
        it("should return undefined when agent is not enabled", () => {
            agentManager.configureAgent(TEST_CHAT_ID, { enabled: false });

            // Manually set tool calls to test
            const context = agentManager.getAgentContext(TEST_CHAT_ID)!;
            context.lastToolCalls = [
                createMockToolCall("test-tool", { test: "arg" }, {
                    status: "success",
                    value: "result",
                    timestamp: new Date()
                })
            ];

            expect(agentManager.createToolResultSystemMessage(TEST_CHAT_ID)).toBeUndefined();
        });

        it("should return undefined when no tool calls exist", () => {
            agentManager.configureAgent(TEST_CHAT_ID, { enabled: true });
            expect(agentManager.createToolResultSystemMessage(TEST_CHAT_ID)).toBeUndefined();
        });

        it("should create a system message with tool results", () => {
            agentManager.configureAgent(TEST_CHAT_ID, { enabled: true });

            // Manually set context values
            const context = agentManager.getAgentContext(TEST_CHAT_ID)!;
            context.roundtrips = 2;
            context.lastToolCalls = [
                createMockToolCall("search", { query: "test" }, {
                    status: "success",
                    value: "Test result",
                    timestamp: new Date()
                })
            ];

            const message = agentManager.createToolResultSystemMessage(TEST_CHAT_ID);

            expect(message).toBeDefined();
            expect(message).toContain("Roundtrip 2/10");
            expect(message).toContain("Tool: search");
            expect(message).toContain('"query": "test"');
            expect(message).toContain("SUCCESS: Test result");
            expect(message).toContain("Continue based on these results");
        });

        it("should use custom system prompt when provided", () => {
            agentManager.configureAgent(TEST_CHAT_ID, {
                enabled: true,
                customSystemPrompt: "Custom prompt with {toolCalls}"
            });

            // Manually set context values
            const context = agentManager.getAgentContext(TEST_CHAT_ID)!;
            context.lastToolCalls = [
                createMockToolCall("test-tool", { test: "arg" }, {
                    status: "success",
                    value: "result",
                    timestamp: new Date()
                })
            ];

            const message = agentManager.createToolResultSystemMessage(TEST_CHAT_ID);
            expect(message).toBe("Custom prompt with {toolCalls}");
        });
    });

    describe("processToolCalls", () => {
        it("should not process calls when agent is disabled", async () => {
            agentManager.configureAgent(TEST_CHAT_ID, { enabled: false });

            const toolCalls = [
                createMockToolCall("test-tool", { test: "arg" }, {
                    status: "success",
                    value: "result",
                    timestamp: new Date()
                })
            ];

            await agentManager.processToolCalls(TEST_CHAT_ID, "message-id", toolCalls);

            // Check that the context wasn't modified
            const context = agentManager.getAgentContext(TEST_CHAT_ID);
            expect(context?.roundtrips).toBe(0);
            expect(context?.lastToolCalls).toEqual([]);

            // Verify continueChatWithToolResults wasn't called
            expect(mockChatManager.addMessage).not.toHaveBeenCalled();
        });

        it("should not process empty tool calls", async () => {
            agentManager.configureAgent(TEST_CHAT_ID, { enabled: true });
            await agentManager.processToolCalls(TEST_CHAT_ID, "message-id", []);

            // Check that the context wasn't modified
            const context = agentManager.getAgentContext(TEST_CHAT_ID);
            expect(context?.roundtrips).toBe(0);
            expect(context?.lastToolCalls).toEqual([]);
        });

        it("should not process tool calls without results", async () => {
            agentManager.configureAgent(TEST_CHAT_ID, { enabled: true });

            const toolCalls = [
                createMockToolCall("test-tool", { test: "arg" }) // No result
            ];

            await agentManager.processToolCalls(TEST_CHAT_ID, "message-id", toolCalls);

            // Check that the context wasn't modified
            const context = agentManager.getAgentContext(TEST_CHAT_ID);
            expect(context?.roundtrips).toBe(0);
            expect(context?.lastToolCalls).toEqual([]);
        });

        it("should increment roundtrips and store tool calls", async () => {
            agentManager.configureAgent(TEST_CHAT_ID, {
                enabled: true,
                autoContinue: false // Disable auto-continue for this test
            });

            const toolCalls = [
                createMockToolCall("test-tool", { test: "arg" }, {
                    status: "success",
                    value: "result",
                    timestamp: new Date()
                })
            ];

            await agentManager.processToolCalls(TEST_CHAT_ID, "message-id", toolCalls);

            // Check that the context was updated
            const context = agentManager.getAgentContext(TEST_CHAT_ID);
            expect(context?.roundtrips).toBe(1);
            expect(context?.lastToolCalls).toEqual(toolCalls);
            expect(context?.isActive).toBe(true);

            // Verify no continuation happened
            expect(mockChatManager.addMessage).not.toHaveBeenCalled();
        });

        it("should stop and add message when reaching max roundtrips", async () => {
            agentManager.configureAgent(TEST_CHAT_ID, {
                enabled: true,
                maxRoundtrips: 3
            });

            // Manually set roundtrips to just below the limit
            const context = agentManager.getAgentContext(TEST_CHAT_ID)!;
            context.roundtrips = 2;

            const toolCalls = [
                createMockToolCall("test-tool", { test: "arg" }, {
                    status: "success",
                    value: "result",
                    timestamp: new Date()
                })
            ];

            await agentManager.processToolCalls(TEST_CHAT_ID, "message-id", toolCalls);

            // Check that we added a system message
            expect(mockChatManager.addMessage).toHaveBeenCalledWith(
                TEST_CHAT_ID,
                expect.stringContaining("maximum allowed roundtrips"),
                "system",
                "system"
            );

            // Check that context was reset
            const resetContext = agentManager.getAgentContext(TEST_CHAT_ID);
            expect(resetContext?.roundtrips).toBe(0);
            expect(resetContext?.isActive).toBe(false);
        });

        it("should auto-continue when enabled", async () => {
            agentManager.configureAgent(TEST_CHAT_ID, {
                enabled: true,
                autoContinue: true
            });

            const toolCalls = [
                createMockToolCall("test-tool", { test: "arg" }, {
                    status: "success",
                    value: "result",
                    timestamp: new Date()
                })
            ];

            await agentManager.processToolCalls(TEST_CHAT_ID, "message-id", toolCalls);

            // Verify continuation was triggered
            expect(mockChatManager.addMessage).toHaveBeenCalledTimes(2); // Assistant + User
            expect(mockGetCompletionFn).toHaveBeenCalled();
        });
    });

    describe("continueChatWithToolResults", () => {
        it("should not continue when agent is disabled", async () => {
            agentManager.configureAgent(TEST_CHAT_ID, { enabled: false });
            await agentManager.continueChatWithToolResults(TEST_CHAT_ID);

            expect(mockChatManager.addMessage).not.toHaveBeenCalled();
            expect(mockGetCompletionFn).not.toHaveBeenCalled();
        });

        it("should not continue when agent is not active", async () => {
            agentManager.configureAgent(TEST_CHAT_ID, { enabled: true });
            // Agent is configured but not active
            await agentManager.continueChatWithToolResults(TEST_CHAT_ID);

            expect(mockChatManager.addMessage).not.toHaveBeenCalled();
            expect(mockGetCompletionFn).not.toHaveBeenCalled();
        });

        it("should not continue without tool calls", async () => {
            agentManager.configureAgent(TEST_CHAT_ID, { enabled: true });

            // Set agent as active but with no tool calls
            const context = agentManager.getAgentContext(TEST_CHAT_ID)!;
            context.isActive = true;

            await agentManager.continueChatWithToolResults(TEST_CHAT_ID);

            expect(mockChatManager.addMessage).not.toHaveBeenCalled();
            expect(mockGetCompletionFn).not.toHaveBeenCalled();
        });

        it("should create messages and call getCompletion", async () => {
            agentManager.configureAgent(TEST_CHAT_ID, { enabled: true });

            // Set up context
            const context = agentManager.getAgentContext(TEST_CHAT_ID)!;
            context.isActive = true;
            context.lastToolCalls = [
                createMockToolCall("test-tool", { test: "arg" }, {
                    status: "success",
                    value: "result",
                    timestamp: new Date()
                })
            ];

            await agentManager.continueChatWithToolResults(TEST_CHAT_ID);

            // Check that we created assistant placeholder
            expect(mockChatManager.addMessage).toHaveBeenCalledWith(
                TEST_CHAT_ID,
                "",
                "assistant",
                "assistant",
                undefined
            );

            // Check that we set status to pending
            expect(mockChatManager.updateMessageStatus).toHaveBeenCalled();

            // Check that we created a virtual user message
            expect(mockChatManager.addMessage).toHaveBeenCalledWith(
                TEST_CHAT_ID,
                "[Auto-continuation]",
                "user",
                "system"
            );

            // Check that we called getCompletion
            expect(mockGetLlmProvider).toHaveBeenCalledWith(DEFAULT_PROVIDER);
            expect(mockGetCompletionFn).toHaveBeenCalled();
        });

        it("should handle errors during continuation", async () => {
            agentManager.configureAgent(TEST_CHAT_ID, { enabled: true });

            // Set up context
            const context = agentManager.getAgentContext(TEST_CHAT_ID)!;
            context.isActive = true;
            context.lastToolCalls = [
                createMockToolCall("test-tool", { test: "arg" }, {
                    status: "success",
                    value: "result",
                    timestamp: new Date()
                })
            ];

            // Make the completion function fail
            mockGetCompletionFn.mockRejectedValueOnce(new Error("Test error"));

            await agentManager.continueChatWithToolResults(TEST_CHAT_ID);

            // Check that we added an error message
            expect(mockChatManager.addMessage).toHaveBeenCalledWith(
                TEST_CHAT_ID,
                expect.stringContaining("Error continuing agentic flow: Test error"),
                "system",
                "system"
            );

            // Check that agent was reset
            const resetContext = agentManager.getAgentContext(TEST_CHAT_ID);
            expect(resetContext?.isActive).toBe(false);
            expect(resetContext?.roundtrips).toBe(0);
        });

        it("should handle missing provider", async () => {
            agentManager.configureAgent(TEST_CHAT_ID, { enabled: true });

            // Set up context
            const context = agentManager.getAgentContext(TEST_CHAT_ID)!;
            context.isActive = true;
            context.lastToolCalls = [
                createMockToolCall("test-tool", { test: "arg" }, {
                    status: "success",
                    value: "result",
                    timestamp: new Date()
                })
            ];

            // Make provider lookup return undefined
            mockGetLlmProvider.mockReturnValueOnce(undefined);

            await agentManager.continueChatWithToolResults(TEST_CHAT_ID);

            // Check that we added an error message
            expect(mockChatManager.addMessage).toHaveBeenCalledWith(
                TEST_CHAT_ID,
                expect.stringContaining("Error continuing agentic flow: No LLM provider configured"),
                "system",
                "system"
            );
        });
    });
}); 