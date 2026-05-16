import mongoose, { Document, Schema } from 'mongoose';

export type TelemetryType =
  | 'heart_rate'
  | 'temperature'
  | 'spo2'
  | 'weight'
  | 'activity'
  | 'activity_steps'
  | 'activity_distance'
  | 'location';

export interface ITelemetry extends Document {
  _id: mongoose.Types.ObjectId;
  timestamp: Date;
  pet_id: mongoose.Types.ObjectId;
  device_id?: mongoose.Types.ObjectId;
  type: TelemetryType;
  value: number | Record<string, unknown>;
  metadata?: {
    accuracy?: number;
    confidence?: number;
    source?: 'edge' | 'cloud' | 'sensor' | 'http';
  };
  archived?: boolean;
  archivedAt?: Date;
}

const telemetrySchema = new Schema<ITelemetry>({
  timestamp: { type: Date, required: true, default: Date.now },
  pet_id: { type: Schema.Types.ObjectId, ref: 'Pet', required: true },
  device_id: { type: Schema.Types.ObjectId, ref: 'Device' },
  type: {
    type: String,
    enum: ['heart_rate', 'temperature', 'spo2', 'weight', 'activity', 'activity_steps', 'activity_distance', 'location'],
    required: true,
  },
  value: { type: Schema.Types.Mixed, required: true },
  metadata: {
    accuracy: Number,
    confidence: Number,
    source: { type: String, enum: ['edge', 'cloud', 'sensor', 'http'] },
  },
  archived: { type: Boolean, default: false },
  archivedAt: { type: Date },
});

// Compound index for time-range queries per pet per type
telemetrySchema.index({ pet_id: 1, type: 1, timestamp: -1 });

// Device-specific time-range queries
telemetrySchema.index({ device_id: 1, timestamp: -1 });

// TTL: auto-delete after 1 year
telemetrySchema.index({ timestamp: 1 }, { expireAfterSeconds: 365 * 24 * 3600 });

export const TelemetryModel = mongoose.model<ITelemetry>('Telemetry', telemetrySchema);
