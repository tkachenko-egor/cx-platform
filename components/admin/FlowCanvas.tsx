"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { detectCyclicEdges } from "../../src/agents/flow-graph";

export interface FlowNode {
  key: string;
  skills: string[];
  handoffTargets: string[];
}

const WIDTH = 720;
const HEIGHT = 440;
const NODE_WIDTH = 140;

function initialLayout(keys: string[]): Record<string, { x: number; y: number }> {
  const cx = WIDTH / 2;
  const cy = HEIGHT / 2;
  const r = Math.min(WIDTH, HEIGHT) / 2 - 70;
  const positions: Record<string, { x: number; y: number }> = {};
  keys.forEach((key, i) => {
    const angle = (i / keys.length) * 2 * Math.PI - Math.PI / 2;
    positions[key] = { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  });
  return positions;
}

/** Phase 3 M6: visualize + edit agent_defs.handoffTargets. No canvas/graph library — plain divs + one inline <svg> overlay, matching this codebase's no-charting-dependency convention. Layout is client-side-only (not persisted); dragging just rearranges the view. */
export function FlowCanvas({ initialNodes }: { initialNodes: FlowNode[] }) {
  const router = useRouter();
  const [nodes, setNodes] = useState(initialNodes);
  const [positions, setPositions] = useState(() => initialLayout(initialNodes.map((n) => n.key)));
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const draggingRef = useRef<{ key: string; offsetX: number; offsetY: number; moved: boolean } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const cyclicEdges = detectCyclicEdges(nodes.map((n) => ({ key: n.key, handoffTargets: n.handoffTargets })));

  useEffect(() => {
    function onMove(e: PointerEvent) {
      const drag = draggingRef.current;
      if (!drag || !containerRef.current) return;
      drag.moved = true;
      const rect = containerRef.current.getBoundingClientRect();
      setPositions((prev) => ({ ...prev, [drag.key]: { x: e.clientX - rect.left - drag.offsetX, y: e.clientY - rect.top - drag.offsetY } }));
    }
    function onUp() {
      draggingRef.current = null;
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  const onNodePointerDown = (key: string) => (e: React.PointerEvent) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const pos = positions[key];
    draggingRef.current = { key, offsetX: e.clientX - rect.left - pos.x, offsetY: e.clientY - rect.top - pos.y, moved: false };
  };

  const toggleEdge = async (from: string, to: string) => {
    const node = nodes.find((n) => n.key === from);
    if (!node) return;
    const has = node.handoffTargets.includes(to);
    const nextTargets = has ? node.handoffTargets.filter((t) => t !== to) : [...node.handoffTargets, to];

    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/agents/${from}/handoffs`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handoffTargets: nextTargets }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not update handoff targets");
      setNodes((prev) => prev.map((n) => (n.key === from ? { ...n, handoffTargets: nextTargets } : n)));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const onNodeClick = (key: string) => {
    // A drag that moved the node shouldn't also register as a connect-click.
    if (draggingRef.current?.moved) return;
    if (!selected) {
      setSelected(key);
      return;
    }
    if (selected === key) {
      setSelected(null);
      return;
    }
    const from = selected;
    setSelected(null);
    void toggleEdge(from, key);
  };

  return (
    <div className="mt-6">
      <p className="text-xs text-muted">
        Click a node, then click another to connect or disconnect a handoff (directional, from the first click). Drag to rearrange. Red edges are advisory —
        they mark a cycle in this graph shape; the real runtime loop guard lives in <code>src/agents/loop-prevention.ts</code> and isn&rsquo;t affected by this view.
      </p>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}

      <div ref={containerRef} className="relative mt-3 overflow-hidden rounded-xl border border-border bg-surface" style={{ width: WIDTH, height: HEIGHT }}>
        <svg width={WIDTH} height={HEIGHT} className="pointer-events-none absolute inset-0">
          <defs>
            <marker id="flow-arrow-muted" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" className="fill-muted" />
            </marker>
            <marker id="flow-arrow-danger" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" className="fill-danger" />
            </marker>
          </defs>
          {nodes.flatMap((node) =>
            node.handoffTargets.map((target) => {
              const from = positions[node.key];
              const to = positions[target];
              if (!from || !to) return null;
              const isCyclic = cyclicEdges.has(`${node.key}->${target}`);
              return (
                <line
                  key={`${node.key}->${target}`}
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  className={isCyclic ? "stroke-danger" : "stroke-muted"}
                  strokeWidth={isCyclic ? 2 : 1.5}
                  markerEnd={isCyclic ? "url(#flow-arrow-danger)" : "url(#flow-arrow-muted)"}
                />
              );
            }),
          )}
        </svg>

        {nodes.map((node) => {
          const pos = positions[node.key];
          if (!pos) return null;
          return (
            <div
              key={node.key}
              onPointerDown={onNodePointerDown(node.key)}
              onClick={() => onNodeClick(node.key)}
              className={`absolute flex -translate-x-1/2 -translate-y-1/2 cursor-grab select-none flex-col items-center justify-center rounded-lg border px-3 py-2 text-center shadow-sm ${
                selected === node.key ? "border-accent bg-accent/10" : "border-border bg-bg"
              }`}
              style={{ left: pos.x, top: pos.y, width: NODE_WIDTH }}
            >
              <span className="text-xs font-medium text-fg">{node.key}</span>
              {node.skills.length > 0 && <span className="mt-0.5 text-[10px] text-muted">{node.skills.join(", ")}</span>}
            </div>
          );
        })}
      </div>
      {busy && <p className="mt-2 text-xs text-muted">Saving…</p>}
    </div>
  );
}
