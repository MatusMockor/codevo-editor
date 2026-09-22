import { useCallback, useEffect, useRef, useState } from "react";
import type { RepositoryLookupGateway } from "./repositoryLookupPorts";
import {
  parseRepositoryPath,
  parseRepositorySearchQuery,
  REPOSITORY_LOOKUP_LIMITS,
  type RepositoryHostsSnapshot,
  type RepositoryInfo,
  type RepositoryProvider,
} from "../domain/repositoryLookup";

export const REPOSITORY_SEARCH_DEBOUNCE_MS = 300;

type SearchState = Readonly<{
  status: "idle" | "pending" | "ready" | "failed";
  repositories: readonly RepositoryInfo[];
  nextPage: number | null;
  message: string | null;
}>;
const emptySearch: SearchState = {
  status: "idle",
  repositories: [],
  nextPage: null,
  message: null,
};

export function useProjectRepositorySearch(
  gateway: RepositoryLookupGateway | null,
  environmentLabel: string,
  initialProvider: RepositoryProvider | null = null,
) {
  const generation = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelTimer = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const [hosts, setHosts] = useState<RepositoryHostsSnapshot | null>(null);
  const [hostsError, setHostsError] = useState(false);
  const [provider, setProvider] = useState<RepositoryProvider | null>(null);
  const [host, setHost] = useState("");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<SearchState>(emptySearch);
  const activeRequest = useRef(false);
  const alive = useRef(false);
  const owner = useRef({ gateway, environmentLabel, initialProvider });
  if (
    owner.current.gateway !== gateway ||
    owner.current.environmentLabel !== environmentLabel ||
    owner.current.initialProvider !== initialProvider
  ) {
    owner.current = { gateway, environmentLabel, initialProvider };
    generation.current += 1;
    activeRequest.current = false;
  }
  const currentOwner = owner.current;
  const reset = useCallback(() => {
    cancelTimer();
    generation.current += 1;
    activeRequest.current = false;
    setSearch(emptySearch);
  }, [cancelTimer]);
  const loadHosts = useCallback(async () => {
    reset();
    const ticket = generation.current;
    setHosts(null);
    setHostsError(false);
    setProvider(null);
    setHost("");
    setQuery("");
    if (!gateway) return;
    try {
      const result = await gateway.listHosts();
      if (alive.current && owner.current === currentOwner && ticket === generation.current) {
        setHosts(result);
        setProvider(initialProvider);
        const entry = initialProvider ? result[initialProvider] : null;
        setHost(
          entry?.status === "ready"
            ? (entry.hosts.find((item) => item.auth === "authenticated")?.host ?? "")
            : "",
        );
      }
    } catch {
      if (alive.current && owner.current === currentOwner && ticket === generation.current)
        setHostsError(true);
    }
  }, [currentOwner, gateway, initialProvider, reset]);
  useEffect(() => {
    alive.current = true;
    void loadHosts();
    return () => {
      alive.current = false;
      generation.current += 1;
    };
  }, [loadHosts]);
  const selectProvider = (value: RepositoryProvider | null) => {
    reset();
    setProvider(value);
    setQuery("");
    const state = value ? hosts?.[value] : null;
    setHost(
      state?.status === "ready"
        ? (state.hosts.find((entry) => entry.auth === "authenticated")?.host ?? "")
        : "",
    );
  };
  const selectHost = (value: string) => {
    reset();
    setHost(value);
    setQuery("");
  };
  const editQuery = (value: string) => {
    reset();
    setQuery(value);
  };
  const submit = async (page = 1) => {
    if (!alive.current || owner.current !== currentOwner) return;
    cancelTimer();
    if (!gateway || !provider || !host || query.trim().length < 2 || activeRequest.current) return;
    const exactPath = parseRepositoryPath(provider, query);
    if (
      !exactPath &&
      (gateway.search
        ? parseRepositorySearchQuery(query) === null
        : query.length > REPOSITORY_LOOKUP_LIMITS.pathChars)
    ) {
      setSearch({
        ...emptySearch,
        status: "failed",
        message:
          "Enter a repository name using letters, numbers, spaces, dots, hyphens or slashes.",
      });
      return;
    }
    const state = hosts?.[provider];
    if (
      state?.status !== "ready" ||
      !state.hosts.some((entry) => entry.host === host && entry.auth === "authenticated")
    )
      return;
    const ticket = ++generation.current;
    activeRequest.current = true;
    const previous = page === 1 ? [] : search.repositories;
    setSearch({ ...emptySearch, repositories: previous, status: "pending" });
    try {
      if (!gateway.search && !exactPath) {
        setSearch({
          ...emptySearch,
          status: "failed",
          message: "Enter the full owner/repository path. Search is unavailable on this version.",
        });
        activeRequest.current = false;
        return;
      }
      const result =
        gateway.search && !exactPath
          ? await gateway.search({ provider, host, query: query.trim(), page })
          : await gateway.lookup({ provider, host, path: exactPath! });
      if (!alive.current || owner.current !== currentOwner || ticket !== generation.current) return;
      activeRequest.current = false;
      if (result.status !== "ok") {
        const message =
          result.status === "notAuthenticated"
            ? "Sign in on the selected machine, then retry the account check."
            : result.status === "rateLimited"
              ? "The provider's request limit was reached. Try again later."
              : result.status === "notFound"
                ? "No repository found."
                : "Could not search repositories. Check the connection and try again.";
        setSearch({ ...emptySearch, status: "failed", message });
        return;
      }
      const incoming = "repositories" in result ? result.repositories : [result.repository];
      const merged = [...previous];
      for (const repository of incoming.slice(0, REPOSITORY_LOOKUP_LIMITS.searchPageSize)) {
        if (
          repository.provider === provider &&
          repository.host === host &&
          !merged.some((item) => item.fullPath === repository.fullPath)
        )
          merged.push(repository);
      }
      const bounded = merged.slice(0, 200);
      const nextPage =
        "nextPage" in result &&
        result.nextPage !== null &&
        result.nextPage > page &&
        result.nextPage <= REPOSITORY_LOOKUP_LIMITS.searchMaxPages &&
        bounded.length < 200
          ? result.nextPage
          : null;
      const truncated =
        incoming.length > REPOSITORY_LOOKUP_LIMITS.searchPageSize ||
        merged.length > 200 ||
        ("truncated" in result && result.truncated) ||
        ("nextPage" in result && result.nextPage !== null && nextPage === null);
      setSearch({
        status: "ready",
        repositories: bounded,
        nextPage,
        message: truncated
          ? "Some results are not shown. Narrow your search to find more."
          : bounded.length === 0
            ? "No repositories found."
            : null,
      });
    } catch {
      if (!alive.current || owner.current !== currentOwner || ticket !== generation.current) return;
      activeRequest.current = false;
      setSearch({
        ...emptySearch,
        status: "failed",
        message: "Could not search repositories. Try again.",
      });
    }
  };
  const submitCurrent = useRef(submit);
  submitCurrent.current = submit;
  useEffect(() => {
    cancelTimer();
    if (!provider || !host || query.trim().length < 2) return;
    const ticket = generation.current;
    timer.current = setTimeout(() => {
      timer.current = null;
      if (!alive.current || owner.current !== currentOwner || generation.current !== ticket) return;
      void submitCurrent.current();
    }, REPOSITORY_SEARCH_DEBOUNCE_MS);
    return cancelTimer;
  }, [query, provider, host, currentOwner, cancelTimer]);
  return {
    hosts,
    hostsError,
    provider,
    host,
    query,
    search,
    loadHosts,
    selectProvider,
    selectHost,
    editQuery,
    submit,
  };
}
