type Env = Record<string, string | undefined>

export function parseOriginList(value: string | undefined): string[] {
  return (value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

export function resolveAllowedOrigins(env: Env = process.env): { origins: string[] | true; error: string | null } {
  const origins = parseOriginList(env.CHAT_ALLOWED_ORIGINS)
  if (env.NODE_ENV === 'production') {
    if (origins.length === 0) {
      return { origins: [], error: 'CHAT_ALLOWED_ORIGINS is required in production' }
    }
    return { origins, error: null }
  }
  if (origins.length === 0) return { origins: true, error: null }
  return { origins, error: null }
}
