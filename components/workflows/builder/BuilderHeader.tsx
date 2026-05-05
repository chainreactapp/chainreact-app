"use client"

import React, { useState, useMemo, useRef, useCallback, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useAuthStore } from "@/stores/authStore"
import { isProfileAdmin } from "@/lib/types/admin"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Undo2,
  Redo2,
  MoreVertical,
  History,
  GitBranch,
  Play,
  TestTube,
  Rocket,
  Loader2,
  Download,
  Upload,
  Trash2,
  Copy,
  Share2,
  Link2,
  Users,
  ArrowLeft,
  Settings,
  Code2,
  Clock,
  Zap,
  RotateCcw,
  FolderGit2,
  Layers,
  Archive,
  Files,
  Workflow,
  CloudCog,
  LocateFixed,
  Lock,
  Unlock,
  FileText,
  MessageSquare,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useWorkflowActions } from "@/hooks/workflows/useWorkflowActions"
import { useToast } from "@/hooks/use-toast"
import { WorkflowVersionsDialog } from "./WorkflowVersionsDialog"
import { WorkflowHistoryDialog } from "./WorkflowHistoryDialog"
import { SaveAsTemplateDialog } from "./SaveAsTemplateDialog"
import { WorkflowCommentsDialog } from "../comments/WorkflowCommentsDialog"
import { ActivationReviewDialog } from "./ActivationReviewDialog"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

interface BuilderHeaderProps {
  workflowName: string
  setWorkflowName: (name: string) => void
  hasUnsavedChanges?: boolean
  isSaving: boolean
  isExecuting?: boolean
  handleSave?: () => Promise<void>
  handleToggleLive?: () => Promise<void>
  isUpdatingStatus?: boolean
  hasPlaceholders?: boolean
  currentWorkflow?: any
  workflowId?: string | null
  editTemplateId?: string | null
  isTemplateEditing?: boolean
  onOpenTemplateSettings?: () => void
  templateSettingsLabel?: string
  handleTestSandbox?: () => void
  handleExecuteLive?: () => void
  handleExecuteLiveSequential?: () => void
  handleRunPreflight?: () => void
  isRunningPreflight?: boolean
  isStepMode?: boolean
  listeningMode?: boolean
  handleUndo?: () => void
  handleRedo?: () => void
  canUndo?: boolean
  canRedo?: boolean
  onRecenterView?: () => void
  onToggleViewLock?: () => void
  isViewLocked?: boolean
  setShowExecutionHistory?: (show: boolean) => void
  onSelectHistoryRun?: (runId: string) => Promise<void> | void
  activeRunId?: string | null
  /**
   * Deep-link target: when set (typically from `?historyExecution=` query
   * param), the History dialog auto-opens to the detail view of this run.
   */
  pendingHistoryExecutionId?: string | null
  /** Called once the deep-link target has been consumed. */
  onPendingHistoryConsumed?: () => void
  // Pre-activation review props (from useWorkflowSaveActions)
  showActivationReview?: boolean
  setShowActivationReview?: (show: boolean) => void
  confirmActivation?: () => Promise<void>
  nodes?: Array<any>
}

const BuilderHeaderComponent = ({
  workflowName,
  setWorkflowName,
  hasUnsavedChanges = false,
  isSaving,
  isExecuting = false,
  handleSave,
  handleToggleLive,
  isUpdatingStatus = false,
  hasPlaceholders = false,
  currentWorkflow,
  workflowId,
  editTemplateId,
  isTemplateEditing = false,
  onOpenTemplateSettings,
  templateSettingsLabel,
  handleTestSandbox,
  handleExecuteLive,
  handleExecuteLiveSequential,
  handleRunPreflight,
  isRunningPreflight = false,
  isStepMode = false,
  listeningMode = false,
  handleUndo,
  handleRedo,
  canUndo = false,
  canRedo = false,
  onRecenterView,
  onToggleViewLock,
  isViewLocked = false,
  setShowExecutionHistory,
  onSelectHistoryRun,
  activeRunId,
  pendingHistoryExecutionId,
  onPendingHistoryConsumed,
  showActivationReview = false,
  setShowActivationReview,
  confirmActivation,
  nodes: headerNodes,
}: BuilderHeaderProps) => {
  const router = useRouter()
  const { toast } = useToast()
  const { duplicateWorkflow, deleteWorkflow, isDuplicating, isDeleting } = useWorkflowActions()
  const { profile } = useAuthStore()
  const isAdmin = isProfileAdmin(profile)

  const [isEditingName, setIsEditingName] = useState(false)
  const [showVersionsDialog, setShowVersionsDialog] = useState(false)
  const [showHistoryDialog, setShowHistoryDialog] = useState(false)
  const [showCommentsDialog, setShowCommentsDialog] = useState(false)
  const [showShareDialog, setShowShareDialog] = useState(false)
  const [showImportDialog, setShowImportDialog] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showSaveAsTemplateDialog, setShowSaveAsTemplateDialog] = useState(false)
  const [shareEmail, setShareEmail] = useState("")
  const [shareMode, setShareMode] = useState<"view" | "edit" | "duplicate">("view")
  const [shareUrl, setShareUrl] = useState("")
  const [isGeneratingLink, setIsGeneratingLink] = useState(false)
  const [importJson, setImportJson] = useState("")
  const [isImporting, setIsImporting] = useState(false)
  const [pendingNavigation, setPendingNavigation] = useState(false)

  const isSavingRef = useRef(false)
  const isNavigatingRef = useRef(false)

  // Prefetch workflows page for instant back navigation
  useEffect(() => {
    router.prefetch('/workflows')
  }, [router])

  // Deep-link: when a `?historyExecution=...` query param arrives via prop,
  // open the History dialog. WorkflowHistoryDialog handles the auto-select
  // into detail view from there.
  useEffect(() => {
    if (pendingHistoryExecutionId) {
      setShowHistoryDialog(true)
    }
  }, [pendingHistoryExecutionId])

  const isLiveTestingDisabled = isExecuting || isSaving

  const statusBadge = useMemo(() => {
    if (isExecuting) {
      return { text: "Running", className: "bg-blue-50 text-blue-600 border-blue-200" }
    }
    if (isSaving) {
      return { text: "Saving…", className: "bg-muted text-muted-foreground border-muted" }
    }
    if (hasUnsavedChanges) {
      return { text: "Unsaved", className: "bg-orange-50 text-orange-600 border-orange-300" }
    }
    return null
  }, [hasUnsavedChanges, isExecuting, isSaving])

  const isTemplateInstance = Boolean(editTemplateId || currentWorkflow?.source_template_id)

  const canDeleteWorkflow =
    isAdmin || (!isTemplateInstance && (!currentWorkflow?.user_id || currentWorkflow?.user_id === profile?.id))

  const handleNameCommit = useCallback(() => {
    setIsEditingName(false)

    if (!handleSave) {
      return
    }

    if (isSavingRef.current || isSaving || !hasUnsavedChanges) {
      return
    }

    isSavingRef.current = true
    handleSave().finally(() => {
      setTimeout(() => {
        isSavingRef.current = false
      }, 100)
    })
  }, [handleSave, hasUnsavedChanges, isSaving])

  useEffect(() => {
    if (!isSaving) {
      isSavingRef.current = false
    }
  }, [isSaving])

  const handleDuplicateClick = useCallback(() => {
    if (workflowId) {
      duplicateWorkflow(workflowId)
    }
  }, [duplicateWorkflow, workflowId])

  const handleDeleteClick = useCallback(() => {
    if (!canDeleteWorkflow) {
      toast({
        title: "Permission denied",
        description: "You do not have permission to delete this workflow.",
        variant: "destructive",
      })
      return
    }
    setShowDeleteConfirm(true)
  }, [canDeleteWorkflow, toast])

  const handleConfirmDelete = useCallback(() => {
    if (workflowId && canDeleteWorkflow) {
      deleteWorkflow(workflowId)
      setShowDeleteConfirm(false)
    }
  }, [canDeleteWorkflow, deleteWorkflow, workflowId])

  const isActive = currentWorkflow?.status === "active"

  const handleGenerateShareLink = async () => {
    if (!workflowId) return

    setIsGeneratingLink(true)
    try {
      const baseUrl = window.location.origin
      let url = ""

      if (shareMode === "view") {
        url = `${baseUrl}/workflows/view/${workflowId}`
      } else if (shareMode === "edit") {
        url = `${baseUrl}/workflows/builder/${workflowId}?collaborative=true`
      } else {
        url = `${baseUrl}/workflows/duplicate/${workflowId}`
      }

      setShareUrl(url)
      await navigator.clipboard.writeText(url)

      toast({
        title: "Link copied",
        description: "Share link has been copied to your clipboard.",
      })
    } catch (_error) {
      toast({
        title: "Error",
        description: "Failed to generate share link.",
        variant: "destructive",
      })
    } finally {
      setIsGeneratingLink(false)
    }
  }

  const handleShareWithEmail = async () => {
    if (!shareEmail || !workflowId) {
      toast({
        title: "Error",
        description: "Please enter a valid email address.",
        variant: "destructive",
      })
      return
    }

    try {
      // TODO: Implement backend API to share workflow with specific user
      toast({
        title: "Success",
        description: `Workflow shared with ${shareEmail}`,
      })
      setShareEmail("")
      setShowShareDialog(false)
    } catch (_error) {
      toast({
        title: "Error",
        description: "Failed to share workflow.",
        variant: "destructive",
      })
    }
  }

  const handleExportWorkflow = async () => {
    if (!currentWorkflow) return

    try {
      const exportData = {
        name: currentWorkflow.name,
        description: currentWorkflow.description,
        nodes: currentWorkflow.nodes,
        connections: currentWorkflow.connections,
        version: "1.0",
        exported_at: new Date().toISOString(),
      }

      const json = JSON.stringify(exportData, null, 2)
      await navigator.clipboard.writeText(json)

      const blob = new Blob([json], { type: "application/json" })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = `${currentWorkflow.name.replace(/[^a-z0-9]/gi, "_")}.json`
      anchor.click()
      URL.revokeObjectURL(url)

      toast({
        title: "Workflow exported",
        description: "JSON copied to clipboard and downloaded.",
      })
    } catch (_error) {
      toast({
        title: "Error",
        description: "Failed to export workflow.",
        variant: "destructive",
      })
    }
  }

  const handleImportWorkflow = async () => {
    if (!importJson.trim()) {
      toast({
        title: "Error",
        description: "Please paste workflow JSON.",
        variant: "destructive",
      })
      return
    }

    try {
      setIsImporting(true)
      const data = JSON.parse(importJson)

      if (!data.nodes || !data.connections) {
        throw new Error("Invalid workflow format")
      }

      // TODO: Implement backend API to import workflow
      toast({
        title: "Workflow imported",
        description: "Workflow has been imported successfully.",
      })

      setImportJson("")
      setShowImportDialog(false)
      window.location.reload()
    } catch (_error) {
      toast({
        title: "Error",
        description: "Invalid workflow JSON format.",
        variant: "destructive",
      })
    } finally {
      setIsImporting(false)
    }
  }

  // Watch for save completion when navigation is pending
  useEffect(() => {
    if (pendingNavigation && !isSaving && !isNavigatingRef.current) {
      // Save completed, navigate now
      isNavigatingRef.current = true
      setPendingNavigation(false)
      router.push('/workflows')
    }
  }, [pendingNavigation, isSaving, router])

  return (
    <>
      <div className="h-12 border-b bg-white dark:bg-gray-900 dark:border-gray-800 flex items-center justify-between px-3 sm:px-4 md:px-6 shrink-0">
        {/* Left Section: Back + Name + Status */}
        <div className="flex-1 min-w-0 flex items-center gap-2 sm:gap-4 md:gap-6">
          <button
            onClick={() => {
              if (isSaving) {
                setPendingNavigation(true)
                return
              }
              router.push('/workflows')
            }}
            disabled={isSaving || pendingNavigation}
            className="group flex items-center gap-1.5 sm:gap-2 px-0 py-2 bg-transparent border-none transition-all duration-200 ease-out hover:-translate-x-1 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
            title={isSaving || pendingNavigation ? "Saving..." : "Back to workflows"}
          >
            {isSaving || pendingNavigation ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-[#9CA3AF]" />
            ) : (
              <>
                <ArrowLeft className="w-4 h-4 text-gray-400 group-hover:text-gray-500 transition-colors" />
                <span className="hidden sm:inline text-sm font-medium text-gray-400 group-hover:text-gray-500 transition-colors">
                  Back
                </span>
              </>
            )}
          </button>

          {isEditingName ? (
            <input
              type="text"
              value={workflowName}
              onChange={(event) => setWorkflowName(event.target.value)}
              onBlur={handleNameCommit}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault()
                  handleNameCommit()
                }
                if (event.key === "Escape") {
                  event.preventDefault()
                  setIsEditingName(false)
                }
              }}
              autoFocus
              className="text-sm font-semibold border-none outline-none ring-0 px-2 py-1 bg-transparent w-full max-w-[120px] sm:max-w-[200px] md:max-w-md"
              style={{ boxShadow: 'none', border: 'none', height: 'auto' }}
              placeholder="Untitled Workflow"
              maxLength={100}
            />
          ) : (
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              <div
                onClick={() => setIsEditingName(true)}
                className="cursor-pointer hover:bg-accent px-1.5 sm:px-2 py-1 rounded-md transition-colors min-w-0"
              >
                <h1 className="text-sm font-semibold truncate max-w-[100px] sm:max-w-[160px] md:max-w-none">
                  {workflowName || "Untitled Workflow"}
                </h1>
              </div>
              <span
                className={cn(
                  "text-[10px] px-1.5 sm:px-2 py-0.5 rounded-full whitespace-nowrap font-medium shrink-0 hidden xs:inline-flex",
                  currentWorkflow?.is_active
                    ? "bg-green-50 text-green-700 border border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800"
                    : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
                )}
              >
                {currentWorkflow?.is_active ? "Scheduled" : "Not scheduled"}
              </span>
            </div>
          )}

          {statusBadge && (
            <span
              className={cn(
                "text-xs px-1.5 sm:px-2 py-0.5 rounded-md border shrink-0 hidden sm:inline-flex",
                statusBadge.className
              )}
            >
              {statusBadge.text}
            </span>
          )}
        </div>

        {/* Right Section: Actions */}
        <div className="flex items-center gap-1 sm:gap-2 md:gap-3">
          {/* Undo/Redo - Hidden on mobile */}
          <div className="hidden md:flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleUndo}
              disabled={!canUndo || !handleUndo}
              title="Undo (Cmd+Z)"
              className="h-8 w-8"
            >
              <Undo2 className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleRedo}
              disabled={!canRedo || !handleRedo}
              title="Redo (Cmd+Shift+Z)"
              className="h-8 w-8"
            >
              <Redo2 className="w-4 h-4" />
            </Button>
          </div>

          {/* View Controls - Hidden on mobile */}
          <div className="hidden lg:flex items-center gap-1">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={onRecenterView}
                    disabled={!onRecenterView}
                    title="Recenter workflow"
                    className="h-8 w-8"
                  >
                    <LocateFixed className="w-4 h-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Recenter</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={isViewLocked ? "secondary" : "ghost"}
                    size="icon"
                    onClick={onToggleViewLock}
                    disabled={!onToggleViewLock}
                    title={isViewLocked ? "View locked (click to unlock)" : "Lock view"}
                    className="h-8 w-8"
                  >
                    {isViewLocked ? (
                      <Lock className="w-4 h-4" />
                    ) : (
                      <Unlock className="w-4 h-4" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{isViewLocked ? "View locked" : "Lock view"}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>

          {/* Secondary Actions - Hidden on small screens */}
          <div className="hidden sm:flex items-center gap-1">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      toast({ title: "Run via API", description: "Coming soon!" })
                    }}
                    className="h-8 w-8"
                  >
                    <CloudCog className="w-4 h-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Run via API</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setShowHistoryDialog(true)}
                    className="h-8 w-8"
                  >
                    <History className="w-4 h-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>History</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setShowVersionsDialog(true)}
                    className="h-8 w-8 hidden md:inline-flex"
                  >
                    <Layers className="w-4 h-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Versions</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setShowCommentsDialog(true)}
                    className="h-8 w-8 hidden md:inline-flex"
                  >
                    <MessageSquare className="w-4 h-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Comments</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>

          {/* Primary Actions: Test + Publish */}
          <div className="flex items-center gap-1.5 sm:gap-2">
            {/* Test Button */}
            {handleExecuteLive && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleExecuteLive}
                disabled={isLiveTestingDisabled || hasPlaceholders}
                className="flex items-center gap-1.5 h-8 px-2 sm:px-3"
              >
                <Play className="w-4 h-4" />
                <span className="hidden xs:inline">Test</span>
              </Button>
            )}

            {/* Publish Button */}
            {handleToggleLive && (
              <Button
                variant="default"
                size="sm"
                onClick={handleToggleLive}
                disabled={isUpdatingStatus || hasPlaceholders}
                className={cn(
                  "flex items-center gap-1.5 h-8 px-2 sm:px-3",
                  isActive
                    ? "bg-green-600 hover:bg-green-700 text-white"
                    : "bg-blue-600 hover:bg-blue-700 text-white"
                )}
              >
                {isUpdatingStatus ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Rocket className="w-4 h-4" />
                )}
                <span className="hidden xs:inline">{isActive ? "Published" : "Publish"}</span>
              </Button>
            )}
          </div>

          {/* Share Button - Hidden on mobile, in menu */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowShareDialog(true)}
                  className="h-8 w-8 hidden sm:inline-flex"
                >
                  <Share2 className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Share</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon">
                <MoreVertical className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {/* Mobile-only: View controls */}
              <DropdownMenuItem onClick={onRecenterView} className="lg:hidden">
                <LocateFixed className="w-4 h-4 mr-2" />
                Recenter View
              </DropdownMenuItem>

              <DropdownMenuItem onClick={onToggleViewLock} className="lg:hidden">
                {isViewLocked ? <Lock className="w-4 h-4 mr-2" /> : <Unlock className="w-4 h-4 mr-2" />}
                {isViewLocked ? "Unlock View" : "Lock View"}
              </DropdownMenuItem>

              {/* Mobile-only: Undo/Redo */}
              <DropdownMenuItem onClick={handleUndo} disabled={!canUndo} className="md:hidden">
                <Undo2 className="w-4 h-4 mr-2" />
                Undo
              </DropdownMenuItem>

              <DropdownMenuItem onClick={handleRedo} disabled={!canRedo} className="md:hidden">
                <Redo2 className="w-4 h-4 mr-2" />
                Redo
              </DropdownMenuItem>

              <DropdownMenuSeparator className="lg:hidden" />

              {/* Mobile-only: Share */}
              <DropdownMenuItem onClick={() => setShowShareDialog(true)} className="sm:hidden">
                <Share2 className="w-4 h-4 mr-2" />
                Share
              </DropdownMenuItem>

              <DropdownMenuItem onClick={handleExportWorkflow}>
                <Download className="w-4 h-4 mr-2" />
                Export as JSON
              </DropdownMenuItem>

              <DropdownMenuItem onClick={() => setShowImportDialog(true)}>
                <Upload className="w-4 h-4 mr-2" />
                Import Workflow
              </DropdownMenuItem>

              <DropdownMenuItem onClick={handleDuplicateClick} disabled={isDuplicating}>
                <Copy className="w-4 h-4 mr-2" />
                {isDuplicating ? "Duplicating…" : "Duplicate Workflow"}
              </DropdownMenuItem>

              <DropdownMenuItem onClick={() => setShowSaveAsTemplateDialog(true)}>
                <FileText className="w-4 h-4 mr-2" />
                Save as Template
              </DropdownMenuItem>

              <DropdownMenuSeparator />

              {/* Mobile-only: API */}
              <DropdownMenuItem
                onClick={() => toast({ title: "Run via API", description: "Coming soon!" })}
                className="sm:hidden"
              >
                <CloudCog className="w-4 h-4 mr-2" />
                Run via API
              </DropdownMenuItem>

              <DropdownMenuItem onClick={() => setShowVersionsDialog(true)} className="md:hidden">
                <Layers className="w-4 h-4 mr-2" />
                Versions
              </DropdownMenuItem>

              <DropdownMenuItem onClick={() => setShowCommentsDialog(true)} className="md:hidden">
                <MessageSquare className="w-4 h-4 mr-2" />
                Comments
              </DropdownMenuItem>

              <DropdownMenuItem onClick={() => {
                setShowHistoryDialog(true)
                setShowExecutionHistory?.(true)
              }} className="sm:hidden">
                <History className="w-4 h-4 mr-2" />
                Workflow History
              </DropdownMenuItem>

              <DropdownMenuItem onClick={() => {
                toast({
                  title: "Workflow Settings",
                  description: "Settings will be available when publishing the workflow.",
                })
              }}>
                <Settings className="w-4 h-4 mr-2" />
                Workflow Settings
              </DropdownMenuItem>

              <DropdownMenuSeparator />

              {canDeleteWorkflow && (
                <DropdownMenuItem
                  onClick={handleDeleteClick}
                  disabled={isDeleting}
                  className="text-destructive"
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  {isDeleting ? "Deleting…" : "Delete Workflow"}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <Dialog open={showShareDialog} onOpenChange={setShowShareDialog}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Share Workflow</DialogTitle>
            <DialogDescription>Invite teammates or share a link to this workflow.</DialogDescription>
          </DialogHeader>
          <div className="space-y-6 py-4">
            <div className="space-y-2">
              <Label htmlFor="share-email">Invite by email</Label>
              <div className="flex gap-2">
                <Input
                  id="share-email"
                  placeholder="teammate@example.com"
                  value={shareEmail}
                  onChange={(event) => setShareEmail(event.target.value)}
                />
                <Button onClick={handleShareWithEmail} disabled={!shareEmail}>
                  <Users className="w-4 h-4 mr-2" />
                  Invite
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Shareable link</Label>
              <div className="flex items-center justify-between rounded-md border px-3 py-2">
                <div>
                  <div className="text-sm font-medium">Share mode</div>
                  <div className="text-xs text-muted-foreground">
                    Choose the access level for the link
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={shareMode}
                    onChange={(event) =>
                      setShareMode(event.target.value as "view" | "edit" | "duplicate")
                    }
                    className="h-8 rounded-md border bg-background px-2 text-sm"
                  >
                    <option value="view">View only</option>
                    <option value="edit">Collaborate</option>
                    <option value="duplicate">Duplicate</option>
                  </select>
                  <Button onClick={handleGenerateShareLink} disabled={isGeneratingLink}>
                    {isGeneratingLink ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Generating…
                      </>
                    ) : (
                      <>
                        <Link2 className="w-4 h-4 mr-2" />
                        Copy link
                      </>
                    )}
                  </Button>
                </div>
              </div>

              {shareUrl && (
                <div className="rounded-md border bg-muted px-3 py-2 text-xs font-mono break-all">
                  {shareUrl}
                </div>
              )}
            </div>

            {isTemplateEditing && (
              <div className="flex items-center justify-between rounded-md border px-4 py-3">
                <div>
                  <div className="text-sm font-medium">Template settings sidebar</div>
                  <div className="text-xs text-muted-foreground">
                    Quickly update key template information in the sidebar editor.
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={onOpenTemplateSettings}>
                  {templateSettingsLabel || "Open settings"}
                </Button>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowShareDialog(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Import Workflow</DialogTitle>
            <DialogDescription>Paste workflow JSON or upload a .json file.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="import-json">Workflow JSON</Label>
              <Textarea
                id="import-json"
                placeholder="Paste workflow JSON here…"
                value={importJson}
                onChange={(event) => setImportJson(event.target.value)}
                rows={10}
                className="font-mono text-xs"
              />
            </div>
            <div className="text-sm text-muted-foreground">
              Tip: You can also paste workflow JSON directly onto the canvas using Cmd+V (Mac) or
              Ctrl+V (Windows).
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowImportDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleImportWorkflow} disabled={isImporting || !importJson.trim()}>
              {isImporting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Importing…
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4 mr-2" />
                  Import
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Workflow</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete “{workflowName || "Untitled Workflow"}”? This action
              cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteConfirm(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleConfirmDelete} disabled={isDeleting}>
              {isDeleting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Deleting…
                </>
              ) : (
                "Delete Workflow"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <WorkflowVersionsDialog
        open={showVersionsDialog}
        onOpenChange={setShowVersionsDialog}
        workflowId={workflowId || ""}
      />

      <WorkflowHistoryDialog
        open={showHistoryDialog}
        onOpenChange={setShowHistoryDialog}
        workflowId={workflowId || ""}
        onSelectRun={onSelectHistoryRun}
        activeRunId={activeRunId}
        pendingExecutionId={pendingHistoryExecutionId ?? null}
        onPendingConsumed={onPendingHistoryConsumed}
      />

      <SaveAsTemplateDialog
        open={showSaveAsTemplateDialog}
        onOpenChange={setShowSaveAsTemplateDialog}
        workflow={currentWorkflow ? {
          id: currentWorkflow.id,
          name: workflowName,
          description: currentWorkflow.description,
          nodes: currentWorkflow.nodes || [],
          connections: currentWorkflow.connections || [],
        } : null}
      />

      <WorkflowCommentsDialog
        open={showCommentsDialog}
        onOpenChange={setShowCommentsDialog}
        workflowId={workflowId || ""}
      />

      {/* Pre-Activation Review Dialog (legacy builder path) */}
      {setShowActivationReview && confirmActivation && (
        <ActivationReviewDialog
          open={showActivationReview}
          onOpenChange={setShowActivationReview}
          onConfirm={confirmActivation}
          isActivating={isUpdatingStatus}
          nodes={headerNodes ?? []}
        />
      )}
    </>
  )
}

export const BuilderHeader = React.memo(
  BuilderHeaderComponent,
  (prevProps, nextProps) =>
    prevProps.workflowName === nextProps.workflowName &&
    prevProps.hasUnsavedChanges === nextProps.hasUnsavedChanges &&
    prevProps.isSaving === nextProps.isSaving &&
    prevProps.isExecuting === nextProps.isExecuting &&
    prevProps.isUpdatingStatus === nextProps.isUpdatingStatus &&
    prevProps.workflowId === nextProps.workflowId &&
    prevProps.editTemplateId === nextProps.editTemplateId &&
    prevProps.isTemplateEditing === nextProps.isTemplateEditing &&
    prevProps.templateSettingsLabel === nextProps.templateSettingsLabel &&
    prevProps.isRunningPreflight === nextProps.isRunningPreflight &&
    prevProps.isStepMode === nextProps.isStepMode &&
    prevProps.listeningMode === nextProps.listeningMode &&
    prevProps.canUndo === nextProps.canUndo &&
    prevProps.canRedo === nextProps.canRedo &&
    prevProps.currentWorkflow?.status === nextProps.currentWorkflow?.status &&
    prevProps.currentWorkflow?.source_template_id === nextProps.currentWorkflow?.source_template_id
)
