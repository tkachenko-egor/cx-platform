/**
 * FR-6.12: deterministic escape hatches — code-level triggers that don't
 * depend on the model deciding correctly. Tuned toward false positives:
 * a false positive costs one unnecessary handoff, a false negative on the
 * severity scan costs a customer being told to sit tight during a real
 * emergency. The base list below is deliberately domain-neutral — anything
 * vertical-specific belongs in agent_defs.escalation_config, which is
 * appended to these, never replaces them.
 */
const SEVERE_SYMPTOM_MARKERS: string[] = [
  // EN
  "can't breathe", "cant breathe", "trouble breathing", "difficulty breathing", "throat closing",
  "throat feels tight", "chest pain", "swelling", "swollen", "allergic reaction", "anaphyla",
  "unconscious", "passed out", "severe pain", "bleeding", "electric shock", "caught fire",
  "call an ambulance", "went to hospital", "emergency room", "getting worse fast",
  // UK
  "не можу дихати", "важко дихати", "горло стискає", "набряк", "набрякло", "опухло",
  "біль у грудях", "втратив свідомість", "знепритомнів", "алергічна реакція", "кровотеча",
  "викличте швидку", "погіршується",
  // FR
  "je ne peux pas respirer", "du mal à respirer", "du mal a respirer", "gorge serrée", "gorge serree",
  "douleur à la poitrine", "douleur a la poitrine", "gonflement", "gonflé", "gonfle",
  "réaction allergique", "reaction allergique", "perdu connaissance", "saignement",
  "appeler une ambulance", "ça empire", "ca empire",
];

const HUMAN_REQUEST_MARKERS: string[] = [
  "talk to a human", "speak to a human", "real person", "human agent", "talk to an agent",
  "talk to someone", "customer service rep", "escalate", "supervisor", "manager",
];

/** Phase 8 M1: extraMarkers is admin-configured (agent_defs.escalation_config), always appended to — never replacing — the tuned defaults above. */
export function scanForSevereSymptoms(message: string, extraMarkers: string[] = []): { hit: boolean; matched?: string } {
  const lower = message.toLowerCase();
  for (const marker of [...SEVERE_SYMPTOM_MARKERS, ...extraMarkers]) {
    if (lower.includes(marker.toLowerCase())) return { hit: true, matched: marker };
  }
  return { hit: false };
}

export function scanForHumanRequest(message: string, extraMarkers: string[] = []): { hit: boolean; matched?: string } {
  const lower = message.toLowerCase();
  for (const marker of [...HUMAN_REQUEST_MARKERS, ...extraMarkers]) {
    if (lower.includes(marker.toLowerCase())) return { hit: true, matched: marker };
  }
  return { hit: false };
}

/** Any mention of a product causing harm at all (not just severe) routes to the PRODUCT SAFETY prompt section — "I'm not sure" is deliberately treated as a hit, not a pass. */
const REACTION_MENTION_MARKERS: string[] = [
  "reaction", "made me sick", "made me ill", "hurt me", "injured", "injury", "burned me", "burn",
  "rash", "irritat", "unsafe", "dangerous", "harmed",
  "реакція", "травма", "опік", "нашкодило", "небезпечно", "подразнення",
  "réaction", "blessure", "brûlure", "brulure", "irritation", "dangereux",
];

export function scanForReactionMention(message: string, extraMarkers: string[] = []): { hit: boolean; matched?: string } {
  const lower = message.toLowerCase();
  for (const marker of [...REACTION_MENTION_MARKERS, ...extraMarkers]) {
    if (lower.includes(marker.toLowerCase())) return { hit: true, matched: marker };
  }
  return { hit: false };
}

/**
 * Phase 2 negative-sentiment escalation: same deterministic, zero-model-call
 * shape as the scanners above rather than a classifier call, to match the
 * existing cost/latency posture for escalation signals. Tuned toward overt
 * frustration/anger markers, not mere negativity — "I'm not sure this will
 * work" shouldn't hit, "this is unacceptable" should.
 */
const NEGATIVE_SENTIMENT_MARKERS: string[] = [
  // EN
  "ridiculous", "unacceptable", "furious", "outraged", "terrible service", "worst experience",
  "waste of my time", "extremely frustrated", "so frustrated", "fed up", "sick of this",
  "never buying again", "never shopping here again", "disgusted", "pathetic", "incompetent",
  "this is a joke", "absolutely awful", "horrible experience",
  // UK
  "жахливо", "обурливо", "розлючений", "розлючена", "найгірший досвід", "втомився від цього",
  "втомилася від цього", "неприпустимо", "жахлива поведінка",
  // FR
  "ridicule", "inacceptable", "furieux", "furieuse", "pire expérience", "pire experience",
  "j'en ai marre", "j'en ai assez", "scandaleux", "service épouvantable", "service epouvantable",
];

export function scanForNegativeSentiment(message: string, extraMarkers: string[] = []): { hit: boolean; matched?: string } {
  const lower = message.toLowerCase();
  for (const marker of [...NEGATIVE_SENTIMENT_MARKERS, ...extraMarkers]) {
    if (lower.includes(marker.toLowerCase())) return { hit: true, matched: marker };
  }
  return { hit: false };
}
