import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/types/supabase'
import { getSupabaseBrowserConfig } from '@/lib/supabase/config'
import { logSupabaseError } from '@/lib/supabase/error-utils'

// A pending auth/profile or REST read keeps the dashboard skeleton on screen
// forever. Bound only Supabase GETs used for auth identity and PostgREST data;
// writes, uploads, realtime, and other Supabase services keep their normal
// request behavior.
const SUPABASE_READ_TIMEOUT_MS = 15_000

function createSupabaseReadTimeoutFetch(supabaseUrl: string): typeof fetch {
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

    const isBoundedRead =
      method === 'GET' &&
      url.origin === supabaseOrigin &&
      (url.pathname === '/auth/v1/user' || url.pathname.startsWith('/rest/v1/'))

    if (!isBoundedRead) return globalThis.fetch(input, init)

    const upstreamSignal = init?.signal ?? request?.signal
    const controller = new AbortController()
    const abortFromCaller = () => controller.abort()

    if (upstreamSignal?.aborted) {
      controller.abort()
    } else {
      upstreamSignal?.addEventListener('abort', abortFromCaller, { once: true })
    }

    const timeout = setTimeout(() => controller.abort(), SUPABASE_READ_TIMEOUT_MS)

    try {
      return await globalThis.fetch(input, { ...init, signal: controller.signal })
    } finally {
      clearTimeout(timeout)
      upstreamSignal?.removeEventListener('abort', abortFromCaller)
    }
  }
}

// ─── Module-Level Singleton ─────────────────────────────────────────────────
// One client per browser session. Prevents orphaned Realtime subscriptions
// that occur when new instances are created inside useMemo / component renders.
// Server-side renders receive `null` — use lib/supabase/server.ts for RSC/API.
let _client: ReturnType<typeof createBrowserClient<Database>> | null = null

export function createClient() {
  const { url, anonKey } = getSupabaseBrowserConfig()

  if (typeof window === 'undefined') {
    // Generate a fresh client during SSR of Client Components to avoid memory leaks or cross-request state bleeding
    return createBrowserClient<Database>(url, anonKey, {
      global: { fetch: createSupabaseReadTimeoutFetch(url) },
    })
  }

  if (_client) return _client

  try {
    _client = createBrowserClient<Database>(url, anonKey, {
      global: { fetch: createSupabaseReadTimeoutFetch(url) },
    })
    return _client
  } catch (error) {
    logSupabaseError('Supabase client initialization failed', error)
    throw error
  }
}

// Convenience export for components that don't need lazy init
// Usage: import { supabase } from '@/lib/supabase/client'
export const supabase = typeof window !== 'undefined' ? (() => {
  try { return createClient() } catch { return null }
})() : null
