import { describe, expect, it } from "vitest";
import { getCapabilities } from "../src/gateway/capability-matrix";

describe("capability matrix", () => {
  it("returns capabilities for a known provider:model pair", () => {
    const capabilities = getCapabilities("anthropic", "claude-sonnet-5");
    expect(capabilities?.toolCalling).toBe(true);
    expect(capabilities?.contextWindow).toBeGreaterThan(0);
  });

  it("returns undefined for an unregistered pair, so callers must handle absence rather than assume", () => {
    expect(getCapabilities("openai", "gpt-nonexistent")).toBeUndefined();
  });
});
