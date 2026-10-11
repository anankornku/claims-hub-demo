// Loads the claims hub tables from PostgreSQL once at startup and builds the
// canonical claim for each claim number. The data is small (about 400 visits),
// so it is held in memory and the API reads from it.
import pg from "pg";
import {
  type CheckResult,
  type ClaimForCheck,
  type PayerRule,
  type ReferenceSets,
  convertDate,
  parseAmount,
  parseDateFormat,
  runChecks,
} from "./domain.js";

type Row = Record<string, any>;

export type RawSource = {
  hcode: string;
  hn: string;
  visitId: string;
  serviceDate: string | null;
  admitDate: string | null;
  dischargeDate: string | null;
  pttype: string;
  claimAmount: string | null;
  cid: string | null;
  doctorLicense: string | null;
  chiefComplaint: string | null;
  policyNo: string | null;
  sex: string | null;
};

export type CanonicalClaim = ClaimForCheck & {
  claimNo: string;
  visitId: string;
  visitType: string;
  hcode: string;
  hospitalName: string;
  hn: string;
  patientName: string;
  sex: string | null;
  admitDate: string | null;
  dischargeDate: string | null;
  payerName: string | null;
  claimStatus: string;
  raw: RawSource;
  rawDateFormat: string;
};

export type Dataset = {
  hospitals: Map<string, { name: string; dateFormat: string; his: string }>;
  payers: Map<string, { name: string; scheme: string; type: string }>;
  rules: PayerRule[];
  refs: ReferenceSets;
  reasons: Map<string, string>;
  claims: CanonicalClaim[];
  claimsByNo: Map<string, CanonicalClaim>;
  submissionReasons: Array<{ reasonCode: string | null; claimNo: string }>;
  submissionCount: number;
};

const LOCAL_SEX = (sexMap: Map<string, string>, hcode: string, code: string | null) =>
  code ? sexMap.get(`${hcode}|${code}`) ?? null : null;

export async function loadDataset(connectionString: string): Promise<Dataset> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const q = async (sql: string) => (await client.query(sql)).rows as Row[];
    const [hospitals, payers, rulesRows, payerMap, sexMap, icd10, icd9, drugs, services, reasonRows,
      visits, patients, claims, diagnoses, procedures, charges, submissions, submissionReasons] = await Promise.all([
      q("SELECT * FROM hospitals"),
      q("SELECT * FROM payers"),
      q("SELECT * FROM payer_rules"),
      q("SELECT * FROM hospital_payer_map"),
      q("SELECT * FROM hospital_sex_map"),
      q("SELECT code FROM ref_icd10"),
      q("SELECT code FROM ref_icd9cm"),
      q("SELECT drug_code FROM ref_drug"),
      q("SELECT item_code FROM ref_service_item"),
      q("SELECT * FROM ref_reject_reason"),
      q("SELECT * FROM visits"),
      q("SELECT * FROM patients"),
      q("SELECT * FROM claims"),
      q("SELECT * FROM diagnoses ORDER BY visit_id, seq"),
      q("SELECT * FROM procedures ORDER BY visit_id, seq"),
      q("SELECT * FROM charge_items ORDER BY visit_id, line_no"),
      q("SELECT * FROM claim_submissions"),
      q("SELECT r.reason_code, s.claim_no FROM claim_submission_reasons r JOIN claim_submissions s USING (submission_id)"),
    ]);

    const hospitalMap = new Map(hospitals.map((h) => [h.hcode, { name: h.hospital_name, dateFormat: h.date_format, his: h.his_system }]));
    const payerInfo = new Map(payers.map((p) => [p.payer_id, { name: p.payer_name, scheme: p.scheme, type: p.payer_type }]));
    const payerByLocal = new Map(payerMap.map((m) => [`${m.hcode}|${m.local_payer_code}`, m.payer_id as string]));
    const sexByLocal = new Map(sexMap.map((m) => [`${m.hcode}|${m.local_sex_code}`, m.sex as string]));

    const rules: PayerRule[] = rulesRows.map((r) => ({
      payerId: r.payer_id,
      ruleType: r.rule_type,
      ruleValue: r.rule_value,
      effectiveFrom: String(r.effective_from).slice(0, 10),
      ruleVersion: r.rule_version,
    }));
    const refs: ReferenceSets = {
      icd10: new Set(icd10.map((r) => r.code)),
      icd9cm: new Set(icd9.map((r) => r.code)),
      drugs: new Set(drugs.map((r) => r.drug_code)),
      services: new Set(services.map((r) => r.item_code)),
    };
    const reasons = new Map<string, string>(reasonRows.map((r) => [r.reason_code, r.description_th]));

    const patientByKey = new Map(patients.map((p) => [`${p.hcode}|${p.hn}`, p]));
    const visitById = new Map(visits.map((v) => [v.visit_id, v]));
    const dxByVisit = groupBy(diagnoses, (d) => d.visit_id);
    const procByVisit = groupBy(procedures, (p) => p.visit_id);
    const chargeByVisit = groupBy(charges, (c) => c.visit_id);
    const submissionsByClaim = groupBy(submissions, (s) => s.claim_no);

    const claimsOut: CanonicalClaim[] = [];
    for (const c of claims) {
      const visit = visitById.get(c.visit_id);
      if (!visit) continue;
      const hospital = hospitalMap.get(visit.hcode);
      if (!hospital) continue;
      const patient = patientByKey.get(`${visit.hcode}|${visit.hn}`);
      const { pattern, calendar } = parseDateFormat(hospital.dateFormat);
      const dx = dxByVisit.get(visit.visit_id) ?? [];
      const principal = dx.find((d) => String(d.diag_type) === "1")?.icd10 ?? null;
      const charges_ = chargeByVisit.get(visit.visit_id) ?? [];
      const chargeTotal = charges_.reduce((sum, ch) => sum + (parseAmount(ch.amount) ?? 0), 0);
      const payerId = payerByLocal.get(`${visit.hcode}|${visit.pttype}`) ?? null;
      const raw: RawSource = {
        hcode: visit.hcode,
        hn: visit.hn,
        visitId: visit.visit_id,
        serviceDate: visit.service_date,
        admitDate: visit.admit_date,
        dischargeDate: visit.discharge_date,
        pttype: visit.pttype,
        claimAmount: c.claim_amount === null ? null : String(c.claim_amount),
        cid: patient?.cid ?? null,
        doctorLicense: visit.doctor_license,
        chiefComplaint: visit.chief_complaint,
        policyNo: visit.policy_no,
        sex: patient?.sex ?? null,
      };
      claimsOut.push({
        claimNo: c.claim_no,
        visitId: visit.visit_id,
        visitType: visit.visit_type,
        hcode: visit.hcode,
        hospitalName: hospital.name,
        hn: visit.hn,
        patientName: patient ? `${patient.prename ?? ""}${patient.fname ?? ""} ${patient.lname ?? ""}`.trim() : "",
        sex: LOCAL_SEX(sexByLocal, visit.hcode, patient?.sex ?? null),
        payerId,
        payerName: payerId ? payerInfo.get(payerId)?.name ?? null : null,
        serviceDate: convertDate(visit.service_date, pattern, calendar),
        serviceDateRaw: visit.service_date,
        admitDate: convertDate(visit.admit_date, pattern, calendar),
        dischargeDate: convertDate(visit.discharge_date, pattern, calendar),
        cid: patient?.cid ?? null,
        doctorLicense: visit.doctor_license,
        chiefComplaint: visit.chief_complaint,
        policyNo: visit.policy_no,
        principalDiagnosis: principal,
        diagnoses: dx.map((d) => d.icd10),
        procedures: (procByVisit.get(visit.visit_id) ?? []).map((p) => p.icd9cm),
        drugCodes: charges_.filter((ch) => ch.item_type === "DRUG").map((ch) => ch.item_code),
        serviceCodes: charges_.filter((ch) => ch.item_type === "SERVICE").map((ch) => ch.item_code),
        claimAmount: parseAmount(c.claim_amount),
        chargeTotal,
        claimStatus: c.claim_status,
        raw,
        rawDateFormat: hospital.dateFormat,
      });
    }
    const claimsByNo = new Map(claimsOut.map((c) => [c.claimNo, c]));

    return {
      hospitals: hospitalMap,
      payers: payerInfo,
      rules,
      refs,
      reasons,
      claims: claimsOut,
      claimsByNo,
      submissionReasons: submissionReasons.map((r) => ({ reasonCode: r.reason_code, claimNo: r.claim_no })),
      submissionCount: submissions.length,
    };
  } finally {
    await client.end();
  }
}

function groupBy<T extends Row>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = map.get(k);
    if (list) list.push(row);
    else map.set(k, [row]);
  }
  return map;
}

/** Runs the checks for a claim, after any fixes, using the dataset's rules and references. */
export function checkClaim(data: Dataset, claim: ClaimForCheck) {
  return runChecks(claim, data.rules, data.refs);
}

export type { CheckResult };
