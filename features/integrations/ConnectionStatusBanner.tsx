interface Props {
  searchParams: Record<string, string | string[] | undefined>;
}

function pickString(v: string | string[] | undefined): string | null {
  if (typeof v === "string" && v.length > 0) return v;
  return null;
}

/**
 * Server component. Reads the URL params set by the OAuth callback route
 * (`?integration=connected&provider=slack` on success;
 *  `?integration_error=<message>` on failure) and renders an inline banner.
 */
export function ConnectionStatusBanner({ searchParams }: Props) {
  const connected = pickString(searchParams.integration);
  const error = pickString(searchParams.integration_error);
  const provider = pickString(searchParams.provider) ?? "the provider";

  if (connected === "connected") {
    return (
      <div
        role="status"
        className="rounded bg-green-100 p-3 text-sm text-green-800 dark:bg-green-500/20 dark:text-green-300"
      >
        Connected to {provider}.
      </div>
    );
  }
  if (error) {
    return (
      <div
        role="alert"
        className="rounded bg-red-100 p-3 text-sm text-red-800 dark:bg-red-500/20 dark:text-red-300"
      >
        Connection failed: {error}
      </div>
    );
  }
  return null;
}
