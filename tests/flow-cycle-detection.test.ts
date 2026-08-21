import { describe, expect, it } from "vitest";
import { detectCyclicEdges } from "../src/agents/flow-graph";

describe("detectCyclicEdges", () => {
  it("returns nothing for an acyclic graph (router fanning out to specialists)", () => {
    const cyclic = detectCyclicEdges([
      { key: "router", handoffTargets: ["billing", "technical"] },
      { key: "billing", handoffTargets: [] },
      { key: "technical", handoffTargets: [] },
    ]);
    expect(cyclic.size).toBe(0);
  });

  it("detects a simple two-node cycle", () => {
    const cyclic = detectCyclicEdges([
      { key: "a", handoffTargets: ["b"] },
      { key: "b", handoffTargets: ["a"] },
    ]);
    expect(cyclic).toEqual(new Set(["a->b", "b->a"]));
  });

  it("detects a longer cycle and leaves an unrelated acyclic branch untouched", () => {
    const cyclic = detectCyclicEdges([
      { key: "a", handoffTargets: ["b"] },
      { key: "b", handoffTargets: ["c"] },
      { key: "c", handoffTargets: ["a"] },
      { key: "d", handoffTargets: ["a"] }, // feeds into the cycle but isn't itself part of one
    ]);
    expect(cyclic).toEqual(new Set(["a->b", "b->c", "c->a"]));
  });

  it("detects a self-loop", () => {
    const cyclic = detectCyclicEdges([{ key: "a", handoffTargets: ["a"] }]);
    expect(cyclic).toEqual(new Set(["a->a"]));
  });

  it("marks every edge cyclic in a densely interconnected graph, not just the first path a traversal happens to find", () => {
    // Three specialists all handing off to each other, like the real seeded data —
    // a naive single-pass DFS back-edge walk misses edges reached via an
    // already-visited node (e.g. billing->support here, if support was already
    // fully explored via billing->technical->support first).
    const cyclic = detectCyclicEdges([
      { key: "billing", handoffTargets: ["technical", "support"] },
      { key: "support", handoffTargets: ["billing", "technical"] },
      { key: "technical", handoffTargets: ["billing", "support"] },
    ]);
    expect(cyclic).toEqual(
      new Set(["billing->technical", "billing->support", "support->billing", "support->technical", "technical->billing", "technical->support"]),
    );
  });

  it("a router with only outbound edges to that graph has no cyclic edges of its own", () => {
    const cyclic = detectCyclicEdges([
      { key: "router", handoffTargets: ["billing", "support", "technical"] },
      { key: "billing", handoffTargets: ["technical", "support"] },
      { key: "support", handoffTargets: ["billing", "technical"] },
      { key: "technical", handoffTargets: ["billing", "support"] },
    ]);
    expect([...cyclic].every((edge) => !edge.startsWith("router->"))).toBe(true);
  });

  it("handles a target key that isn't a node in the list (dangling reference) without throwing", () => {
    const cyclic = detectCyclicEdges([{ key: "a", handoffTargets: ["nonexistent"] }]);
    expect(cyclic.size).toBe(0);
  });
});
