import { FastifyRequest } from 'fastify';
import { sessionQueries } from '../db/index.js';

/**
 * Pure authorization decision, so the rule is unit-testable without Fastify or
 * the database. Signed peer requests are authenticated upstream by the
 * peer-proxy hook and bypass the session check.
 */
export function isRequestAuthorized(
  isPeerRequest: boolean,
  token: string | undefined,
  hasSession: (token: string) => boolean,
): boolean {
  if (isPeerRequest) return true;
  if (!token) return false;
  return hasSession(token);
}

export function bearerToken(authorization: string | undefined): string | undefined {
  if (!authorization || !authorization.startsWith('Bearer ')) return undefined;
  const token = authorization.slice('Bearer '.length).trim();
  return token || undefined;
}

/**
 * Shared preHandler enforcing a valid local session on protected routes.
 * Use everywhere instead of re-implementing the check per route file.
 */
export async function requireSession(request: FastifyRequest): Promise<void> {
  const token = bearerToken(request.headers.authorization);
  const ok = isRequestAuthorized(
    request.isPeerRequest,
    token,
    (t) => !!sessionQueries.getByToken(t),
  );
  if (!ok) {
    throw { statusCode: 401, message: 'Unauthorized' };
  }
}
