import { Response } from 'express';

export const ok = <T>(res: Response, data: T, message = 'Success', statusCode = 200): void => {
  res.status(statusCode).json({
    success: true,
    data,
    message,
    timestamp: new Date().toISOString(),
  });
};

export const created = <T>(res: Response, data: T, message = 'Created'): void => {
  ok(res, data, message, 201);
};

export const noData = (res: Response, message = 'Success'): void => {
  res.status(200).json({
    success: true,
    data: null,
    message,
    timestamp: new Date().toISOString(),
  });
};

export const ApiResponse = {
  success: <T>(data: T, message = 'Success') => ({
    success: true as const,
    data,
    message,
    timestamp: new Date().toISOString(),
  }),
  error: (message = 'Error', code = 'INTERNAL_ERROR') => ({
    success: false as const,
    error: { code, message },
    timestamp: new Date().toISOString(),
  }),
  ok,
  created,
  noData,
};
