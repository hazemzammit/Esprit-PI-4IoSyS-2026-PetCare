import mongoose from 'mongoose';
import { logger } from '@petcare/shared-middleware';
import { env } from './env';

export async function connectDatabase(): Promise<void> {
  try {
    await mongoose.connect(env.MONGODB_URI);
    logger.info(`✅ Telemetry DB connected: ${env.MONGODB_URI.replace(/\/\/.*@/, '//***@')}`);
  } catch (err) {
    logger.error('❌ Telemetry DB connection failed:', err);
    throw err;
  }
}
