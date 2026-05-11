// Tiny structured logger. We avoid pulling in pino/winston for now —
// when log volume justifies it we can swap implementations without touching callers.

const ts = () => new Date().toISOString();

const fmt = (level, msg, meta) => {
  const base = `[${ts()}] ${level.padEnd(5)} ${msg}`;
  return meta ? `${base} ${JSON.stringify(meta)}` : base;
};

export const logger = {
  info:  (msg, meta) => console.log(fmt('INFO',  msg, meta)),
  warn:  (msg, meta) => console.warn(fmt('WARN',  msg, meta)),
  error: (msg, meta) => console.error(fmt('ERROR', msg, meta)),
};
