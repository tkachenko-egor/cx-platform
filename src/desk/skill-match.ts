/**
 * Phase 2 M6b (trimmed scope — see the Phase 2 plan's Context section):
 * a "suggested assignee" hint, not presence-aware auto-assignment. `users`
 * has zero presence/capacity data today, so this is deliberately simple
 * set-intersection scoring over `conversations.tags` (currently just
 * `[currentAgentKey]`, the cheapest available "skill area" signal) against
 * each staff member's `users.skills` tags.
 */
export interface StaffCandidate {
  id: string;
  email: string;
  skills: string[];
}

export interface SuggestedAssignee {
  userId: string;
  email: string;
  matchCount: number;
}

/** Returns staff with at least one matching skill, sorted by match count descending (ties keep input order). */
export function suggestAssignees(conversationTags: string[], staffUsers: StaffCandidate[]): SuggestedAssignee[] {
  const tagSet = new Set(conversationTags);
  return staffUsers
    .map((user) => ({ userId: user.id, email: user.email, matchCount: user.skills.filter((skill) => tagSet.has(skill)).length }))
    .filter((candidate) => candidate.matchCount > 0)
    .sort((a, b) => b.matchCount - a.matchCount);
}
