/**
 * Which failures of the store mean that it cannot serve right now, as against a defect in what it was
 * asked. The first is told to a person plainly and answered 503, which a probe or a client can retry
 * (`errors.ts`); the second stays an internal error.
 *
 * A failure is told apart by its class and by the code the driver gives it, never by what its message
 * says: a message can carry a host, a statement or a credential, and the next driver words it
 * differently. Everything here is a closed list, so a failure that is not on it is a defect until
 * someone decides otherwise. This file imports nothing, so that `errors.ts` can use it.
 */

/**
 * A failure reported by the database, with its SQLSTATE, or the code of the system error (such as
 * `ECONNREFUSED`) when the driver never reached the server, so that callers can tell kinds apart.
 */
export class DatabaseError extends Error {
  constructor(
    message: string,
    readonly code: string | null,
  ) {
    super(message);
    this.name = 'DatabaseError';
  }
}

/**
 * SQLSTATE classes in which PostgreSQL says that it, and not the statement, is the trouble: a login
 * that was refused, as when the token of a managed identity lapsed (28), a resource that ran out, such
 * as disk, memory or connections (53), and an operator or a time limit that stopped the work, such as
 * a shutdown or a statement that ran past its timeout (57).
 */
const SQLSTATE_CLASSES: ReadonlySet<string> = new Set(['28', '53', '57']);

/**
 * SQLSTATEs outside those classes that mean the same: a connection that failed, could not be made,
 * does not exist, was refused or ended with its outcome unknown (08000, 08001, 08003, 08004, 08006,
 * 08007), a server that turned read-only, as one does when it fails over (25006), a transaction that
 * lost its race more often than it is run again (40001, 40P01), and a lock that was not given in time
 * (55P03). Class 08 is not taken whole: 08P01 is a protocol violation, such as a statement sent with
 * the wrong number of parameters, which is a defect of ours and must stay a 500.
 */
const SQLSTATES: ReadonlySet<string> = new Set([
  '08000',
  '08001',
  '08003',
  '08004',
  '08006',
  '08007',
  '25006',
  '40001',
  '40P01',
  '55P03',
]);

/** What the network reports when the server cannot be reached, or stops answering, or is not found by name. */
const SYSTEM_CODES: ReadonlySet<string> = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ECONNABORTED',
  'ETIMEDOUT',
  'EPIPE',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EAI_AGAIN',
]);

/**
 * SQLite's primary result codes for a database that is held by another connection for longer than
 * `busy_timeout` (BUSY 5, LOCKED 6), or cannot be used as it is: read-only (8), a failing disk (IOERR
 * 10), a full one (FULL 13), a file that cannot be opened (CANTOPEN 14). A corrupt file is not here:
 * waiting does not mend it.
 */
const SQLITE_RESULTS: ReadonlySet<number> = new Set([5, 6, 8, 10, 13, 14]);

const SQLSTATE = /^[0-9A-Z]{5}$/u;

/**
 * `node:sqlite` has no error class of its own: it throws an `Error` whose `code` is `ERR_SQLITE_ERROR`
 * and whose `errcode` is SQLite's result code, the low byte of which is the primary one.
 */
function sqliteCannotServe(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const { code, errcode } = error as Error & { code?: unknown; errcode?: unknown };
  return (
    code === 'ERR_SQLITE_ERROR' && typeof errcode === 'number' && SQLITE_RESULTS.has(errcode & 0xff)
  );
}

/** True when `error` is the store being unable to serve: unreachable, too slow, out of resources or held by others. */
export function isStorageUnavailable(error: unknown): boolean {
  if (error instanceof DatabaseError) {
    const { code } = error;
    return (
      code !== null &&
      (SYSTEM_CODES.has(code) ||
        SQLSTATES.has(code) ||
        (SQLSTATE.test(code) && SQLSTATE_CLASSES.has(code.slice(0, 2))))
    );
  }
  return sqliteCannotServe(error);
}
