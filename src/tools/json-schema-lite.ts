/**
 * Deliberately weak validation for admin-authored HTTP tools: required-key
 * presence + a loose `typeof` check per declared property type. Code tools
 * keep their zod schemas (src/tools/amarelle/*.ts) — this only covers tools
 * that have no code behind them, so there's no zod schema to write. Enough
 * to catch an obviously wrong call, not a substitute for real validation.
 */
export function validateAgainstJsonSchema(schema: Record<string, unknown>, args: unknown): Record<string, unknown> {
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    throw new Error("Tool arguments must be an object");
  }
  const obj = args as Record<string, unknown>;

  const required = Array.isArray(schema.required) ? (schema.required as unknown[]).filter((r): r is string => typeof r === "string") : [];
  for (const key of required) {
    if (!(key in obj)) {
      throw new Error(`Missing required argument "${key}"`);
    }
  }

  const properties = (schema.properties ?? {}) as Record<string, { type?: string }>;
  for (const [key, value] of Object.entries(obj)) {
    const expectedType = properties[key]?.type;
    if (!expectedType || value === undefined || value === null) continue;
    const actualType = Array.isArray(value) ? "array" : typeof value;
    const jsonTypeMatches =
      expectedType === actualType ||
      (expectedType === "integer" && actualType === "number") ||
      (expectedType === "number" && actualType === "number");
    if (!jsonTypeMatches) {
      throw new Error(`Argument "${key}" expected type "${expectedType}", got "${actualType}"`);
    }
  }

  return obj;
}
