import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appUrl, inviteRedirectUrl } from "@/lib/env";

const KEYS = [
  "APP_URL",
  "NEXT_PUBLIC_APP_URL",
  "SITE_URL",
  "NEXT_PUBLIC_SITE_URL",
  "VERCEL_PROJECT_PRODUCTION_URL",
  "VERCEL_URL",
  "NEXT_PUBLIC_VERCEL_URL",
  "VERCEL_ENV",
  "NODE_ENV",
] as const;

const originalEnv = new Map<string, string | undefined>();
const mutableEnv = process.env as Record<string, string | undefined>;

beforeEach(() => {
  for (const key of KEYS) {
    originalEnv.set(key, process.env[key]);
    delete mutableEnv[key];
  }
  mutableEnv.NODE_ENV = "test";
});

afterEach(() => {
  for (const key of KEYS) {
    const value = originalEnv.get(key);
    if (value === undefined) delete mutableEnv[key];
    else mutableEnv[key] = value;
  }
  originalEnv.clear();
});

describe("canonical app URL", () => {
  it("prefers APP_URL and removes trailing slashes", () => {
    process.env.APP_URL = "https://sales.example.com///";
    process.env.NEXT_PUBLIC_APP_URL = "https://ignored.example.com";
    expect(appUrl()).toBe("https://sales.example.com");
  });

  it("keeps the existing NEXT_PUBLIC_APP_URL as an explicit canonical setting", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://sales-system-weld.vercel.app";
    expect(appUrl()).toBe("https://sales-system-weld.vercel.app");
    expect(inviteRedirectUrl()).toBe(
      "https://sales-system-weld.vercel.app/auth/invite",
    );
  });

  it("uses Vercel production URL before deployment-specific VERCEL_URL", () => {
    process.env.VERCEL_ENV = "production";
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "sales.example.com";
    process.env.VERCEL_URL = "sales-abcdef.vercel.app";
    expect(appUrl()).toBe("https://sales.example.com");
  });

  it("uses VERCEL_URL when no canonical setting exists", () => {
    process.env.VERCEL_ENV = "preview";
    process.env.VERCEL_URL = "sales-preview.vercel.app";
    expect(appUrl()).toBe("https://sales-preview.vercel.app");
  });

  it("allows localhost fallback only outside deployments", () => {
    expect(appUrl()).toBe("http://localhost:3000");
  });

  it("rejects missing canonical URL in production", () => {
    process.env.VERCEL_ENV = "production";
    expect(() => appUrl()).toThrow("canonical app URLが未設定");
  });

  it("rejects an explicit localhost URL in production", () => {
    process.env.VERCEL_ENV = "production";
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "sales.example.com";
    expect(() => appUrl()).toThrow("localhostを設定することはできません");
  });
});
