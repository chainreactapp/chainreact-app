"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import {
  Filter,
  X,
  Save,
  Trash2,
  ChevronDown,
  Calendar,
  User,
  Activity,
  Clock,
  CheckCircle2,
  Circle,
  AlertTriangle,
  Pause,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { format, subDays, subWeeks, subMonths, startOfDay, endOfDay } from "date-fns"

// Filter types
export interface WorkflowFilters {
  status: string[]
  ownership: 'all' | 'owned' | 'shared'
  dateRange: DateRangeOption
  customDateStart?: Date
  customDateEnd?: Date
}

export type DateRangeOption = 'all' | 'today' | 'week' | 'month' | '3months' | 'custom'

export interface SavedFilter {
  id: string
  name: string
  filters: WorkflowFilters
  createdAt: string
}

// Default filter state
export const defaultFilters: WorkflowFilters = {
  status: [],
  ownership: 'all',
  dateRange: 'all',
}

// Status options with icons and colors
const statusOptions = [
  { value: 'active', label: 'Active', icon: CheckCircle2, color: 'text-green-500' },
  { value: 'draft', label: 'Draft', icon: Circle, color: 'text-gray-400' },
  { value: 'paused', label: 'Paused', icon: Pause, color: 'text-orange-500' },
  { value: 'incomplete', label: 'Incomplete', icon: AlertTriangle, color: 'text-yellow-500' },
]

// Date range options
const dateRangeOptions = [
  { value: 'all', label: 'All time' },
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'Last 7 days' },
  { value: 'month', label: 'Last 30 days' },
  { value: '3months', label: 'Last 3 months' },
  { value: 'custom', label: 'Custom range' },
]

// Ownership options
const ownershipOptions = [
  { value: 'all', label: 'All workflows' },
  { value: 'owned', label: 'Created by me' },
  { value: 'shared', label: 'Shared with me' },
]

interface AdvancedFiltersProps {
  filters: WorkflowFilters
  onFiltersChange: (filters: WorkflowFilters) => void
  savedFilters?: SavedFilter[]
  onSaveFilter?: (name: string, filters: WorkflowFilters) => void
  onDeleteSavedFilter?: (id: string) => void
  onApplySavedFilter?: (filter: SavedFilter) => void
  className?: string
}

export function AdvancedFilters({
  filters,
  onFiltersChange,
  savedFilters = [],
  onSaveFilter,
  onDeleteSavedFilter,
  onApplySavedFilter,
  className
}: AdvancedFiltersProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [saveDialogOpen, setSaveDialogOpen] = useState(false)
  const [newFilterName, setNewFilterName] = useState("")

  // Count active filters
  const activeFilterCount = getActiveFilterCount(filters)

  const handleStatusToggle = (status: string) => {
    const newStatus = filters.status.includes(status)
      ? filters.status.filter(s => s !== status)
      : [...filters.status, status]
    onFiltersChange({ ...filters, status: newStatus })
  }

  const handleOwnershipChange = (ownership: 'all' | 'owned' | 'shared') => {
    onFiltersChange({ ...filters, ownership })
  }

  const handleDateRangeChange = (dateRange: DateRangeOption) => {
    onFiltersChange({ ...filters, dateRange })
  }

  const handleClearFilters = () => {
    onFiltersChange(defaultFilters)
  }

  const handleSaveFilter = () => {
    if (newFilterName.trim() && onSaveFilter) {
      onSaveFilter(newFilterName.trim(), filters)
      setNewFilterName("")
      setSaveDialogOpen(false)
    }
  }

  return (
    <div className={cn("flex items-center gap-2", className)}>
      {/* Main Filter Button */}
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          <Button
            variant={activeFilterCount > 0 ? "default" : "outline"}
            size="sm"
            className="h-9 gap-2"
          >
            <Filter className="w-4 h-4" />
            Filters
            {activeFilterCount > 0 && (
              <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
                {activeFilterCount}
              </Badge>
            )}
            <ChevronDown className="w-3 h-3 ml-1" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-0" align="start">
          <div className="p-4 space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
              <h4 className="font-semibold text-sm">Filters</h4>
              {activeFilterCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleClearFilters}
                  className="h-7 text-xs text-muted-foreground"
                >
                  Clear all
                </Button>
              )}
            </div>

            <Separator />

            {/* Status Filter */}
            <div className="space-y-2">
              <Label className="text-xs font-medium flex items-center gap-2">
                <Activity className="w-3 h-3" />
                Status
              </Label>
              <div className="grid grid-cols-2 gap-2">
                {statusOptions.map((option) => {
                  const Icon = option.icon
                  const isChecked = filters.status.includes(option.value)
                  return (
                    <div
                      key={option.value}
                      className={cn(
                        "flex items-center gap-2 p-2 rounded-md cursor-pointer transition-colors",
                        isChecked
                          ? "bg-primary/10 border border-primary/20"
                          : "hover:bg-muted border border-transparent"
                      )}
                      onClick={() => handleStatusToggle(option.value)}
                    >
                      <Checkbox
                        checked={isChecked}
                        onCheckedChange={() => handleStatusToggle(option.value)}
                        className="pointer-events-none"
                      />
                      <Icon className={cn("w-3 h-3", option.color)} />
                      <span className="text-sm">{option.label}</span>
                    </div>
                  )
                })}
              </div>
            </div>

            <Separator />

            {/* Ownership Filter */}
            <div className="space-y-2">
              <Label className="text-xs font-medium flex items-center gap-2">
                <User className="w-3 h-3" />
                Ownership
              </Label>
              <Select
                value={filters.ownership}
                onValueChange={(value) => handleOwnershipChange(value as any)}
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ownershipOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Separator />

            {/* Date Range Filter */}
            <div className="space-y-2">
              <Label className="text-xs font-medium flex items-center gap-2">
                <Calendar className="w-3 h-3" />
                Modified Date
              </Label>
              <Select
                value={filters.dateRange}
                onValueChange={(value) => handleDateRangeChange(value as DateRangeOption)}
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {dateRangeOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Saved Filters */}
            {savedFilters.length > 0 && (
              <>
                <Separator />
                <div className="space-y-2">
                  <Label className="text-xs font-medium flex items-center gap-2">
                    <Save className="w-3 h-3" />
                    Saved Filters
                  </Label>
                  <div className="space-y-1">
                    {savedFilters.map((savedFilter) => (
                      <div
                        key={savedFilter.id}
                        className="flex items-center justify-between p-2 rounded-md hover:bg-muted group"
                      >
                        <button
                          onClick={() => onApplySavedFilter?.(savedFilter)}
                          className="text-sm text-left flex-1 truncate"
                        >
                          {savedFilter.name}
                        </button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onDeleteSavedFilter?.(savedFilter.id)}
                          aria-label={`Delete saved filter ${savedFilter.name}`}
                          className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100"
                        >
                          <Trash2 className="w-3 h-3 text-muted-foreground" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Save Current Filter */}
            {onSaveFilter && activeFilterCount > 0 && (
              <>
                <Separator />
                {saveDialogOpen ? (
                  <div className="flex items-center gap-2">
                    <Input
                      placeholder="Filter name..."
                      value={newFilterName}
                      onChange={(e) => setNewFilterName(e.target.value)}
                      className="h-8 text-sm"
                      onKeyDown={(e) => e.key === 'Enter' && handleSaveFilter()}
                      autoFocus
                    />
                    <Button size="sm" className="h-8" onClick={handleSaveFilter}>
                      Save
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0"
                      onClick={() => setSaveDialogOpen(false)}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full h-8"
                    onClick={() => setSaveDialogOpen(true)}
                  >
                    <Save className="w-3 h-3 mr-2" />
                    Save current filter
                  </Button>
                )}
              </>
            )}
          </div>
        </PopoverContent>
      </Popover>

      {/* Active Filter Pills */}
      {activeFilterCount > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Status pills */}
          {filters.status.map((status) => {
            const option = statusOptions.find(o => o.value === status)
            if (!option) return null
            const Icon = option.icon
            return (
              <Badge
                key={status}
                variant="secondary"
                className="gap-1 pr-1 cursor-pointer hover:bg-secondary/80"
                onClick={() => handleStatusToggle(status)}
              >
                <Icon className={cn("w-3 h-3", option.color)} />
                {option.label}
                <X className="w-3 h-3 ml-1" />
              </Badge>
            )
          })}

          {/* Ownership pill */}
          {filters.ownership !== 'all' && (
            <Badge
              variant="secondary"
              className="gap-1 pr-1 cursor-pointer hover:bg-secondary/80"
              onClick={() => handleOwnershipChange('all')}
            >
              <User className="w-3 h-3" />
              {ownershipOptions.find(o => o.value === filters.ownership)?.label}
              <X className="w-3 h-3 ml-1" />
            </Badge>
          )}

          {/* Date range pill */}
          {filters.dateRange !== 'all' && (
            <Badge
              variant="secondary"
              className="gap-1 pr-1 cursor-pointer hover:bg-secondary/80"
              onClick={() => handleDateRangeChange('all')}
            >
              <Clock className="w-3 h-3" />
              {dateRangeOptions.find(o => o.value === filters.dateRange)?.label}
              <X className="w-3 h-3 ml-1" />
            </Badge>
          )}
        </div>
      )}
    </div>
  )
}

// Helper to count active filters
export function getActiveFilterCount(filters: WorkflowFilters): number {
  let count = 0
  if (filters.status.length > 0) count += filters.status.length
  if (filters.ownership !== 'all') count++
  if (filters.dateRange !== 'all') count++
  return count
}

// Helper to check if workflow matches filters
export function matchesFilters(
  workflow: any,
  filters: WorkflowFilters,
  userId?: string,
  validateWorkflow?: (w: any) => { isValid: boolean }
): boolean {
  // Status filter
  if (filters.status.length > 0) {
    const workflowStatus = workflow.status || 'draft'

    // Check for incomplete status (requires validation)
    if (filters.status.includes('incomplete') && validateWorkflow) {
      const validation = validateWorkflow(workflow)
      if (!validation.isValid && workflowStatus !== 'active') {
        // Workflow is incomplete, check if we're filtering for that
        if (!filters.status.includes('incomplete')) {
          return false
        }
      }
    }

    // Check normal status
    if (!filters.status.includes(workflowStatus) &&
        !(filters.status.includes('incomplete') && validateWorkflow && !validateWorkflow(workflow).isValid)) {
      return false
    }
  }

  // Ownership filter
  if (filters.ownership === 'owned' && workflow.user_id !== userId) {
    return false
  }
  if (filters.ownership === 'shared' && workflow.user_id === userId) {
    return false
  }

  // Date range filter
  if (filters.dateRange !== 'all') {
    const workflowDate = new Date(workflow.updated_at || workflow.created_at)
    const now = new Date()

    let startDate: Date
    switch (filters.dateRange) {
      case 'today':
        startDate = startOfDay(now)
        break
      case 'week':
        startDate = subDays(now, 7)
        break
      case 'month':
        startDate = subMonths(now, 1)
        break
      case '3months':
        startDate = subMonths(now, 3)
        break
      case 'custom':
        startDate = filters.customDateStart || subMonths(now, 1)
        break
      default:
        startDate = new Date(0)
    }

    if (workflowDate < startDate) {
      return false
    }

    if (filters.dateRange === 'custom' && filters.customDateEnd) {
      if (workflowDate > endOfDay(filters.customDateEnd)) {
        return false
      }
    }
  }

  return true
}
