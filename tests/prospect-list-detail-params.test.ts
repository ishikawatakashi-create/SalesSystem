import { describe, expect, it } from "vitest";

import {
  buildProspectListDetailHref,
  parseProspectListKpiPeriod,
  parseProspectListPage,
  resolveProspectAssignmentFilter,
} from "@/lib/prospects/list-detail-params";

describe("prospect list detail query state", () => {
  it.each(["today", "7d", "30d", "all"] as const)(
    "accepts the supported KPI period %s",
    (period) => {
      expect(parseProspectListKpiPeriod(period)).toBe(period);
    },
  );

  it.each([undefined, null, "", "week", "TODAY"])(
    "falls back to 30d for an unsupported KPI period",
    (period) => {
      expect(parseProspectListKpiPeriod(period)).toBe("30d");
    },
  );

  it.each([
    [undefined, 1],
    ["", 1],
    ["0", 1],
    ["-1", 1],
    ["1.5", 1],
    ["Infinity", 1],
    ["9007199254740992", 1],
    ["2", 2],
  ])("normalizes page=%s to a positive safe integer", (raw, expected) => {
    expect(parseProspectListPage(raw)).toBe(expected);
  });

  it("gives unassigned-only precedence over a conflicting assignee URL", () => {
    expect(
      resolveProspectAssignmentFilter({
        assignedUserId: " user-1 ",
        unassignedOnly: true,
      }),
    ).toEqual({ assignedUserId: null, unassignedOnly: true });
  });

  it("keeps the selected assignee when unassigned-only is off", () => {
    expect(
      resolveProspectAssignmentFilter({
        assignedUserId: " user-1 ",
        unassignedOnly: false,
      }),
    ).toEqual({ assignedUserId: "user-1", unassignedOnly: false });
  });

  it("updates KPI while retaining the other filters", () => {
    const href = buildProspectListDetailHref(
      {
        q: "東京",
        stage: "working",
        prefecture: "東京都",
        assigned: "user-1",
        page: "3",
      },
      { kpi: "7d" },
    );
    const params = new URLSearchParams(href.slice(1));

    expect(Object.fromEntries(params)).toEqual({
      q: "東京",
      stage: "working",
      prefecture: "東京都",
      assigned: "user-1",
      page: "3",
      kpi: "7d",
    });
  });

  it("can remove the conflicting assignee while retaining other filters", () => {
    const href = buildProspectListDetailHref(
      { q: "東京", assigned: "user-1", unassigned: "1" },
      { assigned: null, unassigned: "1", kpi: "30d" },
    );
    const params = new URLSearchParams(href.slice(1));

    expect(params.get("assigned")).toBeNull();
    expect(params.get("unassigned")).toBe("1");
    expect(params.get("q")).toBe("東京");
    expect(params.get("kpi")).toBe("30d");
  });
});
