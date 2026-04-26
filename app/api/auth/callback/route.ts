import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'

import { logger } from '@/lib/utils/logger'
import { ensureUserProfile } from '@/lib/auth/ensureUserProfile'

// Service role client for admin operations (bypasses RLS)
const getServiceClient = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
)

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/workflows'
  const type = searchParams.get('type') // Check if this is an email confirmation

  logger.info('[auth/callback] Request received:', {
    hasCode: !!code,
    type,
    next,
    fullUrl: request.url.substring(0, 100) + '...'
  })

  if (code) {
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      {
        cookies: {
          get(name: string) {
            return cookieStore.get(name)?.value
          },
          set(name: string, value: string, options: any) {
            cookieStore.set({ name, value, ...options })
          },
          remove(name: string, options: any) {
            cookieStore.set({ name, value: '', ...options })
          },
        },
      }
    )

    const { data, error } = await supabase.auth.exchangeCodeForSession(code)

    if (error) {
      logger.error('Auth callback error:', {
        message: error.message,
        status: error.status,
        name: error.name,
        type_param: type,
      })

      const errorLower = error.message.toLowerCase()

      // If this is an email confirmation attempt, ALWAYS redirect to success page
      // The email confirmation happens on Supabase's side regardless of session errors
      // Common errors: PKCE errors, "already used", session issues - all mean email IS confirmed
      if (type === 'email-confirmation') {
        logger.info('Email confirmation callback with error, redirecting to success page anyway:', error.message)
        return NextResponse.redirect(`${origin}/auth/email-confirmed?cross_device=true`)
      }

      // Check if this is a PKCE code verifier error (cross-device confirmation)
      const isCodeVerifierError = errorLower.includes('code verifier') ||
                                   errorLower.includes('code_verifier') ||
                                   errorLower.includes('pkce') ||
                                   errorLower.includes('both auth code and code verifier')

      if (isCodeVerifierError) {
        // Likely a cross-device confirmation - show success page
        logger.info('Code verifier error detected (likely cross-device), redirecting to success page')
        return NextResponse.redirect(`${origin}/auth/email-confirmed?cross_device=true`)
      }

      // For expired/invalid confirmation links, redirect to waiting-confirmation
      if (errorLower.includes('expired') || errorLower.includes('invalid')) {
        return NextResponse.redirect(`${origin}/auth/waiting-confirmation?expired=true`)
      }

      // Generic error
      return NextResponse.redirect(`${origin}/auth/auth-code-error?error=${encodeURIComponent(error.message)}`)
    }

    if (!error && data.user) {
      // Debug logging to understand the auth flow
      logger.info('Auth callback - User data:', {
        id: data.user.id,
        email: data.user.email,
        email_confirmed_at: data.user.email_confirmed_at,
        created_at: data.user.created_at,
        last_sign_in_at: data.user.last_sign_in_at,
        type_param: type,
      })

      // Check if this is an email confirmation
      // Supabase automatically signs the user in when they click the confirmation link
      // The session is already established via exchangeCodeForSession above
      
      // Check if user profile exists - if not, it's likely a new signup
      const { data: existingProfile } = await supabase
        .from('user_profiles')
        .select('id')
        .eq('id', data.user.id)
        .single()
      
      const isNewUser = !existingProfile

      // Determine the auth provider — OAuth users (google, github, etc.) should skip
      // the email-confirmed success page entirely and go straight to the app.
      const authProvider = data.user.app_metadata?.provider
      const isOAuthProvider = !!authProvider && authProvider !== 'email'

      // Check if this is a recent email confirmation (within last 15 minutes of creation)
      const userCreatedRecently = data.user.created_at &&
        (new Date().getTime() - new Date(data.user.created_at).getTime() < 900000) // 15 minutes

      // Check if the email was recently confirmed (within last minute)
      const emailJustConfirmed = data.user.email_confirmed_at &&
        (new Date().getTime() - new Date(data.user.email_confirmed_at).getTime() < 60000) // 1 minute

      // Determine if this is an email confirmation flow
      // OAuth providers (Google, GitHub, etc.) are never an email-confirmation flow —
      // their `email_confirmed_at` is set automatically by the provider on first sign-in.
      const isEmailConfirmation = !isOAuthProvider && (
        type === 'email-confirmation' ||
        (data.user.email_confirmed_at && (isNewUser || userCreatedRecently || emailJustConfirmed))
      )

      logger.info('Auth callback - Email confirmation check:', {
        isNewUser,
        userCreatedRecently,
        emailJustConfirmed,
        isEmailConfirmation,
        type_param: type,
        email_confirmed_at: data.user.email_confirmed_at,
      })

      // If this looks like an email confirmation (has type param OR email was recently confirmed)
      // Always send to success page - don't send directly to workflows
      if (isEmailConfirmation || type === 'email-confirmation') {
        // Email confirmation successful - user is now automatically signed in
        // Create profile if it doesn't exist
        if (isNewUser) {
          try {
            const serviceClient = getServiceClient()
            await ensureUserProfile(serviceClient, data.user.id, {
              provider: 'email',
              role: 'free',
            })
          } catch (insertError) {
            logger.error('Error creating profile during email confirmation:', insertError)
          }
        }

        // User is already signed in via exchangeCodeForSession
        // Always redirect to the email-confirmed success page
        // The page will detect if user wants to continue on this device or return to original
        logger.info('Email confirmation successful, redirecting to success page')
        return NextResponse.redirect(`${origin}/auth/email-confirmed?confirmed=true`)
      }

      // For regular OAuth login (Google, etc)
      // Check if this is a Google sign-in
      const isGoogleAuth = data.user.app_metadata?.provider === 'google' || 
                          data.user.app_metadata?.providers?.includes('google') ||
                          data.user.identities?.some(id => id.provider === 'google')
      
      logger.info('OAuth callback - Is Google auth:', isGoogleAuth, {
        provider: data.user.app_metadata?.provider,
        providers: data.user.app_metadata?.providers,
        identities: data.user.identities?.map(id => id.provider)
      })
      
      if (isGoogleAuth) {
        // Ensure profile exists for Google users
        try {
          const serviceClient = getServiceClient()
          await ensureUserProfile(serviceClient, data.user.id, {
            provider: 'google',
          })
        } catch (createError) {
          logger.error('Error ensuring Google user profile:', createError)
        }
      }

      return NextResponse.redirect(`${origin}${next}`)
    }

    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  // Return the user to an error page with instructions
  return NextResponse.redirect(`${origin}/auth/auth-code-error`)
}