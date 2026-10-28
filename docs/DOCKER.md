# Docker (optional)

Back to the [README](../README.md).

Requires Docker with its engine running and Compose supporting optional `env_file`
entries (2.24+). No `.env` is necessary for the local rules engine:

```powershell
docker compose up --build -d
```

Open <http://127.0.0.1:3001>. The image builds the frontend/backend, runs as a
non-root user, serves one port, and persists SQLite in the `swarm-data` named
volume. Compose publishes only on loopback, drops Linux capabilities and limits
container CPU/memory. `docker compose down` retains the named data volume.
Avoid `down --volumes` unless intentionally deleting that data.

Model credentials, if used, enter through the ignored `.env`/container environment,
never the image. Host Ollama must be reachable from the container; Compose uses
`DOCKER_OLLAMA_BASE_URL=http://host.docker.internal:11434`. No model is downloaded
automatically. Do not expose Ollama publicly merely to connect a container.
