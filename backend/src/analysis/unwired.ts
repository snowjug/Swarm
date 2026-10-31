import type { Simulator } from '../../../shared/analysis.js';
import { AppError } from '../errors.js';

/**
 * Stands in where the simulation engine has not been connected. It refuses, plainly, and never makes
 * up an outcome, so a comparison started against it fails with this message and nothing else.
 */
export const unwiredSimulator: Simulator = () => {
  throw new AppError(
    503,
    'SIMULATOR_NOT_CONNECTED',
    'The simulation engine is not connected in this build, so scenarios cannot be compared yet.',
  );
};
