"use client"

import React from 'react'
import { cn } from '@/lib/utils'

interface LightningLoaderProps {
  className?: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
  color?: 'primary' | 'white' | 'blue' | 'yellow' | 'orange'
}

export function LightningLoader({ 
  className, 
  size = 'md',
  color = 'primary' 
}: LightningLoaderProps) {
  const sizeClasses = {
    sm: 'w-4 h-4',
    md: 'w-6 h-6',
    lg: 'w-8 h-8',
    xl: 'w-12 h-12'
  }

  const colorClasses = {
    primary: 'text-blue-500',
    white: 'text-white',
    blue: 'text-blue-400',
    yellow: 'text-yellow-400',
    orange: 'text-orange-400',
  }

  return (
    <div className={cn('relative inline-flex items-center justify-center', sizeClasses[size], className)}>
      {/* Lightning bolt that strikes down */}
      <svg
        className={cn('absolute animate-lightning-strike', colorClasses[color])}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ filter: 'drop-shadow(0 0 3px currentColor)' }}
      >
        {/* Main lightning bolt */}
        <path
          d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="currentColor"
          fillOpacity="0.3"
          className="animate-electric-pulse"
        />
        {/* Lightning glow effect */}
        <path
          d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"
          stroke="currentColor"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          opacity="0.3"
          className="animate-flash"
        />
      </svg>
      
      {/* Impact effect at the bottom */}
      <div className={cn('absolute bottom-0 animate-impact-wave', colorClasses[color])}>
        <div className="w-full h-1 rounded-full bg-current opacity-0 animate-ripple" />
      </div>
      
      {/* Chain links that form from the lightning strike */}
      <svg
        className={cn('absolute animate-chain-form', colorClasses[color])}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Chain links with staggered animation */}
        <g className="animate-chain-shimmer">
          {/* Top chain link - appears first */}
          <path
            d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.9"
            className="animate-link-forge-1"
          />
          {/* Bottom chain link - appears second */}
          <path
            d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.9"
            className="animate-link-forge-2"
          />
        </g>
      </svg>
      
      {/* Electric sparkles that appear during transformation */}
      <div className="absolute inset-0 animate-sparkle">
        <div className={cn('absolute top-1/4 left-1/4 w-1 h-1 rounded-full bg-current animate-spark-1', colorClasses[color])} />
        <div className={cn('absolute top-3/4 right-1/4 w-1 h-1 rounded-full bg-current animate-spark-2', colorClasses[color])} />
        <div className={cn('absolute bottom-1/4 left-1/2 w-1 h-1 rounded-full bg-current animate-spark-3', colorClasses[color])} />
      </div>
    </div>
  )
}

// Full-screen loading overlay with lightning-to-chains animation
export function LightningLoaderOverlay({ 
  text = "Loading...",
  className 
}: { 
  text?: string
  className?: string 
}) {
  return (
    <div className={cn(
      'fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm',
      className
    )}>
      <div className="flex flex-col items-center space-y-4">
        <LightningLoader size="xl" color="blue" />
        {text && (
          <p className="text-sm text-muted-foreground animate-pulse">
            {text}
          </p>
        )}
      </div>
    </div>
  )
}

// Inline loading state for buttons and small areas
export function LightningLoaderInline({ 
  className,
  size = 'sm' 
}: { 
  className?: string
  size?: 'sm' | 'md' 
}) {
  return <LightningLoader size={size} className={className} />
}