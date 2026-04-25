"use client"

import { useState, useCallback, useEffect } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Search, HelpCircle, LogOut, Settings, ChevronDown, BarChart3, Menu } from "lucide-react"
import { useAuthStore } from "@/stores/authStore"
import { useSignedAvatarUrl } from "@/hooks/useSignedAvatarUrl"
import { getGravatarUrl } from "@/lib/utils/gravatar"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { NotificationDropdown } from "@/components/ui/notification-dropdown"
import { CommandPalette } from "@/components/new-design/CommandPalette"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

interface UnifiedTopBarProps {
  actions?: React.ReactNode
  onMenuClick?: () => void
}

function getInitials(profile: any, email?: string): string {
  const fullName = profile?.full_name || ""
  if (fullName) {
    const parts = fullName.trim().split(/\s+/)
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    }
    return fullName.slice(0, 2).toUpperCase()
  }
  return (email?.charAt(0) || "U").toUpperCase()
}

export function UnifiedTopBar({ actions, onMenuClick }: UnifiedTopBarProps) {
  const router = useRouter()
  const { profile, user, signOut } = useAuthStore()
  const avatarUrl = profile?.avatar_url || null
  const { signedUrl: avatarSignedUrl } = useSignedAvatarUrl(avatarUrl || undefined)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)

  const displayName = profile?.full_name || user?.email?.split("@")[0] || "User"
  const initials = getInitials(profile, user?.email)

  const tasksUsed = profile?.tasks_used ?? 0
  const tasksLimit = profile?.tasks_limit ?? 100
  const tasksPercent = Math.min((tasksUsed / tasksLimit) * 100, 100)

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "k") {
      e.preventDefault()
      setCommandPaletteOpen(true)
    }
  }, [])

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [handleKeyDown])

  const handleSignOut = async () => {
    await signOut()
    router.push("/auth/login")
  }

  return (
    <>
      <header className="flex items-center justify-between h-16 px-6 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 shrink-0">
        {/* Left: mobile hamburger, otherwise spacer */}
        <div className="flex items-center gap-3 min-w-0">
          {onMenuClick && (
            <button
              type="button"
              onClick={onMenuClick}
              aria-label="Open navigation menu"
              className="md:hidden flex items-center justify-center h-9 w-9 -ml-2 rounded-md text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              <Menu className="h-5 w-5" />
            </button>
          )}
        </div>

        {/* Right: Search + Tasks + Help + Notifications + Profile */}
        <div className="flex items-center gap-1.5">
          {/* Search */}
          <button
            onClick={() => setCommandPaletteOpen(true)}
            aria-label="Open command palette"
            className="hidden md:flex items-center gap-2 h-8 px-3 rounded-md border border-gray-200 dark:border-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600 transition-colors text-xs"
          >
            <Search className="h-3.5 w-3.5" />
            <span>Search...</span>
            <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-[10px] font-mono text-gray-400">
              <span className="text-xs">&#8984;</span>K
            </kbd>
          </button>

          <button
            onClick={() => setCommandPaletteOpen(true)}
            aria-label="Search"
            className="md:hidden flex items-center justify-center h-8 w-8 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            <Search className="h-4 w-4" />
          </button>

          {/* Tasks usage with dropdown */}
          <Popover>
            <PopoverTrigger asChild>
              <button className="hidden sm:flex items-center gap-2 h-8 px-3 rounded-md border border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors">
                <BarChart3 className="h-3.5 w-3.5 text-gray-400" />
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Tasks</span>
                <div className="w-20 h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all duration-300",
                      tasksPercent > 90 ? "bg-red-500" : tasksPercent > 70 ? "bg-amber-500" : "bg-orange-500"
                    )}
                    style={{ width: `${tasksPercent}%` }}
                  />
                </div>
                <span className="text-[11px] font-semibold text-gray-600 dark:text-gray-300">
                  {Math.round(tasksPercent)}%
                </span>
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 p-0">
              <div className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">Task Usage</span>
                  <span className={cn(
                    "text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full",
                    tasksPercent > 90
                      ? "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400"
                      : tasksPercent > 70
                        ? "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400"
                        : "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400"
                  )}>
                    {tasksPercent > 90 ? "Critical" : tasksPercent > 70 ? "Warning" : "Healthy"}
                  </span>
                </div>

                <div className="w-full h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden mb-3">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all duration-300",
                      tasksPercent > 90 ? "bg-red-500" : tasksPercent > 70 ? "bg-amber-500" : "bg-orange-500"
                    )}
                    style={{ width: `${tasksPercent}%` }}
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500 dark:text-gray-400">Used</span>
                    <span className="text-xs font-semibold text-gray-900 dark:text-gray-100">{tasksUsed} tasks</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500 dark:text-gray-400">Remaining</span>
                    <span className="text-xs font-semibold text-gray-900 dark:text-gray-100">{tasksLimit - tasksUsed} tasks</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500 dark:text-gray-400">Plan limit</span>
                    <span className="text-xs font-semibold text-gray-900 dark:text-gray-100">{tasksLimit} tasks / month</span>
                  </div>
                </div>
              </div>

              <div className="border-t border-gray-200 dark:border-gray-800 px-4 py-3">
                <button
                  onClick={() => router.push("/subscription")}
                  className="w-full text-xs font-medium text-orange-600 dark:text-orange-400 hover:text-orange-700 dark:hover:text-orange-300 transition-colors text-center"
                >
                  Manage Plan & Billing →
                </button>
              </div>
            </PopoverContent>
          </Popover>

          {/* Help */}
          <Link
            href="/support"
            className="flex items-center gap-1.5 h-8 px-2 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            title="Help & Support"
          >
            <HelpCircle className="h-4 w-4" />
            <span className="text-xs font-medium hidden sm:inline">Help</span>
          </Link>

          {/* Notifications */}
          <NotificationDropdown />

          {/* Custom actions slot */}
          {actions && (
            <>
              <div className="w-px h-4 bg-gray-200 dark:bg-gray-700 mx-1" />
              {actions}
            </>
          )}

          {/* Separator before profile */}
          <div className="w-px h-4 bg-gray-200 dark:bg-gray-700 mx-0.5" />

          {/* Profile dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-1.5 rounded-md px-1.5 py-1 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                <Avatar className="h-7 w-7">
                  <AvatarImage
                    src={avatarSignedUrl || (user?.email ? getGravatarUrl(user.email, 56) : undefined)}
                    alt={displayName}
                    className="object-cover"
                  />
                  <AvatarFallback className="bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 text-[10px] font-semibold">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <ChevronDown className="h-3 w-3 text-gray-400 hidden sm:block" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <div className="px-2 py-1.5">
                <p className="text-sm font-medium truncate">{displayName}</p>
                <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => router.push("/settings")}>
                <Settings className="w-4 h-4 mr-2" />
                Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleSignOut} className="text-destructive">
                <LogOut className="w-4 h-4 mr-2" />
                Sign Out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <CommandPalette open={commandPaletteOpen} onOpenChange={setCommandPaletteOpen} />
    </>
  )
}
