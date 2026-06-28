import { useQuery } from "@tanstack/react-query";
import {
  getActiveOrganization,
  getProviderCapabilities,
  type Organization,
  type ProviderCapabilities,
} from "@/lib/azdoCommands";

/// The connection the app is currently pointed at (chosen in Settings). The UI
/// has a single active connection at a time, so screens read this instead of
/// offering a per-screen organization picker.
export function useActiveOrganization() {
  return useQuery<Organization | null>({
    queryKey: ["activeOrganization"],
    queryFn: getActiveOrganization,
    staleTime: 5 * 60_000,
  });
}

/// The id of the active connection, or "" while loading / when none configured.
export function useActiveOrganizationId(): string {
  const query = useActiveOrganization();
  return query.data?.id ?? "";
}

/// Capabilities of the active connection's provider, so screens can hide
/// features the active platform does not support without branching on provider.
export function useProviderCapabilities() {
  return useQuery<ProviderCapabilities | null>({
    queryKey: ["providerCapabilities"],
    queryFn: async () => (await getProviderCapabilities()).capabilities,
    staleTime: 5 * 60_000,
  });
}
