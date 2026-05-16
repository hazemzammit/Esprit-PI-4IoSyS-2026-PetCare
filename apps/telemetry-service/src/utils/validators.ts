import { z } from 'zod';

// ─── Telemetry Ingestion ────────────────────────────────────────────────────

export const ingestTelemetrySchema = z.object({
  pet_id: z.string().min(1, 'pet_id is required'),
  device_id: z.string().optional(),
  type: z.enum([
    'heart_rate',
    'temperature',
    'spo2',
    'weight',
    'activity',
    'activity_steps',
    'activity_distance',
    'location',
  ]),
  value: z.union([z.number(), z.record(z.unknown())]),
  timestamp: z.string().datetime().or(z.number()).optional(),
});

// ─── Health History Query ───────────────────────────────────────────────────

export const healthHistoryQuerySchema = z.object({
  type: z
    .enum(['heart_rate', 'temperature', 'spo2', 'weight', 'activity'])
    .optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().min(1).max(1000).optional(),
});

// ─── Weight History Query ───────────────────────────────────────────────────

export const weightHistoryQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(365).optional(),
});
