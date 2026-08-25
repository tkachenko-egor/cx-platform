/**
 * FR-6.2: typed-variable system prompt template — the platform's default
 * core prompt, deliberately vertical-neutral. Concrete policy numbers stay
 * out of it: they belong to the tenant's KB documents and to the return
 * tool's per-agent settings (agent_defs.tool_settings), so this text never
 * has to be edited to change a window or a fee.
 *
 * Two sections are shaped by what this phase can actually do: an ELIGIBLE
 * return verdict still routes to a human (no write tool completes a return
 * yet), and escalation promises a colleague's follow-up rather than a ticket
 * number (no ticket tool exists).
 */

const CORE_PROMPT = `# ROLE
You are the {{TENANT_NAME}} customer care assistant. You help with orders, deliveries, returns, product choice and account questions.

# SAFETY FIRST
If a customer describes a product causing them harm or a health problem, drop everything else and follow the PRODUCT SAFETY rule below before answering anything else in their message.
If the session block sets severe_symptom_signal to true, go straight to the urgent path in PRODUCT SAFETY. Do not ask the triage question first.

# SCOPE
Answer only {{TENANT_NAME}} topics. For anything else, say so warmly and offer a human.

# IDENTIFYING THE CUSTOMER
Ask for an order number (ORD-100001) or the email on the order. Never guess. Never reveal order data before the customer identifies the order.
If the session block already names an identified order, use it. Do not ask again.

# DATES
Never calculate a date or a number of days yourself. The tools return days since delivery and pre-written date phrases. Use them exactly as given. Today's date is in the session block.

# GROUNDING
Base every policy, product and timeframe answer on the documents in the knowledge block. Never invent a rule, fee, specification or claim.
If sources disagree, say so, give both with citations, offer escalation.
If you cannot find it, say so and offer a human. Do not fill gaps with plausible guesses.

# CITATION
When an answer draws on a knowledge document, mark it with the document's doc_id in square brackets at the end of the sentence it supports, like [returns-and-refunds]. Use the doc_id exactly. Cite more than one where more than one applies. Never cite a document you did not use.

# PRODUCT SAFETY
Never diagnose, assess, or name a likely cause. You are not a medical or technical expert.
If harm or a health problem is mentioned: express concern briefly, tell them to stop using the product, and let them know a colleague will follow up shortly to log it and arrange next steps. Do not promise a specific refund or return outcome yourself.
Never call check_return_eligibility for a safety report — a colleague handles the return alongside the report.
If they mention difficulty breathing, swelling of the face or throat, chest pain, a burn, an injury, or anything getting rapidly worse: tell them to seek medical attention straight away, and say a colleague is being notified urgently — before any return or order talk. Nothing goes before it — no greeting, no lookup, no question.
Where severity is unclear, ask exactly one question: whether they have any difficulty breathing, any swelling, or any injury. Offer three answers: yes, no, or not sure. Treat "not sure" as yes.

# MEDICAL QUESTIONS
Never advise on suitability for a medical condition, medication, allergy or pregnancy. Share the product's stated details and recommend a qualified professional.
Answering what a product is or contains is fine. Judging whether it is right for someone's body is not.

# RETURN RULES
Return windows run from the DELIVERY date, not the order date. The return tool holds the exact windows and fees — never quote one from memory.
Unopened and unused: refund per the policy in the knowledge block.
Opened: no change-of-mind returns, because the item can no longer be resold. Explain it as a condition requirement, never as a preference.
Opened is always accepted for a safety concern, a defect, damage, or a wrong item sent.
Promotional and free items have no standalone refund value and cannot be returned alone.
Replacement only when stock is above zero, otherwise a refund.
Address change and cancellation: only while the order has not shipped.

# UNKNOWN OPEN STATE
If a tool returns NEEDS_INFO because the record does not say whether an item was opened, ask the customer plainly whether the packaging is still sealed, explain that the answer changes the outcome, and call the tool again with their answer. Never assume, and never guess in the customer's favour or against it.

# DELIVERING BAD NEWS
When refusing: state the decision, name the specific rule and why it applies, then offer the best alternative. Never refuse without an alternative. Warm, brief, apologise once at most.

# TOOLS
Use tools for all order, product, stock and return data. Never state status, tracking or stock from memory.

# TOOL SEQUENCING
Call check_return_eligibility before promising any return outcome. Never predict its answer.
When it comes back ELIGIBLE, tell the customer they are eligible and explain that a colleague will follow up to complete the return — you cannot complete it yourself in this conversation.
Never invent an RMA number, ticket id or any other reference. You have none to give this phase.

# STYLE
Warm, natural, brief. Two to four sentences for simple answers.
Bullets only for real lists. Never clinical, never salesy.
Never invent order numbers, reference numbers, dates or prices.
Reply in the language the customer writes in.

# ESCALATION
Say a colleague will follow up when: any product-safety concern; the customer asks for a human; they push back on a refusal; a policy exception is needed; or you have failed twice.
Summarise the issue and what you already tried so the colleague does not have to ask again.`;

/** Phase 7 M2: simple `{{KEY}}` substitution into an agent's stored system prompt — TENANT_NAME/AGENT_NAME/TODAY today, easy to extend. Unknown `{{...}}` tokens are left as-is rather than erroring, since a prompt authored before this feature existed may legitimately contain literal double-braces. */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => (key in vars ? vars[key] : match));
}

const FORMALITY_LABEL: Record<string, string> = {
  ty: "Use informal address (ти) throughout, never formal ви.",
  vy: "Use formal, respectful address (ви) throughout, never informal ти.",
};

const RESPONSE_LENGTH_LABEL: Record<string, string> = {
  brief: "Keep replies to one or two short sentences unless the customer asks for more detail.",
  standard: "Two to four sentences for a typical reply.",
  detailed: "Give thorough, complete answers — don't trim detail for brevity's sake.",
};

const EMOJI_POLICY_LABEL: Record<string, string> = {
  never: "Never use emoji.",
  sparing: "Use at most one emoji, only when it clearly fits the tone.",
  liberal: "Emoji are welcome where they fit naturally.",
};

/** Phase 7 M3: renders an agent's persona config into a system block, same shape as knowledgeBlock/sessionBlock below. Only non-empty fields are included, so an agent with no persona configured emits nothing worth the model's attention. */
export function personaBlock(persona: {
  tone?: string;
  customTone?: string;
  formality?: "ty" | "vy" | "auto";
  responseLength?: "brief" | "standard" | "detailed";
  emojiPolicy?: "never" | "sparing" | "liberal";
  doNotSayList?: string[];
  brandVocabulary?: string[];
}): string | null {
  const lines: string[] = [];
  if (persona.customTone) lines.push(`Tone: ${persona.customTone}`);
  else if (persona.tone) lines.push(`Tone: ${persona.tone}`);
  if (persona.formality && persona.formality !== "auto" && FORMALITY_LABEL[persona.formality]) lines.push(FORMALITY_LABEL[persona.formality]);
  if (persona.responseLength && RESPONSE_LENGTH_LABEL[persona.responseLength]) lines.push(RESPONSE_LENGTH_LABEL[persona.responseLength]);
  if (persona.emojiPolicy && EMOJI_POLICY_LABEL[persona.emojiPolicy]) lines.push(EMOJI_POLICY_LABEL[persona.emojiPolicy]);
  if (persona.doNotSayList && persona.doNotSayList.length > 0) lines.push(`Never say any of: ${persona.doNotSayList.join(", ")}.`);
  if (persona.brandVocabulary && persona.brandVocabulary.length > 0) lines.push(`Prefer this brand vocabulary where natural: ${persona.brandVocabulary.join(", ")}.`);
  if (lines.length === 0) return null;
  return `<persona>\n${lines.join("\n")}\n</persona>`;
}

const MIXED_INPUT_LABEL: Record<string, string> = {
  transliterate_to_native: "If the customer writes in a transliterated/Latin-script form of their language (e.g. Ukrainian typed in Latin letters), reply in the standard native script, not transliterated back.",
  answer_as_written: "If the customer writes in a transliterated/Latin-script form of their language, reply the same way they wrote it.",
  ask_preference: "If the customer writes in a transliterated/Latin-script form of their language, ask once which script they'd prefer for replies.",
};

/** Phase 7 M3: renders an agent's language config into a system block. */
export function languageBlock(config: {
  supportedLanguages?: string[];
  defaultLanguage?: string;
  autoDetect?: boolean;
  alwaysAnswerInCustomerLanguage?: boolean;
  mixedInputHandling?: "transliterate_to_native" | "answer_as_written" | "ask_preference";
}): string | null {
  const lines: string[] = [];
  if (config.alwaysAnswerInCustomerLanguage) lines.push("Always reply in the same language the customer's message is written in, regardless of the default language below.");
  if (config.defaultLanguage) lines.push(`Default language when the customer's language is unclear: ${config.defaultLanguage}.`);
  if (config.supportedLanguages && config.supportedLanguages.length > 0) lines.push(`Supported languages: ${config.supportedLanguages.join(", ")}. For any other language, say so and offer the default language or a human.`);
  if (config.mixedInputHandling && MIXED_INPUT_LABEL[config.mixedInputHandling]) lines.push(MIXED_INPUT_LABEL[config.mixedInputHandling]);
  if (lines.length === 0) return null;
  return `<language>\n${lines.join("\n")}\n</language>`;
}

/** Phase 9 M2: renders an agent's conversation-logic config into a system block. Prompt-level guidance only — neither the topic scope nor the required-slots list is deterministically enforced, same spirit as personaBlock/languageBlock above. */
export function scopeBlock(config: { inScopeTopics?: string[]; outOfScopeTopics?: string[]; requiredSlots?: string[] }): string | null {
  const lines: string[] = [];
  if (config.inScopeTopics && config.inScopeTopics.length > 0) lines.push(`This agent specializes in: ${config.inScopeTopics.join(", ")}.`);
  if (config.outOfScopeTopics && config.outOfScopeTopics.length > 0) lines.push(`Do not attempt to help with: ${config.outOfScopeTopics.join(", ")}. Acknowledge the request and offer to hand off to a human or the right specialist instead.`);
  if (config.requiredSlots && config.requiredSlots.length > 0) lines.push(`Before proceeding with a request that needs it, make sure you have collected: ${config.requiredSlots.join(", ")}. Ask for whichever of these are still missing before calling a tool that needs them.`);
  if (lines.length === 0) return null;
  return `<scope>\n${lines.join("\n")}\n</scope>`;
}

function knowledgeBlock(chunks: { docId: string; title: string; effective: string | null; text: string }[]): string {
  const wrapped = chunks.map((c) => `<document doc_id="${c.docId}" title="${c.title}" effective="${c.effective ?? ""}">\n${c.text}\n</document>`).join("\n");
  return `<knowledge>\n${wrapped}\n</knowledge>`;
}

export interface SessionContext {
  today: string;
  severeSymptomSignal: boolean;
  knownOrderId?: string;
}

function sessionBlock(ctx: SessionContext): string {
  const lines = [`today: ${ctx.today}`, `severe_symptom_signal: ${ctx.severeSymptomSignal}`];
  if (ctx.knownOrderId) lines.push(`known_order_id: ${ctx.knownOrderId}`);
  return `<session>\n${lines.join("\n")}\n</session>`;
}

export function buildCorePrompt(tenantName: string): string {
  return CORE_PROMPT.replaceAll("{{TENANT_NAME}}", tenantName);
}

/** FR-6.7: the receiving agent gets this structured package instead of transcript replay. */
function handoffBlock(pkg: { reason: string; summary: string; extractedEntities: Record<string, string>; instructionsForReceivingAgent: string }): string {
  const entities = Object.entries(pkg.extractedEntities)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
  const lines = [`reason: ${pkg.reason}`, `summary: ${pkg.summary}`, entities ? `known_facts:\n${entities}` : "", pkg.instructionsForReceivingAgent ? `instructions: ${pkg.instructionsForReceivingAgent}` : ""].filter(Boolean);
  return `<handoff>\nYou are picking up this conversation from another specialist. Use the context below — do not ask the customer to repeat themselves.\n${lines.join("\n")}\n</handoff>`;
}

/** FR-6.6: the router's own system prompt — classification only, never a customer-facing reply. */
export function buildRouterPrompt(tenantName: string, targets: { key: string; description: string }[]): string {
  const lines = targets.map((t) => `- ${t.key}: ${t.description}`).join("\n");
  return `You are the routing classifier for ${tenantName}'s customer support. Read the customer's message and call route_to_agent with exactly one of these specialists:\n${lines}\nAlways call route_to_agent — never answer the customer directly, never explain your reasoning in text.`;
}

export { knowledgeBlock, sessionBlock, handoffBlock };
