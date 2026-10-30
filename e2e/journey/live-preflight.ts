// Runs once before the live journey. It refuses to start when the server is not the one the
// presentation needs, so that a journey never "passes" against something else.

interface ProviderStatus {
  mode: string;
  provider: string;
  model: string | null;
  auth: string;
  configured: boolean;
}

async function get<T>(base: string, path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(new URL(path, base), { ...init, signal: AbortSignal.timeout(180_000) });
  } catch {
    throw new Error(`Nothing answered at ${base}. Start the server first (npm start).`);
  }
  if (!response.ok) throw new Error(`${path} answered ${response.status}.`);
  return (await response.json()) as T;
}

export default async function preflight(): Promise<void> {
  const base = process.env.JOURNEY_URL;
  if (!base) return;
  await get(base, '/api/health');
  const status = await get<ProviderStatus>(base, '/api/provider/status');
  // Only the mode, the provider, the deployment name and the sign-in kind: no endpoint, no account.
  console.log(
    `Live journey: ${status.provider} / ${status.model ?? 'no deployment'}, ${status.mode}, ${status.auth} sign-in.`,
  );
  if (status.mode !== 'real-model' && process.env.JOURNEY_ALLOW_LOCAL !== '1') {
    throw new Error(
      `This server is in ${status.mode} mode. The live journey is for the real model: configure it (docs/AZURE.md), or set JOURNEY_ALLOW_LOCAL=1 to run it anyway.`,
    );
  }
  if (status.mode === 'real-model' && process.env.JOURNEY_ASK !== '0') {
    // One tiny real request, so that an expired sign-in fails here and not eight minutes in.
    const checked = await get<{ connectivity: string }>(base, '/api/provider/check', {
      method: 'POST',
    });
    if (checked.connectivity !== 'ok') {
      throw new Error(`The real model did not answer (${checked.connectivity}).`);
    }
    console.log('Live journey: a real round trip to the model succeeded.');
  }
}
