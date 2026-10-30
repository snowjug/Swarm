using './main.bicep'

// Nothing environment-specific is stored in this file. Each value is read from an environment variable
// (`azd env set NAME value` for azd, `$env:NAME = 'value'` for az), and an unset variable gives an
// empty value: the template then rejects a required one before anything is created, and treats an
// optional one as "not set". Parameters that have a default (sizes, replicas, retention) are not listed;
// override one with `--parameters name=value`.

param environmentName = readEnvironmentVariable('AZURE_ENV_NAME', 'swarm-pilot')

// Required. The EXISTING Foundry / Azure OpenAI account the app calls (its resource ID).
param aiAccountResourceId = readEnvironmentVariable('SWARM_AI_ACCOUNT_RESOURCE_ID', '')
param aiDeploymentName = readEnvironmentVariable('SWARM_AI_DEPLOYMENT_NAME', 'swarm-chat')
// Optional. Empty derives https://<account name>.openai.azure.com/ from the resource ID.
param azureOpenAiEndpoint = readEnvironmentVariable('SWARM_AZURE_OPENAI_ENDPOINT', '')

// Required. Application (client) ID of the Microsoft Entra Web app registration people sign in with.
param authClientId = readEnvironmentVariable('SWARM_AUTH_CLIENT_ID', '')
// Optional. Empty uses the client ID.
param authAudience = readEnvironmentVariable('SWARM_AUTH_AUDIENCE', '')

// Optional. The public address of the exact source version deployed.
param sourceUrl = readEnvironmentVariable('SWARM_SOURCE_URL', '')

// Optional. Empty keeps the image that already runs, or starts a placeholder on the first provision.
param containerImage = readEnvironmentVariable('SWARM_CONTAINER_IMAGE', '')
// azd sets this to true once the app exists, so that `azd provision` does not reset its image.
param appExists = bool(readEnvironmentVariable('SERVICE_SWARM_RESOURCE_EXISTS', 'false'))
