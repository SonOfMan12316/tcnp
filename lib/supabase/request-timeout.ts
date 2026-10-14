const TIMEOUT_MARKER = 'TCNP_SUPABASE_REQUEST_TIMEOUT'

/** Identifies Supabase network requests that exceed the login request budget. */
export class SupabaseRequestTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`${TIMEOUT_MARKER}: Supabase did not respond within ${timeoutMs}ms.`)
    this.name = 'SupabaseRequestTimeoutError'
  }
}

export function isSupabaseRequestTimeout(error: unknown): boolean {
  return error instanceof SupabaseRequestTimeoutError || (
    error instanceof Error && error.message.includes(TIMEOUT_MARKER)
  )
}

/**
 * Bound Supabase auth and PostgREST traffic to one deadline. Buffering the
 * small login responses keeps the deadline active through response-body reads,
 * which a timeout around fetch() alone would not cover.
 */
export function createSupabaseRequestTimeoutFetch(
  supabaseUrl: string,
  timeoutMs: number
): typeof fetch {
  const supabaseOrigin = new URL(supabaseUrl).origin
  const deadline = Date.now() + timeoutMs

  return async (input, init) => {
    const request = typeof Request !== 'undefined' && input instanceof Request ? input : null
    const requestUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    let url: URL

    try {
      url = new URL(requestUrl)
    } catch {
      return globalThis.fetch(input, init)
    }

    const isSupabaseApiRequest =
      url.origin === supabaseOrigin &&
      (url.pathname.startsWith('/auth/v1/') || url.pathname.startsWith('/rest/v1/'))

    if (!isSupabaseApiRequest) return globalThis.fetch(input, init)

    const remainingMs = deadline - Date.now()
    if (remainingMs <= 0) throw new SupabaseRequestTimeoutError(timeoutMs)

    const upstreamSignal = init?.signal ?? request?.signal
    if (upstreamSignal?.aborted) {
      throw upstreamSignal.reason ?? new DOMException('The request was aborted.', 'AbortError')
    }

    const controller = new AbortController()
    const abortFromCaller = () => controller.abort(upstreamSignal?.reason)
    upstreamSignal?.addEventListener('abort', abortFromCaller, { once: true })

    let timedOut = false
    let timeout: ReturnType<typeof setTimeout> | undefined

    const requestPromise = globalThis.fetch(input, { ...init, signal: controller.signal })
      .then(async (response) => {
        const body = response.status === 204 || response.status === 205 || response.status === 304
          ? null
          : await response.arrayBuffer()

        return new Response(body, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        })
      })

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        timedOut = true
        controller.abort()
        reject(new SupabaseRequestTimeoutError(timeoutMs))
      }, remainingMs)
    })

    try {
      return await Promise.race([requestPromise, timeoutPromise])
    } catch (error) {
      if (timedOut) throw new SupabaseRequestTimeoutError(timeoutMs)
      throw error
    } finally {
      if (timeout) clearTimeout(timeout)
      upstreamSignal?.removeEventListener('abort', abortFromCaller)
    }
  }
}

/**
 * Bound a single Supabase read in the browser.
 *
 * Differs from the login wrapper above in scope: that one spends ONE deadline
 * across every call in a login attempt, while this gives each read its own,
 * because a dashboard issues many independent queries and one slow table
 * should not consume the budget of the rest.
 *
 * The important shared behaviour is the failure mode. `controller.abort()`
 * with no argument rejects with "AbortError: signal is aborted without
 * reason" — a message that names neither the deadline nor the request, and
 * that is indistinguishable from the user navigating away mid-load. Both
 * wrappers therefore convert their own deadline into
 * SupabaseRequestTimeoutError, leaving a bare AbortError to mean what it
 * should: the caller cancelled.
 */
export function createSupabaseReadTimeoutFetch(
  supabaseUrl: string,
  timeoutMs: number
): typeof fetch {
  const supabaseOrigin = new URL(supabaseUrl).origin

  return async (input, init) => {
    const request = typeof Request !== 'undefined' && input instanceof Request ? input : null
    const requestUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method ?? request?.method ?? 'GET').toUpperCase()
    let url: URL

    try {
      url = new URL(requestUrl)
    } catch {
      return globalThis.fetch(input, init)
    }

    // Only identity and PostgREST reads are bounded; writes, uploads and
    // realtime keep their normal request behaviour.
    const isBoundedRead =
      method === 'GET' &&
      url.origin === supabaseOrigin &&
      (url.pathname === '/auth/v1/user' || url.pathname.startsWith('/rest/v1/'))

    if (!isBoundedRead) return globalThis.fetch(input, init)

    const upstreamSignal = init?.signal ?? request?.signal
    if (upstreamSignal?.aborted) {
      throw upstreamSignal.reason ?? new DOMException('The request was aborted.', 'AbortError')
    }

    const controller = new AbortController()
    // Forward the caller's reason so a deliberate cancellation keeps saying
    // why it was cancelled instead of being flattened into a bare abort.
    const abortFromCaller = () => controller.abort(upstreamSignal?.reason)
    upstreamSignal?.addEventListener('abort', abortFromCaller, { once: true })

    let timedOut = false
    const timeout = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)

    try {
      return await globalThis.fetch(input, { ...init, signal: controller.signal })
    } catch (error) {
      if (timedOut) throw new SupabaseRequestTimeoutError(timeoutMs)
      throw error
    } finally {
      clearTimeout(timeout)
      upstreamSignal?.removeEventListener('abort', abortFromCaller)
    }
  }
}
