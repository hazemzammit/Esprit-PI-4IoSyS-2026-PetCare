import { logger } from './logger';

/**
 * Lightweight circuit-breaker (no external deps).
 *
 * States:
 *   CLOSED  → calls pass through; failures counted
 *   OPEN    → calls rejected immediately; resets after `resetTimeout`
 *   HALF    → one probe call allowed; success → CLOSED, failure → OPEN
 *
 * Usage:
 *   const breaker = new CircuitBreaker('pet-service', { failureThreshold: 5 });
 *   const data = await breaker.fire(() => axios.get('...'));
 */

export interface CircuitBreakerOptions {
  /** Number of consecutive failures before opening (default 5) */
  failureThreshold?: number;
  /** Time in ms the circuit stays open before moving to half-open (default 30 000) */
  resetTimeout?: number;
  /** Optional name for logging */
  name?: string;
}

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private lastFailureTime = 0;
  private readonly failureThreshold: number;
  private readonly resetTimeout: number;
  private readonly name: string;

  constructor(name: string, opts?: CircuitBreakerOptions) {
    this.name = opts?.name ?? name;
    this.failureThreshold = opts?.failureThreshold ?? 5;
    this.resetTimeout = opts?.resetTimeout ?? 30_000;
  }

  /** Execute `fn` through the breaker. Throws on OPEN state. */
  async fire<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime >= this.resetTimeout) {
        this.state = 'HALF_OPEN';
        logger.info(`[CircuitBreaker:${this.name}] HALF_OPEN — probing`);
      } else {
        throw new Error(`Circuit breaker OPEN for ${this.name}`);
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private onSuccess(): void {
    if (this.state === 'HALF_OPEN') {
      logger.info(`[CircuitBreaker:${this.name}] CLOSED (probe succeeded)`);
    }
    this.failureCount = 0;
    this.state = 'CLOSED';
  }

  private onFailure(): void {
    this.failureCount += 1;
    this.lastFailureTime = Date.now();
    if (this.failureCount >= this.failureThreshold || this.state === 'HALF_OPEN') {
      this.state = 'OPEN';
      logger.warn(
        `[CircuitBreaker:${this.name}] OPEN after ${this.failureCount} failures — rejecting calls for ${this.resetTimeout}ms`,
      );
    }
  }

  /** Current state (for health endpoint). */
  getState(): CircuitState {
    return this.state;
  }

  /** Reset manually (e.g. on graceful recovery). */
  reset(): void {
    this.state = 'CLOSED';
    this.failureCount = 0;
  }
}
