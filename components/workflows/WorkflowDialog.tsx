"use client"

import type React from "react"
import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Loader2, User, Users, Building2 } from "lucide-react"
import { useWorkflows } from "@/hooks/use-workflows"
import { useWorkspaces } from "@/hooks/useWorkspaces"
import { useWorkflowStore } from "@/stores/workflowStore"
import { useAuthStore } from "@/stores/authStore"
import { toast } from "sonner"

import { logger } from '@/lib/utils/logger'
import type { Workflow } from "@/stores/workflowStore"

interface WorkflowDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workflow?: Workflow | null // If provided, we're editing; otherwise creating
  onSuccess?: () => void // Callback after successful create/update
}

export default function WorkflowDialog({
  open,
  onOpenChange,
  workflow,
  onSuccess
}: WorkflowDialogProps) {
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [selectedWorkspace, setSelectedWorkspace] = useState<string>("personal:")
  const [setAsDefault, setSetAsDefault] = useState(false)
  const [loading, setLoading] = useState(false)
  const { createNewWorkflow, updateWorkflowById } = useWorkflows()
  const { workspaces, loading: workspacesLoading } = useWorkspaces()
  const { setWorkspaceContext } = useWorkflowStore()
  const { profile, updateProfile } = useAuthStore()
  const router = useRouter()

  const isEditMode = !!workflow

  // Reset form when dialog opens/closes or workflow changes
  useEffect(() => {
    if (open) {
      if (workflow) {
        setName(workflow.name || "")
        setDescription(workflow.description || "")
      } else {
        setName("")
        setDescription("")
        setSelectedWorkspace("personal:")
        setSetAsDefault(false)
      }
    }
  }, [open, workflow])

  // Check if selected workspace matches user's default
  useEffect(() => {
    if (!isEditMode && profile) {
      const [workspaceType, workspaceId] = selectedWorkspace.split(':')

      // Check if this workspace is the user's default
      const isDefault = profile.default_workspace_type === workspaceType &&
        (workspaceType === 'personal' || profile.default_workspace_id === workspaceId)

      setSetAsDefault(isDefault)
    }
  }, [selectedWorkspace, profile, isEditMode])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return

    setLoading(true)
    try {
      if (isEditMode && workflow) {
        // Update existing workflow
        await updateWorkflowById(workflow.id, {
          name: name.trim(),
          description: description.trim()
        })

        onOpenChange(false)
        setName("")
        setDescription("")

        if (onSuccess) {
          onSuccess()
        }
      } else {
        // Parse selected workspace (format: "type:id")
        const [workspaceType, workspaceId] = selectedWorkspace.split(':')

        // Set workspace context in store before creating
        setWorkspaceContext(
          workspaceType as 'personal' | 'team' | 'organization',
          workspaceId || null
        )

        // If user checked "set as default", save it
        if (setAsDefault) {
          try {
            await updateProfile({
              default_workspace_type: workspaceType as 'personal' | 'team' | 'organization',
              default_workspace_id: workspaceId || null,
            })
            logger.info("✅ [WorkflowDialog] Default workspace updated:", {
              workspaceType,
              workspaceId: workspaceId || null
            })
          } catch (error) {
            logger.error("Failed to update default workspace:", error)
            // Don't block workflow creation if this fails
            toast.error("Failed to save default workspace preference")
          }
        }

        logger.info("🌐 [WorkflowDialog] Creating workflow with workspace context:", {
          workspaceType,
          workspaceId: workspaceId || null
        })

        // Create new workflow (will use workspace context from store)
        const newWorkflow = await createNewWorkflow(name.trim(), description.trim())

        if (!newWorkflow || !newWorkflow.id) {
          throw new Error("Workflow created but no ID returned")
        }

        logger.info("✅ [WorkflowDialog] New workflow created:", {
          id: newWorkflow.id,
          name: newWorkflow.name,
          user_id: newWorkflow.user_id,
          workspace_type: newWorkflow.workspace_type,
          workspace_id: newWorkflow.workspace_id
        })

        onOpenChange(false)
        setName("")
        setDescription("")

        // Add a small delay to ensure the database has propagated the new workflow
        setTimeout(() => {
          logger.info("🚀 [WorkflowDialog] Navigating to workflow builder:", newWorkflow.id)
          // Navigate to the workflow builder for new workflows
          router.push(`/workflows/builder/${newWorkflow.id}`)
        }, 100)
      }
    } catch (error: any) {
      logger.error(`Failed to ${isEditMode ? 'update' : 'create'} workflow:`, error)
      // Show user-friendly error message
      const errorMessage = error?.message || `Failed to ${isEditMode ? 'update' : 'create'} workflow. Please try again.`
      alert(errorMessage) // You might want to replace this with a toast notification
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{isEditMode ? 'Edit Workflow' : 'Create New Workflow'}</DialogTitle>
            <DialogDescription>
              {isEditMode 
                ? 'Update your workflow name and description.'
                : 'Give your workflow a name and description to get started.'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter workflow name"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description (max 150 characters)</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => {
                  const value = e.target.value
                  if (value.length <= 150) {
                    setDescription(value)
                  }
                }}
                placeholder="Describe what this workflow does"
                rows={3}
                maxLength={150}
              />
              <div className="text-xs text-slate-500 text-right">
                {description.length}/150 characters
              </div>
            </div>

            {/* Workspace Selector - only show when creating */}
            {!isEditMode && (
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="workspace">Workspace</Label>
                  <Select
                    value={selectedWorkspace}
                    onValueChange={setSelectedWorkspace}
                    disabled={workspacesLoading}
                  >
                    <SelectTrigger id="workspace">
                      <SelectValue placeholder="Select workspace" />
                    </SelectTrigger>
                    <SelectContent>
                      {workspaces.map((workspace) => {
                        const value = `${workspace.type}:${workspace.id || ''}`
                        const icon = workspace.type === 'personal'
                          ? <User className="w-4 h-4" />
                          : workspace.type === 'team'
                          ? <Users className="w-4 h-4" />
                          : <Building2 className="w-4 h-4" />

                        return (
                          <SelectItem key={value} value={value}>
                            <div className="flex items-center gap-2">
                              {icon}
                              <div className="flex flex-col">
                                <span className="font-medium">{workspace.name}</span>
                                {workspace.description && (
                                  <span className="text-xs text-slate-500">
                                    {workspace.description}
                                  </span>
                                )}
                              </div>
                            </div>
                          </SelectItem>
                        )
                      })}
                    </SelectContent>
                  </Select>
                  <div className="text-xs text-slate-500">
                    Choose where this workflow will be created
                  </div>
                </div>

                {/* Set as Default Checkbox */}
                <div className="flex items-start space-x-2 pt-2">
                  <Checkbox
                    id="set-default-workspace"
                    checked={setAsDefault}
                    onCheckedChange={(checked) => setSetAsDefault(checked as boolean)}
                  />
                  <div className="grid gap-1.5 leading-none">
                    <Label
                      htmlFor="set-default-workspace"
                      className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                    >
                      Set as my default workspace
                    </Label>
                    <p className="text-xs text-slate-500">
                      Future workflows will be created here automatically
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading || !name.trim()}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {isEditMode ? 'Updating...' : 'Creating...'}
                </>
              ) : (
                isEditMode ? 'Update' : 'Create'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
