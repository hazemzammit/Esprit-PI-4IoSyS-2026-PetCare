import mqtt from 'mqtt';
import { logger } from './logger';

let client: mqtt.MqttClient | null = null;
let lastErrorMessage: string | null = null;
let lastErrorTime = 0;
const ERROR_DEDUP_MS = 30000; // Only log same error every 30s

export interface MqttConnectOptions {
  brokerUrl?: string;
  username?: string;
  password?: string;
  clientId?: string;
}

/**
 * Resolve broker URL, username, password, and clientId from explicit opts falling
 * back to environment variables.
 */
function resolveOpts(
  urlOrOpts?: string | MqttConnectOptions,
  extra?: Omit<MqttConnectOptions, 'brokerUrl'>,
): { brokerUrl?: string; username?: string; password?: string; clientId: string } {
  let brokerUrl: string | undefined;
  let username: string | undefined;
  let password: string | undefined;
  let clientId: string | undefined;

  if (typeof urlOrOpts === 'string') {
    brokerUrl = urlOrOpts;
    username = extra?.username;
    password = extra?.password;
    clientId = extra?.clientId;
  } else if (urlOrOpts && typeof urlOrOpts === 'object') {
    brokerUrl = urlOrOpts.brokerUrl;
    username = urlOrOpts.username;
    password = urlOrOpts.password;
    clientId = urlOrOpts.clientId;
  }

  return {
    brokerUrl: brokerUrl ?? process.env.MQTT_BROKER_URL ?? process.env.MQTT_URL,
    username: username ?? process.env.MQTT_USER ?? process.env.MQTT_USERNAME,
    password: password ?? process.env.MQTT_PASSWORD,
    clientId: clientId ?? `${process.env.SERVICE_NAME ?? 'svc'}-${Date.now()}`,
  };
}

export function getMqttClient(): mqtt.MqttClient | null {
  if (client) return client;

  const { brokerUrl, username, password, clientId } = resolveOpts();
  if (!brokerUrl) {
    logger.warn('MQTT broker URL not set — MQTT disabled');
    return null;
  }

  client = mqtt.connect(brokerUrl, {
    username,
    password,
    clientId,
    reconnectPeriod: 5000,
    keepalive: 60,
  });

  client.on('connect', () => {
    logger.info('✅ MQTT connected');
    lastErrorMessage = null; // Reset error tracking on successful connect
  });
  client.on('error', (err) => {
    const now = Date.now();
    // Deduplicate: only log if message changed or 30s passed
    if (err.message !== lastErrorMessage || (now - lastErrorTime) > ERROR_DEDUP_MS) {
      logger.error('MQTT error:', err.message);
      lastErrorMessage = err.message;
      lastErrorTime = now;
    }
  });
  client.on('reconnect', () => {
    // Only log reconnect once per failure cycle
    if (!lastErrorMessage) {
      logger.warn('MQTT reconnecting...');
    }
  });

  return client;
}

export async function connectMqtt(
  urlOrOpts?: string | MqttConnectOptions,
  extra?: Omit<MqttConnectOptions, 'brokerUrl'>,
): Promise<mqtt.MqttClient | null> {
  const { brokerUrl, username, password, clientId } = resolveOpts(urlOrOpts, extra);

  return new Promise((resolve) => {
    if (!brokerUrl) {
      logger.warn('MQTT broker URL not set — MQTT disabled');
      resolve(null);
      return;
    }

    const timeout = setTimeout(() => {
      logger.warn('MQTT connection timed out — running without MQTT');
      resolve(client);
    }, 10000);

    client = mqtt.connect(brokerUrl, {
      username,
      password,
      clientId,
      reconnectPeriod: 5000,
      keepalive: 60,
    });

    client.on('connect', () => {
      clearTimeout(timeout);
      logger.info('✅ MQTT connected');
      resolve(client);
    });

    client.on('error', (err) => {
      clearTimeout(timeout);
      // Only log if different from last error or 30s passed
      const now = Date.now();
      if (err.message !== lastErrorMessage || (now - lastErrorTime) > ERROR_DEDUP_MS) {
        logger.error('MQTT error:', err.message);
        lastErrorMessage = err.message;
        lastErrorTime = now;
      }
      resolve(client);
    });
  });
}

/**
 * Publish with QoS 2 for critical alert topics — ensures exactly-once delivery.
 * All other topics default to QoS 0.
 */
function autoQoS(topic: string): mqtt.IClientPublishOptions {
  const criticalPrefixes = ['events/alert/', 'device/', 'events/feeding/'];
  const isCritical = criticalPrefixes.some((p) => topic.startsWith(p));
  return { qos: isCritical ? 2 : 0 };
}

export async function mqttPublish(
  topic: string,
  payload: object,
  options?: mqtt.IClientPublishOptions
): Promise<void> {
  const opts = options ?? autoQoS(topic);
  const c = client ?? getMqttClient();
  if (!c) {
    logger.warn(`MQTT not connected — cannot publish to ${topic}`);
    return;
  }
  return new Promise((resolve, reject) => {
    c.publish(topic, JSON.stringify(payload), opts, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

export function publishToDevice(deviceSerial: string, command: object): void {
  const c = client ?? getMqttClient();
  if (!c) {
    logger.warn('MQTT not connected — cannot publish command');
    return;
  }
  c.publish(`device/${deviceSerial}/command`, JSON.stringify(command), { qos: 2 });
}
