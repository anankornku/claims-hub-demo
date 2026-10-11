import { useEffect, useState } from "react";
import { api, type RejectRow } from "../lib/api";

export default function RejectHistory() {
  const [rows, setRows] = useState<RejectRow[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.rejects().then((r) => {
      setRows(r.reasons);
      setTotal(r.totalSubmissions);
    }).catch((e: Error) => setError(e.message));
  }, []);

  const max = Math.max(1, ...rows.map((r) => r.count));

  return (
    <section aria-label="Reject history" className="space-y-4">
      <p className="text-sm text-slate-600">{total} payer submissions. Counts are by reason code, most frequent first.</p>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <ul className="divide-y divide-slate-200 rounded-lg bg-white shadow-sm ring-1 ring-slate-200">
        {rows.map((r) => (
          <li key={r.reasonCode} className="px-4 py-3">
            <div className="flex items-center justify-between text-sm">
              <span><span className="font-mono text-xs text-slate-500">{r.reasonCode}</span> {r.description}</span>
              <span className="tabular-nums text-slate-700">{r.count}</span>
            </div>
            <div className="mt-2 h-2 rounded bg-slate-100">
              <div className="h-2 rounded bg-indigo-500" style={{ width: `${(r.count / max) * 100}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
