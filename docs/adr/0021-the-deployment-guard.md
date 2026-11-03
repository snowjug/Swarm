# 0021. A hosted process refuses an unsafe configuration: the deployment guard

Status: Accepted. Built and unit tested (`backend/test/deployment.test.ts`). **Never run in a deployed
environment**: nothing in Azure has started with it, and the template that would set `DEPLOYMENT_MODE` has not
been deployed.

## Context

Swarm's defaults are permissive on purpose, so that one person can run it on their own machine with nothing
configured: no sign-in, a SQLite file, `localhost` as the only host, plain HTTP allowed for pages, a model key
accepted. Every one of them is wrong for a hosted process, and the failure is silent: nothing stops a server
that people can reach from starting without sign-in, with a model key in its environment, with debug logging
or with a setting that exists for tests. A checklist that a person reads can be skipped. A process that refuses to
start cannot be.

## Decision

1. **A mode.** `DEPLOYMENT_MODE` is `local` (the default), `pilot` or `production`. An empty or unknown value
   is refused, because a deployment that was meant to be hosted and has the mode wrong is the commonest mistake.
2. **The rules run while the configuration is read** (`loadConfig`, through `withDeployment`), so no process
   that listens has an unsafe one. A refusal (`DeploymentRefused`) lists every violation at once, one error with
   a line for each, naming the setting and what to do. It repeats no credential, address or connection string,
   because a value may be a secret; a test plants a canary in every setting and reads the message.
3. **One function for each topic**, so that a rule is found by what it is about: sign-in (Microsoft Entra, an
   https sign-in address, bounded sessions, Microsoft's key endpoint only), model credentials, the database (TLS,
   and in `production` PostgreSQL with a managed identity), the hosts, origins and proxy count served, page reads
   (https only, no switch that allows plain HTTP, a loopback or a private address, no private suffix in the
   allow-list), and operations (a valid Application Insights connection string, no debug logging in
   `production`, per-address limits not raised, no setting that exists for tests or demonstrations, certificate
   checking on). Every rule and its reason is in [the guard matrix](../production/identity.md#1-deployment-modes).
4. **A pilot may decide what production may not.** A pilot may use a SQLite file or a database password, with a
   warning for each, and a model API key only when `ALLOW_MODEL_API_KEY` is the word `true`; production refuses
   all three, and refuses a model key that is set and not used. A pilot may log at debug level, and may log
   silently only with a warning; production refuses debug.
5. **Hosted defaults.** With no `URL_INGEST_ALLOWED_PORTS`, a pilot or production process reads pages on port
   443 only. A local run keeps 80 and 443.
6. **Local is untouched.** It is exactly as permissive as it always was. When its settings look hosted (a host
   that is not this machine, an https sign-in address, a database on another machine) it still starts, and logs one
   warning that none of the pilot or production checks ran.
7. **The product says what it is.** `DEPLOYMENT_LABEL` is plain text, judged after Unicode normalisation. A
   pilot's default is `PRODUCTION-CANDIDATE CONTROLLED PILOT`, and a pilot's label must say it is a pilot and
   must not call itself production, generally available or public. A production deployment must give a label and
   must not call itself a pilot. `BUILD_SHA` (7 to 40 hexadecimal characters) names the build; a hosted start with
   a malformed one is refused, and a local run ignores it. Both are in `GET /api/config` for a signed-in caller as
   `deployment` and `build`, and in the monitoring as `swarm.deployment.info`.
8. **A switch that relaxes a fetch has a name the guard knows.** One named `RESEARCH_ALLOW_<WHAT>` or
   `URL_INGEST_ALLOW_<WHAT>`, with `<WHAT>` one of a listed set (`HTTP`, `INSECURE`, `PLAINTEXT`, `PRIVATE`,
   `LOOPBACK` and so on), is refused when it is on, without the guard having to know it. A switch named otherwise
   needs a line in `deployment.ts`. The code that reads a switch must read it strictly: a parser that makes any
   non-empty text true would disagree with the guard in the one direction it cannot see.

## Consequences

- The guard checks configuration, not where the process runs. It cannot know that `TRUST_PROXY` is the true
  number of proxies, that the database host is the right one, or that a connection string is the application's
  own. And `local` can always be chosen by whoever sets the environment: that is why a hosted-looking local run
  warns, and why the release check should read `deployment.mode` from `/api/config` and fail if it is not the
  one the template says.
- A new setting that loosens a rule needs a rule, or the naming convention above. The guard test is a table of
  rules, each applied to a baseline that a hosted deployment accepts and shown to be fixed by a change, so a new
  rule is a new row.
- The warnings (a SQLite file in a pilot, a database password in a pilot, a key that is not used, a client
  secret, silent logs, no `BUILD_SHA`) do not stop a start. They are logged once and never with a value.
- Nothing here has been seen to refuse a real deployment. The rules are tested against configurations built
  in tests.

## Evidence

`backend/test/deployment.test.ts`: the mode is `local` unless it is named; a local run keeps every value and
default it had and carries only its name; a hosted-looking local run starts and says so; a refusal lists every
violation in one error and repeats no credential, connection string or address; what a pilot may decide that
production may not; the label; the defaults of a hosted deployment; the private suffixes the allow-list
refuses (a test keeps them equal to the names the page fetcher itself refuses); what `/api/config` says and to
whom; and `swarm.deployment.info`. The specification is
[docs/production/identity.md](../production/identity.md#1-deployment-modes).
