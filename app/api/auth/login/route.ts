import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { checkRateLimit } from '@/lib/security/rate-limit'
import * as Sentry from '@sentry/nextjs'

const loginSchema = z.object({
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(4096),
})

const PERMANENT_PLATFORM_OWNER_EMAIL = 'doriazowan@gmail.com'

export async function POST(request: Request) {
  if (!checkRateLimit(request, 'login', 10, 60_000).success) return NextResponse.json({ error: 'Too many attempts. Please wait a minute.' }, { status: 429 })
  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  const parsed = loginSchema.safeParse(payload)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Enter a valid email address and password.' }, { status: 400 })
  }

  let stage = 'password_auth'
  try {
    const supabase = await createClient()
    const { data, error } = await supabase.auth.signInWithPassword(parsed.data)

    if (error || !data.user) {
      if (error && (!error.status || error.status >= 500)) {
        Sentry.captureException(error, {
          tags: { feature: 'auth', auth_stage: 'password_auth' },
        })
        return NextResponse.json({ error: 'Authentication is temporarily unavailable. Please retry.' }, { status: 503 })
      }
      return NextResponse.json({ error: 'Invalid email or password.' }, { status: 401 })
    }

    stage = 'profile_read'
    // The authenticated user can read their own profile under users_select_visible_profiles.
    // Keep this check scoped to the signed-in session so login does not depend on a
    // service-role secret and can never read another user's activation state.
    const { data: profile, error: profileError } = await supabase
      .from('users')
      .select('activation_status, role, is_active')
      .eq('id', data.user.id)
      .single()

    if (profileError) {
      Sentry.captureException(profileError, {
        tags: { feature: 'auth', auth_stage: 'profile_read' },
      })
      await supabase.auth.signOut()
      return NextResponse.json(
        { error: 'We could not verify your account right now. Please try again shortly.' },
        { status: 503 }
      )
    }

    // The permanent owner is forced active by the database migration and is
    // already exempted by /api/auth/check-activation. Mirror that invariant here
    // for projects whose owner profile predates the migration.
    const isPermanentOwner = data.user.email?.toLowerCase() === PERMANENT_PLATFORM_OWNER_EMAIL
    const isActive = isPermanentOwner || (
      profile?.activation_status === 'active' && profile?.is_active !== false
    )
    if (!profile || !isActive) {
      await supabase.auth.signOut()
      const pending = profile?.activation_status === 'pending'
      return NextResponse.json(
        { error: pending ? 'Your account is awaiting admin approval.' : 'Security clearance denied: account is inactive or restricted.' },
        { status: 403 }
      )
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[auth/login] Authentication service failure:', error)
    Sentry.captureException(error, {
      tags: { feature: 'auth', auth_stage: stage },
    })
    return NextResponse.json(
      { error: 'The authentication service is temporarily unavailable. Please try again shortly.' },
      { status: 503 }
    )
  }
}
