// Refuses a deployment that must not be made, BEFORE any resource of it is created.
//
// Bicep has no assert, and a parameter file cannot say "required when ...". What does work is this: every parameter
// below is a statement that must be true. main.bicep passes the result of a check, and Azure Resource Manager
// refuses the value false at validation, naming the parameter ("The provided value for the template parameter
// '<name>' is not valid ... not part of the allowed value(s): 'True'"). `bicep snapshot`, which
// `npm run iac:validate` and scripts/iac/public-invariants.test.ts use, evaluates the same check offline.
//
// Nothing in this template is created until all of these hold: main.bicep makes the resource group depend on this
// module. The parameter names are the messages; docs/public/DEPLOY.md says what each one means.
targetScope = 'subscription'

@description('The resource group and the environment name do not contain "pilot": this template must never be pointed at the pilot\'s resources.')
@allowed([true])
param resourceGroupAndEnvironmentAreNotThePilots bool

@description('aiAccountResourceId is the ID of an Azure OpenAI / Foundry account.')
@allowed([true])
param aiAccountResourceIdIsAnAccountId bool

@description('The free deployment is not named for a reasoning family (o1 to o9, gpt-5): the application refuses to start on one.')
@allowed([true])
param freeDeploymentNameIsNotAReasoningFamily bool

@description('The model BEHIND the free deployment, read from the account, is not of a reasoning family. Hidden reasoning tokens would eat the free tier\'s caps.')
@allowed([true])
param freeDeploymentModelIsNotAReasoningFamily bool

@description('publicBaseUrl is empty, or an https origin in lower case with no path, port, user or query.')
@allowed([true])
param publicBaseUrlIsAnHttpsOriginWithoutPath bool

@description('customDomainName is empty, or is the host of publicBaseUrl.')
@allowed([true])
param customDomainIsTheHostOfThePublicBaseUrl bool

@description('A custom domain is only declared together with the ID of its managed certificate.')
@allowed([true])
param customDomainHasACertificate bool

@description('When the app is deployed, guest mode is on or at least one of the Google and GitHub client IDs is set.')
@allowed([true])
param atLeastOneSignInProviderIsConfigured bool

@description('The hash of the owner key is empty (the owner routes are off) or is a SHA-256 in hexadecimal: 64 characters, each 0 to 9 or a to f. The application refuses to start on anything else.')
@allowed([true])
param ownerKeySha256IsEmptyOrSixtyFourHexDigits bool

@description('When the app is deployed, containerImage is given.')
@allowed([true])
param containerImageIsGivenWhenTheAppIsDeployed bool

output allHold bool = resourceGroupAndEnvironmentAreNotThePilots && aiAccountResourceIdIsAnAccountId && freeDeploymentNameIsNotAReasoningFamily && freeDeploymentModelIsNotAReasoningFamily && publicBaseUrlIsAnHttpsOriginWithoutPath && customDomainIsTheHostOfThePublicBaseUrl && customDomainHasACertificate && atLeastOneSignInProviderIsConfigured && ownerKeySha256IsEmptyOrSixtyFourHexDigits && containerImageIsGivenWhenTheAppIsDeployed
