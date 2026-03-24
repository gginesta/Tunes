type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  [key: string]: unknown;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const configuredLevel: LogLevel =
  (process.env.LOG_LEVEL as LogLevel) || 'info';

const isDevelopment = process.env.NODE_ENV !== 'production';

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[configuredLevel];
}

function formatEntry(entry: LogEntry): string {
  return JSON.stringify(entry);
}

function prettyPrint(entry: LogEntry): string {
  const { timestamp, level, message, ...context } = entry;
  const contextStr =
    Object.keys(context).length > 0 ? ' ' + JSON.stringify(context) : '';
  return `[${timestamp}] ${level.toUpperCase()} ${message}${contextStr}`;
}

function log(
  level: LogLevel,
  message: string,
  context?: Record<string, unknown>,
): void {
  if (!shouldLog(level)) return;

  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...context,
  };

  const output = formatEntry(entry);
  const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  stream.write(output + '\n');

  if (isDevelopment) {
    const pretty = prettyPrint(entry);
    const consoleMethod = level === 'error' ? console.error
      : level === 'warn' ? console.warn
      : console.log;
    consoleMethod(pretty);
  }
}

export const logger = {
  debug(message: string, context?: Record<string, unknown>): void {
    log('debug', message, context);
  },
  info(message: string, context?: Record<string, unknown>): void {
    log('info', message, context);
  },
  warn(message: string, context?: Record<string, unknown>): void {
    log('warn', message, context);
  },
  error(message: string, context?: Record<string, unknown>): void {
    log('error', message, context);
  },
};
