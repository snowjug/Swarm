# Swarm Lab

A local-first scenario workbench inspired by MiroFish's document → knowledge graph
→ agent simulation → report → interaction workflow. Independently implemented in
React and TypeScript. See [ARCHITECTURE.md](./ARCHITECTURE.md) for the reference
analysis, design boundaries, and Azure migration direction.

**Simulation is not prediction.** Synthetic personas do not represent real
people's beliefs. Outputs are conditional on the provided evidence and modeling
assumptions, not calibrated probabilities or decision-making guarantees.

## Engine modes

- **Local / rules-based:** no API keys, cloud services, model download, or network
  calls. Real term/co-occurrence extraction, sparse-vector retrieval, seeded
  opinion dynamics, computed reports and evidence lookup. Not AI-generated.
- **Model-assisted:** explicitly selected per project. Actual model requests for
  knowledge/personas, round decisions, reporting and interviews. Provider errors
  are surfaced; there is no fabricated response or silent fallback.

The first milestone accepts UTF-8 TXT and Markdown, not PDF or scanned documents.
No webpage crawling, live Twitter/Reddit connection, or shell access is provided.

## Prerequisites and setup

- Node.js **24+**, npm, and Git.
- A model provider only if using model-assisted mode.
- Docker is optional; the Docker engine must actually be running.

From the project root on Windows:

```powershell
npm.cmd install
Copy-Item .env.example .env
npm.cmd run dev
```

`npm.cmd` avoids the PowerShell `npm.ps1` execution-policy issue without changing
your machine's execution policy. On other platforms use `npm`.

- Frontend: <http://127.0.0.1:5173>
- Backend: <http://127.0.0.1:3001/api/health>

Run separately with `npm.cmd run dev:frontend` and `npm.cmd run dev:backend`.
Once a lockfile is present, use `npm.cmd ci` for reproducible installations.
Operational and verification instructions are maintained as implementation proceeds.

## Configuration

Copy [.env.example](./.env.example) locally. Never commit the resulting `.env`
or paste keys into chat/source files. Server configuration is never bundled into
the browser. The default is `AI_PROVIDER=none`.

| Variable | Purpose |
| --- | --- |
| `HOST`, `PORT` | API bind address/port; defaults to loopback and 3001 |
| `DATA_DIR` | SQLite storage directory, relative to the process working directory |
| `ALLOWED_ORIGINS`, `ALLOWED_HOSTS` | Explicit browser-origin and HTTP-host allowlists |
| `LOG_LEVEL` | Server log level; request bodies and credentials are not logged |
| `AI_PROVIDER` | `none`, `ollama`, `openai`, or `azure` |
| `AI_MODEL` | Local/remote model name; Azure deployment name for `azure` |
| `AI_TIMEOUT_MS` | Per-model-request timeout |
| `OLLAMA_BASE_URL` | Administrator-configured local Ollama endpoint |
| `OPENAI_BASE_URL`, `OPENAI_API_KEY` | Trusted compatible v1 endpoint and server-side key |
| `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY` | Azure resource/v1 endpoint and server-side key |
| `SOURCE_URL` | Public corresponding source for the exact remotely deployed version |

### Ollama (optional, no paid API)

Install Ollama separately, start its service, and download a model suitable for
your available RAM, for example `ollama pull qwen3:8b`. Model weights are a separate
download and retain their own license. Configure:

```dotenv
AI_PROVIDER=ollama
AI_MODEL=qwen3:8b
OLLAMA_BASE_URL=http://127.0.0.1:11434
```

Restart the backend. Local engine mode still does not call Ollama. JSON generation
quality, hardware capacity, context limits and inference speed vary by model.

### Azure OpenAI / Foundry

Deploy an OpenAI-compatible chat model with JSON output support. In your local,
ignored `.env`, set `AI_PROVIDER=azure`, `AI_MODEL` to the deployment name,
`AZURE_OPENAI_ENDPOINT` to your resource root or `/openai/v1/` endpoint, and
`AZURE_OPENAI_API_KEY` to its key. Never put the key in frontend variables.
The v1 API does not require a dated `api-version` query parameter.
Managed-identity authentication is a future production migration, not implemented
by this local API-key adapter.

### Other OpenAI-compatible providers

Set `AI_PROVIDER=openai`, `AI_MODEL`, `OPENAI_BASE_URL` (including the v1-compatible
base path), and `OPENAI_API_KEY`. The endpoint must support JSON Chat Completions.
Only administrator-controlled configuration can select endpoints; input documents
cannot request arbitrary URLs or tools.

## Licensing

[AGPL-3.0-only](./LICENSE). See [NOTICE.md](./NOTICE.md) for reference attribution
and source-availability obligations. No MiroFish application code or brand assets
are included.
