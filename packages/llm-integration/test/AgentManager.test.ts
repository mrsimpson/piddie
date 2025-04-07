import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AgentManager, AgentConfig } from "../src/AgentManager";
import { ChatCompletionRole } from "openai/resources/chat";
import { Message, MessageStatus, ToolCall, ToolCallResult, ChatManager, Chat } from "@piddie/chat-management";
import { EventEmitter } from "@piddie/shared-types";
import { LlmMessage, LlmStreamChunk, LlmProviderConfig } from "../src/types";
import { Mock } from "vitest";

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
    let agentManager: AgentManager;

    // Testing constants
    const TEST_CHAT_ID = "test-chat-1";
    const DEFAULT_PROVIDER = "test-provider";

    beforeEach(() => {
        agentManager = new AgentManager();
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

    describe("react", () => {
        const mockMessage: LlmMessage = {
            id: "test-message",
            chatId: "test-chat",
            content: "test content",
            role: "assistant",
            status: MessageStatus.SENT,
            created: new Date(),
            provider: DEFAULT_PROVIDER,
            assistantMessageId: "test-assistant"
        };

        const mockToolCalls: ToolCall[] = [
            createMockToolCall("test-tool", { arg: "value" }, {
                status: "success",
                value: "result"
            })
        ];

        it("returns complete if agent is not enabled", async () => {
            const result = await agentManager.react(mockMessage, mockToolCalls);
            expect(result.type).toBe("complete");
        });

        it("returns complete if no tool calls provided", async () => {
            await agentManager.configureAgent("test-chat", { enabled: true });
            const result = await agentManager.react(mockMessage, []);
            expect(result.type).toBe("complete");
        });

        it("returns complete if no completed tool calls", async () => {
            await agentManager.configureAgent("test-chat", { enabled: true });
            const result = await agentManager.react(mockMessage, [
                createMockToolCall("test-tool", { arg: "value" })
            ]);
            expect(result.type).toBe("complete");
        });

        it("returns complete if max roundtrips reached", async () => {
            await agentManager.configureAgent("test-chat", {
                enabled: true,
                maxRoundtrips: 1
            });

            // First call
            await agentManager.react(mockMessage, mockToolCalls);
            // Second call should hit max roundtrips
            const result = await agentManager.react(mockMessage, mockToolCalls);

            expect(result.type).toBe("complete");
            expect(result.systemMessage).toContain("roundtrips");
        });

        it("returns continue with system message when auto-continue enabled", async () => {
            await agentManager.configureAgent("test-chat", {
                enabled: true,
                autoContinue: true
            });

            const result = await agentManager.react(mockMessage, mockToolCalls);

            expect(result.type).toBe("continue");
            expect(result.systemMessage).toBeDefined();
        });

        it("returns complete when auto-continue disabled", async () => {
            await agentManager.configureAgent("test-chat", {
                enabled: true,
                autoContinue: false
            });

            const result = await agentManager.react(mockMessage, mockToolCalls);

            expect(result.type).toBe("complete");
        });

        it("increments roundtrips and stores tool calls in context", async () => {
            await agentManager.configureAgent("test-chat", { enabled: true });

            await agentManager.react(mockMessage, mockToolCalls);

            const context = agentManager.getAgentContext("test-chat");
            expect(context?.roundtrips).toBe(1);
            expect(context?.lastToolCalls).toEqual(mockToolCalls);
        });

    });
}); 