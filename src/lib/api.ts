// Thin client for the demo API. All calls are read-only except the check call,
// which validates fixes in memory on the server and writes nothing.

export type Check = {
  id: string;
  label: string;
  ok: boolean;
  field?: string;
  reasonCode?: string;
  message: string;
};

export type ClaimSummary = {
  claimNo: string;
  hcode: string;
  hospitalName: string;
  visitType: string;
  serviceDate: string | null;
  payerId: string | null;
  payerName: string | null;
  claimAmount: number | null;
  claimStatus: string;
  failedChecks: number;
  manualReview: boolean;
};

export type CanonicalClaim = {
  claimNo: string;
  visitId: string;
  visitType: string;
  hcode: string;
  hospitalName: string;
  hn: string;
  patientName: string;
  sex: string | null;
  payerId: string | null;
  payerName: string | null;
  serviceDate: string | null;
  serviceDateRaw: string | null;
  admitDate: string | null;
  dischargeDate: string | null;
  cid: string | null;
  doctorLicense: string | null;
  chiefComplaint: string | null;
  policyNo: string | null;
  principalDiagnosis: string | null;
  diagnoses: string[];
  procedures: string[];
  claimAmount: number | null;
  chargeTotal: number;
  claimStatus: string;
  raw: Record<string, string | null>;
  rawDateFormat: string;
};

export type Meta = {
  dataNotice: string;
  dataAsOf: string;
  maxFixRounds: number;
  fixableFields: string[];
  hospitals: { hcode: string; name: string; dateFormat: string }[];
  payers: { payerId: string; name: string; scheme: string }[];
};

export type CheckResponse = {
  status: "ready" | "needs_fix" | "manual_review";
  roundsLeft: number;
  manualReason: string | null;
  checks: Check[];
  values: { serviceDate: string | null; claimAmount: number | null; chargeTotal: number };
};

export type RejectRow = { reasonCode: string; description: string; count: number };

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export const api = {
  meta: () => getJson<Meta>("/api/meta"),
  claims: (hcode: string, payer: string) => {
    const q = new URLSearchParams();
    if (hcode) q.set("hcode", hcode);
    if (payer) q.set("payer", payer);
    return getJson<{ total: number; claims: ClaimSummary[] }>(`/api/claims?${q.toString()}`);
  },
  claim: (claimNo: string) =>
    getJson<{ claim: CanonicalClaim; checks: Check[]; manualReview: boolean; manualReason: string | null }>(
      `/api/claims/${encodeURIComponent(claimNo)}`,
    ),
  check: async (claimNo: string, fixes: Record<string, string>, round: number): Promise<CheckResponse> => {
    const res = await fetch(`/api/claims/${encodeURIComponent(claimNo)}/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fixes, round }),
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.json() as Promise<CheckResponse>;
  },
  rejects: () =>
    getJson<{ totalSubmissions: number; reasons: RejectRow[] }>("/api/rejects"),
};
