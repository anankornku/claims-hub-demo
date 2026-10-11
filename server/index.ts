// HTTP API for the demo. Reads from PostgreSQL with the read-only role.
import express from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { loadDataset, checkClaim, type Dataset, type CanonicalClaim } from "./data.js";
import { applyFixes, FIXABLE_FIELDS, MAX_FIX_ROUNDS, fixStatus, type FixableField } from "./domain.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is not set");
const port = Number(process.env.PORT ?? 3001);

const data: Dataset = await loadDataset(databaseUrl);
console.log(`Loaded ${data.claims.length} claims for ${data.hospitals.size} hospitals`);

const app = express();
app.use(express.json());

function summarize(claim: CanonicalClaim) {
  const result = checkClaim(data, claim);
  return {
    claimNo: claim.claimNo,
    hcode: claim.hcode,
    hospitalName: claim.hospitalName,
    visitType: claim.visitType,
    serviceDate: claim.serviceDate,
    payerId: claim.payerId,
    payerName: claim.payerName,
    claimAmount: claim.claimAmount,
    claimStatus: claim.claimStatus,
    failedChecks: result.checks.filter((c) => !c.ok).length,
    manualReview: result.manualReview,
  };
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, claims: data.claims.length });
});

app.get("/api/meta", (_req, res) => {
  res.json({
    dataNotice: "Synthetic data. Patients, hospitals and insurers are fictional. Payer rules are a simplified demo set.",
    dataAsOf: "2026-10-08",
    maxFixRounds: MAX_FIX_ROUNDS,
    fixableFields: FIXABLE_FIELDS,
    hospitals: [...data.hospitals.entries()].map(([hcode, h]) => ({ hcode, name: h.name, dateFormat: h.dateFormat })),
    payers: [...data.payers.entries()].map(([payerId, p]) => ({ payerId, name: p.name, scheme: p.scheme })),
  });
});

app.get("/api/claims", (req, res) => {
  const hcode = typeof req.query.hcode === "string" ? req.query.hcode : undefined;
  const payer = typeof req.query.payer === "string" ? req.query.payer : undefined;
  const rows = data.claims
    .filter((c) => (!hcode || c.hcode === hcode) && (!payer || c.payerId === payer))
    .map(summarize);
  res.json({ total: rows.length, claims: rows });
});

app.get("/api/claims/:claimNo", (req, res) => {
  const claim = data.claimsByNo.get(req.params.claimNo);
  if (!claim) return res.status(404).json({ error: "Claim not found" });
  const result = checkClaim(data, claim);
  res.json({ claim, checks: result.checks, manualReview: result.manualReview, manualReason: result.manualReason ?? null });
});

// Validation loop: the browser sends the fixes entered so far and the number of
// fix rounds already used in this session. Nothing is written to the database.
app.post("/api/claims/:claimNo/check", (req, res) => {
  const claim = data.claimsByNo.get(req.params.claimNo);
  if (!claim) return res.status(404).json({ error: "Claim not found" });

  const body = req.body ?? {};
  const fixes: Partial<Record<FixableField, string>> = {};
  for (const field of FIXABLE_FIELDS) {
    if (typeof body.fixes?.[field] === "string") fixes[field] = body.fixes[field];
  }
  // round = re-runs already done in this session. This check is re-run number round + 1.
  const round = Number.isInteger(body.round) ? Number(body.round) : 0;
  const usedAfter = round + 1;
  const fixed = applyFixes(claim, fixes);
  const result = checkClaim(data, fixed);
  const failed = result.checks.some((c) => !c.ok);

  const status = fixStatus(result.checks, result.manualReview, usedAfter);

  res.json({
    status,
    roundsLeft: Math.max(0, MAX_FIX_ROUNDS - usedAfter),
    manualReason: result.manualReason ?? (status === "manual_review" && failed ? "Still failing after the fix limit" : null),
    checks: result.checks,
    values: {
      serviceDate: fixed.serviceDate,
      claimAmount: fixed.claimAmount,
      chargeTotal: fixed.chargeTotal,
    },
  });
});

app.get("/api/rejects", (_req, res) => {
  const counts = new Map<string, number>();
  for (const r of data.submissionReasons) {
    const key = r.reasonCode ?? "unspecified";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const rows = [...counts.entries()]
    .map(([code, count]) => ({
      reasonCode: code,
      description: data.reasons.get(code) ?? "Payer gave no reason code",
      count,
    }))
    .sort((a, b) => b.count - a.count);
  res.json({ totalSubmissions: data.submissionCount, reasons: rows });
});

// In production the built React app is served from dist/. Unknown non-API paths get index.html.
const distDir = path.resolve("dist");
if (existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(distDir, "index.html")));
}

app.listen(port, () => console.log(`API on http://localhost:${port}`));



