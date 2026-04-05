const timestamp = () => new Date().toISOString().slice(11, 19);

export const logger = {
  info: (msg: string, data?: unknown) => {
    console.log(`[${timestamp()}] ${msg}`, data ?? '');
  },
  warn: (msg: string, data?: unknown) => {
    console.warn(`[${timestamp()}] ⚠ ${msg}`, data ?? '');
  },
  error: (msg: string, data?: unknown) => {
    console.error(`[${timestamp()}] ✗ ${msg}`, data ?? '');
  },
  debug: (msg: string, data?: unknown) => {
    if (process.env.DEBUG) {
      console.log(`[${timestamp()}] 🔍 ${msg}`, data ?? '');
    }
  },
};
