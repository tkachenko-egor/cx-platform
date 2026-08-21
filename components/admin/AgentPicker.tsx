"use client";

import { useRouter } from "next/navigation";
import { Field, Select } from "../ui/Input";

/** Phase 6 M8: scopes /analytics to one agent via ?agent=, reusing the Field+Select primitive the rest of the admin uses for pickers. */
export function AgentPicker({ agentKeys, selected }: { agentKeys: string[]; selected?: string }) {
  const router = useRouter();

  return (
    <Field label="Agent" htmlFor="analytics-agent-picker">
      <Select
        id="analytics-agent-picker"
        value={selected ?? ""}
        onChange={(e) => router.push(e.target.value ? `/analytics?agent=${e.target.value}` : "/analytics")}
        className="w-56"
      >
        <option value="">All agents</option>
        {agentKeys.map((key) => (
          <option key={key} value={key}>
            {key}
          </option>
        ))}
      </Select>
    </Field>
  );
}
