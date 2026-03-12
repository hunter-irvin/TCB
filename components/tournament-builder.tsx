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
import { ROSTER_SIZE, SEED_VERSION, STORAGE_KEY } from "@/lib/constants";
import { parseRosterCsv } from "@/lib/csv";
import {
  assignPlayerToSlot,
  clearSlot,
  createEmptyAssignments,
  createEmptyPlayerAttributes,
  createInitialState,
  getEligiblePlayers,
  pruneAssignments,
  sanitizePlayers
} from "@/lib/state";
import { getSupabaseBrowserClient, hasSupabaseBrowserConfig } from "@/lib/supabase/browser";
import { arePlayersEqual, playerToRow, playersFromRows } from "@/lib/supabase/tcb";
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

function makeBlankPlayers(): Player[] {
  return Array.from({ length: ROSTER_SIZE }, (_, index) => ({
    id: index + 1,
    rowNumber: index + 1,
    name: "",
    positions: [],
    attributes: createEmptyPlayerAttributes()
  }));
}

function canAssignPlayerToSlot(players: Player[], playerId: number, slot: SlotDescriptor): boolean {
  const player = players.find((candidate) => candidate.id === playerId);
  return Boolean(player && player.positions.includes(slot.position) && player.name.trim());
}

async function loadSeedPlayers() {
  const response = await fetch("/api/seed-roster", { cache: "no-store" });
  const csv = await response.text();
  return parseRosterCsv(csv);
}

async function fetchSupabasePlayers() {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("players")
    .select(
      "id,row_number,name,eligible_positions,shooting,driving,assisting,man_defense,help_defense,shot_blocking,playmaking,rebounding,transition"
    )
    .order("row_number", { ascending: true });

  if (error) {
    throw error;
  }

  return playersFromRows(data ?? []);
}

async function pushPlayersSnapshot(players: Player[]) {
  const supabase = getSupabaseBrowserClient();
  const { error } = await supabase.from("players").upsert(players.map(playerToRow), {
    onConflict: "id"
  });

  if (error) {
    throw error;
  }
}

export function TournamentBuilderProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState<AppState | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const latestStateRef = useRef<AppState | null>(null);
  const pendingPlayerSyncRef = useRef<Player[] | null>(null);
  const syncInFlightRef = useRef(false);
  const suppressRealtimeRef = useRef(false);

  useEffect(() => {
    latestStateRef.current = state;
  }, [state]);

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
        await pushPlayersSnapshot(nextSnapshot);
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
  }, []);

  const queuePlayerSync = useCallback(
    (playersSnapshot: Player[]) => {
      if (!hasSupabaseBrowserConfig()) {
        return;
      }

      pendingPlayerSyncRef.current = playersSnapshot;
      void flushPlayerSync();
    },
    [flushPlayerSync]
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
        const seeded = createInitialState(await loadSeedPlayers());
        if (!cancelled) {
          setState(seeded);
          setLoading(false);
        }
      }

      if (!hasSupabaseBrowserConfig()) {
        return;
      }

      try {
        const seedPlayers = await loadSeedPlayers();
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
  }, []);

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

    window.addEventListener("focus", handleRetry);
    window.addEventListener("online", handleRetry);

    return () => {
      window.removeEventListener("focus", handleRetry);
      window.removeEventListener("online", handleRetry);
    };
  }, [flushPlayerSync]);

  useEffect(() => {
    if (pendingPlayerSyncRef.current) {
      void flushPlayerSync();
    }
  }, [flushPlayerSync]);

  useEffect(() => {
    if (!hasSupabaseBrowserConfig()) {
      return undefined;
    }

    const supabase = getSupabaseBrowserClient();
    let active = true;
    let channel: RealtimeChannel | null = null;

    async function refreshPlayersFromRealtime() {
      if (suppressRealtimeRef.current) {
        return;
      }

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
        setSyncError((current) =>
          current === "Unable to load roster from Supabase. Using local data." ? null : current
        );
      } catch {
        if (active) {
          setSyncError("Unable to refresh roster from Supabase. Using local data.");
        }
      }
    }

    channel = supabase
      .channel("tcb-players")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "players" },
        () => {
          void refreshPlayersFromRealtime();
        }
      )
      .subscribe();

    return () => {
      active = false;
      if (channel) {
        void supabase.removeChannel(channel);
      }
    };
  }, []);

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

        queuePlayerSync(nextPlayers);
        return nextState;
      });
    },
    [queuePlayerSync]
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
      players: state?.players ?? makeBlankPlayers(),
      assignments: state?.assignments ?? createEmptyAssignments(),
      syncError,
      retrySync,
      updatePlayerName,
      togglePlayerPosition,
      updatePlayerAttribute,
      assignPlayer,
      clearAssignment,
      getEligibleForSlot
    }),
    [
      assignPlayer,
      clearAssignment,
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
