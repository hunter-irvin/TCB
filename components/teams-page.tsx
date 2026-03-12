"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AppShell } from "@/components/app-shell";
import { TournamentBuilderProvider, useTournamentBuilder } from "@/components/tournament-builder";
import { POSITIONS, TEAMS } from "@/lib/constants";
import { getSupabaseBrowserClient, hasSupabaseBrowserConfig } from "@/lib/supabase/browser";
import {
  areScenariosEquivalent,
  buildScenarioState,
  getNextScenarioNumber,
  isScenarioPristine,
  parseStoredScenarioState,
  scenarioAssignmentsToRows,
  scenariosToRows,
  TEAM_SCENARIOS_STORAGE_KEY
} from "@/lib/supabase/tcb";
import {
  assignPlayerToSlot,
  clearSlot,
  createEmptyAssignments,
  findPlayerSlot,
  getEligiblePlayers,
  pruneAssignments
} from "@/lib/state";
import type { Assignments, PersistedScenarioState, Player, Position, Scenario, SlotDescriptor, Team } from "@/lib/types";
import type { RealtimeChannel } from "@supabase/supabase-js";
import type { MouseEvent as ReactMouseEvent } from "react";

type ScenarioSlot = {
  scenarioId: string;
  slot: SlotDescriptor;
};

type NearestSlot = {
  scenarioId: string;
  slot: SlotDescriptor;
  valid: boolean;
} | null;

type DragChipMetrics = {
  width: number;
  height: number;
};

type DragState = {
  scenarioId: string;
  playerId: number;
  sourceSlot: SlotDescriptor | null;
  chipSize: DragChipMetrics;
  point: { x: number; y: number };
  color: string;
};

type ScenarioReorderState = {
  scenarioId: string;
  point: { x: number; y: number };
  offset: { x: number; y: number };
  width: number;
  height: number;
  insertIndex: number;
};

type StartDragFn = (playerId: number, chipNode: HTMLDivElement) => void;

function createScenario(index: number): Scenario {
  return {
    id: `scenario-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
    title: `Team Scenario ${index}`,
    assignments: createEmptyAssignments(),
    collapsed: false
  };
}

function isSameSlot(left: SlotDescriptor | null, right: SlotDescriptor | null): boolean {
  return Boolean(
    left &&
      right &&
      left.teamId === right.teamId &&
      left.position === right.position
  );
}

function isSameScenarioSlot(left: ScenarioSlot | null, right: ScenarioSlot | null): boolean {
  return Boolean(
    left &&
      right &&
      left.scenarioId === right.scenarioId &&
      isSameSlot(left.slot, right.slot)
  );
}

function getScenarioSlotKey(scenarioId: string, slot: SlotDescriptor): string {
  return `${scenarioId}:${slot.teamId}:${slot.position}`;
}

function formatPlayerLabel(name: string): string {
  const compact = name.trim().replace(/\s+/g, " ");
  if (compact.length <= 18) {
    return compact;
  }

  const parts = compact.split(" ");
  if (parts.length < 2) {
    return compact;
  }

  const lastName = parts[parts.length - 1];
  const firstNames = parts.slice(0, -1).join(" ");
  const shortened = `${firstNames} ${lastName.charAt(0)}.`;

  return shortened.length <= compact.length ? shortened : compact;
}

function createDragPreview(node: HTMLDivElement): HTMLDivElement {
  const preview = node.cloneNode(true) as HTMLDivElement;
  preview.classList.add("drag-preview");
  preview.style.width = `${node.offsetWidth}px`;
  preview.style.height = `${node.offsetHeight}px`;
  preview.style.background = getComputedStyle(node).backgroundColor;
  preview.style.borderRadius = getComputedStyle(node).borderRadius;
  preview.style.color = getComputedStyle(node).color;
  document.body.appendChild(preview);
  return preview;
}

function isPointWithinElement(x: number, y: number, element: HTMLDivElement | null): boolean {
  if (!element) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function bindChipPointerDown(
  event: ReactMouseEvent<HTMLDivElement>,
  playerId: number,
  chipNode: HTMLDivElement,
  onStartDrag: StartDragFn,
  onClickWithoutDrag: () => void
) {
  if (event.button !== 0) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  const startX = event.clientX;
  const startY = event.clientY;
  let dragging = false;

  const handleMove = (moveEvent: MouseEvent) => {
    const moved =
      Math.abs(moveEvent.clientX - startX) > 4 || Math.abs(moveEvent.clientY - startY) > 4;

    if (!moved || dragging) {
      return;
    }

    dragging = true;
    cleanup();
    onStartDrag(playerId, chipNode);
  };

  const handleUp = () => {
    cleanup();
    if (!dragging) {
      onClickWithoutDrag();
    }
  };

  const cleanup = () => {
    window.removeEventListener("mousemove", handleMove);
    window.removeEventListener("mouseup", handleUp);
  };

  window.addEventListener("mousemove", handleMove);
  window.addEventListener("mouseup", handleUp, { once: true });
}

function moveScenarioToIndex(
  scenarios: Scenario[],
  scenarioId: string,
  insertIndex: number
): Scenario[] {
  const sourceIndex = scenarios.findIndex((scenario) => scenario.id === scenarioId);
  if (sourceIndex === -1) {
    return scenarios;
  }

  const nextScenarios = [...scenarios];
  const [draggedScenario] = nextScenarios.splice(sourceIndex, 1);
  nextScenarios.splice(Math.max(0, Math.min(insertIndex, nextScenarios.length)), 0, draggedScenario);
  return nextScenarios;
}

function resolveScenarioInsertIndex(
  y: number,
  scenarioId: string,
  scenarios: Scenario[],
  cardRefs: Map<string, HTMLElement>
): number {
  const orderedIds = scenarios
    .map((scenario) => scenario.id)
    .filter((currentScenarioId) => currentScenarioId !== scenarioId);

  for (let index = 0; index < orderedIds.length; index += 1) {
    const node = cardRefs.get(orderedIds[index]);
    if (!node) {
      continue;
    }

    const rect = node.getBoundingClientRect();
    if (y < rect.top + rect.height / 2) {
      return index;
    }
  }

  return orderedIds.length;
}

function animateChipSwap(fromNode: HTMLDivElement, toNode: HTMLDivElement) {
  const fromRect = fromNode.getBoundingClientRect();
  const toRect = toNode.getBoundingClientRect();
  const clone = fromNode.cloneNode(true) as HTMLDivElement;
  const styles = getComputedStyle(fromNode);

  clone.classList.add("chip-swap-travel");
  clone.style.width = `${fromRect.width}px`;
  clone.style.height = `${fromRect.height}px`;
  clone.style.left = `${fromRect.left}px`;
  clone.style.top = `${fromRect.top}px`;
  clone.style.background = styles.backgroundColor;
  clone.style.borderRadius = styles.borderRadius;
  clone.style.color = styles.color;
  document.body.appendChild(clone);

  const deltaX = toRect.left - fromRect.left;
  const deltaY = toRect.top - fromRect.top;
  const animation = clone.animate(
    [
      { transform: "translate3d(0, 0, 0) scale(1)", opacity: 1 },
      { transform: `translate3d(${deltaX}px, ${deltaY}px, 0) scale(0.98)`, opacity: 1 }
    ],
    {
      duration: 320,
      easing: "cubic-bezier(0.2, 0.8, 0.2, 1)"
    }
  );

  animation.onfinish = () => clone.remove();
}

function resolveNearestSlotFromPoint(
  x: number,
  y: number,
  draggedPlayer: Player,
  chipSize: DragChipMetrics,
  scenarioId: string,
  cellRefs: Map<string, HTMLDivElement>
): NearestSlot {
  let best:
    | {
        slot: SlotDescriptor;
        distance: number;
      }
    | undefined;

  for (const [key, element] of cellRefs.entries()) {
    const [cellScenarioId, teamId, positionRaw] = key.split(":");
    if (cellScenarioId !== scenarioId) {
      continue;
    }

    const position = Number(positionRaw) as Position;
    if (!draggedPlayer.positions.includes(position)) {
      continue;
    }

    const rect = element.getBoundingClientRect();
    const withinSnapBounds =
      x >= rect.left - chipSize.width / 2 &&
      x <= rect.right + chipSize.width / 2 &&
      y >= rect.top - chipSize.height / 2 &&
      y <= rect.bottom + chipSize.height / 2;

    if (!withinSnapBounds) {
      continue;
    }

    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const distance = Math.hypot(x - centerX, y - centerY);

    if (!best || distance < best.distance) {
      best = {
        slot: {
          teamId,
          position
        },
        distance
      };
    }
  }

  return best
    ? {
        scenarioId,
        slot: best.slot,
        valid: true
      }
    : null;
}

function TeamsContent() {
  const { loading, players, retrySync, syncError: playerSyncError } = useTournamentBuilder();
  const cellRefs = useRef(new Map<string, HTMLDivElement>());
  const wrapRefs = useRef(new Map<string, HTMLDivElement>());
  const chipRefs = useRef(new Map<string, HTMLDivElement>());
  const poolRefs = useRef(new Map<string, HTMLDivElement>());
  const scenarioCardRefs = useRef(new Map<string, HTMLElement>());
  const scenarioRectsRef = useRef(new Map<string, DOMRect>());
  const previewTargetRef = useRef<ScenarioSlot | null>(null);
  const poolHoverRef = useRef<string | null>(null);
  const latestScenariosRef = useRef<Scenario[]>([createScenario(1)]);
  const pendingScenarioSyncRef = useRef<Scenario[] | null>(null);
  const scenarioSyncInFlightRef = useRef(false);
  const suppressScenarioRealtimeRef = useRef(false);
  const [scenarios, setScenarios] = useState<Scenario[]>([createScenario(1)]);
  const [nextScenarioNumber, setNextScenarioNumber] = useState(2);
  const [storageHydrated, setStorageHydrated] = useState(false);
  const [scenarioSyncError, setScenarioSyncError] = useState<string | null>(null);
  const [nearestSlot, setNearestSlot] = useState<NearestSlot>(null);
  const [animatedSlots, setAnimatedSlots] = useState<string[]>([]);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [previewTarget, setPreviewTarget] = useState<ScenarioSlot | null>(null);
  const [openPickerSlot, setOpenPickerSlot] = useState<ScenarioSlot | null>(null);
  const [selectedAvailablePlayer, setSelectedAvailablePlayer] = useState<{
    scenarioId: string;
    playerId: number;
  } | null>(null);
  const [poolDropScenarioId, setPoolDropScenarioId] = useState<string | null>(null);
  const [scenarioReorder, setScenarioReorder] = useState<ScenarioReorderState | null>(null);

  const playerById = useMemo(
    () => new Map(players.map((player) => [player.id, player])),
    [players]
  );

  const scenarioById = useMemo(
    () => new Map(scenarios.map((scenario) => [scenario.id, scenario])),
    [scenarios]
  );

  useEffect(() => {
    latestScenariosRef.current = scenarios;
  }, [scenarios]);

  useEffect(() => {
    let cancelled = false;
    const storedState = parseStoredScenarioState(window.localStorage.getItem(TEAM_SCENARIOS_STORAGE_KEY));

    if (storedState && storedState.scenarios.length > 0) {
      setScenarios(
        storedState.scenarios.map((scenario) => ({
          ...scenario,
          collapsed: scenario.collapsed ?? false
        }))
      );
      setNextScenarioNumber(
        Math.max(
          storedState.nextScenarioNumber ?? storedState.scenarios.length + 1,
          getNextScenarioNumber(storedState.scenarios)
        )
      );
    }

    setStorageHydrated(true);

    async function loadScenariosFromSupabase() {
      if (!hasSupabaseBrowserConfig()) {
        return;
      }

      try {
        const supabase = getSupabaseBrowserClient();
        const [{ data: scenarioRows, error: scenarioError }, { data: assignmentRows, error: assignmentError }] =
          await Promise.all([
            supabase.from("team_scenarios").select("id,title,sort_order").order("sort_order", {
              ascending: true
            }),
            supabase
              .from("scenario_assignments")
              .select("scenario_id,team_id,position,player_id")
              .order("scenario_id", { ascending: true })
          ]);

        if (scenarioError) {
          throw scenarioError;
        }

        if (assignmentError) {
          throw assignmentError;
        }

        const backendScenarios = buildScenarioState(
          scenarioRows ?? [],
          assignmentRows ?? [],
          storedState?.scenarios ?? []
        );

        if (cancelled) {
          return;
        }

        if (storedState && storedState.scenarios.length > 0 && isScenarioPristine(backendScenarios)) {
          pendingScenarioSyncRef.current = storedState.scenarios;
          suppressScenarioRealtimeRef.current = true;
          setScenarioSyncError("Migrating local scenarios to Supabase.");
          return;
        }

        if (backendScenarios.length > 0) {
          setScenarios(backendScenarios);
          setNextScenarioNumber(getNextScenarioNumber(backendScenarios));
        }

        setScenarioSyncError(null);
        suppressScenarioRealtimeRef.current = false;
      } catch {
        if (!cancelled) {
          setScenarioSyncError("Unable to load scenarios from Supabase. Using local data.");
        }
      }
    }

    void loadScenariosFromSupabase();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!storageHydrated) {
      return;
    }

    window.localStorage.setItem(
      TEAM_SCENARIOS_STORAGE_KEY,
      JSON.stringify({
        nextScenarioNumber,
        scenarios
      } satisfies PersistedScenarioState)
    );
  }, [nextScenarioNumber, scenarios, storageHydrated]);

  const flushScenarioSync = useCallback(async () => {
    if (!hasSupabaseBrowserConfig() || scenarioSyncInFlightRef.current) {
      return;
    }

    const snapshot = pendingScenarioSyncRef.current;
    if (!snapshot) {
      return;
    }

    scenarioSyncInFlightRef.current = true;

    while (pendingScenarioSyncRef.current) {
      const nextSnapshot = pendingScenarioSyncRef.current;
      pendingScenarioSyncRef.current = null;

      try {
        const supabase = getSupabaseBrowserClient();
        const scenarioRows = scenariosToRows(nextSnapshot);
        const assignmentRows = nextSnapshot.flatMap((scenario) =>
          scenarioAssignmentsToRows(scenario.id, scenario.assignments)
        );
        const scenarioIds = nextSnapshot.map((scenario) => scenario.id);

        const { error: upsertScenariosError } = await supabase
          .from("team_scenarios")
          .upsert(scenarioRows, { onConflict: "id" });
        if (upsertScenariosError) {
          throw upsertScenariosError;
        }

        const { data: existingScenarioRows, error: existingScenariosError } = await supabase
          .from("team_scenarios")
          .select("id");
        if (existingScenariosError) {
          throw existingScenariosError;
        }

        const staleScenarioIds = (existingScenarioRows ?? [])
          .map((row) => row.id)
          .filter((id) => !scenarioIds.includes(id));

        if (staleScenarioIds.length > 0) {
          const { error: deleteOldScenarioRowsError } = await supabase
            .from("team_scenarios")
            .delete()
            .in("id", staleScenarioIds);
          if (deleteOldScenarioRowsError) {
            throw deleteOldScenarioRowsError;
          }
        }

        if (scenarioIds.length > 0) {
          const { error: deleteAssignmentsError } = await supabase
            .from("scenario_assignments")
            .delete()
            .in("scenario_id", scenarioIds);
          if (deleteAssignmentsError) {
            throw deleteAssignmentsError;
          }
        }

        if (assignmentRows.length > 0) {
          const { error: insertAssignmentsError } = await supabase
            .from("scenario_assignments")
            .insert(assignmentRows);
          if (insertAssignmentsError) {
            throw insertAssignmentsError;
          }
        }

        setScenarioSyncError(null);
        suppressScenarioRealtimeRef.current = false;
      } catch {
        pendingScenarioSyncRef.current = latestScenariosRef.current;
        setScenarioSyncError("Changes saved locally. Scenario backend sync failed.");
        suppressScenarioRealtimeRef.current = true;
        break;
      }
    }

    scenarioSyncInFlightRef.current = false;
  }, []);

  const queueScenarioSync = useCallback(
    (snapshot: Scenario[]) => {
      if (!hasSupabaseBrowserConfig()) {
        return;
      }

      pendingScenarioSyncRef.current = snapshot;
      void flushScenarioSync();
    },
    [flushScenarioSync]
  );

  useEffect(() => {
    if (!hasSupabaseBrowserConfig()) {
      return undefined;
    }

    const handleRetry = () => {
      if (pendingScenarioSyncRef.current) {
        void flushScenarioSync();
      }
    };

    window.addEventListener("focus", handleRetry);
    window.addEventListener("online", handleRetry);

    return () => {
      window.removeEventListener("focus", handleRetry);
      window.removeEventListener("online", handleRetry);
    };
  }, [flushScenarioSync]);

  useEffect(() => {
    if (storageHydrated && pendingScenarioSyncRef.current) {
      void flushScenarioSync();
    }
  }, [flushScenarioSync, storageHydrated]);

  useEffect(() => {
    if (loading) {
      return;
    }

    setScenarios((current) =>
      current.map((scenario) => ({
        ...scenario,
        assignments: pruneAssignments(players, scenario.assignments)
      }))
    );
  }, [loading, players]);

  useEffect(() => {
    if (!hasSupabaseBrowserConfig()) {
      return undefined;
    }

    const supabase = getSupabaseBrowserClient();
    let active = true;
    let channel: RealtimeChannel | null = null;

    async function refreshScenariosFromRealtime() {
      if (suppressScenarioRealtimeRef.current) {
        return;
      }

      try {
        const [{ data: scenarioRows, error: scenarioError }, { data: assignmentRows, error: assignmentError }] =
          await Promise.all([
            supabase.from("team_scenarios").select("id,title,sort_order").order("sort_order", {
              ascending: true
            }),
            supabase
              .from("scenario_assignments")
              .select("scenario_id,team_id,position,player_id")
              .order("scenario_id", { ascending: true })
          ]);

        if (scenarioError) {
          throw scenarioError;
        }

        if (assignmentError) {
          throw assignmentError;
        }

        const backendScenarios = buildScenarioState(
          scenarioRows ?? [],
          assignmentRows ?? [],
          latestScenariosRef.current
        );

        if (!active) {
          return;
        }

        setScenarios((current) => (areScenariosEquivalent(current, backendScenarios) ? current : backendScenarios));
        setNextScenarioNumber(getNextScenarioNumber(backendScenarios));
        setScenarioSyncError((current) =>
          current === "Unable to load scenarios from Supabase. Using local data." ? null : current
        );
      } catch {
        if (active) {
          setScenarioSyncError("Unable to refresh scenarios from Supabase. Using local data.");
        }
      }
    }

    channel = supabase
      .channel("tcb-scenarios")
      .on("postgres_changes", { event: "*", schema: "public", table: "team_scenarios" }, () => {
        void refreshScenariosFromRealtime();
      })
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "scenario_assignments" },
        () => {
          void refreshScenariosFromRealtime();
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

  const displayedAssignmentsByScenario = useMemo(() => {
    const nextDisplayed = new Map<string, Assignments>();

    for (const scenario of scenarios) {
      if (!dragState || dragState.scenarioId !== scenario.id) {
        nextDisplayed.set(scenario.id, scenario.assignments);
        continue;
      }

      if (previewTarget && previewTarget.scenarioId === scenario.id) {
        nextDisplayed.set(
          scenario.id,
          assignPlayerToSlot(scenario.assignments, dragState.playerId, previewTarget.slot)
        );
        continue;
      }

      if (!dragState.sourceSlot) {
        nextDisplayed.set(scenario.id, scenario.assignments);
        continue;
      }

      nextDisplayed.set(scenario.id, {
        ...scenario.assignments,
        [dragState.sourceSlot.teamId]: {
          ...scenario.assignments[dragState.sourceSlot.teamId],
          [dragState.sourceSlot.position]: null
        }
      });
    }

    return nextDisplayed;
  }, [dragState, previewTarget, scenarios]);

  const availablePlayersByScenario = useMemo(() => {
    const nextAvailable = new Map<string, Player[]>();

    for (const scenario of scenarios) {
      const scenarioPlayers = players
        .filter((player) => {
          if (!player.name.trim()) {
            return false;
          }

          if (
            dragState &&
            dragState.scenarioId === scenario.id &&
            dragState.playerId === player.id &&
            dragState.sourceSlot === null
          ) {
            return false;
          }

          return !findPlayerSlot(scenario.assignments, player.id);
        })
        .sort((left, right) => left.name.localeCompare(right.name));

      nextAvailable.set(scenario.id, scenarioPlayers);
    }

    return nextAvailable;
  }, [dragState, players, scenarios]);

  const orderedScenarios = useMemo(() => {
    if (!scenarioReorder) {
      return scenarios;
    }

    return moveScenarioToIndex(scenarios, scenarioReorder.scenarioId, scenarioReorder.insertIndex);
  }, [scenarioReorder?.insertIndex, scenarioReorder?.scenarioId, scenarios]);

  const scenarioLayoutKey = useMemo(
    () =>
      `${scenarioReorder ? `drag:${scenarioReorder.scenarioId}` : "rest"}|${orderedScenarios
        .map((scenario) => scenario.id)
        .join("|")}`,
    [orderedScenarios, scenarioReorder ? scenarioReorder.scenarioId : null]
  );

  const updateScenarioAssignments = (
    scenarioId: string,
    updater: (assignments: Assignments) => Assignments
  ) => {
    setScenarios((current) => {
      const nextScenarios = current.map((scenario) =>
        scenario.id === scenarioId
          ? {
              ...scenario,
              assignments: updater(scenario.assignments)
            }
          : scenario
      );
      queueScenarioSync(nextScenarios);
      return nextScenarios;
    });
  };

  const updateScenarioTitle = (scenarioId: string, title: string) => {
    setScenarios((current) => {
      const nextScenarios = current.map((scenario) =>
        scenario.id === scenarioId ? { ...scenario, title } : scenario
      );
      queueScenarioSync(nextScenarios);
      return nextScenarios;
    });
  };

  const toggleScenarioCollapsed = (scenarioId: string) => {
    setScenarios((current) =>
      current.map((scenario) =>
        scenario.id === scenarioId
          ? {
              ...scenario,
              collapsed: !scenario.collapsed
            }
          : scenario
      )
    );
    setOpenPickerSlot((current) => (current?.scenarioId === scenarioId ? null : current));
    setSelectedAvailablePlayer((current) =>
      current?.scenarioId === scenarioId ? null : current
    );
  };

  const assignPlayerToScenarioSlot = (scenarioId: string, playerId: number, slot: SlotDescriptor) => {
    const player = playerById.get(playerId);
    if (!player || !player.name.trim() || !player.positions.includes(slot.position)) {
      return;
    }

    updateScenarioAssignments(scenarioId, (assignments) => assignPlayerToSlot(assignments, playerId, slot));
  };

  const clearScenarioSlot = (scenarioId: string, slot: SlotDescriptor) => {
    updateScenarioAssignments(scenarioId, (assignments) => clearSlot(assignments, slot));
  };

  const beginScenarioReorder = (
    scenarioId: string,
    sectionNode: HTMLElement,
    point: { x: number; y: number }
  ) => {
    const rect = sectionNode.getBoundingClientRect();
    const headerNode = sectionNode.querySelector(".scenario-header") as HTMLDivElement | null;
    const headerRect = headerNode?.getBoundingClientRect();
    const collapsedHeight = (headerRect?.height ?? 44) + 36;
    const sourceIndex = scenarios.findIndex((scenario) => scenario.id === scenarioId);

    if (sourceIndex === -1) {
      return;
    }

    setOpenPickerSlot(null);
    setSelectedAvailablePlayer(null);
    setPoolDropScenarioId(null);
    setScenarioReorder({
      scenarioId,
      point,
      offset: {
        x: point.x - rect.left,
        y: Math.min(point.y - rect.top, collapsedHeight - 8)
      },
      width: rect.width,
      height: collapsedHeight,
      insertIndex: sourceIndex
    });
  };

  const beginDrag = (
    scenarioId: string,
    playerId: number,
    chipNode: HTMLDivElement,
    sourceSlot: SlotDescriptor | null
  ) => {
    const preview = createDragPreview(chipNode);
    preview.remove();
    previewTargetRef.current = null;
    poolHoverRef.current = null;
    setDragState({
      scenarioId,
      playerId,
      sourceSlot,
      chipSize: {
        width: chipNode.offsetWidth,
        height: chipNode.offsetHeight
      },
      point: {
        x: chipNode.getBoundingClientRect().left + chipNode.offsetWidth / 2,
        y: chipNode.getBoundingClientRect().top + chipNode.offsetHeight / 2
      },
      color: getComputedStyle(chipNode).backgroundColor
    });
    setOpenPickerSlot(null);
    setSelectedAvailablePlayer(null);
  };

  const addScenario = () => {
    const nextScenario = createScenario(nextScenarioNumber);
    setScenarios((current) => {
      const nextScenarios = [...current, nextScenario];
      queueScenarioSync(nextScenarios);
      return nextScenarios;
    });
    setNextScenarioNumber((current) => Math.max(current + 1, nextScenarioNumber + 1));
    setOpenPickerSlot(null);
    setSelectedAvailablePlayer(null);
  };

  useEffect(() => {
    if (!scenarioReorder) {
      return;
    }

    const handleMove = (event: MouseEvent) => {
      setScenarioReorder((current) =>
        current
          ? {
              ...current,
              point: { x: event.clientX, y: event.clientY },
              insertIndex: resolveScenarioInsertIndex(
                event.clientY,
                current.scenarioId,
                scenarios,
                scenarioCardRefs.current
              )
            }
          : current
      );
    };

    const handleUp = () => {
      setScenarios((current) => {
        const nextScenarios = moveScenarioToIndex(
          current,
          scenarioReorder.scenarioId,
          scenarioReorder.insertIndex
        );
        queueScenarioSync(nextScenarios);
        return nextScenarios;
      });
      setScenarioReorder(null);
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp, { once: true });
    document.body.style.userSelect = "none";
    document.body.style.cursor = "grabbing";

    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, [queueScenarioSync, scenarioReorder, scenarios]);

  useLayoutEffect(() => {
    const nextRects = new Map<string, DOMRect>();

    for (const scenario of orderedScenarios) {
      const node = scenarioCardRefs.current.get(scenario.id);
      if (!node) {
        continue;
      }

      const nextRect = node.getBoundingClientRect();
      nextRects.set(scenario.id, nextRect);

      if (scenarioReorder?.scenarioId === scenario.id) {
        continue;
      }

      const previousRect = scenarioRectsRef.current.get(scenario.id);
      if (!previousRect) {
        continue;
      }

      const deltaY = previousRect.top - nextRect.top;
      if (Math.abs(deltaY) < 1) {
        continue;
      }

      node.animate(
        [
          { transform: `translateY(${deltaY}px)` },
          { transform: "translateY(0)" }
        ],
        {
          duration: 220,
          easing: "cubic-bezier(0.2, 0.8, 0.2, 1)"
        }
      );
    }

    scenarioRectsRef.current = nextRects;
  }, [orderedScenarios, scenarioLayoutKey, scenarioReorder?.scenarioId]);

  useEffect(() => {
    if (!dragState) {
      return;
    }

    previewTargetRef.current = previewTarget;

    const handleMove = (event: MouseEvent) => {
      setDragState((current) =>
        current
          ? {
              ...current,
              point: { x: event.clientX, y: event.clientY }
            }
          : current
      );

      const draggedPlayer = playerById.get(dragState.playerId);
      const draggedScenario = scenarioById.get(dragState.scenarioId);
      if (!draggedPlayer || !draggedScenario) {
        return;
      }

      const hoveringPool = Boolean(
        dragState.sourceSlot &&
          isPointWithinElement(event.clientX, event.clientY, poolRefs.current.get(dragState.scenarioId) ?? null)
      );

      if (hoveringPool) {
        setNearestSlot(null);
        setPreviewTarget(null);
        previewTargetRef.current = null;
        setPoolDropScenarioId(dragState.scenarioId);
        poolHoverRef.current = dragState.scenarioId;
        return;
      }

      if (poolHoverRef.current) {
        setPoolDropScenarioId(null);
        poolHoverRef.current = null;
      }

      const nextNearest = resolveNearestSlotFromPoint(
        event.clientX,
        event.clientY,
        draggedPlayer,
        dragState.chipSize,
        dragState.scenarioId,
        cellRefs.current
      );

      const normalizedSlot =
        nextNearest &&
        dragState.sourceSlot &&
        isSameSlot(nextNearest.slot, dragState.sourceSlot)
          ? null
          : nextNearest?.slot ?? null;

      const normalizedTarget = normalizedSlot
        ? {
            scenarioId: dragState.scenarioId,
            slot: normalizedSlot
          }
        : null;

      setNearestSlot(nextNearest && normalizedTarget ? nextNearest : null);
      setPreviewTarget(normalizedTarget);

      const previousTarget = previewTargetRef.current;
      previewTargetRef.current = normalizedTarget;

      const sourceSlot = dragState.sourceSlot;
      if (!sourceSlot) {
        return;
      }

      const previousKey = previousTarget
        ? getScenarioSlotKey(previousTarget.scenarioId, previousTarget.slot)
        : null;
      const nextKey = normalizedTarget
        ? getScenarioSlotKey(normalizedTarget.scenarioId, normalizedTarget.slot)
        : null;
      const sourceKey = getScenarioSlotKey(dragState.scenarioId, sourceSlot);

      if (previousKey && previousKey !== nextKey) {
        const rollbackChip = chipRefs.current.get(sourceKey);
        const rollbackTarget = wrapRefs.current.get(previousKey);
        if (rollbackChip && rollbackTarget) {
          animateChipSwap(rollbackChip, rollbackTarget);
        }
      }

      if (nextKey && nextKey !== previousKey) {
        const displacedPlayerId =
          draggedScenario.assignments[normalizedTarget!.slot.teamId][normalizedTarget!.slot.position];
        if (displacedPlayerId !== null) {
          const fromChip = chipRefs.current.get(nextKey);
          const toWrap = wrapRefs.current.get(sourceKey);
          if (fromChip && toWrap) {
            animateChipSwap(fromChip, toWrap);
          }
        }
      }
    };

    const handleUp = () => {
      const target = previewTargetRef.current;
      const sourceSlot = dragState.sourceSlot;

      if (target && target.scenarioId === dragState.scenarioId) {
        const keys = new Set<string>([getScenarioSlotKey(target.scenarioId, target.slot)]);
        if (sourceSlot) {
          keys.add(getScenarioSlotKey(dragState.scenarioId, sourceSlot));
        }
        assignPlayerToScenarioSlot(dragState.scenarioId, dragState.playerId, target.slot);
        setAnimatedSlots([...keys]);
        window.setTimeout(() => setAnimatedSlots([]), 220);
      } else if (poolHoverRef.current === dragState.scenarioId && sourceSlot) {
        clearScenarioSlot(dragState.scenarioId, sourceSlot);
      }

      previewTargetRef.current = null;
      poolHoverRef.current = null;
      setDragState(null);
      setPreviewTarget(null);
      setNearestSlot(null);
      setOpenPickerSlot(null);
      setSelectedAvailablePlayer(null);
      setPoolDropScenarioId(null);
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp, { once: true });
    document.body.style.userSelect = "none";

    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
      document.body.style.userSelect = "";
    };
  }, [dragState, playerById, previewTarget, scenarioById]);

  return (
    <AppShell
      title="Teams Board"
      copy="Build independent team scenarios. Players can move only within the scenario they belong to."
    >
      <div className="status-bar">
        <div className="status-chip">
          {loading ? "Loading roster seed..." : "Drag chips within a scenario or use each scenario's player pool."}
        </div>
        {playerSyncError ? (
          <button type="button" className="status-chip error" onClick={retrySync}>
            {playerSyncError} Retry roster sync
          </button>
        ) : null}
        {scenarioSyncError ? (
          <button
            type="button"
            className="status-chip error"
            onClick={() => {
              if (latestScenariosRef.current) {
                pendingScenarioSyncRef.current = latestScenariosRef.current;
                void flushScenarioSync();
              }
            }}
          >
            {scenarioSyncError} Retry scenario sync
          </button>
        ) : null}
      </div>
      <div className="scenario-stack">
        {orderedScenarios.map((scenario) => {
          const displayedAssignments =
            displayedAssignmentsByScenario.get(scenario.id) ?? scenario.assignments;
          const availablePlayers = availablePlayersByScenario.get(scenario.id) ?? [];
          const currentNearestSlot = nearestSlot?.scenarioId === scenario.id ? nearestSlot : null;
          const currentOpenPickerSlot =
            openPickerSlot?.scenarioId === scenario.id ? openPickerSlot.slot : null;
          const selectedAvailablePlayerId =
            selectedAvailablePlayer?.scenarioId === scenario.id
              ? selectedAvailablePlayer.playerId
              : null;
          const scenarioCollapsed = Boolean(scenarioReorder) || scenario.collapsed;
          const scenarioIsDragging = scenarioReorder?.scenarioId === scenario.id;

          return (
            <section
              key={scenario.id}
              ref={(node) => {
                if (node) {
                  scenarioCardRefs.current.set(scenario.id, node);
                } else {
                  scenarioCardRefs.current.delete(scenario.id);
                }
              }}
              className={`panel board-shell${scenarioCollapsed ? " collapsed" : ""}${scenarioIsDragging ? " scenario-drag-placeholder" : ""}`}
            >
              <div
                className="scenario-header"
                onMouseDown={(event) => {
                  if (dragState || scenarioReorder || event.button !== 0) {
                    return;
                  }

                  const sectionNode = event.currentTarget.closest(".board-shell");
                  if (!(sectionNode instanceof HTMLElement)) {
                    return;
                  }

                  event.preventDefault();

                  const interactionTarget = event.target as HTMLElement;
                  const toggleButton = interactionTarget.closest(".scenario-toggle");
                  const titleInput = interactionTarget.closest(".scenario-title-input");
                  const startX = event.clientX;
                  const startY = event.clientY;
                  let dragging = false;

                  const handleMove = (moveEvent: MouseEvent) => {
                    const moved =
                      Math.abs(moveEvent.clientX - startX) > 4 ||
                      Math.abs(moveEvent.clientY - startY) > 4;

                    if (!moved || dragging) {
                      return;
                    }

                    dragging = true;
                    cleanup();
                    beginScenarioReorder(scenario.id, sectionNode, {
                      x: moveEvent.clientX,
                      y: moveEvent.clientY
                    });
                  };

                  const handleUp = () => {
                    cleanup();

                    if (dragging) {
                      return;
                    }

                    if (toggleButton) {
                      toggleScenarioCollapsed(scenario.id);
                      return;
                    }

                    if (titleInput instanceof HTMLInputElement) {
                      titleInput.focus();
                      const length = titleInput.value.length;
                      titleInput.setSelectionRange(length, length);
                    }
                  };

                  const cleanup = () => {
                    window.removeEventListener("mousemove", handleMove);
                    window.removeEventListener("mouseup", handleUp);
                  };

                  window.addEventListener("mousemove", handleMove);
                  window.addEventListener("mouseup", handleUp, { once: true });
                }}
              >
                <input
                  type="text"
                  className="scenario-title-input"
                  value={scenario.title}
                  onChange={(event) => updateScenarioTitle(scenario.id, event.target.value)}
                  aria-label={`Scenario title for ${scenario.title || "scenario"}`}
                  placeholder="Team Scenario"
                  spellCheck={false}
                />
                <button
                  type="button"
                  className={`scenario-toggle${scenarioCollapsed ? " collapsed" : ""}`}
                  aria-label={scenarioCollapsed ? "Expand scenario" : "Collapse scenario"}
                  aria-expanded={!scenarioCollapsed}
                  tabIndex={scenarioReorder ? -1 : 0}
                >
                  <span className="scenario-toggle-icon" aria-hidden="true" />
                </button>
              </div>
              <div className="scenario-body" aria-hidden={scenarioCollapsed}>
                <div className="scenario-body-inner">
                  <div className="teams-grid">
                    {TEAMS.map((team) => (
                      <TeamColumn
                        key={team.id}
                        scenarioId={scenario.id}
                        team={team}
                        assignments={displayedAssignments[team.id]}
                        registerCell={(slot) => (node) => {
                          const key = getScenarioSlotKey(scenario.id, slot);
                          if (node) {
                            cellRefs.current.set(key, node);
                          } else {
                            cellRefs.current.delete(key);
                          }
                        }}
                        registerWrap={(slot) => (node) => {
                          const key = getScenarioSlotKey(scenario.id, slot);
                          if (node) {
                            wrapRefs.current.set(key, node);
                          } else {
                            wrapRefs.current.delete(key);
                          }
                        }}
                        registerChip={(slot) => (node) => {
                          const key = getScenarioSlotKey(scenario.id, slot);
                          if (node) {
                            chipRefs.current.set(key, node);
                          } else {
                            chipRefs.current.delete(key);
                          }
                        }}
                        openPickerSlot={currentOpenPickerSlot}
                        onTogglePicker={(slot) => {
                          if (dragState) {
                            return;
                          }

                          if (
                            selectedAvailablePlayer &&
                            selectedAvailablePlayer.scenarioId === scenario.id
                          ) {
                            const selectedPlayer = playerById.get(selectedAvailablePlayer.playerId);
                            if (selectedPlayer?.positions.includes(slot.position)) {
                              assignPlayerToScenarioSlot(scenario.id, selectedAvailablePlayer.playerId, slot);
                              setSelectedAvailablePlayer(null);
                              setOpenPickerSlot(null);
                            }
                            return;
                          }

                          if (
                            selectedAvailablePlayer &&
                            selectedAvailablePlayer.scenarioId !== scenario.id
                          ) {
                            setSelectedAvailablePlayer(null);
                          }

                          setOpenPickerSlot((current) =>
                            current &&
                            current.scenarioId === scenario.id &&
                            isSameSlot(current.slot, slot)
                              ? null
                              : { scenarioId: scenario.id, slot }
                          );
                        }}
                        animatedSlots={animatedSlots}
                        draggedPlayerId={dragState?.scenarioId === scenario.id ? dragState.playerId : null}
                        nearestSlot={currentNearestSlot}
                        playersById={playerById}
                        onDragStart={(playerId, chipNode) => {
                          beginDrag(
                            scenario.id,
                            playerId,
                            chipNode,
                            findPlayerSlot(scenario.assignments, playerId)
                          );
                        }}
                        getEligibleForSlot={(slot, currentPlayerId) =>
                          getEligiblePlayers(players, scenario.assignments, slot.position, currentPlayerId)
                        }
                        onAssign={(playerId, slot) => {
                          assignPlayerToScenarioSlot(scenario.id, playerId, slot);
                          setOpenPickerSlot(null);
                          setSelectedAvailablePlayer(null);
                        }}
                        onClear={(slot) => clearScenarioSlot(scenario.id, slot)}
                      />
                    ))}
                  </div>
                  <div
                    ref={(node) => {
                      if (node) {
                        poolRefs.current.set(scenario.id, node);
                      } else {
                        poolRefs.current.delete(scenario.id);
                      }
                    }}
                    className={`available-shell${poolDropScenarioId === scenario.id ? " pool-drop-active" : ""}`}
                  >
                    <h2 className="available-title">Player Pool</h2>
                    <div className="available-players">
                      {availablePlayers.map((player) => {
                        const isSelected = selectedAvailablePlayerId === player.id;
                        return (
                          <div
                            key={player.id}
                            className={`player-chip available-player-chip${isSelected ? " selected" : ""}`}
                            title={player.name}
                            onMouseDown={(event) =>
                              bindChipPointerDown(
                                event,
                                player.id,
                                event.currentTarget,
                                (playerId, chipNode) => beginDrag(scenario.id, playerId, chipNode, null),
                                () => {
                                  setOpenPickerSlot(null);
                                  setSelectedAvailablePlayer((current) =>
                                    current?.scenarioId === scenario.id && current.playerId === player.id
                                      ? null
                                      : {
                                          scenarioId: scenario.id,
                                          playerId: player.id
                                        }
                                  );
                                }
                              )
                            }
                          >
                            {formatPlayerLabel(player.name)}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </section>
          );
        })}
        <div className="scenario-add-row">
          <button type="button" className="scenario-add-button" onClick={addScenario}>
            Add Scenario
          </button>
        </div>
      </div>
      {dragState && !previewTarget
        ? createPortal(
            <div
              className="drag-floating-chip"
              style={{
                left: dragState.point.x,
                top: dragState.point.y,
                width: dragState.chipSize.width,
                minHeight: dragState.chipSize.height,
                background: dragState.color
              }}
            >
              {formatPlayerLabel(playerById.get(dragState.playerId)?.name ?? "")}
            </div>,
            document.body
          )
        : null}
      {scenarioReorder
        ? createPortal(
            <div
              className="panel board-shell collapsed scenario-floating-card"
              style={{
                left: scenarioReorder.point.x - scenarioReorder.offset.x,
                top: scenarioReorder.point.y - scenarioReorder.offset.y,
                width: scenarioReorder.width,
                minHeight: scenarioReorder.height
              }}
            >
              <div className="scenario-header">
                <div className="scenario-title-input">{scenarioById.get(scenarioReorder.scenarioId)?.title}</div>
                <div className="scenario-toggle collapsed" aria-hidden="true" tabIndex={-1}>
                  <span className="scenario-toggle-icon" />
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </AppShell>
  );
}

function TeamColumn({
  scenarioId,
  team,
  assignments,
  registerCell,
  registerWrap,
  registerChip,
  openPickerSlot,
  onTogglePicker,
  animatedSlots,
  draggedPlayerId,
  nearestSlot,
  playersById,
  onDragStart,
  getEligibleForSlot,
  onAssign,
  onClear
}: {
  scenarioId: string;
  team: Team;
  assignments: Record<Position, number | null>;
  registerCell: (slot: SlotDescriptor) => (node: HTMLDivElement | null) => void;
  registerWrap: (slot: SlotDescriptor) => (node: HTMLDivElement | null) => void;
  registerChip: (slot: SlotDescriptor) => (node: HTMLDivElement | null) => void;
  openPickerSlot: SlotDescriptor | null;
  onTogglePicker: (slot: SlotDescriptor) => void;
  animatedSlots: string[];
  draggedPlayerId: number | null;
  nearestSlot: NearestSlot;
  playersById: Map<number, Player>;
  onDragStart: (playerId: number, chipNode: HTMLDivElement) => void;
  getEligibleForSlot: (slot: SlotDescriptor, currentPlayerId: number | null) => Player[];
  onAssign: (playerId: number, slot: SlotDescriptor) => void;
  onClear: (slot: SlotDescriptor) => void;
}) {
  return (
    <section className="team-card">
      <div className="team-name" style={{ background: team.color }}>
        {team.name}
      </div>
      <div className="team-slots">
        {POSITIONS.map((position) => {
          const slot = { teamId: team.id, position };
          const playerId = assignments[position];
          const player = playerId ? playersById.get(playerId) ?? null : null;
          const eligiblePlayers = getEligibleForSlot(slot, playerId);
          const isNearest =
            nearestSlot?.scenarioId === scenarioId &&
            nearestSlot.slot.teamId === team.id &&
            nearestSlot.slot.position === position;
          const isAnimated = animatedSlots.includes(getScenarioSlotKey(scenarioId, slot));
          const draggedPlayer = draggedPlayerId ? playersById.get(draggedPlayerId) ?? null : null;
          const isInvalidForDraggedPlayer = Boolean(
            draggedPlayer && !draggedPlayer.positions.includes(position)
          );
          const pickerOpen = isSameSlot(openPickerSlot, slot);

          return (
            <div
              key={position}
              ref={registerCell(slot)}
              className={`team-slot team-slot-grid${isNearest ? nearestSlot?.valid ? " nearest" : " invalid-nearest" : ""}${isAnimated ? " swapped" : ""}${isInvalidForDraggedPlayer ? " drag-invalid" : draggedPlayer ? " drag-valid" : ""}`}
            >
              <div className="team-slot-label">{position}</div>
              <div className="slot-actions">
                <div
                  ref={registerWrap(slot)}
                  className="slot-select-wrap"
                  style={{ background: team.color }}
                  role="button"
                  tabIndex={0}
                  onClick={() => onTogglePicker(slot)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onTogglePicker(slot);
                    }
                  }}
                >
                  {player ? (
                    <div
                      ref={registerChip(slot)}
                      className={`player-chip${draggedPlayerId === player.id ? " preview-dragged" : ""}`}
                      onMouseDown={(event) => {
                        bindChipPointerDown(
                          event,
                          player.id,
                          event.currentTarget,
                          onDragStart,
                          () => onTogglePicker(slot)
                        );
                      }}
                      onClick={(event) => event.stopPropagation()}
                      title={player.name}
                    >
                      {formatPlayerLabel(player.name)}
                      <button
                        type="button"
                        className="player-chip-clear"
                        onClick={(event) => {
                          event.stopPropagation();
                          onClear(slot);
                        }}
                        aria-label={`Clear ${team.name} position ${position}`}
                      >
                        x
                      </button>
                    </div>
                  ) : (
                    <span className="slot-empty">Open slot</span>
                  )}
                  {pickerOpen ? (
                    <div
                      className="slot-picker"
                      role="listbox"
                      aria-label={`${team.name} position ${position} players`}
                    >
                      {eligiblePlayers.map((candidate) => (
                        <button
                          key={candidate.id}
                          type="button"
                          className={`slot-picker-option${candidate.id === playerId ? " active" : ""}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            onAssign(candidate.id, slot);
                          }}
                        >
                          {candidate.name}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function TeamsPage() {
  return (
    <TournamentBuilderProvider>
      <TeamsContent />
    </TournamentBuilderProvider>
  );
}
