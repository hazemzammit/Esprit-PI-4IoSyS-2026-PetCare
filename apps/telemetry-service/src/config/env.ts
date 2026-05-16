import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3003),

  MONGODB_URI: z.string().default('mongodb://localhost:27017/petcare_telemetry'),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // JWT (for Socket.IO auth — same secret as auth-service)
  JWT_SECRET: z.string().default('dev_jwt_secret_change_me'),

  // MQTT — accept both MQTT_BROKER_URL and MQTT_URL for compatibility
  MQTT_BROKER_URL: z.string().default('mqtt://localhost:1883'),
  MQTT_USER: z.string().optional(),
  MQTT_PASSWORD: z.string().optional(),

  // Service URLs
  PET_SERVICE_URL: z.string().default('http://localhost:3002'),
  FEEDING_SERVICE_URL: z.string().default('http://localhost:3004'),
  NOTIFICATION_SERVICE_URL: z.string().default('http://localhost:3005'),

  ALLOWED_ORIGINS: z.string().default('http://localhost:5173,http://localhost:3000'),

  ENABLE_SIMULATORS: z.string().default('true'),

  INTERNAL_API_KEY: z.string().default('dev_internal_secret_change_me'),
  INTERNAL_SERVICE_KEYS_JSON: z.string().default('{}'),
  SERVICE_NAME: z.string().default('telemetry-service'),
  DEVICE_API_KEY: z.string().optional(),

  // Telemetry archival configuration
  ARCHIVAL_ENABLED: z.string().default('false'),
  ARCHIVAL_STORAGE_TYPE: z.enum(['local', 's3', 'gcs']).default('local'),
  ARCHIVAL_LOCAL_PATH: z.string().default('./archived_telemetry'),
  ARCHIVAL_S3_BUCKET: z.string().optional(),
  ARCHIVAL_S3_REGION: z.string().optional(),
  ARCHIVAL_GCS_BUCKET: z.string().optional(),
});

const _parsed = schema.parse(process.env);

/** Typed, validated environment variables for the Telemetry Service. */
export const env = {
  ..._parsed,
  // Normalise MQTT URL — MQTT_URL alias from legacy configs
  MQTT_URL: process.env.MQTT_URL ?? _parsed.MQTT_BROKER_URL,
  MQTT_USERNAME: process.env.MQTT_USERNAME ?? _parsed.MQTT_USER,
  ALLOWED_ORIGINS: _parsed.ALLOWED_ORIGINS.split(',').map((s) => s.trim()),
  ENABLE_SIMULATORS: _parsed.ENABLE_SIMULATORS !== 'false',
};

export type Env = typeof env;
