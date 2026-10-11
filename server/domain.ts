// Pure domain logic: date and amount parsing, rule selection, and the checks.
// No database or HTTP code here, so every rule can be unit tested.

/** Pattern a hospital sends dates in. */
export type DatePattern = "YYYYMMDD" | "DD/MM/YYYY" | "YYYY-MM-DD";
/** BE = Buddhist calendar (พ.ศ.), CE = Christian calendar (ค.ศ.). */
export type Calendar = "BE" | "CE";

/** Splits a hospitals.date_format value such as "YYYY-MM-DD (พ.ศ.)" into pattern and calendar. */
export function parseDateFormat(dateFormat: string): { pattern: DatePattern; calendar: Calendar } {
  const pattern = dateFormat.split(" ")[0] as DatePattern;
  return { pattern, calendar: dateFormat.includes("พ.ศ.") ? "BE" : "CE" };
}

export type PayerRule = {
  payerId: string;
  ruleType: string;
  ruleValue: string;
  effectiveFrom: string; // ISO date
  ruleVersion: string;
};

export type CheckResult = {
  id: string;
  label: string;
  ok: boolean;
  field?: string;
  reasonCode?: string;
  message: string;
};

export const MAX_FIX_ROUNDS = 3;

// Canonical field name used in payer rules -> field on the canonical claim.
export const RULE_FIELD_MAP: Record<string, string> = {
  "patient.nationalId": "cid",
  "encounter.attendingLicense": "doctorLicense",
  "diagnosis.principal": "principalDiagnosis",
  "encounter.hcode": "hcode",
  "encounter.chiefComplaint": "chiefComplaint",
  "insurance.policyNumber": "policyNo",
};

/**
 * Converts a raw date from one hospital to ISO (YYYY-MM-DD).
 * Buddhist years (พ.ศ.) are converted by subtracting 543.
 * Two-digit years and anything that does not match the declared format return null.
 */
export function convertDate(raw: string | null | undefined, pattern: DatePattern, calendar: Calendar): string | null {
  if (!raw) return null;
  const value = raw.trim();
  let year: number;
  let month: number;
  let day: number;

  if (pattern === "YYYYMMDD") {
    const m = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
    if (!m) return null;
    [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  } else if (pattern === "DD/MM/YYYY") {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
    if (!m) return null;
    [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  } else {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!m) return null;
    [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  }

  if (calendar === "BE") year -= 543;
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    return null;
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Parses an amount such as "11,925.00". Returns null when it is blank or not a number. */
export function parseAmount(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  const cleaned = raw.replace(/,/g, "").trim();
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Rules in force for a payer on a service date. For each rule type, take the rows of
 * the newest effective_from that is on or before the service date.
 */
export function rulesInForce(rules: PayerRule[], payerId: string, serviceDate: string): PayerRule[] {
  const forPayer = rules.filter((r) => r.payerId === payerId && r.effectiveFrom <= serviceDate);
  const newest = new Map<string, string>();
  for (const r of forPayer) {
    const current = newest.get(r.ruleType);
    if (!current || r.effectiveFrom > current) newest.set(r.ruleType, r.effectiveFrom);
  }
  return forPayer.filter((r) => r.effectiveFrom === newest.get(r.ruleType));
}

export type ClaimForCheck = {
  payerId: string | null;
  serviceDate: string | null;
  serviceDateRaw: string | null;
  cid: string | null;
  doctorLicense: string | null;
  chiefComplaint: string | null;
  policyNo: string | null;
  principalDiagnosis: string | null;
  diagnoses: string[];
  procedures: string[];
  drugCodes: string[];
  serviceCodes: string[];
  claimAmount: number | null;
  chargeTotal: number;
};

export type ReferenceSets = {
  icd10: Set<string>;
  icd9cm: Set<string>;
  drugs: Set<string>;
  services: Set<string>;
};

const blank = (v: string | null | undefined) => v === null || v === undefined || v.trim() === "";

/**
 * Runs every check for one claim. Returns the results and whether the claim
 * needs manual review (no payer, no date, or no rule in force).
 */
export function runChecks(
  claim: ClaimForCheck,
  rules: PayerRule[],
  refs: ReferenceSets,
): { checks: CheckResult[]; manualReview: boolean; manualReason?: string } {
  const checks: CheckResult[] = [];

  if (!claim.payerId) {
    return { checks, manualReview: true, manualReason: "Hospital payer code is not mapped" };
  }
  if (!claim.serviceDate) {
    checks.push({
      id: "service-date",
      label: "Service date readable",
      ok: false,
      field: "serviceDate",
      reasonCode: "R01",
      message: `Date "${claim.serviceDateRaw ?? ""}" is not in the hospital's format`,
    });
    return { checks, manualReview: true, manualReason: "Service date is not readable" };
  }

  const active = rulesInForce(rules, claim.payerId, claim.serviceDate);
  if (active.length === 0) {
    return { checks, manualReview: true, manualReason: "No payer rule in force on the service date" };
  }

  for (const rule of active.filter((r) => r.ruleType === "required_field")) {
    const field = RULE_FIELD_MAP[rule.ruleValue];
    const value = field ? (claim as unknown as Record<string, unknown>)[field] : undefined;
    const empty = value === undefined || value === null || (typeof value === "string" && blank(value));
    checks.push({
      id: `required:${rule.ruleValue}`,
      label: `Required field ${rule.ruleValue}`,
      ok: !empty,
      field: field ?? rule.ruleValue,
      reasonCode: empty ? "R02" : undefined,
      message: empty ? `${rule.ruleValue} is empty` : `${rule.ruleValue} is filled`,
    });
  }

  const codeChecks: [string, string[], Set<string>, string][] = [
    ["icd10", claim.diagnoses, refs.icd10, "R04"],
    ["icd9cm", claim.procedures, refs.icd9cm, "R04"],
    ["drug", claim.drugCodes, refs.drugs, "R05"],
  ];
  for (const [kind, codes, ref, reason] of codeChecks) {
    for (const code of new Set(codes)) {
      const ok = ref.has(code);
      checks.push({
        id: `${kind}:${code}`,
        label: `${kind} code ${code}`,
        ok,
        field: kind === "icd10" ? "principalDiagnosis" : undefined,
        reasonCode: ok ? undefined : reason,
        message: ok ? `${code} is in the reference table` : `${code} is not in the demo reference table`,
      });
    }
  }
  for (const code of new Set(claim.serviceCodes)) {
    const ok = refs.services.has(code);
    checks.push({
      id: `service:${code}`,
      label: `service code ${code}`,
      ok,
      message: ok ? `${code} is in the reference table` : `${code} is not in the demo reference table`,
    });
  }

  const amountOk = claim.claimAmount !== null && Math.abs(claim.claimAmount - claim.chargeTotal) < 0.005;
  checks.push({
    id: "amount-total",
    label: "Claim total matches charge items",
    ok: amountOk,
    field: "claimAmount",
    reasonCode: amountOk ? undefined : "R03",
    message: claim.claimAmount === null
      ? "Claim amount is missing or not a number"
      : amountOk
        ? `Total ${claim.claimAmount.toFixed(2)} matches the charge items`
        : `Claim ${claim.claimAmount.toFixed(2)} differs from charge items ${claim.chargeTotal.toFixed(2)}`,
  });

  return { checks, manualReview: false };
}

/**
 * Applies fixes entered by the user to a copy of the claim. Only the fields
 * listed here can be changed by a fix.
 */
export const FIXABLE_FIELDS = [
  "serviceDate",
  "cid",
  "doctorLicense",
  "chiefComplaint",
  "policyNo",
  "principalDiagnosis",
  "claimAmount",
] as const;
export type FixableField = (typeof FIXABLE_FIELDS)[number];

export function applyFixes(claim: ClaimForCheck, fixes: Partial<Record<FixableField, string>>): ClaimForCheck {
  const next: ClaimForCheck = { ...claim };
  for (const field of FIXABLE_FIELDS) {
    const value = fixes[field];
    if (value === undefined) continue;
    if (field === "claimAmount") {
      next.claimAmount = parseAmount(value);
    } else if (field === "serviceDate") {
      next.serviceDate = value.trim() || null;
    } else {
      (next as unknown as Record<string, unknown>)[field] = value.trim() || null;
    }
  }
  return next;
}

/**
 * Status after one check. `roundsUsed` counts the re-runs done so far, including this one.
 * A claim that still fails after MAX_FIX_ROUNDS re-runs goes to manual review.
 */
export function fixStatus(
  checks: CheckResult[],
  manualReview: boolean,
  roundsUsed: number,
): "ready" | "needs_fix" | "manual_review" {
  if (manualReview) return "manual_review";
  if (checks.every((c) => c.ok)) return "ready";
  return roundsUsed >= MAX_FIX_ROUNDS ? "manual_review" : "needs_fix";
}
