import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../../../shared/api/queryKeys";
import { useLibraryQuery } from "../../library/hooks/useLibrary";
import type { LibraryResponse, MediaItem } from "../../library/schemas/media";
import { fetchSession, updateSession, uploadSubtitle, type SubtitleUpload } from "../api/session";
import type { Session } from "../schemas/session";

export function useSessionQuery() {
  return useQuery({ queryKey: queryKeys.session, queryFn: fetchSession, select: (data) => data.session });
}

export function useUpdateSession() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: updateSession,
    onSuccess: (data) => {
      client.setQueryData(queryKeys.session, data);
    }
  });
}

export interface ActiveMedia {
  readonly session: Session | undefined;
  readonly media: MediaItem | null;
  readonly isLoading: boolean;
}

/** Joins the server session with the catalog entry it points to. */
export function useActiveMedia(): ActiveMedia {
  const session = useSessionQuery();
  const library = useLibraryQuery();
  const mediaId = session.data?.mediaId ?? null;
  const media = library.data?.items.find((item) => item.id === mediaId) ?? null;
  return { session: session.data, media, isLoading: session.isPending || library.isPending };
}

export function useUploadSubtitle(mediaId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (upload: SubtitleUpload) => uploadSubtitle(mediaId, upload),
    onSuccess: async ({ item }) => {
      client.setQueryData<LibraryResponse>(queryKeys.library, (previous) =>
        previous ? { ...previous, items: previous.items.map((m) => (m.id === item.id ? item : m)) } : previous
      );
      await client.invalidateQueries({ queryKey: queryKeys.session });
    }
  });
}

