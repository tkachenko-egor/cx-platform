import { describe, expect, it } from "vitest";
import { suggestAssignees } from "../src/desk/skill-match";

describe("suggestAssignees (Phase 2 M6b — trimmed to a suggestion hint, not auto-assignment)", () => {
  it("returns staff with at least one matching skill, sorted by match count descending", () => {
    const staff = [
      { id: "u1", email: "a@x.com", skills: ["billing-specialist"] },
      { id: "u2", email: "b@x.com", skills: ["billing-specialist", "technical-specialist"] },
      { id: "u3", email: "c@x.com", skills: ["technical-specialist"] },
    ];

    const result = suggestAssignees(["billing-specialist", "technical-specialist"], staff);
    expect(result.map((r) => r.userId)).toEqual(["u2", "u1", "u3"]);
    expect(result[0].matchCount).toBe(2);
  });

  it("excludes staff with zero matching skills", () => {
    const staff = [{ id: "u1", email: "a@x.com", skills: ["billing-specialist"] }];
    expect(suggestAssignees(["technical-specialist"], staff)).toEqual([]);
  });

  it("returns an empty array when the conversation has no tags", () => {
    const staff = [{ id: "u1", email: "a@x.com", skills: ["billing-specialist"] }];
    expect(suggestAssignees([], staff)).toEqual([]);
  });
});
