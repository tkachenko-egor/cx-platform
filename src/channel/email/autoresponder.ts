/**
 * FR-3.16: never reply to a vacation autoresponder — this is how mail
 * loops start (bot replies → autoresponder replies → bot replies → ...).
 */
const AUTO_SUBJECT_MARKERS = [/out of office/i, /automatic reply/i, /auto[- ]?reply/i, /vacation/i, /away from (the )?office/i, /undeliverable/i, /delivery status notification/i];

export function isAutoResponse(headers: Record<string, string>, subject: string): boolean {
  const autoSubmitted = headers["auto-submitted"];
  if (autoSubmitted && autoSubmitted.toLowerCase() !== "no") return true;
  if (headers["x-autoreply"] || headers["x-autorespond"] || headers["x-auto-response-suppress"]) return true;
  return AUTO_SUBJECT_MARKERS.some((marker) => marker.test(subject));
}
