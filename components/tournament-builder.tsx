"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState
} from "react";
import { ROSTER_SIZE, SEED_VERSION, STORAGE_KEY } from "@/lib/constants";
import { parseRosterCsv } from "@/lib/csv";
import {
  assignPlayerToSlot,
  clearSlot,
  createInitialState,
  createEmptyAssignments,
  createEmptyPlayerAttributes,
  getEligiblePlayers,
  pruneAssignments,
  sanitizePlayers
} from "@/lib/state";
import type {
  AppState,
  Assignments,
  Player,
  PlayerAttributeKey,
  PlayerAttributeRating,
  Position,
  SlotDescriptor
} from "@/lib/types";
import type { ReactNode } from "react";

type BuilderContextValue = {
  loading: boolean;
  players: Player[];
  assignments: Assignments;
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

export function TournamentBuilderProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState<AppState | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadState() {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as AppState;
        if (!cancelled) {
          setState({
            ...parsed,
            players: sanitizePlayers(parsed.players),
            assignments: parsed.assignments,
            seedVersion: parsed.seedVersion ?? SEED_VERSION
          });
          setLoading(false);
        }
        return;
      }

      const response = await fetch("/api/seed-roster", { cache: "no-store" });
      const csv = await response.text();
      const seeded = createInitialState(parseRosterCsv(csv));

      if (!cancelled) {
        setState(seeded);
        setLoading(false);
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

  const updatePlayerName = useCallback((playerId: number, name: string) => {
    setState((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        players: current.players.map((player) =>
          player.id === playerId ? { ...player, name } : player
        ),
        assignments: pruneAssignments(
          current.players.map((player) =>
            player.id === playerId ? { ...player, name } : player
          ),
          current.assignments
        )
      };
    });
  }, []);

  const togglePlayerPosition = useCallback((playerId: number, position: Position) => {
    setState((current) => {
      if (!current) {
        return current;
      }

      const nextPlayers = current.players.map((player) => {
        if (player.id !== playerId) {
          return player;
        }

        const hasPosition = player.positions.includes(position);
        const nextPositions = hasPosition
          ? player.positions.filter((value) => value !== position)
          : [...player.positions, position];

        return {
          ...player,
          positions: [...nextPositions].sort((a, b) => a - b) as Position[]
        };
      });

      return {
        ...current,
        players: nextPlayers,
        assignments: pruneAssignments(nextPlayers, current.assignments)
      };
    });
  }, []);

  const updatePlayerAttribute = useCallback(
    (playerId: number, attribute: PlayerAttributeKey, rating: PlayerAttributeRating | null) => {
      setState((current) => {
        if (!current) {
          return current;
        }

        return {
          ...current,
          players: current.players.map((player) =>
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
        };
      });
    },
    []
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

  const value = useMemo<BuilderContextValue>(
    () => ({
      loading,
      players: state?.players ?? makeBlankPlayers(),
      assignments: state?.assignments ?? createEmptyAssignments(),
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
      state,
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
