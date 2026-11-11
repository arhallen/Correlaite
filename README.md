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

## Local development

```bash
docker compose up -d                 # Postgres + Azurite
cd api && cp .env.example .env && npm install && npm run dev      # http://localhost:8080 (loads .env automatically)
cd frontend && npm install && npm run dev                          # http://localhost:5173
```
Sign-in links are printed in the API console when email is not configured. The sandbox is not emulated locally,
so "Generate & run" needs a real session pool (set `SANDBOX_POOL_ENDPOINT`, `AZURE_OPENAI_*`, and `az login`).

Commit the generated `package-lock.json` files; CI and the Docker build use `npm ci`.

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
