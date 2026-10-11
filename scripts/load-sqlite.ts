// One-time load: copies every table from claims_hub.sqlite into PostgreSQL.
// The SQLite file is opened read-only and is never changed.
import { DatabaseSync } from "node:sqlite";
import pg from "pg";

type Col = { name: string; type: string; pk: number };

const sqlitePath = process.env.SQLITE_PATH ?? "scratch/claims_hub.sqlite";
const loaderUrl = process.env.LOADER_URL;
if (!loaderUrl) throw new Error("LOADER_URL is not set");

function pgType(declared: string): string {
  const t = declared.toUpperCase();
  if (t.includes("INT")) return "BIGINT";
  if (t === "REAL") return "DOUBLE PRECISION";
  // Blank-typed columns (claim_amount, amount) hold mixed text such as "11,925.00",
  // so they stay TEXT and the app parses them.
  return "TEXT";
}

async function main() {
  const sqlite = new DatabaseSync(sqlitePath, { readOnly: true });
  const client = new pg.Client({ connectionString: loaderUrl });
  await client.connect();

  const tables = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((r) => String(r.name));

  await client.query("BEGIN");
  try {
    for (const table of tables) {
      const cols = sqlite.prepare(`PRAGMA table_info(${table})`).all() as unknown as Col[];
      const pk = cols.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name);
      const defs = cols.map((c) => `"${c.name}" ${pgType(c.type)}`);
      if (pk.length) defs.push(`PRIMARY KEY (${pk.map((k) => `"${k}"`).join(", ")})`);
      await client.query(`DROP TABLE IF EXISTS "${table}"`);
      await client.query(`CREATE TABLE "${table}" (${defs.join(", ")})`);

      const names = cols.map((c) => c.name);
      const rows = sqlite.prepare(`SELECT ${names.map((n) => `"${n}"`).join(", ")} FROM "${table}"`).all();
      const batch = 500;
      for (let start = 0; start < rows.length; start += batch) {
        const slice = rows.slice(start, start + batch);
        const values: unknown[] = [];
        const tuples = slice.map((row, i) => {
          const marks = names.map((n, j) => {
            values.push(row[n]);
            return `$${i * names.length + j + 1}`;
          });
          return `(${marks.join(", ")})`;
        });
        await client.query(
          `INSERT INTO "${table}" (${names.map((n) => `"${n}"`).join(", ")}) VALUES ${tuples.join(", ")}`,
          values,
        );
      }
      const [{ count }] = (await client.query(`SELECT count(*)::int AS count FROM "${table}"`)).rows;
      console.log(`${table.padEnd(28)} ${String(count).padStart(6)} rows`);
    }
    // Read-only role for the app. Created once, then only granted on each load.
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }

  await client.query(
    `DO $$ BEGIN
       IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'claims_reader') THEN
         GRANT SELECT ON ALL TABLES IN SCHEMA public TO claims_reader;
       END IF;
     END $$`,
  );
  await client.end();
  sqlite.close();
  console.log(`Loaded ${tables.length} tables from ${sqlitePath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
