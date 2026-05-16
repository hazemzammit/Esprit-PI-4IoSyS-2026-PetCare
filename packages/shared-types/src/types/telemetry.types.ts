import { Location } from './device.types';

export type TelemetryType =
  | 'heart_rate'
  | 'temperature'
  | 'spo2'
  | 'activity'
  | 'location'
  | 'weight';

export interface TelemetryPoint {
  _id: string;
  deviceId: string;
  petId: string;
  timestamp: string;
  type: TelemetryType;
  value: number | ActivityData | Location;
  metadata: {
    accuracy?: number;
    confidence?: number;
    source: 'edge' | 'cloud' | 'sensor';
  };
}

export interface ActivityData {
  steps: number;
  distance: number; // meters
  calories: number;
  activeMinutes: number;
}

export interface AggregatedTelemetry {
  period: 'hour' | 'day' | 'week' | 'month';
  type: TelemetryType;
  data: Array<{
    timestamp: string;
    avg: number;
    min: number;
    max: number;
  }>;
}
