import { checkDatabaseConnection } from '../config/database.js';

export interface HealthResult {
  status: 'ok' | 'degraded';
  database: 'connected' | 'disconnected';
}

/**
 * Services are the only layer permitted to reach the database
 * (Constitution Principle III), so the ping lives here, not in the controller.
 */
export async function getHealth(): Promise<HealthResult> {
  const connected = await checkDatabaseConnection();

  return connected
    ? { status: 'ok', database: 'connected' }
    : { status: 'degraded', database: 'disconnected' };
}
