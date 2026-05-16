import { Request, Response, NextFunction } from 'express';

/**
 * Recursively remove keys starting with '$' or containing '.'
 * from an object to prevent MongoDB operator injection.
 */
function sanitizeObject(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeObject);

  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    // Strip keys starting with '$' (MongoDB operators)
    if (key.startsWith('$')) continue;
    // Strip keys containing '.' (dot-notation field access)
    if (key.includes('.')) continue;
    clean[key] = sanitizeObject(value);
  }
  return clean;
}

/**
 * Express middleware that sanitizes req.body, req.query, and req.params
 * to prevent NoSQL injection attacks.
 *
 * Usage: `app.use(mongoSanitize());`
 */
export function mongoSanitize() {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (req.body && typeof req.body === 'object') {
      req.body = sanitizeObject(req.body);
    }
    if (req.query && typeof req.query === 'object') {
      req.query = sanitizeObject(req.query) as Record<string, string>;
    }
    if (req.params && typeof req.params === 'object') {
      req.params = sanitizeObject(req.params) as Record<string, string>;
    }
    next();
  };
}

/**
 * Strip HTML tags from string values to prevent XSS.
 * Operates recursively on objects and arrays.
 */
function stripHtml(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') {
    return obj.replace(/<[^>]*>/g, '').replace(/[<>]/g, '');
  }
  if (Array.isArray(obj)) return obj.map(stripHtml);
  if (typeof obj === 'object') {
    const clean: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      clean[key] = stripHtml(value);
    }
    return clean;
  }
  return obj;
}

/**
 * Express middleware that strips HTML tags from req.body string values
 * to prevent stored XSS attacks.
 *
 * Usage: `app.use(xssSanitize());`
 */
export function xssSanitize() {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (req.body && typeof req.body === 'object') {
      req.body = stripHtml(req.body);
    }
    next();
  };
}
