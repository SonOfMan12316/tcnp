import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { Database } from '@/types/supabase'
import { getSupabaseBrowserConfig } from '@/lib/supabase/config'
import { logSupabaseError } from '@/lib/supabase/error-utils'

export async function createClient() {
  const cookieStore = await cookies()

  try {
    const { url, anonKey } = getSupabaseBrowserConfig()

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
        }
      }
    )
  } catch (error) {
    logSupabaseError('Supabase server client initialization failed', error)
    throw error
  }
}
