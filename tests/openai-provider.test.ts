import { describe, it, expect, vi, afterEach } from "vitest";
import { OpenAiProvider } from "../src/gateway/providers/openai";
import { GatewayError } from "../src/gateway/types";

function sseStream(lines: string[]): ReadableStream<Uint8Array> {
  const body = lines.join("");
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    },
  });
}

/**
 * The Responses API sends `event: <type>` immediately before each `data:
 * <json>` line within one SSE block — unlike Chat Completions, which sends
 * bare `data:` lines. chatStream must pull the data line out of the block
 * rather than requiring the whole block to start with "data:".
 */
describe("OpenAiProvider.chatStream", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses event:+data: blocks and surfaces deltas plus the final response", async () => {
    const stream = sseStream([
      'event: response.created\ndata: {"type":"response.created"}\n\n',
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"Hel"}\n\n',
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"lo"}\n\n',
      'event: response.completed\ndata: {"type":"response.completed","response":{"output":[{"type":"message","content":[{"type":"output_text","text":"Hello"}]}],"status":"completed","usage":{"input_tokens":10,"output_tokens":2}}}\n\n',
    ]);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(stream, { status: 200 })),
    );

    const provider = new OpenAiProvider("test-key");
    const deltas: string[] = [];
    const result = await provider.chatStream!("gpt-5.1", { messages: [{ role: "user", content: "hi" }] }, (d) => deltas.push(d));

    expect(deltas).toEqual(["Hel", "lo"]);
    expect(result.content).toBe("Hello");
    expect(result.usage.promptTokens).toBe(10);
    expect(result.usage.completionTokens).toBe(2);
  });

  it("throws with the real detail when the stream reports response.failed", async () => {
    const stream = sseStream([
      'event: response.failed\ndata: {"type":"response.failed","response":{"error":{"message":"invalid model"}}}\n\n',
    ]);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(stream, { status: 200 })),
    );

    const provider = new OpenAiProvider("test-key");
    await expect(provider.chatStream!("gpt-5.1", { messages: [{ role: "user", content: "hi" }] }, () => {})).rejects.toMatchObject({
      constructor: GatewayError,
      message: expect.stringContaining("invalid model"),
    });
  });
});
