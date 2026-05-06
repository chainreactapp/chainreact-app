import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { connect } from "@/services/oauth/dispatcher";

/**
 * Initiates an OAuth connection for the authenticated user.
 *
 * Thin route per project-structure-and-module-boundaries.md §5: parses input,
 * verifies the session, dispatches to the service, formats the response.
 * No business logic in this file.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  try {
    const { redirectUrl } = await connect({ userId: user.id, provider });
    return NextResponse.json({ redirectUrl });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "OAuth start failed" },
      { status: 400 },
    );
  }
}
