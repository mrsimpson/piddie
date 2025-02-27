/// <reference types="vitest/globals" />
/// <reference types="@vue/test-utils" />
/// <reference lib="dom" />

import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import MessagesList from "../MessagesList.vue";
import { MessageStatus } from "@piddie/chat-management";

// Mock the scrollTo method
const scrollToMock = vi.fn();
HTMLElement.prototype.scrollTo = scrollToMock;

describe("MessagesList.vue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders messages correctly", () => {
    const messages = [
      {
        id: "1",
        chatId: "chat1",
        content: "Hello",
        role: "user",
        status: MessageStatus.SENT,
        created: new Date(),
        username: undefined,
        parentId: undefined
      },
      {
        id: "2",
        chatId: "chat1",
        content: "Hi there!",
        role: "assistant",
        status: MessageStatus.SENT,
        created: new Date(),
        username: "AI Assistant",
        parentId: undefined
      }
    ];

    const wrapper = mount(MessagesList, {
      props: {
        messages
      }
    });

    // Check if all messages are rendered
    expect(wrapper.findAll(".message")).toHaveLength(2);

    // Check user message content
    const userMessage = wrapper.findAll(".message-user");
    expect(userMessage).toHaveLength(1);
    expect(userMessage[0].text()).toContain("Hello");

    // Check assistant message content
    const assistantMessage = wrapper.findAll(".message-assistant");
    expect(assistantMessage).toHaveLength(1);
    expect(assistantMessage[0].text()).toContain("Hi there!");
  });

  it("applies correct CSS classes based on message status", () => {
    const messages = [
      {
        id: "1",
        chatId: "chat1",
        content: "Message 1",
        role: "user",
        status: MessageStatus.SENDING,
        created: new Date(),
        username: undefined,
        parentId: undefined
      },
      {
        id: "2",
        chatId: "chat1",
        content: "Message 2",
        role: "assistant",
        status: MessageStatus.ERROR,
        created: new Date(),
        username: undefined,
        parentId: undefined
      }
    ];

    const wrapper = mount(MessagesList, {
      props: {
        messages
      }
    });

    // Check if sending status is applied
    const sendingMessage = wrapper.find(".message-sending");
    expect(sendingMessage.exists()).toBe(true);
    expect(sendingMessage.text()).toContain("Sending...");

    // Check if error status is applied
    const errorMessage = wrapper.find(".message-error");
    expect(errorMessage.exists()).toBe(true);
    expect(errorMessage.text()).toContain("Error");
  });

  it("scrolls to bottom when messages change", async () => {
    const messages = [
      {
        id: "1",
        chatId: "chat1",
        content: "Initial message",
        role: "user",
        status: MessageStatus.SENT,
        created: new Date(),
        username: undefined,
        parentId: undefined
      }
    ];

    const wrapper = mount(MessagesList, {
      props: {
        messages
      },
      attachTo: document.body
    });

    // Mock the scrollHeight property
    Object.defineProperty(wrapper.element, "scrollHeight", {
      configurable: true,
      get: () => 1000
    });

    // Add a new message
    await wrapper.setProps({
      messages: [
        ...messages,
        {
          id: "2",
          chatId: "chat1",
          content: "New message",
          role: "assistant",
          status: MessageStatus.SENT,
          created: new Date(),
          username: undefined,
          parentId: undefined
        }
      ]
    });

    await nextTick();

    // Check if scrollTop was set to scrollHeight
    expect(wrapper.element.scrollTop).toBe(wrapper.element.scrollHeight);
  });

  it("scrolls to bottom when last message content changes (streaming)", async () => {
    const messages = [
      {
        id: "1",
        chatId: "chat1",
        content: "Initial content",
        role: "assistant",
        status: MessageStatus.SENDING,
        created: new Date(),
        username: undefined,
        parentId: undefined
      }
    ];

    const wrapper = mount(MessagesList, {
      props: {
        messages
      },
      attachTo: document.body
    });

    // Mock the scrollHeight property
    Object.defineProperty(wrapper.element, "scrollHeight", {
      configurable: true,
      get: () => 1000
    });

    // Update the content of the last message (simulating streaming)
    await wrapper.setProps({
      messages: [
        {
          ...messages[0],
          content: "Initial content with more streamed text"
        }
      ]
    });

    await nextTick();

    // Check if scrollTop was set to scrollHeight
    expect(wrapper.element.scrollTop).toBe(wrapper.element.scrollHeight);
  });
});
