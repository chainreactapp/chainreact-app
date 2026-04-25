"use client"

import { useState, useCallback } from "react"
import { AuthReadyGuard } from "@/components/common/AuthReadyGuard"
import { GlobalKeyboardShortcuts } from "@/components/common/GlobalKeyboardShortcuts"
import { UnifiedSidebar } from "./UnifiedSidebar"
import { UnifiedTopBar } from "./UnifiedTopBar"
import { type KeyboardShortcut } from "@/hooks/useKeyboardShortcuts"

interface AppShellProps {
  children: React.ReactNode
  headerActions?: React.ReactNode
  onSave?: () => void
  pageShortcuts?: KeyboardShortcut[]
  loadingMessage?: string
  noPadding?: boolean
}

export function AppShell({
  children,
  headerActions,
  onSave,
  pageShortcuts,
  loadingMessage = "Loading...",
  noPadding = false,
}: AppShellProps) {
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)

  const handleOpenCommandPalette = useCallback(() => {
    setCommandPaletteOpen(true)
  }, [])

  return (
    <AuthReadyGuard loadingMessage={loadingMessage}>
      <GlobalKeyboardShortcuts
        onOpenCommandPalette={handleOpenCommandPalette}
        onSave={onSave}
        pageShortcuts={pageShortcuts}
      >
        <div className="flex h-screen overflow-hidden bg-white dark:bg-gray-950">
          {/* Sidebar: icon rail + nav panel (off-canvas drawer on mobile) */}
          <UnifiedSidebar
            isMobileOpen={mobileSidebarOpen}
            onMobileClose={() => setMobileSidebarOpen(false)}
          />

          {/* Main content area */}
          <div className="flex-1 flex flex-col overflow-hidden min-w-0">
            <UnifiedTopBar
              actions={headerActions}
              onMenuClick={() => setMobileSidebarOpen(true)}
            />

            <main className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-950 relative">
              {noPadding ? (
                <div className="min-h-full w-full pb-16">{children}</div>
              ) : (
                <div className="min-h-full w-full px-6 pt-6 pb-16">{children}</div>
              )}
            </main>
          </div>
        </div>
      </GlobalKeyboardShortcuts>
    </AuthReadyGuard>
  )
}
