export interface FlowGraphNode {
  key: string;
  handoffTargets: string[];
}

/**
 * Static whole-graph cycle detection for the admin flow builder — advisory
 * only. Deliberately NOT a reuse of loop-prevention.ts's detectCycle(),
 * which is a runtime check over the last few hops of one actual
 * conversation (a different, narrower question than "does this graph
 * shape contain a cycle at all"). The real runtime guardrail stays
 * exactly where it is; this only warns an admin editing the graph.
 *
 * An edge (from -> to) is cyclic iff `to` can reach `from` again through
 * the rest of the graph — that's the definition of "this edge closes a
 * loop." Checked per-edge via reachability rather than a single DFS
 * back-edge pass, because a plain back-edge walk only marks edges on the
 * one path the traversal happened to take first; in a densely
 * interconnected graph (e.g. three specialists all handing off to each
 * other) that misses real cyclic edges reached via an already-visited
 * node. O(E * (V + E)) is trivial at the size this graph ever gets
 * (a handful of agents).
 */
export function detectCyclicEdges(nodes: FlowGraphNode[]): Set<string> {
  const adjacency = new Map(nodes.map((n) => [n.key, n.handoffTargets]));

  function canReach(start: string, target: string): boolean {
    const visited = new Set<string>();
    const stack = [start];
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (current === target) return true;
      if (visited.has(current)) continue;
      visited.add(current);
      for (const next of adjacency.get(current) ?? []) {
        if (!visited.has(next)) stack.push(next);
      }
    }
    return false;
  }

  const cyclic = new Set<string>();
  for (const [from, targets] of adjacency) {
    for (const to of targets) {
      if (canReach(to, from)) cyclic.add(`${from}->${to}`);
    }
  }
  return cyclic;
}
