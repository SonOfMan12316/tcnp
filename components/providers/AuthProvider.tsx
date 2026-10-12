"use client"

import { useEffect, useRef } from 'react'
import * as Sentry from '@sentry/nextjs'
import { createClient } from '@/lib/supabase/client'
import { isPermanentOwnerEmail } from '@/lib/platform-owner'
import { useRouter, usePathname } from 'next/navigation'

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const router = useRouter()
    const pathname = usePathname()
    const supabase = createClient()
    const isAuthenticating = useRef(false)

    useEffect(() => {
        // Set up auth state listener with iOS-safe error handling
        const {
            data: { subscription },
        } = supabase.auth.onAuthStateChange((event, session) => {
            try {
                // Handle session changes
                if (event === 'SIGNED_OUT') {
                    // Clear any client-side cache
                    isAuthenticating.current = false
                    // Stop attributing errors to the officer who just left;
                    // on shared devices this would blame the wrong person.
                    Sentry.setUser(null)
                    router.push('/login')
                } else if (event === 'TOKEN_REFRESHED') {
                    // Session was refreshed successfully
                    console.log('Session refreshed successfully')
                } else if (event === 'SIGNED_IN') {
                    // User signed in - only redirect if on an auth page
                    // This prevents unwanted redirects when session is restored on page load
                    isAuthenticating.current = true
                    console.log('User signed in successfully')

                    // Only redirect if coming from login or signup page
                    // Do NOT redirect if user is already on a dashboard sub-page
                    const isOnAuthPage = pathname?.startsWith('/login') || pathname?.startsWith('/signup')
                    if (isOnAuthPage) {
                        setTimeout(() => {
                            router.replace('/dashboard')
                            isAuthenticating.current = false
                        }, 150)
                    } else {
                        isAuthenticating.current = false
                    }
                }
            } catch (error) {
                // Suppress all auth-related errors during authentication
                if (!isAuthenticating.current) {
                    console.warn('Auth state change error (suppressed):', error)
                }
            }
        })

        // Cleanup subscription on unmount
        return () => {
            subscription.unsubscribe()
        }
    }, [router, supabase, pathname])

    // Periodic session health check — also detects deleted accounts
    useEffect(() => {
        const checkSession = setInterval(async () => {
            if (isAuthenticating.current || pathname?.startsWith('/login')) return

            try {
                const { data: { session }, error } = await supabase.auth.getSession()

                if (error) {
                    console.warn('⚠️ Session check error:', error.message)
                    return
                }

                // No session — SIGNED_OUT event will handle the redirect
                if (!session) return

                // The canonical platform owner is active by invariant. A stale
                // or temporarily unreadable profile must not revoke that session.
                if (isPermanentOwnerEmail(session.user.email)) return

                // Check whether the public user profile still exists.
                // If an admin deleted this account, the row will be gone.
                // We use the service-agnostic client (anon key) so it respects RLS;
                // a missing row means the account was deleted.
                const { data: profile, error: profileError } = await supabase
                    .from('users')
                    .select('id, is_active, activation_status')
                    .eq('id', session.user.id)
                    .maybeSingle()

                if (!profileError && (profile === null || profile.is_active === false || profile.activation_status !== 'active')) {
                    // Account no longer exists — force sign out
                    console.warn('⚠️ Account deleted — signing out.')
                    await supabase.auth.signOut()
                    // SIGNED_OUT event in onAuthStateChange will push to /login
                }
            } catch (err) {
                if (!isAuthenticating.current) {
                    console.warn('Session check failed (suppressed):', err)
                }
            }
        }, 30000) // Check every 30 seconds

        return () => clearInterval(checkSession)
    }, [supabase, pathname])

    return <>{children}</>
}
