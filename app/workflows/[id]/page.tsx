import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { displayStatus } from "@/core/workflows/projections";
import { listProviders } from "@/integrations/_registry";
import * as workflowsRepo from "@/repositories/workflows";
import { WorkflowEditForm } from "@/features/workflows/WorkflowEditForm";
import { WorkflowBuilder } from "@/features/workflow-builder/WorkflowBuilder";
import { LifecycleActions } from "@/features/workflow-builder/panels/LifecycleActions";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function WorkflowDetailPage({ params }: Props) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/sign-in");

  const { id } = await params;
  const record = await workflowsRepo.getById(id);
  // Soft-deleted workflows are 404 — same contract as GET /api/workflows/[id].
  if (!record || record.state === "deleted") notFound();

  const workflow = {
    id: record.id,
    name: record.name,
    state: record.state,
    disabledReason: record.disabledReason,
    disabledContext: record.disabledContext,
    activeRevisionId: record.activeRevisionId,
    draftDefinition: record.draftDefinition,
    deletedAt: record.deletedAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
  const status = displayStatus(workflow);

  const providers = listProviders();
  const triggerProviders = providers
    .filter((p) => p.isEnabled && p.capabilities.webhookTrigger)
    .map((p) => ({ id: p.id, displayName: p.displayName }));
  const actionProviders = providers
    .filter((p) => p.isEnabled && p.capabilities.actions)
    .map((p) => ({ id: p.id, displayName: p.displayName }));

  return (
    <main className="flex min-h-screen flex-col items-center p-8">
      <div className="flex w-full max-w-3xl flex-col gap-6">
        <Link
          href="/workflows"
          className="text-sm text-muted-foreground hover:underline"
        >
          ← All workflows
        </Link>
        <header className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-3xl font-bold">{workflow.name}</h1>
            {status && (
              <span
                data-status-kind={status.kind}
                className="self-start rounded bg-muted px-2 py-1 text-xs font-medium"
              >
                {status.label}
              </span>
            )}
          </div>
          <LifecycleActions workflowId={workflow.id} state={workflow.state} />
        </header>
        <WorkflowEditForm workflow={workflow} />
        <WorkflowBuilder
          workflow={workflow}
          triggerProviders={triggerProviders}
          actionProviders={actionProviders}
        />
      </div>
    </main>
  );
}
