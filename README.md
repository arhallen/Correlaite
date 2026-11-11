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

## Market data (Alpha Vantage)

Signed-in users can download daily stock (`TIME_SERIES_DAILY`) and crypto (`DIGITAL_CURRENCY_DAILY`) series on the *Market data* page.
Downloads are stored as JSON in Blob Storage and listed in a shared catalog (function, symbol, market, other parameters, download time).
The API key lives only on the server (`ALPHAVANTAGE_API_KEY`, from the GitHub secret of the same name) and is never stored in the catalog or returned to the browser.
Users pick catalog files and/or their own private uploads (multi-select) in the workbench. Downloads are limited per user (`ALPHAVANTAGE_DAILY_DOWNLOAD_LIMIT`, default 10/day).

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
