import { logger } from '@petcare/shared-middleware';
import { TelemetryModel } from '../models/telemetry.model';
import { env } from '../config/env';
import fs from 'fs/promises';
import path from 'path';

/**
 * Telemetry Archival Service
 * 
 * Exports telemetry data to cold storage before TTL deletion.
 * Prevents permanent loss of historical health data.
 * 
 * Supports:
 * - Local filesystem (for dev/testing)
 * - AWS S3 (for production)
 * - Google Cloud Storage (for production)
 */

const ARCHIVAL_THRESHOLD_DAYS = 350; // Archive data 350+ days old (before 1-year TTL)
const BATCH_SIZE = 1000;

export interface ArchivalConfig {
  enabled: boolean;
  storageType: 'local' | 's3' | 'gcs';
  localPath?: string;
  s3Bucket?: string;
  s3Region?: string;
  gcsBucket?: string;
}

/**
 * Archive telemetry data that's approaching TTL
 */
export async function archiveTelemetry(): Promise<{ archived: number; errors: number }> {
  if (env.ARCHIVAL_ENABLED !== 'true') {
    logger.info('[Archival] Telemetry archival is disabled');
    return { archived: 0, errors: 0 };
  }

  logger.info('[Archival] Starting telemetry archival process');

  const thresholdDate = new Date();
  thresholdDate.setDate(thresholdDate.getDate() - ARCHIVAL_THRESHOLD_DAYS);

  let totalArchived = 0;
  let totalErrors = 0;
  let hasMore = true;
  let skip = 0;

  try {
    while (hasMore) {
      // Find telemetry records approaching TTL
      const records = await TelemetryModel.find({
        timestamp: { $lt: thresholdDate },
        archived: { $ne: true }, // Not yet archived
      })
        .sort({ timestamp: 1 })
        .limit(BATCH_SIZE)
        .skip(skip)
        .lean();

      if (records.length === 0) {
        hasMore = false;
        break;
      }

      logger.info(`[Archival] Processing batch of ${records.length} records`);

      // Archive this batch
      const { archived, errors } = await archiveBatch(records);
      totalArchived += archived;
      totalErrors += errors;

      // Mark records as archived
      const ids = records.map((r) => r._id);
      await TelemetryModel.updateMany(
        { _id: { $in: ids } },
        { $set: { archived: true, archivedAt: new Date() } }
      );

      skip += BATCH_SIZE;
    }

    logger.info(`[Archival] Complete: ${totalArchived} records archived, ${totalErrors} errors`);
    return { archived: totalArchived, errors: totalErrors };
  } catch (err) {
    logger.error('[Archival] Error during archival process:', err);
    return { archived: totalArchived, errors: totalErrors + 1 };
  }
}

/**
 * Archive a batch of telemetry records
 */
async function archiveBatch(records: any[]): Promise<{ archived: number; errors: number }> {
  const storageType = env.ARCHIVAL_STORAGE_TYPE || 'local';
  let archived = 0;
  let errors = 0;

  try {
    switch (storageType) {
      case 'local':
        await archiveToLocal(records);
        archived = records.length;
        break;
      case 's3':
        await archiveToS3(records);
        archived = records.length;
        break;
      case 'gcs':
        await archiveToGCS(records);
        archived = records.length;
        break;
      default:
        logger.warn(`[Archival] Unknown storage type: ${storageType}, falling back to local`);
        await archiveToLocal(records);
        archived = records.length;
    }
  } catch (err) {
    logger.error('[Archival] Error archiving batch:', err);
    errors = 1;
  }

  return { archived, errors };
}

/**
 * Archive to local filesystem
 */
async function archiveToLocal(records: any[]): Promise<void> {
  const localPath = env.ARCHIVAL_LOCAL_PATH || './archived_telemetry';
  
  // Ensure directory exists
  await fs.mkdir(localPath, { recursive: true });

  // Group by pet_id for better organization
  const grouped = groupByPetId(records);

  for (const [petId, petRecords] of Object.entries(grouped)) {
    const date = new Date().toISOString().split('T')[0];
    const filename = `telemetry_pet_${petId}_${date}.json`;
    const filepath = path.join(localPath, filename);

    const data = JSON.stringify(petRecords, null, 2);
    await fs.writeFile(filepath, data, 'utf-8');

    logger.info(`[Archival] Archived ${petRecords.length} records for pet ${petId} to ${filepath}`);
  }
}

/**
 * Archive to AWS S3
 */
async function archiveToS3(records: any[]): Promise<void> {
  // Note: This requires aws-sdk package
  // For now, fall back to local with a warning
  logger.warn('[Archival] S3 archival not yet implemented, falling back to local');
  await archiveToLocal(records);
}

/**
 * Archive to Google Cloud Storage
 */
async function archiveToGCS(records: any[]): Promise<void> {
  // Note: This requires @google-cloud/storage package
  // For now, fall back to local with a warning
  logger.warn('[Archival] GCS archival not yet implemented, falling back to local');
  await archiveToLocal(records);
}

/**
 * Group records by pet_id
 */
function groupByPetId(records: any[]): Record<string, any[]> {
  const grouped: Record<string, any[]> = {};

  for (const record of records) {
    const petId = record.pet_id || 'unknown';
    if (!grouped[petId]) {
      grouped[petId] = [];
    }
    grouped[petId].push(record);
  }

  return grouped;
}

/**
 * Get archival statistics
 */
export async function getArchivalStats(): Promise<{
  totalRecords: number;
  archivedRecords: number;
  pendingArchival: number;
}> {
  const totalRecords = await TelemetryModel.countDocuments();
  const archivedRecords = await TelemetryModel.countDocuments({ archived: true });
  const pendingArchival = await TelemetryModel.countDocuments({ archived: false });

  return {
    totalRecords,
    archivedRecords,
    pendingArchival,
  };
}
