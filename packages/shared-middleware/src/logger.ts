import winston from 'winston';

const transports: winston.transport[] = [
  new winston.transports.Console({
    format: winston.format.combine(
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      winston.format.colorize(),
      winston.format.printf(({ timestamp, level, message }) => {
        const svc = process.env.SERVICE_NAME ?? 'unknown';
        return `[${timestamp}] [${svc}] ${level}: ${message}`;
      })
    ),
  }),
];

// Add Loki transport in production if Loki URL is configured and winston-loki is available
if (process.env.NODE_ENV === 'production' && process.env.LOKI_URL) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { LokiTransport } = require('winston-loki');
    transports.push(
      new LokiTransport({
        host: process.env.LOKI_URL,
        labels: {
          service: process.env.SERVICE_NAME ?? 'unknown',
          environment: process.env.NODE_ENV ?? 'development',
        },
        json: true,
        format: winston.format.json(),
        batching: true,
        interval: 5,
      })
    );
  } catch (err) {
    // winston-loki not installed, skip Loki integration
    console.warn('[logger] winston-loki not available, skipping Loki integration');
  }
}

export const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  transports,
});
