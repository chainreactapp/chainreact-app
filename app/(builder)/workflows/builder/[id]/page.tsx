import { notFound } from "next/navigation"
import { ReactFlowProvider } from "@xyflow/react"

import { WorkflowBuilderV2 } from "@/components/workflows/builder/WorkflowBuilderV2"
import { TooltipProvider } from "@/components/ui/tooltip"
import { getFlowRepository } from "@/src/lib/workflows/builder/api/helpers"
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/utils/supabase/server"
import { ensureWorkspaceRole } from "@/src/lib/workflows/builder/workspace"

export const dynamic = "force-dynamic"

interface BuilderPageProps {
  params: Promise<{ id: string }>
}

export default async function FlowBuilderV2Page({ params }: BuilderPageProps) {
  const { id: flowId } = await params
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    notFound()
  }

  const serviceClient = await createSupabaseServiceClient()

  // Check workflows table for access
  const { data: flowRow } = await serviceClient
    .from("workflows")
    .select("id, user_id, workspace_id, status")
    .eq("id", flowId)
    .maybeSingle()

  if (!flowRow) {
    notFound()
  }

  let hasAccess = flowRow.user_id === user.id

  if (!hasAccess && flowRow.workspace_id) {
    try {
      await ensureWorkspaceRole(serviceClient, flowRow.workspace_id, user.id, "viewer")
      hasAccess = true
    } catch {
      // User doesn't have workspace access
    }
  }

  if (!hasAccess) {
    const { data: sharedAccess } = await serviceClient
      .from("workflow_permissions")
      .select("permission")
      .eq("workflow_id", flowId)
      .eq("user_id", user.id)
      .maybeSingle()
    hasAccess = Boolean(sharedAccess)
  }

  if (!hasAccess) {
    notFound()
  }

  // Use service client directly for loading revisions to bypass RLS
  const repository = await getFlowRepository(serviceClient)

  let revision
  try {
    revision = await repository.loadRevision({ flowId })
  } catch {
    // Error loading revision
  }

  if (!revision) {
    notFound()
  }

  return (
    <TooltipProvider>
      <ReactFlowProvider>
        <WorkflowBuilderV2 flowId={flowId} initialRevision={revision} initialStatus={flowRow.status as 'draft' | 'active' | 'inactive' | undefined} />
      </ReactFlowProvider>
    </TooltipProvider>
  )
}
