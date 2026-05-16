export type DeviceType = 'collar' | 'station';
export type DeviceStatus = 'online' | 'offline' | 'error';
export type PowerMode = 'normal' | 'eco' | 'search' | 'emergency';

export interface Device {
  _id: string;
  petId: string;
  type: DeviceType;
  serial: string;
  firmware_version: string;
  status: DeviceStatus;
  last_seen: string;
  battery_level?: number; // collar only, 0–100
  config: DeviceConfig;
  createdAt: string;
}

export interface DeviceConfig {
  gps_interval: number; // minutes
  sensor_frequency: number; // minutes
  power_mode: PowerMode;
}

export interface DeviceCommand {
  type:
  | 'find_pet'
  | 'feed_now'
  | 'fill_water'
  | 'camera_start'
  | 'camera_stop'
  | 'set_power_mode';
  payload?: Record<string, unknown>;
}

export interface Location {
  lat: number;
  lng: number;
  accuracy: number; // meters
  source: 'gps' | 'gsm' | 'wifi';
  timestamp: string;
}

export interface Geofence {
  _id: string;
  petId: string;
  name: string;
  type: 'circle';
  center: { lat: number; lng: number };
  radius: number; // meters
  enabled: boolean;
}
