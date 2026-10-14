import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/types/supabase'
import { getSupabaseBrowserConfig } from '@/lib/supabase/config'
import { logSupabaseError } from '@/lib/supabase/error-utils'
import { createSupabaseReadTimeoutFetch } from '@/lib/supabase/request-timeout'

// A pending auth/profile or REST read keeps the dashboard skeleton on screen
// forever. Bound only Supabase GETs used for auth identity and PostgREST data;
// writes, uploads, realtime, and other Supabase services keep their normal
// request behavior. The wrapper lives in request-timeout.ts alongside the
// login wrapper so both deadlines fail the same, named way.
const SUPABASE_READ_TIMEOUT_MS = 15_000

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
      global: { fetch: createSupabaseReadTimeoutFetch(url, SUPABASE_READ_TIMEOUT_MS) },
    })
  }

  if (_client) return _client

  try {
    _client = createBrowserClient<Database>(url, anonKey, {
      global: { fetch: createSupabaseReadTimeoutFetch(url, SUPABASE_READ_TIMEOUT_MS) },
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
