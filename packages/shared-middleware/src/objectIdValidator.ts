import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { ApiError } from './ApiError';

/**
 * Middleware factory: validate one or more route-params as MongoDB ObjectIds.
 *
 * Usage:
 *   router.get('/:id', validateObjectId('id'), controller.getById);
 *   router.get('/:petId/devices/:deviceId', validateObjectId('petId', 'deviceId'), ...);
 */
export function validateObjectId(...paramNames: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    for (const name of paramNames) {
      const value = req.params[name];
      if (value && !mongoose.Types.ObjectId.isValid(value)) {
        return next(
          new ApiError(
            `Invalid ${name}: "${value}" is not a valid ObjectId`,
            400,
            'INVALID_OBJECT_ID',
          ),
        );
      }
    }
    next();
  };
}
