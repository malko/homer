/**
 * Validation helpers for values that get interpolated into Docker shell
 * commands (`exec`) or passed as argv to `docker`.
 *
 * These routes are reachable both by locally-authenticated users AND by paired
 * federation peers (the peer-proxy hook bypasses the session check for signed
 * peer requests). A malicious/compromised peer — which is only supposed to be
 * able to manage containers — must not be able to turn a container id into
 * arbitrary host command execution. Rejecting shell metacharacters and leading
 * dashes (argument injection) closes that gap while accepting every value Docker
 * itself considers valid.
 */

export class InvalidDockerArgError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidDockerArgError';
  }
}

// Container ids/names, volume names and network names all share Docker's
// reference charset: an alphanumeric first character followed by
// alphanumerics, `_`, `.` or `-`. The leading-alphanumeric rule also prevents
// a value from being interpreted as a CLI flag (argument injection).
const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;

// Image references additionally allow `/` (namespaces), `:` (tag / registry
// port) and `@` (digest). Still no shell metacharacters, whitespace or leading
// dash.
const IMAGE_REF_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.\-/:@]*$/;

const MAX_LEN = 512;

function assert(re: RegExp, value: unknown, kind: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_LEN || !re.test(value)) {
    throw new InvalidDockerArgError(`Invalid Docker ${kind}: ${JSON.stringify(value)}`);
  }
  return value;
}

/** Container id or name, volume name, or network name. */
export function assertValidId(value: unknown): string {
  return assert(NAME_RE, value, 'identifier');
}

/** Image reference such as `nginx`, `nginx:1.25`, `ghcr.io/org/app:tag` or a `sha256:` id. */
export function assertValidImageRef(value: unknown): string {
  return assert(IMAGE_REF_RE, value, 'image reference');
}

/** True when the value is a safe Docker identifier (non-throwing variant). */
export function isValidId(value: unknown): boolean {
  return typeof value === 'string' && NAME_RE.test(value) && value.length <= MAX_LEN;
}
