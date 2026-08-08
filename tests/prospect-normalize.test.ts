import { describe, expect, it } from "vitest";

import { normalizeDomain } from "@/lib/normalize/domain";
import {
  computeSourceRowHash,
  filterSourceAttributes,
  normalizeProspectCore,
  stagedToNormalized,
} from "@/lib/prospects/normalize";
import {
  suggestProspectMapping,
  unmappedHeaders,
} from "@/lib/prospects/import-mapping";

describe("normalizeDomain", () => {
  it("URL / www / email から hostname", () => {
    expect(normalizeDomain("https://www.Example.com/path")).toBe("example.com");
    expect(normalizeDomain("WWW.FOO.jp")).toBe("foo.jp");
    expect(normalizeDomain("info@Bar.co.jp")).toBe("bar.co.jp");
  });

  it("不正は null", () => {
    expect(normalizeDomain("")).toBeNull();
    expect(normalizeDomain("not a host")).toBeNull();
  });
});

describe("prospect normalize / hash", () => {
  it("company normalize keeps corp form variants searchable", () => {
    const a = normalizeProspectCore({ companyName: "株式会社テスト" });
    const b = normalizeProspectCore({ companyName: "(株)テスト" });
    expect(a.normalizedCompanyName).toBeTruthy();
    expect(a.normalizedCompanyName).toBe(b.normalizedCompanyName);
  });

  it("source_attributes blocks secrets", () => {
    const filtered = filterSourceAttributes({
      施設種別: "介護",
      api_key: "secret",
      password: "x",
      note: "ok",
    });
    expect(filtered["施設種別"]).toBe("介護");
    expect(filtered.note).toBe("ok");
    expect(filtered.api_key).toBeUndefined();
    expect(filtered.password).toBeUndefined();
  });

  it("source_row_hash is stable and uses external id when present", () => {
    const h1 = computeSourceRowHash({
      companyName: "株式会社ABC",
      normalizedDomain: "abc.example",
      normalizedPhone: "0312345678",
      contactEmail: null,
      externalRecordId: "EXT-1",
      websiteUrl: null,
      address: null,
    });
    const h2 = computeSourceRowHash({
      companyName: "別名義",
      normalizedDomain: null,
      normalizedPhone: null,
      contactEmail: null,
      externalRecordId: "EXT-1",
      websiteUrl: null,
      address: null,
    });
    expect(h1).toBe(h2);
  });

  it("stagedToNormalized fills contact email normalize", () => {
    const out = stagedToNormalized({
      companyName: "テスト会社",
      websiteUrl: "https://www.test.example",
      domain: null,
      mainPhone: "03-1234-5678",
      postalCode: null,
      prefecture: "東京都",
      city: "港区",
      address: null,
      industry: null,
      employeeRange: null,
      contactName: "山田",
      contactDepartment: null,
      contactTitle: null,
      contactEmail: "  Foo@Test.Example ",
      contactPhone: null,
      externalRecordId: null,
      notes: null,
      sourceAttributes: { ブース: "A-1" },
    });
    expect(out.core.normalizedDomain).toBe("test.example");
    expect(out.contact.normalizedEmail).toBe("foo@test.example");
    expect(out.sourceAttributes["ブース"]).toBe("A-1");
  });
});

describe("prospect CSV mapping", () => {
  it("suggests companyName and keeps unmapped", () => {
    const headers = ["会社名", "電話番号", "ブース番号", "Webサイト"];
    const mapping = suggestProspectMapping(headers);
    expect(mapping.companyName).toBe("会社名");
    expect(mapping.mainPhone).toBe("電話番号");
    expect(mapping.websiteUrl).toBe("Webサイト");
    expect(unmappedHeaders(headers, mapping)).toContain("ブース番号");
  });
});
