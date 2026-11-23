import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../../../shared/api/queryKeys";
import { fetchTvs, scanTvs } from "../api/tvs";
import type { CommandResult } from "../schemas/tv";

export function useTvsQuery() {
  return useQuery({ queryKey: queryKeys.tvs, queryFn: fetchTvs, select: (data) => data.tvs });
}

export function useScanTvs() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: scanTvs,
    onSuccess: async (data) => {
      client.setQueryData(queryKeys.tvs, data);
      await client.invalidateQueries({ queryKey: queryKeys.session });
    }
  });
}

/** One mutation slot for every TV command, so the page shows a single result line. */
export function useTvCommand() {
  return useMutation<CommandResult, Error, () => Promise<CommandResult>>({
    mutationFn: (run) => run()
  });
}
