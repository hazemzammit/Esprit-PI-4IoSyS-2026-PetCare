import * as Sentry from '@sentry/node';

/**
 * Initialize Sentry for backend services
 * Call this in each service's app.ts before starting the server
 */
export function initSentry(serviceName: string): void {
  const dsn = process.env.SENTRY_DSN;

  // Skip initialization if DSN is not provided
  if (!dsn || dsn === 'YOUR_SENTRY_DSN_HERE') {
    console.log(`[${serviceName}] Sentry: DSN not provided, skipping initialization`);
    return;
  }

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    release: `${serviceName}@${process.env.npm_package_version || '1.0.0'}`,
    
    // Performance monitoring
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
    
    // Before send callback for filtering
    beforeSend(event, hint) {
      // Filter out certain errors if needed
      if (event.exception) {
        const exception = hint.originalException as any;
        // Example: filter out network timeout errors
        if (exception?.code === 'ECONNRESET' || exception?.code === 'ETIMEDOUT') {
          return null;
        }
      }
      return event;
    },
  });

  console.log(`[${serviceName}] Sentry initialized successfully`);
}

/**
 * Capture an exception
 */
export function captureException(error: Error, context?: Record<string, any>): void {
  Sentry.captureException(error, { extra: context });
}

/**
 * Capture a message
 */
export function captureMessage(message: string, level: 'info' | 'warning' | 'error' = 'info'): void {
  Sentry.captureMessage(message, { level });
}

/**
 * Add breadcrumb for tracking user actions
 */
export function addBreadcrumb(message: string, category: string = 'user', data?: Record<string, any>): void {
  Sentry.addBreadcrumb({
    message,
    category,
    data,
  });
}

/**
 * Set user context
 */
export function setUser(id: string, email?: string, username?: string): void {
  Sentry.setUser({ id, email, username });
}

/**
 * Set custom context
 */
export function setContext(key: string, value: Record<string, any>): void {
  Sentry.setContext(key, value);
}

/**
 * Start a performance transaction
 */
export function startTransaction(name: string, operation: string = 'custom'): any {
  return Sentry.startSpan({ name, op: operation }, (span) => {
    return span;
  });
}
