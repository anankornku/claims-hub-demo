import { useEffect, useState } from "react";
import { api, type CanonicalClaim, type Check, type CheckResponse, type Meta } from "../lib/api";

// Canonical fields shown side by side with the raw value they came from.
const FIELD_ROWS: { key: keyof CanonicalClaim; label: string; raw?: string }[] = [
  { key: "serviceDate", label: "Service date", raw: "serviceDateRaw" },
  { key: "cid", label: "National ID (cid)" },
  { key: "doctorLicense", label: "Attending license" },
  { key: "chiefComplaint", label: "Chief complaint" },
  { key: "policyNo", label: "Policy number" },
  { key: "principalDiagnosis", label: "Principal diagnosis (ICD-10)" },
  { key: "claimAmount", label: "Claim amount (THB)" },
];

const FIX_LABELS: Record<string, string> = {
  serviceDate: "Service date (YYYY-MM-DD)",
  cid: "National ID",
  doctorLicense: "Attending license",
  chiefComplaint: "Chief complaint",
  policyNo: "Policy number",
  principalDiagnosis: "Principal diagnosis (ICD-10)",
  claimAmount: "Claim amount (THB)",
};

export default function ClaimDetail({ claimNo, meta, onBack }: { claimNo: string; meta: Meta; onBack: () => void }) {
  const [claim, setClaim] = useState<CanonicalClaim | null>(null);
  const [checks, setChecks] = useState<Check[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [fixes, setFixes] = useState<Record<string, string>>({});
  const [round, setRound] = useState(0);
  const [result, setResult] = useState<CheckResponse | null>(null);
  const [busy, setBusy] = useState(false);

  // Fixes live only in this component's state, so a reload restores the original data.
  useEffect(() => {
    setError(null);
    api.claim(claimNo).then((r) => {
      setClaim(r.claim);
      setChecks(r.checks);
    }).catch((e: Error) => setError(e.message));
  }, [claimNo]);

  const shownChecks = result?.checks ?? checks;
  const failing = shownChecks.filter((c) => !c.ok);
  const status = result?.status;
  const fixable = meta.fixableFields.filter((f) => failing.some((c) => c.field === f));
  const roundsLeft = result?.roundsLeft ?? meta.maxFixRounds;

  async function rerun() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.check(claimNo, fixes, round);
      setResult(r);
      setRound(round + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (error && !claim) return <p role="alert" className="text-sm text-red-700">{error}</p>;
  if (!claim) return <p className="text-sm text-slate-500">Loading claim...</p>;

  return (
    <section aria-label="Claim detail" className="space-y-6">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="text-sm text-indigo-700 underline">Back to claims</button>
        <p className="text-sm text-slate-500">
          {claim.hospitalName} · {claim.visitType} · visit {claim.visitId}
        </p>
      </div>

      <div className="rounded-lg bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <h2 className="text-lg font-semibold text-slate-900">Claim {claim.claimNo}</h2>
        <p className="text-sm text-slate-600">
          {claim.patientName || "Unnamed patient"} · Payer: {claim.payerName ?? <span className="text-red-700">not mapped</span>} · Hospital date format: {claim.rawDateFormat}
        </p>
        {status === "manual_review" && (
          <p className="mt-2 rounded bg-purple-50 p-2 text-sm text-purple-800">Manual review: {result?.manualReason}</p>
        )}
        {!result && claim && (
          <p className="mt-2 text-xs text-slate-500">{meta.dataNotice}</p>
        )}
      </div>

      <div className="rounded-lg bg-white shadow-sm ring-1 ring-slate-200">
        <h3 className="border-b border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700">Canonical value and source value</h3>
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-600">
            <tr>
              <th className="px-4 py-2">Field</th>
              <th className="px-4 py-2">Canonical</th>
              <th className="px-4 py-2">Source (hospital)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {FIELD_ROWS.map((row) => {
              const value = claim[row.key];
              // The service date's source value is kept on the claim itself; the rest sit under raw.
              const raw = row.raw ? claim.serviceDateRaw ?? "" : claim.raw[row.key as string] ?? "";
              return (
                <tr key={row.key}>
                  <td className="px-4 py-2 text-slate-700">{row.label}</td>
                  <td className="px-4 py-2 font-mono text-xs">{value === null || value === undefined || value === "" ? <span className="text-red-700">empty</span> : String(value)}</td>
                  <td className="px-4 py-2 font-mono text-xs text-slate-500">{raw === "" ? "-" : String(raw)}</td>
                </tr>
              );
            })}
            <tr>
              <td className="px-4 py-2 text-slate-700">Charge items total (THB)</td>
              <td className="px-4 py-2 font-mono text-xs">{claim.chargeTotal.toFixed(2)}</td>
              <td className="px-4 py-2 text-xs text-slate-500">sum of charge lines</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="rounded-lg bg-white shadow-sm ring-1 ring-slate-200">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2">
          <h3 className="text-sm font-semibold text-slate-700">Checks</h3>
          <span className="text-xs text-slate-500">
            {result ? `Round ${round} of ${meta.maxFixRounds} · ${roundsLeft} left` : `Before fixes · up to ${meta.maxFixRounds} fix rounds`}
          </span>
        </div>
        <ul className="divide-y divide-slate-100">
          {shownChecks.map((c) => (
            <li key={c.id} className="flex items-start gap-3 px-4 py-2 text-sm">
              <span className={`mt-0.5 w-12 shrink-0 text-center text-xs font-semibold ${c.ok ? "text-emerald-700" : "text-red-700"}`}>{c.ok ? "ok" : "fail"}</span>
              <span className="flex-1">
                <span className="text-slate-800">{c.label}</span>
                <span className="block text-xs text-slate-500">{c.message}</span>
              </span>
              {c.reasonCode && <span className="font-mono text-xs text-slate-500">{c.reasonCode}</span>}
            </li>
          ))}
        </ul>
        {shownChecks.length === 0 && <p className="px-4 py-3 text-sm text-slate-500">No checks ran for this claim.</p>}
      </div>

      {fixable.length > 0 && status !== "manual_review" && (
        <div className="rounded-lg bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <h3 className="mb-3 text-sm font-semibold text-slate-700">Enter fixes, then re-run checks</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {fixable.map((field) => (
              <label key={field} className="text-sm text-slate-700">
                {FIX_LABELS[field] ?? field}
                <input
                  aria-label={FIX_LABELS[field] ?? field}
                  value={fixes[field] ?? ""}
                  onChange={(e) => setFixes({ ...fixes, [field]: e.target.value })}
                  className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1 font-mono text-sm"
                />
              </label>
            ))}
          </div>
          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={rerun}
              disabled={busy || (result !== null && roundsLeft <= 0)}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {busy ? "Checking..." : "Re-run checks"}
            </button>
            {result?.status === "ready" && <span className="text-sm font-medium text-emerald-700">Ready to submit (demo only, nothing is sent)</span>}
            {result?.status === "needs_fix" && <span className="text-sm text-amber-700">Still failing. Fix again.</span>}
          </div>
        </div>
      )}
      {status === "manual_review" && <p className="text-sm text-purple-800">Sent to manual review. No further fix rounds.</p>}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    </section>
  );
}
