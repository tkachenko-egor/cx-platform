import { describe, expect, it } from "vitest";
import { buildInterpretRequest, extractGuardrailPatch, mergeGuardrailPatch } from "../src/guardrails/interpret";

describe("buildInterpretRequest", () => {
  it("forces the single set_guardrails tool call and embeds the admin's text as the user turn", () => {
    const request = buildInterpretRequest("Never discuss competitor pricing.");
    expect(request.tools).toHaveLength(1);
    expect(request.tools?.[0].name).toBe("set_guardrails");
    expect(request.messages.at(-1)).toEqual({ role: "user", content: "Never discuss competitor pricing." });
  });
});

describe("extractGuardrailPatch", () => {
  it("reads only known fields off the tool call, dropping anything unexpected", () => {
    const patch = extractGuardrailPatch([
      {
        name: "set_guardrails",
        arguments: {
          input: { blockedTopics: ["legal advice", 42, "medical dosing"], somethingUnknown: true },
          output: { aiDisclosureMessage: "You're chatting with an AI.", piiMode: "not-a-real-mode" },
        },
      },
    ]);
    expect(patch.input?.blockedTopics).toEqual(["legal advice", "medical dosing"]);
    expect(patch.output?.aiDisclosureMessage).toBe("You're chatting with an AI.");
    expect(patch.output?.piiMode).toBeUndefined();
  });

  it("returns {} when the model didn't call set_guardrails", () => {
    expect(extractGuardrailPatch([{ name: "some_other_tool", arguments: {} }])).toEqual({});
    expect(extractGuardrailPatch([])).toEqual({});
  });
});

describe("mergeGuardrailPatch", () => {
  it("unions and dedupes list fields instead of replacing them", () => {
    const current = { input: { blockedTopics: ["legal advice"], competitorNames: ["Acme Corp"] } };
    const patch = { input: { blockedTopics: ["legal advice", "medical dosing"] } };
    const merged = mergeGuardrailPatch(current, patch);
    expect(merged.input?.blockedTopics).toEqual(["legal advice", "medical dosing"]);
    expect(merged.input?.competitorNames).toEqual(["Acme Corp"]);
  });

  it("only overwrites scalar fields the patch actually set, preserving manual edits otherwise", () => {
    const current = { output: { aiDisclosureMessage: "existing disclosure", blockingMode: true } };
    const merged = mergeGuardrailPatch(current, { output: { aiDisclosureMessage: "new disclosure" } });
    expect(merged.output?.aiDisclosureMessage).toBe("new disclosure");
    expect(merged.output?.blockingMode).toBe(true);
  });

  it("leaves current untouched when the patch is empty", () => {
    const current = { input: { blockedTopics: ["legal advice"] }, output: { profanityCheck: false } };
    const merged = mergeGuardrailPatch(current, {});
    expect(merged.input?.blockedTopics).toEqual(["legal advice"]);
    expect(merged.output?.profanityCheck).toBe(false);
  });
});
