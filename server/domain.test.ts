import { describe, expect, it } from "vitest";
import {
  applyFixes,
  convertDate,
  fixStatus,
  MAX_FIX_ROUNDS,
  parseAmount,
  parseDateFormat,
  rulesInForce,
  runChecks,
  type ClaimForCheck,
  type PayerRule,
  type ReferenceSets,
} from "./domain.js";

const refs: ReferenceSets = {
  icd10: new Set(["J06.9", "K35.8"]),
  icd9cm: new Set(["45.13"]),
  drugs: new Set(["D001"]),
  services: new Set(["S001"]),
};

const rules: PayerRule[] = [
  { payerId: "NHSO-UCS", ruleType: "required_field", ruleValue: "patient.nationalId", effectiveFrom: "2026-01-01", ruleVersion: "v1" },
  { payerId: "NHSO-UCS", ruleType: "required_field", ruleValue: "diagnosis.principal", effectiveFrom: "2026-01-01", ruleVersion: "v1" },
  { payerId: "PRV-TSA", ruleType: "required_field", ruleValue: "insurance.policyNumber", effectiveFrom: "2026-01-01", ruleVersion: "v1" },
  { payerId: "PRV-TSA", ruleType: "required_field", ruleValue: "encounter.chiefComplaint", effectiveFrom: "2026-09-15", ruleVersion: "v2" },
  { payerId: "PRV-TSA", ruleType: "opd_limit_per_visit_thb", ruleValue: "3000", effectiveFrom: "2026-01-01", ruleVersion: "v1" },
];

function claim(overrides: Partial<ClaimForCheck> = {}): ClaimForCheck {
  return {
    payerId: "NHSO-UCS",
    serviceDate: "2026-08-01",
    serviceDateRaw: "25690801",
    cid: "1234567890123",
    doctorLicense: "12345",
    chiefComplaint: "fever",
    policyNo: null,
    principalDiagnosis: "J06.9",
    diagnoses: ["J06.9"],
    procedures: [],
    drugCodes: ["D001"],
    serviceCodes: ["S001"],
    claimAmount: 500,
    chargeTotal: 500,
    ...overrides,
  };
}

describe("convertDate", () => {
  it("converts YYYYMMDD with a Buddhist year", () => {
    expect(convertDate("25690802", "YYYYMMDD", "BE")).toBe("2026-08-02");
  });
  it("converts DD/MM/YYYY with a Buddhist year", () => {
    expect(convertDate("25/09/2569", "DD/MM/YYYY", "BE")).toBe("2026-09-25");
  });
  it("converts YYYY-MM-DD with a Buddhist year", () => {
    expect(convertDate("2569-09-19", "YYYY-MM-DD", "BE")).toBe("2026-09-19");
  });
  it("keeps a Christian year unchanged", () => {
    expect(convertDate("2026-08-29", "YYYY-MM-DD", "CE")).toBe("2026-08-29");
  });
  it("returns null for a two-digit year instead of guessing", () => {
    expect(convertDate("69-08-01", "YYYY-MM-DD", "BE")).toBeNull();
    expect(convertDate("690802", "YYYYMMDD", "BE")).toBeNull();
    expect(convertDate("25/09/69", "DD/MM/YYYY", "BE")).toBeNull();
  });
  it("rejects a date that does not exist", () => {
    expect(convertDate("2569-02-30", "YYYY-MM-DD", "BE")).toBeNull();
  });
  it("reads the calendar from the hospital's date format", () => {
    expect(parseDateFormat("YYYY-MM-DD (พ.ศ.)")).toEqual({ pattern: "YYYY-MM-DD", calendar: "BE" });
    expect(parseDateFormat("YYYY-MM-DD (ค.ศ.)")).toEqual({ pattern: "YYYY-MM-DD", calendar: "CE" });
  });
});

describe("parseAmount", () => {
  it("parses comma-separated amounts", () => {
    expect(parseAmount("11,925.00")).toBe(11925);
  });
  it("returns null for blank or non-numeric input", () => {
    expect(parseAmount("")).toBeNull();
    expect(parseAmount(null)).toBeNull();
    expect(parseAmount("abc")).toBeNull();
  });
});

describe("rulesInForce", () => {
  it("uses the newest version on or before the service date", () => {
    const before = rulesInForce(rules, "PRV-TSA", "2026-08-01").filter((r) => r.ruleType === "required_field");
    expect(before.map((r) => r.ruleValue)).toEqual(["insurance.policyNumber"]);
    const after = rulesInForce(rules, "PRV-TSA", "2026-10-01").filter((r) => r.ruleType === "required_field");
    expect(after.map((r) => r.ruleValue)).toEqual(["encounter.chiefComplaint"]);
  });
  it("returns nothing before the first effective date", () => {
    expect(rulesInForce(rules, "NHSO-UCS", "2025-12-31")).toEqual([]);
  });
});

describe("runChecks", () => {
  it("passes a complete claim", () => {
    const r = runChecks(claim(), rules, refs);
    expect(r.manualReview).toBe(false);
    expect(r.checks.every((c) => c.ok)).toBe(true);
  });
  it("fails a missing required field with reason R02", () => {
    const r = runChecks(claim({ principalDiagnosis: null }), rules, refs);
    const failed = r.checks.find((c) => c.id === "required:diagnosis.principal");
    expect(failed?.ok).toBe(false);
    expect(failed?.reasonCode).toBe("R02");
    expect(failed?.field).toBe("principalDiagnosis");
  });
  it("fails an unknown ICD-10 code with reason R04", () => {
    const r = runChecks(claim({ diagnoses: ["J06.9", "X99"] }), rules, refs);
    expect(r.checks.find((c) => c.id === "icd10:X99")?.reasonCode).toBe("R04");
  });
  it("fails an amount that differs from the charge items with reason R03", () => {
    const r = runChecks(claim({ claimAmount: 600 }), rules, refs);
    expect(r.checks.find((c) => c.id === "amount-total")?.reasonCode).toBe("R03");
  });
  it("sends a claim with no payer to manual review", () => {
    const r = runChecks(claim({ payerId: null }), rules, refs);
    expect(r.manualReview).toBe(true);
  });
  it("sends a claim with an unreadable date to manual review", () => {
    const r = runChecks(claim({ serviceDate: null }), rules, refs);
    expect(r.manualReview).toBe(true);
    expect(r.checks[0].reasonCode).toBe("R01");
  });
  it("sends a claim before the first rule to manual review", () => {
    const r = runChecks(claim({ serviceDate: "2025-06-01" }), rules, refs);
    expect(r.manualReview).toBe(true);
    expect(r.manualReason).toMatch(/No payer rule/);
  });
});

describe("applyFixes", () => {
  it("changes only fixable fields", () => {
    const fixed = applyFixes(claim({ principalDiagnosis: null }), { principalDiagnosis: "K35.8", chargeTotal: "999" } as never);
    expect(fixed.principalDiagnosis).toBe("K35.8");
    expect(fixed.chargeTotal).toBe(500);
  });
  it("parses a fixed claim amount", () => {
    expect(applyFixes(claim(), { claimAmount: "1,000.50" }).claimAmount).toBe(1000.5);
  });
});

describe("fixStatus", () => {
  const failing = [{ id: "x", label: "x", ok: false, message: "" }];
  it("is ready when every check passes", () => {
    expect(fixStatus([{ id: "x", label: "x", ok: true, message: "" }], false, 1)).toBe("ready");
  });
  it("asks for another fix while rounds remain", () => {
    expect(fixStatus(failing, false, 1)).toBe("needs_fix");
  });
  it("goes to manual review after the last round", () => {
    expect(fixStatus(failing, false, MAX_FIX_ROUNDS)).toBe("manual_review");
  });
});
