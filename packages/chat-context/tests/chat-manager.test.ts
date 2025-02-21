import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Chat, Message } from "../src/types";
import { MessageStatus } from "../src/types";
import type { Table } from "dexie";
import { DexieChatManager } from "../src/internal/dexie-implementation";
import { ChatDatabase } from "../src/internal/dexie-implementation";

// Create mock functions for chats table
const chatMocks = {
  add: vi.fn<(chat: Omit<Chat, "messages">) => Promise<string>>(),
  get: vi.fn<(id: string) => Promise<Omit<Chat, "messages"> | undefined>>(),
  update:
    vi.fn<
      (id: string, changes: Partial<Omit<Chat, "messages">>) => Promise<number>
    >(),
  delete: vi.fn<(id: string) => Promise<void>>(),
  orderBy: vi.fn(),
  toArray: vi.fn<() => Promise<Omit<Chat, "messages">[]>>()
};

// Create mock functions for messages table
const messageMocks = {
  add: vi.fn<(message: Message) => Promise<string>>(),
  get: vi.fn<(id: string) => Promise<Message | undefined>>(),
  update: vi.fn<(id: string, changes: Partial<Message>) => Promise<number>>(),
  delete: vi.fn<(id: string) => Promise<void>>(),
  where: vi.fn(),
  toArray: vi.fn<() => Promise<Message[]>>()
};

// Mock where clause functions
const whereMocks = {
  equals: vi.fn(),
  sortBy: vi.fn(),
  delete: vi.fn()
};

// Mock orderBy functions
const orderByMocks = {
  reverse: vi.fn(),
  offset: vi.fn(),
  limit: vi.fn()
};

// Create mock tables
const mockChatTable = {
  ...chatMocks,
  db: {} as any,
  name: "chats",
  schema: {},
  hook: () => {},
  core: {} as any,
  get tableName() {
    return "chats";
  }
} as unknown as Table<Omit<Chat, "messages">, string>;

const mockMessageTable = {
  ...messageMocks,
  db: {} as any,
  name: "messages",
  schema: {},
  hook: () => {},
  core: {} as any,
  get tableName() {
    return "messages";
  }
} as unknown as Table<Message, string>;

// Mock Dexie
vi.mock("dexie", () => {
  return {
    default: class MockDexie {
      chats: any;
      messages: any;

      constructor() {
        this.chats = mockChatTable;
        this.messages = mockMessageTable;
      }

      version() {
        return this;
      }

      stores() {
        return this;
      }
    }
  };
});

describe("ChatManager", () => {
  let chatManager: DexieChatManager;
  let mockDb: ChatDatabase;

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset mock implementations
    chatMocks.orderBy.mockReturnValue(orderByMocks);
    orderByMocks.reverse.mockReturnValue(orderByMocks);
    orderByMocks.offset.mockReturnValue(orderByMocks);
    orderByMocks.limit.mockReturnValue(orderByMocks);

    messageMocks.where.mockReturnValue(whereMocks);
    whereMocks.equals.mockReturnValue(whereMocks);
    whereMocks.sortBy.mockImplementation(async () => []);

    mockDb = new ChatDatabase();
    mockDb.chats = mockChatTable;
    mockDb.messages = mockMessageTable;
    chatManager = new DexieChatManager(mockDb);
  });

  describe("GIVEN a new chat manager", () => {
    describe("WHEN creating a new chat", () => {
      it("THEN should create chat with correct properties", async () => {
        const metadata = { projectId: "test-project" };
        chatMocks.add.mockResolvedValueOnce("new-id");

        const chat = await chatManager.createChat(metadata);

        expect(chat).toMatchObject({
          metadata,
          messages: []
        });
        expect(chat.id).toMatch(/^chat_\d+$/);
        expect(chat.created).toBeInstanceOf(Date);
        expect(chat.lastUpdated).toBeInstanceOf(Date);
        expect(chatMocks.add).toHaveBeenCalledWith({
          id: chat.id,
          created: chat.created,
          lastUpdated: chat.lastUpdated,
          metadata
        });
      });

      it("THEN should create chat without metadata", async () => {
        chatMocks.add.mockResolvedValueOnce("new-id");

        const chat = await chatManager.createChat();

        expect(chat.metadata).toBeUndefined();
        expect(chatMocks.add).toHaveBeenCalledWith({
          id: chat.id,
          created: chat.created,
          lastUpdated: chat.lastUpdated,
          metadata: undefined
        });
      });
    });

    describe("WHEN adding a message", () => {
      it("THEN should add message with correct properties", async () => {
        const chat: Omit<Chat, "messages"> = {
          id: "chat_1",
          created: new Date(),
          lastUpdated: new Date(),
          metadata: undefined
        };
        chatMocks.get.mockResolvedValueOnce(chat);
        messageMocks.add.mockResolvedValueOnce("msg_1");
        chatMocks.update.mockResolvedValueOnce(1);

        const message = await chatManager.addMessage(
          chat.id,
          "Hello, world!",
          "user"
        );

        expect(message).toMatchObject({
          chatId: chat.id,
          content: "Hello, world!",
          role: "user",
          status: MessageStatus.SENT,
          parentId: undefined
        });
        expect(message.id).toMatch(/^msg_\d+$/);
        expect(message.created).toBeInstanceOf(Date);

        expect(messageMocks.add).toHaveBeenCalledWith(message);
        expect(chatMocks.update).toHaveBeenCalledWith(chat.id, {
          lastUpdated: expect.any(Date)
        });
      });

      it("THEN should support message threading", async () => {
        const chat: Omit<Chat, "messages"> = {
          id: "chat_1",
          created: new Date(),
          lastUpdated: new Date(),
          metadata: undefined
        };
        const parentMessage: Message = {
          id: "msg_1",
          chatId: chat.id,
          content: "Parent message",
          role: "user",
          status: MessageStatus.SENT,
          created: new Date(),
          parentId: undefined
        };

        chatMocks.get.mockResolvedValueOnce(chat);
        messageMocks.add.mockResolvedValueOnce("msg_2");
        chatMocks.update.mockResolvedValueOnce(1);

        const reply = await chatManager.addMessage(
          chat.id,
          "Reply message",
          "assistant",
          parentMessage.id
        );

        expect(reply.parentId).toBe(parentMessage.id);
        expect(messageMocks.add).toHaveBeenCalledWith(reply);
        expect(chatMocks.update).toHaveBeenCalledWith(chat.id, {
          lastUpdated: expect.any(Date)
        });
      });

      it("THEN should throw error for non-existent chat", async () => {
        chatMocks.get.mockResolvedValueOnce(undefined);

        await expect(
          chatManager.addMessage("non-existent", "test", "user")
        ).rejects.toThrow("Chat not found");
      });
    });

    describe("WHEN updating message status", () => {
      it("THEN should update status correctly", async () => {
        const message: Message = {
          id: "msg_1",
          chatId: "chat_1",
          content: "Test message",
          role: "user",
          status: MessageStatus.SENDING,
          created: new Date(),
          parentId: undefined
        };

        messageMocks.get.mockResolvedValueOnce(message);
        messageMocks.update.mockResolvedValueOnce(1);
        chatMocks.update.mockResolvedValueOnce(1);

        await chatManager.updateMessageStatus(
          message.id,
          MessageStatus.SENT
        );

        expect(messageMocks.update).toHaveBeenCalledWith(message.id, {
          status: MessageStatus.SENT
        });
        expect(chatMocks.update).toHaveBeenCalledWith(message.chatId, {
          lastUpdated: expect.any(Date)
        });
      });

      it("THEN should throw error for non-existent message", async () => {
        messageMocks.get.mockResolvedValueOnce(undefined);

        await expect(
          chatManager.updateMessageStatus(
            "non-existent",
            MessageStatus.SENT
          )
        ).rejects.toThrow("Message not found");
      });
    });

    describe("WHEN listing chats", () => {
      const createMockChat = (
        id: string,
        lastUpdated: Date
      ): Omit<Chat, "messages"> => ({
        id,
        created: new Date(lastUpdated.getTime() - 1000), // 1 second before lastUpdated
        lastUpdated,
        metadata: undefined
      });

      const createMockMessage = (chatId: string, content: string): Message => ({
        id: `msg_${Date.now()}`,
        chatId,
        content,
        role: "user",
        status: MessageStatus.SENT,
        created: new Date(),
        parentId: undefined
      });

      it("THEN should return chats sorted by lastUpdated", async () => {
        const now = new Date();
        const mockChats = [
          createMockChat("chat_1", new Date(now.getTime() - 2000)), // Oldest
          createMockChat("chat_2", new Date(now.getTime() - 1000)), // Middle
          createMockChat("chat_3", now) // Newest
        ];

        orderByMocks.limit.mockReturnValueOnce({
          toArray: async () => [...mockChats].reverse()
        });

        // Mock messages for each chat
        whereMocks.sortBy
          .mockResolvedValueOnce([createMockMessage("chat_1", "First chat")])
          .mockResolvedValueOnce([createMockMessage("chat_2", "Second chat")])
          .mockResolvedValueOnce([createMockMessage("chat_3", "Third chat")]);

        const chats = await chatManager.listChats();

        // Verify sorting
        expect(chats.map((c) => c.id)).toEqual(["chat_3", "chat_2", "chat_1"]);
        expect(chatMocks.orderBy).toHaveBeenCalledWith("lastUpdated");
        expect(orderByMocks.reverse).toHaveBeenCalled();
      });

      it("THEN should respect limit parameter", async () => {
        const now = new Date();
        const mockChats = [
          createMockChat("chat_1", now),
          createMockChat("chat_2", new Date(now.getTime() - 1000))
        ];

        orderByMocks.limit.mockReturnValueOnce({
          toArray: async () => mockChats.slice(0, 1)
        });

        whereMocks.sortBy.mockResolvedValueOnce([
          createMockMessage("chat_1", "First chat")
        ]);

        const chats = await chatManager.listChats(1);

        expect(chats).toHaveLength(1);
        expect(chats[0]!.id).toBe("chat_1");
        expect(orderByMocks.limit).toHaveBeenCalledWith(1);
      });

      it("THEN should respect offset parameter", async () => {
        const now = new Date();
        const mockChats = [
          createMockChat("chat_1", now),
          createMockChat("chat_2", new Date(now.getTime() - 1000))
        ];

        orderByMocks.limit.mockReturnValueOnce({
          toArray: async () => mockChats.slice(1)
        });

        whereMocks.sortBy.mockResolvedValueOnce([
          createMockMessage("chat_2", "Second chat")
        ]);

        const chats = await chatManager.listChats();

        expect(chats).toHaveLength(1);
        expect(chats[0]!.id).toBe("chat_2");
        expect(orderByMocks.offset).toHaveBeenCalledWith(1);
      });

      it("THEN should handle empty result set", async () => {
        orderByMocks.limit.mockReturnValueOnce({
          toArray: async () => []
        });

        const chats = await chatManager.listChats();

        expect(chats).toHaveLength(0);
      });

      it("THEN should handle pagination with both limit and offset", async () => {
        const now = new Date();
        const mockChats = [
          createMockChat("chat_1", now),
          createMockChat("chat_2", new Date(now.getTime() - 1000)),
          createMockChat("chat_3", new Date(now.getTime() - 2000))
        ];

        // Mock getting the middle chat
        orderByMocks.limit.mockReturnValueOnce({
          toArray: async () => [mockChats[1]]
        });

        whereMocks.sortBy.mockResolvedValueOnce([
          createMockMessage("chat_2", "Second chat")
        ]);

        const chats = await chatManager.listChats();

        expect(chats).toHaveLength(1);
        expect(chats[0]!.id).toBe("chat_2");
        expect(orderByMocks.offset).toHaveBeenCalledWith(1);
        expect(orderByMocks.limit).toHaveBeenCalledWith(1);
      });
    });

    describe("WHEN getting a chat", () => {
      it("THEN should return messages in correct order", async () => {
        const chat: Omit<Chat, "messages"> = {
          id: "chat_1",
          created: new Date(),
          lastUpdated: new Date(),
          metadata: undefined
        };

        const mockMessages = [
          {
            id: "msg_1",
            chatId: chat.id,
            content: "First message",
            role: "user",
            status: MessageStatus.SENT,
            created: new Date(Date.now() - 2000),
            parentId: undefined
          },
          {
            id: "msg_2",
            chatId: chat.id,
            content: "Second message",
            role: "assistant",
            status: MessageStatus.SENT,
            created: new Date(Date.now() - 1000),
            parentId: undefined
          },
          {
            id: "msg_3",
            chatId: chat.id,
            content: "Third message",
            role: "user",
            status: MessageStatus.SENT,
            created: new Date(),
            parentId: undefined
          }
        ];

        chatMocks.get.mockResolvedValueOnce(chat);
        whereMocks.sortBy.mockResolvedValueOnce(mockMessages);

        const result = await chatManager.getChat(chat.id);

        expect(result.messages).toHaveLength(3);
        expect(result.messages.map((m) => m.id)).toEqual([
          "msg_1",
          "msg_2",
          "msg_3"
        ]);
        expect(messageMocks.where).toHaveBeenCalledWith("chatId");
        expect(whereMocks.equals).toHaveBeenCalledWith(chat.id);
        expect(whereMocks.sortBy).toHaveBeenCalledWith("created");
      });

      it("THEN should handle chat with no messages", async () => {
        const chat: Omit<Chat, "messages"> = {
          id: "chat_1",
          created: new Date(),
          lastUpdated: new Date(),
          metadata: undefined
        };

        chatMocks.get.mockResolvedValueOnce(chat);
        whereMocks.sortBy.mockResolvedValueOnce([]);

        const result = await chatManager.getChat(chat.id);

        expect(result.messages).toHaveLength(0);
      });
    });

    describe("WHEN deleting a chat", () => {
      it("THEN should remove chat and its messages", async () => {
        const chat: Omit<Chat, "messages"> = {
          id: "chat_1",
          created: new Date(),
          lastUpdated: new Date(),
          metadata: undefined
        };
        chatMocks.get.mockResolvedValueOnce(chat);
        whereMocks.delete.mockResolvedValueOnce(1);
        chatMocks.delete.mockResolvedValueOnce(undefined);

        await chatManager.deleteChat(chat.id);

        expect(messageMocks.where).toHaveBeenCalledWith("chatId");
        expect(whereMocks.equals).toHaveBeenCalledWith(chat.id);
        expect(whereMocks.delete).toHaveBeenCalled();
        expect(chatMocks.delete).toHaveBeenCalledWith(chat.id);
      });

      it("THEN should throw error for non-existent chat", async () => {
        chatMocks.get.mockResolvedValueOnce(undefined);
        await expect(chatManager.deleteChat("non-existent")).rejects.toThrow(
          "Chat not found"
        );
      });
    });
  });
});
