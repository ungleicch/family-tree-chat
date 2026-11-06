// Production secrets fail closed. Nothing here reads or prints secret values.

export const DEV_JWT_FALLBACK = 'dev-only-secret-change-in-production-please-12345'

type Env = Record<string, string | undefined>

export function isProductionEnv(env: Env = process.env): boolean {
  return env.NODE_ENV === 'production'
}

export function jwtSecretProblem(env: Env = process.env): string | null {
  if (!isProductionEnv(env)) return null
  const secret = env.JWT_SECRET
  if (!secret || secret.length < 32 || secret === DEV_JWT_FALLBACK) {
    return 'JWT_SECRET must be a unique value of at least 32 characters in production'
  }
  return null
}

export function resolveJwtSecret(env: Env = process.env): string {
  const problem = jwtSecretProblem(env)
  if (problem) throw new Error(problem)
  return env.JWT_SECRET || DEV_JWT_FALLBACK
}

export function smtpConfig(env: Env = process.env): { host: string; port: number; user: string; pass: string; from: string } | null {
  const host = env.SMTP_HOST
  const user = env.SMTP_USER
  const pass = env.SMTP_PASS
  const from = env.SMTP_FROM
  if (!host || !user || !pass || !from) return null
  return { host, port: env.SMTP_PORT ? Number(env.SMTP_PORT) : 587, user, pass, from }
}

export function smtpProblem(env: Env = process.env): string | null {
  if (!isProductionEnv(env)) return null
  if (!smtpConfig(env)) return 'SMTP_HOST, SMTP_USER, SMTP_PASS, and SMTP_FROM are required in production'
  return null
}
