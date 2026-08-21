import { describe, expect, it } from "vitest";
import { checkLoginAttempt, recordFailedLogin, clearLoginAttempts } from "../src/auth/login-rate-limit";

describe("login rate limiting", () => {
  it("allows attempts until the failure threshold, then locks out", () => {
    const key = "tenant-1:locked-out@demo.com";
    for (let i = 0; i < 5; i++) {
      expect(checkLoginAttempt(key).ok).toBe(true);
      recordFailedLogin(key);
    }
    const blocked = checkLoginAttempt(key);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("clearing attempts (a successful login) resets the lockout", () => {
    const key = "tenant-1:recovers@demo.com";
    for (let i = 0; i < 5; i++) recordFailedLogin(key);
    expect(checkLoginAttempt(key).ok).toBe(false);

    clearLoginAttempts(key);
    expect(checkLoginAttempt(key).ok).toBe(true);
  });

  it("keys are independent — failures on one key don't lock out another", () => {
    const key = "tenant-1:isolated-a@demo.com";
    for (let i = 0; i < 5; i++) recordFailedLogin(key);
    expect(checkLoginAttempt(key).ok).toBe(false);
    expect(checkLoginAttempt("tenant-1:isolated-b@demo.com").ok).toBe(true);
  });
});
