# Correlaite

Web app where people sign in with an emailed magic link and work with datasets and AI in a workbench.
AI-generated code runs in a network-isolated sandbox. Includes an admin section (users, usage metrics).

```
frontend/   React + Vite + TypeScript  -> Azure Static Web Apps (Standard)
api/        Fastify + TypeScript       -> Azure Container Apps (proxied at /api by the Static Web App)
infra/      Bicep                      -> everything in Azure, one resource group per environment
.github/    CI (PRs) and CD (main -> staging -> production with approval)
```

## Azure architecture

| Concern | Service |
|---|---|
| Frontend | Static Web Apps; `/api/*` is a linked backend to the API, so the app is same-origin (no CORS, first-party cookies) |
| API | Container Apps (scale-to-zero in staging, 1 replica in production) |
| Database | PostgreSQL Flexible Server (Burstable) |
| Datasets | Blob Storage, private, accessed by managed identity |
| Magic links | Azure Communication Services Email |
| Code sandbox | Container Apps **dynamic sessions** (Python), `EgressDisabled`, one session per run |
| AI | Azure OpenAI chat completions over managed identity (bring your own endpoint/deployment) |
| Metrics | Application Insights + Log Analytics (infra), `usage_events` table (in-app admin page) |

Sign-in flow: `POST /api/auth/request` stores a hashed single-use token (15 min) and emails a link to `/auth/verify?token=...`.
That page POSTs the token to `/api/auth/verify`, so email link scanners cannot consume it. A session cookie (HttpOnly, SameSite=Lax, 30 days) is set.
Emails listed in `ADMIN_EMAILS` become admins on first sign-in. Set `ALLOW_SIGNUP=false` to restrict sign-in to existing users.

Sandbox safety: `/api/runs` returns 503 unless a sandbox pool is configured; generated code is never run in the API container.

## Monitoring

- **API requests/dependencies/exceptions:** Application Insights via OpenTelemetry (`api/src/instrument.ts`, role `correlaite-api`). Container console logs, including one line per request, are also in Log Analytics (`ContainerAppConsoleLogs_CL`).
- **Page visits:** the browser SDK (`frontend/src/telemetry.ts`, role `correlaite-web`) records page views, route changes and `/api` calls. The connection string is passed at build time as `VITE_APPINSIGHTS_CONNECTION_STRING` from the Bicep output.
- **Email (Communication Services):** a diagnostic setting sends Send Mail, Delivery Status Update and User Engagement logs to the Log Analytics workspace, which powers the Insights view on the resource.

## Data management

Signed-in users manage data on the *Data management* page: upload private files (free), retrieve new market data (5 credits), or buy one-time access to a file someone else already retrieved (1 credit).
Files are stored as JSON in Blob Storage in a shared catalog (symbol, market, download time, STOCK or CRYPTO); `market_data_access` records who owns which file, and only owners can use or view it.
Provider adapter: `api/src/alphavantage.ts`; its key (`ALPHAVANTAGE_API_KEY`, from the GitHub secret of the same name) lives only on the server. More providers can be added next to it.
Retrievals are limited per user (`ALPHAVANTAGE_DAILY_DOWNLOAD_LIMIT`, default 10/day). The *Benchmark* page offers only files you uploaded or own, with filter (symbol/type) and sorting (latest first).

## Credits

Every account starts with 100 credits (`api/src/pricing.ts` holds all prices). Using files you own is free; retrieving a new file costs 5; buying access to an existing file costs 1 (once); a sandbox run costs 10 plus 5 per started
second, at most 25 (a run needs at least 15 credits to start, and charging never takes the balance below zero). Every change is recorded in `credit_transactions`. The *Credit management* page shows
the balance and history. Packs (USD): $5 = 50 credits, $10 = 110, $100 = 1250. Buying is **mocked** (`POST /api/credits/purchase` grants credits without charging); replace `mockPayment` in `api/src/routes/credits.ts` with a real payment provider before launch.

## Development without installing anything locally

You do not need Node, npm or Python on your machine.

- **GitHub Codespaces (easiest):** on the repo page choose Code -> Codespaces -> Create. The dev container
  (`.devcontainer/`) starts Node 22, Postgres, Azurite, the Azure CLI and the GitHub CLI, and runs `npm install`.
- **Local VS Code + Docker Desktop:** "Dev Containers: Reopen in Container". Everything still runs inside containers.
- **Lockfiles:** run the **Update lockfiles** workflow once (Actions tab). It commits `package-lock.json` for `api/` and `frontend/`,
  which CI and the Docker build (`npm ci`) need.

Inside the dev container:

```bash
cd api && npm run dev          # http://localhost:8080 (loads api/.env, created from .env.example)
cd frontend && npm run dev     # http://localhost:5173
```

Sign-in links are printed in the API console when email is not configured. The sandbox is not emulated, so
"Generate & run" needs a real session pool (`SANDBOX_POOL_ENDPOINT`, `AZURE_OPENAI_*`, and `az login`).
`docker-compose.yml` at the repo root is the same Postgres + Azurite pair for people who run the apps on the host.

## Deploy

1. Create the GitHub repo and push.
2. For each environment: `./scripts/bootstrap-azure.sh <owner/repo> staging` (and `production`). It creates the resource group and a
   GitHub OIDC identity, and prints the GitHub environment variables/secrets to set.
3. In GitHub, add required reviewers to the `production` environment.
4. Push to `main`: infra (Bicep) -> image build in ACR -> API rollout (migrations run at start) -> frontend -> smoke test.
5. Grant the API identity `Cognitive Services OpenAI User` on your Azure OpenAI resource.

## Known follow-ups

- Postgres is reachable from "Azure services" via firewall rule; move to private endpoint + Entra auth.
- Pin the Postgres CA bundle (`api/src/db.ts`).
- Custom domain + Front Door/WAF; verified sender domain for email (the Azure-managed domain is fine to start).
- Magic-link rate limits are per IP and per email; add CAPTCHA if abused.
- Secrets are Container App secrets; move to Key Vault references when convenient.
