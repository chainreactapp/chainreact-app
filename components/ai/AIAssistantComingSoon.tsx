"use client"

import React, { useState } from 'react'
import { X, Sparkles, Mic, MessageSquare, Zap, CheckCircle, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { logger } from '@/lib/utils/logger'
import { createClient } from '@/utils/supabase/client'
import { useToast } from '@/hooks/use-toast'

interface AIAssistantComingSoonProps {
  onClose: () => void
}

export function AIAssistantComingSoon({ onClose }: AIAssistantComingSoonProps) {
  const [email, setEmail] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [hasSubmitted, setHasSubmitted] = useState(false)
  const { toast } = useToast()

  const handleWaitlistSignup = async () => {
    if (!email || !email.includes('@')) {
      toast({
        title: 'Invalid email',
        description: 'Please enter a valid email address',
        variant: 'destructive',
      })
      return
    }

    setIsSubmitting(true)

    try {
      // PR-AUTH-5: read user id from the cached auth store (no lock contention).
      const { useAuthStore } = await import('@/stores/authStore')
      const userId = useAuthStore.getState().user?.id

      if (!userId) {
        toast({
          title: 'Not authenticated',
          description: 'Please sign in to join the waitlist',
          variant: 'destructive',
        })
        return
      }

      // Store waitlist signup (you'll need to create this table)
      const supabase = createClient()
      const { error } = await supabase
        .from('ai_assistant_waitlist')
        .insert({
          user_id: userId,
          email: email,
          source: 'ai_assistant_modal',
        })

      if (error) {
        // If error is duplicate, that's fine
        if (error.code === '23505') {
          setHasSubmitted(true)
          toast({
            title: 'Already on the waitlist!',
            description: "You're all set. We'll notify you when it launches.",
          })
          return
        }
        throw error
      }

      setHasSubmitted(true)
      toast({
        title: 'You\'re on the list!',
        description: "We'll email you when AI Voice Assistant launches.",
      })

      logger.info('Waitlist signup successful')
    } catch (error) {
      logger.error('Error signing up for waitlist:', error)
      toast({
        title: 'Something went wrong',
        description: 'Please try again later',
        variant: 'destructive',
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-background/95 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <CardContent className="p-0">
          {/* Header */}
          <div className="relative bg-gradient-to-br from-primary/20 via-primary/10 to-background p-8 border-b">
            <button
              onClick={onClose}
              className="absolute top-4 right-4 p-2 hover:bg-background/50 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center">
                <Sparkles className="w-6 h-6 text-primary" />
              </div>
              <Badge variant="secondary" className="px-3 py-1">
                Coming Soon
              </Badge>
            </div>

            <h2 className="text-3xl font-bold mb-2">AI Voice Mode</h2>
            <p className="text-lg text-muted-foreground">
              Have natural, hands-free conversations with your AI assistant. Get help creating workflows,
              managing integrations, and automating tasks-all with your voice in an immersive full-screen experience.
            </p>
          </div>

          {/* Features */}
          <div className="p-8 space-y-6">
            <div>
              <h3 className="text-xl font-semibold mb-4">What you'll get:</h3>
              <div className="space-y-4">
                <FeatureItem
                  icon={<Mic className="w-5 h-5" />}
                  title="Immersive Full-Screen Experience"
                  description="Beautiful 3D visualization while you talk. No reading text-just natural conversation like talking to a real person."
                />
                <FeatureItem
                  icon={<Zap className="w-5 h-5" />}
                  title="Multitask While You Talk"
                  description="Switch browser tabs and keep working while having conversations. Your AI assistant stays active in the background."
                />
                <FeatureItem
                  icon={<MessageSquare className="w-5 h-5" />}
                  title="Conversation History"
                  description="When you're done talking, a text summary automatically appears in your chat history for reference."
                />
                <FeatureItem
                  icon={<CheckCircle className="w-5 h-5" />}
                  title="Works Everywhere"
                  description="Use it on any browser-Chrome, Safari, Firefox, or Brave. Seamless experience across all devices."
                />
              </div>
            </div>

            {/* Pricing Preview */}
            <div className="bg-muted/50 rounded-lg p-6 border">
              <h3 className="text-lg font-semibold mb-3">Early Bird Pricing</h3>
              <div className="space-y-3">
                <PricingTier
                  name="Free"
                  price="$0"
                  features={['5 voice sessions/month', '10 min per session', 'Basic voice assistant']}
                />
                <PricingTier
                  name="Pro"
                  price="$15"
                  period="/month"
                  features={['30 voice sessions/month', '15 min per session', 'Priority support']}
                  highlighted
                />
                <PricingTier
                  name="Premium"
                  price="$25"
                  period="/month"
                  features={['Unlimited sessions', '30 min per session', 'Advanced features']}
                />
              </div>
              <p className="text-xs text-muted-foreground mt-4">
                * Early bird pricing locked in for life when you sign up in the first month
              </p>
            </div>

            {/* Waitlist Signup */}
            <div className="bg-primary/5 rounded-lg p-6 border border-primary/20">
              {!hasSubmitted ? (
                <>
                  <h3 className="text-lg font-semibold mb-2">Join the Waitlist</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Be the first to know when AI Voice Assistant launches. Get early bird pricing
                    and exclusive beta access.
                  </p>
                  <div className="flex gap-2">
                    <Input
                      type="email"
                      placeholder="your@email.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      onKeyPress={(e) => {
                        if (e.key === 'Enter') {
                          handleWaitlistSignup()
                        }
                      }}
                      disabled={isSubmitting}
                      className="flex-1"
                    />
                    <Button
                      onClick={handleWaitlistSignup}
                      disabled={isSubmitting || !email}
                      className="px-6"
                    >
                      {isSubmitting ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        'Notify Me'
                      )}
                    </Button>
                  </div>
                </>
              ) : (
                <div className="text-center py-4">
                  <CheckCircle className="w-12 h-12 text-primary mx-auto mb-3" />
                  <h3 className="text-lg font-semibold mb-2">You're on the list!</h3>
                  <p className="text-sm text-muted-foreground">
                    We'll email you at <span className="font-medium">{email}</span> when
                    AI Voice Mode launches.
                  </p>
                </div>
              )}
            </div>

            {/* Estimated Launch */}
            <div className="text-center pt-4 border-t">
              <p className="text-sm text-muted-foreground">
                Estimated launch: <span className="font-medium text-foreground">TBD</span>
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Launch timing depends on user demand and revenue growth
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function FeatureItem({ icon, title, description }: { icon: React.ReactNode, title: string, description: string }) {
  return (
    <div className="flex gap-4">
      <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
        {icon}
      </div>
      <div>
        <h4 className="font-medium mb-1">{title}</h4>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  )
}

function PricingTier({
  name,
  price,
  period,
  features,
  highlighted
}: {
  name: string
  price: string
  period?: string
  features: string[]
  highlighted?: boolean
}) {
  return (
    <div className={cn(
      "p-4 rounded-lg border",
      highlighted ? "bg-primary/5 border-primary" : "bg-background"
    )}>
      <div className="flex items-baseline gap-2 mb-2">
        <span className="font-semibold">{name}</span>
        <span className="text-2xl font-bold">{price}</span>
        {period && <span className="text-sm text-muted-foreground">{period}</span>}
      </div>
      <ul className="space-y-1">
        {features.map((feature, i) => (
          <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
            <CheckCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-primary" />
            {feature}
          </li>
        ))}
      </ul>
    </div>
  )
}
