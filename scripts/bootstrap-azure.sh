#!/usr/bin/env bash
# One-time setup per environment: resource group + a GitHub OIDC identity (no stored secrets).
# Usage: ./scripts/bootstrap-azure.sh <github-owner/repo> <staging|production> [location]
# If your GitHub org/repo uses immutable (ID-based) OIDC subjects, set SUBJECT_REPO first, e.g.
#   SUBJECT_REPO="<owner>@<owner-id>/<repo>@<repo-id>" ./scripts/bootstrap-azure.sh ...
# (the failed azure/login error message shows the exact subject GitHub presents).
set -euo pipefail

REPO="${1:?usage: $0 <github-owner/repo> <staging|production> [location]}"
ENV_NAME="${2:?environment}"
LOCATION="${3:-westeurope}"
RG="rg-correlaite-${ENV_NAME}"
APP_NAME="correlaite-github-${ENV_NAME}"
SUBJECT_REPO="${SUBJECT_REPO:-$REPO}"

SUB_ID=$(az account show --query id -o tsv)
TENANT_ID=$(az account show --query tenantId -o tsv)

for ns in Microsoft.App Microsoft.ContainerRegistry Microsoft.DBforPostgreSQL Microsoft.Communication \
          Microsoft.Web Microsoft.OperationalInsights Microsoft.Insights Microsoft.Storage Microsoft.ManagedIdentity; do
  az provider register --namespace "$ns" --wait >/dev/null
done

az group create -n "$RG" -l "$LOCATION" >/dev/null

APP_ID=$(az ad app create --display-name "$APP_NAME" --query appId -o tsv)
az ad sp create --id "$APP_ID" >/dev/null
az ad app federated-credential create --id "$APP_ID" --parameters "{
  \"name\": \"github-${ENV_NAME}\",
  \"issuer\": \"https://token.actions.githubusercontent.com\",
  \"subject\": \"repo:${SUBJECT_REPO}:environment:${ENV_NAME}\",
  \"audiences\": [\"api://AzureADTokenExchange\"]
}" >/dev/null

SCOPE="/subscriptions/${SUB_ID}/resourceGroups/${RG}"
# Contributor deploys resources; User Access Administrator lets the Bicep create the role assignments.
az role assignment create --assignee "$APP_ID" --role Contributor --scope "$SCOPE" >/dev/null
az role assignment create --assignee "$APP_ID" --role "User Access Administrator" --scope "$SCOPE" >/dev/null

cat <<OUT

Done. In GitHub: Settings -> Environments -> "${ENV_NAME}" (create it; add required reviewers for production), then add:

  Variables:
    AZURE_CLIENT_ID        ${APP_ID}
    AZURE_TENANT_ID        ${TENANT_ID}
    AZURE_SUBSCRIPTION_ID  ${SUB_ID}
    AZURE_RESOURCE_GROUP   ${RG}
    ADMIN_EMAILS           you@example.com
    (optional) AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_DEPLOYMENT, APP_URL
  Secrets:
    POSTGRES_ADMIN_PASSWORD   (long random string)

OUT
