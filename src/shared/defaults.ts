// What an AI call gets while the setting is unset. Kept in one place because
// the settings page shows these as the defaults and the server is what applies
// them: defined twice, the page can promise numbers the server does not use.
export const DEFAULT_API_TIMEOUT_MS = 60_000;
export const DEFAULT_API_MAX_RETRIES = 3;
