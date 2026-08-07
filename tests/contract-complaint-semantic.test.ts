import { describe, expect, it } from "vitest";

import {
  CONTRACT_ACTIVE_SEMANTIC,
  CONTRACT_STATUS_SEMANTICS,
  isContractActiveSemantic,
} from "@/lib/contracts/types";
import {
  COMPLAINT_DONE_SEMANTIC,
  COMPLAINT_STATUS_SEMANTICS,
  isComplaintDoneSemantic,
  isComplaintUnresolved,
} from "@/lib/complaints/types";

describe("contract status semantic helpers", () => {
  it("active 定数と判定", () => {
    expect(CONTRACT_ACTIVE_SEMANTIC).toBe("active");
    expect(CONTRACT_STATUS_SEMANTICS.active).toBe("active");
    expect(isContractActiveSemantic("active")).toBe(true);
    expect(isContractActiveSemantic("expired")).toBe(false);
    expect(isContractActiveSemantic(null)).toBe(false);
  });

  it("日本語表示名比較を使わない", () => {
    expect(isContractActiveSemantic("有効")).toBe(false);
  });
});

describe("complaint status semantic helpers", () => {
  it("unresolved / done 定数と判定", () => {
    expect(COMPLAINT_DONE_SEMANTIC).toBe("done");
    expect(COMPLAINT_STATUS_SEMANTICS.open).toBe("open");
    expect(COMPLAINT_STATUS_SEMANTICS.in_progress).toBe("in_progress");
    expect(isComplaintDoneSemantic("done")).toBe(true);
    expect(isComplaintDoneSemantic("open")).toBe(false);
    expect(isComplaintUnresolved("open")).toBe(true);
    expect(isComplaintUnresolved("in_progress")).toBe(true);
    expect(isComplaintUnresolved("done")).toBe(false);
    expect(isComplaintUnresolved(null)).toBe(true);
  });

  it("日本語表示名比較を使わない", () => {
    expect(isComplaintDoneSemantic("完了")).toBe(false);
    expect(isComplaintUnresolved("未対応")).toBe(true);
  });
});
