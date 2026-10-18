# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Context

TinyEnginy is a take-home exercise (see README.md for the full task list): a leads manager with CSV import, templated message generation and Temporal-backed email verification. Treat it as production code. The README's task section is the source of truth for the provider API specs used by the phone-enrichment feature.

The repo holds two independent pnpm projects, `backend/` and `frontend/`. There is no root package.json, so run commands from inside each directory. Node version comes from each `.nvmrc` (v22).

## Commands

Backend (`cd backend`):
- `pnpm install`, then `pnpm migrate:dev` (applies Prisma migrations to the SQLite DB) and `pnpm gen:prisma`
- `temporal server start-dev`: must be running on `localhost:7233` before starting the API, because the API process also boots the worker
- `pnpm dev`: nodemon + ts-node on `src/index.ts`, port 4000
- `pnpm build`: runs `tsc`
- `pnpm test`: vitest in node env. Single file: `pnpm vitest run src/utils/messageGenerator.test.ts`. Single test: add `-t "<name>"`
- `pnpm migrate:dev --name <name>` after editing `prisma/schema.prisma`

Frontend (`cd frontend`):
- `pnpm dev`: Vite. Reads `VITE_API_URL` from `frontend/.env` (`http://localhost:4000`) and throws at startup if it is unset
- `pnpm build`: `tsc -b && vite build`
- `pnpm lint`: ESLint, zero warnings allowed. The config is legacy `.eslintrc.cjs` while ESLint is v9
- `pnpm test`: vitest in jsdom with `src/test/setup.ts`. Single file: `pnpm vitest run src/utils/csvParser.test.ts`

Both projects use Prettier (`pnpm format`): no semicolons, single quotes, printWidth 110, es5 trailing commas.

## Architecture

### Backend
- `src/index.ts` holds the whole Express API (every `/leads` route, inline CORS, Prisma client) and also calls `runTemporalWorker()`. One process serves both HTTP and the Temporal worker.
- Database: Prisma with SQLite at `prisma/dev.db`, which is committed. The datasource URL is hard-coded in `schema.prisma`; `.env.sample` is unused boilerplate. There is a single `lead` model.
- Temporal:
  - `src/worker.ts` registers workflows through `workflowsPath: require.resolve('./workflows')` and activities from `./workflows/activities`, on task queue `myQueue`, namespace `default`.
  - Workflows live in `src/workflows/workflows.ts` and are re-exported from `src/workflows/index.ts`. This code runs in Temporal's deterministic sandbox, so it can only import `@temporalio/workflow` and activity *types*. I/O belongs in activities (`src/workflows/activities/`, re-exported from its `index.ts`), called through `proxyActivities` with timeouts and retry policies.
  - `/leads/verify-emails` opens a new client connection per request and runs `client.workflow.execute` sequentially for each lead, blocking the HTTP response until every workflow finishes.
- Message templating: `src/utils/messageGenerator.ts` replaces `{fieldName}` tokens using an explicit `availableFields` whitelist, so a new lead field must be added there to be usable in templates.

### Frontend
- React 18, Vite, Tailwind v4 (through `@tailwindcss/vite`), TanStack Query, react-hot-toast. `main.tsx` → `Providers.tsx` (QueryClient + Toaster) → `App.tsx` → `components/LeadsList.tsx`, which is the main screen and opens `CsvImportModal` and `MessageTemplateModal`.
- API layer: `src/api/modules/leads.ts` declares each endpoint with `endpoint<Output, Input>(method, path | pathBuilder)` from `src/api/utils.ts`. Request/response types live one file per endpoint in `src/api/types/leads/`, and are written by hand to mirror the backend. Components call `api.leads.*` directly inside `useQuery`/`useMutation`, using query key `['leads', 'getMany']`. `src/api/mutations/useApiMutation.ts` is a typed alternative that only has `leads.create` wired up.
- CSV import: `src/utils/csvParser.ts` parses with PapaParse (headers are trimmed and lowercased), validates each row into `CsvLead`, and the modal posts the valid rows to `/leads/bulk`. The backend dedupes on firstName+lastName.

### Adding a lead field touches all layers
`prisma/schema.prisma` + migration → the `/leads/bulk` (and create/update) handlers in `index.ts` → `messageGenerator.ts` `availableFields` → frontend `api/types/leads/*` → `csvParser.ts` `CsvLead` + header mapping → `LeadsList` table columns → `MessageTemplateModal`.

## Known mismatches
- The frontend `leads.update` sends `PUT /leads/:id`, but the backend only defines `PATCH /leads/:id`. That handler also only updates `firstName` from `name` and `email`.
- `docs/` contains the sample CSVs (`leads-ok-*.csv`, `leads-with-errors.csv`) and the UI wireframes.
