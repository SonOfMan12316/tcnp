/**
 * Browser error monitoring (Sentry).
 *
 * Next.js runs this file after the HTML loads but BEFORE React hydration, so
 * it catches crashes that happen during hydration — the class of bug that is
 * invisible in local development and is why this integration exists.
 *
 * Keep this file cheap: Next warns in development if initialization exceeds
 * 16ms. Session Replay is lazy-loaded by the SDK, so the cost here is the
 * `Sentry.init` call itself.
 */
import * as Sentry from '@sentry/nextjs'

import {
  DATA_COLLECTION,
  DENY_URLS,
  IGNORED_ERRORS,
  matchesIgnoredError,
  redactUrl,
  retitleSerializedException,
  resolveDsn,
  resolveEnvironment,
  resolveRelease,
} from '@/lib/monitoring/sentry-shared'

const dsn = resolveDsn(process.env.NEXT_PUBLIC_SENTRY_DSN)

// No DSN configured (local development, or before the Sentry project exists)
// means the SDK stays completely inert — no network calls, no overhead.
if (dsn) {
  Sentry.init({
    dsn,
    environment: resolveEnvironment(),

    // Set NEXT_PUBLIC_SENTRY_DEBUG=true to print what the SDK is doing to the
    // browser console. This is how you answer "why am I not seeing any
    // events" without guessing — it logs dropped events, filtered events and
    // transport failures. The NEXT_PUBLIC_ prefix is required: unprefixed env
    // vars are not available in browser code. Never leave it on in production.
    debug: process.env.NEXT_PUBLIC_SENTRY_DEBUG === 'true',
    release: resolveRelease(),

    // Pins every data-collection category off except URL query params.
    // See lib/monitoring/sentry-shared.ts — the v11 defaults collect far
    // more than we want. User identity is set explicitly in
    // SentryUserContext instead.
    dataCollection: DATA_COLLECTION,

    // Performance tracing. Errors are the priority, so this samples lightly;
    // raise it temporarily when chasing a slow route.
    tracesSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? 0.1),

    // Session Replay: record ONLY the ~30s leading up to an error, never
    // ordinary sessions. All text and inputs are masked to blocks, so a
    // replay shows layout and interaction order but no officer names,
    // addresses or journey data.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,

    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({
        maskAllText: true,
        maskAllInputs: true,
        blockAllMedia: true,
      }),
      // Serializes non-Error throw values (Supabase returns plain objects),
      // which otherwise arrive as an unhelpful "Object captured as exception".
      Sentry.extraErrorDataIntegration({ depth: 3 }),
    ],

    ignoreErrors: IGNORED_ERRORS,
    denyUrls: DENY_URLS,

    beforeSend(event) {
      if (event.request?.url) {
        event.request.url = redactUrl(event.request.url)
      }

      // Supabase rejects with plain objects, so these arrive titled "Object
      // captured as exception with keys: ..." and all group together. Promote
      // the real message out of the serialized payload first, then re-apply
      // the ignore list: `ignoreErrors` already ran against the useless title,
      // so entries like 'AbortError' never had anything to match.
      retitleSerializedException(event)
      const message = event.exception?.values?.[0]?.value
      if (message && matchesIgnoredError(message)) return null

      return event
    },

    beforeBreadcrumb(breadcrumb) {
      // Navigation and fetch breadcrumbs carry full URLs, including the
      // Supabase auth fragments that contain session tokens.
      if (typeof breadcrumb.data?.url === 'string') {
        breadcrumb.data.url = redactUrl(breadcrumb.data.url)
      }
      if (typeof breadcrumb.data?.from === 'string') {
        breadcrumb.data.from = redactUrl(breadcrumb.data.from)
      }
      if (typeof breadcrumb.data?.to === 'string') {
        breadcrumb.data.to = redactUrl(breadcrumb.data.to)
      }
      return breadcrumb
    },
  })
}

/**
 * Tells Sentry when an App Router navigation starts, so a crash is attributed
 * to the route the user was moving to rather than the one they left.
 */
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
