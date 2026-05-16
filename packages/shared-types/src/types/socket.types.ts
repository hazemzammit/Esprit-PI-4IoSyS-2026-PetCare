// ─── Socket.IO Event Catalog ───────────────────────────────────────────────
// This is the CONTRACT between backend and all frontend clients.
// Never change an event name without updating ALL consumers.

/** Events emitted FROM SERVER → CLIENT */
export interface ServerToClientEvents {
  // Telemetry updates (real-time sensor data)
  'telemetry:update': (payload: TelemetryUpdateEvent) => void;
  // Health alerts
  'alert:health': (payload: AlertEvent) => void;
  // Location update
  'alert:location': (payload: AlertEvent) => void;
  // Device status changed (online/offline with reason)
  'device:status': (payload: DeviceStatusEvent) => void;
  // WiFi scan results (Phase 1)
  'device:wifi_scan_result': (payload: WifiScanResultEvent) => void;
  // OTA firmware update progress (Phase 1)
  'device:ota_progress': (payload: OtaProgressEvent) => void;
  // Feeding completed
  'feeding:complete': (payload: FeedingCompleteEvent) => void;
  // Find-my-pet signal sent
  'findpet:active': (payload: { active: boolean }) => void;
  // Camera stream ready
  'camera:ready': (payload: { streamUrl: string }) => void;
  // Command acknowledgment (Phase 1)
  'command:ack': (payload: CommandAckEvent) => void;
  // Generic notification
  'notification:new': (payload: NotificationEvent) => void;
}

/** Events emitted FROM CLIENT → SERVER */
export interface ClientToServerEvents {
  // Join user's personal room
  'room:join': (userId: string) => void;
  // Manual feed command
  'command:feed': (payload: { portion?: number }) => void;
  // Activate find-my-pet
  'command:find': (payload: { duration: number }) => void;
  // Start camera stream
  'camera:start': (payload: { quality: 'low' | 'medium' | 'high' }) => void;
  // Stop camera stream
  'camera:stop': () => void;
  // Fill water manually
  'command:water': () => void;
}

// Event payload types
export interface TelemetryUpdateEvent {
  deviceId: string;
  petId: string;
  type: string;
  value: number | object;
  timestamp: string;
}

export interface AlertEvent {
  alertId: string;
  severity: string;
  type: string;
  title: string;
  message: string;
  timestamp: string;
  data?: Record<string, unknown>;
}

export interface DeviceStatusEvent {
  deviceId: string;
  type: string;
  status: string;
  battery?: number;
  lastSeen: string;
  reason?: 'graceful' | 'connection_lost' | 'ota_reboot';
}

export interface WifiNetwork {
  ssid: string | null;
  bssid: string;
  signalDbm: number;
  signalBars: number;
  security: string;
  channel: number;
  frequency: number;
}

export interface WifiScanResultEvent {
  deviceId: string;
  commandId: string;
  networks: WifiNetwork[];
  timestamp: string;
}

export interface OtaProgressEvent {
  deviceId: string;
  otaId: string;
  status: 'downloading' | 'validating' | 'installing' | 'complete' | 'error';
  progress: number;
  message: string;
  timestamp: string;
}

export interface CommandAckEvent {
  deviceId: string;
  commandId: string;
  commandType?: string;
  status: 'success' | 'error';
  message: string;
  details?: Record<string, unknown>;
  timestamp: string;
}

export interface FeedingCompleteEvent {
  scheduleId?: string;
  portion: number;
  consumed: number;
  source: string;
  completedAt: string;
}

export interface NotificationEvent {
  id: string;
  title: string;
  body: string;
  severity: string;
  createdAt: string;
}
