import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { listProviders } from "@/integrations/_registry";
import { listActiveByUser } from "@/repositories/integrations";
import { IntegrationsList } from "@/features/integrations/IntegrationsList";
import { ConnectionStatusBanner } from "@/features/integrations/ConnectionStatusBanner";

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function IntegrationsPage({ searchParams }: Props) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/sign-in");

  const params = await searchParams;
  const providers = listProviders();
  const connections = await listActiveByUser(user.id);

  return (
    <main className="flex min-h-screen flex-col items-center p-8">
      <div className="flex w-full max-w-2xl flex-col gap-6">
        <h1 className="text-3xl font-bold">Integrations</h1>
        <ConnectionStatusBanner searchParams={params} />
        <IntegrationsList providers={providers} connections={connections} />
      </div>
    </main>
  );
}
