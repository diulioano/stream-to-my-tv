import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { queryKeys } from "../../../shared/api/queryKeys";
import { fetchLibrary, generateSample, refreshLibrary, scanLibrary } from "../api/library";
import { isDownloadPending, type LibraryResponse, type MediaItem } from "../schemas/media";

const DOWNLOAD_POLL_MS = 5000;

function storeLibrary(client: QueryClient, { items, session, lastScannedPaths }: LibraryResponse) {
  client.setQueryData<LibraryResponse>(queryKeys.library, { items, session, lastScannedPaths });
  client.setQueryData(queryKeys.session, { session });
  void client.invalidateQueries({ queryKey: queryKeys.network });
}

export function useLibraryQuery() {
  return useQuery({ queryKey: queryKeys.library, queryFn: fetchLibrary });
}

export function useScanLibrary() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: scanLibrary,
    onSuccess: (data) => {
      storeLibrary(client, data);
    }
  });
}

export function useRefreshLibrary() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: refreshLibrary,
    onSuccess: (data) => {
      storeLibrary(client, data);
    }
  });
}

export function useGenerateSample() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: generateSample,
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.library }),
        client.invalidateQueries({ queryKey: queryKeys.session })
      ]);
    }
  });
}

/** Re-probes the catalog while any file is still downloading, so readiness updates on its own. */
export function useDownloadPolling(items: readonly MediaItem[] | undefined, intervalMs = DOWNLOAD_POLL_MS) {
  const { mutate, isPending } = useRefreshLibrary();
  const hasPending = items?.some(isDownloadPending) ?? false;

  useEffect(() => {
    if (!hasPending || isPending) return;
    const timer = setTimeout(() => {
      mutate();
    }, intervalMs);
    return () => {
      clearTimeout(timer);
    };
  }, [hasPending, isPending, mutate, intervalMs]);

  return hasPending;
}
