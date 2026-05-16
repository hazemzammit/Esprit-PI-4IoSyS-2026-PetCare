export interface TelemetryPayload {
  sensors: {
    heart_rate?: number;
    temperature?: number;
    spo2?: number;
    battery?: number;
    activity?: number;
    weight?: number;
    water_consumption?: number;
  };
  timestamp: number; // Unix seconds
}

export interface LocationPayload {
  lat: number;
  lng: number;
  accuracy: number;
  altitude?: number;
  speed?: number;
}

export interface DeviceStatusPayload {
  status: 'online' | 'offline' | 'error';
  battery?: number;
  firmware_version?: string;
}

export interface DeviceAlertPayload {
  type: 'health' | 'location' | 'feeding' | 'device';
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  sub_message?: string;
  data?: Record<string, unknown>;
}

export type DeviceCommandType =
  | 'find_pet'
  | 'feed_now'
  | 'fill_water'
  | 'set_power_mode'
  | 'play_message'
  | 'reboot';

export interface DeviceCommand {
  type: DeviceCommandType;
  params?: Record<string, unknown>;
}

export type MqttMessageType = 'telemetry' | 'status' | 'alert' | 'location';

export interface CachedDevice {
  deviceId: string;
  petId: string;
  userId: string;
  type: string;
  serial: string;
}
