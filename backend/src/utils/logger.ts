// ─── Structured Logger ─────────────────────────────────────
// Production-grade logging with levels and context.
// Replace with pino/winston if you need file rotation, JSON output, etc.

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || (process.env.NODE_ENV === 'production' ? 'info' : 'debug');

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

function formatMessage(level: LogLevel, tag: string, message: string, meta?: Record<string, any>): string {
  const timestamp = new Date().toISOString();
  const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
  return `${timestamp} [${level.toUpperCase()}] [${tag}] ${message}${metaStr}`;
}

export const logger = {
  debug(tag: string, message: string, meta?: Record<string, any>) {
    if (shouldLog('debug')) console.log(formatMessage('debug', tag, message, meta));
  },

  info(tag: string, message: string, meta?: Record<string, any>) {
    if (shouldLog('info')) console.log(formatMessage('info', tag, message, meta));
  },

  warn(tag: string, message: string, meta?: Record<string, any>) {
    if (shouldLog('warn')) console.warn(formatMessage('warn', tag, message, meta));
  },

  error(tag: string, message: string, error?: any, meta?: Record<string, any>) {
    if (shouldLog('error')) {
      const errorMeta = error instanceof Error
        ? { ...meta, errorMessage: error.message, stack: error.stack }
        : { ...meta, errorMessage: String(error) };
      console.error(formatMessage('error', tag, message, errorMeta));
    }
  },
};
