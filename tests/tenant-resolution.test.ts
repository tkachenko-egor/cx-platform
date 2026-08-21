import { describe, expect, it } from "vitest";
import { resolveTenantSlugFromHost } from "../src/platform/context";
import { RESERVED_SUBDOMAINS } from "../src/platform/reserved-subdomains";

describe("resolveTenantSlugFromHost", () => {
  it("takes the first label of a subdomain host", () => {
    expect(resolveTenantSlugFromHost("acme.localhost:3000")).toBe("acme");
    expect(resolveTenantSlugFromHost("acme.example.com")).toBe("acme");
  });

  it("falls back to DEFAULT_TENANT_SLUG/demo for a bare host with no subdomain label", () => {
    expect(resolveTenantSlugFromHost("localhost:3000")).toBe("demo");
    expect(resolveTenantSlugFromHost("localhost")).toBe("demo");
  });

  it("falls back to demo for an empty/missing host", () => {
    expect(resolveTenantSlugFromHost(null)).toBe("demo");
    expect(resolveTenantSlugFromHost(undefined)).toBe("demo");
    expect(resolveTenantSlugFromHost("")).toBe("demo");
  });

  it("is case-insensitive", () => {
    expect(resolveTenantSlugFromHost("ACME.localhost:3000")).toBe("acme");
  });

  it("marks the platform subdomain as reserved, not an ordinary tenant slug", () => {
    expect(resolveTenantSlugFromHost("platform.localhost:3000")).toBe("platform");
    expect(RESERVED_SUBDOMAINS.has("platform")).toBe(true);
  });
});
