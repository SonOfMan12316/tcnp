import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { Database } from '@/types/supabase'
import { getSupabaseBrowserConfig } from '@/lib/supabase/config'
import { logSupabaseError } from '@/lib/supabase/error-utils'
import { createSupabaseRequestTimeoutFetch } from '@/lib/supabase/request-timeout'

export async function createClient(options: { requestTimeoutMs?: number } = {}) {
  const cookieStore = await cookies()

  try {
    const { url, anonKey } = getSupabaseBrowserConfig()

    const requestOptions = options.requestTimeoutMs
      ? { global: { fetch: createSupabaseRequestTimeoutFetch(url, options.requestTimeoutMs) } }
      : {}

    return createServerClient<Database>(
      url,
      anonKey,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll()
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) => {
                cookieStore.set({ name, value, ...options })
              })
            } catch (error) {
              logSupabaseError('Supabase server client cookie set failed', error)
            }
          },
        },
        ...requestOptions,
      }
    )
  } catch (error) {
    logSupabaseError('Supabase server client initialization failed', error)
    throw error
  }
}
