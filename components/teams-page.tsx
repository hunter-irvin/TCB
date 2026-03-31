"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AppShell } from "@/components/app-shell";
import { useRun } from "@/components/run-provider";
import { TournamentBuilderProvider, useTournamentBuilder } from "@/components/tournament-builder";
import { DEFAULT_RUN_SLUG, buildRunScopedStorageKey } from "@/lib/runs";
import {
  MAX_TEAMS,
  PLAYER_ATTRIBUTE_GROUPS,
  POSITIONS,
  TEAM_COLOR_PALETTE,
  TEAM_CHEMISTRY_MAX_ABS,
  TEAMS
} from "@/lib/constants";
import { getSupabaseBrowserClient, hasSupabaseBrowserConfig } from "@/lib/supabase/browser";
import {
  areAssignmentsEqual,
  areScenariosEquivalent,
  areTeamsEqual,
  buildScenarioState,
  createScenarioId,
  getNextScenarioNumber,
  normalizeScenarioIds,
  normalizeTeamColor,
  normalizeTeams,
  parseStoredScenarioState,
  scenarioAssignmentsToRows,
  scenariosToRows,
  TEAM_SELECT_COLUMNS,
  TEAM_SCENARIO_SELECT_COLUMNS,
  TEAM_SCENARIOS_STORAGE_KEY,
  teamsFromRows,
  teamsToRows
} from "@/lib/supabase/tcb";
import {
  assignPlayerToSlot,
  clearSlot,
  createEmptyAssignments,
  findPlayerSlot,
  getEligiblePlayers,
  pruneAssignments
} from "@/lib/state";
import type {
  Assignments,
  PersistedScenarioState,
  Player,
  PlayerAttributeKey,
  Position,
  Scenario,
  SlotDescriptor,
  Team
} from "@/lib/types";
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
const SCENARIO_SYNC_DEBOUNCE_MS = 2000;
const TEAM_COLOR_SCENARIO_COMMIT_DELAY_MS = 120;

type TeamDraft = {
  name: string;
  color: string;
};

type TeamAttributeStack = {
  team: Team;
  total: number;
  segments: ScenarioChartSegment[];
};

type ScenarioAttributeChart = {
  label: string;
  tone: "offense" | "defense" | "misc";
  maxTotal: number;
  stacks: TeamAttributeStack[];
};

type ScenarioChartSegment = {
  key: PlayerAttributeKey | "chemistry";
  label: string;
  value: number;
  variant: "attribute" | "chemistry";
};

const SCENARIO_CHART_MAX_TOTAL = 75;
const TEAM_SYNC_DEBOUNCE_MS = 1000;

function roundChartValue(value: number) {
  return Math.round((value + Number.EPSILON) * 10) / 10;
}

function formatChartValue(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function getTeamDisplayName(team: Team, index: number) {
  const name = team.name.trim();
  return name || `Team ${index + 1}`;
}

function buildTeamChemistryBonusTotal(
  assignments: Assignments,
  playersById: Map<number, Player>,
  teamId: string
) {
  const teamPlayerIds = new Set(
    POSITIONS.map((position) => assignments[teamId]?.[position] ?? null).filter(
      (playerId): playerId is number => playerId !== null
    )
  );

  return [...teamPlayerIds].reduce((sum, playerId) => {
    const player = playersById.get(playerId);
    if (!player) {
      return sum;
    }

    return (
      sum +
      player.chemistry.bonus.filter((chemistryPlayerId) => teamPlayerIds.has(chemistryPlayerId)).length
    );
  }, 0);
}

function createScenario(index: number, teams: Team[]): Scenario {
  return {
    id: createScenarioId(),
    title: `Team Scenario ${index}`,
    assignments: createEmptyAssignments(teams),
    collapsed: false
  };
}

function buildScenarioAttributeCharts(
  assignments: Assignments,
  playersById: Map<number, Player>,
  teams: Team[]
): ScenarioAttributeChart[] {
  return PLAYER_ATTRIBUTE_GROUPS.map((group) => {
    const stacks = teams.map((team) => {
      const segments: ScenarioChartSegment[] = group.attributes.map((attribute) => {
        const value = roundChartValue(
          POSITIONS.reduce((total, position) => {
          const playerId = assignments[team.id]?.[position] ?? null;
          const player = playerId ? playersById.get(playerId) ?? null : null;
          return total + (player?.attributes[attribute.key] ?? 0);
          }, 0)
        );

        return {
          key: attribute.key,
          label: attribute.label,
          value,
          variant: "attribute"
        };
      });

      if (group.tone === "misc") {
        const chemistryBonus = buildTeamChemistryBonusTotal(assignments, playersById, team.id);
        if (chemistryBonus > 0) {
          segments.push({
            key: "chemistry",
            label: "Chemistry",
            value: chemistryBonus,
            variant: "chemistry"
          });
        }
      }

      return {
        team,
        total: roundChartValue(segments.reduce((sum, segment) => sum + segment.value, 0)),
        segments
      };
    });

    return {
      label: group.label,
      tone: group.tone,
      maxTotal: group.tone === "misc" ? SCENARIO_CHART_MAX_TOTAL + TEAM_CHEMISTRY_MAX_ABS : SCENARIO_CHART_MAX_TOTAL,
      stacks
    };
  });
}

function getChartTeamLabelLines(name: string) {
  const words = name.trim().split(/\s+/);
  if (words.length <= 1) {
    return [name];
  }

  return [words[0], words.slice(1).join(" ")];
}

function getChartSegmentColor(teamColor: string, index: number) {
  const tintStrength = [92, 82, 72][index] ?? 72;
  return `color-mix(in srgb, ${teamColor} ${tintStrength}%, white ${100 - tintStrength}%)`;
}

function getScenarioChartSegmentBackground(
  teamColor: string,
  index: number,
  variant: "attribute" | "chemistry" | undefined
) {
  if (variant === "chemistry") {
    return "var(--chemistry-stack)";
  }

  return getChartSegmentColor(teamColor, index);
}

function cloneAssignments(assignments: Assignments): Assignments {
  return Object.fromEntries(
    Object.entries(assignments).map(([teamId, slots]) => [teamId, { ...slots }])
  );
}

function reconcileAssignmentsToTeams(assignments: Assignments, teams: Team[]) {
  const nextAssignments = createEmptyAssignments(teams);

  for (const team of teams) {
    const currentTeamAssignments = assignments[team.id];
    if (!currentTeamAssignments) {
      continue;
    }

    for (const position of POSITIONS) {
      nextAssignments[team.id][position] = currentTeamAssignments[position] ?? null;
    }
  }

  return nextAssignments;
}

function reconcileScenariosToTeams(scenarios: Scenario[], teams: Team[]) {
  return scenarios.map((scenario) => ({
    ...scenario,
    assignments: reconcileAssignmentsToTeams(scenario.assignments, teams)
  }));
}

function shuffleArray<T>(items: T[]) {
  const next = [...items];

  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }

  return next;
}

function countFilledAssignments(assignments: Assignments) {
  return Object.values(assignments).reduce(
    (sum, slots) =>
      sum + POSITIONS.reduce((slotSum, position) => slotSum + (slots[position] !== null ? 1 : 0), 0),
    0
  );
}

function randomizeRemainingAssignments(
  assignments: Assignments,
  teams: Team[],
  availablePlayers: Player[],
  maxAttempts: number
) {
  const emptySlots = teams.flatMap((team) =>
    POSITIONS.filter((position) => (assignments[team.id]?.[position] ?? null) === null).map((position) => ({
      teamId: team.id,
      position
    }))
  );

  if (emptySlots.length === 0 || availablePlayers.length === 0) {
    return assignments;
  }

  let bestAssignments = assignments;
  let bestScore = countFilledAssignments(assignments);

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const nextAssignments = cloneAssignments(assignments);
    const remainingPlayers = shuffleArray(availablePlayers);
    const slotOrder = shuffleArray(emptySlots).sort((left, right) => {
      const leftCount = availablePlayers.filter((player) => player.positions.includes(left.position)).length;
      const rightCount = availablePlayers.filter((player) =>
        player.positions.includes(right.position)
      ).length;
      return leftCount - rightCount;
    });

    for (const slot of slotOrder) {
      const eligiblePlayers = remainingPlayers.filter((player) => player.positions.includes(slot.position));
      if (eligiblePlayers.length === 0) {
        continue;
      }

      const selectedPlayer =
        eligiblePlayers[Math.floor(Math.random() * eligiblePlayers.length)] ?? null;

      if (!selectedPlayer) {
        continue;
      }

      nextAssignments[slot.teamId][slot.position] = selectedPlayer.id;
      const selectedIndex = remainingPlayers.findIndex((player) => player.id === selectedPlayer.id);
      if (selectedIndex >= 0) {
        remainingPlayers.splice(selectedIndex, 1);
      }
    }

    const nextScore = countFilledAssignments(nextAssignments);
    if (nextScore > bestScore) {
      bestAssignments = nextAssignments;
      bestScore = nextScore;
    }
  }

  return bestAssignments;
}

function getNextTeamDefaultName(teams: Team[]) {
  return `Team ${teams.length + 1}`;
}

function getNextTeamDefaultColor(teams: Team[]) {
  const usedColors = new Set(teams.map((team) => normalizeTeamColor(team.color).toLowerCase()));
  return (
    TEAM_COLOR_PALETTE.find((color) => !usedColors.has(color.toLowerCase())) ??
    TEAM_COLOR_PALETTE[teams.length % TEAM_COLOR_PALETTE.length]
  );
}

function createTeam(teamIndex: number, currentTeams: Team[], runSlug: string): Team {
  return {
    id: `${runSlug.toLowerCase()}-team-${createScenarioId()}`,
    name: getNextTeamDefaultName(currentTeams),
    color: getNextTeamDefaultColor(currentTeams),
    displayOrder: teamIndex + 1
  };
}

function buildTeamDrafts(teams: Team[]): Record<string, TeamDraft> {
  return Object.fromEntries(
    teams.map((team, index) => [
      team.id,
      {
        name: team.name,
        color: normalizeTeamColor(team.color, TEAM_COLOR_PALETTE[index] ?? TEAM_COLOR_PALETTE[0])
      }
    ])
  );
}

function getTeamNameErrors(teams: Team[]) {
  const counts = new Map<string, number>();

  for (let index = 0; index < teams.length; index += 1) {
    const key = teams[index].name.trim().toLowerCase();
    if (!key) {
      continue;
    }

    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return teams.map((team, index) => {
    const trimmedName = team.name.trim();
    if (!trimmedName) {
      return `Team ${index + 1} needs a name.`;
    }

    if ((counts.get(trimmedName.toLowerCase()) ?? 0) > 1) {
      return "Team names must be unique.";
    }

    return null;
  });
}

function getScenarioMetaSignature(scenarios: Scenario[], runId: string) {
  return JSON.stringify(scenariosToRows(scenarios, runId));
}

function getScenarioAssignmentSignature(assignments: Assignments) {
  return JSON.stringify(assignments);
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

function getPlayerPoolName(player: Player) {
  return player.name.trim() || `Player ${player.rowNumber}`;
}

function canPlayerAppearInPool(player: Player) {
  return player.active && Boolean(player.name.trim());
}

function canPlayerBeAssignedFromPool(player: Player) {
  return canPlayerAppearInPool(player) && player.positions.length > 0;
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
  const { run } = useRun();
  const { loading, players, retrySync, syncError: playerSyncError } = useTournamentBuilder();
  const cellRefs = useRef(new Map<string, HTMLDivElement>());
  const wrapRefs = useRef(new Map<string, HTMLDivElement>());
  const chipRefs = useRef(new Map<string, HTMLDivElement>());
  const poolRefs = useRef(new Map<string, HTMLDivElement>());
  const scenarioCardRefs = useRef(new Map<string, HTMLElement>());
  const scenarioRectsRef = useRef(new Map<string, DOMRect>());
  const previewTargetRef = useRef<ScenarioSlot | null>(null);
  const poolHoverRef = useRef<string | null>(null);
  const defaultInitialTeam = useMemo(() => createTeam(0, [], run.slug), [run.slug]);
  const initialTeams = useMemo(() => [defaultInitialTeam], [defaultInitialTeam]);
  const storageKey = useMemo(
    () => buildRunScopedStorageKey(TEAM_SCENARIOS_STORAGE_KEY, run.slug),
    [run.slug]
  );
  const latestTeamsRef = useRef<Team[]>(initialTeams);
  const lastSyncedTeamSignatureRef = useRef(JSON.stringify(teamsToRows(latestTeamsRef.current, run.id)));
  const pendingTeamsRef = useRef<Team[] | null>(null);
  const teamSyncInFlightRef = useRef(false);
  const suppressTeamRealtimeRef = useRef(false);
  const teamRefreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const teamRefreshInFlightRef = useRef(false);
  const teamRefreshQueuedRef = useRef(false);
  const teamSyncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const teamColorCommitTimeoutsRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const teamDraftsRef = useRef<Record<string, TeamDraft>>(buildTeamDrafts(latestTeamsRef.current));
  const latestScenariosRef = useRef<Scenario[]>([createScenario(1, latestTeamsRef.current)]);
  const lastSyncedScenarioMetaSignatureRef = useRef(
    getScenarioMetaSignature(latestScenariosRef.current, run.id)
  );
  const lastSyncedScenarioAssignmentSignaturesRef = useRef(
    new Map(
      latestScenariosRef.current.map((scenario) => [
        scenario.id,
        getScenarioAssignmentSignature(scenario.assignments)
      ])
    )
  );
  const pendingScenarioMetaRef = useRef<Scenario[] | null>(null);
  const pendingScenarioAssignmentsRef = useRef<Scenario[] | null>(null);
  const dirtyScenarioAssignmentIdsRef = useRef(new Set<string>());
  const scenarioMetaSyncInFlightRef = useRef(false);
  const scenarioAssignmentSyncInFlightRef = useRef(false);
  const suppressScenarioRealtimeRef = useRef(false);
  const scenarioRefreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scenarioRefreshInFlightRef = useRef(false);
  const scenarioRefreshQueuedRef = useRef(false);
  const scenarioMetaSyncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scenarioAssignmentSyncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [teams, setTeams] = useState<Team[]>(latestTeamsRef.current);
  const [teamDrafts, setTeamDrafts] = useState<Record<string, TeamDraft>>(
    buildTeamDrafts(latestTeamsRef.current)
  );
  const [scenarios, setScenarios] = useState<Scenario[]>([createScenario(1, latestTeamsRef.current)]);
  const [nextScenarioNumber, setNextScenarioNumber] = useState(2);
  const [storageHydrated, setStorageHydrated] = useState(false);
  const [bootstrapSyncRequestVersion, setBootstrapSyncRequestVersion] = useState(0);
  const [teamSyncError, setTeamSyncError] = useState<string | null>(null);
  const [scenarioSyncError, setScenarioSyncError] = useState<string | null>(null);
  const [randomizingScenarioId, setRandomizingScenarioId] = useState<string | null>(null);
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
  const [scenarioPendingDeleteId, setScenarioPendingDeleteId] = useState<string | null>(null);

  const playerById = useMemo(
    () => new Map(players.map((player) => [player.id, player])),
    [players]
  );

  const scenarioById = useMemo(
    () => new Map(scenarios.map((scenario) => [scenario.id, scenario])),
    [scenarios]
  );

  const draftTeams = useMemo(
    () =>
      teams.map((team, index) => ({
        ...team,
        name: teamDrafts[team.id]?.name ?? team.name,
        color:
          teamDrafts[team.id]?.color ??
          normalizeTeamColor(team.color, TEAM_COLOR_PALETTE[index] ?? TEAM_COLOR_PALETTE[0])
      })),
    [teamDrafts, teams]
  );

  const teamNameErrors = useMemo(() => getTeamNameErrors(draftTeams), [draftTeams]);
  const hasCommittedTeamValidationError = useMemo(
    () => getTeamNameErrors(teams).some((error) => error !== null),
    [teams]
  );

  useEffect(() => {
    latestTeamsRef.current = teams;
  }, [teams]);

  useEffect(() => {
    setTeamDrafts(buildTeamDrafts(teams));
  }, [teams]);

  useEffect(() => {
    teamDraftsRef.current = teamDrafts;
  }, [teamDrafts]);

  useEffect(() => {
    latestScenariosRef.current = scenarios;
  }, [scenarios]);

  const syncTeamRefFromSnapshot = useCallback((snapshot: Team[]) => {
    lastSyncedTeamSignatureRef.current = JSON.stringify(teamsToRows(snapshot, run.id));
  }, [run.id]);

  const syncScenarioRefsFromSnapshot = useCallback((snapshot: Scenario[]) => {
    lastSyncedScenarioMetaSignatureRef.current = getScenarioMetaSignature(snapshot, run.id);
    lastSyncedScenarioAssignmentSignaturesRef.current = new Map(
      snapshot.map((scenario) => [
        scenario.id,
        getScenarioAssignmentSignature(scenario.assignments)
      ])
    );
  }, [run.id]);

  useEffect(() => {
    let cancelled = false;
    const storedState = parseStoredScenarioState(
      window.localStorage.getItem(storageKey) ??
        (run.slug === DEFAULT_RUN_SLUG ? window.localStorage.getItem(TEAM_SCENARIOS_STORAGE_KEY) : null)
    );
    const storedTeams = storedState?.teams?.length ? normalizeTeams(storedState.teams) : [];

    if (storedState && storedState.scenarios.length > 0) {
      const initialStoredTeams = storedTeams.length > 0 ? storedTeams : [createTeam(0, [], run.slug)];
      const normalizedScenarios = reconcileScenariosToTeams(
        normalizeScenarioIds(storedState.scenarios).map((scenario) => ({
          ...scenario,
          collapsed: scenario.collapsed ?? false
        })),
        initialStoredTeams
      );
      setTeams(initialStoredTeams);
      setScenarios(normalizedScenarios);
      setNextScenarioNumber(
        Math.max(
          storedState.nextScenarioNumber ?? normalizedScenarios.length + 1,
          getNextScenarioNumber(normalizedScenarios)
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
        const [{ data: teamRows, error: teamError }, { data: scenarioRows, error: scenarioError }] =
          await Promise.all([
            supabase
              .from("teams")
              .select(TEAM_SELECT_COLUMNS)
              .eq("run_id", run.id)
              .order("display_order", {
                ascending: true
              }),
            supabase
              .from("team_scenarios")
              .select(TEAM_SCENARIO_SELECT_COLUMNS)
              .eq("run_id", run.id)
              .order("sort_order", {
                ascending: true
              })
          ]);

        if (teamError) {
          throw teamError;
        }

        if (scenarioError) {
          throw scenarioError;
        }

        const scenarioIds = (scenarioRows ?? []).map((scenario) => scenario.id);
        const assignmentResult =
          scenarioIds.length > 0
            ? await supabase
                .from("scenario_assignments")
                .select("scenario_id,team_id,position,player_id")
                .in("scenario_id", scenarioIds)
                .order("scenario_id", { ascending: true })
            : { data: [], error: null };

        if (assignmentResult.error) {
          throw assignmentResult.error;
        }

        const backendTeams = teamsFromRows(teamRows ?? [], storedTeams);
        const backendScenarios = buildScenarioState(
          scenarioRows ?? [],
          assignmentResult.data ?? [],
          storedState?.scenarios ?? [],
          backendTeams
        );

        if (cancelled) {
          return;
        }

        if (
          storedState &&
          storedState.scenarios.length > 0 &&
          (scenarioRows?.length ?? 0) === 0 &&
          (teamRows?.length ?? 0) === 0
        ) {
          const migratedTeams = storedTeams.length > 0 ? storedTeams : [createTeam(0, [], run.slug)];
          const migratedScenarios = reconcileScenariosToTeams(
            normalizeScenarioIds(storedState.scenarios),
            migratedTeams
          );
          setTeams(migratedTeams);
          setScenarios(migratedScenarios);
          setNextScenarioNumber(
            Math.max(
              storedState.nextScenarioNumber ?? migratedScenarios.length + 1,
              getNextScenarioNumber(migratedScenarios)
            )
          );
          pendingTeamsRef.current = migratedTeams;
          pendingScenarioMetaRef.current = migratedScenarios;
          pendingScenarioAssignmentsRef.current = migratedScenarios;
          dirtyScenarioAssignmentIdsRef.current = new Set(
            migratedScenarios.map((scenario) => scenario.id)
          );
          suppressTeamRealtimeRef.current = true;
          suppressScenarioRealtimeRef.current = true;
          setTeamSyncError("Migrating local team setup to Supabase.");
          setScenarioSyncError("Migrating local scenarios to Supabase.");
          setBootstrapSyncRequestVersion((current) => current + 1);
          return;
        }

        if (backendTeams.length === 0 && (scenarioRows?.length ?? 0) === 0) {
          const seededTeams = [createTeam(0, [], run.slug)];
          const seededScenarios = [createScenario(1, seededTeams)];
          setTeams(seededTeams);
          setScenarios(seededScenarios);
          setNextScenarioNumber(getNextScenarioNumber(seededScenarios));
          pendingTeamsRef.current = seededTeams;
          pendingScenarioMetaRef.current = seededScenarios;
          pendingScenarioAssignmentsRef.current = seededScenarios;
          dirtyScenarioAssignmentIdsRef.current = new Set(
            seededScenarios.map((scenario) => scenario.id)
          );
          setTeamSyncError("Creating default team setup for this run.");
          setScenarioSyncError("Creating default scenario setup for this run.");
          suppressTeamRealtimeRef.current = true;
          suppressScenarioRealtimeRef.current = true;
          setBootstrapSyncRequestVersion((current) => current + 1);
          return;
        }

        const nextTeams = backendTeams.length > 0 ? backendTeams : [createTeam(0, [], run.slug)];
        const nextScenarios =
          backendScenarios.length > 0 ? backendScenarios : [createScenario(1, nextTeams)];
        setTeams(nextTeams);
        setScenarios(nextScenarios);
        setNextScenarioNumber(getNextScenarioNumber(nextScenarios));
        syncTeamRefFromSnapshot(nextTeams);
        syncScenarioRefsFromSnapshot(nextScenarios);

        setTeamSyncError(null);
        setScenarioSyncError(null);
        suppressTeamRealtimeRef.current = false;
        suppressScenarioRealtimeRef.current = false;
      } catch {
        if (!cancelled) {
          setTeamSyncError("Unable to load teams from Supabase. Using local data.");
          setScenarioSyncError("Unable to load scenarios from Supabase. Using local data.");
        }
      }
    }

    void loadScenariosFromSupabase();

    return () => {
      cancelled = true;
    };
  }, [run.id, run.slug, storageKey, syncScenarioRefsFromSnapshot, syncTeamRefFromSnapshot]);

  useEffect(() => {
    if (!storageHydrated) {
      return;
    }

    window.localStorage.setItem(
      storageKey,
      JSON.stringify({
        nextScenarioNumber,
        scenarios,
        teams
      } satisfies PersistedScenarioState)
    );
  }, [nextScenarioNumber, scenarios, storageHydrated, storageKey, teams]);

  const flushTeamSync = useCallback(async () => {
    if (!hasSupabaseBrowserConfig() || teamSyncInFlightRef.current) {
      return;
    }

    const snapshot = pendingTeamsRef.current;
    if (!snapshot) {
      return;
    }

    teamSyncInFlightRef.current = true;

    while (pendingTeamsRef.current) {
      const nextSnapshot = pendingTeamsRef.current;
      pendingTeamsRef.current = null;

      try {
        const supabase = getSupabaseBrowserClient();
        const teamRows = teamsToRows(nextSnapshot, run.id);
        const teamIds = nextSnapshot.map((team) => team.id);

        const { data: existingTeamRows, error: existingTeamsError } = await supabase
          .from("teams")
          .select("id")
          .eq("run_id", run.id);
        if (existingTeamsError) {
          throw existingTeamsError;
        }

        const staleTeamIds = (existingTeamRows ?? [])
          .map((row) => row.id)
          .filter((id) => !teamIds.includes(id));

        if (staleTeamIds.length > 0) {
          const { error: deleteStaleAssignmentsError } = await supabase
            .from("scenario_assignments")
            .delete()
            .in("team_id", staleTeamIds);
          if (deleteStaleAssignmentsError) {
            throw deleteStaleAssignmentsError;
          }

          const { error: deleteStaleTeamsError } = await supabase
            .from("teams")
            .delete()
            .eq("run_id", run.id)
            .in("id", staleTeamIds);
          if (deleteStaleTeamsError) {
            throw deleteStaleTeamsError;
          }
        }

        const { error: upsertTeamsError } = await supabase
          .from("teams")
          .upsert(teamRows, { onConflict: "id" });
        if (upsertTeamsError) {
          throw upsertTeamsError;
        }

        syncTeamRefFromSnapshot(nextSnapshot);
        setTeamSyncError(null);
        suppressTeamRealtimeRef.current = false;
      } catch {
        pendingTeamsRef.current = latestTeamsRef.current;
        setTeamSyncError("Changes saved locally. Team backend sync failed.");
        suppressTeamRealtimeRef.current = true;
        break;
      }
    }

    teamSyncInFlightRef.current = false;
  }, [run.id, syncTeamRefFromSnapshot]);

  const flushScenarioMetaSync = useCallback(async () => {
    if (!hasSupabaseBrowserConfig() || scenarioMetaSyncInFlightRef.current) {
      return;
    }

    const snapshot = pendingScenarioMetaRef.current;
    if (!snapshot) {
      return;
    }

    scenarioMetaSyncInFlightRef.current = true;

    while (pendingScenarioMetaRef.current) {
      const nextSnapshot = pendingScenarioMetaRef.current;
      pendingScenarioMetaRef.current = null;

      try {
        const supabase = getSupabaseBrowserClient();
        const scenarioRows = scenariosToRows(nextSnapshot, run.id);
        const scenarioIds = nextSnapshot.map((scenario) => scenario.id);

        const { error: upsertScenariosError } = await supabase
          .from("team_scenarios")
          .upsert(scenarioRows, { onConflict: "id" });
        if (upsertScenariosError) {
          throw upsertScenariosError;
        }

        const { data: existingScenarioRows, error: existingScenariosError } = await supabase
          .from("team_scenarios")
          .select("id")
          .eq("run_id", run.id);
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
            .eq("run_id", run.id)
            .in("id", staleScenarioIds);
          if (deleteOldScenarioRowsError) {
            throw deleteOldScenarioRowsError;
          }
        }

        lastSyncedScenarioMetaSignatureRef.current = getScenarioMetaSignature(nextSnapshot, run.id);
        setScenarioSyncError(null);
        suppressScenarioRealtimeRef.current = false;
      } catch {
        pendingScenarioMetaRef.current = latestScenariosRef.current;
        setScenarioSyncError("Changes saved locally. Scenario backend sync failed.");
        suppressScenarioRealtimeRef.current = true;
        break;
      }
    }

    scenarioMetaSyncInFlightRef.current = false;
  }, [run.id, syncScenarioRefsFromSnapshot]);

  const flushScenarioAssignmentsSync = useCallback(async () => {
    if (!hasSupabaseBrowserConfig() || scenarioAssignmentSyncInFlightRef.current) {
      return;
    }

    if (pendingTeamsRef.current || teamSyncInFlightRef.current) {
      await flushTeamSync();
      if (pendingTeamsRef.current || teamSyncInFlightRef.current) {
        return;
      }
    }

    if (pendingScenarioMetaRef.current || scenarioMetaSyncInFlightRef.current) {
      await flushScenarioMetaSync();
      if (pendingScenarioMetaRef.current || scenarioMetaSyncInFlightRef.current) {
        return;
      }
    }

    const snapshot = pendingScenarioAssignmentsRef.current;
    if (!snapshot || dirtyScenarioAssignmentIdsRef.current.size === 0) {
      return;
    }

    scenarioAssignmentSyncInFlightRef.current = true;

    while (pendingScenarioAssignmentsRef.current && dirtyScenarioAssignmentIdsRef.current.size > 0) {
      const nextSnapshot = pendingScenarioAssignmentsRef.current;
      const dirtyScenarioIds = Array.from(dirtyScenarioAssignmentIdsRef.current);
      pendingScenarioAssignmentsRef.current = null;
      dirtyScenarioAssignmentIdsRef.current = new Set();

      try {
        const supabase = getSupabaseBrowserClient();
        const snapshotByScenarioId = new Map(
          nextSnapshot.map((scenario) => [scenario.id, scenario] as const)
        );
        const assignmentRows = dirtyScenarioIds.flatMap((scenarioId) => {
          const scenario = snapshotByScenarioId.get(scenarioId);
          return scenario ? scenarioAssignmentsToRows(scenario.id, scenario.assignments) : [];
        });

        const { error: deleteAssignmentsError } = await supabase
          .from("scenario_assignments")
          .delete()
          .in("scenario_id", dirtyScenarioIds);
        if (deleteAssignmentsError) {
          throw deleteAssignmentsError;
        }

        if (assignmentRows.length > 0) {
          const { error: insertAssignmentsError } = await supabase
            .from("scenario_assignments")
            .insert(assignmentRows);
          if (insertAssignmentsError) {
            throw insertAssignmentsError;
          }
        }

        const nextAssignmentSignatures = new Map(lastSyncedScenarioAssignmentSignaturesRef.current);
        for (const scenarioId of dirtyScenarioIds) {
          const scenario = snapshotByScenarioId.get(scenarioId);
          if (scenario) {
            nextAssignmentSignatures.set(
              scenarioId,
              getScenarioAssignmentSignature(scenario.assignments)
            );
          } else {
            nextAssignmentSignatures.delete(scenarioId);
          }
        }
        lastSyncedScenarioAssignmentSignaturesRef.current = nextAssignmentSignatures;
        setScenarioSyncError(null);
        suppressScenarioRealtimeRef.current = false;
      } catch {
        pendingScenarioAssignmentsRef.current = latestScenariosRef.current;
        dirtyScenarioAssignmentIdsRef.current = new Set([
          ...dirtyScenarioIds,
          ...dirtyScenarioAssignmentIdsRef.current
        ]);
        setScenarioSyncError("Changes saved locally. Scenario backend sync failed.");
        suppressScenarioRealtimeRef.current = true;
        break;
      }
    }

    scenarioAssignmentSyncInFlightRef.current = false;
  }, [flushScenarioMetaSync, flushTeamSync]);

  const flushPendingTeamScenarioSync = useCallback(async () => {
    await flushTeamSync();
    await flushScenarioMetaSync();
    await flushScenarioAssignmentsSync();
  }, [flushScenarioAssignmentsSync, flushScenarioMetaSync, flushTeamSync]);

  const scheduleTeamSync = useCallback(
    (immediate = false) => {
      if (!hasSupabaseBrowserConfig()) {
        return;
      }

      if (teamSyncTimeoutRef.current) {
        clearTimeout(teamSyncTimeoutRef.current);
        teamSyncTimeoutRef.current = null;
      }

      if (immediate) {
        void flushTeamSync();
        return;
      }

      teamSyncTimeoutRef.current = setTimeout(() => {
        teamSyncTimeoutRef.current = null;
        void flushTeamSync();
      }, TEAM_SYNC_DEBOUNCE_MS);
    },
    [flushTeamSync]
  );

  const scheduleScenarioMetaSync = useCallback(
    (immediate = false) => {
      if (!hasSupabaseBrowserConfig()) {
        return;
      }

      if (scenarioMetaSyncTimeoutRef.current) {
        clearTimeout(scenarioMetaSyncTimeoutRef.current);
        scenarioMetaSyncTimeoutRef.current = null;
      }

      if (immediate) {
        void flushScenarioMetaSync();
        return;
      }

      scenarioMetaSyncTimeoutRef.current = setTimeout(() => {
        scenarioMetaSyncTimeoutRef.current = null;
        void flushScenarioMetaSync();
      }, SCENARIO_SYNC_DEBOUNCE_MS);
    },
    [flushScenarioMetaSync]
  );

  const scheduleScenarioAssignmentsSync = useCallback(
    (immediate = false) => {
      if (!hasSupabaseBrowserConfig()) {
        return;
      }

      if (scenarioAssignmentSyncTimeoutRef.current) {
        clearTimeout(scenarioAssignmentSyncTimeoutRef.current);
        scenarioAssignmentSyncTimeoutRef.current = null;
      }

      if (immediate) {
        void flushScenarioAssignmentsSync();
        return;
      }

      scenarioAssignmentSyncTimeoutRef.current = setTimeout(() => {
        scenarioAssignmentSyncTimeoutRef.current = null;
        void flushScenarioAssignmentsSync();
      }, SCENARIO_SYNC_DEBOUNCE_MS);
    },
    [flushScenarioAssignmentsSync]
  );

  const queueTeamSync = useCallback(
    (snapshot: Team[], options?: { immediate?: boolean }) => {
      if (!hasSupabaseBrowserConfig()) {
        return;
      }

      const nextSignature = JSON.stringify(teamsToRows(snapshot, run.id));
      if (nextSignature === lastSyncedTeamSignatureRef.current) {
        pendingTeamsRef.current = null;
        return;
      }

      pendingTeamsRef.current = snapshot;
      scheduleTeamSync(options?.immediate ?? false);
    },
    [run.id, scheduleTeamSync]
  );

  const queueScenarioMetaSync = useCallback(
    (snapshot: Scenario[], options?: { immediate?: boolean }) => {
      if (!hasSupabaseBrowserConfig()) {
        return;
      }

      if (getScenarioMetaSignature(snapshot, run.id) === lastSyncedScenarioMetaSignatureRef.current) {
        pendingScenarioMetaRef.current = null;
        return;
      }

      pendingScenarioMetaRef.current = snapshot;
      scheduleScenarioMetaSync(options?.immediate ?? false);
    },
    [scheduleScenarioMetaSync]
  );

  const queueScenarioAssignmentsSync = useCallback(
    (snapshot: Scenario[], dirtyScenarioIds: string[], options?: { immediate?: boolean }) => {
      if (!hasSupabaseBrowserConfig()) {
        return;
      }

      const nextDirtyScenarioIds = dirtyScenarioIds.filter((scenarioId) => {
        const scenario = snapshot.find((candidate) => candidate.id === scenarioId);
        const nextSignature = scenario
          ? getScenarioAssignmentSignature(scenario.assignments)
          : null;
        const previousSignature =
          lastSyncedScenarioAssignmentSignaturesRef.current.get(scenarioId) ?? null;
        return nextSignature !== previousSignature;
      });

      if (nextDirtyScenarioIds.length === 0) {
        return;
      }

      pendingScenarioAssignmentsRef.current = snapshot;
      for (const scenarioId of nextDirtyScenarioIds) {
        dirtyScenarioAssignmentIdsRef.current.add(scenarioId);
      }
      scheduleScenarioAssignmentsSync(options?.immediate ?? false);
    },
    [scheduleScenarioAssignmentsSync]
  );

  useEffect(() => {
    if (!hasSupabaseBrowserConfig()) {
      return undefined;
    }

    const handleRetry = () => {
      if (pendingTeamsRef.current || pendingScenarioMetaRef.current || pendingScenarioAssignmentsRef.current) {
        void flushPendingTeamScenarioSync();
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        void flushPendingTeamScenarioSync();
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
  }, [flushPendingTeamScenarioSync]);

  useEffect(() => {
    if (
      storageHydrated &&
      (pendingTeamsRef.current || pendingScenarioMetaRef.current || pendingScenarioAssignmentsRef.current)
    ) {
      void flushPendingTeamScenarioSync();
    }
  }, [bootstrapSyncRequestVersion, flushPendingTeamScenarioSync, storageHydrated]);

  useEffect(
    () => () => {
      for (const timeout of teamColorCommitTimeoutsRef.current.values()) {
        clearTimeout(timeout);
      }
      teamColorCommitTimeoutsRef.current.clear();
      if (teamSyncTimeoutRef.current) {
        clearTimeout(teamSyncTimeoutRef.current);
      }
      if (scenarioMetaSyncTimeoutRef.current) {
        clearTimeout(scenarioMetaSyncTimeoutRef.current);
      }
      if (scenarioAssignmentSyncTimeoutRef.current) {
        clearTimeout(scenarioAssignmentSyncTimeoutRef.current);
      }
    },
    []
  );

  useEffect(() => {
    if (loading) {
      return;
    }

    setScenarios((current) => {
      const dirtyScenarioIds: string[] = [];
      const nextScenarios = current.map((scenario) => {
        const nextAssignments = pruneAssignments(players, scenario.assignments);
        if (!areAssignmentsEqual(nextAssignments, scenario.assignments)) {
          dirtyScenarioIds.push(scenario.id);
          return {
            ...scenario,
            assignments: nextAssignments
          };
        }

        return scenario;
      });

      if (dirtyScenarioIds.length === 0) {
        return current;
      }

      if (dirtyScenarioIds.length > 0) {
        queueScenarioAssignmentsSync(nextScenarios, dirtyScenarioIds);
      }

      return nextScenarios;
    });
  }, [loading, players, queueScenarioAssignmentsSync, scenarios]);

  useEffect(() => {
    if (!hasSupabaseBrowserConfig()) {
      return undefined;
    }

    const supabase = getSupabaseBrowserClient();
    let active = true;
    let channel: RealtimeChannel | null = null;
    const runRefresh = async () => {
      if (suppressScenarioRealtimeRef.current) {
        return;
      }

      if (scenarioRefreshInFlightRef.current) {
        scenarioRefreshQueuedRef.current = true;
        return;
      }

      scenarioRefreshInFlightRef.current = true;

      try {
        const { data: scenarioRows, error: scenarioError } = await supabase
          .from("team_scenarios")
          .select(TEAM_SCENARIO_SELECT_COLUMNS)
          .eq("run_id", run.id)
          .order("sort_order", {
            ascending: true
          });

        if (scenarioError) {
          throw scenarioError;
        }

        const scenarioIds = (scenarioRows ?? []).map((scenario) => scenario.id);
        const assignmentResult =
          scenarioIds.length > 0
            ? await supabase
                .from("scenario_assignments")
                .select("scenario_id,team_id,position,player_id")
                .in("scenario_id", scenarioIds)
                .order("scenario_id", { ascending: true })
            : { data: [], error: null };

        if (assignmentResult.error) {
          throw assignmentResult.error;
        }

        const backendScenarios = buildScenarioState(
          scenarioRows ?? [],
          assignmentResult.data ?? [],
          latestScenariosRef.current,
          latestTeamsRef.current
        );

        if (!active) {
          return;
        }

        const nextScenarios =
          backendScenarios.length > 0
            ? backendScenarios
            : [createScenario(1, latestTeamsRef.current)];
        setScenarios((current) => (areScenariosEquivalent(current, nextScenarios) ? current : nextScenarios));
        setNextScenarioNumber(getNextScenarioNumber(nextScenarios));
        syncScenarioRefsFromSnapshot(nextScenarios);
        setScenarioSyncError((current) =>
          current === "Unable to load scenarios from Supabase. Using local data." ? null : current
        );
      } catch {
        if (active) {
          setScenarioSyncError("Unable to refresh scenarios from Supabase. Using local data.");
        }
      } finally {
        scenarioRefreshInFlightRef.current = false;

        if (scenarioRefreshQueuedRef.current && active) {
          scenarioRefreshQueuedRef.current = false;
          void runRefresh();
        }
      }
    };

    const scheduleRefresh = () => {
      if (suppressScenarioRealtimeRef.current) {
        return;
      }

      if (scenarioRefreshTimeoutRef.current) {
        clearTimeout(scenarioRefreshTimeoutRef.current);
      }

      scenarioRefreshTimeoutRef.current = setTimeout(() => {
        scenarioRefreshTimeoutRef.current = null;
        void runRefresh();
      }, 150);
    };

    channel = supabase
      .channel(`tcb-scenarios-${run.slug}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "team_scenarios" }, () => {
        scheduleRefresh();
      })
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "scenario_assignments" },
        () => {
          scheduleRefresh();
        }
      )
      .subscribe();

    return () => {
      active = false;
      if (scenarioRefreshTimeoutRef.current) {
        clearTimeout(scenarioRefreshTimeoutRef.current);
        scenarioRefreshTimeoutRef.current = null;
      }
      if (channel) {
        void supabase.removeChannel(channel);
      }
    };
  }, [run.id, run.slug, syncScenarioRefsFromSnapshot]);

  useEffect(() => {
    if (!hasSupabaseBrowserConfig()) {
      return undefined;
    }

    const supabase = getSupabaseBrowserClient();
    let active = true;
    let channel: RealtimeChannel | null = null;
    const runRefresh = async () => {
      if (suppressTeamRealtimeRef.current) {
        return;
      }

      if (teamRefreshInFlightRef.current) {
        teamRefreshQueuedRef.current = true;
        return;
      }

      teamRefreshInFlightRef.current = true;

      try {
        const { data: teamRows, error: teamError } = await supabase
          .from("teams")
          .select(TEAM_SELECT_COLUMNS)
          .eq("run_id", run.id)
          .order("display_order", { ascending: true });

        if (teamError) {
          throw teamError;
        }

        const backendTeams = teamsFromRows(teamRows ?? [], latestTeamsRef.current);

        if (!active) {
          return;
        }

        setTeams((current) => (areTeamsEqual(current, backendTeams) ? current : backendTeams));
        setScenarios((current) => reconcileScenariosToTeams(current, backendTeams));
        syncTeamRefFromSnapshot(backendTeams);
        setTeamSyncError((current) =>
          current === "Unable to load teams from Supabase. Using local data." ? null : current
        );
      } catch {
        if (active) {
          setTeamSyncError("Unable to refresh teams from Supabase. Using local data.");
        }
      } finally {
        teamRefreshInFlightRef.current = false;

        if (teamRefreshQueuedRef.current && active) {
          teamRefreshQueuedRef.current = false;
          void runRefresh();
        }
      }
    };

    const scheduleRefresh = () => {
      if (suppressTeamRealtimeRef.current) {
        return;
      }

      if (teamRefreshTimeoutRef.current) {
        clearTimeout(teamRefreshTimeoutRef.current);
      }

      teamRefreshTimeoutRef.current = setTimeout(() => {
        teamRefreshTimeoutRef.current = null;
        void runRefresh();
      }, 150);
    };

    channel = supabase
      .channel(`tcb-teams-${run.slug}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "teams" }, () => {
        scheduleRefresh();
      })
      .subscribe();

    return () => {
      active = false;
      if (teamRefreshTimeoutRef.current) {
        clearTimeout(teamRefreshTimeoutRef.current);
        teamRefreshTimeoutRef.current = null;
      }
      if (channel) {
        void supabase.removeChannel(channel);
      }
    };
  }, [run.id, run.slug, syncTeamRefFromSnapshot]);

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
          if (!canPlayerAppearInPool(player)) {
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

  useEffect(() => {
    setSelectedAvailablePlayer((current) => {
      if (!current) {
        return current;
      }

      const scenarioPlayers = availablePlayersByScenario.get(current.scenarioId) ?? [];
      const selectedPlayer = scenarioPlayers.find((player) => player.id === current.playerId);
      return selectedPlayer && canPlayerBeAssignedFromPool(selectedPlayer) ? current : null;
    });
  }, [availablePlayersByScenario]);

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

  const updateTeamsState = useCallback(
    (
      updater: (teams: Team[]) => Team[],
      options?: { immediate?: boolean; skipSync?: boolean; syncScenarioAssignments?: boolean }
    ) => {
      setTeams((currentTeams) => {
        const nextTeams = normalizeTeams(updater(currentTeams), currentTeams);
        const currentTeamIds = currentTeams.map((team) => team.id).join("|");
        const nextTeamIds = nextTeams.map((team) => team.id).join("|");
        const shouldSyncScenarioAssignments =
          options?.syncScenarioAssignments ?? currentTeamIds !== nextTeamIds;

        setScenarios((currentScenarios) => {
          const nextScenarios = reconcileScenariosToTeams(currentScenarios, nextTeams);
          if (shouldSyncScenarioAssignments && nextScenarios.length > 0) {
            queueScenarioAssignmentsSync(
              nextScenarios,
              nextScenarios.map((scenario) => scenario.id),
              options
            );
          }
          return nextScenarios;
        });

        if (options?.skipSync) {
          return nextTeams;
        }

        if (!getTeamNameErrors(nextTeams).some((error) => error !== null)) {
          queueTeamSync(nextTeams, options);
        } else {
          pendingTeamsRef.current = null;
          if (teamSyncTimeoutRef.current) {
            clearTimeout(teamSyncTimeoutRef.current);
            teamSyncTimeoutRef.current = null;
          }
        }

        return nextTeams;
      });
    },
    [queueScenarioAssignmentsSync, queueTeamSync]
  );

  const updateTeamDraftName = useCallback((teamId: string, name: string) => {
    setTeamDrafts((currentDrafts) => ({
      ...currentDrafts,
      [teamId]: {
        name,
        color:
          currentDrafts[teamId]?.color ??
          normalizeTeamColor(
            latestTeamsRef.current.find((team) => team.id === teamId)?.color ?? TEAM_COLOR_PALETTE[0]
          )
      }
    }));
  }, []);

  const commitTeamName = useCallback(
    (teamId: string, options?: { immediate?: boolean }) => {
      const draftName = teamDraftsRef.current[teamId]?.name ?? "";
      const nextDraftTeams = latestTeamsRef.current.map((team, index) =>
        team.id === teamId
          ? {
              ...team,
              name: draftName,
              color:
                teamDraftsRef.current[team.id]?.color ??
                normalizeTeamColor(team.color, TEAM_COLOR_PALETTE[index] ?? TEAM_COLOR_PALETTE[0])
            }
          : {
              ...team,
              name: teamDraftsRef.current[team.id]?.name ?? team.name,
              color:
                teamDraftsRef.current[team.id]?.color ??
                normalizeTeamColor(team.color, TEAM_COLOR_PALETTE[index] ?? TEAM_COLOR_PALETTE[0])
            }
      );

      const nameErrors = getTeamNameErrors(nextDraftTeams);
      const teamIndex = nextDraftTeams.findIndex((team) => team.id === teamId);
      if (teamIndex === -1 || nameErrors[teamIndex]) {
        return;
      }

      updateTeamsState(
        (currentTeams) =>
          currentTeams.map((team) => (team.id === teamId ? { ...team, name: draftName } : team)),
        options
      );
    },
    [updateTeamsState]
  );

  const updateTeamDraftColor = useCallback((teamId: string, color: string) => {
    const normalizedColor = normalizeTeamColor(color);
    setTeamDrafts((currentDrafts) => ({
      ...currentDrafts,
      [teamId]: {
        name:
          currentDrafts[teamId]?.name ??
          latestTeamsRef.current.find((team) => team.id === teamId)?.name ??
          "",
        color: normalizedColor
      }
    }));
  }, []);

  const commitTeamColor = useCallback(
    (teamId: string, options?: { immediate?: boolean; skipSync?: boolean }) => {
      const draftColor = teamDraftsRef.current[teamId]?.color;
      if (!draftColor) {
        return;
      }

      updateTeamsState(
        (currentTeams) =>
          currentTeams.map((team) =>
            team.id === teamId ? { ...team, color: normalizeTeamColor(draftColor, team.color) } : team
          ),
        options
      );
    },
    [updateTeamsState]
  );

  const scheduleTeamColorScenarioCommit = useCallback(
    (teamId: string) => {
      const existingTimeout = teamColorCommitTimeoutsRef.current.get(teamId);
      if (existingTimeout) {
        clearTimeout(existingTimeout);
      }

      const timeout = setTimeout(() => {
        teamColorCommitTimeoutsRef.current.delete(teamId);
        commitTeamColor(teamId, { skipSync: true });
      }, TEAM_COLOR_SCENARIO_COMMIT_DELAY_MS);

      teamColorCommitTimeoutsRef.current.set(teamId, timeout);
    },
    [commitTeamColor]
  );

  const handleTeamColorChange = useCallback(
    (teamId: string, color: string) => {
      updateTeamDraftColor(teamId, color);
      scheduleTeamColorScenarioCommit(teamId);
    },
    [scheduleTeamColorScenarioCommit, updateTeamDraftColor]
  );

  const addTeam = useCallback(() => {
    updateTeamsState((currentTeams) => {
      if (currentTeams.length >= MAX_TEAMS) {
        return currentTeams;
      }

      return [
        ...currentTeams,
        createTeam(currentTeams.length, currentTeams, run.slug)
      ];
    });
  }, [run.slug, updateTeamsState]);

  const removeTeam = useCallback(
    (teamId: string) => {
      if (teams.length <= 1) {
        return;
      }

      setOpenPickerSlot((current) => (current?.slot.teamId === teamId ? null : current));
      setNearestSlot((current) =>
        current?.slot.teamId === teamId ? null : current
      );
      setPreviewTarget((current) =>
        current?.slot.teamId === teamId ? null : current
      );
      previewTargetRef.current =
        previewTargetRef.current?.slot.teamId === teamId ? null : previewTargetRef.current;

      updateTeamsState(
        (currentTeams) => currentTeams.filter((team) => team.id !== teamId),
        { immediate: true, syncScenarioAssignments: true }
      );
    },
    [teams.length, updateTeamsState]
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
      queueScenarioAssignmentsSync(nextScenarios, [scenarioId]);
      return nextScenarios;
    });
  };

  const updateScenarioTitle = (
    scenarioId: string,
    title: string,
    options?: { immediate?: boolean }
  ) => {
    setScenarios((current) => {
      const nextScenarios = current.map((scenario) =>
        scenario.id === scenarioId ? { ...scenario, title } : scenario
      );
      queueScenarioMetaSync(nextScenarios, options);
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
    if (!player || !player.active || !player.name.trim() || !player.positions.includes(slot.position)) {
      return;
    }

    updateScenarioAssignments(scenarioId, (assignments) => assignPlayerToSlot(assignments, playerId, slot));
  };

  const clearScenarioSlot = (scenarioId: string, slot: SlotDescriptor) => {
    updateScenarioAssignments(scenarioId, (assignments) => clearSlot(assignments, slot));
  };

  const resetScenarioAssignments = (scenarioId: string) => {
    setOpenPickerSlot(null);
    setSelectedAvailablePlayer((current) => (current?.scenarioId === scenarioId ? null : current));
    updateScenarioAssignments(scenarioId, () => createEmptyAssignments(teams));
  };

  const randomizeScenarioRemainingPlayers = (scenarioId: string) => {
    if (randomizingScenarioId) {
      return;
    }

    const scenario = scenarioById.get(scenarioId);
    const availablePlayers = (availablePlayersByScenario.get(scenarioId) ?? []).filter(
      canPlayerBeAssignedFromPool
    );
    if (!scenario || availablePlayers.length === 0) {
      return;
    }

    const hasEmptySlot = teams.some((team) =>
      POSITIONS.some((position) => (scenario.assignments[team.id]?.[position] ?? null) === null)
    );

    if (!hasEmptySlot) {
      return;
    }

    setRandomizingScenarioId(scenarioId);
    setOpenPickerSlot(null);
    setSelectedAvailablePlayer((current) => (current?.scenarioId === scenarioId ? null : current));

    window.setTimeout(() => {
      updateScenarioAssignments(scenarioId, (assignments) =>
        randomizeRemainingAssignments(assignments, teams, availablePlayers, 15)
      );
      setRandomizingScenarioId((current) => (current === scenarioId ? null : current));
    }, 0);
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
    const nextScenario = createScenario(nextScenarioNumber, teams);
    setScenarios((current) => {
      const nextScenarios = [...current, nextScenario];
      queueScenarioMetaSync(nextScenarios);
      return nextScenarios;
    });
    setNextScenarioNumber((current) => Math.max(current + 1, nextScenarioNumber + 1));
    setOpenPickerSlot(null);
    setSelectedAvailablePlayer(null);
  };

  const promptDeleteScenario = useCallback((scenarioId: string) => {
    if (dragState || scenarioReorder) {
      return;
    }

    setScenarioPendingDeleteId(scenarioId);
  }, [dragState, scenarioReorder]);

  const confirmDeleteScenario = useCallback(() => {
    if (!scenarioPendingDeleteId) {
      return;
    }

    const deletedScenarioId = scenarioPendingDeleteId;
    setScenarioPendingDeleteId(null);
    setOpenPickerSlot((current) => (current?.scenarioId === deletedScenarioId ? null : current));
    setSelectedAvailablePlayer((current) =>
      current?.scenarioId === deletedScenarioId ? null : current
    );
    setNearestSlot((current) => (current?.scenarioId === deletedScenarioId ? null : current));
    setPreviewTarget((current) => (current?.scenarioId === deletedScenarioId ? null : current));
    previewTargetRef.current =
      previewTargetRef.current?.scenarioId === deletedScenarioId ? null : previewTargetRef.current;
    setPoolDropScenarioId((current) => (current === deletedScenarioId ? null : current));
    poolHoverRef.current = poolHoverRef.current === deletedScenarioId ? null : poolHoverRef.current;

    setScenarios((current) => {
      const nextScenarios = current.filter((scenario) => scenario.id !== deletedScenarioId);
      queueScenarioMetaSync(nextScenarios, { immediate: true });
      queueScenarioAssignmentsSync(nextScenarios, [deletedScenarioId], { immediate: true });
      return nextScenarios;
    });
  }, [queueScenarioAssignmentsSync, queueScenarioMetaSync, scenarioPendingDeleteId]);

  useEffect(() => {
    if (!scenarioPendingDeleteId) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setScenarioPendingDeleteId(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [scenarioPendingDeleteId]);

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
        queueScenarioMetaSync(nextScenarios);
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
  }, [queueScenarioMetaSync, scenarioReorder, scenarios]);

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
        {hasCommittedTeamValidationError ? (
          <div className="status-chip error" role="status">
            Resolve duplicate or blank team names before syncing teams.
          </div>
        ) : null}
        {playerSyncError ? (
          <button type="button" className="status-chip error" onClick={retrySync}>
            {playerSyncError} Retry roster sync
          </button>
        ) : null}
        {teamSyncError ? (
          <button
            type="button"
            className="status-chip error"
            onClick={() => {
              if (latestTeamsRef.current && !hasCommittedTeamValidationError) {
                pendingTeamsRef.current = latestTeamsRef.current;
                void flushPendingTeamScenarioSync();
              }
            }}
          >
            {teamSyncError} Retry team sync
          </button>
        ) : null}
        {scenarioSyncError ? (
          <button
            type="button"
            className="status-chip error"
            onClick={() => {
              if (latestScenariosRef.current) {
                pendingScenarioMetaRef.current = latestScenariosRef.current;
                pendingScenarioAssignmentsRef.current = latestScenariosRef.current;
                dirtyScenarioAssignmentIdsRef.current = new Set(
                  latestScenariosRef.current.map((scenario) => scenario.id)
                );
                void flushPendingTeamScenarioSync();
              }
            }}
          >
            {scenarioSyncError} Retry scenario sync
          </button>
        ) : null}
      </div>
      <div className="scenario-stack">
        <section className="panel team-config-shell">
          <div className="team-config-header">
            <h2 className="team-config-title">Setup Teams</h2>
          </div>
          <div className="team-config-grid">
            {teams.map((team, index) => (
              <div key={team.id} className="team-config-card">
                <div className="team-config-card-head">
                  <span className="team-config-index">Team {index + 1}</span>
                  <button
                    type="button"
                    className="team-config-remove-button"
                    onClick={() => removeTeam(team.id)}
                    disabled={teams.length <= 1 || Boolean(dragState) || Boolean(scenarioReorder)}
                  >
                    Remove
                  </button>
                </div>
                <div className="team-config-name-row">
                  <input
                    type="text"
                    className={`team-config-name-input${teamNameErrors[index] ? " invalid" : ""}`}
                    value={teamDrafts[team.id]?.name ?? team.name}
                    onChange={(event) => updateTeamDraftName(team.id, event.target.value)}
                    onBlur={() => commitTeamName(team.id, { immediate: true })}
                    placeholder={`Team ${index + 1}`}
                    spellCheck={false}
                    disabled={Boolean(dragState) || Boolean(scenarioReorder)}
                  />
                  <label className="team-config-color-row">
                    <input
                      type="color"
                      className="team-config-color-input"
                      value={teamDrafts[team.id]?.color ?? normalizeTeamColor(team.color, TEAM_COLOR_PALETTE[index] ?? TEAM_COLOR_PALETTE[0])}
                      onChange={(event) => handleTeamColorChange(team.id, event.target.value)}
                      onBlur={() => {
                        const pendingTimeout = teamColorCommitTimeoutsRef.current.get(team.id);
                        if (pendingTimeout) {
                          clearTimeout(pendingTimeout);
                          teamColorCommitTimeoutsRef.current.delete(team.id);
                        }
                        commitTeamColor(team.id, { immediate: true });
                      }}
                      disabled={Boolean(dragState) || Boolean(scenarioReorder)}
                    />
                  </label>
                </div>
                {teamNameErrors[index] ? (
                  <div className="team-config-error">{teamNameErrors[index]}</div>
                ) : null}
              </div>
            ))}
            {teams.length < MAX_TEAMS ? (
              <div className="team-config-add-slot">
                <button
                  type="button"
                  className="team-config-add-button"
                  onClick={addTeam}
                  disabled={Boolean(dragState) || Boolean(scenarioReorder)}
                >
                  Add Team
                </button>
              </div>
            ) : null}
          </div>
        </section>
        {orderedScenarios.map((scenario) => {
          const displayedAssignments =
            displayedAssignmentsByScenario.get(scenario.id) ?? scenario.assignments;
          const scenarioCharts = buildScenarioAttributeCharts(scenario.assignments, playerById, teams);
          const availablePlayers = availablePlayersByScenario.get(scenario.id) ?? [];
          const hasAssignablePoolPlayers = availablePlayers.some(canPlayerBeAssignedFromPool);
          const currentNearestSlot = nearestSlot?.scenarioId === scenario.id ? nearestSlot : null;
          const currentOpenPickerSlot =
            openPickerSlot?.scenarioId === scenario.id ? openPickerSlot.slot : null;
          const selectedAvailablePlayerId =
            selectedAvailablePlayer?.scenarioId === scenario.id
              ? selectedAvailablePlayer.playerId
              : null;
          const isRandomizingScenario = randomizingScenarioId === scenario.id;
          const hasOpenSlots = teams.some((team) =>
            POSITIONS.some((position) => (scenario.assignments[team.id]?.[position] ?? null) === null)
          );
          const hasAssignedPlayers = teams.some((team) =>
            POSITIONS.some((position) => (scenario.assignments[team.id]?.[position] ?? null) !== null)
          );
          const scenarioCollapsed = Boolean(scenarioReorder) || scenario.collapsed;
          const scenarioIsDragging = scenarioReorder?.scenarioId === scenario.id;
          const deleteModalOpen = scenarioPendingDeleteId === scenario.id;

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
              <div className="scenario-header">
                <button
                  type="button"
                  className="scenario-drag-handle"
                  aria-label={`Reorder ${scenario.title || "scenario"}`}
                  disabled={Boolean(dragState) || Boolean(scenarioReorder) || deleteModalOpen}
                  onMouseDown={(event) => {
                    if (dragState || scenarioReorder || event.button !== 0) {
                      return;
                    }

                    const sectionNode = event.currentTarget.closest(".board-shell");
                    if (!(sectionNode instanceof HTMLElement)) {
                      return;
                    }

                    event.preventDefault();

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
                    };

                    const cleanup = () => {
                      window.removeEventListener("mousemove", handleMove);
                      window.removeEventListener("mouseup", handleUp);
                    };

                    window.addEventListener("mousemove", handleMove);
                    window.addEventListener("mouseup", handleUp, { once: true });
                  }}
                />
                <div className="scenario-header-main">
                  <input
                    type="text"
                    className="scenario-title-input"
                    value={scenario.title}
                    onChange={(event) => updateScenarioTitle(scenario.id, event.target.value)}
                    onBlur={(event) =>
                      updateScenarioTitle(scenario.id, event.target.value, { immediate: true })
                    }
                    aria-label={`Scenario title for ${scenario.title || "scenario"}`}
                    placeholder="Team Scenario"
                    spellCheck={false}
                    disabled={deleteModalOpen}
                  />
                  <div className="scenario-header-actions">
                    <button
                      type="button"
                      className="scenario-delete-button"
                      aria-label={`Delete ${scenario.title || "scenario"}`}
                      onClick={() => promptDeleteScenario(scenario.id)}
                      disabled={Boolean(dragState) || Boolean(scenarioReorder) || deleteModalOpen}
                    >
                      <svg
                        className="scenario-delete-icon"
                        aria-hidden="true"
                        viewBox="0 0 16 16"
                        fill="none"
                      >
                        <path
                          d="M3.5 4.5h9"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                        />
                        <path
                          d="M6 2.75h4"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                        />
                        <path
                          d="M5 5.25v6.1c0 .64.52 1.15 1.15 1.15h3.7c.64 0 1.15-.52 1.15-1.15v-6.1"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className={`scenario-toggle${scenarioCollapsed ? " collapsed" : ""}`}
                      aria-label={scenarioCollapsed ? "Expand scenario" : "Collapse scenario"}
                      aria-expanded={!scenarioCollapsed}
                      tabIndex={scenarioReorder ? -1 : 0}
                      onClick={() => toggleScenarioCollapsed(scenario.id)}
                      disabled={deleteModalOpen}
                    >
                      <span className="scenario-toggle-icon" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </div>
              <div className="scenario-body" aria-hidden={scenarioCollapsed}>
                <div className="scenario-body-inner">
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
                    <div className="available-header">
                      <h2 className="available-title">Player Pool</h2>
                      <div className="available-actions">
                        <button
                          type="button"
                          className="available-reset-button"
                          onClick={() => resetScenarioAssignments(scenario.id)}
                          disabled={isRandomizingScenario || !hasAssignedPlayers}
                        >
                          Reset
                        </button>
                        <button
                          type="button"
                          className="available-randomize-button"
                          onClick={() => randomizeScenarioRemainingPlayers(scenario.id)}
                          disabled={
                            isRandomizingScenario ||
                            !hasAssignablePoolPlayers ||
                            !hasOpenSlots
                          }
                        >
                          {isRandomizingScenario ? "Thinking..." : "Randomize Remaining"}
                        </button>
                      </div>
                    </div>
                      <div className="available-players">
                      {availablePlayers.map((player) => {
                        const isSelected = selectedAvailablePlayerId === player.id;
                        const isAssignable = canPlayerBeAssignedFromPool(player);
                        const poolName = getPlayerPoolName(player);
                        return (
                          <div
                            key={player.id}
                            className={`player-chip available-player-chip${isSelected ? " selected" : ""}${isAssignable ? "" : " incomplete"}`}
                            title={
                              isAssignable
                                ? poolName
                                : `${poolName} needs at least one eligible position before assignment`
                            }
                            onMouseDown={
                              isAssignable
                                ? (event) =>
                                    bindChipPointerDown(
                                      event,
                                      player.id,
                                      event.currentTarget,
                                      (playerId, chipNode) =>
                                        beginDrag(scenario.id, playerId, chipNode, null),
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
                                : undefined
                            }
                            aria-disabled={!isAssignable}
                          >
                            {formatPlayerLabel(poolName)}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div className="teams-grid">
                    {teams.map((team, teamIndex) => (
                      <TeamColumn
                        key={team.id}
                        scenarioId={scenario.id}
                        team={team}
                        teamIndex={teamIndex}
                        assignments={displayedAssignments[team.id] ?? createEmptyAssignments([team])[team.id]}
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
                  <ScenarioAttributeCharts
                    charts={scenarioCharts}
                  />
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
                <div className="scenario-drag-handle" aria-hidden="true" />
                <div className="scenario-header-main">
                  <div className="scenario-title-input">
                    {scenarioById.get(scenarioReorder.scenarioId)?.title}
                  </div>
                  <div className="scenario-header-actions">
                    <div className="scenario-delete-button" aria-hidden="true" tabIndex={-1}>
                      <svg className="scenario-delete-icon" viewBox="0 0 16 16" fill="none">
                        <path
                          d="M3.5 4.5h9"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                        />
                        <path
                          d="M6 2.75h4"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                        />
                        <path
                          d="M5 5.25v6.1c0 .64.52 1.15 1.15 1.15h3.7c.64 0 1.15-.52 1.15-1.15v-6.1"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </div>
                    <div className="scenario-toggle collapsed" aria-hidden="true" tabIndex={-1}>
                      <span className="scenario-toggle-icon" />
                    </div>
                  </div>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
      {scenarioPendingDeleteId
        ? createPortal(
            <div
              className="matchup-tinder-modal-backdrop"
              role="presentation"
              onClick={() => setScenarioPendingDeleteId(null)}
            >
              <div
                className="matchup-tinder-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="scenario-delete-title"
                aria-describedby="scenario-delete-copy"
                onClick={(event) => event.stopPropagation()}
              >
                <h2 id="scenario-delete-title">Delete this scenario?</h2>
                <p id="scenario-delete-copy">
                  This will permanently remove the scenario and all of its team assignments.
                </p>
                <div className="matchup-tinder-modal-actions">
                  <button
                    type="button"
                    className="matchup-tinder-modal-button secondary"
                    onClick={() => setScenarioPendingDeleteId(null)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="matchup-tinder-modal-button primary"
                    onClick={confirmDeleteScenario}
                  >
                    Delete Scenario
                  </button>
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
  teamIndex,
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
  teamIndex: number;
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
  const teamLabel = getTeamDisplayName(team, teamIndex);

  return (
    <section className="team-card">
      <div className="team-name" style={{ background: team.color }}>
        {getChartTeamLabelLines(teamLabel).map((line) => (
          <span key={line}>{line}</span>
        ))}
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
                        aria-label={`Clear ${teamLabel} position ${position}`}
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
                      aria-label={`${teamLabel} position ${position} players`}
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

function ScenarioAttributeCharts({ charts }: { charts: ScenarioAttributeChart[] }) {
  return (
    <section className="scenario-analytics" aria-label="Team totals by attribute category">
      {charts.map((chart) => (
        <div key={chart.label} className="scenario-chart-card">
          <div className="scenario-chart-header">
            <h2 className="scenario-chart-title">{chart.label}</h2>
          </div>
          <div className="scenario-chart-grid">
            {chart.stacks.map((stack, stackIndex) => (
              <div key={stack.team.id} className="scenario-chart-column">
                <div className="scenario-chart-total">{formatChartValue(stack.total)}</div>
                <div className="scenario-chart-bar">
                  {stack.segments.map((segment, index) => (
                    <div
                      key={segment.key}
                      className={`scenario-chart-segment tone-${chart.tone}${segment.variant === "chemistry" ? " chemistry" : ""}`}
                      tabIndex={0}
                      aria-label={`${segment.label}: ${formatChartValue(segment.value)}`}
                      style={{
                        height: `${(segment.value / chart.maxTotal) * 100}%`,
                        background: getScenarioChartSegmentBackground(
                          stack.team.color,
                          index,
                          segment.variant
                        )
                      }}
                    >
                      <span className="scenario-chart-tooltip">
                        {segment.label}: {formatChartValue(segment.value)}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="scenario-chart-team">
                  {getChartTeamLabelLines(getTeamDisplayName(stack.team, stackIndex)).map((line) => (
                    <span key={line}>{line}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
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
