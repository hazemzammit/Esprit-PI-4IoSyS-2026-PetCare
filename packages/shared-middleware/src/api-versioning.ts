import { Request, Response, NextFunction } from 'express';

/**
 * API Versioning Middleware
 * 
 * Supports multiple API versions through URL path versioning (e.g., /api/v1/, /api/v2/)
 * and header-based versioning (API-Version header).
 * 
 * Versioning Strategy:
 * - URL Path Versioning: /api/v1/resource, /api/v2/resource
 * - Header Versioning: API-Version: 1, API-Version: 2
 * - Default version: v1
 * - Deprecation warnings for old versions
 */

const SUPPORTED_VERSIONS = ['v1', 'v2'] as const;
const DEFAULT_VERSION = 'v1';
const DEPRECATED_VERSIONS: Record<string, string> = {
  v1: '2025-12-31', // v1 will be deprecated on this date
};

type ApiVersion = (typeof SUPPORTED_VERSIONS)[number];

interface VersionedRequest extends Request {
  apiVersion?: ApiVersion;
  isDeprecated?: boolean;
}

/**
 * Extract API version from request
 */
function extractApiVersion(req: Request): ApiVersion {
  // Check URL path version (e.g., /api/v1/resource)
  const pathMatch = req.path.match(/\/api\/(v\d+)\//);
  if (pathMatch) {
    const version = pathMatch[1] as ApiVersion;
    if (SUPPORTED_VERSIONS.includes(version)) {
      return version;
    }
  }

  // Check header version
  const headerVersion = req.headers['api-version'] as string;
  if (headerVersion) {
    const version = headerVersion.startsWith('v') ? headerVersion as ApiVersion : `v${headerVersion}` as ApiVersion;
    if (SUPPORTED_VERSIONS.includes(version)) {
      return version;
    }
  }

  // Default to v1
  return DEFAULT_VERSION;
}

/**
 * API Versioning Middleware
 * 
 * Adds apiVersion and isDeprecated to the request object
 */
export function apiVersioning(req: VersionedRequest, res: Response, next: NextFunction) {
  const version = extractApiVersion(req);
  req.apiVersion = version;
  req.isDeprecated = DEPRECATED_VERSIONS[version] !== undefined;

  // Add deprecation warning header if version is deprecated
  if (req.isDeprecated) {
    const deprecationDate = DEPRECATED_VERSIONS[version];
    res.setHeader('X-API-Deprecated', 'true');
    res.setHeader('X-API-Deprecation-Date', deprecationDate);
    res.setHeader('X-API-Sunset', deprecationDate);
  }

  // Add current API version header
  res.setHeader('X-API-Version', version);

  next();
}

/**
 * Require minimum API version
 * 
 * Use this middleware to require a minimum version for specific endpoints
 */
export function requireMinVersion(minVersion: ApiVersion) {
  const versionOrder = SUPPORTED_VERSIONS;
  const minIndex = versionOrder.indexOf(minVersion);

  return (req: VersionedRequest, res: Response, next: NextFunction) => {
    const currentVersion = req.apiVersion || DEFAULT_VERSION;
    const currentIndex = versionOrder.indexOf(currentVersion);

    if (currentIndex < minIndex) {
      return res.status(400).json({
        success: false,
        error: {
          message: `This endpoint requires API version ${minVersion} or higher`,
          currentVersion,
          requiredVersion: minVersion,
        },
      });
    }

    next();
  };
}

/**
 * Require maximum API version
 * 
 * Use this middleware to limit endpoints to specific versions
 */
export function requireMaxVersion(maxVersion: ApiVersion) {
  const versionOrder = SUPPORTED_VERSIONS;
  const maxIndex = versionOrder.indexOf(maxVersion);

  return (req: VersionedRequest, res: Response, next: NextFunction) => {
    const currentVersion = req.apiVersion || DEFAULT_VERSION;
    const currentIndex = versionOrder.indexOf(currentVersion);

    if (currentIndex > maxIndex) {
      return res.status(400).json({
        success: false,
        error: {
          message: `This endpoint is not available in API version ${currentVersion}`,
          currentVersion,
          maxVersion,
        },
      });
    }

    next();
  };
}

/**
 * Version-specific route handler
 * 
 * Execute different handlers based on API version
 */
export function versionHandlers(handlers: Record<ApiVersion, (req: Request, res: Response, next: NextFunction) => void>) {
  return (req: VersionedRequest, res: Response, next: NextFunction) => {
    const version = req.apiVersion || DEFAULT_VERSION;
    const handler = handlers[version] || handlers[DEFAULT_VERSION];
    
    if (handler) {
      handler(req, res, next);
    } else {
      next();
    }
  };
}

/**
 * Get API version info
 */
export function getVersionInfo() {
  return {
    supportedVersions: SUPPORTED_VERSIONS,
    defaultVersion: DEFAULT_VERSION,
    deprecatedVersions: DEPRECATED_VERSIONS,
  };
}
