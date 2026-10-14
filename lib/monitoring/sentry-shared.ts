/**
 * Shared Sentry wiring used by the browser, Node and Edge runtimes.
 *
 * Everything here is deliberately runtime-agnostic: no `window` access and no
 * imports from the SDK. The three init files (`instrumentation-client.ts`,
 * `sentry.server.config.ts`, `sentry.edge.config.ts`) each own their own
 * `Sentry.init` call because the SDK resolves a different build per runtime.
 */

/**
 * Fallback DSN, compiled into the bundle.
 *
 * Normally the DSN comes from the `NEXT_PUBLIC_SENTRY_DSN` environment
 * variable, which is the right place for it. This constant exists for the
 * case where nobody working on the code has access to the deployment
 * platform's environment variables — setting it here still gets errors
 * flowing, because it only needs a commit.
 *
 * Safe to commit: a DSN grants permission to WRITE events and nothing else.
 * It cannot read issues, and it is already readable in the deployed client
 * bundle by anyone who opens devtools.
 *
 * BUT this repository is public, so a DSN placed here is also discoverable by
 * automated scrapers. Before using it, blunt the only real abuse (someone
 * flooding the error quota so real errors get rate-limited away):
 *   1. Sentry > Settings > Projects > tcnp > Client Keys > rate limit the key.
 *   2. Sentry > Settings > Projects > tcnp > Inbound Filters > Allowed
 *      Domains — restrict to the app's own domain.
 *
 * The environment variable always wins, so setting it later needs no code
 * change. See docs/ERROR_MONITORING.md.
 */
export const FALLBACK_DSN = ''

/**
 * Resolves the DSN, preferring the environment over the committed fallback.
 * Returns undefined when neither is set, which leaves the SDK inert.
 */
export function resolveDsn(envDsn: string | undefined): string | undefined {
  const dsn = envDsn?.trim() || FALLBACK_DSN.trim()
  return dsn || undefined
}

/** Query/hash params that can carry a Supabase session and must never be sent. */
export const SECRET_PARAMS = [
  'access_token',
  'refresh_token',
  'provider_token',
  'provider_refresh_token',
  'code',
  'token_hash',
  'apikey',
]

/**
 * What the SDK is allowed to collect automatically.
 *
 * IMPORTANT: in SDK v11 this replaced the old `sendDefaultPii` flag, and the
 * defaults INVERTED — cookies, request/response headers, request bodies and
 * stack-frame local variables are all collected unless you say otherwise.
 * For an app holding officer identities, locations and journey details that
 * default is unacceptable, so every category is pinned explicitly below.
 */
export const DATA_COLLECTION = {
  // Identity is attached deliberately in SentryUserContext (id, email, role,
  // unit). Automatic population would also pull in whatever the
  // instrumentation happens to find, which we do not want to guess at.
  userInfo: false,

  // Supabase session cookies. Capturing these would put live auth tokens in
  // the issue feed.
  cookies: false,

  // Request headers carry `Authorization` and the Supabase `apikey`;
  // response headers add nothing we need to triage a crash.
  httpHeaders: false,

  // Request/response bodies are journey reports, welfare notes and chat
  // messages. An empty array disables body collection entirely.
  httpBodies: [] as [],

  // Query strings are genuinely useful for reproducing a bug (`?next=`,
  // filters, ids), so keep them — minus anything that can carry a session.
  urlQueryParams: { deny: SECRET_PARAMS },

  // Local variables make stack traces much easier to read, but on the server
  // they can hold the service role key and on the client a full user profile.
  // Flip to `true` temporarily if you are stuck on a specific bug.
  stackFrameVariables: false,

  // Bound query parameters and returned rows. The sanitized statement and
  // table name are always collected and are enough to locate a bad query.
  databaseQueryData: false,
}

/**
 * Errors that are noise, not defects. Keep this list short and justified —
 * the whole point of this integration is to SEE errors, so anything added
 * here needs a reason beyond "it appears a lot".
 */
export const IGNORED_ERRORS: (string | RegExp)[] = [
  // Benign browser layout notification fired by ResizeObserver consumers
  // (Radix, Recharts, Leaflet). Not a crash and not actionable.
  /ResizeObserver loop (limit exceeded|completed with undelivered notifications)/,
  // Fired when a fetch/XHR is cancelled by navigation or React cleanup.
  // Expected during fast route changes; a real failure surfaces differently.
  'AbortError',
  'The operation was aborted',
  // Chrome/Safari extensions injecting into the page. Not our code.
  /^Script error\.?$/,
  // Next.js App Router control-flow signals, not failures.
  'NEXT_REDIRECT',
  'NEXT_NOT_FOUND',
]

/** Third-party script origins whose stack frames we never want to triage. */
export const DENY_URLS: RegExp[] = [
  /^chrome-extension:\/\//,
  /^moz-extension:\/\//,
  /^safari-(web-)?extension:\/\//,
]

/** True when the error is a Next.js navigation signal rather than a failure. */
export function isNextNavigationSignal(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false

  const digest = 'digest' in error ? (error as { digest?: unknown }).digest : undefined
  if (typeof digest === 'string'
    && (digest.startsWith('NEXT_REDIRECT') || digest === 'NEXT_NOT_FOUND')) {
    return true
  }

  const message = 'message' in error ? (error as { message?: unknown }).message : undefined
  return typeof message === 'string'
    && (message.includes('NEXT_REDIRECT') || message.includes('NEXT_NOT_FOUND'))
}

/**
 * Strip session tokens out of any URL before it leaves the device.
 *
 * Supabase puts `access_token` / `refresh_token` in the URL fragment on magic
 * link and OAuth callbacks. Those URLs end up in Sentry breadcrumbs, request
 * contexts and replay navigation events, so they are redacted centrally here.
 */
export function redactUrl(value: string): string {
  if (!value) return value

  let result = value
  for (const param of SECRET_PARAMS) {
    // Matches `?param=...`, `&param=...` and `#param=...` up to the next
    // delimiter. The key is captured and re-emitted rather than substituted,
    // so a differently-cased key (`Access_Token`) is not silently renamed.
    const pattern = new RegExp(`([?&#])(${param})=[^&#]*`, 'gi')
    result = result.replace(pattern, '$1$2=[REDACTED]')
  }
  return result
}

/** Environment name shown in the Sentry UI. */
export function resolveEnvironment(): string {
  return (
    process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT
    || process.env.NEXT_PUBLIC_VERCEL_ENV
    || process.env.VERCEL_ENV
    || process.env.NODE_ENV
    || 'development'
  )
}

/**
 * Release identifier, used to tie a stack trace to the source maps uploaded
 * for that exact deploy. Vercel exposes the commit SHA; without it Sentry
 * falls back to its own build-time default.
 */
export function resolveRelease(): string | undefined {
  return (
    process.env.NEXT_PUBLIC_SENTRY_RELEASE
    || process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA
    || process.env.VERCEL_GIT_COMMIT_SHA
    || undefined
  )
}

/** True when `message` matches any entry in IGNORED_ERRORS. */
export function matchesIgnoredError(message: string): boolean {
  return IGNORED_ERRORS.some((pattern) =>
    typeof pattern === 'string' ? message.includes(pattern) : pattern.test(message)
  )
}

/** The title the SDK assigns when a non-Error value is captured. */
const SERIALIZED_EXCEPTION_TITLE = 'Object captured as exception'

/** The minimum shape of a Sentry event this module needs; avoids an SDK import. */
type SerializableEvent = {
  exception?: { values?: { value?: string }[] }
  extra?: Record<string, unknown>
}

/**
 * Give plain-object rejections a real title.
 *
 * Supabase and PostgREST reject with `{ code, details, hint, message }` rather
 * than an Error, so the SDK titles the issue "Object captured as exception
 * with keys: code, details, hint, message". Every such failure — a timeout, a
 * permission denial, a bad query — collapses into one meaningless issue, and
 * `ignoreErrors` cannot match them because it tests this title rather than the
 * message buried inside.
 *
 * `extraErrorDataIntegration` has already serialized the object into
 * `extra.__serialized__`, so lift its `message` into the exception value.
 * Call this before applying the ignore list, and the two problems resolve
 * together: issues group by what actually failed, and the existing patterns
 * start matching.
 */
export function retitleSerializedException(event: SerializableEvent): void {
  const exception = event.exception?.values?.[0]
  if (!exception?.value?.startsWith(SERIALIZED_EXCEPTION_TITLE)) return

  const serialized = event.extra?.__serialized__
  if (typeof serialized !== 'object' || serialized === null) return

  const message = (serialized as { message?: unknown }).message
  if (typeof message !== 'string' || !message.trim()) return

  exception.value = message
}
