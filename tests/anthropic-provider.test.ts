import { describe, it, expect, vi } from "vitest";

const createMock = vi.fn().mockResolvedValue({
  content: [{ type: "text", text: "hi" }],
  stop_reason: "end_turn",
  usage: { input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 0 },
});

vi.mock("@anthropic-ai/sdk", () => {
  class FakeAnthropic {
    messages = { create: createMock };
  }
  return { default: FakeAnthropic };
});

// Imported after the mock so AnthropicProvider's `new Anthropic(...)` picks up FakeAnthropic.
const { AnthropicProvider } = await import("../src/gateway/providers/anthropic");

/**
 * NativeToolConfig is provider-agnostic (src/gateway/types.ts) — this checks AnthropicProvider's
 * half of translating it, the counterpart to OpenAiProvider's toResponsesTool mapping.
 */
describe("AnthropicProvider native tools", () => {
  it("maps a web_search native tool to Claude's hosted web_search_20250305 tool", async () => {
    const provider = new AnthropicProvider("test-key");
    await provider.chat("claude-sonnet-5", { messages: [{ role: "user", content: "hi" }], nativeTools: [{ type: "web_search" }] });

    const call = createMock.mock.calls.at(-1)![0];
    expect(call.tools).toEqual([{ type: "web_search_20250305", name: "web_search" }]);
  });

  it("drops file_search and mcp native tools, which have no Claude equivalent", async () => {
    const provider = new AnthropicProvider("test-key");
    await provider.chat("claude-sonnet-5", {
      messages: [{ role: "user", content: "hi" }],
      nativeTools: [{ type: "file_search", vectorStoreIds: ["vs_1"] }, { type: "mcp", serverLabel: "x", serverUrl: "https://example.com" }],
    });

    const call = createMock.mock.calls.at(-1)![0];
    expect(call.tools).toBeUndefined();
  });

  it("merges custom tool definitions with native tools in one array", async () => {
    const provider = new AnthropicProvider("test-key");
    await provider.chat("claude-sonnet-5", {
      messages: [{ role: "user", content: "hi" }],
      tools: [{ name: "lookup_order", description: "Looks up an order", parameters: { type: "object", properties: {} } }],
      nativeTools: [{ type: "web_search" }],
    });

    const call = createMock.mock.calls.at(-1)![0];
    expect(call.tools).toEqual([
      { name: "lookup_order", description: "Looks up an order", input_schema: { type: "object", properties: {} } },
      { type: "web_search_20250305", name: "web_search" },
    ]);
  });
});
