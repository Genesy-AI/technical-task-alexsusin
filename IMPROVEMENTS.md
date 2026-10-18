# Improvements & Technical Roadmap

TinyEnginy works end to end today: CSV import, message templating, email verification and phone enrichment through Temporal. The next bottlenecks are not features. They are how the code is organised, how it scales with more leads and more traffic, and how much visibility we have once it runs in production.

This document groups the work into two phases. Every item is written as a ticket: problem, proposal, acceptance criteria, effort and dependencies.

## Roadmap at a glance

| ID    | Item                                            | Phase | Priority | Effort | Depends on   |
| ----- | ----------------------------------------------- | ----- | -------- | ------ | ------------ |
| IMP-1 | Split the backend into layers                   | 1     | High     | M      | —            |
| IMP-2 | Shared contracts: one source of truth for types | 1     | High     | M      | —            |
| IMP-3 | Zod validation across the whole API             | 1     | High     | M      | IMP-1, IMP-2 |
| IMP-4 | Run Temporal workers as their own process       | 1     | High     | S      | —            |
| IMP-5 | Paginate the leads list                         | 1     | High     | M      | IMP-1        |
| IMP-6 | Make email verification asynchronous            | 1     | High     | M      | IMP-4        |
| IMP-7 | Temporal observability                          | 2     | Medium   | M      | IMP-4        |

Effort: S ≈ 1 day, M ≈ 2–4 days, L ≈ 1 week or more.

**Suggested order.** IMP-1 and IMP-2 come first, because every later ticket touches routes and API types and is cheaper to do on the new structure. IMP-3 builds on both. IMP-4 is small and unblocks IMP-6 and IMP-7. IMP-5 and IMP-6 are the two changes users will notice.

**Out of scope.** The database stays on local SQLite. Separate API and worker processes on the same machine can share the SQLite file, so IMP-4 does not need a new database. Moving to Postgres only becomes necessary when processes run on different hosts.

---

## Phase 1: Foundations and scalability

### IMP-1 · Split the backend into layers

**Problem.** `backend/src/index.ts` holds the Express setup, CORS, every `/leads` route, request validation, Prisma queries, Temporal orchestration and the worker bootstrap, in about 430 lines. It is still manageable with ten endpoints, but every new feature makes it longer, any change risks conflicts, and the business logic can only be tested over HTTP.

**Proposal.** Split the code by responsibility:

```
backend/src/
  app.ts                  # express app: middleware, routers, error handler (no listen)
  server.ts               # entry point: settings check + app.listen
  routes/leads.routes.ts  # HTTP only: parse request, call service, map response
  services/leads.service.ts, emailVerification.service.ts, phoneEnrichment.service.ts
  repositories/leads.repository.ts   # Prisma access
  middleware/errorHandler.ts, cors.ts
```

- Routes never import Prisma or the Temporal client. Services hold the business rules (deduplication on bulk import, template generation, starting workflows).
- Add a single error-handling middleware with a common error format (`{ code, message, details? }`) to replace the `try/catch` + `console.error` repeated in every handler.
- Exporting `app` separately from `listen` lets us add HTTP tests with supertest without opening a port.

**Acceptance criteria**
- `index.ts` / `server.ts` only bootstraps. No route logic or Prisma query lives in it.
- The API behaves exactly as before: same endpoints, payloads and status codes. The existing tests pass.
- At least one supertest test per router covers the happy path and a validation error.

**Effort:** M · **Dependencies:** none

---

### IMP-2 · Shared contracts: one source of truth for types

**Problem.** The frontend types in `frontend/src/api/types/leads/*` (11 files) are written by hand to mirror the backend. Adding or renaming a lead property means editing both projects, and nothing fails if one side is forgotten. Adding the phone, years and LinkedIn fields already needed changes in up to eight places.

**Proposal.** Move the API contracts into `@tinyenginy/shared`:
- A `Lead` type and per-endpoint request/response types (`GetLeadsResponse`, `VerifyEmailsRequest`…), defined once.
- Shared enums as literal unions, for example `PhoneEnrichmentStatus` (now a `String` column documented only by a Prisma comment) and the email verification status introduced in IMP-6.
- The backend annotates its handlers with these types and the frontend `endpoint<Output, Input>` declarations import them.

Combined with IMP-3, the types are inferred from the Zod schemas (`z.infer`), so a single schema is both the validation and the type.

**Acceptance criteria**
- `frontend/src/api/types/leads/` is gone or only re-exports from `@tinyenginy/shared`.
- Renaming a lead property in `shared` breaks the build of both backend and frontend until both are updated.

**Effort:** M · **Dependencies:** none (best done together with IMP-3)

---

### IMP-3 · Zod validation across the whole API

**Problem.** Zod is only used for app settings. Request validation is handwritten and uneven across routes: some check `typeof req.body`, others coerce IDs with `Number(id)` without checking for `NaN`, and the optional fields go through their own `{ ok, value | error }` parsers. As a result, each endpoint accepts and rejects inputs differently and returns errors in a different shape.

**Proposal.**
- Define a Zod schema per request (body, params, query) in `shared`, reusing the existing field parsers through `z.string().transform/superRefine`, so the CSV preview on the client and the API apply exactly the same rules.
- Add a `validate({ body, params, query })` middleware that parses the request and returns a 400 with the field-level issues in the IMP-1 error format.
- Validate responses from external providers (phone enrichment) with schemas too, instead of reading `phonePath` from untyped JSON.

**Trade-off.** `shared` currently has no runtime dependencies. Adding Zod makes it one (a `dependency` of `shared` that both consumers resolve). The extra bundle size on the frontend is small, and it buys a single validation layer, so we consider it worth it.

**Acceptance criteria**
- Every route validates its input through a schema. No manual `typeof`/`Array.isArray` checks remain in handlers.
- Invalid input returns 400 with a consistent `details` array of `{ path, message }`.
- The CSV parser and `/leads/bulk` use the same schema for a lead row.

**Effort:** M · **Dependencies:** IMP-1, IMP-2

---

### IMP-4 · Run Temporal workers as their own process

**Problem.** The API process also runs every Temporal worker (`runTemporalWorker()` is called from `index.ts`). As a result:
- Scaling the API scales the workers and the other way round, although they have different load profiles. HTTP traffic is short and bursty, while workflows are long-running and rate-limited per provider.
- A deploy or crash of the API kills in-flight activities, and a heavy enrichment batch competes for CPU with HTTP requests.
- The Temporal address is hard-coded to `localhost:7233`.

**Proposal.**
- Add a separate entry point, `src/worker.main.ts`, with scripts `dev:worker` / `start:worker`. The API only uses the Temporal client.
- Allow running the main queue and the per-provider queues (`phone-enrichment.<id>`) in separate processes through settings, so a provider's workers can be scaled on their own. `maxTaskQueueActivitiesPerSecond` is enforced server-side, so the rate limits still hold with several replicas.
- Move the Temporal address, namespace and task queue names into `appsettings`.
- Shut down gracefully on `SIGTERM` (`Worker.shutdown()`) so in-flight activities finish or are retried cleanly.

**Acceptance criteria**
- The API starts and serves requests without starting any worker. Workflows only make progress when the worker process is running.
- Two worker processes can run in parallel and Temporal splits the tasks between them.
- No Temporal connection detail is hard-coded.

**Effort:** S · **Dependencies:** none

---

### IMP-5 · Paginate the leads list

**Problem.** `GET /leads` returns every lead (`prisma.lead.findMany()` without a limit), and the frontend renders them all. While a phone enrichment is running, the frontend re-fetches the whole list every 2 seconds. Response size, render time and database load all grow linearly with the number of leads, and a real account easily holds tens of thousands.

**Proposal.**
- Backend: `GET /leads?cursor=<id>&limit=50&sort=createdAt:desc`, returning `{ items, nextCursor, total }`. Cursor pagination stays stable while leads are inserted or deleted, unlike `offset`. Cap `limit` (e.g. 200). Add the matching index in Prisma.
- Leave room for filters (`emailVerified`, `countryCode`, enrichment status, text search) in the same query schema (IMP-3).
- Frontend: TanStack Query `useInfiniteQuery` or a paginated table. Polling only refreshes the visible page, or better, only the leads still in progress.
- Bulk actions: selection must work across pages. Add a "select all N matching leads" mode that sends the filter to the backend instead of a list of IDs.

**Acceptance criteria**
- With 10,000 seeded leads, the first page responds in under 200 ms locally and the UI renders only one page.
- Navigating between pages never shows duplicates or skips leads, even while leads are created or deleted at the same time.
- Selected leads stay selected when changing pages, and bulk actions apply to all of them.

**Effort:** M · **Dependencies:** IMP-1 (and IMP-3 for the query schema)

---

### IMP-6 · Make email verification asynchronous

**Problem.** `POST /leads/verify-emails` runs one workflow per lead with `workflow.execute` and keeps the HTTP request open until all of them finish. The bounded retry policy makes that about 11 s at most, but:
- The time grows with the slowest lead, and a large selection keeps a connection and a server slot busy for the whole run.
- If the user reloads or closes the tab, the result only reaches the database because the handler is still alive. A restart of the API in the meantime loses the update even though the workflow completed.
- It is inconsistent with phone enrichment, which already follows the asynchronous pattern.

**Proposal.** Align it with `/leads/enrich-phone`:
- Start the workflows with `workflow.start` (same deterministic ID `verify-email-<leadId>`, `USE_EXISTING`) and respond `202 Accepted` with the started lead IDs right away.
- Persist the result from inside the workflow through an activity (`markEmailVerification`) instead of from the HTTP handler, so it survives API restarts.
- Add `emailVerificationStatus` (`pending | running | verified | invalid | failed`) to the lead, as a shared literal union (IMP-2). `emailVerified` stays as the result.
- Frontend: show the per-lead status in the table, and extend the existing polling so it also covers leads whose verification is in progress. The progress toast summarises the run once all selected leads have finished.

**Acceptance criteria**
- The endpoint responds in under 500 ms for any selection size.
- Closing the browser or restarting the API during a verification does not lose the result.
- A lead whose verification fails ends as `failed` in the UI, and its previous `emailVerified` value is kept.

**Effort:** M · **Dependencies:** IMP-4 (recommended, so the workflow writes from the worker process)

---

## Phase 2: Operability

### IMP-7 · Temporal observability

**Problem.** Today the only signals are `console.error` lines and the Temporal UI. We cannot answer basic product and operations questions: which phone provider finds the most numbers, how often each one returns 500 or 429, how long an enrichment takes, or whether the task queues are backing up.

**Proposal.**
- **Metrics:** turn on the SDK's Prometheus exporter (`Runtime.install({ telemetryOptions: { metrics: { prometheus } } })`) in the worker process. It exposes task queue latency, activity failures and schedule-to-start times.
- **Business metrics** per provider from `callPhoneProvider`: request count by outcome (`found`, `not_found`, `4xx`, `5xx`, `429`, `timeout`), latency histogram and hit rate. These are the data needed to reorder `providerOrder` by cost and effectiveness.
- **Search attributes** on workflows (`LeadId`, `Provider`, `Outcome`) so support can find the execution of a lead in the Temporal UI without knowing its workflow ID.
- **Structured logs:** replace the default logger with a JSON logger (pino) through `Runtime.install({ logger })` and the workflow `log` API, including `workflowId`, `runId` and `leadId` in every line.
- **Alerts:** a provider error rate above a threshold, schedule-to-start latency increasing (not enough workers) and workflows ending in `failed`.

**Acceptance criteria**
- A dashboard shows hit rate, error rate and p95 latency for each provider, plus the backlog of each task queue.
- Given a lead ID, its workflow executions can be found in the Temporal UI through a search attribute.
- Every log line from a workflow or activity carries `workflowId` and `leadId`.

**Effort:** M · **Dependencies:** IMP-4
