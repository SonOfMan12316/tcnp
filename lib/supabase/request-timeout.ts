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
