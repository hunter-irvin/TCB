"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { SEED_VERSION, STORAGE_KEY } from "@/lib/constants";
import {
  assignPlayerToSlot,
  clearSlot,
  createPlayerDraft,
  createDefaultPlayers,
  createEmptyAssignments,
  createInitialState,
  getEligiblePlayers,
  pruneAssignments,
  remapAssignmentsByPlayerId,
  remapPlayersById,
  sanitizePlayers
} from "@/lib/state";
import { getSupabaseBrowserClient, hasSupabaseBrowserConfig } from "@/lib/supabase/browser";
import {
  PLAYER_SELECT_COLUMNS,
  arePlayersEqual,
  playerToInsertRow,
  playerToRow,
  playersFromRows
} from "@/lib/supabase/tcb";
import type {
  AppState,
  Assignments,
  Player,
  PlayerAttributeKey,
  PlayerAttributeRating,
  Position,
  SlotDescriptor
} from "@/lib/types";
import type { RealtimeChannel } from "@supabase/supabase-js";
import type { ReactNode } from "react";

type BuilderContextValue = {
  loading: boolean;
  players: Player[];
  assignments: Assignments;
  syncError: string | null;
  retrySync: () => void;
  addPlayer: () => number | null;
  deletePlayer: (playerId: number) => void;
  updatePlayerName: (playerId: number, name: string) => void;
  togglePlayerPosition: (playerId: number, position: Position) => void;
  updatePlayerAttribute: (
    playerId: number,
    attribute: PlayerAttributeKey,
    rating: PlayerAttributeRating | null
  ) => void;
  assignPlayer: (playerId: number, slot: SlotDescriptor) => void;
  clearAssignment: (slot: SlotDescriptor) => void;
  getEligibleForSlot: (slot: SlotDescriptor, currentPlayerId: number | null) => Player[];
};

const BuilderContext = createContext<BuilderContextValue | null>(null);
const PLAYER_SYNC_DEBOUNCE_MS = 2000;

function canAssignPlayerToSlot(players: Player[], playerId: number, slot: SlotDescriptor): boolean {
  const player = players.find((candidate) => candidate.id === playerId);
  return Boolean(player && player.positions.includes(slot.position) && player.name.trim());
}

async function fetchSupabasePlayers() {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("players")
    .select(PLAYER_SELECT_COLUMNS)
    .order("row_number", { ascending: true });

  if (error) {
    throw error;
  }

  return playersFromRows(data ?? []);
}

type PushPlayersSnapshotResult = {
  players: Player[];
  tempIdMap: Map<number, number>;
};

async function pushPlayersSnapshot(
  players: Player[],
  previousPlayers: Player[]
): Promise<PushPlayersSnapshotResult> {
  const supabase = getSupabaseBrowserClient();
  const existingPlayers = players.filter((player) => player.id > 0);
  const draftPlayers = players.filter((player) => player.id <= 0);
  const deletedPlayerIds = previousPlayers
    .filter(
      (player) =>
        player.id > 0 && !players.some((candidate) => candidate.id === player.id)
    )
    .map((player) => player.id);

  if (existingPlayers.length > 0) {
    const { error } = await supabase.from("players").upsert(existingPlayers.map(playerToRow), {
      onConflict: "id"
    });

    if (error) {
      throw error;
    }
  }

  const tempIdMap = new Map<number, number>();

  if (draftPlayers.length > 0) {
    const { data, error } = await supabase
      .from("players")
      .insert(draftPlayers.map(playerToInsertRow))
      .select(PLAYER_SELECT_COLUMNS);

    if (error) {
      throw error;
    }

    const insertedPlayers = playersFromRows(data ?? []);
    const insertedPlayersByRowNumber = new Map(
      insertedPlayers.map((player) => [player.rowNumber, player] as const)
    );

    for (const draftPlayer of draftPlayers) {
      const insertedPlayer = insertedPlayersByRowNumber.get(draftPlayer.rowNumber);
      if (insertedPlayer) {
        tempIdMap.set(draftPlayer.id, insertedPlayer.id);
      }
    }
  }

  if (deletedPlayerIds.length > 0) {
    const { error } = await supabase.from("players").delete().in("id", deletedPlayerIds);

    if (error) {
      throw error;
    }
  }

  return {
    players: sanitizePlayers(remapPlayersById(players, tempIdMap)),
    tempIdMap
  };
}

export function TournamentBuilderProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState<AppState | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const latestStateRef = useRef<AppState | null>(null);
  const lastSyncedPlayersRef = useRef<Player[]>([]);
  const pendingPlayerSyncRef = useRef<Player[] | null>(null);
  const syncInFlightRef = useRef(false);
  const suppressRealtimeRef = useRef(false);
  const syncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshInFlightRef = useRef(false);
  const refreshQueuedRef = useRef(false);

  useEffect(() => {
    latestStateRef.current = state;
  }, [state]);

  const syncPlayerRefFromSnapshot = useCallback((players: Player[]) => {
    lastSyncedPlayersRef.current = players;
  }, []);

  const applyPlayerIdRemap = useCallback((tempIdMap: Map<number, number>) => {
    if (tempIdMap.size === 0) {
      return;
    }

    pendingPlayerSyncRef.current = pendingPlayerSyncRef.current
      ? remapPlayersById(pendingPlayerSyncRef.current, tempIdMap)
      : null;

    setState((current) => {
      if (!current) {
        return current;
      }

      const nextState = {
        ...current,
        players: remapPlayersById(current.players, tempIdMap),
        assignments: remapAssignmentsByPlayerId(current.assignments, tempIdMap)
      };
      latestStateRef.current = nextState;
      return nextState;
    });
  }, []);

  const flushPlayerSync = useCallback(async () => {
    if (!hasSupabaseBrowserConfig() || syncInFlightRef.current) {
      return;
    }

    const snapshot = pendingPlayerSyncRef.current;
    if (!snapshot) {
      return;
    }

    syncInFlightRef.current = true;

    while (pendingPlayerSyncRef.current) {
      const nextSnapshot = pendingPlayerSyncRef.current;
      pendingPlayerSyncRef.current = null;

      try {
        const result = await pushPlayersSnapshot(nextSnapshot, lastSyncedPlayersRef.current);
        applyPlayerIdRemap(result.tempIdMap);
        lastSyncedPlayersRef.current = result.players;
        setSyncError(null);
        suppressRealtimeRef.current = false;
      } catch {
        pendingPlayerSyncRef.current = latestStateRef.current?.players ?? nextSnapshot;
        setSyncError("Changes saved locally. Backend sync failed.");
        suppressRealtimeRef.current = true;
        break;
      }
    }

    syncInFlightRef.current = false;
  }, [applyPlayerIdRemap]);

  const schedulePlayerSync = useCallback(
    (immediate = false) => {
      if (!hasSupabaseBrowserConfig()) {
        return;
      }

      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current);
        syncTimeoutRef.current = null;
      }

      if (immediate) {
        void flushPlayerSync();
        return;
      }

      syncTimeoutRef.current = setTimeout(() => {
        syncTimeoutRef.current = null;
        void flushPlayerSync();
      }, PLAYER_SYNC_DEBOUNCE_MS);
    },
    [flushPlayerSync]
  );

  const queuePlayerSync = useCallback(
    (playersSnapshot: Player[], options?: { immediate?: boolean }) => {
      if (!hasSupabaseBrowserConfig()) {
        return;
      }

      if (arePlayersEqual(playersSnapshot, lastSyncedPlayersRef.current)) {
        pendingPlayerSyncRef.current = null;
        return;
      }

      pendingPlayerSyncRef.current = playersSnapshot;
      schedulePlayerSync(options?.immediate ?? false);
    },
    [schedulePlayerSync]
  );

  useEffect(() => {
    let cancelled = false;

    async function loadState() {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      const localState = stored ? (JSON.parse(stored) as AppState) : null;
      const localPlayers = localState ? sanitizePlayers(localState.players) : null;

      if (localState && !cancelled) {
        setState({
          ...localState,
          players: localPlayers!,
          assignments: localState.assignments,
          seedVersion: localState.seedVersion ?? SEED_VERSION
        });
        setLoading(false);
      }

      if (!localState) {
        const seeded = createInitialState(createDefaultPlayers());
        if (!cancelled) {
          setState(seeded);
          setLoading(false);
        }
      }

      if (!hasSupabaseBrowserConfig()) {
        return;
      }

      try {
        const seedPlayers = createDefaultPlayers();
        const backendPlayers = await fetchSupabasePlayers();
        if (cancelled) {
          return;
        }

        if (
          localPlayers &&
          (backendPlayers.length === 0 ||
            (arePlayersEqual(backendPlayers, seedPlayers) && !arePlayersEqual(localPlayers, seedPlayers)))
        ) {
          pendingPlayerSyncRef.current = localPlayers;
          setSyncError("Migrating local roster to Supabase.");
          suppressRealtimeRef.current = true;
          return;
        }

        setState((current) => {
          const nextAssignments = pruneAssignments(
            backendPlayers,
            current?.assignments ?? createEmptyAssignments()
          );

          return {
            players: backendPlayers,
            assignments: nextAssignments,
            seedVersion: SEED_VERSION
          };
        });
        syncPlayerRefFromSnapshot(backendPlayers);
        setSyncError(null);
        suppressRealtimeRef.current = false;
      } catch {
        if (!cancelled) {
          setSyncError("Unable to load roster from Supabase. Using local data.");
        }
      }
    }

    void loadState();

    return () => {
      cancelled = true;
    };
  }, [syncPlayerRefFromSnapshot]);

  useEffect(() => {
    if (!state) {
      return;
    }

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  useEffect(() => {
    if (!hasSupabaseBrowserConfig()) {
      return undefined;
    }

    const handleRetry = () => {
      if (pendingPlayerSyncRef.current) {
        void flushPlayerSync();
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden" && pendingPlayerSyncRef.current) {
        void flushPlayerSync();
      }
    };

    window.addEventListener("focus", handleRetry);
    window.addEventListener("online", handleRetry);
    window.addEventListener("pagehide", handleRetry);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("focus", handleRetry);
      window.removeEventListener("online", handleRetry);
      window.removeEventListener("pagehide", handleRetry);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [flushPlayerSync]);

  useEffect(() => {
    if (pendingPlayerSyncRef.current) {
      schedulePlayerSync();
    }
  }, [schedulePlayerSync]);

  useEffect(
    () => () => {
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current);
      }
    },
    []
  );

  useEffect(() => {
    if (!hasSupabaseBrowserConfig()) {
      return undefined;
    }

    const supabase = getSupabaseBrowserClient();
    let active = true;
    let channel: RealtimeChannel | null = null;
    const runRefresh = async () => {
      if (suppressRealtimeRef.current) {
        return;
      }

      if (refreshInFlightRef.current) {
        refreshQueuedRef.current = true;
        return;
      }

      refreshInFlightRef.current = true;

      try {
        const backendPlayers = await fetchSupabasePlayers();
        if (!active) {
          return;
        }

        setState((current) => {
          const currentPlayers = current?.players ?? [];
          if (arePlayersEqual(currentPlayers, backendPlayers)) {
            return current;
          }

          const nextAssignments = pruneAssignments(
            backendPlayers,
            current?.assignments ?? createEmptyAssignments()
          );

          return {
            players: backendPlayers,
            assignments: nextAssignments,
            seedVersion: SEED_VERSION
          };
        });
        syncPlayerRefFromSnapshot(backendPlayers);
        setSyncError((current) =>
          current === "Unable to load roster from Supabase. Using local data." ? null : current
        );
      } catch {
        if (active) {
          setSyncError("Unable to refresh roster from Supabase. Using local data.");
        }
      } finally {
        refreshInFlightRef.current = false;

        if (refreshQueuedRef.current && active) {
          refreshQueuedRef.current = false;
          void runRefresh();
        }
      }
    };

    const scheduleRefresh = () => {
      if (suppressRealtimeRef.current) {
        return;
      }

      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
      }

      refreshTimeoutRef.current = setTimeout(() => {
        refreshTimeoutRef.current = null;
        void runRefresh();
      }, 150);
    };

    channel = supabase
      .channel("tcb-players")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "players" },
        () => {
          scheduleRefresh();
        }
      )
      .subscribe();

    return () => {
      active = false;
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
        refreshTimeoutRef.current = null;
      }
      if (channel) {
        void supabase.removeChannel(channel);
      }
    };
  }, [syncPlayerRefFromSnapshot]);

  const applyPlayerUpdate = useCallback(
    (updater: (players: Player[]) => Player[]) => {
      setState((current) => {
        if (!current) {
          return current;
        }

        const nextPlayers = updater(current.players);
        const nextState = {
          ...current,
          players: nextPlayers,
          assignments: pruneAssignments(nextPlayers, current.assignments)
        };

        latestStateRef.current = nextState;
        queuePlayerSync(nextPlayers);
        return nextState;
      });
    },
    [queuePlayerSync]
  );

  const addPlayer = useCallback(() => {
    const currentState = latestStateRef.current;
    if (!currentState) {
      return null;
    }

    const nextPlayer = createPlayerDraft(currentState.players);
    const nextState = {
      ...currentState,
      players: [...currentState.players, nextPlayer]
    };
    latestStateRef.current = nextState;

    setState((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        players: [...current.players, nextPlayer]
      };
    });

    queuePlayerSync(nextState.players);
    return nextPlayer.id;
  }, [queuePlayerSync]);

  const deletePlayer = useCallback(
    (playerId: number) => {
      applyPlayerUpdate((players) => players.filter((player) => player.id !== playerId));
    },
    [applyPlayerUpdate]
  );

  const updatePlayerName = useCallback(
    (playerId: number, name: string) => {
      applyPlayerUpdate((players) =>
        players.map((player) => (player.id === playerId ? { ...player, name } : player))
      );
    },
    [applyPlayerUpdate]
  );

  const togglePlayerPosition = useCallback(
    (playerId: number, position: Position) => {
      applyPlayerUpdate((players) =>
        players.map((player) => {
          if (player.id !== playerId) {
            return player;
          }

          const hasPosition = player.positions.includes(position);
          const nextPositions = hasPosition
            ? player.positions.filter((value) => value !== position)
            : [...player.positions, position];

          return {
            ...player,
            positions: [...nextPositions].sort((left, right) => left - right) as Position[]
          };
        })
      );
    },
    [applyPlayerUpdate]
  );

  const updatePlayerAttribute = useCallback(
    (playerId: number, attribute: PlayerAttributeKey, rating: PlayerAttributeRating | null) => {
      applyPlayerUpdate((players) =>
        players.map((player) =>
          player.id === playerId
            ? {
                ...player,
                attributes: {
                  ...player.attributes,
                  [attribute]: rating
                }
              }
            : player
        )
      );
    },
    [applyPlayerUpdate]
  );

  const assignPlayer = useCallback((playerId: number, slot: SlotDescriptor) => {
    setState((current) => {
      if (!current || !canAssignPlayerToSlot(current.players, playerId, slot)) {
        return current;
      }

      return {
        ...current,
        assignments: assignPlayerToSlot(current.assignments, playerId, slot)
      };
    });
  }, []);

  const clearAssignment = useCallback((slot: SlotDescriptor) => {
    setState((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        assignments: clearSlot(current.assignments, slot)
      };
    });
  }, []);

  const getEligibleForSlot = useCallback(
    (slot: SlotDescriptor, currentPlayerId: number | null) =>
      state ? getEligiblePlayers(state.players, state.assignments, slot.position, currentPlayerId) : [],
    [state]
  );

  const retrySync = useCallback(() => {
    if (latestStateRef.current?.players) {
      pendingPlayerSyncRef.current = latestStateRef.current.players;
      void flushPlayerSync();
    }
  }, [flushPlayerSync]);

  const value = useMemo<BuilderContextValue>(
    () => ({
      loading,
      players: state?.players ?? createDefaultPlayers(),
      assignments: state?.assignments ?? createEmptyAssignments(),
      syncError,
      retrySync,
      addPlayer,
      deletePlayer,
      updatePlayerName,
      togglePlayerPosition,
      updatePlayerAttribute,
      assignPlayer,
      clearAssignment,
      getEligibleForSlot
    }),
    [
      addPlayer,
      assignPlayer,
      clearAssignment,
      deletePlayer,
      getEligibleForSlot,
      loading,
      retrySync,
      state,
      syncError,
      togglePlayerPosition,
      updatePlayerAttribute,
      updatePlayerName
    ]
  );

  return <BuilderContext.Provider value={value}>{children}</BuilderContext.Provider>;
}

export function useTournamentBuilder() {
  const context = useContext(BuilderContext);

  if (!context) {
    throw new Error("useTournamentBuilder must be used within TournamentBuilderProvider");
  }

  return context;
}
