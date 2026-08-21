/**
 * FR-6.12: deterministic escape hatches — code-level triggers that don't
 * depend on the model deciding correctly. Tuned toward false positives:
 * a false positive costs one unnecessary handoff, a false negative on the
 * severity scan costs a customer being told to sit tight during a real
 * reaction. Ported from amarelle-handoff's lib/agent/severity.ts.
 */
const SEVERE_SYMPTOM_MARKERS: string[] = [
  // EN
  "swelling", "swollen", "puffed", "lips are swelling", "tongue", "throat feels tight",
  "throat closing", "trouble breathing", "can't breathe", "cant breathe", "difficulty breathing",
  "blister", "blistering", "spreading", "getting worse fast", "hives all over", "eyes swollen shut",
  // UK
  "набряк", "набрякло", "опухло", "губи", "язик", "горло", "важко дихати", "не можу дихати",
  "пухирі", "пухирці", "поширюється", "погіршується", "кропив'янка", "кропивянка",
  // FR
  "gonflement", "gonflé", "gonfle", "lèvres", "levres", "langue", "gorge serrée", "gorge serree",
  "du mal à respirer", "du mal a respirer", "cloques", "ça s'étend", "ca s'etend", "ça empire", "ca empire", "urticaire",
];

const HUMAN_REQUEST_MARKERS: string[] = [
  "talk to a human", "speak to a human", "real person", "human agent", "talk to an agent",
  "talk to someone", "customer service rep", "escalate", "supervisor", "manager",
];

export function scanForSevereSymptoms(message: string): { hit: boolean; matched?: string } {
  const lower = message.toLowerCase();
  for (const marker of SEVERE_SYMPTOM_MARKERS) {
    if (lower.includes(marker)) return { hit: true, matched: marker };
  }
  return { hit: false };
}

export function scanForHumanRequest(message: string): { hit: boolean; matched?: string } {
  const lower = message.toLowerCase();
  for (const marker of HUMAN_REQUEST_MARKERS) {
    if (lower.includes(marker)) return { hit: true, matched: marker };
  }
  return { hit: false };
}

/** Any reaction mention at all (not just severe) routes to the SKIN REACTIONS prompt section, per CLAUDE.md invariant #4's spirit — "I'm not sure" is deliberately treated as a hit, not a pass. */
const REACTION_MENTION_MARKERS: string[] = [
  "reaction", "rash", "itchy", "itching", "burning", "irritat", "broke out", "breakout",
  "реакція", "висип", "свербить", "печіння", "réaction", "irritation", "démangeaison", "demangeaison",
];

export function scanForReactionMention(message: string): { hit: boolean; matched?: string } {
  const lower = message.toLowerCase();
  for (const marker of REACTION_MENTION_MARKERS) {
    if (lower.includes(marker)) return { hit: true, matched: marker };
  }
  return { hit: false };
}
