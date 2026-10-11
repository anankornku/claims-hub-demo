# Claims Hub Demo

A read-only demo of the claims hub: it shows how raw hospital data becomes a canonical claim, runs the pre-submission checks, and lets a user fix and re-check a claim up to three times.

Data is synthetic. Hospitals, patients and insurers are fictional, and the payer rules are a simplified demo set, not the official NHSO, CGD or SSO rules.

## Stack

- React and Tailwind (front end, `src/`)
- TypeScript (API and rules, `server/`)
- PostgreSQL (data store, loaded from `claims_hub.sqlite`)
- Vitest (unit tests) and Cypress (end-to-end tests, `cypress/`)
- Render (hosting, `render.yaml`)

## Local setup

1. Install Node.js 22 or newer and PostgreSQL 16.
2. Create a database and two roles: a loader role that owns the database, and a read-only reader role.
3. Copy `.env.example` to `.env` and fill in the connection strings:
   - `LOADER_URL` is used once by the load script.
   - `DATABASE_URL` is used by the app and should be the read-only role.
   - `SQLITE_PATH` points to `claims_hub.sqlite`.
4. Install and load the data:

   ```bash
   npm ci
   npm run load
   ```

   The load script opens the SQLite file read-only and prints the row count per table. The counts match the README in the data package (412 claims, 400 visits, 1,765 charge items).
5. Run the app:

   ```bash
   npm run dev
   ```

   The API runs on port 3001 and the page on port 5173.

## Tests

```bash
npm test          # unit tests for dates, amounts, rules and fix status
npm run test:e2e  # Cypress tests; needs the app running (npm run dev)
```

## What the checks cover

- Required fields for the claim's payer, from `required_field` rules in force on the service date.
- ICD-10 and ICD-9-CM codes, drug codes, and service codes, against the reference tables.
- The claim amount against the sum of its charge items.
- Manual review when the payer code is not mapped, the date cannot be read, or no rule is in force.

Other rule types in the data (for example exclusions, limits, required documents and pre-authorization) are not checked in this demo.

## Notes

- Fixes stay in the browser. Reloading restores the original data.
- The app never sends a claim to a payer and never writes to the database.
- Two-digit years such as `69-08-01` are flagged as unreadable and are not guessed.

## Deploy (Render)

1. Create a Render PostgreSQL database and note its connection string. Use it as the loader:
   run `LOADER_URL=<owner url> npm run load` once from your machine.
2. Connect to that database as its owner and create the read-only role:

   ```sql
   CREATE ROLE claims_reader LOGIN PASSWORD '<choose one>';
   GRANT CONNECT ON DATABASE claims_hub TO claims_reader;
   GRANT USAGE ON SCHEMA public TO claims_reader;
   GRANT SELECT ON ALL TABLES IN SCHEMA public TO claims_reader;
   ```

3. Create the web service from `render.yaml`. When Render asks for `DATABASE_URL`, enter the `claims_reader` connection string.
4. Open the service URL. The claim list should show 412 claims.
