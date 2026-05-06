import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { displayStatus } from "@/core/workflows/projections";
import * as workflowsRepo from "@/repositories/workflows";
import { WorkflowEditForm } from "@/features/workflows/WorkflowEditForm";

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

  return (
    <main className="flex min-h-screen flex-col items-center p-8">
      <div className="flex w-full max-w-2xl flex-col gap-6">
        <Link
          href="/workflows"
          className="text-sm text-muted-foreground hover:underline"
        >
          ← All workflows
        </Link>
        <header className="flex items-start justify-between gap-4">
          <h1 className="text-3xl font-bold">{workflow.name}</h1>
          {status && (
            <span
              data-status-kind={status.kind}
              className="shrink-0 rounded bg-muted px-2 py-1 text-xs font-medium"
            >
              {status.label}
            </span>
          )}
        </header>
        <WorkflowEditForm workflow={workflow} />
        <p className="text-xs text-muted-foreground">
          The visual builder ships next (Slice 1I). For now you can rename the
          workflow; lifecycle actions live on the workflows list.
        </p>
      </div>
    </main>
  );
}
