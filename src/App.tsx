import { useEffect, useState } from "react";
import { api, type Meta } from "./lib/api";
import ClaimList from "./components/ClaimList";
import ClaimDetail from "./components/ClaimDetail";
import RejectHistory from "./components/RejectHistory";

type Tab = "claims" | "rejects";

export default function App() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [tab, setTab] = useState<Tab>("claims");
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.meta().then(setMeta).catch((e: Error) => setError(e.message));
  }, []);

  return (
    <div className="min-h-screen">
      <header className="border-b border-amber-300 bg-amber-50">
        <div className="mx-auto max-w-6xl px-4 py-3 text-sm text-amber-900">
          <p data-testid="data-notice">{meta?.dataNotice ?? "Loading data notice..."}</p>
          <p className="text-xs text-amber-800">Data as of {meta?.dataAsOf ?? "-"}</p>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4">
        <div className="flex items-center justify-between py-6">
          <h1 className="text-2xl font-semibold text-slate-900">Claims Hub Demo</h1>
          <nav className="flex gap-2" aria-label="Main">
            <button
              onClick={() => { setTab("claims"); setSelected(null); }}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${tab === "claims" ? "bg-slate-900 text-white" : "bg-white text-slate-700 ring-1 ring-slate-300"}`}
            >
              Claims
            </button>
            <button
              onClick={() => setTab("rejects")}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${tab === "rejects" ? "bg-slate-900 text-white" : "bg-white text-slate-700 ring-1 ring-slate-300"}`}
            >
              Reject history
            </button>
          </nav>
        </div>

        {error && <p role="alert" className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}

        {tab === "claims" && !selected && meta && <ClaimList meta={meta} onOpen={setSelected} />}
        {tab === "claims" && selected && meta && (
          <ClaimDetail claimNo={selected} meta={meta} onBack={() => setSelected(null)} />
        )}
        {tab === "rejects" && <RejectHistory />}
      </div>
    </div>
  );
}
