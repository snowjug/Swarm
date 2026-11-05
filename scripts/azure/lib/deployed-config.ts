import { PLACEHOLDER_IMAGE, type EnvVar, type ProbeInfo } from './containerapp.js';

/**
 * Is the deployed container configured the way the template configures a real image? The live pilot's
 * first revision was not: the placeholder had left PORT=80 and an ingress on port 80, the application
 * refuses a port below 1024 ("Invalid server configuration: PORT"), and the app carried no probes because
 * `az containerapp update` can change an image and an environment variable but has no flag for a probe.
 * Only reads are involved: this decides from what `az containerapp show` and `revision list` returned.
 *
 * What it cannot show: that the container answers. The smoke test and the health check do that.
 */

/** The port the application listens on (PORT defaults to it) and the ingress targets, in infra/pilot. */
export const APP_PORT = 3001;

/** The probes infra/pilot/modules/container-app.bicep sets, in the order it sets them. */
export const EXPECTED_PROBES = [
  { type: 'Startup', path: '/api/health/live' },
  { type: 'Liveness', path: '/api/health/live' },
  { type: 'Readiness', path: '/api/health/ready' },
] as const;

export type ConfigCheckId = 'ingress-port' | 'port-env' | 'probes';

export interface ConfigCheck {
  id: ConfigCheckId;
  title: string;
  status: 'pass' | 'fail';
  detail: string;
}

export interface ContainerConfig {
  image: string | null;
  /** The ingress target port of the app. */
  targetPort: number | null;
  env: readonly EnvVar[];
  probes: readonly ProbeInfo[];
}

export const isPlaceholderImage = (image: string | null): boolean =>
  image?.includes(PLACEHOLDER_IMAGE) === true;

export function checkContainerConfig(config: ContainerConfig): ConfigCheck[] {
  const checks: ConfigCheck[] = [];

  const ingress: ConfigCheck = {
    id: 'ingress-port',
    title: `The ingress sends traffic to port ${APP_PORT}`,
    status: config.targetPort === APP_PORT ? 'pass' : 'fail',
    detail:
      config.targetPort === APP_PORT
        ? `The ingress targets port ${APP_PORT}.`
        : `The ingress targets port ${config.targetPort ?? 'unknown'}, but the application listens on ${APP_PORT}: a revision would stay "Activating" while its health route answers.`,
  };
  checks.push(ingress);

  const port = config.env.find((entry) => entry.name === 'PORT');
  const portValue =
    port === undefined ? null : typeof port.value === 'string' ? port.value.trim() : '';
  let portDetail: string;
  let portStatus: ConfigCheck['status'] = 'fail';
  if (portValue === null) {
    portStatus = 'pass';
    portDetail = `PORT is not set, so the application uses its default, ${APP_PORT}.`;
  } else if (portValue === String(APP_PORT)) {
    portStatus = 'pass';
    portDetail = `PORT=${APP_PORT}.`;
  } else if (Number(portValue) < 1024 || !/^\d+$/u.test(portValue)) {
    portDetail = `PORT=${portValue || '(empty)'}: the application accepts only 1024 to 65535 and stops at start with "Invalid server configuration: PORT". It is the placeholder's setting, carried over by a revision made with az containerapp update.`;
  } else {
    portDetail = `PORT=${portValue}, but the ingress and the probes use ${APP_PORT}.`;
  }
  checks.push({
    id: 'port-env',
    title: `The application is told port ${APP_PORT}, or none`,
    status: portStatus,
    detail: portDetail,
  });

  const problems: string[] = [];
  for (const wanted of EXPECTED_PROBES) {
    const found = config.probes.filter(
      (probe) => probe.type?.toLowerCase() === wanted.type.toLowerCase(),
    );
    if (found.length === 0) {
      problems.push(`no ${wanted.type} probe`);
      continue;
    }
    for (const probe of found) {
      if (probe.path !== wanted.path)
        problems.push(
          `the ${wanted.type} probe asks ${probe.path ?? 'no path'}, not ${wanted.path}`,
        );
      if (probe.port !== APP_PORT)
        problems.push(
          `the ${wanted.type} probe uses port ${probe.port ?? 'none'}, not ${APP_PORT}`,
        );
    }
  }
  checks.push({
    id: 'probes',
    title: 'Startup, liveness and readiness probes are set on the health routes',
    status: problems.length === 0 ? 'pass' : 'fail',
    detail:
      problems.length === 0
        ? 'Startup and liveness ask /api/health/live, readiness asks /api/health/ready, all on the application port.'
        : `${problems.join('; ')}. Without them the platform only watches the port, and a hung or database-less replica keeps its traffic. az containerapp update cannot set probes: apply infra/pilot with the template.`,
  });

  return checks;
}

export const failedChecks = (checks: readonly ConfigCheck[]): ConfigCheck[] =>
  checks.filter((check) => check.status === 'fail');
