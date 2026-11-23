import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "../../../shared/api/queryKeys";
import { fetchNetwork, fetchServerStatus } from "../api/network";

const STATUS_POLL_MS = 10_000;

export function useNetworkQuery() {
  return useQuery({ queryKey: queryKeys.network, queryFn: fetchNetwork });
}

export function useServerStatus() {
  return useQuery({ queryKey: queryKeys.status, queryFn: fetchServerStatus, refetchInterval: STATUS_POLL_MS });
}
