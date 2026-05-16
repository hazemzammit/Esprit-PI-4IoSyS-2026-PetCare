import { logger } from '@petcare/shared-middleware';

const AUTH_SERVICE_URL = process.env.AUTH_URL || 'http://auth-service:3001';
const INTERNAL_KEY = process.env.INTERNAL_API_KEY || '';

interface AuditInput {
  actorUserId?: string;
  actorRole?: string;
  targetUserId?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  status?: 'success' | 'failure';
  metadata?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
}

/**
 * Record an audit event by calling the auth-service internal endpoint
 * This allows all microservices to contribute to the centralized audit log
 */
export async function recordAuditEvent(input: AuditInput): Promise<void> {
  try {
    const response = await fetch(`${AUTH_SERVICE_URL}/internal/audit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-key': INTERNAL_KEY,
      },
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      throw new Error(`Auth service responded with ${response.status}`);
    }
  } catch (err) {
    logger.error('[audit] failed to record event', err);
  }
}
