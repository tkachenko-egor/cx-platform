import { describe, expect, it } from "vitest";
import { scanForNegativeSentiment } from "../src/agents/escalation";

describe("scanForNegativeSentiment", () => {
  it("hits on overt frustration/anger markers", () => {
    expect(scanForNegativeSentiment("This is absolutely ridiculous, I want a refund").hit).toBe(true);
    expect(scanForNegativeSentiment("I am extremely frustrated with this service").hit).toBe(true);
    expect(scanForNegativeSentiment("Worst experience I've ever had, never buying again").hit).toBe(true);
  });

  it("hits on Ukrainian and French markers", () => {
    expect(scanForNegativeSentiment("Це неприпустимо, я розлючений").hit).toBe(true);
    expect(scanForNegativeSentiment("C'est inacceptable, j'en ai marre").hit).toBe(true);
  });

  it("does not hit on mild or neutral messages", () => {
    expect(scanForNegativeSentiment("Where is my order?").hit).toBe(false);
    expect(scanForNegativeSentiment("I am not sure this will work for my setup").hit).toBe(false);
    expect(scanForNegativeSentiment("Thanks, that helps!").hit).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(scanForNegativeSentiment("THIS IS UNACCEPTABLE").hit).toBe(true);
  });
});
