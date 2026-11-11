// Correlaite - one resource group per environment (staging / production).
targetScope = 'resourceGroup'

@description('Short prefix used in resource names')
param namePrefix string = 'correlaite'

@allowed(['staging', 'production'])
param environmentName string

param location string = resourceGroup().location

@description('Static Web Apps (Standard, needed for the linked API backend) is only available in some regions')
param swaLocation string = 'westeurope'

@description('Postgres Flexible Server is restricted in some regions for some subscriptions (error: allowed Version list is empty). Pick one where it is offered.')
param postgresLocation string = 'northeurope'

@secure()
param postgresAdminPassword string

@description('Comma-separated emails that are made admin at first sign-in')
param adminEmails string

@description('Container image for the API. The deploy workflow keeps the current image; the placeholder is only used on first deploy')
param apiImage string = 'mcr.microsoft.com/k8se/quickstart:latest'

@description('Public URL of the site if you use a custom domain; defaults to the Static Web App hostname')
param appUrl string = ''

@description('Create an Azure OpenAI account + model deployment for code generation. Set false to use an existing endpoint via azureOpenAiEndpoint/azureOpenAiDeployment')
param createOpenAi bool = true
param openAiLocation string = 'swedencentral'
@description('Model to deploy. Availability and default quota differ per region/subscription; if the deploy fails with a quota or model error, try another model/version or capacity')
param openAiModelName string = 'gpt-4.1'
param openAiModelVersion string = '2025-04-14'
param openAiSkuName string = 'GlobalStandard'
@description('Capacity in thousands of tokens per minute')
param openAiCapacity int = 50
param openAiDeploymentName string = 'codegen'

@description('Only used when createOpenAi is false')
param azureOpenAiEndpoint string = ''
param azureOpenAiDeployment string = ''

@secure()
@description('Alpha Vantage API key (GitHub secret ALPHAVANTAGE_API_KEY); leave empty to disable market data downloads')
param alphaVantageApiKey string = ''

var suffix = uniqueString(resourceGroup().id)
var base = '${namePrefix}-${environmentName}'
var compact = toLower('${namePrefix}${take(environmentName, 4)}${take(suffix, 6)}')
var isProd = environmentName == 'production'

// Built-in role definition IDs
var roleAcrPull = '7f951dda-4ed3-4680-a7ca-43fe172d538d'
var roleBlobDataContributor = 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
var roleSessionExecutor = '0fb8eba5-a2bb-4abe-b1c1-49dfad359bb0' // Azure ContainerApps Session Executor
var roleOpenAiUser = '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd' // Cognitive Services OpenAI User

// ---------- Observability ----------
resource law 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${base}-law'
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: '${base}-appi'
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: law.id
  }
}

// ---------- Identity, registry, storage ----------
resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${base}-api-id'
  location: location
}

resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: take(compact, 50)
  location: location
  sku: { name: 'Basic' }
  properties: { adminUserEnabled: false }
}

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: take('st${compact}', 24)
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    supportsHttpsTrafficOnly: true
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
}

resource datasetsContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'datasets'
  properties: { publicAccess: 'None' }
}

// ---------- Database ----------
resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2023-06-01-preview' = {
  name: '${base}-pg-${take(suffix, 6)}'
  location: postgresLocation
  sku: {
    name: 'Standard_B1ms'
    tier: 'Burstable'
  }
  properties: {
    version: '16'
    administratorLogin: 'wbadmin'
    administratorLoginPassword: postgresAdminPassword
    storage: { storageSizeGB: 32 }
    backup: {
      backupRetentionDays: 7
      geoRedundantBackup: 'Disabled'
    }
    highAvailability: { mode: 'Disabled' }
  }
}

// TODO: replace with a private endpoint / VNet integration + Entra auth once past the first deploy.
resource pgAllowAzure 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2023-06-01-preview' = {
  parent: postgres
  name: 'AllowAzureServices'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

resource pgDatabase 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2023-06-01-preview' = {
  parent: postgres
  name: 'correlaite'
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
}

// ---------- Email (magic links) ----------
resource emailService 'Microsoft.Communication/emailServices@2023-04-01' = {
  name: '${base}-email'
  location: 'global'
  properties: { dataLocation: 'Europe' }
}

resource emailDomain 'Microsoft.Communication/emailServices/domains@2023-04-01' = {
  parent: emailService
  name: 'AzureManagedDomain'
  location: 'global'
  properties: { domainManagement: 'AzureManaged' }
}

resource acs 'Microsoft.Communication/communicationServices@2023-04-01' = {
  name: '${base}-acs'
  location: 'global'
  properties: {
    dataLocation: 'Europe'
    linkedDomains: [emailDomain.id]
  }
}

// Diagnostic setting that feeds the Email insights workbook on the Communication Services resource.
// Same Log Analytics workspace as Application Insights. Tables: ACSEmailSendMailOperational,
// ACSEmailStatusUpdateOperational, ACSEmailUserEngagementOperational.
resource acsDiagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: '${base}-acs-email-logs'
  scope: acs
  properties: {
    workspaceId: law.id
    logAnalyticsDestinationType: 'Dedicated'
    logs: [
      { category: 'EmailSendMailOperational', enabled: true } // Email Service Send Mail logs
      { category: 'EmailStatusUpdateOperational', enabled: true } // Email Service Delivery Status Update Logs
      { category: 'EmailUserEngagementOperational', enabled: true } // Email Service User Engagement Logs
    ]
  }
}

// ---------- Code sandbox: no internet access ----------
resource sessionPool 'Microsoft.App/sessionPools@2024-02-02-preview' = {
  name: '${base}-sandbox'
  location: location
  properties: {
    poolManagementType: 'Dynamic'
    containerType: 'PythonLTS'
    scaleConfiguration: {
      maxConcurrentSessions: 20
      readySessionInstances: 0
    }
    dynamicPoolConfiguration: {
      executionType: 'Timed'
      cooldownPeriodInSeconds: 300
    }
    sessionNetworkConfiguration: { status: 'EgressDisabled' }
  }
}

// ---------- AI model (Azure OpenAI), accessed by the API through its managed identity ----------
resource openAi 'Microsoft.CognitiveServices/accounts@2024-10-01' = if (createOpenAi) {
  name: take('${base}-oai-${take(suffix, 6)}', 64)
  location: openAiLocation
  kind: 'OpenAI'
  sku: { name: 'S0' }
  properties: {
    customSubDomainName: take('${base}-oai-${take(suffix, 6)}', 64)
    publicNetworkAccess: 'Enabled'
    disableLocalAuth: true
  }
}

resource openAiDeployment 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = if (createOpenAi) {
  parent: openAi
  name: openAiDeploymentName
  sku: {
    name: openAiSkuName
    capacity: openAiCapacity
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: openAiModelName
      version: openAiModelVersion
    }
  }
}

resource rbacOpenAi 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (createOpenAi) {
  name: guid(openAi.id, identity.id, roleOpenAiUser)
  scope: openAi
  properties: {
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleOpenAiUser)
  }
}

// ---------- Static Web App (frontend) ----------
resource swa 'Microsoft.Web/staticSites@2023-12-01' = {
  name: '${base}-web'
  location: swaLocation
  sku: {
    name: 'Standard'
    tier: 'Standard'
  }
  properties: {}
}

// ---------- API (Container Apps) ----------
resource cae 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: '${base}-cae'
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: law.properties.customerId
        sharedKey: law.listKeys().primarySharedKey
      }
    }
  }
}

resource rbacAcrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, identity.id, roleAcrPull)
  scope: acr
  properties: {
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleAcrPull)
  }
}

resource rbacBlob 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, identity.id, roleBlobDataContributor)
  scope: storage
  properties: {
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleBlobDataContributor)
  }
}

resource rbacSession 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(sessionPool.id, identity.id, roleSessionExecutor)
  scope: sessionPool
  properties: {
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleSessionExecutor)
  }
}

var publicUrl = empty(appUrl) ? 'https://${swa.properties.defaultHostname}' : appUrl

resource api 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${base}-api'
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${identity.id}': {} }
  }
  dependsOn: [rbacAcrPull, rbacOpenAi, openAiDeployment]
  properties: {
    managedEnvironmentId: cae.id
    configuration: {
      ingress: {
        external: true
        targetPort: 8080
        transport: 'auto'
      }
      registries: [
        {
          server: acr.properties.loginServer
          identity: identity.id
        }
      ]
      secrets: concat(
        [
          {
            name: 'database-url'
            value: 'postgres://wbadmin:${uriComponent(postgresAdminPassword)}@${postgres.properties.fullyQualifiedDomainName}:5432/correlaite'
          }
          {
            name: 'acs-connection'
            value: acs.listKeys().primaryConnectionString
          }
        ],
        empty(alphaVantageApiKey) ? [] : [
          {
            name: 'alphavantage-key'
            value: alphaVantageApiKey
          }
        ]
      )
    }
    template: {
      containers: [
        {
          name: 'api'
          image: apiImage
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: concat([
            { name: 'NODE_ENV', value: 'production' }
            { name: 'PORT', value: '8080' }
            { name: 'APP_URL', value: publicUrl }
            { name: 'DATABASE_SSL', value: 'true' }
            { name: 'DATABASE_URL', secretRef: 'database-url' }
            { name: 'ADMIN_EMAILS', value: adminEmails }
            { name: 'ACS_CONNECTION_STRING', secretRef: 'acs-connection' }
            { name: 'EMAIL_SENDER', value: 'DoNotReply@${emailDomain.properties.mailFromSenderDomain}' }
            { name: 'STORAGE_ACCOUNT_URL', value: storage.properties.primaryEndpoints.blob }
            { name: 'STORAGE_CONTAINER', value: 'datasets' }
            { name: 'SANDBOX_POOL_ENDPOINT', value: sessionPool.properties.poolManagementEndpoint }
            { name: 'AZURE_OPENAI_ENDPOINT', value: createOpenAi ? openAi.properties.endpoint : azureOpenAiEndpoint }
            { name: 'AZURE_OPENAI_DEPLOYMENT', value: createOpenAi ? openAiDeployment.name : azureOpenAiDeployment }
            { name: 'AZURE_CLIENT_ID', value: identity.properties.clientId }
            { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsights.properties.ConnectionString }
            { name: 'OTEL_SERVICE_NAME', value: 'correlaite-api' } // cloud role name in Application Insights
          ], empty(alphaVantageApiKey) ? [] : [
            { name: 'ALPHAVANTAGE_API_KEY', secretRef: 'alphavantage-key' }
          ])
        }
      ]
      scale: {
        minReplicas: isProd ? 1 : 0
        maxReplicas: 5
        rules: [
          {
            name: 'http'
            http: { metadata: { concurrentRequests: '50' } }
          }
        ]
      }
    }
  }
}

// Same-origin: the Static Web App forwards /api/* to the Container App.
resource swaBackend 'Microsoft.Web/staticSites/linkedBackends@2023-12-01' = {
  parent: swa
  name: 'api'
  properties: {
    backendResourceId: api.id
    region: location
  }
}

output acrName string = acr.name
output acrLoginServer string = acr.properties.loginServer
output apiAppName string = api.name
output swaName string = swa.name
output siteUrl string = publicUrl
// Not a secret: it is embedded in the browser bundle so page views reach Application Insights.
output appInsightsConnectionString string = appInsights.properties.ConnectionString
output openAiEndpoint string = createOpenAi ? openAi.properties.endpoint : azureOpenAiEndpoint
