import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import * as workflowsRepo from "@/repositories/workflows";
import { CreateWorkflowButton } from "@/features/workflows/CreateWorkflowButton";
import { WorkflowsList } from "@/features/workflows/WorkflowsList";

export default async function WorkflowsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/sign-in");

  const records = await workflowsRepo.listByUser(user.id);
  const workflows = records.map((r) => ({
    id: r.id,
    name: r.name,
    state: r.state,
    disabledReason: r.disabledReason,
    disabledContext: r.disabledContext,
    deletedAt: r.deletedAt,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));

  return (
    <main className="flex min-h-screen flex-col items-center p-8">
      <div className="flex w-full max-w-2xl flex-col gap-6">
        <h1 className="text-3xl font-bold">Workflows</h1>
        <CreateWorkflowButton />
        <WorkflowsList workflows={workflows} />
      </div>
    </main>
  );
}
