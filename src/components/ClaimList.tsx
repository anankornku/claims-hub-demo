import { useEffect, useState } from "react";
import { api, type ClaimSummary, type Meta } from "../lib/api";

export default function ClaimList({ meta, onOpen }: { meta: Meta; onOpen: (claimNo: string) => void }) {
  const [hcode, setHcode] = useState("");
  const [payer, setPayer] = useState("");
  const [rows, setRows] = useState<ClaimSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.claims(hcode, payer).then((r) => {
      setRows(r.claims);
      setTotal(r.total);
    }).finally(() => setLoading(false));
  }, [hcode, payer]);

  return (
    <section aria-label="Claim list">
      <div className="mb-4 flex flex-wrap gap-3">
        <label className="text-sm text-slate-700">
          Hospital{" "}
          <select aria-label="Filter by hospital" value={hcode} onChange={(e) => setHcode(e.target.value)} className="ml-1 rounded-md border border-slate-300 bg-white px-2 py-1">
            <option value="">All hospitals</option>
            {meta.hospitals.map((h) => <option key={h.hcode} value={h.hcode}>{h.name}</option>)}
          </select>
        </label>
        <label className="text-sm text-slate-700">
          Payer{" "}
          <select aria-label="Filter by payer" value={payer} onChange={(e) => setPayer(e.target.value)} className="ml-1 rounded-md border border-slate-300 bg-white px-2 py-1">
            <option value="">All payers</option>
            {meta.payers.map((p) => <option key={p.payerId} value={p.payerId}>{p.name}</option>)}
          </select>
        </label>
        <span className="self-center text-sm text-slate-500">{loading ? "Loading..." : `${total} claims`}</span>
      </div>

      <div className="overflow-x-auto rounded-lg bg-white shadow-sm ring-1 ring-slate-200">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-slate-600">
            <tr>
              <th className="px-3 py-2">Claim</th>
              <th className="px-3 py-2">Hospital</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Service date</th>
              <th className="px-3 py-2">Payer</th>
              <th className="px-3 py-2 text-right">Amount (THB)</th>
              <th className="px-3 py-2">Checks</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((c) => (
              <tr key={c.claimNo} className="cursor-pointer hover:bg-slate-50" onClick={() => onOpen(c.claimNo)}>
                <td className="px-3 py-2 font-mono text-xs"><button className="text-indigo-700 underline" onClick={(e) => { e.stopPropagation(); onOpen(c.claimNo); }}>{c.claimNo}</button></td>
                <td className="px-3 py-2">{c.hospitalName}</td>
                <td className="px-3 py-2">{c.visitType}</td>
                <td className="px-3 py-2">{c.serviceDate ?? <span className="text-red-700">unreadable</span>}</td>
                <td className="px-3 py-2">{c.payerName ?? <span className="text-red-700">unmapped</span>}</td>
                <td className="px-3 py-2 text-right tabular-nums">{c.claimAmount === null ? "-" : c.claimAmount.toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
                <td className="px-3 py-2">
                  {c.manualReview ? (
                    <span className="rounded bg-purple-100 px-2 py-0.5 text-xs text-purple-800">manual review</span>
                  ) : c.failedChecks === 0 ? (
                    <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">ready</span>
                  ) : (
                    <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">{c.failedChecks} to fix</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
