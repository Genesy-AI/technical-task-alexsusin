# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Context

TinyEnginy is a take-home exercise (see README.md for the full task list): a leads manager with CSV import, templated message generation and Temporal-backed email verification. Treat it as production code. The README's task section is the source of truth for the provider API specs used by the phone-enrichment feature.

The repo holds three independent pnpm projects, each with its own lockfile: `backend/`, `frontend/` and `shared/`. There is no root package.json or pnpm workspace, so run commands from inside each directory. Node version comes from each `.nvmrc` (v22).

## Commands

Backend (`cd backend`):
- `pnpm install`, then `pnpm migrate:dev` (applies Prisma migrations to the SQLite DB) and `pnpm gen:prisma`
- `temporal server start-dev`: must be running on `localhost:7233` before starting the API, because the API process also boots the worker
- `pnpm dev`: nodemon + ts-node on `src/index.ts`, port 4000
- `pnpm build`: runs `tsc`
- `pnpm test`: vitest in node env. Single file: `pnpm vitest run src/utils/messageGenerator.test.ts`. Single test: add `-t "<name>"`
- `pnpm migrate:dev --name <name>` after editing `prisma/schema.prisma`

Shared (`cd shared`): `pnpm build` (tsc to `dist/`, which is gitignored), `pnpm test`. You rarely need to run these directly: `pnpm install` in backend or frontend installs and builds `shared` through `postinstall`, and their `dev`, `build` and `test` scripts rebuild it first. `pnpm vitest run` skips that rebuild, so after editing `shared/src` run `pnpm shared:build` (or `pnpm test`) before testing a consumer.

Frontend (`cd frontend`):
- `pnpm dev`: Vite. Reads `VITE_API_URL` from `frontend/.env` (`http://localhost:4000`) and throws at startup if it is unset
- `pnpm build`: `tsc -b && vite build`. Currently fails on a type error in `src/api/mutations/useApiMutation.ts` (the optimistic lead is missing `emailVerified`)
- `pnpm lint`: ESLint, zero warnings allowed. Currently does not run, because the config is legacy `.eslintrc.cjs` while ESLint is v9
- `pnpm test`: vitest in jsdom with `src/test/setup.ts`. Single file: `pnpm vitest run src/utils/csvParser.test.ts`

Both projects use Prettier (`pnpm format`): no semicolons, single quotes, printWidth 110, es5 trailing commas.

## Architecture

### Shared package
- `shared/` is published to the other two projects as `@tinyenginy/shared` through `link:../shared`. Put code there when both backend and frontend need it (for example validation that runs on the client and is enforced again on the server).
- It compiles to ESM (`"type": "module"`, NodeNext, so relative imports need `.js` extensions). The CommonJS backend loads it with Node's `require(esm)`, which needs Node 22.12 or later. Keep it free of top-level `await` and runtime dependencies.
- It currently holds the ISO 3166-1 alpha-2 country master (`src/countries.ts`, 249 assigned codes, generated from a public dataset) and the helpers `normalizeCountryCode`, `isValidCountryCode`, `getCountryName` and `invalidCountryCodeMessage`.

### Backend
- `src/index.ts` holds the whole Express API (every `/leads` route, inline CORS, Prisma client) and also calls `runTemporalWorker()`. One process serves both HTTP and the Temporal worker.
- Database: Prisma with SQLite at `prisma/dev.db`, which is committed. The datasource URL is hard-coded in `schema.prisma`; `.env.sample` is unused boilerplate. There is a single `lead` model.
- Temporal:
  - `src/worker.ts` registers workflows through `workflowsPath: require.resolve('./workflows')` and activities from `./workflows/activities`, on task queue `myQueue`, namespace `default`.
  - Workflows live in `src/workflows/workflows.ts` and are re-exported from `src/workflows/index.ts`. This code runs in Temporal's deterministic sandbox, so it can only import `@temporalio/workflow` and activity *types*. I/O belongs in activities (`src/workflows/activities/`, re-exported from its `index.ts`), called through `proxyActivities` with timeouts and retry policies.
  - The API reuses one Temporal client per process (`src/temporalClient.ts`).
  - `/leads/verify-emails` runs one `client.workflow.execute` per lead in parallel and responds when all of them finish. Workflow IDs are deterministic (`verify-email-<leadId>`) with `workflowIdConflictPolicy: 'USE_EXISTING'`, so concurrent requests attach to the running execution instead of starting duplicates. Once it finishes, a new request starts a new run. The activity's bounded retry policy (3 attempts, 3s `startToCloseTimeout`) guarantees the request ends in about 11s at most. A failed lead is reported in `errors` and its `emailVerified` is left untouched.
  - The `verifyEmail` activity is a mock: `john.doe` is always invalid, `jane.smith` takes 20s (so it always exhausts its retries) and any address with `+` is invalid. Keep it as is; fixes belong in the orchestration.
- Request validation: `countryCode` is optional, but `/leads/bulk` rejects rows whose value is not an assigned ISO code. Those rows go into the response's `errors` array through `src/utils/countryCode.ts`. Codes are stored uppercased.
- Message templating: `src/utils/messageGenerator.ts` replaces `{fieldName}` tokens using an explicit `availableFields` whitelist, so a new lead field must be added there to be usable in templates.

### Frontend
- React 18, Vite, Tailwind v4 (through `@tailwindcss/vite`), TanStack Query, react-hot-toast. `main.tsx` → `Providers.tsx` (QueryClient + Toaster) → `App.tsx` → `components/LeadsList.tsx`, which is the main screen and opens `CsvImportModal` and `MessageTemplateModal`.
- API layer: `src/api/modules/leads.ts` declares each endpoint with `endpoint<Output, Input>(method, path | pathBuilder)` from `src/api/utils.ts`. Request/response types live one file per endpoint in `src/api/types/leads/`, and are written by hand to mirror the backend. Components call `api.leads.*` directly inside `useQuery`/`useMutation`, using query key `['leads', 'getMany']`. `src/api/mutations/useApiMutation.ts` is a typed alternative that only has `leads.create` wired up.
- CSV import: `src/utils/csvParser.ts` parses with PapaParse (headers are trimmed and lowercased), validates each row into `CsvLead` (including the country code against the shared master), and the modal posts the valid rows to `/leads/bulk`. The backend dedupes on firstName+lastName.

### Adding a lead field touches all layers
`prisma/schema.prisma` + migration → the `/leads/bulk` (and create/update) handlers in `index.ts` → `messageGenerator.ts` `availableFields` → frontend `api/types/leads/*` → `csvParser.ts` `CsvLead` + header mapping → `LeadsList` table columns → `MessageTemplateModal`.

## Known issues
- The frontend `leads.update` sends `PUT /leads/:id`, but the backend only defines `PATCH /leads/:id`. That handler also only updates `firstName` from `name` and `email`.
- `docs/` contains the sample CSVs (`leads-ok-*.csv`, `leads-with-errors.csv`) and the UI wireframes.
