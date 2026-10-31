# Docker (optional)

Back to the [README](../README.md).

Requires Docker with its engine running and Compose supporting optional `env_file`
entries (2.24+). No `.env` is necessary for the local rules engine:

```powershell
docker compose up --build -d
```

Open <http://127.0.0.1:3001>. The image builds the frontend/backend (`npm run build`, which also writes a
Brotli and a gzip copy of each text asset of the console for the server to send to a browser that accepts
them), runs as a
non-root user, serves one port, and persists SQLite in the `swarm-data` named
volume. Compose publishes only on loopback, drops Linux capabilities and limits
container CPU/memory. `docker compose down` retains the named data volume.
Avoid `down --volumes` unless intentionally deleting that data.

Model credentials, if used, enter through the ignored `.env`/container environment,
never the image. Host Ollama must be reachable from the container; Compose uses
`DOCKER_OLLAMA_BASE_URL=http://host.docker.internal:11434`. No model is downloaded
automatically. Do not expose Ollama publicly merely to connect a container.

The whole scenario lab runs in the container in rules mode with nothing set: its results are documents
in the same `swarm-data` volume as everything else. Reading a public web page needs the container to
reach the internet, and the container's own network may also reach private addresses, so the
application's address policy is then the only guard: add an egress rule at the network as well (see the
[operator advice](./security/url-ingestion.md#operator-advice)), or set `URL_INGESTION=off` in `.env`
(Compose passes it through `env_file`) to turn the feature off. Pasting the text of a page works either
way.
