import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createManagerSessionToken,
  isManagerPasswordCorrect,
  isValidManagerSessionToken,
  MANAGER_SESSION_MAX_AGE_SECONDS,
} from "@/lib/server/managerAuth";

describe("isManagerPasswordCorrect", () => {
  it("accepts the correct password", () => {
    expect(isManagerPasswordCorrect("33199666")).toBe(true);
  });

  it("rejects a wrong password", () => {
    expect(isManagerPasswordCorrect("00000000")).toBe(false);
  });

  it("rejects an empty or missing password without throwing", () => {
    expect(isManagerPasswordCorrect("")).toBe(false);
    expect(isManagerPasswordCorrect(undefined as unknown as string)).toBe(false);
  });

  it("rejects a password that only shares a prefix (no length-based short-circuit leak)", () => {
    expect(isManagerPasswordCorrect("3319966")).toBe(false);
    expect(isManagerPasswordCorrect("331996660")).toBe(false);
  });
});

describe("manager session token", () => {
  it("issues a token that verifies as valid immediately", () => {
    const token = createManagerSessionToken();
    expect(isValidManagerSessionToken(token)).toBe(true);
  });

  it("rejects a missing token", () => {
    expect(isValidManagerSessionToken(undefined)).toBe(false);
    expect(isValidManagerSessionToken(null)).toBe(false);
    expect(isValidManagerSessionToken("")).toBe(false);
  });

  it("rejects a malformed token", () => {
    expect(isValidManagerSessionToken("not-a-real-token")).toBe(false);
    expect(isValidManagerSessionToken("onlyonepart")).toBe(false);
  });

  it("rejects a token with a tampered payload", () => {
    const token = createManagerSessionToken();
    const [, signature] = token.split(".");
    const farFuture = String(Date.now() + 1000 * 60 * 60 * 24 * 365);
    expect(isValidManagerSessionToken(`${farFuture}.${signature}`)).toBe(false);
  });

  it("rejects a token with a tampered signature", () => {
    const token = createManagerSessionToken();
    const [payload] = token.split(".");
    expect(isValidManagerSessionToken(`${payload}.0000000000000000000000000000000000000000000000000000000000000000`)).toBe(
      false
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects a genuinely-issued token once its expiry has passed", () => {
    const token = createManagerSessionToken();
    expect(isValidManagerSessionToken(token)).toBe(true);

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + (MANAGER_SESSION_MAX_AGE_SECONDS + 60) * 1000);
    expect(isValidManagerSessionToken(token)).toBe(false);
  });
});
