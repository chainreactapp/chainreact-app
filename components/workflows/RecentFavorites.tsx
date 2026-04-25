"use client"

import { useRouter } from "next/navigation"
import { useWorkflowStore } from "@/stores/workflowStore"
import { useWorkflowFavorites } from "@/hooks/useWorkflowFavorites"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  Star,
  Clock,
  ChevronRight,
  X,
  Zap,
  Trash2,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { formatDistanceToNow } from "date-fns"

interface RecentFavoritesProps {
  className?: string
  maxItems?: number
  showClearButton?: boolean
}

export function RecentFavorites({
  className,
  maxItems = 5,
  showClearButton = true
}: RecentFavoritesProps) {
  const router = useRouter()
  const { workflows } = useWorkflowStore()
  const {
    favorites,
    recentItems,
    isLoaded,
    isFavorite,
    toggleFavorite,
    removeFromRecent,
    clearRecent,
    getValidFavorites,
    getValidRecentItems
  } = useWorkflowFavorites()

  if (!isLoaded) {
    return null
  }

  const workflowIds = workflows.map(w => w.id)
  const validFavorites = getValidFavorites(workflowIds)
  const validRecent = getValidRecentItems(workflowIds)

  // Get favorite workflows
  const favoriteWorkflows = validFavorites
    .map(id => workflows.find(w => w.id === id))
    .filter(Boolean)
    .slice(0, maxItems)

  // Get recent workflows (excluding favorites to avoid duplication)
  const recentWorkflows = validRecent
    .filter(item => !validFavorites.includes(item.id))
    .map(item => ({
      ...item,
      workflow: workflows.find(w => w.id === item.id)
    }))
    .filter(item => item.workflow)
    .slice(0, maxItems)

  // Don't render if nothing to show
  if (favoriteWorkflows.length === 0 && recentWorkflows.length === 0) {
    return null
  }

  return (
    <div className={cn("space-y-6", className)}>
      {/* Favorites Section */}
      {favoriteWorkflows.length > 0 && (
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />
              Favorites
            </h3>
            <Badge variant="secondary" className="text-xs">
              {favoriteWorkflows.length}
            </Badge>
          </div>

          <div className="space-y-1">
            {favoriteWorkflows.map((workflow: any) => (
              <div
                key={workflow.id}
                className="group flex items-center gap-2 p-2 rounded-lg hover:bg-muted/50 cursor-pointer transition-colors"
                onClick={() => router.push(`/workflows/builder/${workflow.id}`)}
              >
                <div className="flex items-center justify-center w-6 h-6 rounded bg-primary/10">
                  <Zap className="w-3 h-3 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{workflow.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {workflow.status === 'active' ? 'Active' : 'Draft'}
                  </p>
                </div>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100"
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleFavorite(workflow.id)
                        }}
                        aria-label={`Remove ${workflow.name} from favorites`}
                      >
                        <Star className="w-3.5 h-3.5 text-yellow-500 fill-yellow-500" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="left">
                      <p className="text-xs">Remove from favorites</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Section */}
      {recentWorkflows.length > 0 && (
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <Clock className="w-4 h-4 text-muted-foreground" />
              Recently Opened
            </h3>
            {showClearButton && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-xs text-muted-foreground hover:text-foreground"
                      onClick={clearRecent}
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="left">
                    <p className="text-xs">Clear recent items</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>

          <div className="space-y-1">
            {recentWorkflows.map((item: any) => (
              <div
                key={item.id}
                className="group flex items-center gap-2 p-2 rounded-lg hover:bg-muted/50 cursor-pointer transition-colors"
                onClick={() => router.push(`/workflows/builder/${item.id}`)}
              >
                <div className="flex items-center justify-center w-6 h-6 rounded bg-muted">
                  <Zap className="w-3 h-3 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{item.workflow.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(item.accessedAt), { addSuffix: true })}
                  </p>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0"
                          onClick={(e) => {
                            e.stopPropagation()
                            toggleFavorite(item.id)
                          }}
                          aria-label={`${isFavorite(item.id) ? 'Remove' : 'Add'} ${item.name} ${isFavorite(item.id) ? 'from' : 'to'} favorites`}
                        >
                          <Star className={cn(
                            "w-3.5 h-3.5",
                            isFavorite(item.id)
                              ? "text-yellow-500 fill-yellow-500"
                              : "text-muted-foreground"
                          )} />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="left">
                        <p className="text-xs">
                          {isFavorite(item.id) ? "Remove from favorites" : "Add to favorites"}
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0"
                          onClick={(e) => {
                            e.stopPropagation()
                            removeFromRecent(item.id)
                          }}
                          aria-label={`Remove ${item.name} from recent`}
                        >
                          <X className="w-3.5 h-3.5 text-muted-foreground" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="left">
                        <p className="text-xs">Remove from recent</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              </div>
            ))}
          </div>

          {validRecent.length > maxItems && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full mt-2 text-xs text-muted-foreground"
              onClick={() => router.push('/workflows')}
            >
              View all workflows
              <ChevronRight className="w-3 h-3 ml-1" />
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Star button to add/remove workflow from favorites
 */
interface FavoriteButtonProps {
  workflowId: string
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

export function FavoriteButton({ workflowId, size = 'md', className }: FavoriteButtonProps) {
  const { isFavorite, toggleFavorite } = useWorkflowFavorites()
  const favorited = isFavorite(workflowId)

  const sizeClasses = {
    sm: 'h-6 w-6',
    md: 'h-8 w-8',
    lg: 'h-10 w-10'
  }

  const iconSizes = {
    sm: 'w-3.5 h-3.5',
    md: 'w-4 h-4',
    lg: 'w-5 h-5'
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={cn(sizeClasses[size], 'p-0', className)}
            onClick={(e) => {
              e.stopPropagation()
              toggleFavorite(workflowId)
            }}
          >
            <Star className={cn(
              iconSizes[size],
              favorited
                ? "text-yellow-500 fill-yellow-500"
                : "text-muted-foreground hover:text-yellow-500"
            )} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p className="text-xs">
            {favorited ? "Remove from favorites" : "Add to favorites"}
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
