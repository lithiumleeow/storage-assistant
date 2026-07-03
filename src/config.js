export function loadConfig(env = process.env) {
  return {
    port: Number(env.PORT || 3000),
    baseUrl: env.BASE_URL || `http://localhost:${env.PORT || 3000}`,
    dataDir: env.DATA_DIR || './data',
    shortcutToken: env.SHORTCUT_TOKEN || 'dev-token',
    aiApiKey: env.AI_API_KEY || '',
    aiBaseUrl: env.AI_BASE_URL || 'https://api.deepseek.com',
    aiModel: env.AI_MODEL || 'deepseek-chat',
    aiTimeoutMs: Number(env.AI_TIMEOUT_MS || 12000),
    version: env.APP_VERSION || 'dev'
  };
}
