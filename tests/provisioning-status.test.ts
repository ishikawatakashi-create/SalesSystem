import { describe, expect, it } from "vitest";
import { isUsableProvisioningStatus } from "@/lib/auth/provisioning-status";

describe("認証スパイク中のprovisioning_status", () => {
  it("profile_createdとcompletedだけを利用可能にする", () => {
    expect(isUsableProvisioningStatus("profile_created")).toBe(true);
    expect(isUsableProvisioningStatus("completed")).toBe(true);
    expect(isUsableProvisioningStatus("pending")).toBe(false);
    expect(isUsableProvisioningStatus("auth_created")).toBe(false);
    expect(isUsableProvisioningStatus("failed")).toBe(false);
  });
});
