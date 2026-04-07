"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AppShell } from "@/components/app-shell";
import { useRun } from "@/components/run-provider";
import { TournamentBuilderProvider, useTournamentBuilder } from "@/components/tournament-builder";
import { buildRunApiPath, buildRunScopedStorageKey } from "@/lib/runs";
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
  parseStoredScenarioState,
  scenarioAssignmentsToRows,
  scenarioTeamsToRows,
  scenariosToRows,
  SCENARIO_TEAM_SELECT_COLUMNS,
  TEAM_SCENARIO_SELECT_COLUMNS,
  TEAM_SCENARIOS_STORAGE_KEY
} from "@/lib/supabase/tcb";
import { generateScenarioTeamName } from "@/lib/team-name-generator";
import {
  buildMatchupScoreLookup,
  buildScenarioMatchupReport,
  findBestScenarioMatchupSwapSuggestions,
  type MatchupScoreLookup,
  type TeamMatchupChosenPair,
  type ScenarioMatchupReport,
  type ScenarioMatchupSwapSuggestion,
  type ScenarioMatchupSwapSuggestions,
  type TeamMatchupDirectionalEdge
} from "@/lib/team-matchup-balance";
import {
  interpolateUnifiedMatchupColor,
  normalizeUnifiedColorScore,
  type MatchupVisualizerBundleResponse
} from "@/lib/matchup-visualizer";
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
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";

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

type ScenarioActionState = {
  scenarioId: string;
  mode: "randomize" | "balanceStats" | "balanceMatchup";
};

type ScenarioActionSummary = {
  generatedCount: number;
  mode: "randomize" | "balanceStats" | "balanceMatchup";
  candidates: Assignments[];
  currentIndex: number;
  balanceSummaryText?: string | null;
};

type TeamBalanceTotals = {
  offense: number;
  defense: number;
  misc: number;
};

type ScenarioActionMode = ScenarioActionState["mode"];
type ScenarioAnalyticsMode = "stats" | "matchup";
type ScenarioGoalLabel = "Goal 1" | "Goal 2" | "Goal 3";
type StatsBalanceLeafKey = Exclude<ScenarioCategoryAdvantageKey, "overall">;
type StatsBalanceStrategy = "overall" | "selected";
type HeadToHeadSelection = {
  perspective: "offense" | "defense";
  sourceTeamId: string;
  targetTeamId: string;
};

type MatchupBundleRequestState =
  | { status: "loading"; error: null; data: null }
  | { status: "error"; error: string; data: null }
  | { status: "ready"; error: null; data: MatchupVisualizerBundleResponse };

type ScenarioHistoryEntry = {
  teams: Team[];
  assignments: Assignments;
  summary: ScenarioActionSummary | null;
};

type ScenarioHistoryStacks = Record<string, ScenarioHistoryEntry[]>;

type ChipTravelSnapshot = {
  clone: HTMLDivElement;
  left: number;
  top: number;
  width: number;
  height: number;
  background: string;
  borderRadius: string;
  color: string;
};

type ScenarioGenerationResult = {
  assignments: Assignments;
  generatedCount: number;
  candidates: Assignments[];
};

type GeneratedScenarioCandidate = {
  assignments: Assignments;
  signature: string;
  filledCount: number;
  categoryScore: number;
  overallRangeScore: number;
  overallScore: number;
};

type GeneratedMatchupScenarioCandidate = {
  assignments: Assignments;
  signature: string;
  filledCount: number;
  matchupReport: ScenarioMatchupReport;
};

type StartDragFn = (playerId: number, chipNode: HTMLDivElement) => void;
const SCENARIO_SYNC_DEBOUNCE_MS = 2000;
const TEAM_NAME_SCENARIO_COMMIT_DELAY_MS = 350;
const TEAM_COLOR_SCENARIO_COMMIT_DELAY_MS = 120;
const SCENARIO_ACTION_PROGRESS_MS = 2000;
const REMAINING_ASSIGNMENT_ATTEMPTS = 25;
const BALANCED_ASSIGNMENT_MIN_FULL_ROSTERS = 100;
const BALANCED_ASSIGNMENT_MAX_ATTEMPTS =
  REMAINING_ASSIGNMENT_ATTEMPTS * BALANCED_ASSIGNMENT_MIN_FULL_ROSTERS;
const MAX_SCENARIO_UNDO_STEPS = 15;
const OVERALL_BALANCE_RANGE_FINALIST_COUNT = 10;
const MATCHUP_CHORD_SIZE = 320;
const MATCHUP_CHORD_HEIGHT = 260;
const MATCHUP_NODE_RADIUS = 22;
const MATCHUP_LINK_STROKE_WIDTH = 6;
const MATCHUP_NODE_BUFFER_RADIUS = 5;
const MATCHUP_ARROW_TIP_LENGTH = 12;

type TeamDraft = {
  name: string;
  color: string;
};

type ScenarioTeamDrafts = Record<string, Record<string, TeamDraft>>;

type TeamAttributeStack = {
  team: Team;
  total: number;
  segments: ScenarioChartSegment[];
};

type ScenarioAttributeChart = {
  label: string;
  tone: "overall" | "offense" | "defense" | "misc";
  maxTotal: number;
  stacks: TeamAttributeStack[];
};

type ScenarioChartSegment = {
  key: PlayerAttributeKey | "chemistry" | "overallOffense" | "overallDefense" | "overallMisc";
  label: string;
  value: number;
  variant: "attribute" | "chemistry" | "overall";
};

type ScenarioCategoryAdvantageCell = {
  team: Team;
  advantage: number;
  isIncomplete: boolean;
};

type ScenarioCategoryAdvantageKey = PlayerAttributeKey | "chemistry" | "overall";

type ScenarioCategoryAdvantageRow = {
  key: ScenarioCategoryAdvantageKey;
  label: string;
  missingPlayerNames: string[];
  cells: ScenarioCategoryAdvantageCell[];
};

type ScenarioStatsTradeSuggestion = {
  sourceTeamId: string;
  targetTeamId: string;
  sourcePlayerId: number;
  targetPlayerId: number;
  nextOverallRangeScore: number;
  nextOverallScore: number;
  nextMaxSubcategoryRange: number;
  nextMaxSubcategoryLabel: string;
  nextTotalSubcategoryRange: number;
};

type ScenarioStatsBalancerReport = {
  completeTeams: Team[];
  currentOverallRangeScore: number;
  currentOverallScore: number;
  currentMaxSubcategoryRange: number;
  currentMaxSubcategoryLabel: string;
  currentTotalSubcategoryRange: number;
  goal1Suggestion: ScenarioStatsTradeSuggestion | null;
  goal2Suggestion: ScenarioStatsTradeSuggestion | null;
};

const SCENARIO_CHART_TOP_PADDING = 10;
const TEAM_SYNC_DEBOUNCE_MS = 1000;
const SCENARIO_STATS_V2_GROUP_COLUMN_WIDTH = 64;
const SCENARIO_STATS_V2_LABEL_COLUMN_WIDTH = 190;
const SCENARIO_STATS_BALANCER_GOAL1_LIMIT = 40;
const SCENARIO_STATS_BALANCER_GOAL2_LIMIT = 15;
const SCENARIO_SUBCATEGORY_ATTRIBUTES = PLAYER_ATTRIBUTE_GROUPS.reduce<
  Array<{ key: PlayerAttributeKey; label: string }>
>((allAttributes, group) => {
  allAttributes.push(...group.attributes);
  return allAttributes;
}, []);
const SCENARIO_STATS_BALANCE_FILTER_GROUPS: Array<{
  key: string;
  label: string;
  options: Array<{ key: StatsBalanceLeafKey; label: string }>;
}> = [
  ...PLAYER_ATTRIBUTE_GROUPS.map((group) => ({
    key: group.tone,
    label: group.label,
    options: group.attributes
  })),
  {
    key: "chemistry",
    label: "Chemistry",
    options: [{ key: "chemistry", label: "Chemistry" }]
  }
];
const SCENARIO_STATS_BALANCE_LEAF_KEYS = SCENARIO_STATS_BALANCE_FILTER_GROUPS.flatMap((group) =>
  group.options.map((option) => option.key)
);
const SCENARIO_STATS_V2_GROUPS: Array<{
  shortLabel: "OFF" | "DEF" | "MISC" | "CHEM";
  rows: Array<{ key: ScenarioCategoryAdvantageKey; label: string }>;
}> = [
  {
    shortLabel: "OFF",
    rows: PLAYER_ATTRIBUTE_GROUPS.find((group) => group.tone === "offense")?.attributes ?? []
  },
  {
    shortLabel: "DEF",
    rows: PLAYER_ATTRIBUTE_GROUPS.find((group) => group.tone === "defense")?.attributes ?? []
  },
  {
    shortLabel: "MISC",
    rows: PLAYER_ATTRIBUTE_GROUPS.find((group) => group.tone === "misc")?.attributes ?? []
  },
  {
    shortLabel: "CHEM",
    rows: [{ key: "chemistry", label: "Chemistry" }]
  }
];

function roundChartValue(value: number) {
  return Math.round((value + Number.EPSILON) * 10) / 10;
}

function normalizeStatsBalanceSelection(selection: StatsBalanceLeafKey[]) {
  const validKeys = new Set<StatsBalanceLeafKey>(SCENARIO_STATS_BALANCE_LEAF_KEYS);
  return [...new Set(selection.filter((key): key is StatsBalanceLeafKey => validKeys.has(key)))];
}

function getDefaultStatsBalanceSelection() {
  return [...SCENARIO_STATS_BALANCE_LEAF_KEYS];
}

function areStatsBalanceSelectionsEqual(
  left: StatsBalanceLeafKey[],
  right: StatsBalanceLeafKey[]
) {
  if (left.length !== right.length) {
    return false;
  }

  const leftSet = new Set(left);
  return right.every((key) => leftSet.has(key));
}

function areAllStatsBalanceOptionsSelected(selection: StatsBalanceLeafKey[]) {
  return areStatsBalanceSelectionsEqual(
    normalizeStatsBalanceSelection(selection),
    getDefaultStatsBalanceSelection()
  );
}

function formatListWithAnd(items: string[]) {
  if (items.length === 0) {
    return "";
  }

  if (items.length === 1) {
    return items[0];
  }

  if (items.length === 2) {
    return `${items[0]} and ${items[1]}`;
  }

  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function buildStatsBalanceSummaryText(selection: StatsBalanceLeafKey[]) {
  const normalizedSelection = normalizeStatsBalanceSelection(selection);

  if (areAllStatsBalanceOptionsSelected(normalizedSelection)) {
    return "overall";
  }

  const labels = SCENARIO_STATS_BALANCE_FILTER_GROUPS.flatMap((group) =>
    group.options
      .filter((option) => normalizedSelection.includes(option.key))
      .map((option) => option.label)
  );

  return labels.length > 0 ? formatListWithAnd(labels) : "selected stats";
}

function getStatsBalanceStrategy(selection: StatsBalanceLeafKey[]): StatsBalanceStrategy {
  return areAllStatsBalanceOptionsSelected(selection) ? "overall" : "selected";
}

function formatChartValue(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function getTeamDisplayName(team: Team, index: number) {
  const name = team.name.trim();
  return name || `Team ${index + 1}`;
}

function getScenarioTeamCommitKey(
  scenarioId: string,
  teamId: string,
  kind: "name" | "color"
) {
  return `${scenarioId}:${teamId}:${kind}`;
}

function cloneTeams(teams: Team[]) {
  return teams.map((team) => ({ ...team }));
}

function buildTeamChemistryBonusTotal(
  assignments: Assignments,
  playersById: ReadonlyMap<number, Player>,
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

function createDefaultTeams(runSlug: string, count = 2) {
  const teams: Team[] = [];

  for (let index = 0; index < count; index += 1) {
    teams.push(createTeam(index, teams, runSlug));
  }

  return teams;
}

function createScenario(index: number, runSlug: string, teams: Team[] = createDefaultTeams(runSlug)): Scenario {
  return {
    id: createScenarioId(),
    title: `Team Scenario ${index}`,
    teams: cloneTeams(teams),
    assignments: createEmptyAssignments(teams),
    collapsed: true
  };
}

function ScenarioToggleIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg className="scenario-toggle-icon" aria-hidden="true" viewBox="0 0 12 12" fill="none">
      <path
        d={collapsed ? "M2.25 4.25 6 8 9.75 4.25" : "M2.25 7.75 6 4 9.75 7.75"}
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function buildScenarioTeamAttributeTotals(
  assignments: Assignments,
  playersById: ReadonlyMap<number, Player>,
  teams: Team[]
) {
  return teams.map((team) => {
    const totals = {} as Record<PlayerAttributeKey, number>;

    for (const attribute of SCENARIO_SUBCATEGORY_ATTRIBUTES) {
      totals[attribute.key] = 0;
    }

    for (const position of POSITIONS) {
      const playerId = assignments[team.id]?.[position] ?? null;
      const player = playerId ? playersById.get(playerId) ?? null : null;

      if (!player) {
        continue;
      }

      for (const attribute of SCENARIO_SUBCATEGORY_ATTRIBUTES) {
        totals[attribute.key] += player.attributes[attribute.key] ?? 0;
      }
    }

    return totals;
  });
}

function getIncompleteScenarioTeamIds(assignments: Assignments, teams: Team[]) {
  return teams
    .filter((team) => POSITIONS.some((position) => (assignments[team.id]?.[position] ?? null) === null))
    .map((team) => team.id);
}

function getCompleteScenarioTeams(assignments: Assignments, teams: Team[]) {
  const incompleteTeamIds = new Set(getIncompleteScenarioTeamIds(assignments, teams));
  return teams.filter((team) => !incompleteTeamIds.has(team.id));
}

function buildScenarioAttributeCharts(
  assignments: Assignments,
  playersById: Map<number, Player>,
  teams: Team[]
): ScenarioAttributeChart[] {
  const teamAttributeTotals = buildScenarioTeamAttributeTotals(assignments, playersById, teams);
  const overallStacks = buildTeamBalanceTotals(assignments, playersById, teams).map((totals, index) => {
      const team = teams[index];
      const segments: ScenarioChartSegment[] = [
        {
          key: "overallOffense",
          label: "Offense",
          value: roundChartValue(totals.offense),
          variant: "overall"
        },
        {
          key: "overallDefense",
          label: "Defense",
          value: roundChartValue(totals.defense),
          variant: "overall"
        },
        {
          key: "overallMisc",
          label: "Misc",
          value: roundChartValue(totals.misc),
          variant: "overall"
        }
      ];

      return {
        team,
        total: roundChartValue(totals.offense + totals.defense + totals.misc),
        segments
      };
    });

  const overallChart: ScenarioAttributeChart = {
    label: "Overall",
    tone: "overall",
    maxTotal:
      Math.max(...overallStacks.map((stack) => stack.total), 0) + SCENARIO_CHART_TOP_PADDING,
    stacks: overallStacks
  };

  const categoryCharts = PLAYER_ATTRIBUTE_GROUPS.map((group) => {
    const stacks = teams.map((team, teamIndex) => {
      const segments: ScenarioChartSegment[] = group.attributes.map((attribute) => {
        const value = roundChartValue(teamAttributeTotals[teamIndex][attribute.key]);

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
      maxTotal:
        Math.max(...stacks.map((stack) => stack.total), 0) + SCENARIO_CHART_TOP_PADDING,
      stacks
    };
  });

  return [overallChart, ...categoryCharts];
}

function buildScenarioCategoryAdvantageRows(
  assignments: Assignments,
  playersById: ReadonlyMap<number, Player>,
  teams: Team[]
): ScenarioCategoryAdvantageRow[] {
  const teamAttributeTotals = buildScenarioTeamAttributeTotals(assignments, playersById, teams);
  const incompleteTeamIds = new Set(getIncompleteScenarioTeamIds(assignments, teams));
  const attributeRows = SCENARIO_SUBCATEGORY_ATTRIBUTES.map((attribute) => {
    const totals = teamAttributeTotals.map((teamTotals) => teamTotals[attribute.key]);
    const missingPlayerNames: string[] = [];

    for (const team of teams) {
      if (incompleteTeamIds.has(team.id)) {
        continue;
      }

      for (const position of POSITIONS) {
        const playerId = assignments[team.id]?.[position] ?? null;
        const player = playerId ? playersById.get(playerId) ?? null : null;

        if (!player) {
          continue;
        }

        const attributeValue = player.attributes[attribute.key];
        if (attributeValue === null || attributeValue === 0) {
          const playerName = player.name.trim() || `Player ${player.id}`;
          if (!missingPlayerNames.includes(playerName)) {
            missingPlayerNames.push(playerName);
          }
        }
      }
    }

    return {
      key: attribute.key,
      label: attribute.label,
      missingPlayerNames,
      cells: teams.map((team, teamIndex) => ({
        team,
        isIncomplete: incompleteTeamIds.has(team.id),
        advantage: incompleteTeamIds.has(team.id)
          ? 0
          : roundChartValue(
              totals.reduce((sum, otherTotal, otherIndex) => {
                if (teamIndex === otherIndex || incompleteTeamIds.has(teams[otherIndex].id)) {
                  return sum;
                }

                return sum + (totals[teamIndex] - otherTotal);
              }, 0)
            )
      }))
    };
  });

  const chemistryTotals = teams.map((team) =>
    buildTeamChemistryBonusTotal(assignments, playersById, team.id)
  );
  const chemistryRow: ScenarioCategoryAdvantageRow = {
    key: "chemistry",
    label: "Chemistry",
    missingPlayerNames: [],
    cells: teams.map((team, teamIndex) => ({
      team,
      isIncomplete: incompleteTeamIds.has(team.id),
      advantage: incompleteTeamIds.has(team.id)
        ? 0
        : roundChartValue(
            chemistryTotals.reduce((sum, otherTotal, otherIndex) => {
              if (teamIndex === otherIndex || incompleteTeamIds.has(teams[otherIndex].id)) {
                return sum;
              }

              return sum + (chemistryTotals[teamIndex] - otherTotal);
            }, 0)
          )
    }))
  };

  return [...attributeRows, chemistryRow];
}

function buildScenarioSubcategoryImbalanceSummary(
  assignments: Assignments,
  playersById: ReadonlyMap<number, Player>,
  teams: Team[]
) {
  const categoryAdvantageRows = buildScenarioCategoryAdvantageRows(assignments, playersById, teams).filter(
    (row) => row.key !== "chemistry" && row.missingPlayerNames.length === 0
  );
  let maxRange = 0;
  let maxLabel = categoryAdvantageRows[0]?.label ?? SCENARIO_SUBCATEGORY_ATTRIBUTES[0]?.label ?? "Category";
  let totalRangeSum = 0;

  for (const row of categoryAdvantageRows) {
    const range = row.cells.reduce(
      (currentMax, cell) => Math.max(currentMax, Math.abs(cell.advantage)),
      0
    );
    totalRangeSum += range;

    if (range > maxRange) {
      maxRange = range;
      maxLabel = row.label;
    }
  }

  return {
    maxRange: roundChartValue(maxRange),
    maxLabel,
    totalRangeSum: roundChartValue(totalRangeSum)
  };
}

function swapScenarioAssignedPlayers(
  assignments: Assignments,
  leftTeamId: string,
  leftPosition: Position,
  rightTeamId: string,
  rightPosition: Position
) {
  const nextAssignments = cloneAssignments(assignments);
  const leftPlayerId = nextAssignments[leftTeamId]?.[leftPosition] ?? null;
  const rightPlayerId = nextAssignments[rightTeamId]?.[rightPosition] ?? null;

  nextAssignments[leftTeamId][leftPosition] = rightPlayerId;
  nextAssignments[rightTeamId][rightPosition] = leftPlayerId;

  return nextAssignments;
}

function buildScenarioStatsTradeSuggestionKey(suggestion: ScenarioStatsTradeSuggestion) {
  return [
    suggestion.sourceTeamId,
    suggestion.targetTeamId,
    suggestion.sourcePlayerId,
    suggestion.targetPlayerId
  ].join(":");
}

function buildScenarioStatsBalancerReport(
  assignments: Assignments,
  teams: Team[],
  playersById: ReadonlyMap<number, Player>
): ScenarioStatsBalancerReport {
  const completeTeams = getCompleteScenarioTeams(assignments, teams);
  const currentOverallRangeScore =
    completeTeams.length > 0
      ? roundChartValue(getScenarioOverallRangeScore(assignments, playersById, completeTeams))
      : 0;
  const currentOverallScore =
    completeTeams.length > 0
      ? roundChartValue(getScenarioOverallBalanceScore(assignments, playersById, completeTeams))
      : 0;
  const currentSubcategorySummary =
    completeTeams.length > 0
      ? buildScenarioSubcategoryImbalanceSummary(assignments, playersById, completeTeams)
      : {
          maxRange: 0,
          maxLabel: SCENARIO_SUBCATEGORY_ATTRIBUTES[0]?.label ?? "Category",
          totalRangeSum: 0
        };

  let goal1Suggestion: ScenarioStatsTradeSuggestion | null = null;
  let goal2Suggestion: ScenarioStatsTradeSuggestion | null = null;

  if (completeTeams.length >= 2) {
    for (let leftIndex = 0; leftIndex < completeTeams.length; leftIndex += 1) {
      const leftTeam = completeTeams[leftIndex];

      for (let rightIndex = leftIndex + 1; rightIndex < completeTeams.length; rightIndex += 1) {
        const rightTeam = completeTeams[rightIndex];

        for (const leftPosition of POSITIONS) {
          const leftPlayerId = assignments[leftTeam.id]?.[leftPosition] ?? null;
          if (leftPlayerId === null) {
            continue;
          }

          const leftPlayer = playersById.get(leftPlayerId);
          if (!leftPlayer) {
            continue;
          }

          for (const rightPosition of POSITIONS) {
            const rightPlayerId = assignments[rightTeam.id]?.[rightPosition] ?? null;
            if (rightPlayerId === null) {
              continue;
            }

            const rightPlayer = playersById.get(rightPlayerId);
            if (!rightPlayer) {
              continue;
            }

            const isLegalSwap =
              leftPlayer.positions.includes(rightPosition) &&
              rightPlayer.positions.includes(leftPosition);

            if (!isLegalSwap) {
              continue;
            }

            const nextAssignments = swapScenarioAssignedPlayers(
              assignments,
              leftTeam.id,
              leftPosition,
              rightTeam.id,
              rightPosition
            );
            const nextOverallRangeScore = roundChartValue(
              getScenarioOverallRangeScore(nextAssignments, playersById, completeTeams)
            );
            const nextOverallScore = roundChartValue(
              getScenarioOverallBalanceScore(nextAssignments, playersById, completeTeams)
            );
            const nextSubcategorySummary = buildScenarioSubcategoryImbalanceSummary(
              nextAssignments,
              playersById,
              completeTeams
            );
            const candidateSuggestion: ScenarioStatsTradeSuggestion = {
              sourceTeamId: leftTeam.id,
              targetTeamId: rightTeam.id,
              sourcePlayerId: leftPlayerId,
              targetPlayerId: rightPlayerId,
              nextOverallRangeScore,
              nextOverallScore,
              nextMaxSubcategoryRange: nextSubcategorySummary.maxRange,
              nextMaxSubcategoryLabel: nextSubcategorySummary.maxLabel,
              nextTotalSubcategoryRange: nextSubcategorySummary.totalRangeSum
            };

            if (nextOverallRangeScore < currentOverallRangeScore) {
              if (
                !goal1Suggestion ||
                nextOverallRangeScore < goal1Suggestion.nextOverallRangeScore ||
                (nextOverallRangeScore === goal1Suggestion.nextOverallRangeScore &&
                  nextOverallScore < goal1Suggestion.nextOverallScore) ||
                (nextOverallRangeScore === goal1Suggestion.nextOverallRangeScore &&
                  nextOverallScore === goal1Suggestion.nextOverallScore &&
                  buildScenarioStatsTradeSuggestionKey(candidateSuggestion) <
                    buildScenarioStatsTradeSuggestionKey(goal1Suggestion))
              ) {
                goal1Suggestion = candidateSuggestion;
              }
            }

            if (nextSubcategorySummary.maxRange < currentSubcategorySummary.maxRange) {
              if (
                !goal2Suggestion ||
                nextSubcategorySummary.maxRange < goal2Suggestion.nextMaxSubcategoryRange ||
                (nextSubcategorySummary.maxRange === goal2Suggestion.nextMaxSubcategoryRange &&
                  nextSubcategorySummary.totalRangeSum < goal2Suggestion.nextTotalSubcategoryRange) ||
                (nextSubcategorySummary.maxRange === goal2Suggestion.nextMaxSubcategoryRange &&
                  nextSubcategorySummary.totalRangeSum === goal2Suggestion.nextTotalSubcategoryRange &&
                  buildScenarioStatsTradeSuggestionKey(candidateSuggestion) <
                    buildScenarioStatsTradeSuggestionKey(goal2Suggestion))
              ) {
                goal2Suggestion = candidateSuggestion;
              }
            }
          }
        }
      }
    }
  }

  return {
    completeTeams,
    currentOverallRangeScore,
    currentOverallScore,
    currentMaxSubcategoryRange: currentSubcategorySummary.maxRange,
    currentMaxSubcategoryLabel: currentSubcategorySummary.maxLabel,
    currentTotalSubcategoryRange: currentSubcategorySummary.totalRangeSum,
    goal1Suggestion,
    goal2Suggestion
  };
}

function getChartTeamLabelLines(name: string) {
  const words = name.trim().split(/\s+/);
  if (words.length <= 1) {
    return [name];
  }

  return [words[0], words.slice(1).join(" ")];
}

function getMatchupTeamLabelLines(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 1) {
    return [name];
  }

  if (words.length === 2) {
    return words;
  }

  if (words.length === 3) {
    return words;
  }

  return [words[0], words.slice(1, -1).join(" "), words[words.length - 1]];
}

function getChartSegmentColor(teamColor: string, index: number) {
  const tintStrength = [92, 82, 72][index] ?? 72;
  return `color-mix(in srgb, ${teamColor} ${tintStrength}%, white ${100 - tintStrength}%)`;
}

function buildScenarioSwapHelperText(
  goalLabel: ScenarioGoalLabel,
  suggestion: ScenarioMatchupSwapSuggestion | null,
  isScenarioComplete: boolean,
  playersById: ReadonlyMap<number, Player>
) {
  if (!isScenarioComplete) {
    return "Complete the roster to get swap suggestions.";
  }

  if (!suggestion) {
    return `No player trade improves ${goalLabel} right now.`;
  }

  const sourcePlayerName =
    playersById.get(suggestion.sourcePlayerId)?.name.trim() || `Player ${suggestion.sourcePlayerId}`;
  const targetPlayerName =
    playersById.get(suggestion.targetPlayerId)?.name.trim() || `Player ${suggestion.targetPlayerId}`;

  return `Trade ${sourcePlayerName} and ${targetPlayerName} to improve ${goalLabel}.`;
}

function buildScenarioStatsTradeHelperText(
  goalLabel: "goal 1" | "goal 2",
  suggestion: ScenarioStatsTradeSuggestion | null,
  completeTeamCount: number,
  playersById: ReadonlyMap<number, Player>
) {
  if (completeTeamCount < 2) {
    return "Complete at least two team rosters to get trade recommendations.";
  }

  if (!suggestion) {
    return `No player trade improves ${goalLabel} right now.`;
  }

  const sourcePlayerName =
    playersById.get(suggestion.sourcePlayerId)?.name.trim() ||
    `Player ${suggestion.sourcePlayerId}`;
  const targetPlayerName =
    playersById.get(suggestion.targetPlayerId)?.name.trim() ||
    `Player ${suggestion.targetPlayerId}`;

  return `Trade ${sourcePlayerName} for ${targetPlayerName} to improve ${goalLabel}.`;
}

function buildScenarioStatsCategoryHelperText(report: ScenarioStatsBalancerReport): ReactNode {
  if (report.completeTeams.length < 2) {
    return "Complete at least two team rosters to compare categories.";
  }

  return (
    <>
      <strong>{report.currentMaxSubcategoryLabel}</strong> is the most imbalanced.
    </>
  );
}

function buildScenarioStatsGoal2TradeHelperText(
  report: ScenarioStatsBalancerReport,
  suggestion: ScenarioStatsTradeSuggestion | null,
  playersById: ReadonlyMap<number, Player>
): ReactNode {
  if (report.completeTeams.length < 2) {
    return "Complete at least two team rosters to get trade recommendations.";
  }

  if (!suggestion) {
    return "No player trade improves goal 2 right now.";
  }

  const sourcePlayerName =
    playersById.get(suggestion.sourcePlayerId)?.name.trim() ||
    `Player ${suggestion.sourcePlayerId}`;
  const targetPlayerName =
    playersById.get(suggestion.targetPlayerId)?.name.trim() ||
    `Player ${suggestion.targetPlayerId}`;

  return (
    <>
      Trade {sourcePlayerName} for {targetPlayerName} to improve{" "}
      <strong>{report.currentMaxSubcategoryLabel}</strong>.
    </>
  );
}

function getScenarioChartSegmentBackground(
  teamColor: string,
  index: number,
  variant: "attribute" | "chemistry" | "overall" | undefined
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

function cloneScenarioCandidates(candidates: Assignments[]) {
  return candidates.map((candidate) => cloneAssignments(candidate));
}

function cloneScenarioActionSummary(summary: ScenarioActionSummary | null) {
  if (!summary) {
    return null;
  }

  return {
    ...summary,
    candidates: cloneScenarioCandidates(summary.candidates),
    balanceSummaryText: summary.balanceSummaryText ?? null
  };
}

function createScenarioHistoryEntry(
  scenario: Scenario,
  summary: ScenarioActionSummary | null
): ScenarioHistoryEntry {
  return {
    teams: cloneTeams(scenario.teams),
    assignments: cloneAssignments(scenario.assignments),
    summary: cloneScenarioActionSummary(summary)
  };
}

function appendScenarioHistoryEntry(
  stacks: ScenarioHistoryStacks,
  scenarioId: string,
  entry: ScenarioHistoryEntry
): ScenarioHistoryStacks {
  const existingEntries = stacks[scenarioId] ?? [];
  const previousEntry = existingEntries[existingEntries.length - 1] ?? null;

  if (
    previousEntry &&
    areTeamsEqual(previousEntry.teams, entry.teams) &&
    areAssignmentsEqual(previousEntry.assignments, entry.assignments) &&
    areScenarioActionSummariesEqual(previousEntry.summary, entry.summary)
  ) {
    return stacks;
  }

  return {
    ...stacks,
    [scenarioId]: [...existingEntries, entry].slice(-MAX_SCENARIO_UNDO_STEPS)
  };
}

function getAssignedPlayerIds(assignments: Assignments) {
  const playerIds = new Set<number>();

  for (const slots of Object.values(assignments)) {
    for (const playerId of Object.values(slots)) {
      if (playerId !== null) {
        playerIds.add(playerId);
      }
    }
  }

  return playerIds;
}

function areScenarioSlotsEqual(left: SlotDescriptor | null, right: SlotDescriptor | null) {
  if (!left || !right) {
    return left === right;
  }

  return left.teamId === right.teamId && left.position === right.position;
}

function captureChipTravelSnapshot(node: HTMLDivElement): ChipTravelSnapshot {
  const rect = node.getBoundingClientRect();
  const clone = node.cloneNode(true) as HTMLDivElement;
  const styles = getComputedStyle(node);

  clone.classList.add("chip-swap-travel");

  return {
    clone,
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    background: styles.backgroundColor,
    borderRadius: styles.borderRadius,
    color: styles.color
  };
}

function animateChipTravelSnapshot(snapshot: ChipTravelSnapshot, toNode: HTMLDivElement) {
  const toRect = toNode.getBoundingClientRect();
  const clone = snapshot.clone;

  clone.style.width = `${snapshot.width}px`;
  clone.style.height = `${snapshot.height}px`;
  clone.style.left = `${snapshot.left}px`;
  clone.style.top = `${snapshot.top}px`;
  clone.style.background = snapshot.background;
  clone.style.borderRadius = snapshot.borderRadius;
  clone.style.color = snapshot.color;
  document.body.appendChild(clone);

  const deltaX = toRect.left - snapshot.left;
  const deltaY = toRect.top - snapshot.top;
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

function getAvailableChipKey(scenarioId: string, playerId: number) {
  return `${scenarioId}:${playerId}`;
}

function areScenarioActionSummariesEqual(
  left: ScenarioActionSummary | null,
  right: ScenarioActionSummary | null
) {
  if (!left || !right) {
    return left === right;
  }

  if (
    left.generatedCount !== right.generatedCount ||
    left.mode !== right.mode ||
    left.currentIndex !== right.currentIndex ||
    left.candidates.length !== right.candidates.length ||
    (left.balanceSummaryText ?? null) !== (right.balanceSummaryText ?? null)
  ) {
    return false;
  }

  return left.candidates.every((candidate, index) => {
    const matchingCandidate = right.candidates[index];
    return matchingCandidate ? areAssignmentsEqual(candidate, matchingCandidate) : false;
  });
}

function getScenarioAssignmentsSignature(assignments: Assignments) {
  return Object.entries(assignments)
    .sort(([leftTeamId], [rightTeamId]) => leftTeamId.localeCompare(rightTeamId))
    .map(
      ([teamId, slots]) =>
        `${teamId}:${POSITIONS.map((position) => slots[position] ?? "_").join(",")}`
    )
    .join("|");
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

function buildGeneratedScenarioCandidate(
  assignments: Assignments,
  playersById: ReadonlyMap<number, Player>,
  teams: Team[],
  selection: StatsBalanceLeafKey[]
): GeneratedScenarioCandidate {
  return {
    assignments: cloneAssignments(assignments),
    signature: getScenarioAssignmentsSignature(assignments),
    filledCount: countFilledAssignments(assignments),
    categoryScore: getScenarioSelectedBalanceScore(assignments, playersById, teams, selection),
    overallRangeScore: getScenarioOverallRangeScore(assignments, playersById, teams),
    overallScore: getScenarioOverallBalanceScore(assignments, playersById, teams)
  };
}

function randomizeRemainingAssignments(
  assignments: Assignments,
  teams: Team[],
  availablePlayers: Player[]
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

  return nextAssignments;
}

function chooseBestRandomizedAssignments(
  assignments: Assignments,
  teams: Team[],
  availablePlayers: Player[],
  maxAttempts: number,
  playersById: ReadonlyMap<number, Player>
): ScenarioGenerationResult {
  if (availablePlayers.length === 0) {
    return {
      assignments,
      generatedCount: 0,
      candidates: []
    };
  }

  const generatedCandidates = Array.from({ length: maxAttempts }, () =>
    buildGeneratedScenarioCandidate(
      randomizeRemainingAssignments(assignments, teams, availablePlayers),
      playersById,
      teams,
      getDefaultStatsBalanceSelection()
    )
  );
  const bestFilledCount = generatedCandidates.reduce(
    (best, candidate) => Math.max(best, candidate.filledCount),
    countFilledAssignments(assignments)
  );
  const randomizedCandidates = shuffleArray(
    [...new Map(
      generatedCandidates
        .filter((candidate) => candidate.filledCount === bestFilledCount)
        .map((candidate) => [candidate.signature, candidate.assignments] as const)
    ).values()]
  );
  const candidates =
    randomizedCandidates.length > 0 ? randomizedCandidates : [cloneAssignments(assignments)];

  return {
    assignments: cloneAssignments(candidates[0]),
    generatedCount: maxAttempts,
    candidates: cloneScenarioCandidates(candidates)
  };
}

function buildTeamBalanceTotals(
  assignments: Assignments,
  playersById: ReadonlyMap<number, Player>,
  teams: Team[]
) {
  return teams.map((team) => {
    const totals: TeamBalanceTotals = {
      offense: 0,
      defense: 0,
      misc: 0
    };

    for (const position of POSITIONS) {
      const playerId = assignments[team.id]?.[position] ?? null;
      const player = playerId ? playersById.get(playerId) ?? null : null;

      if (!player) {
        continue;
      }

      totals.offense +=
        (player.attributes.shooting ?? 0) +
        (player.attributes.driving ?? 0) +
        (player.attributes.assisting ?? 0);
      totals.defense +=
        (player.attributes.manDefense ?? 0) +
        (player.attributes.helpDefense ?? 0) +
        (player.attributes.shotBlocking ?? 0);
      totals.misc +=
        (player.attributes.playmaking ?? 0) +
        (player.attributes.rebounding ?? 0) +
        (player.attributes.transition ?? 0);
    }

    totals.misc += buildTeamChemistryBonusTotal(assignments, playersById, team.id);
    return totals;
  });
}

function getPairwiseDifferenceSum(values: number[]) {
  if (values.length <= 1) {
    return 0;
  }

  let sum = 0;

  for (let leftIndex = 0; leftIndex < values.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < values.length; rightIndex += 1) {
      sum += Math.abs(values[leftIndex] - values[rightIndex]);
    }
  }

  return sum;
}

function getValueRange(values: number[]) {
  if (values.length <= 1) {
    return 0;
  }

  return Math.max(...values) - Math.min(...values);
}

function getScenarioBalanceScore(
  assignments: Assignments,
  playersById: ReadonlyMap<number, Player>,
  teams: Team[]
) {
  const totals = buildTeamBalanceTotals(assignments, playersById, teams);

  return (
    getPairwiseDifferenceSum(totals.map((team) => team.offense)) +
    getPairwiseDifferenceSum(totals.map((team) => team.defense)) +
    getPairwiseDifferenceSum(totals.map((team) => team.misc))
  );
}

function getScenarioSelectedBalanceScore(
  assignments: Assignments,
  playersById: ReadonlyMap<number, Player>,
  teams: Team[],
  selection: StatsBalanceLeafKey[]
) {
  const normalizedSelection = normalizeStatsBalanceSelection(selection);
  if (normalizedSelection.length === 0) {
    return Number.POSITIVE_INFINITY;
  }

  const attributeTotals = buildScenarioTeamAttributeTotals(assignments, playersById, teams);
  const chemistryTotals = teams.map((team) =>
    buildTeamChemistryBonusTotal(assignments, playersById, team.id)
  );

  return normalizedSelection.reduce((sum, key) => {
    const values =
      key === "chemistry"
        ? chemistryTotals
        : attributeTotals.map((teamTotals) => teamTotals[key] ?? 0);

    return sum + getPairwiseDifferenceSum(values);
  }, 0);
}

function getScenarioOverallBalanceScore(
  assignments: Assignments,
  playersById: ReadonlyMap<number, Player>,
  teams: Team[]
) {
  const totals = buildTeamBalanceTotals(assignments, playersById, teams);

  return getPairwiseDifferenceSum(
    totals.map((team) => team.offense + team.defense + team.misc)
  );
}

function getScenarioOverallRangeScore(
  assignments: Assignments,
  playersById: ReadonlyMap<number, Player>,
  teams: Team[]
) {
  const totals = buildTeamBalanceTotals(assignments, playersById, teams);

  return getValueRange(totals.map((team) => team.offense + team.defense + team.misc));
}

function sortBalancedCandidates(
  candidates: GeneratedScenarioCandidate[],
  strategy: StatsBalanceStrategy
) {
  if (strategy === "overall") {
    const sortedByRange = candidates
      .slice()
      .sort((left, right) => {
        if (left.filledCount !== right.filledCount) {
          return right.filledCount - left.filledCount;
        }

        if (left.overallRangeScore !== right.overallRangeScore) {
          return left.overallRangeScore - right.overallRangeScore;
        }

        return left.overallScore - right.overallScore;
      });

    const finalistCount = Math.min(
      OVERALL_BALANCE_RANGE_FINALIST_COUNT,
      sortedByRange.length
    );
    const finalists = sortedByRange.slice(0, finalistCount);

    return finalists.sort((left, right) => {
      if (left.filledCount !== right.filledCount) {
        return right.filledCount - left.filledCount;
      }

      if (left.overallScore !== right.overallScore) {
        return left.overallScore - right.overallScore;
      }

      return left.overallRangeScore - right.overallRangeScore;
    });
  }

  return candidates
    .slice()
    .sort((left, right) => {
      if (left.filledCount !== right.filledCount) {
        return right.filledCount - left.filledCount;
      }

      return left.categoryScore - right.categoryScore;
    });
}

function dedupeGeneratedCandidates(candidates: GeneratedScenarioCandidate[]) {
  return [...new Map(candidates.map((candidate) => [candidate.signature, candidate] as const)).values()];
}

function buildScenarioGenerationResult(
  generatedCount: number,
  candidates: Array<{ assignments: Assignments }>,
  fallbackAssignments: Assignments
): ScenarioGenerationResult {
  const orderedCandidates =
    candidates.length > 0
      ? candidates.map((candidate) => candidate.assignments)
      : [cloneAssignments(fallbackAssignments)];

  return {
    assignments: cloneAssignments(orderedCandidates[0]),
    generatedCount,
    candidates: cloneScenarioCandidates(orderedCandidates)
  };
}

function chooseBestBalancedAssignments(
  assignments: Assignments,
  teams: Team[],
  availablePlayers: Player[],
  playersById: ReadonlyMap<number, Player>,
  batchAttempts: number,
  selection: StatsBalanceLeafKey[]
): ScenarioGenerationResult {
  if (availablePlayers.length === 0) {
    return {
      assignments,
      generatedCount: 0,
      candidates: []
    };
  }

  const totalSlotCount = teams.length * POSITIONS.length;
  let totalAttempts = 0;
  let fullRosterCount = 0;
  const fullCandidates: GeneratedScenarioCandidate[] = [];
  const partialCandidates: GeneratedScenarioCandidate[] = [];
  const strategy = getStatsBalanceStrategy(selection);

  while (
    totalAttempts < BALANCED_ASSIGNMENT_MAX_ATTEMPTS &&
    fullRosterCount < BALANCED_ASSIGNMENT_MIN_FULL_ROSTERS
  ) {
    const attemptsThisBatch = Math.min(
      batchAttempts,
      BALANCED_ASSIGNMENT_MAX_ATTEMPTS - totalAttempts
    );

    for (let attempt = 0; attempt < attemptsThisBatch; attempt += 1) {
      const nextCandidate = buildGeneratedScenarioCandidate(
        randomizeRemainingAssignments(assignments, teams, availablePlayers),
        playersById,
        teams,
        selection
      );

      if (nextCandidate.filledCount === totalSlotCount) {
        fullRosterCount += 1;
        fullCandidates.push(nextCandidate);
        continue;
      }

      partialCandidates.push(nextCandidate);
    }

    totalAttempts += attemptsThisBatch;
  }

  const orderedFullCandidates = sortBalancedCandidates(
    dedupeGeneratedCandidates(fullCandidates),
    strategy
  );

  if (orderedFullCandidates.length > 0) {
    return buildScenarioGenerationResult(totalAttempts, orderedFullCandidates, assignments);
  }

  return buildScenarioGenerationResult(
    totalAttempts,
    sortBalancedCandidates(dedupeGeneratedCandidates(partialCandidates), strategy),
    assignments
  );
}

function buildGeneratedMatchupScenarioCandidate(
  assignments: Assignments,
  teams: Team[],
  matchupLookup: MatchupScoreLookup
): GeneratedMatchupScenarioCandidate {
  return {
    assignments: cloneAssignments(assignments),
    signature: getScenarioAssignmentsSignature(assignments),
    filledCount: countFilledAssignments(assignments),
    matchupReport: buildScenarioMatchupReport(assignments, teams, matchupLookup)
  };
}

function sortMatchupCandidates(candidates: GeneratedMatchupScenarioCandidate[]) {
  return candidates.slice().sort((left, right) => {
    if (left.filledCount !== right.filledCount) {
      return right.filledCount - left.filledCount;
    }

    if (left.matchupReport.totalFairPairCount !== right.matchupReport.totalFairPairCount) {
      return right.matchupReport.totalFairPairCount - left.matchupReport.totalFairPairCount;
    }

    if (
      left.matchupReport.totalUnfairnessMagnitude !==
      right.matchupReport.totalUnfairnessMagnitude
    ) {
      return (
        left.matchupReport.totalUnfairnessMagnitude -
        right.matchupReport.totalUnfairnessMagnitude
      );
    }

    if (left.matchupReport.overallNetSpread !== right.matchupReport.overallNetSpread) {
      return left.matchupReport.overallNetSpread - right.matchupReport.overallNetSpread;
    }

    return left.signature.localeCompare(right.signature);
  });
}

function dedupeGeneratedMatchupCandidates(candidates: GeneratedMatchupScenarioCandidate[]) {
  return [...new Map(candidates.map((candidate) => [candidate.signature, candidate] as const)).values()];
}

function chooseBestMatchupBalancedAssignments(
  assignments: Assignments,
  teams: Team[],
  availablePlayers: Player[],
  batchAttempts: number,
  matchupLookup: MatchupScoreLookup
): ScenarioGenerationResult {
  if (availablePlayers.length === 0) {
    return {
      assignments,
      generatedCount: 0,
      candidates: []
    };
  }

  const totalSlotCount = teams.length * POSITIONS.length;
  let totalAttempts = 0;
  let fullRosterCount = 0;
  const fullCandidates: GeneratedMatchupScenarioCandidate[] = [];
  const partialCandidates: GeneratedMatchupScenarioCandidate[] = [];

  while (
    totalAttempts < BALANCED_ASSIGNMENT_MAX_ATTEMPTS &&
    fullRosterCount < BALANCED_ASSIGNMENT_MIN_FULL_ROSTERS
  ) {
    const attemptsThisBatch = Math.min(
      batchAttempts,
      BALANCED_ASSIGNMENT_MAX_ATTEMPTS - totalAttempts
    );

    for (let attempt = 0; attempt < attemptsThisBatch; attempt += 1) {
      const nextAssignments = randomizeRemainingAssignments(assignments, teams, availablePlayers);
      const nextCandidate = buildGeneratedMatchupScenarioCandidate(
        nextAssignments,
        teams,
        matchupLookup
      );

      if (nextCandidate.filledCount === totalSlotCount) {
        fullRosterCount += 1;
        fullCandidates.push(nextCandidate);
        continue;
      }

      partialCandidates.push(nextCandidate);
    }

    totalAttempts += attemptsThisBatch;
  }

  const orderedCandidates = sortMatchupCandidates(
    dedupeGeneratedMatchupCandidates(
      fullCandidates.length > 0 ? fullCandidates : partialCandidates
    )
  );

  return buildScenarioGenerationResult(totalAttempts, orderedCandidates, assignments);
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

function buildScenarioTeamDrafts(scenarios: Scenario[]): ScenarioTeamDrafts {
  return Object.fromEntries(
    scenarios.map((scenario) => [
      scenario.id,
      Object.fromEntries(
        scenario.teams.map((team, index) => [
          team.id,
          {
            name: team.name,
            color: normalizeTeamColor(team.color, TEAM_COLOR_PALETTE[index] ?? TEAM_COLOR_PALETTE[0])
          }
        ])
      )
    ])
  );
}

function mergeScenarioTeamDrafts(currentDrafts: ScenarioTeamDrafts, scenarios: Scenario[]): ScenarioTeamDrafts {
  return Object.fromEntries(
    scenarios.map((scenario) => [
      scenario.id,
      Object.fromEntries(
        scenario.teams.map((team, index) => [
          team.id,
          currentDrafts[scenario.id]?.[team.id] ?? {
            name: team.name,
            color: normalizeTeamColor(team.color, TEAM_COLOR_PALETTE[index] ?? TEAM_COLOR_PALETTE[0])
          }
        ])
      )
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

function getScenarioTeamSignature(scenario: Scenario) {
  return JSON.stringify(scenarioTeamsToRows(scenario));
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

function orderPlayersForPoolColumns(players: Player[], columnCount = 2) {
  if (columnCount <= 1 || players.length <= 1) {
    return players;
  }

  const rowCount = Math.ceil(players.length / columnCount);
  const columns = Array.from({ length: columnCount }, (_, columnIndex) =>
    players.slice(columnIndex * rowCount, (columnIndex + 1) * rowCount)
  );
  const ordered: Player[] = [];

  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
      const player = columns[columnIndex][rowIndex];
      if (player) {
        ordered.push(player);
      }
    }
  }

  return ordered;
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
  const { loading, rosterHydrated, players, retrySync, syncError: playerSyncError } =
    useTournamentBuilder();
  const cellRefs = useRef(new Map<string, HTMLDivElement>());
  const wrapRefs = useRef(new Map<string, HTMLDivElement>());
  const chipRefs = useRef(new Map<string, HTMLDivElement>());
  const availableChipRefs = useRef(new Map<string, HTMLDivElement>());
  const poolRefs = useRef(new Map<string, HTMLDivElement>());
  const statsBalanceFilterRefs = useRef(new Map<string, HTMLDivElement>());
  const scenarioCardRefs = useRef(new Map<string, HTMLElement>());
  const scenarioRectsRef = useRef(new Map<string, DOMRect>());
  const previewTargetRef = useRef<ScenarioSlot | null>(null);
  const poolHoverRef = useRef<string | null>(null);
  const initialScenarios = useMemo(() => [createScenario(1, run.slug)], [run.slug]);
  const storageKey = useMemo(
    () => buildRunScopedStorageKey(TEAM_SCENARIOS_STORAGE_KEY, run.slug),
    [run.slug]
  );
  const scenarioTeamCommitTimeoutsRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const latestScenariosRef = useRef<Scenario[]>(initialScenarios);
  const lastSyncedScenarioMetaSignatureRef = useRef(
    getScenarioMetaSignature(latestScenariosRef.current, run.id)
  );
  const lastSyncedScenarioTeamSignaturesRef = useRef(
    new Map(
      latestScenariosRef.current.map((scenario) => [scenario.id, getScenarioTeamSignature(scenario)])
    )
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
  const pendingScenarioTeamsRef = useRef<Scenario[] | null>(null);
  const dirtyScenarioTeamIdsRef = useRef(new Set<string>());
  const pendingScenarioAssignmentsRef = useRef<Scenario[] | null>(null);
  const dirtyScenarioAssignmentIdsRef = useRef(new Set<string>());
  const scenarioMetaSyncInFlightRef = useRef(false);
  const scenarioTeamSyncInFlightRef = useRef(false);
  const scenarioAssignmentSyncInFlightRef = useRef(false);
  const suppressScenarioRealtimeRef = useRef(false);
  const scenarioRefreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scenarioRefreshInFlightRef = useRef(false);
  const scenarioRefreshQueuedRef = useRef(false);
  const scenarioMetaSyncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scenarioTeamSyncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scenarioAssignmentSyncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [scenarios, setScenarios] = useState<Scenario[]>(initialScenarios);
  const [scenarioTeamDrafts, setScenarioTeamDrafts] = useState<ScenarioTeamDrafts>(
    buildScenarioTeamDrafts(initialScenarios)
  );
  const scenarioTeamDraftsRef = useRef<ScenarioTeamDrafts>(buildScenarioTeamDrafts(initialScenarios));
  const [nextScenarioNumber, setNextScenarioNumber] = useState(2);
  const [storageHydrated, setStorageHydrated] = useState(false);
  const [bootstrapSyncRequestVersion, setBootstrapSyncRequestVersion] = useState(0);
  const [scenarioSyncError, setScenarioSyncError] = useState<string | null>(null);
  const [scenarioTeamSyncError, setScenarioTeamSyncError] = useState<string | null>(null);
  const [scenarioActionState, setScenarioActionState] = useState<ScenarioActionState | null>(null);
  const [scenarioActionSummaries, setScenarioActionSummaries] = useState<
    Record<string, ScenarioActionSummary | null>
  >({});
  const scenarioActionSummariesRef = useRef<Record<string, ScenarioActionSummary | null>>({});
  const [scenarioUndoStacks, setScenarioUndoStacks] = useState<
    ScenarioHistoryStacks
  >({});
  const [scenarioRedoStacks, setScenarioRedoStacks] = useState<ScenarioHistoryStacks>({});
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
  const [matchupBundleState, setMatchupBundleState] = useState<MatchupBundleRequestState>({
    status: "loading",
    error: null,
    data: null
  });
  const [analyticsModeByScenario, setAnalyticsModeByScenario] = useState<
    Record<string, ScenarioAnalyticsMode>
  >({});
  const [statsBalanceSelectionByScenario, setStatsBalanceSelectionByScenario] = useState<
    Record<string, StatsBalanceLeafKey[]>
  >(() =>
    Object.fromEntries(
      initialScenarios.map((scenario) => [scenario.id, getDefaultStatsBalanceSelection()])
    )
  );
  const [openStatsBalanceFilterScenarioId, setOpenStatsBalanceFilterScenarioId] = useState<string | null>(
    null
  );
  const [scenarioWrappedTeamNames, setScenarioWrappedTeamNames] = useState<
    Record<string, Record<string, boolean>>
  >({});

  const playerById = useMemo(
    () => new Map(players.map((player) => [player.id, player])),
    [players]
  );

  const scenarioById = useMemo(
    () => new Map(scenarios.map((scenario) => [scenario.id, scenario])),
    [scenarios]
  );

  const draftTeamsByScenario = useMemo(
    () =>
      new Map(
        scenarios.map((scenario) => [
          scenario.id,
          scenario.teams.map((team, index) => ({
            ...team,
            name: scenarioTeamDrafts[scenario.id]?.[team.id]?.name ?? team.name,
            color:
              scenarioTeamDrafts[scenario.id]?.[team.id]?.color ??
              normalizeTeamColor(team.color, TEAM_COLOR_PALETTE[index] ?? TEAM_COLOR_PALETTE[0])
          }))
        ] as const)
      ),
    [scenarioTeamDrafts, scenarios]
  );
  const teamNameErrorsByScenario = useMemo(
    () =>
      Object.fromEntries(
        scenarios.map((scenario) => [
          scenario.id,
          getTeamNameErrors(draftTeamsByScenario.get(scenario.id) ?? scenario.teams)
        ])
      ) as Record<string, Array<string | null>>,
    [draftTeamsByScenario, scenarios]
  );
  const matchupLookup = useMemo(
    () => buildMatchupScoreLookup(matchupBundleState.status === "ready" ? matchupBundleState.data : null),
    [matchupBundleState]
  );
  const scenarioMatchupReports = useMemo(
    () =>
      Object.fromEntries(
        scenarios.map((scenario) => [
          scenario.id,
          buildScenarioMatchupReport(scenario.assignments, scenario.teams, matchupLookup)
        ])
      ) as Record<string, ScenarioMatchupReport>,
    [matchupLookup, scenarios]
  );
  const scenarioMatchupSwapSuggestions = useMemo(
    () =>
      Object.fromEntries(
        scenarios.map((scenario) => {
          const isComplete =
            countFilledAssignments(scenario.assignments) === scenario.teams.length * POSITIONS.length;

          return [
            scenario.id,
            isComplete
              ? findBestScenarioMatchupSwapSuggestions(
                  scenario.assignments,
                  scenario.teams,
                  playerById,
                  matchupLookup,
                  scenarioMatchupReports[scenario.id]
                )
              : {
                  goal1: null,
                  goal2: null,
                  goal3: null
                }
          ] as const;
        })
      ) as Record<string, ScenarioMatchupSwapSuggestions>,
    [matchupLookup, playerById, scenarioMatchupReports, scenarios]
  );
  const scenarioStatsBalancerReports = useMemo(
    () =>
      Object.fromEntries(
        scenarios.map((scenario) => [
          scenario.id,
          buildScenarioStatsBalancerReport(scenario.assignments, scenario.teams, playerById)
        ])
      ) as Record<string, ScenarioStatsBalancerReport>,
    [playerById, scenarios]
  );

  useEffect(() => {
    setScenarioTeamDrafts((current) => mergeScenarioTeamDrafts(current, scenarios));
  }, [scenarios]);

  useEffect(() => {
    scenarioTeamDraftsRef.current = scenarioTeamDrafts;
  }, [scenarioTeamDrafts]);

  useEffect(() => {
    latestScenariosRef.current = scenarios;
  }, [scenarios]);

  useEffect(() => {
    scenarioActionSummariesRef.current = scenarioActionSummaries;
  }, [scenarioActionSummaries]);

  useEffect(() => {
    const validScenarioIds = new Set(scenarios.map((scenario) => scenario.id));

    setScenarioActionSummaries((current) => {
      const nextEntries = Object.entries(current).filter(([scenarioId]) =>
        validScenarioIds.has(scenarioId)
      );

      return nextEntries.length === Object.keys(current).length
        ? current
        : Object.fromEntries(nextEntries);
    });

    setScenarioUndoStacks((current) => {
      const nextEntries = Object.entries(current).filter(([scenarioId]) =>
        validScenarioIds.has(scenarioId)
      );

      return nextEntries.length === Object.keys(current).length
        ? current
        : Object.fromEntries(nextEntries);
    });

    setScenarioRedoStacks((current) => {
      const nextEntries = Object.entries(current).filter(([scenarioId]) =>
        validScenarioIds.has(scenarioId)
      );

      return nextEntries.length === Object.keys(current).length
        ? current
        : Object.fromEntries(nextEntries);
    });

    setAnalyticsModeByScenario((current) => {
      const nextEntries = Object.entries(current).filter(([scenarioId]) =>
        validScenarioIds.has(scenarioId)
      );

      return nextEntries.length === Object.keys(current).length
        ? current
        : Object.fromEntries(nextEntries);
    });

    setStatsBalanceSelectionByScenario((current) => {
      let didChange = false;
      const nextEntries = scenarios.map((scenario) => {
        const existingSelection = current[scenario.id];
        const nextSelection = existingSelection
          ? normalizeStatsBalanceSelection(existingSelection)
          : getDefaultStatsBalanceSelection();

        if (
          !existingSelection ||
          !areStatsBalanceSelectionsEqual(existingSelection, nextSelection)
        ) {
          didChange = true;
        }

        return [scenario.id, nextSelection] as const;
      });

      if (!didChange && nextEntries.length === Object.keys(current).length) {
        return current;
      }

      return Object.fromEntries(nextEntries);
    });
  }, [scenarios]);

  useEffect(() => {
    if (
      openStatsBalanceFilterScenarioId &&
      !scenarios.some((scenario) => scenario.id === openStatsBalanceFilterScenarioId)
    ) {
      setOpenStatsBalanceFilterScenarioId(null);
    }
  }, [openStatsBalanceFilterScenarioId, scenarios]);

  useEffect(() => {
    const validTeamsByScenario = new Map(
      scenarios.map((scenario) => [scenario.id, new Set(scenario.teams.map((team) => team.id))] as const)
    );

    setScenarioWrappedTeamNames((current) => {
      let didChange = false;
      const nextEntries = Object.entries(current).flatMap(([scenarioId, wrappedByTeamId]) => {
        const validTeamIds = validTeamsByScenario.get(scenarioId);
        if (!validTeamIds) {
          didChange = true;
          return [];
        }

        const nextWrappedByTeamId = Object.fromEntries(
          Object.entries(wrappedByTeamId).filter(([teamId]) => validTeamIds.has(teamId))
        );

        if (Object.keys(nextWrappedByTeamId).length !== Object.keys(wrappedByTeamId).length) {
          didChange = true;
        }

        return [[scenarioId, nextWrappedByTeamId] as const];
      });

      return didChange ? Object.fromEntries(nextEntries) : current;
    });
  }, [scenarios]);

  useEffect(() => {
    if (!openStatsBalanceFilterScenarioId) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const container = statsBalanceFilterRefs.current.get(openStatsBalanceFilterScenarioId);
      if (container && event.target instanceof Node && !container.contains(event.target)) {
        setOpenStatsBalanceFilterScenarioId(null);
      }
    };

    window.addEventListener("mousedown", handlePointerDown);
    return () => window.removeEventListener("mousedown", handlePointerDown);
  }, [openStatsBalanceFilterScenarioId]);

  useEffect(() => {
    let cancelled = false;

    setMatchupBundleState({
      status: "loading",
      error: null,
      data: null
    });

    async function loadMatchupBundle() {
      try {
        const response = await fetch(buildRunApiPath(run.slug, "matchup-visualizer/chord"), {
          cache: "no-store"
        });
        const payload = (await response.json()) as
          | MatchupVisualizerBundleResponse
          | { error?: string };
        const payloadError = "error" in payload ? payload.error : undefined;

        if (!response.ok || !("datasets" in payload)) {
          throw new Error(payloadError ?? "Unable to load matchup comparison data.");
        }

        if (cancelled) {
          return;
        }

        setMatchupBundleState({
          status: "ready",
          error: null,
          data: payload
        });
      } catch (error) {
        if (cancelled) {
          return;
        }

        setMatchupBundleState({
          status: "error",
          error:
            error instanceof Error ? error.message : "Unable to load matchup comparison data.",
          data: null
        });
      }
    }

    void loadMatchupBundle();

    return () => {
      cancelled = true;
    };
  }, [run.slug]);

  const syncScenarioRefsFromSnapshot = useCallback((snapshot: Scenario[]) => {
    lastSyncedScenarioMetaSignatureRef.current = getScenarioMetaSignature(snapshot, run.id);
    lastSyncedScenarioTeamSignaturesRef.current = new Map(
      snapshot.map((scenario) => [scenario.id, getScenarioTeamSignature(scenario)])
    );
    lastSyncedScenarioAssignmentSignaturesRef.current = new Map(
      snapshot.map((scenario) => [
        scenario.id,
        getScenarioAssignmentSignature(scenario.assignments)
      ])
    );
  }, [run.id]);

  const fetchScenariosSnapshot = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
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
    const [scenarioTeamResult, assignmentResult] = await Promise.all([
      scenarioIds.length > 0
        ? supabase
            .from("scenario_teams")
            .select(SCENARIO_TEAM_SELECT_COLUMNS)
            .in("scenario_id", scenarioIds)
            .order("scenario_id", { ascending: true })
            .order("display_order", { ascending: true })
        : Promise.resolve({ data: [], error: null }),
      scenarioIds.length > 0
        ? supabase
            .from("scenario_assignments")
            .select("scenario_id,team_id,position,player_id")
            .in("scenario_id", scenarioIds)
            .order("scenario_id", { ascending: true })
        : Promise.resolve({ data: [], error: null })
    ]);

    if (scenarioTeamResult.error) {
      throw scenarioTeamResult.error;
    }

    if (assignmentResult.error) {
      throw assignmentResult.error;
    }

    return {
      scenarioRows: scenarioRows ?? [],
      scenarioTeamRows: scenarioTeamResult.data ?? [],
      assignmentRows: assignmentResult.data ?? []
    };
  }, [run.id]);

  useEffect(() => {
    let cancelled = false;
    const storedState = parseStoredScenarioState(window.localStorage.getItem(storageKey));
    const normalizedScenarios =
      storedState?.scenarios.length
        ? normalizeScenarioIds(storedState.scenarios).map((scenario) => ({
            ...scenario,
            collapsed: true
          }))
        : [];

    if (normalizedScenarios.length > 0) {
      setScenarios(normalizedScenarios);
      setNextScenarioNumber(
        Math.max(
          storedState?.nextScenarioNumber ?? normalizedScenarios.length + 1,
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
        const { scenarioRows, scenarioTeamRows, assignmentRows } = await fetchScenariosSnapshot();
        const backendScenarios = buildScenarioState(
          scenarioRows,
          scenarioTeamRows,
          assignmentRows,
          normalizedScenarios
        ).filter((scenario) => scenario.teams.length > 0);

        if (cancelled) {
          return;
        }

        if (
          normalizedScenarios.length > 0 &&
          scenarioRows.length === 0 &&
          scenarioTeamRows.length === 0
        ) {
          setScenarios(normalizedScenarios);
          setNextScenarioNumber(
            Math.max(
              storedState?.nextScenarioNumber ?? normalizedScenarios.length + 1,
              getNextScenarioNumber(normalizedScenarios)
            )
          );
          pendingScenarioMetaRef.current = normalizedScenarios;
          pendingScenarioTeamsRef.current = normalizedScenarios;
          pendingScenarioAssignmentsRef.current = normalizedScenarios;
          dirtyScenarioTeamIdsRef.current = new Set(
            normalizedScenarios.map((scenario) => scenario.id)
          );
          dirtyScenarioAssignmentIdsRef.current = new Set(
            normalizedScenarios.map((scenario) => scenario.id)
          );
          suppressScenarioRealtimeRef.current = true;
          setScenarioSyncError("Syncing local scenarios to Supabase.");
          setScenarioTeamSyncError("Syncing local scenario teams to Supabase.");
          setBootstrapSyncRequestVersion((current) => current + 1);
          return;
        }

        if (backendScenarios.length === 0 && scenarioTeamRows.length === 0) {
          const seededScenarios = [createScenario(1, run.slug)];
          setScenarios(seededScenarios);
          setNextScenarioNumber(getNextScenarioNumber(seededScenarios));
          pendingScenarioMetaRef.current = seededScenarios;
          pendingScenarioTeamsRef.current = seededScenarios;
          pendingScenarioAssignmentsRef.current = seededScenarios;
          dirtyScenarioTeamIdsRef.current = new Set(seededScenarios.map((scenario) => scenario.id));
          dirtyScenarioAssignmentIdsRef.current = new Set(
            seededScenarios.map((scenario) => scenario.id)
          );
          setScenarioSyncError("Creating default scenarios for this run.");
          setScenarioTeamSyncError("Creating default scenario teams for this run.");
          suppressScenarioRealtimeRef.current = true;
          setBootstrapSyncRequestVersion((current) => current + 1);
          return;
        }

        setScenarios(backendScenarios);
        setNextScenarioNumber(backendScenarios.length > 0 ? getNextScenarioNumber(backendScenarios) : 1);
        syncScenarioRefsFromSnapshot(backendScenarios);
        setScenarioSyncError(null);
        setScenarioTeamSyncError(null);
        suppressScenarioRealtimeRef.current = false;
      } catch {
        if (!cancelled) {
          setScenarioSyncError("Unable to load scenarios from Supabase. Using local data.");
          setScenarioTeamSyncError("Unable to load scenario teams from Supabase. Using local data.");
        }
      }
    }

    void loadScenariosFromSupabase();

    return () => {
      cancelled = true;
    };
  }, [fetchScenariosSnapshot, run.slug, storageKey, syncScenarioRefsFromSnapshot]);

  useEffect(() => {
    if (!storageHydrated) {
      return;
    }

    window.localStorage.setItem(
      storageKey,
      JSON.stringify({
        nextScenarioNumber,
        scenarios
      } satisfies PersistedScenarioState)
    );
  }, [nextScenarioNumber, scenarios, storageHydrated, storageKey]);

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

        const { error: upsertScenariosError } = await supabase
          .from("team_scenarios")
          .upsert(scenarioRows, { onConflict: "id" });
        if (upsertScenariosError) {
          throw upsertScenariosError;
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

  const flushScenarioTeamsSync = useCallback(async () => {
    if (!hasSupabaseBrowserConfig() || scenarioTeamSyncInFlightRef.current) {
      return;
    }

    if (pendingScenarioMetaRef.current || scenarioMetaSyncInFlightRef.current) {
      await flushScenarioMetaSync();
      if (pendingScenarioMetaRef.current || scenarioMetaSyncInFlightRef.current) {
        return;
      }
    }

    const snapshot = pendingScenarioTeamsRef.current;
    if (!snapshot || dirtyScenarioTeamIdsRef.current.size === 0) {
      return;
    }

    scenarioTeamSyncInFlightRef.current = true;

    while (pendingScenarioTeamsRef.current && dirtyScenarioTeamIdsRef.current.size > 0) {
      const nextSnapshot = pendingScenarioTeamsRef.current;
      const dirtyScenarioIds = Array.from(dirtyScenarioTeamIdsRef.current);
      pendingScenarioTeamsRef.current = null;
      dirtyScenarioTeamIdsRef.current = new Set();

      try {
        const supabase = getSupabaseBrowserClient();
        const snapshotByScenarioId = new Map(
          nextSnapshot.map((scenario) => [scenario.id, scenario] as const)
        );
        const scenarioTeamRows = dirtyScenarioIds.flatMap((scenarioId) => {
          const scenario = snapshotByScenarioId.get(scenarioId);
          return scenario ? scenarioTeamsToRows(scenario) : [];
        });

        const { error: deleteScenarioTeamsError } = await supabase
          .from("scenario_teams")
          .delete()
          .in("scenario_id", dirtyScenarioIds);
        if (deleteScenarioTeamsError) {
          throw deleteScenarioTeamsError;
        }

        if (scenarioTeamRows.length > 0) {
          const { error: insertScenarioTeamsError } = await supabase
            .from("scenario_teams")
            .insert(scenarioTeamRows);
          if (insertScenarioTeamsError) {
            throw insertScenarioTeamsError;
          }
        }

        const nextTeamSignatures = new Map(lastSyncedScenarioTeamSignaturesRef.current);
        for (const scenarioId of dirtyScenarioIds) {
          const scenario = snapshotByScenarioId.get(scenarioId);
          if (scenario) {
            nextTeamSignatures.set(scenarioId, getScenarioTeamSignature(scenario));
          } else {
            nextTeamSignatures.delete(scenarioId);
          }
        }
        lastSyncedScenarioTeamSignaturesRef.current = nextTeamSignatures;
        setScenarioTeamSyncError(null);
        suppressScenarioRealtimeRef.current = false;
      } catch {
        pendingScenarioTeamsRef.current = latestScenariosRef.current;
        dirtyScenarioTeamIdsRef.current = new Set([
          ...dirtyScenarioIds,
          ...dirtyScenarioTeamIdsRef.current
        ]);
        setScenarioTeamSyncError("Changes saved locally. Scenario team sync failed.");
        suppressScenarioRealtimeRef.current = true;
        break;
      }
    }

    scenarioTeamSyncInFlightRef.current = false;
  }, [flushScenarioMetaSync]);

  const flushScenarioAssignmentsSync = useCallback(async () => {
    if (!hasSupabaseBrowserConfig() || scenarioAssignmentSyncInFlightRef.current) {
      return;
    }

    if (pendingScenarioTeamsRef.current || scenarioTeamSyncInFlightRef.current) {
      await flushScenarioTeamsSync();
      if (pendingScenarioTeamsRef.current || scenarioTeamSyncInFlightRef.current) {
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
  }, [flushScenarioMetaSync, flushScenarioTeamsSync]);

  const flushPendingScenarioSync = useCallback(async () => {
    await flushScenarioMetaSync();
    await flushScenarioTeamsSync();
    await flushScenarioAssignmentsSync();
  }, [flushScenarioAssignmentsSync, flushScenarioMetaSync, flushScenarioTeamsSync]);

  const scheduleScenarioTeamsSync = useCallback(
    (immediate = false) => {
      if (!hasSupabaseBrowserConfig()) {
        return;
      }

      if (scenarioTeamSyncTimeoutRef.current) {
        clearTimeout(scenarioTeamSyncTimeoutRef.current);
        scenarioTeamSyncTimeoutRef.current = null;
      }

      if (immediate) {
        void flushScenarioTeamsSync();
        return;
      }

      scenarioTeamSyncTimeoutRef.current = setTimeout(() => {
        scenarioTeamSyncTimeoutRef.current = null;
        void flushScenarioTeamsSync();
      }, SCENARIO_SYNC_DEBOUNCE_MS);
    },
    [flushScenarioTeamsSync]
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

  const queueScenarioTeamsSync = useCallback(
    (snapshot: Scenario[], dirtyScenarioIds: string[], options?: { immediate?: boolean }) => {
      if (!hasSupabaseBrowserConfig()) {
        return;
      }

      const nextDirtyScenarioIds = dirtyScenarioIds.filter((scenarioId) => {
        const scenario = snapshot.find((candidate) => candidate.id === scenarioId);
        const nextSignature = scenario ? getScenarioTeamSignature(scenario) : null;
        const previousSignature =
          lastSyncedScenarioTeamSignaturesRef.current.get(scenarioId) ?? null;
        return nextSignature !== previousSignature;
      });

      if (nextDirtyScenarioIds.length === 0) {
        return;
      }

      pendingScenarioTeamsRef.current = snapshot;
      for (const scenarioId of nextDirtyScenarioIds) {
        dirtyScenarioTeamIdsRef.current.add(scenarioId);
      }
      scheduleScenarioTeamsSync(options?.immediate ?? false);
    },
    [scheduleScenarioTeamsSync]
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
      if (
        pendingScenarioMetaRef.current ||
        pendingScenarioTeamsRef.current ||
        pendingScenarioAssignmentsRef.current
      ) {
        void flushPendingScenarioSync();
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        void flushPendingScenarioSync();
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
  }, [flushPendingScenarioSync]);

  useEffect(() => {
    if (
      storageHydrated &&
      (
        pendingScenarioMetaRef.current ||
        pendingScenarioTeamsRef.current ||
        pendingScenarioAssignmentsRef.current
      )
    ) {
      void flushPendingScenarioSync();
    }
  }, [bootstrapSyncRequestVersion, flushPendingScenarioSync, storageHydrated]);

  useEffect(
    () => () => {
      for (const timeout of scenarioTeamCommitTimeoutsRef.current.values()) {
        clearTimeout(timeout);
      }
      scenarioTeamCommitTimeoutsRef.current.clear();
      if (scenarioMetaSyncTimeoutRef.current) {
        clearTimeout(scenarioMetaSyncTimeoutRef.current);
      }
      if (scenarioTeamSyncTimeoutRef.current) {
        clearTimeout(scenarioTeamSyncTimeoutRef.current);
      }
      if (scenarioAssignmentSyncTimeoutRef.current) {
        clearTimeout(scenarioAssignmentSyncTimeoutRef.current);
      }
    },
    []
  );

  useEffect(() => {
    // Wait until the roster has finished hydrating from the backend before pruning scenario slots.
    if (loading || !rosterHydrated) {
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

      queueScenarioAssignmentsSync(nextScenarios, dirtyScenarioIds);
      return nextScenarios;
    });
  }, [loading, players, queueScenarioAssignmentsSync, rosterHydrated]);

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
        const { scenarioRows, scenarioTeamRows, assignmentRows } = await fetchScenariosSnapshot();
        const backendScenarios = buildScenarioState(
          scenarioRows,
          scenarioTeamRows,
          assignmentRows,
          latestScenariosRef.current
        ).filter((scenario) => scenario.teams.length > 0);

        if (!active) {
          return;
        }

        setScenarios((current) =>
          areScenariosEquivalent(current, backendScenarios) ? current : backendScenarios
        );
        setNextScenarioNumber(backendScenarios.length > 0 ? getNextScenarioNumber(backendScenarios) : 1);
        syncScenarioRefsFromSnapshot(backendScenarios);
        setScenarioSyncError((current) =>
          current === "Unable to load scenarios from Supabase. Using local data." ? null : current
        );
        setScenarioTeamSyncError((current) =>
          current === "Unable to load scenario teams from Supabase. Using local data." ? null : current
        );
      } catch {
        if (active) {
          setScenarioSyncError("Unable to refresh scenarios from Supabase. Using local data.");
          setScenarioTeamSyncError("Unable to refresh scenario teams from Supabase. Using local data.");
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
      .on("postgres_changes", { event: "*", schema: "public", table: "team_scenarios" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "scenario_teams" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "scenario_assignments" }, scheduleRefresh)
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
  }, [fetchScenariosSnapshot, run.slug, syncScenarioRefsFromSnapshot]);

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

  const updateScenarioTeams = useCallback(
    (
      scenarioId: string,
      updater: (teams: Team[]) => Team[],
      options?: { immediate?: boolean }
    ) => {
      setScenarios((currentScenarios) => {
        let didChange = false;
        const nextScenarios = currentScenarios.map((scenario) => {
          if (scenario.id !== scenarioId) {
            return scenario;
          }

          const updatedTeams = updater(scenario.teams)
            .slice(0, MAX_TEAMS)
            .map((team, index) => ({
              ...team,
              color: normalizeTeamColor(team.color, TEAM_COLOR_PALETTE[index] ?? TEAM_COLOR_PALETTE[0]),
              displayOrder: index + 1
            }));
          const nextAssignments = reconcileAssignmentsToTeams(scenario.assignments, updatedTeams);

          if (
            areTeamsEqual(scenario.teams, updatedTeams) &&
            areAssignmentsEqual(scenario.assignments, nextAssignments)
          ) {
            return scenario;
          }

          didChange = true;
          return {
            ...scenario,
            teams: updatedTeams,
            assignments: nextAssignments
          };
        });

        if (!didChange) {
          return currentScenarios;
        }

        setScenarioRedoStacks((current) => {
          if (!(scenarioId in current)) {
            return current;
          }

          const next = { ...current };
          delete next[scenarioId];
          return next;
        });
        queueScenarioTeamsSync(nextScenarios, [scenarioId], options);
        queueScenarioAssignmentsSync(nextScenarios, [scenarioId], options);
        return nextScenarios;
      });
    },
    [queueScenarioAssignmentsSync, queueScenarioTeamsSync]
  );

  const updateScenarioTeamDraftName = useCallback((scenarioId: string, teamId: string, name: string) => {
    setScenarioTeamDrafts((currentDrafts) => ({
      ...currentDrafts,
      [scenarioId]: {
        ...currentDrafts[scenarioId],
        [teamId]: {
          name,
          color:
            currentDrafts[scenarioId]?.[teamId]?.color ??
            normalizeTeamColor(
              latestScenariosRef.current
                .find((scenario) => scenario.id === scenarioId)
                ?.teams.find((team) => team.id === teamId)?.color ?? TEAM_COLOR_PALETTE[0]
            )
        }
      }
    }));
  }, []);

  const commitScenarioTeamName = useCallback(
    (scenarioId: string, teamId: string, options?: { immediate?: boolean }) => {
      const scenario = latestScenariosRef.current.find((candidate) => candidate.id === scenarioId);
      if (!scenario) {
        return;
      }

      const scenarioDrafts = scenarioTeamDraftsRef.current[scenarioId] ?? {};
      const draftName = scenarioDrafts[teamId]?.name ?? "";
      const nextDraftTeams = scenario.teams.map((team, index) => ({
        ...team,
        name: scenarioDrafts[team.id]?.name ?? team.name,
        color:
          scenarioDrafts[team.id]?.color ??
          normalizeTeamColor(team.color, TEAM_COLOR_PALETTE[index] ?? TEAM_COLOR_PALETTE[0])
      }));
      const nameErrors = getTeamNameErrors(nextDraftTeams);
      const teamIndex = nextDraftTeams.findIndex((team) => team.id === teamId);
      if (teamIndex === -1 || nameErrors[teamIndex]) {
        return;
      }

      updateScenarioTeams(
        scenarioId,
        (currentTeams) =>
          currentTeams.map((team) => (team.id === teamId ? { ...team, name: draftName } : team)),
        options
      );
    },
    [updateScenarioTeams]
  );

  const scheduleScenarioTeamNameCommit = useCallback(
    (scenarioId: string, teamId: string) => {
      const key = getScenarioTeamCommitKey(scenarioId, teamId, "name");
      const existingTimeout = scenarioTeamCommitTimeoutsRef.current.get(key);
      if (existingTimeout) {
        clearTimeout(existingTimeout);
      }

      const timeout = setTimeout(() => {
        scenarioTeamCommitTimeoutsRef.current.delete(key);
        commitScenarioTeamName(scenarioId, teamId);
      }, TEAM_NAME_SCENARIO_COMMIT_DELAY_MS);

      scenarioTeamCommitTimeoutsRef.current.set(key, timeout);
    },
    [commitScenarioTeamName]
  );

  const updateScenarioTeamDraftColor = useCallback((scenarioId: string, teamId: string, color: string) => {
    const normalizedColor = normalizeTeamColor(color);
    setScenarioTeamDrafts((currentDrafts) => ({
      ...currentDrafts,
      [scenarioId]: {
        ...currentDrafts[scenarioId],
        [teamId]: {
          name:
            currentDrafts[scenarioId]?.[teamId]?.name ??
            latestScenariosRef.current
              .find((scenario) => scenario.id === scenarioId)
              ?.teams.find((team) => team.id === teamId)?.name ??
            "",
          color: normalizedColor
        }
      }
    }));
  }, []);

  const commitScenarioTeamColor = useCallback(
    (scenarioId: string, teamId: string, options?: { immediate?: boolean }) => {
      const draftColor = scenarioTeamDraftsRef.current[scenarioId]?.[teamId]?.color;
      if (!draftColor) {
        return;
      }

      updateScenarioTeams(
        scenarioId,
        (currentTeams) =>
          currentTeams.map((team) =>
            team.id === teamId ? { ...team, color: normalizeTeamColor(draftColor, team.color) } : team
          ),
        options
      );
    },
    [updateScenarioTeams]
  );

  const scheduleScenarioTeamColorCommit = useCallback(
    (scenarioId: string, teamId: string) => {
      const key = getScenarioTeamCommitKey(scenarioId, teamId, "color");
      const existingTimeout = scenarioTeamCommitTimeoutsRef.current.get(key);
      if (existingTimeout) {
        clearTimeout(existingTimeout);
      }

      const timeout = setTimeout(() => {
        scenarioTeamCommitTimeoutsRef.current.delete(key);
        commitScenarioTeamColor(scenarioId, teamId);
      }, TEAM_COLOR_SCENARIO_COMMIT_DELAY_MS);

      scenarioTeamCommitTimeoutsRef.current.set(key, timeout);
    },
    [commitScenarioTeamColor]
  );

  const handleScenarioTeamColorChange = useCallback(
    (scenarioId: string, teamId: string, color: string) => {
      updateScenarioTeamDraftColor(scenarioId, teamId, color);
      scheduleScenarioTeamColorCommit(scenarioId, teamId);
    },
    [scheduleScenarioTeamColorCommit, updateScenarioTeamDraftColor]
  );

  const addScenarioTeam = useCallback(
    (scenarioId: string) => {
      const scenario = latestScenariosRef.current.find((candidate) => candidate.id === scenarioId);
      if (!scenario || scenario.teams.length >= MAX_TEAMS) {
        return;
      }

      pushScenarioUndoSnapshot(scenarioId);
      updateScenarioTeams(scenarioId, (currentTeams) => [
        ...currentTeams,
        createTeam(currentTeams.length, currentTeams, run.slug)
      ]);
    },
    [run.slug, updateScenarioTeams]
  );

  const renameScenarioTeam = useCallback(
    (scenarioId: string, teamId: string) => {
      const scenario = latestScenariosRef.current.find((candidate) => candidate.id === scenarioId);
      if (!scenario) {
        return;
      }

      const pendingCommitKey = getScenarioTeamCommitKey(scenarioId, teamId, "name");
      const pendingTimeout = scenarioTeamCommitTimeoutsRef.current.get(pendingCommitKey);
      if (pendingTimeout) {
        clearTimeout(pendingTimeout);
        scenarioTeamCommitTimeoutsRef.current.delete(pendingCommitKey);
      }

      const draftTeams = scenarioTeamDraftsRef.current[scenarioId] ?? {};
      const existingNames = scenario.teams.map((team) => draftTeams[team.id]?.name ?? team.name);
      const playerNames = POSITIONS.map((position) => scenario.assignments[teamId]?.[position] ?? null)
        .map((playerId) => (playerId ? playerById.get(playerId)?.name.trim() ?? "" : ""))
        .filter(Boolean);
      const generatedName = generateScenarioTeamName({
        playerNames,
        existingNames
      });

      updateScenarioTeamDraftName(scenarioId, teamId, generatedName);
      updateScenarioTeams(
        scenarioId,
        (currentTeams) =>
          currentTeams.map((team) => (team.id === teamId ? { ...team, name: generatedName } : team)),
        { immediate: true }
      );
    },
    [playerById, updateScenarioTeamDraftName, updateScenarioTeams]
  );

  const removeScenarioTeam = useCallback(
    (scenarioId: string, teamId: string) => {
      const scenario = latestScenariosRef.current.find((candidate) => candidate.id === scenarioId);
      if (!scenario || scenario.teams.length <= 1) {
        return;
      }

      pushScenarioUndoSnapshot(scenarioId);
      setOpenPickerSlot((current) =>
        current?.scenarioId === scenarioId && current.slot.teamId === teamId ? null : current
      );
      setNearestSlot((current) =>
        current?.scenarioId === scenarioId && current.slot.teamId === teamId ? null : current
      );
      setPreviewTarget((current) =>
        current?.scenarioId === scenarioId && current.slot.teamId === teamId ? null : current
      );
      previewTargetRef.current =
        previewTargetRef.current?.scenarioId === scenarioId && previewTargetRef.current.slot.teamId === teamId
          ? null
          : previewTargetRef.current;

      updateScenarioTeams(
        scenarioId,
        (currentTeams) => currentTeams.filter((team) => team.id !== teamId),
        { immediate: true }
      );
    },
    [updateScenarioTeams]
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

  const setScenarioActionSummary = useCallback(
    (scenarioId: string, summary: ScenarioActionSummary | null) => {
      setScenarioActionSummaries((current) => {
        const currentSummary = current[scenarioId] ?? null;
        const nextSummary = cloneScenarioActionSummary(summary);

        if (areScenarioActionSummariesEqual(currentSummary, nextSummary)) {
          return current;
        }

        return {
          ...current,
          [scenarioId]: nextSummary
        };
      });
    },
    []
  );

  const getCurrentScenarioHistoryEntry = useCallback((scenarioId: string) => {
    const scenario = latestScenariosRef.current.find((candidate) => candidate.id === scenarioId);
    return scenario
      ? createScenarioHistoryEntry(scenario, scenarioActionSummariesRef.current[scenarioId] ?? null)
      : null;
  }, []);

  const pushScenarioUndoSnapshot = useCallback((scenarioId: string) => {
    const nextEntry = getCurrentScenarioHistoryEntry(scenarioId);
    if (!nextEntry) {
      return;
    }

    setScenarioUndoStacks((current) => appendScenarioHistoryEntry(current, scenarioId, nextEntry));
    setScenarioRedoStacks((current) => {
      if (!(scenarioId in current)) {
        return current;
      }

      const next = { ...current };
      delete next[scenarioId];
      return next;
    });
  }, [getCurrentScenarioHistoryEntry]);

  const animateScenarioHistoryRestore = useCallback(
    (scenarioId: string, fromAssignments: Assignments, toAssignments: Assignments) => {
      const changedPlayerIds = new Set<number>([
        ...getAssignedPlayerIds(fromAssignments),
        ...getAssignedPlayerIds(toAssignments)
      ]);
      const travelSnapshots = new Map<number, ChipTravelSnapshot>();
      const changedSlotKeys = new Set<string>();

      changedPlayerIds.forEach((playerId) => {
        const fromSlot = findPlayerSlot(fromAssignments, playerId);
        const toSlot = findPlayerSlot(toAssignments, playerId);

        if (areScenarioSlotsEqual(fromSlot, toSlot)) {
          return;
        }

        if (fromSlot) {
          changedSlotKeys.add(getScenarioSlotKey(scenarioId, fromSlot));
        }

        if (toSlot) {
          changedSlotKeys.add(getScenarioSlotKey(scenarioId, toSlot));
        }

        const originNode = fromSlot
          ? chipRefs.current.get(getScenarioSlotKey(scenarioId, fromSlot))
          : availableChipRefs.current.get(getAvailableChipKey(scenarioId, playerId));

        if (originNode) {
          travelSnapshots.set(playerId, captureChipTravelSnapshot(originNode));
        }
      });

      if (changedSlotKeys.size > 0) {
        setAnimatedSlots([...changedSlotKeys]);
        window.setTimeout(() => setAnimatedSlots([]), 220);
      }

      if (travelSnapshots.size === 0) {
        return;
      }

      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          changedPlayerIds.forEach((playerId) => {
            const snapshot = travelSnapshots.get(playerId);
            if (!snapshot) {
              return;
            }

            const destinationSlot = findPlayerSlot(toAssignments, playerId);
            const destinationNode = destinationSlot
              ? chipRefs.current.get(getScenarioSlotKey(scenarioId, destinationSlot))
              : availableChipRefs.current.get(getAvailableChipKey(scenarioId, playerId));

            if (destinationNode) {
              animateChipTravelSnapshot(snapshot, destinationNode);
            }
          });
        });
      });
    },
    []
  );

  const applyScenarioAssignmentsChange = useCallback(
    (
      scenarioId: string,
      updater: (assignments: Assignments) => Assignments,
      options?: { summary?: ScenarioActionSummary | null }
    ) => {
      const scenario = latestScenariosRef.current.find((candidate) => candidate.id === scenarioId);
      if (!scenario) {
        return false;
      }

      const currentAssignments = scenario.assignments;
      const nextAssignments = updater(currentAssignments);
      const currentSummary = scenarioActionSummariesRef.current[scenarioId] ?? null;
      const nextSummary =
        options && "summary" in options ? options.summary ?? null : currentSummary;

      if (
        areAssignmentsEqual(currentAssignments, nextAssignments) &&
        areScenarioActionSummariesEqual(currentSummary, nextSummary)
      ) {
        return false;
      }

      pushScenarioUndoSnapshot(scenarioId);
      setOpenPickerSlot((current) => (current?.scenarioId === scenarioId ? null : current));
      setSelectedAvailablePlayer((current) => (current?.scenarioId === scenarioId ? null : current));
      setScenarioActionSummary(scenarioId, nextSummary);
      updateScenarioAssignments(scenarioId, () => cloneAssignments(nextAssignments));
      return true;
    },
    [pushScenarioUndoSnapshot, setScenarioActionSummary]
  );

  const restoreScenarioHistoryEntry = useCallback(
    (
      scenarioId: string,
      entry: ScenarioHistoryEntry,
      options?: { animateFromAssignments?: Assignments | null }
    ) => {
      setOpenPickerSlot((current) => (current?.scenarioId === scenarioId ? null : current));
      setSelectedAvailablePlayer((current) => (current?.scenarioId === scenarioId ? null : current));
      setScenarioActionSummary(scenarioId, entry.summary);
      setScenarios((current) => {
        const nextScenarios = current.map((scenario) =>
          scenario.id === scenarioId
            ? {
                ...scenario,
                teams: cloneTeams(entry.teams),
                assignments: cloneAssignments(entry.assignments)
              }
            : scenario
        );
        queueScenarioTeamsSync(nextScenarios, [scenarioId], { immediate: true });
        queueScenarioAssignmentsSync(nextScenarios, [scenarioId], { immediate: true });
        return nextScenarios;
      });

      if (options?.animateFromAssignments) {
        animateScenarioHistoryRestore(
          scenarioId,
          cloneAssignments(options.animateFromAssignments),
          cloneAssignments(entry.assignments)
        );
      }
    },
    [
      animateScenarioHistoryRestore,
      queueScenarioAssignmentsSync,
      queueScenarioTeamsSync,
      setScenarioActionSummary
    ]
  );

  const undoScenarioAssignments = useCallback(
    (scenarioId: string) => {
      let entryToRestore: ScenarioHistoryEntry | null = null;
      const currentEntry = getCurrentScenarioHistoryEntry(scenarioId);

      setScenarioUndoStacks((current) => {
        const existingEntries = current[scenarioId] ?? [];
        if (existingEntries.length === 0) {
          return current;
        }

        entryToRestore = existingEntries[existingEntries.length - 1] ?? null;
        return {
          ...current,
          [scenarioId]: existingEntries.slice(0, -1)
        };
      });

      if (!entryToRestore || !currentEntry) {
        return;
      }

      setScenarioRedoStacks((current) => appendScenarioHistoryEntry(current, scenarioId, currentEntry));
      restoreScenarioHistoryEntry(scenarioId, entryToRestore, {
        animateFromAssignments: currentEntry.assignments
      });
    },
    [getCurrentScenarioHistoryEntry, restoreScenarioHistoryEntry]
  );

  const redoScenarioAssignments = useCallback(
    (scenarioId: string) => {
      let entryToRestore: ScenarioHistoryEntry | null = null;
      const currentEntry = getCurrentScenarioHistoryEntry(scenarioId);

      setScenarioRedoStacks((current) => {
        const existingEntries = current[scenarioId] ?? [];
        if (existingEntries.length === 0) {
          return current;
        }

        entryToRestore = existingEntries[existingEntries.length - 1] ?? null;
        return {
          ...current,
          [scenarioId]: existingEntries.slice(0, -1)
        };
      });

      if (!entryToRestore || !currentEntry) {
        return;
      }

      setScenarioUndoStacks((current) => appendScenarioHistoryEntry(current, scenarioId, currentEntry));
      restoreScenarioHistoryEntry(scenarioId, entryToRestore, {
        animateFromAssignments: currentEntry.assignments
      });
    },
    [getCurrentScenarioHistoryEntry, restoreScenarioHistoryEntry]
  );

  const beginScenarioAction = useCallback(
    (
      scenarioId: string,
      mode: ScenarioActionMode,
      computeResult: () => ScenarioGenerationResult,
      onComplete?: (result: ScenarioGenerationResult) => void,
      summaryOptions?: { balanceSummaryText?: string | null }
    ) => {
      setScenarioActionState({
        scenarioId,
        mode
      });
      setOpenStatsBalanceFilterScenarioId(null);
      setOpenPickerSlot(null);
      setSelectedAvailablePlayer((current) => (current?.scenarioId === scenarioId ? null : current));

      window.setTimeout(() => {
        const startedAt = performance.now();
        const result = computeResult();
        const elapsed = performance.now() - startedAt;
        const remainingDelay = Math.max(0, SCENARIO_ACTION_PROGRESS_MS - elapsed);

        window.setTimeout(() => {
          applyScenarioAssignmentsChange(scenarioId, () => result.assignments, {
            summary: {
              generatedCount: result.generatedCount,
              mode,
              candidates: result.candidates,
              currentIndex: 0,
              balanceSummaryText: summaryOptions?.balanceSummaryText ?? null
            }
          });
          onComplete?.(result);
          setScenarioActionState((current) =>
            current?.scenarioId === scenarioId && current.mode === mode ? null : current
          );
        }, remainingDelay);
      }, 0);
    },
    [applyScenarioAssignmentsChange]
  );

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
    setScenarios((current) => {
      const targetScenario = current.find((scenario) => scenario.id === scenarioId);
      const shouldExpand = Boolean(targetScenario?.collapsed);

      return current.map((scenario) => ({
        ...scenario,
        collapsed: scenario.id === scenarioId ? !shouldExpand : true
      }));
    });
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

    applyScenarioAssignmentsChange(scenarioId, (assignments) =>
      assignPlayerToSlot(assignments, playerId, slot)
    );
  };

  const clearScenarioSlot = (scenarioId: string, slot: SlotDescriptor) => {
    applyScenarioAssignmentsChange(scenarioId, (assignments) => clearSlot(assignments, slot));
  };

  const resetScenarioAssignments = (scenarioId: string) => {
    const scenario = scenarioById.get(scenarioId);
    if (!scenario) {
      return;
    }

    applyScenarioAssignmentsChange(scenarioId, () => createEmptyAssignments(scenario.teams), {
      summary: null
    });
  };

  const randomizeScenarioRemainingPlayers = (scenarioId: string) => {
    if (scenarioActionState) {
      return;
    }

    const scenario = scenarioById.get(scenarioId);
    const availablePlayers = (availablePlayersByScenario.get(scenarioId) ?? []).filter(
      canPlayerBeAssignedFromPool
    );
    if (!scenario || availablePlayers.length === 0) {
      return;
    }

    const hasEmptySlot = scenario.teams.some((team) =>
      POSITIONS.some((position) => (scenario.assignments[team.id]?.[position] ?? null) === null)
    );

    if (!hasEmptySlot) {
      return;
    }

    beginScenarioAction(
      scenarioId,
      "randomize",
      () =>
        chooseBestRandomizedAssignments(
        scenario.assignments,
        scenario.teams,
        availablePlayers,
          REMAINING_ASSIGNMENT_ATTEMPTS,
          playerById
        )
    );
  };

  const updateScenarioStatsBalanceSelection = useCallback(
    (
      scenarioId: string,
      updater: (selection: StatsBalanceLeafKey[]) => StatsBalanceLeafKey[]
    ) => {
      setStatsBalanceSelectionByScenario((current) => {
        const currentSelection = current[scenarioId] ?? getDefaultStatsBalanceSelection();
        const nextSelection = normalizeStatsBalanceSelection(updater(currentSelection));

        if (areStatsBalanceSelectionsEqual(currentSelection, nextSelection)) {
          return current;
        }

        return {
          ...current,
          [scenarioId]: nextSelection
        };
      });
    },
    []
  );

  const toggleScenarioStatsBalanceGroup = useCallback(
    (scenarioId: string, keys: StatsBalanceLeafKey[]) => {
      updateScenarioStatsBalanceSelection(scenarioId, (currentSelection) => {
        const currentSet = new Set(currentSelection);
        const shouldSelect = keys.some((key) => !currentSet.has(key));

        if (shouldSelect) {
          keys.forEach((key) => currentSet.add(key));
        } else {
          keys.forEach((key) => currentSet.delete(key));
        }

        return [...currentSet];
      });
    },
    [updateScenarioStatsBalanceSelection]
  );

  const toggleScenarioStatsBalanceLeaf = useCallback(
    (scenarioId: string, key: StatsBalanceLeafKey) => {
      updateScenarioStatsBalanceSelection(scenarioId, (currentSelection) => {
        const currentSet = new Set(currentSelection);

        if (currentSet.has(key)) {
          currentSet.delete(key);
        } else {
          currentSet.add(key);
        }

        return [...currentSet];
      });
    },
    [updateScenarioStatsBalanceSelection]
  );

  const selectAllScenarioStatsBalanceOptions = useCallback((scenarioId: string) => {
    setStatsBalanceSelectionByScenario((current) => {
      const nextSelection = getDefaultStatsBalanceSelection();
      const currentSelection = current[scenarioId] ?? nextSelection;

      if (areStatsBalanceSelectionsEqual(currentSelection, nextSelection)) {
        return current;
      }

      return {
        ...current,
        [scenarioId]: nextSelection
      };
    });
  }, []);

  const clearScenarioStatsBalanceOptions = useCallback((scenarioId: string) => {
    setStatsBalanceSelectionByScenario((current) => {
      const currentSelection = current[scenarioId] ?? getDefaultStatsBalanceSelection();
      if (currentSelection.length === 0) {
        return current;
      }

      return {
        ...current,
        [scenarioId]: []
      };
    });
  }, []);

  const runBalancedScenarioRemainingPlayers = (
    scenarioId: string
  ) => {
    if (scenarioActionState) {
      return;
    }

    const scenario = scenarioById.get(scenarioId);
    const selection = statsBalanceSelectionByScenario[scenarioId] ?? getDefaultStatsBalanceSelection();
    const normalizedSelection = normalizeStatsBalanceSelection(selection);
    const availablePlayers = (availablePlayersByScenario.get(scenarioId) ?? []).filter(
      canPlayerBeAssignedFromPool
    );
    if (!scenario || availablePlayers.length === 0 || normalizedSelection.length === 0) {
      return;
    }

    const hasEmptySlot = scenario.teams.some((team) =>
      POSITIONS.some((position) => (scenario.assignments[team.id]?.[position] ?? null) === null)
    );

    if (!hasEmptySlot) {
      return;
    }

    beginScenarioAction(
      scenarioId,
      "balanceStats",
      () =>
        chooseBestBalancedAssignments(
          scenario.assignments,
          scenario.teams,
          availablePlayers,
          playerById,
          REMAINING_ASSIGNMENT_ATTEMPTS,
          normalizedSelection
        ),
      undefined,
      {
        balanceSummaryText: buildStatsBalanceSummaryText(normalizedSelection)
      }
    );
  };

  const runMatchupBalancedScenarioRemainingPlayers = (scenarioId: string) => {
    if (scenarioActionState || matchupBundleState.status !== "ready") {
      return;
    }

    const scenario = scenarioById.get(scenarioId);
    const availablePlayers = (availablePlayersByScenario.get(scenarioId) ?? []).filter(
      canPlayerBeAssignedFromPool
    );
    if (!scenario || availablePlayers.length === 0) {
      return;
    }

    const hasEmptySlot = scenario.teams.some((team) =>
      POSITIONS.some((position) => (scenario.assignments[team.id]?.[position] ?? null) === null)
    );

    if (!hasEmptySlot) {
      return;
    }

    beginScenarioAction(scenarioId, "balanceMatchup", () =>
      chooseBestMatchupBalancedAssignments(
          scenario.assignments,
          scenario.teams,
          availablePlayers,
        REMAINING_ASSIGNMENT_ATTEMPTS,
        matchupLookup
      )
    );
  };

  const showNextGeneratedScenario = useCallback(
    (scenarioId: string) => {
      const summary = scenarioActionSummariesRef.current[scenarioId] ?? null;
      if (!summary || summary.currentIndex >= summary.candidates.length - 1) {
        return;
      }

      const nextIndex = summary.currentIndex + 1;
      const nextAssignments = summary.candidates[nextIndex];
      if (!nextAssignments) {
        return;
      }

      applyScenarioAssignmentsChange(scenarioId, () => nextAssignments, {
        summary: {
          ...summary,
          currentIndex: nextIndex
        }
      });
    },
    [applyScenarioAssignmentsChange]
  );

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
    const nextScenario = createScenario(nextScenarioNumber, run.slug);
    setScenarios((current) => {
      const nextScenarios = [...current, nextScenario];
      queueScenarioMetaSync(nextScenarios);
      queueScenarioTeamsSync(nextScenarios, [nextScenario.id]);
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
      queueScenarioTeamsSync(nextScenarios, [deletedScenarioId], { immediate: true });
      queueScenarioAssignmentsSync(nextScenarios, [deletedScenarioId], { immediate: true });
      return nextScenarios;
    });
  }, [queueScenarioAssignmentsSync, queueScenarioMetaSync, queueScenarioTeamsSync, scenarioPendingDeleteId]);

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
      copy={null}
    >
      <div className="status-bar">
        {loading ? <div className="status-chip">Loading roster seed...</div> : null}
        {playerSyncError ? (
          <button type="button" className="status-chip error" onClick={retrySync}>
            {playerSyncError} Retry roster sync
          </button>
        ) : null}
        {scenarioTeamSyncError ? (
          <button
            type="button"
            className="status-chip error"
            onClick={() => {
              if (latestScenariosRef.current) {
                pendingScenarioTeamsRef.current = latestScenariosRef.current;
                dirtyScenarioTeamIdsRef.current = new Set(
                  latestScenariosRef.current.map((scenario) => scenario.id)
                );
                void flushPendingScenarioSync();
              }
            }}
          >
            {scenarioTeamSyncError} Retry scenario team sync
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
                void flushPendingScenarioSync();
              }
            }}
          >
            {scenarioSyncError} Retry scenario sync
          </button>
        ) : null}
        {matchupBundleState.status === "error" ? (
          <div className="status-chip error" role="status">
            {matchupBundleState.error}
          </div>
        ) : null}
      </div>
      <div className="scenario-stack">
        {orderedScenarios.map((scenario) => {
          const displayedAssignments =
            displayedAssignmentsByScenario.get(scenario.id) ?? scenario.assignments;
          const scenarioDraftTeams = draftTeamsByScenario.get(scenario.id) ?? scenario.teams;
          const scenarioTeamNameErrors = teamNameErrorsByScenario[scenario.id] ?? [];
          const scenarioCharts = buildScenarioAttributeCharts(scenario.assignments, playerById, scenario.teams);
          const scenarioCategoryAdvantageRows = buildScenarioCategoryAdvantageRows(
            scenario.assignments,
            playerById,
            scenario.teams
          );
          const scenarioStatsBalancerReport = scenarioStatsBalancerReports[scenario.id];
          const scenarioIncompleteTeamIds = getIncompleteScenarioTeamIds(
            scenario.assignments,
            scenario.teams
          );
          const scenarioMatchupReport = scenarioMatchupReports[scenario.id];
          const availablePlayers = availablePlayersByScenario.get(scenario.id) ?? [];
          const hasAssignablePoolPlayers = availablePlayers.some(canPlayerBeAssignedFromPool);
          const currentNearestSlot = nearestSlot?.scenarioId === scenario.id ? nearestSlot : null;
          const currentOpenPickerSlot =
            openPickerSlot?.scenarioId === scenario.id ? openPickerSlot.slot : null;
          const selectedAvailablePlayerId =
            selectedAvailablePlayer?.scenarioId === scenario.id
              ? selectedAvailablePlayer.playerId
              : null;
          const currentScenarioAction =
            scenarioActionState?.scenarioId === scenario.id ? scenarioActionState.mode : null;
          const currentScenarioSummary = scenarioActionSummaries[scenario.id] ?? null;
          const currentStatsBalanceSelection =
            statsBalanceSelectionByScenario[scenario.id] ?? getDefaultStatsBalanceSelection();
          const hasSelectedStatsBalanceOptions = currentStatsBalanceSelection.length > 0;
          const statsBalanceFilterOpen = openStatsBalanceFilterScenarioId === scenario.id;
          const currentScenarioUndoDepth = scenarioUndoStacks[scenario.id]?.length ?? 0;
          const currentScenarioRedoDepth = scenarioRedoStacks[scenario.id]?.length ?? 0;
          const canViewNextGeneratedScenario = Boolean(
            currentScenarioSummary &&
              currentScenarioSummary.currentIndex < currentScenarioSummary.candidates.length - 1
          );
          const hasOpenSlots = scenario.teams.some((team) =>
            POSITIONS.some((position) => (scenario.assignments[team.id]?.[position] ?? null) === null)
          );
          const hasAssignedPlayers = scenario.teams.some((team) =>
            POSITIONS.some((position) => (scenario.assignments[team.id]?.[position] ?? null) !== null)
          );
          const statsBalanceControlsDisabled =
            Boolean(scenarioActionState) || !hasAssignablePoolPlayers || !hasOpenSlots;
          const analyticsMode = analyticsModeByScenario[scenario.id] ?? "matchup";
          const isScenarioComplete =
            countFilledAssignments(scenario.assignments) === scenario.teams.length * POSITIONS.length;
          const swapSuggestions = scenarioMatchupSwapSuggestions[scenario.id] ?? {
            goal1: null,
            goal2: null,
            goal3: null
          };
          const goal1SwapSuggestionText = buildScenarioSwapHelperText(
            "Goal 1",
            swapSuggestions.goal1,
            isScenarioComplete,
            playerById
          );
          const goal2SwapSuggestionText = buildScenarioSwapHelperText(
            "Goal 2",
            swapSuggestions.goal2,
            isScenarioComplete,
            playerById
          );
          const goal3SwapSuggestionText = buildScenarioSwapHelperText(
            "Goal 3",
            swapSuggestions.goal3,
            isScenarioComplete,
            playerById
          );
          const goal1StatsTradeHelperText = buildScenarioStatsTradeHelperText(
            "goal 1",
            scenarioStatsBalancerReport.goal1Suggestion,
            scenarioStatsBalancerReport.completeTeams.length,
            playerById
          );
          const goal2StatsCategoryHelperText =
            buildScenarioStatsCategoryHelperText(scenarioStatsBalancerReport);
          const goal2StatsTradeHelperText = buildScenarioStatsGoal2TradeHelperText(
            scenarioStatsBalancerReport,
            scenarioStatsBalancerReport.goal2Suggestion,
            playerById
          );
          const scenarioCollapsed = Boolean(scenarioReorder) || scenario.collapsed;
          const scenarioIsDragging = scenarioReorder?.scenarioId === scenario.id;
          const deleteModalOpen = scenarioPendingDeleteId === scenario.id;
          const orderedAvailablePlayers = orderPlayersForPoolColumns(availablePlayers);
          const scenarioForceTwoLineNames = Object.values(
            scenarioWrappedTeamNames[scenario.id] ?? {}
          ).some(Boolean);

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
                    readOnly={scenarioCollapsed}
                    tabIndex={scenarioCollapsed ? -1 : 0}
                    aria-readonly={scenarioCollapsed}
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
                      <ScenarioToggleIcon collapsed={scenarioCollapsed} />
                    </button>
                  </div>
                </div>
              </div>
              <div className="scenario-body" aria-hidden={scenarioCollapsed}>
                <div className="scenario-body-inner">
                  <div className="available-toolbar">
                    <div className="available-actions available-actions-primary">
                      <button
                        type="button"
                        className="available-reset-button"
                        onClick={() => resetScenarioAssignments(scenario.id)}
                        disabled={Boolean(scenarioActionState) || !hasAssignedPlayers}
                      >
                        <span className="available-action-button-label">Clear</span>
                      </button>
                      <button
                        type="button"
                        className="available-undo-button"
                        onClick={() => undoScenarioAssignments(scenario.id)}
                        disabled={Boolean(scenarioActionState) || currentScenarioUndoDepth === 0}
                        aria-label="Undo last scenario change"
                      >
                        <span className="available-action-button-label">Undo</span>
                      </button>
                      <button
                        type="button"
                        className="available-undo-button"
                        onClick={() => redoScenarioAssignments(scenario.id)}
                        disabled={Boolean(scenarioActionState) || currentScenarioRedoDepth === 0}
                        aria-label="Redo last undone scenario change"
                      >
                        <span className="available-action-button-label">Redo</span>
                      </button>
                    </div>
                    <div className="available-actions available-actions-generator-row">
                      <span className="available-actions-label">Autofill</span>
                      <button
                        type="button"
                        className={`available-randomize-button${currentScenarioAction === "randomize" ? " loading" : ""}`}
                        aria-busy={currentScenarioAction === "randomize"}
                        onClick={() => randomizeScenarioRemainingPlayers(scenario.id)}
                        disabled={
                          Boolean(scenarioActionState) ||
                          !hasAssignablePoolPlayers ||
                          !hasOpenSlots
                        }
                      >
                        <span className="available-action-button-label">Random</span>
                      </button>
                      <button
                        type="button"
                        className={`available-randomize-button${currentScenarioAction === "balanceMatchup" ? " loading" : ""}`}
                        aria-busy={currentScenarioAction === "balanceMatchup"}
                        onClick={() => runMatchupBalancedScenarioRemainingPlayers(scenario.id)}
                        disabled={
                          Boolean(scenarioActionState) ||
                          matchupBundleState.status !== "ready" ||
                          !hasAssignablePoolPlayers ||
                          !hasOpenSlots
                        }
                        title={
                          matchupBundleState.status === "error"
                            ? matchupBundleState.error
                            : matchupBundleState.status === "loading"
                              ? "Loading matchup data..."
                              : undefined
                        }
                      >
                        <span className="available-action-button-label">Balanced Matchups</span>
                      </button>
                      <div
                        ref={(node) => {
                          if (node) {
                            statsBalanceFilterRefs.current.set(scenario.id, node);
                          } else {
                            statsBalanceFilterRefs.current.delete(scenario.id);
                          }
                        }}
                        className={`available-balance-split${statsBalanceFilterOpen ? " open" : ""}`}
                      >
                        <button
                          type="button"
                          className={`available-randomize-button available-balance-split-main${currentScenarioAction === "balanceStats" ? " loading" : ""}`}
                          aria-busy={currentScenarioAction === "balanceStats"}
                          onClick={() => runBalancedScenarioRemainingPlayers(scenario.id)}
                          disabled={
                            statsBalanceControlsDisabled ||
                            !hasSelectedStatsBalanceOptions
                          }
                        >
                          <span className="available-action-button-label">Balanced Stats</span>
                        </button>
                        <button
                          type="button"
                          className="available-randomize-button available-balance-split-toggle"
                          aria-label="Choose balanced stats filters"
                          aria-expanded={statsBalanceFilterOpen}
                          disabled={statsBalanceControlsDisabled}
                          onClick={() =>
                            setOpenStatsBalanceFilterScenarioId((current) =>
                              current === scenario.id ? null : scenario.id
                            )
                          }
                        >
                          <span className="available-balance-split-caret" aria-hidden="true">
                            ▾
                          </span>
                        </button>
                        {statsBalanceFilterOpen && !statsBalanceControlsDisabled ? (
                          <div className="available-balance-dropdown">
                            <div className="available-balance-dropdown-actions">
                              <button
                                type="button"
                                className="available-balance-dropdown-link"
                                onClick={() => selectAllScenarioStatsBalanceOptions(scenario.id)}
                              >
                                Select All
                              </button>
                              <button
                                type="button"
                                className="available-balance-dropdown-link"
                                onClick={() => clearScenarioStatsBalanceOptions(scenario.id)}
                              >
                                Clear
                              </button>
                            </div>
                            <div className="available-balance-dropdown-groups">
                              {SCENARIO_STATS_BALANCE_FILTER_GROUPS.map((group) => {
                                const selectedCount = group.options.filter((option) =>
                                  currentStatsBalanceSelection.includes(option.key)
                                ).length;
                                const allSelected = selectedCount === group.options.length;
                                const partiallySelected = selectedCount > 0 && !allSelected;

                                return (
                                  <div key={group.key} className="available-balance-dropdown-group">
                                    <label className="available-balance-option available-balance-option-parent">
                                      <input
                                        type="checkbox"
                                        checked={allSelected}
                                        ref={(node) => {
                                          if (node) {
                                            node.indeterminate = partiallySelected;
                                          }
                                        }}
                                        onChange={() =>
                                          toggleScenarioStatsBalanceGroup(
                                            scenario.id,
                                            group.options.map((option) => option.key)
                                          )
                                        }
                                      />
                                      <span>{group.label}</span>
                                    </label>
                                    <div className="available-balance-dropdown-suboptions">
                                      {group.options.map((option) => (
                                        <label key={option.key} className="available-balance-option">
                                          <input
                                            type="checkbox"
                                            checked={currentStatsBalanceSelection.includes(option.key)}
                                            onChange={() =>
                                              toggleScenarioStatsBalanceLeaf(scenario.id, option.key)
                                            }
                                          />
                                          <span>{option.label}</span>
                                        </label>
                                      ))}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  {currentScenarioSummary ? (
                    <div className="available-feedback" role="status" aria-live="polite">
                      <span>
                        {currentScenarioSummary.mode === "randomize"
                          ? `Generated ${currentScenarioSummary.generatedCount} teams and selected one at random.`
                          : currentScenarioSummary.mode === "balanceMatchup"
                            ? `Generated ${currentScenarioSummary.generatedCount} random teams and selected the scenario with the fairest matchup profile.`
                            : `Generated ${currentScenarioSummary.generatedCount} random teams, selected the scenario with the most balanced scores ${
                                currentScenarioSummary.balanceSummaryText === "overall"
                                  ? "overall"
                                  : `across ${currentScenarioSummary.balanceSummaryText ?? "selected stats"}`
                              }.`}
                      </span>
                      {canViewNextGeneratedScenario ? (
                        <button
                          type="button"
                          className="available-feedback-link"
                          onClick={() => showNextGeneratedScenario(scenario.id)}
                          disabled={Boolean(scenarioActionState)}
                          aria-label="View next generated team setup"
                        >
                          {currentScenarioSummary.mode === "randomize"
                            ? "View Next -->"
                            : "View Next Best -->"}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="available-divider" aria-hidden="true" />
                  <div className="scenario-setup-grid">
                  <div
                    ref={(node) => {
                      if (node) {
                        poolRefs.current.set(scenario.id, node);
                      } else {
                        poolRefs.current.delete(scenario.id);
                      }
                    }}
                    className={`team-card available-shell scenario-pool-card${poolDropScenarioId === scenario.id ? " pool-drop-active" : ""}`}
                  >
                    <div className="available-header">
                      <h2 className="available-title">Player Pool</h2>
                    </div>
                    <div className="available-players">
                      {orderedAvailablePlayers.map((player) => {
                        const isSelected = selectedAvailablePlayerId === player.id;
                        const isAssignable = canPlayerBeAssignedFromPool(player);
                        const poolName = getPlayerPoolName(player);
                        return (
                          <div
                            key={player.id}
                            ref={(node) => {
                              const key = getAvailableChipKey(scenario.id, player.id);
                              if (node) {
                                availableChipRefs.current.set(key, node);
                              } else {
                                availableChipRefs.current.delete(key);
                              }
                            }}
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
                  <div className="scenario-teams-panel">
                  <div className="teams-grid">
                    {scenario.teams.map((team, teamIndex) => (
                      <TeamColumn
                        key={team.id}
                        scenarioId={scenario.id}
                        team={team}
                        teamIndex={teamIndex}
                            teamNameError={scenarioTeamNameErrors[teamIndex] ?? null}
                            draftName={scenarioDraftTeams[teamIndex]?.name ?? team.name}
                            draftColor={scenarioDraftTeams[teamIndex]?.color ?? team.color}
                            forceTwoLineName={scenarioForceTwoLineNames}
                            canRemoveTeam={scenario.teams.length > 1}
                            teamEditingDisabled={Boolean(dragState) || Boolean(scenarioReorder)}
                            onNameWrapChange={(teamId, isWrapped) =>
                              setScenarioWrappedTeamNames((current) => {
                                const currentScenario = current[scenario.id] ?? {};
                                if ((currentScenario[teamId] ?? false) === isWrapped) {
                                  return current;
                                }

                                return {
                                  ...current,
                                  [scenario.id]: {
                                    ...currentScenario,
                                    [teamId]: isWrapped
                                  }
                                };
                              })
                            }
                            onNameChange={(value) => {
                              updateScenarioTeamDraftName(scenario.id, team.id, value);
                              scheduleScenarioTeamNameCommit(scenario.id, team.id);
                            }}
                        onNameCommit={(options) => {
                          const key = getScenarioTeamCommitKey(scenario.id, team.id, "name");
                          const pendingTimeout = scenarioTeamCommitTimeoutsRef.current.get(key);
                          if (pendingTimeout) {
                            clearTimeout(pendingTimeout);
                            scenarioTeamCommitTimeoutsRef.current.delete(key);
                          }
                          commitScenarioTeamName(scenario.id, team.id, options);
                        }}
                        onColorChange={(value) => handleScenarioTeamColorChange(scenario.id, team.id, value)}
                        onColorCommit={(options) => {
                          const key = getScenarioTeamCommitKey(scenario.id, team.id, "color");
                          const pendingTimeout = scenarioTeamCommitTimeoutsRef.current.get(key);
                          if (pendingTimeout) {
                            clearTimeout(pendingTimeout);
                            scenarioTeamCommitTimeoutsRef.current.delete(key);
                          }
                          commitScenarioTeamColor(scenario.id, team.id, options);
                        }}
                        onRemoveTeam={() => removeScenarioTeam(scenario.id, team.id)}
                        onRenameTeam={() => renameScenarioTeam(scenario.id, team.id)}
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
                    {scenario.teams.length < MAX_TEAMS ? (
                      <button
                        type="button"
                        className="team-inline-add-card"
                        onClick={() => addScenarioTeam(scenario.id)}
                        disabled={Boolean(dragState) || Boolean(scenarioReorder)}
                      >
                        Add Team
                      </button>
                    ) : null}
                  </div>
                  </div>
                  </div>
                  <ScenarioAnalyticsSection
                    analyticsMode={analyticsMode}
                    charts={scenarioCharts}
                    categoryAdvantageRows={scenarioCategoryAdvantageRows}
                    incompleteTeamIds={scenarioIncompleteTeamIds}
                    statsBalancerReport={scenarioStatsBalancerReport}
                    goal1StatsTradeHelperText={goal1StatsTradeHelperText}
                    goal2StatsCategoryHelperText={goal2StatsCategoryHelperText}
                    goal2StatsTradeHelperText={goal2StatsTradeHelperText}
                    matchupReport={scenarioMatchupReport}
                    goal1SwapHelperText={goal1SwapSuggestionText}
                    goal2SwapHelperText={goal2SwapSuggestionText}
                    goal3SwapHelperText={goal3SwapSuggestionText}
                    playersById={playerById}
                    teams={scenario.teams}
                    onAnalyticsModeChange={(mode) =>
                      setAnalyticsModeByScenario((current) => ({
                        ...current,
                        [scenario.id]: mode
                      }))
                    }
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
                      <ScenarioToggleIcon collapsed />
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
  teamNameError,
  draftName,
  draftColor,
  forceTwoLineName,
  canRemoveTeam,
  teamEditingDisabled,
  onNameWrapChange,
  onNameChange,
  onNameCommit,
  onRemoveTeam,
  onRenameTeam,
  onColorChange,
  onColorCommit,
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
  teamNameError: string | null;
  draftName: string;
  draftColor: string;
  forceTwoLineName: boolean;
  canRemoveTeam: boolean;
  teamEditingDisabled: boolean;
  onNameWrapChange: (teamId: string, isWrapped: boolean) => void;
  onNameChange: (value: string) => void;
  onNameCommit: (options?: { immediate?: boolean }) => void;
  onRemoveTeam: () => void;
  onRenameTeam: () => void;
  onColorChange: (value: string) => void;
  onColorCommit: (options?: { immediate?: boolean }) => void;
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
  const nameInputRef = useRef<HTMLTextAreaElement | null>(null);

  useLayoutEffect(() => {
    const node = nameInputRef.current;
    if (!node) {
      return;
    }

    const computedStyle = window.getComputedStyle(node);
    const lineHeight = Number.parseFloat(computedStyle.lineHeight) || 0;
    const paddingTop = Number.parseFloat(computedStyle.paddingTop) || 0;
    const paddingBottom = Number.parseFloat(computedStyle.paddingBottom) || 0;
    const borderBottomWidth = Number.parseFloat(computedStyle.borderBottomWidth) || 0;
    const minHeight = lineHeight + paddingTop + paddingBottom + borderBottomWidth;
    const maxHeight = lineHeight * 2 + paddingTop + paddingBottom + borderBottomWidth;
    const updateHeight = () => {
      node.style.height = "0px";
      const measuredHeight = Math.min(Math.max(node.scrollHeight, minHeight), maxHeight);
      const isWrapped = measuredHeight > minHeight + 1;
      onNameWrapChange(team.id, isWrapped);
      node.style.height = `${forceTwoLineName ? maxHeight : measuredHeight}px`;
    };

    updateHeight();

    const resizeObserver = new ResizeObserver(() => {
      updateHeight();
    });
    resizeObserver.observe(node);

    return () => resizeObserver.disconnect();
  }, [draftName, forceTwoLineName, onNameWrapChange, team.id]);

  return (
    <section className="team-card">
      <div className={`team-name team-name-editor${forceTwoLineName ? " force-two-line" : ""}`}>
        <div className="team-name-edit-row">
          <textarea
            ref={nameInputRef}
            className={`team-inline-name-input${teamNameError ? " invalid" : ""}`}
            value={draftName}
            onChange={(event) => onNameChange(event.target.value.replace(/\s*\n+\s*/g, " "))}
            onBlur={() => onNameCommit({ immediate: true })}
            placeholder={`Team ${teamIndex + 1}`}
            spellCheck={false}
            disabled={teamEditingDisabled}
            rows={1}
          />
          <div className="team-name-controls">
            <button
              type="button"
              className="team-config-remove-button team-inline-icon-button team-inline-rename-button"
              onClick={onRenameTeam}
              disabled={teamEditingDisabled}
              aria-label={`Generate a new name for ${teamLabel}`}
              title="Generate team name"
            >
              <img
                aria-hidden="true"
                alt=""
                src="/team-name-shuffle.png"
                className="team-inline-icon-image"
              />
            </button>
            <label className="team-config-color-row">
              <input
                type="color"
                className="team-config-color-input"
                value={draftColor}
                onChange={(event) => onColorChange(event.target.value)}
                onBlur={() => onColorCommit({ immediate: true })}
                disabled={teamEditingDisabled}
              />
            </label>
            <button
              type="button"
              className="team-config-remove-button team-inline-icon-button team-inline-remove-button"
              onClick={onRemoveTeam}
              disabled={!canRemoveTeam || teamEditingDisabled}
              aria-label={`Remove ${teamLabel}`}
              title="Remove team"
            >
              <img
                aria-hidden="true"
                alt=""
                src="/team-remove-trash.png"
                className="team-inline-icon-image"
              />
            </button>
          </div>
        </div>
        {teamNameError ? <div className="team-inline-error">{teamNameError}</div> : null}
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

function formatSignedCategoryAdvantage(value: number) {
  if (value > 0) {
    return `+${value.toFixed(1)}`;
  }

  return value.toFixed(1);
}

function getCategoryAdvantageTone(value: number) {
  if (value > 0) {
    return "positive";
  }

  if (value < 0) {
    return "negative";
  }

  return "neutral";
}

function getCategoryAdvantageScaleLimit(rows: ScenarioCategoryAdvantageRow[]) {
  const maxMagnitude = rows.reduce((currentMax, row) => {
    return row.cells.reduce(
      (rowMax, cell) => Math.max(rowMax, Math.abs(cell.advantage)),
      currentMax
    );
  }, 0);

  return Math.max(1, Math.ceil(maxMagnitude));
}

function buildScenarioOverallCategoryAdvantageRow(
  rows: ScenarioCategoryAdvantageRow[],
  teams: Team[]
): ScenarioCategoryAdvantageRow {
  return {
    key: "overall",
    label: "Overall",
    missingPlayerNames: [],
    cells: teams.map((team) => {
      const teamRows = rows.filter((row) => row.missingPlayerNames.length === 0);
      const matchingCells = teamRows
        .map((row) => row.cells.find((cell) => cell.team.id === team.id) ?? null)
        .filter((cell): cell is ScenarioCategoryAdvantageCell => cell !== null);

      return {
        team,
        isIncomplete: matchingCells.some((cell) => cell.isIncomplete),
        advantage: roundChartValue(
          matchingCells.reduce((sum, cell) => sum + (cell.isIncomplete ? 0 : cell.advantage), 0)
        )
      };
    })
  };
}

function useObservedElementWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) {
      return;
    }

    const updateWidth = () => {
      setWidth(node.getBoundingClientRect().width);
    };

    updateWidth();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateWidth);
      return () => {
        window.removeEventListener("resize", updateWidth);
      };
    }

    const observer = new ResizeObserver(() => {
      updateWidth();
    });
    observer.observe(node);

    return () => {
      observer.disconnect();
    };
  }, []);

  return [ref, width] as const;
}

function useScenarioStatsV2IncompleteOverlays(
  incompleteTeamIds: string[]
) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLTableSectionElement | null>(null);
  const headerRefs = useRef(new Map<string, HTMLTableCellElement>());
  const [overlays, setOverlays] = useState<
    Record<string, { left: number; top: number; width: number; height: number }>
  >({});

  useLayoutEffect(() => {
    const wrapNode = wrapRef.current;
    const bodyNode = bodyRef.current;

    if (!wrapNode || !bodyNode) {
      setOverlays({});
      return;
    }

    const update = () => {
      const wrapRect = wrapNode.getBoundingClientRect();
      const bodyRect = bodyNode.getBoundingClientRect();
      const nextOverlays: Record<string, { left: number; top: number; width: number; height: number }> = {};

      for (const teamId of incompleteTeamIds) {
        const headerNode = headerRefs.current.get(teamId);
        if (!headerNode) {
          continue;
        }

        const headerRect = headerNode.getBoundingClientRect();
        nextOverlays[teamId] = {
          left: headerRect.left - wrapRect.left,
          top: bodyRect.top - wrapRect.top,
          width: headerRect.width,
          height: bodyRect.height
        };
      }

      setOverlays(nextOverlays);
    };

    update();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", update);
      return () => {
        window.removeEventListener("resize", update);
      };
    }

    const observer = new ResizeObserver(() => {
      update();
    });
    observer.observe(wrapNode);
    observer.observe(bodyNode);
    for (const teamId of incompleteTeamIds) {
      const headerNode = headerRefs.current.get(teamId);
      if (headerNode) {
        observer.observe(headerNode);
      }
    }

    return () => {
      observer.disconnect();
    };
  }, [incompleteTeamIds]);

  const registerHeaderRef = useCallback(
    (teamId: string) => (node: HTMLTableCellElement | null) => {
      if (node) {
        headerRefs.current.set(teamId, node);
      } else {
        headerRefs.current.delete(teamId);
      }
    },
    []
  );

  return [wrapRef, bodyRef, registerHeaderRef, overlays] as const;
}

function ScenarioStatsComparisonBarCell({
  row,
  cell,
  scaleLimit,
  teamIndex,
  tone = "default"
}: {
  row: ScenarioCategoryAdvantageRow;
  cell: ScenarioCategoryAdvantageCell;
  scaleLimit: number;
  teamIndex: number;
  tone?: "default" | "summary";
}) {
  const [trackRef, trackWidth] = useObservedElementWidth<HTMLDivElement>();
  const label = formatSignedCategoryAdvantage(cell.advantage);
  const rawDirection = getCategoryAdvantageTone(cell.advantage);
  const direction = tone === "summary" ? "summary" : rawDirection;
  const gap = 4;
  const summaryLabelGutter = tone === "summary" ? 30 : 0;
  const halfTrackWidth = Math.max(0, trackWidth / 2 - summaryLabelGutter);
  const centerX = trackWidth / 2;
  const barWidth =
    cell.advantage === 0
      ? 0
      : Math.max(2, (Math.abs(cell.advantage) / Math.max(scaleLimit, 1)) * halfTrackWidth);

  const barStyle =
    tone === "summary"
      ? {
          left: `${cell.advantage >= 0 ? centerX : Math.max(0, centerX - barWidth)}px`,
          width: `${barWidth}px`,
          background: "#facc15"
        }
      : rawDirection === "positive"
      ? {
          left: `${centerX}px`,
          width: `${barWidth}px`,
          background: cell.team.color
        }
      : rawDirection === "negative"
        ? {
            left: `${Math.max(0, centerX - barWidth)}px`,
            width: `${barWidth}px`,
            background: cell.team.color
          }
        : undefined;

  const valueStyle =
    rawDirection === "positive"
      ? cell.advantage >= 0
        ? { left: `${Math.max(0, centerX - gap)}px` }
        : { left: `${Math.min(trackWidth, centerX + gap)}px` }
      : rawDirection === "negative"
        ? {
            left: `${centerX + gap}px`
          }
        : {
            left: `${centerX}px`
          };
  const valueClassName = `scenario-stats-v2-value ${tone === "summary" ? "summary" : rawDirection} scenario-stats-v2-value-marker ${rawDirection}${tone === "summary" ? " summary" : ""}`;

  return (
    <td
      className="scenario-stats-v2-cell scenario-stats-v2-team-cell"
      aria-label={`${getTeamDisplayName(cell.team, teamIndex)} ${row.label} ${label}`}
    >
      <div className="scenario-stats-v2-cell-inner">
        <div ref={trackRef} className="scenario-stats-v2-track">
          {barStyle ? (
            <div className={`scenario-stats-v2-bar ${direction}`} style={barStyle} aria-hidden="true" />
          ) : null}
          <div
            className={valueClassName}
            style={valueStyle}
            aria-hidden="true"
          >
            {label}
          </div>
        </div>
      </div>
    </td>
  );
}

function ScenarioStatsTeamBalancerCard({
  report,
  goal1StatsTradeHelperText,
  goal2StatsCategoryHelperText,
  goal2StatsTradeHelperText
}: {
  report: ScenarioStatsBalancerReport;
  goal1StatsTradeHelperText: string;
  goal2StatsCategoryHelperText: ReactNode;
  goal2StatsTradeHelperText: ReactNode;
}) {
  const goal1Completion = Math.max(
    0,
    Math.min(
      SCENARIO_STATS_BALANCER_GOAL1_LIMIT,
      SCENARIO_STATS_BALANCER_GOAL1_LIMIT - report.currentOverallRangeScore
    )
  );
  const goal1Width = (goal1Completion / SCENARIO_STATS_BALANCER_GOAL1_LIMIT) * 100;
  const goal2Completion = Math.max(
    0,
    Math.min(
      SCENARIO_STATS_BALANCER_GOAL2_LIMIT,
      SCENARIO_STATS_BALANCER_GOAL2_LIMIT - report.currentMaxSubcategoryRange
    )
  );
  const goal2Width = (goal2Completion / SCENARIO_STATS_BALANCER_GOAL2_LIMIT) * 100;

  return (
    <div className="scenario-matchup-optimization">
      <div className="scenario-matchup-optimization-section">
        <h3 className="scenario-matchup-optimization-heading">Goal 1: Minimize Overall Advantages</h3>
        <div
          className="scenario-matchup-optimization-bar"
          role="img"
          aria-label={`Overall disparity score ${report.currentOverallRangeScore.toFixed(1)} on a 0 to ${SCENARIO_STATS_BALANCER_GOAL1_LIMIT} scale`}
        >
          <div
            className="scenario-matchup-optimization-bar-segment fair"
            style={{ width: `${goal1Width}%` }}
          />
          <div
            className="scenario-matchup-optimization-bar-segment remainder"
            style={{ width: `${100 - goal1Width}%` }}
          />
          <div className="scenario-matchup-optimization-bar-value">
            Score: {report.currentOverallRangeScore.toFixed(1)}
          </div>
        </div>
        <p className="scenario-matchup-overall-helper">{goal1StatsTradeHelperText}</p>
      </div>

      <div className="scenario-matchup-optimization-section">
        <h3 className="scenario-matchup-optimization-heading">Goal 2: Minimize Category Advantages</h3>
        <p className="scenario-matchup-optimization-subtext">{goal2StatsCategoryHelperText}</p>
        <div
          className="scenario-matchup-optimization-bar"
          role="img"
          aria-label={`Maximum subcategory imbalance ${report.currentMaxSubcategoryRange.toFixed(1)} on a 0 to ${SCENARIO_STATS_BALANCER_GOAL2_LIMIT} scale`}
        >
          <div
            className="scenario-matchup-optimization-bar-segment fair"
            style={{ width: `${goal2Width}%` }}
          />
          <div
            className="scenario-matchup-optimization-bar-segment remainder"
            style={{ width: `${100 - goal2Width}%` }}
          />
          <div className="scenario-matchup-optimization-bar-value">
            Score: {report.currentMaxSubcategoryRange.toFixed(1)}
          </div>
        </div>
        <p className="scenario-matchup-overall-helper">{goal2StatsTradeHelperText}</p>
      </div>
    </div>
  );
}

function ScenarioStatsComparison2({
  categoryAdvantageRows,
  incompleteTeamIds,
  statsBalancerReport,
  goal1StatsTradeHelperText,
  goal2StatsCategoryHelperText,
  goal2StatsTradeHelperText,
  teams
}: {
  categoryAdvantageRows: ScenarioCategoryAdvantageRow[];
  incompleteTeamIds: string[];
  statsBalancerReport: ScenarioStatsBalancerReport;
  goal1StatsTradeHelperText: string;
  goal2StatsCategoryHelperText: ReactNode;
  goal2StatsTradeHelperText: ReactNode;
  teams: Team[];
}) {
  const scaleLimit = getCategoryAdvantageScaleLimit(categoryAdvantageRows);
  const overallRow = buildScenarioOverallCategoryAdvantageRow(categoryAdvantageRows, teams);
  const overallScaleLimit = Math.max(
    1,
    Math.ceil(
      overallRow.cells.reduce((currentMax, cell) => Math.max(currentMax, Math.abs(cell.advantage)), 0)
    )
  );
  const rowsByKey = new Map(categoryAdvantageRows.map((row) => [row.key, row] as const));
  const [
    tableWrapRef,
    tableBodyRef,
    registerHeaderRef,
    incompleteTeamOverlays
  ] = useScenarioStatsV2IncompleteOverlays(incompleteTeamIds);

  return (
    <section className="scenario-stats-v2" aria-label="Alternative team stats comparison">
      <div className="scenario-chart-card scenario-stats-v2-card">
        <div className="scenario-chart-header scenario-chart-header-stacked">
          <h2 className="scenario-chart-title">Team Balancer</h2>
        </div>
        <ScenarioStatsTeamBalancerCard
          report={statsBalancerReport}
          goal1StatsTradeHelperText={goal1StatsTradeHelperText}
          goal2StatsCategoryHelperText={goal2StatsCategoryHelperText}
          goal2StatsTradeHelperText={goal2StatsTradeHelperText}
        />
      </div>

      <div className="scenario-chart-card scenario-stats-v2-card">
        <div className="scenario-chart-header">
          <h2 className="scenario-chart-title">Category Advantages</h2>
        </div>
        <div ref={tableWrapRef} className="scenario-stats-v2-table-wrap">
          <table className="scenario-stats-v2-table">
            <colgroup>
              <col
                className="scenario-stats-v2-col-group"
                style={{ width: `${SCENARIO_STATS_V2_GROUP_COLUMN_WIDTH}px` }}
              />
              <col
                className="scenario-stats-v2-col-label"
                style={{ width: `${SCENARIO_STATS_V2_LABEL_COLUMN_WIDTH}px` }}
              />
              {teams.map((team) => (
                <col key={`${team.id}:col`} className="scenario-stats-v2-col-team" />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th scope="col" />
                <th scope="col" />
                {teams.map((team, index) => (
                  <th
                    key={team.id}
                    ref={registerHeaderRef(team.id)}
                    scope="col"
                    className="scenario-stats-v2-team-heading"
                  >
                    {getTeamDisplayName(team, index)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody ref={tableBodyRef}>
              <tr className="scenario-stats-v2-overall-row">
                <th />
                <th scope="row" className="scenario-stats-v2-overall-label scenario-stats-v2-overall-gold">
                  Overall
                </th>
                {overallRow.cells.map((cell, cellIndex) => (
                  cell.isIncomplete ? (
                    <td
                      key={`overall:${cell.team.id}`}
                      className="scenario-stats-v2-cell scenario-stats-v2-team-cell scenario-stats-v2-team-cell-incomplete"
                      aria-hidden="true"
                    />
                  ) : (
                    <ScenarioStatsComparisonBarCell
                      key={`overall:${cell.team.id}`}
                      row={overallRow}
                      cell={cell}
                      scaleLimit={overallScaleLimit}
                      teamIndex={cellIndex}
                      tone="summary"
                    />
                  )
                ))}
              </tr>
              {SCENARIO_STATS_V2_GROUPS.flatMap((group) =>
                group.rows.map((groupRow, rowIndex) => {
                  const row = rowsByKey.get(groupRow.key);
                  if (!row) {
                    return null;
                  }

                  return (
                    <tr key={row.key}>
                      {rowIndex === 0 ? (
                        <th
                          scope="rowgroup"
                          rowSpan={group.rows.length}
                          className="scenario-stats-v2-group-label"
                        >
                          {group.shortLabel}
                        </th>
                      ) : null}
                      <th scope="row">{row.label}</th>
                      {row.missingPlayerNames.length > 0 ? (
                        <td colSpan={teams.length} className="scenario-stats-v2-missing">
                          <span className="scenario-chart-helper">
                            Missing Player Stats for {row.missingPlayerNames.join(", ")}
                          </span>
                        </td>
                      ) : (
                        row.cells.map((cell, cellIndex) => (
                          cell.isIncomplete ? (
                            <td
                              key={`${row.key}:${cell.team.id}`}
                              className="scenario-stats-v2-cell scenario-stats-v2-team-cell scenario-stats-v2-team-cell-incomplete"
                              aria-hidden="true"
                            />
                          ) : (
                            <ScenarioStatsComparisonBarCell
                              key={`${row.key}:${cell.team.id}`}
                              row={row}
                              cell={cell}
                              scaleLimit={scaleLimit}
                              teamIndex={cellIndex}
                            />
                          )
                        ))
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
          {incompleteTeamIds.map((teamId) => {
            const overlay = incompleteTeamOverlays[teamId];
            if (!overlay) {
              return null;
            }

            return (
              <div
                key={teamId}
                className="scenario-stats-v2-incomplete-overlay"
                style={{
                  left: `${overlay.left}px`,
                  top: `${overlay.top}px`,
                  width: `${overlay.width}px`,
                  height: `${overlay.height}px`
                }}
              >
                <span className="scenario-chart-helper">Missing Players</span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function ScenarioCombinedStatsComparison({
  charts,
  categoryAdvantageRows,
  incompleteTeamIds,
  statsBalancerReport,
  goal1StatsTradeHelperText,
  goal2StatsCategoryHelperText,
  goal2StatsTradeHelperText,
  teams
}: {
  charts: ScenarioAttributeChart[];
  categoryAdvantageRows: ScenarioCategoryAdvantageRow[];
  incompleteTeamIds: string[];
  statsBalancerReport: ScenarioStatsBalancerReport;
  goal1StatsTradeHelperText: string;
  goal2StatsCategoryHelperText: ReactNode;
  goal2StatsTradeHelperText: ReactNode;
  teams: Team[];
}) {
  return (
    <div className="scenario-stats-combined">
      <ScenarioStatsComparison2
        categoryAdvantageRows={categoryAdvantageRows}
        incompleteTeamIds={incompleteTeamIds}
        statsBalancerReport={statsBalancerReport}
        goal1StatsTradeHelperText={goal1StatsTradeHelperText}
        goal2StatsCategoryHelperText={goal2StatsCategoryHelperText}
        goal2StatsTradeHelperText={goal2StatsTradeHelperText}
        teams={teams}
      />
      <ScenarioAttributeCharts charts={charts} />
    </div>
  );
}

function getTeamMatchupNodeLayout(count: number) {
  if (count <= 1) {
    return [{ x: MATCHUP_CHORD_SIZE / 2, y: MATCHUP_CHORD_HEIGHT / 2 - 6 }];
  }

  if (count === 2) {
    return [
      { x: 88, y: 126 },
      { x: 232, y: 126 }
    ];
  }

  if (count === 3) {
    return [
      { x: MATCHUP_CHORD_SIZE / 2, y: 58 },
      { x: 92, y: 190 },
      { x: 228, y: 190 }
    ];
  }

  return [
    { x: 86, y: 68 },
    { x: 234, y: 68 },
    { x: 86, y: 186 },
    { x: 234, y: 186 }
  ];
}

function getTeamMatchupTextOffset(index: number, count: number) {
  if (count === 2) {
    return index === 0
      ? { x: 0, y: -34 }
      : { x: 0, y: -34 };
  }

  if (count === 3) {
    return index === 0 ? { x: 0, y: -34 } : { x: 0, y: 40 };
  }

  if (count >= 4) {
    return index < 2 ? { x: 0, y: -34 } : { x: 0, y: 40 };
  }

  return { x: 0, y: 40 };
}

function createTeamMatchupLinePath(
  source: { x: number; y: number },
  target: { x: number; y: number },
  sourceIndex: number,
  targetIndex: number
) {
  const pairStart = sourceIndex < targetIndex ? source : target;
  const pairEnd = sourceIndex < targetIndex ? target : source;
  const pairDirectionX = pairEnd.x - pairStart.x;
  const pairDirectionY = pairEnd.y - pairStart.y;
  const pairDistance = Math.hypot(pairDirectionX, pairDirectionY) || 1;
  const pairUnitX = pairDirectionX / pairDistance;
  const pairUnitY = pairDirectionY / pairDistance;
  const pairPerpendicularX = -pairUnitY;
  const pairPerpendicularY = pairUnitX;
  const centerX = MATCHUP_CHORD_SIZE / 2;
  const centerY = MATCHUP_CHORD_HEIGHT / 2;
  const baseMidX = (pairStart.x + pairEnd.x) / 2;
  const baseMidY = (pairStart.y + pairEnd.y) / 2;
  const inwardX = centerX - baseMidX;
  const inwardY = centerY - baseMidY;
  const inwardDistance = Math.hypot(inwardX, inwardY) || 1;
  const inwardUnitX = inwardX / inwardDistance;
  const inwardUnitY = inwardY / inwardDistance;
  const curveDepth = Math.min(32, Math.max(18, pairDistance * 0.16));
  const laneOffset = 10.5;
  const laneSign = sourceIndex < targetIndex ? 1 : -1;
  const sourceInset = MATCHUP_NODE_RADIUS + MATCHUP_NODE_BUFFER_RADIUS;
  const targetPathInset =
    MATCHUP_NODE_RADIUS + MATCHUP_NODE_BUFFER_RADIUS + MATCHUP_ARROW_TIP_LENGTH;

  const controlX =
    baseMidX + inwardUnitX * curveDepth + pairPerpendicularX * laneOffset * laneSign;
  const controlY =
    baseMidY + inwardUnitY * curveDepth + pairPerpendicularY * laneOffset * laneSign;
  const startDirectionX = controlX - source.x;
  const startDirectionY = controlY - source.y;
  const startDirectionDistance = Math.hypot(startDirectionX, startDirectionY) || 1;
  const startAnchorX = source.x + (startDirectionX / startDirectionDistance) * sourceInset;
  const startAnchorY = source.y + (startDirectionY / startDirectionDistance) * sourceInset;
  const endDirectionX = target.x - controlX;
  const endDirectionY = target.y - controlY;
  const endDirectionDistance = Math.hypot(endDirectionX, endDirectionY) || 1;
  const endAnchorX =
    target.x - (endDirectionX / endDirectionDistance) * targetPathInset;
  const endAnchorY =
    target.y - (endDirectionY / endDirectionDistance) * targetPathInset;

  return `M ${startAnchorX} ${startAnchorY} Q ${controlX} ${controlY} ${endAnchorX} ${endAnchorY}`;
}

function getQuadraticPoint(
  start: { x: number; y: number },
  control: { x: number; y: number },
  end: { x: number; y: number },
  t: number
) {
  const oneMinusT = 1 - t;
  return {
    x: oneMinusT * oneMinusT * start.x + 2 * oneMinusT * t * control.x + t * t * end.x,
    y: oneMinusT * oneMinusT * start.y + 2 * oneMinusT * t * control.y + t * t * end.y
  };
}

function getQuadraticTangent(
  start: { x: number; y: number },
  control: { x: number; y: number },
  end: { x: number; y: number },
  t: number
) {
  return {
    x: 2 * (1 - t) * (control.x - start.x) + 2 * t * (end.x - control.x),
    y: 2 * (1 - t) * (control.y - start.y) + 2 * t * (end.y - control.y)
  };
}

function createTeamMatchupTaperedBodyPath(
  source: { x: number; y: number },
  target: { x: number; y: number },
  sourceIndex: number,
  targetIndex: number
) {
  const centerline = createTeamMatchupLinePath(source, target, sourceIndex, targetIndex);
  const match = centerline.match(
    /^M\s+([-\d.]+)\s+([-\d.]+)\s+Q\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)$/
  );

  if (!match) {
    return centerline;
  }

  const [, startX, startY, controlX, controlY, endX, endY] = match;
  const start = { x: Number(startX), y: Number(startY) };
  const control = { x: Number(controlX), y: Number(controlY) };
  const end = { x: Number(endX), y: Number(endY) };
  const sampleCount = 12;
  const leftPoints: Array<{ x: number; y: number }> = [start];
  const rightPoints: Array<{ x: number; y: number }> = [start];

  for (let step = 1; step <= sampleCount; step += 1) {
    const t = step / sampleCount;
    const point = getQuadraticPoint(start, control, end, t);
    const tangent = getQuadraticTangent(start, control, end, t);
    const tangentLength = Math.hypot(tangent.x, tangent.y) || 1;
    const normalX = -tangent.y / tangentLength;
    const normalY = tangent.x / tangentLength;
    const halfWidth = (MATCHUP_LINK_STROKE_WIDTH / 2) * t;

    leftPoints.push({
      x: point.x + normalX * halfWidth,
      y: point.y + normalY * halfWidth
    });
    rightPoints.push({
      x: point.x - normalX * halfWidth,
      y: point.y - normalY * halfWidth
    });
  }

  const leftPath = leftPoints.map((point) => `L ${point.x} ${point.y}`).join(" ");
  const rightPath = rightPoints
    .slice()
    .reverse()
    .map((point) => `L ${point.x} ${point.y}`)
    .join(" ");

  return `M ${start.x} ${start.y} ${leftPath} ${rightPath} Z`;
}

function getDirectionalTeamMatchupColor(score: number) {
  const magnitude = Math.abs(score);
  const strongThreshold = 1.5;

  if (magnitude < 0.3) {
    return "#facc15";
  }

  if (score > 0) {
    return magnitude < strongThreshold ? "#84cc16" : "#16a34a";
  }

  return magnitude < strongThreshold ? "#fb923c" : "#dc2626";
}

function ScenarioAnalyticsSection({
  analyticsMode,
  charts,
  categoryAdvantageRows,
  incompleteTeamIds,
  statsBalancerReport,
  goal1StatsTradeHelperText,
  goal2StatsCategoryHelperText,
  goal2StatsTradeHelperText,
  matchupReport,
  goal1SwapHelperText,
  goal2SwapHelperText,
  goal3SwapHelperText,
  playersById,
  teams,
  onAnalyticsModeChange
}: {
  analyticsMode: ScenarioAnalyticsMode;
  charts: ScenarioAttributeChart[];
  categoryAdvantageRows: ScenarioCategoryAdvantageRow[];
  incompleteTeamIds: string[];
  statsBalancerReport: ScenarioStatsBalancerReport;
  goal1StatsTradeHelperText: string;
  goal2StatsCategoryHelperText: ReactNode;
  goal2StatsTradeHelperText: ReactNode;
  matchupReport: ScenarioMatchupReport;
  goal1SwapHelperText: string;
  goal2SwapHelperText: string;
  goal3SwapHelperText: string;
  playersById: ReadonlyMap<number, Player>;
  teams: Team[];
  onAnalyticsModeChange: (mode: ScenarioAnalyticsMode) => void;
}) {
  return (
    <div className="scenario-analytics-shell">
      <div className="scenario-analytics-tabs" role="tablist" aria-label="Scenario analytics mode">
        {([
          { value: "matchup", label: "Matchup Comparison" },
          { value: "stats", label: "Stats Comparison" }
        ] as const).map((option) => (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={analyticsMode === option.value}
            className={`scenario-analytics-tab${analyticsMode === option.value ? " active" : ""}`}
            onClick={() => onAnalyticsModeChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
      {analyticsMode === "stats" ? (
        <ScenarioCombinedStatsComparison
          charts={charts}
          categoryAdvantageRows={categoryAdvantageRows}
          incompleteTeamIds={incompleteTeamIds}
          statsBalancerReport={statsBalancerReport}
          goal1StatsTradeHelperText={goal1StatsTradeHelperText}
          goal2StatsCategoryHelperText={goal2StatsCategoryHelperText}
          goal2StatsTradeHelperText={goal2StatsTradeHelperText}
          teams={teams}
        />
      ) : teams.length < 2 ? (
        <section className="scenario-matchup-analytics" aria-label="Team matchup comparison">
          <div className="scenario-chart-card scenario-matchup-card">
            <div className="scenario-matchup-empty">
              Add at least two teams in this scenario to compare matchups.
            </div>
          </div>
        </section>
      ) : (
        <ScenarioMatchupCharts
          report={matchupReport}
          goal1SwapHelperText={goal1SwapHelperText}
          goal2SwapHelperText={goal2SwapHelperText}
          goal3SwapHelperText={goal3SwapHelperText}
          playersById={playersById}
          teams={teams}
        />
      )}
    </div>
  );
}

function ScenarioMatchupCharts({
  report,
  goal1SwapHelperText,
  goal2SwapHelperText,
  goal3SwapHelperText,
  playersById,
  teams
}: {
  report: ScenarioMatchupReport;
  goal1SwapHelperText: string;
  goal2SwapHelperText: string;
  goal3SwapHelperText: string;
  playersById: ReadonlyMap<number, Player>;
  teams: Team[];
}) {
  const [headToHeadSelection, setHeadToHeadSelection] = useState<HeadToHeadSelection | null>(null);
  const isHeadToHeadMode = headToHeadSelection !== null;
  const showOffenseHeadToHead = headToHeadSelection?.perspective === "defense";
  const showDefenseHeadToHead = headToHeadSelection?.perspective === "offense";
  const offenseSourceSelected = headToHeadSelection?.perspective === "offense";
  const defenseSourceSelected = headToHeadSelection?.perspective === "defense";

  useEffect(() => {
    if (!headToHeadSelection) {
      return undefined;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }

      if (target.closest(".scenario-head-to-head")) {
        return;
      }

      if (target.closest(".scenario-matchup-chord-link")) {
        return;
      }

      setHeadToHeadSelection(null);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [headToHeadSelection]);

  return (
    <section className="scenario-matchup-analytics" aria-label="Team matchup comparison">
      <div
        className={`scenario-chart-card scenario-matchup-card scenario-matchup-optimization-card${isHeadToHeadMode ? " scenario-matchup-card-dimmed" : ""}`}
      >
        <div className="scenario-chart-header">
          <h2 className="scenario-chart-title">Optimization Results</h2>
        </div>
        <OptimizationResultsCard
          report={report}
          goal1SwapHelperText={goal1SwapHelperText}
          goal2SwapHelperText={goal2SwapHelperText}
          goal3SwapHelperText={goal3SwapHelperText}
          teams={teams}
        />
      </div>
      <div
        className={`scenario-chart-card scenario-matchup-card${isHeadToHeadMode ? " scenario-matchup-card-dimmed" : ""}`}
      >
        <div className="scenario-chart-header scenario-chart-header-stacked">
          <h2 className="scenario-chart-title">Team Advantages</h2>
          <p className="scenario-chart-helper">Summarized results for player-pair matchups</p>
        </div>
        <OverallMatchupBarChart report={report} teams={teams} />
      </div>
      <div
        className={`scenario-chart-card scenario-matchup-card${showOffenseHeadToHead ? " scenario-matchup-card-head-to-head" : ""}${offenseSourceSelected ? " scenario-matchup-card-source-selected" : ""}`}
      >
        {showOffenseHeadToHead ? (
          <HeadToHeadMatchupCard
            report={report}
            selection={headToHeadSelection}
            playersById={playersById}
            teams={teams}
          />
        ) : (
          <>
            <div className="scenario-chart-header scenario-chart-header-stacked">
              <h2 className="scenario-chart-title">Offense</h2>
              <p className="scenario-chart-helper">Select arrows to see Head to Head matchup</p>
            </div>
            <TeamMatchupChordDiagram
              edges={report.offenseEdges}
              teams={teams}
              perspectiveLabel="offense"
              selectedHeadToHead={headToHeadSelection}
              onEdgeSelect={setHeadToHeadSelection}
            />
          </>
        )}
      </div>
      <div
        className={`scenario-chart-card scenario-matchup-card${showDefenseHeadToHead ? " scenario-matchup-card-head-to-head" : ""}${defenseSourceSelected ? " scenario-matchup-card-source-selected" : ""}`}
      >
        {showDefenseHeadToHead ? (
          <HeadToHeadMatchupCard
            report={report}
            selection={headToHeadSelection}
            playersById={playersById}
            teams={teams}
          />
        ) : (
          <>
            <div className="scenario-chart-header scenario-chart-header-stacked">
              <h2 className="scenario-chart-title">Defense</h2>
              <p className="scenario-chart-helper">Select arrows to see Head to Head matchup</p>
            </div>
            <TeamMatchupChordDiagram
              edges={report.defenseEdges}
              teams={teams}
              perspectiveLabel="defense"
              selectedHeadToHead={headToHeadSelection}
              onEdgeSelect={setHeadToHeadSelection}
            />
          </>
        )}
      </div>
    </section>
  );
}

function OptimizationResultsCard({
  report,
  goal1SwapHelperText,
  goal2SwapHelperText,
  goal3SwapHelperText,
  teams
}: {
  report: ScenarioMatchupReport;
  goal1SwapHelperText: string;
  goal2SwapHelperText: string;
  goal3SwapHelperText: string;
  teams: Team[];
}) {
  const teamPairCount = (teams.length * (teams.length - 1)) / 2;
  const totalChosenMatchups = teamPairCount * 10;
  const fairMatchups = Math.min(report.totalFairPairCount, totalChosenMatchups);
  const fairWidth = totalChosenMatchups > 0 ? (fairMatchups / totalChosenMatchups) * 100 : 0;
  const MISMATCH_SCORE_LIMIT = 25;
  const TEAM_ADVANTAGE_SCORE_LIMIT = 10;
  const mismatchScoreCompletion = Math.max(
    0,
    Math.min(
      MISMATCH_SCORE_LIMIT,
      MISMATCH_SCORE_LIMIT - report.totalUnfairnessMagnitude
    )
  );
  const mismatchScoreWidth = (mismatchScoreCompletion / MISMATCH_SCORE_LIMIT) * 100;
  const spreadScoreCompletion = Math.max(
    0,
    Math.min(
      TEAM_ADVANTAGE_SCORE_LIMIT,
      TEAM_ADVANTAGE_SCORE_LIMIT - report.overallNetSpread
    )
  );
  const spreadScoreWidth = (spreadScoreCompletion / TEAM_ADVANTAGE_SCORE_LIMIT) * 100;

  return (
    <div className="scenario-matchup-optimization">
      <div className="scenario-matchup-optimization-section">
        <h3 className="scenario-matchup-optimization-heading">Goal 1: Maximize Fair Matchups</h3>
        <div
          className="scenario-matchup-optimization-bar"
          role="img"
          aria-label={`${fairMatchups} fair chosen matchups out of ${totalChosenMatchups} total chosen matchups`}
        >
          <div
            className="scenario-matchup-optimization-bar-segment fair"
            style={{ width: `${fairWidth}%` }}
          />
          <div
            className="scenario-matchup-optimization-bar-segment remainder"
            style={{ width: `${100 - fairWidth}%` }}
          />
          <div className="scenario-matchup-optimization-bar-value">
            {fairMatchups} / {totalChosenMatchups}
          </div>
        </div>
        <p className="scenario-matchup-optimization-subtext">
          A pair is fair when its matchup score is within +/-0.3
        </p>
        <p className="scenario-matchup-overall-helper">{goal1SwapHelperText}</p>
      </div>

      <div className="scenario-matchup-optimization-section">
        <h3 className="scenario-matchup-optimization-heading">Goal 2: Minimize Total Mismatch Score</h3>
        <div
          className="scenario-matchup-optimization-bar"
          role="img"
          aria-label={`Total mismatch score ${report.totalUnfairnessMagnitude.toFixed(2)} on a 0 to 25 scale`}
        >
          <div
            className="scenario-matchup-optimization-bar-segment fair"
            style={{ width: `${mismatchScoreWidth}%` }}
          />
          <div
            className="scenario-matchup-optimization-bar-segment remainder"
            style={{ width: `${100 - mismatchScoreWidth}%` }}
          />
          <div className="scenario-matchup-optimization-bar-value">
            Score: {report.totalUnfairnessMagnitude.toFixed(2)}
          </div>
        </div>
        <p className="scenario-matchup-optimization-subtext">
          This is total mismatch score across player pairs.
        </p>
        <p className="scenario-matchup-overall-helper">{goal2SwapHelperText}</p>
      </div>

      <div className="scenario-matchup-optimization-section">
        <h3 className="scenario-matchup-optimization-heading">Goal 3: Minimize Team Advantages</h3>
        <div
          className="scenario-matchup-optimization-bar"
          role="img"
          aria-label={`Team-level mismatch spread ${report.overallNetSpread.toFixed(2)} on a 0 to 10 scale`}
        >
          <div
            className="scenario-matchup-optimization-bar-segment fair"
            style={{ width: `${spreadScoreWidth}%` }}
          />
          <div
            className="scenario-matchup-optimization-bar-segment remainder"
            style={{ width: `${100 - spreadScoreWidth}%` }}
          />
          <div className="scenario-matchup-optimization-bar-value">
            Score: {report.overallNetSpread.toFixed(2)}
          </div>
        </div>
        <p className="scenario-matchup-optimization-subtext">
          This is the overall spread between teams.
        </p>
        <p className="scenario-matchup-overall-helper">{goal3SwapHelperText}</p>
      </div>
    </div>
  );
}

function resolveHeadToHeadMatchup(
  report: ScenarioMatchupReport,
  selection: HeadToHeadSelection,
  teams: Team[]
) {
  const pairReport = report.teamPairs.find(
    (pair) =>
      (pair.leftTeamId === selection.sourceTeamId && pair.rightTeamId === selection.targetTeamId) ||
      (pair.leftTeamId === selection.targetTeamId && pair.rightTeamId === selection.sourceTeamId)
  );

  if (!pairReport) {
    return null;
  }

  const teamById = new Map(teams.map((team) => [team.id, team] as const));
  const sourceTeam = teamById.get(selection.sourceTeamId);
  const targetTeam = teamById.get(selection.targetTeamId);
  const leftTeam = teamById.get(pairReport.leftTeamId);
  const rightTeam = teamById.get(pairReport.rightTeamId);

  if (!sourceTeam || !targetTeam || !leftTeam || !rightTeam) {
    return null;
  }

  const isForward =
    pairReport.leftTeamId === selection.sourceTeamId &&
    pairReport.rightTeamId === selection.targetTeamId;

  const mapPairForDisplay = (
    pair: TeamMatchupChosenPair,
    mode: "forward" | "reverse"
  ) => {
    if (mode === "forward") {
      return {
        offensePlayerId: pair.sourcePlayerId,
        defensePlayerId: pair.targetPlayerId,
        score: pair.rawScore,
        voteTotal: pair.voteTotal,
        colorHex: pair.colorHex
      };
    }

    const reversedScore = -pair.rawScore;
    return {
      offensePlayerId: pair.targetPlayerId,
      defensePlayerId: pair.sourcePlayerId,
      score: reversedScore,
      voteTotal: pair.voteTotal,
      colorHex: interpolateUnifiedMatchupColor(normalizeUnifiedColorScore(reversedScore))
    };
  };

  if (selection.perspective === "offense") {
    const perspectiveReport = isForward ? pairReport.offense : pairReport.defense;
    const rows = perspectiveReport.pairs.map((pair) =>
      mapPairForDisplay(pair, isForward ? "forward" : "reverse")
    );
    const offenseTeam = isForward ? leftTeam : rightTeam;
    const defenseTeam = isForward ? rightTeam : leftTeam;

    return {
      offenseTeamLabel: getTeamDisplayName(
        offenseTeam,
        teams.findIndex((team) => team.id === offenseTeam.id)
      ),
      defenseTeamLabel: getTeamDisplayName(
        defenseTeam,
        teams.findIndex((team) => team.id === defenseTeam.id)
      ),
      rows
    };
  }

  const perspectiveReport = isForward ? pairReport.defense : pairReport.offense;
  const rows = perspectiveReport.pairs.map((pair) =>
    mapPairForDisplay(pair, isForward ? "reverse" : "forward")
  );
  const offenseTeam = isForward ? rightTeam : leftTeam;
  const defenseTeam = isForward ? leftTeam : rightTeam;

  return {
    offenseTeamLabel: getTeamDisplayName(
      offenseTeam,
      teams.findIndex((team) => team.id === offenseTeam.id)
    ),
    defenseTeamLabel: getTeamDisplayName(
      defenseTeam,
      teams.findIndex((team) => team.id === defenseTeam.id)
    ),
    rows
  };
}

function HeadToHeadMatchupCard({
  report,
  selection,
  playersById,
  teams
}: {
  report: ScenarioMatchupReport;
  selection: HeadToHeadSelection;
  playersById: ReadonlyMap<number, Player>;
  teams: Team[];
}) {
  const resolvedMatchup = resolveHeadToHeadMatchup(report, selection, teams);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [hoveredRowKey, setHoveredRowKey] = useState<string | null>(null);
  const [hoveredRowTooltip, setHoveredRowTooltip] = useState<{
    scoreLabel: string;
    votesLabel: string;
    color: string;
    x: number;
    y: number;
  } | null>(null);

  if (!resolvedMatchup) {
    return <div className="scenario-matchup-empty">Unable to load the selected head-to-head matchup.</div>;
  }

  const maxVoteTotal = Math.max(...resolvedMatchup.rows.map((row) => row.voteTotal), 1);
  const getLineWidth = (voteTotal: number) => {
    const clampedVotes = Math.max(1, Math.min(maxVoteTotal, voteTotal || 1));
    if (maxVoteTotal <= 1) {
      return 2.5;
    }

    return 2.5 + ((clampedVotes - 1) / (maxVoteTotal - 1)) * (14 - 2.5);
  };

  return (
    <div
      ref={wrapRef}
      className="scenario-head-to-head"
      onMouseLeave={() => {
        setHoveredRowKey(null);
        setHoveredRowTooltip(null);
      }}
    >
      <div className="scenario-head-to-head-title">
        <div className="scenario-head-to-head-heading">Head to Head</div>
      </div>
        <div className="scenario-head-to-head-columns">
          <div className="scenario-head-to-head-column-label">
          {resolvedMatchup.offenseTeamLabel} OFFENSE
          </div>
          <div />
          <div className="scenario-head-to-head-column-label defense">
          {resolvedMatchup.defenseTeamLabel} DEFENSE
          </div>
        </div>
      <div className="scenario-head-to-head-rows">
        {resolvedMatchup.rows.map((row, index) => (
          <div key={`${row.offensePlayerId}:${row.defensePlayerId}:${index}`} className="scenario-head-to-head-row">
            <div className="scenario-head-to-head-player offense">
              {playersById.get(row.offensePlayerId)?.name.trim() || `Player ${row.offensePlayerId}`}
            </div>
            <div className="scenario-head-to-head-connector">
              <svg
                viewBox="0 0 100 20"
                preserveAspectRatio="none"
                className={`scenario-head-to-head-line${hoveredRowKey === `${row.offensePlayerId}:${row.defensePlayerId}:${index}` ? " hovered" : ""}`}
                onMouseEnter={(event) => {
                  const bounds = wrapRef.current?.getBoundingClientRect();
                  const x = bounds ? event.clientX - bounds.left : 0;
                  const y = bounds ? event.clientY - bounds.top : 0;
                  const rowKey = `${row.offensePlayerId}:${row.defensePlayerId}:${index}`;
                  setHoveredRowKey(rowKey);
                  setHoveredRowTooltip({
                    scoreLabel: `Offense Advantage: ${row.score >= 0 ? "+" : ""}${row.score.toFixed(2)}`,
                    votesLabel: `Votes: ${row.voteTotal}`,
                    color: row.colorHex,
                    x,
                    y
                  });
                }}
                onMouseMove={(event) => {
                  const bounds = wrapRef.current?.getBoundingClientRect();
                  const x = bounds ? event.clientX - bounds.left : 0;
                  const y = bounds ? event.clientY - bounds.top : 0;
                  const rowKey = `${row.offensePlayerId}:${row.defensePlayerId}:${index}`;
                  setHoveredRowKey(rowKey);
                  setHoveredRowTooltip({
                    scoreLabel: `Offense Advantage: ${row.score >= 0 ? "+" : ""}${row.score.toFixed(2)}`,
                    votesLabel: `Votes: ${row.voteTotal}`,
                    color: row.colorHex,
                    x,
                    y
                  });
                }}
                onMouseLeave={() => {
                  const rowKey = `${row.offensePlayerId}:${row.defensePlayerId}:${index}`;
                  setHoveredRowKey((current) => (current === rowKey ? null : current));
                  setHoveredRowTooltip((current) =>
                    current?.scoreLabel === `Offense Advantage: ${row.score >= 0 ? "+" : ""}${row.score.toFixed(2)}`
                      ? null
                      : current
                  );
                }}
              >
                <line
                  x1="0"
                  y1="10"
                  x2="100"
                  y2="10"
                  stroke={row.colorHex}
                  strokeWidth={getLineWidth(row.voteTotal)}
                  strokeLinecap="round"
                />
              </svg>
            </div>
            <div className="scenario-head-to-head-player defense">
              {playersById.get(row.defensePlayerId)?.name.trim() || `Player ${row.defensePlayerId}`}
            </div>
          </div>
        ))}
      </div>
      {hoveredRowTooltip ? (
        <div
          className="scenario-matchup-tooltip"
          style={{
            left: `${hoveredRowTooltip.x}px`,
            top: `${hoveredRowTooltip.y}px`
          }}
        >
          <div
            className="scenario-matchup-tooltip-score"
            style={{ color: hoveredRowTooltip.color, marginTop: 0 }}
          >
            {hoveredRowTooltip.scoreLabel}
          </div>
          <div className="scenario-matchup-tooltip-title">{hoveredRowTooltip.votesLabel}</div>
        </div>
      ) : null}
    </div>
  );
}

function OverallMatchupBarChart({
  report,
  teams
  }: {
    report: ScenarioMatchupReport;
    teams: Team[];
  }) {
    const totalsByTeamId = new Map(report.teamNetAdvantages.map((team) => [team.teamId, team] as const));
    const OVERALL_MATCHUP_SCALE_LIMIT = 5;
    const scale = 50 / OVERALL_MATCHUP_SCALE_LIMIT;

    return (
      <div className="scenario-matchup-overall-shell">
        <div className="scenario-matchup-overall-chart" role="img" aria-label="Overall team net matchup advantage bar chart">
          {teams.map((team, index) => {
            const totals = totalsByTeamId.get(team.id);
            const metrics = [
              { key: "overall", label: "OVR", value: totals?.overall ?? 0 },
              { key: "offense", label: "OFF", value: totals?.offense ?? 0 },
              { key: "defense", label: "DEF", value: totals?.defense ?? 0 }
            ] as const;

            return (
              <div key={team.id} className="scenario-matchup-overall-row">
                <div className="scenario-matchup-overall-label">
                  {getMatchupTeamLabelLines(getTeamDisplayName(team, index)).map((line) => (
                    <span key={line}>{line}</span>
                  ))}
                </div>
                <div className="scenario-matchup-overall-metrics">
                    {metrics.map((metric) => {
                      const clampedValue = Math.max(
                        -OVERALL_MATCHUP_SCALE_LIMIT,
                        Math.min(OVERALL_MATCHUP_SCALE_LIMIT, metric.value)
                      );
                      const width = Math.abs(clampedValue) * scale;
                      const direction = metric.value >= 0 ? "positive" : "negative";
                      const barStyle = {
                        width: `${width}%`,
                        background: team.color,
                        left: clampedValue >= 0 ? "50%" : `calc(50% - ${width}%)`
                      };

                      return (
                        <div
                          key={metric.key}
                          className={`scenario-matchup-overall-metric scenario-matchup-overall-metric-${metric.key}`}
                        >
                          <div className="scenario-matchup-overall-track">
                            <div className="scenario-matchup-overall-baseline" aria-hidden="true" />
                            <div className={`scenario-matchup-overall-bar ${direction}`} style={barStyle} />
                          </div>
                          <div className={`scenario-matchup-overall-value ${direction}`}>
                            {metric.value >= 0 ? "+" : ""}
                            {metric.value.toFixed(2)}
                          </div>
                          <div className="scenario-matchup-overall-metric-label">{metric.label}</div>
                        </div>
                      );
                    })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
}

function TeamMatchupChordDiagram({
  edges,
  teams,
  perspectiveLabel,
  selectedHeadToHead,
  onEdgeSelect
}: {
  edges: TeamMatchupDirectionalEdge[];
  teams: Team[];
  perspectiveLabel: "offense" | "defense";
  selectedHeadToHead: HeadToHeadSelection | null;
  onEdgeSelect: (selection: HeadToHeadSelection | null) => void;
}) {
  const [hoveredTeamId, setHoveredTeamId] = useState<string | null>(null);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [hoveredEdgeKey, setHoveredEdgeKey] = useState<string | null>(null);
  const [hoveredEdgeTooltip, setHoveredEdgeTooltip] = useState<{
    title: string;
    scoreLabel: string;
    color: string;
    x: number;
    y: number;
  } | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const markerNamespace = useId().replace(/:/g, "");
  const groups = useMemo(() => {
    const positions = getTeamMatchupNodeLayout(teams.length);
    return teams.map((team, index) => ({
      team,
      index,
      position: positions[index] ?? positions[positions.length - 1] ?? { x: MATCHUP_CHORD_SIZE / 2, y: MATCHUP_CHORD_HEIGHT / 2 },
      labelOffset: getTeamMatchupTextOffset(index, teams.length)
    }));
  }, [teams]);
  const groupByTeamId = useMemo(() => new Map(groups.map((group) => [group.team.id, group] as const)), [groups]);
  const activeTeamId = selectedTeamId ?? hoveredTeamId;
  const markerDefinitions = useMemo(
    () => [
      { id: `${markerNamespace}-${perspectiveLabel}-arrow-yellow`, color: "#facc15" },
      { id: `${markerNamespace}-${perspectiveLabel}-arrow-orange`, color: "#fb923c" },
      { id: `${markerNamespace}-${perspectiveLabel}-arrow-red`, color: "#dc2626" },
      { id: `${markerNamespace}-${perspectiveLabel}-arrow-green-light`, color: "#84cc16" },
      { id: `${markerNamespace}-${perspectiveLabel}-arrow-green`, color: "#16a34a" }
    ],
    [markerNamespace, perspectiveLabel]
  );
  const markerIdByColor = useMemo(
    () => new Map(markerDefinitions.map((marker) => [marker.color, marker.id] as const)),
    [markerDefinitions]
  );

  if (edges.length === 0 || teams.length < 2) {
    return (
      <div className="scenario-matchup-empty">
        All {perspectiveLabel} matchups are currently neutral.
      </div>
    );
  }

  return (
    <div
      ref={wrapRef}
      className="scenario-matchup-chord-wrap"
      onMouseLeave={() => {
        setHoveredEdgeKey(null);
        setHoveredEdgeTooltip(null);
      }}
    >
      <svg
        className="scenario-matchup-chord"
        viewBox={`0 0 ${MATCHUP_CHORD_SIZE} ${MATCHUP_CHORD_HEIGHT}`}
        role="img"
        aria-label={`${perspectiveLabel} team matchup chord diagram`}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            setSelectedTeamId(null);
            setHoveredTeamId(null);
            setHoveredEdgeKey(null);
            setHoveredEdgeTooltip(null);
            onEdgeSelect(null);
          }
        }}
      >
        <defs>
          {markerDefinitions.map((marker) => (
            <marker
              key={marker.id}
              id={marker.id}
              viewBox="0 0 12 12"
              markerWidth="12"
              markerHeight="12"
              refX="0"
              refY="6"
              orient="auto"
              markerUnits="userSpaceOnUse"
            >
              <path d="M 0 0 L 12 6 L 0 12 z" fill={marker.color} />
            </marker>
          ))}
        </defs>
        {edges.map((edge) => {
          const source = groupByTeamId.get(edge.sourceTeamId);
          const target = groupByTeamId.get(edge.targetTeamId);

          if (!source || !target) {
            return null;
          }

          const color = getDirectionalTeamMatchupColor(edge.cumulativeScore);
          const isActiveOutgoing = activeTeamId !== null && edge.sourceTeamId === activeTeamId;
          const isDimmed = activeTeamId !== null && !isActiveOutgoing;
          const edgeKey = `${edge.sourceTeamId}:${edge.targetTeamId}`;
          const isSelected =
            selectedHeadToHead?.perspective === perspectiveLabel &&
            selectedHeadToHead?.sourceTeamId === edge.sourceTeamId &&
            selectedHeadToHead?.targetTeamId === edge.targetTeamId;
          const isHovered = hoveredEdgeKey === edgeKey || isSelected;
          const opposingLabel = perspectiveLabel === "offense" ? "defense" : "offense";
          const tooltipTitle = `${getTeamDisplayName(source.team, source.index)} ${perspectiveLabel} vs. ${getTeamDisplayName(target.team, target.index)} ${opposingLabel}`;

          const centerlinePath = createTeamMatchupLinePath(
            source.position,
            target.position,
            source.index,
            target.index
          );
          const taperedBodyPath = createTeamMatchupTaperedBodyPath(
            source.position,
            target.position,
            source.index,
            target.index
          );

          return (
            <g
              key={edgeKey}
              opacity={isHovered ? 1 : isDimmed ? 0.2 : isActiveOutgoing ? 0.98 : 0.9}
              className={`scenario-matchup-chord-link${isActiveOutgoing ? " active" : ""}${isDimmed ? " inactive" : ""}${isHovered ? " hovered" : ""}`}
              onMouseEnter={(event) => {
                const bounds = wrapRef.current?.getBoundingClientRect();
                const x = bounds ? event.clientX - bounds.left : 0;
                const y = bounds ? event.clientY - bounds.top : 0;
                setHoveredEdgeKey(edgeKey);
                setHoveredEdgeTooltip({
                  title: tooltipTitle,
                  scoreLabel: `${edge.cumulativeScore >= 0 ? "+" : ""}${edge.cumulativeScore.toFixed(2)}`,
                  color,
                  x,
                  y
                });
              }}
              onMouseMove={(event) => {
                const bounds = wrapRef.current?.getBoundingClientRect();
                const x = bounds ? event.clientX - bounds.left : 0;
                const y = bounds ? event.clientY - bounds.top : 0;
                setHoveredEdgeKey(edgeKey);
                setHoveredEdgeTooltip((current) =>
                  current
                    ? {
                        ...current,
                        title: tooltipTitle,
                        scoreLabel: `${edge.cumulativeScore >= 0 ? "+" : ""}${edge.cumulativeScore.toFixed(2)}`,
                        color,
                        x,
                        y
                      }
                    : {
                        title: tooltipTitle,
                        scoreLabel: `${edge.cumulativeScore >= 0 ? "+" : ""}${edge.cumulativeScore.toFixed(2)}`,
                        color,
                        x,
                        y
                      }
                );
              }}
              onMouseLeave={() => {
                setHoveredEdgeKey((current) => (current === edgeKey ? null : current));
                setHoveredEdgeTooltip((current) =>
                  current?.title === tooltipTitle
                    ? null
                    : current
                );
              }}
              onClick={(event) => {
                event.stopPropagation();
                onEdgeSelect(
                  isSelected
                    ? null
                    : {
                        perspective: perspectiveLabel,
                        sourceTeamId: edge.sourceTeamId,
                        targetTeamId: edge.targetTeamId
                      }
                );
              }}
            >
              {isHovered ? (
                <path
                  d={taperedBodyPath}
                  fill="none"
                  stroke="rgba(255, 255, 255, 0.55)"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
              ) : null}
              <path d={taperedBodyPath} fill={color} stroke="none" />
              <path
                d={centerlinePath}
                fill="none"
                stroke="transparent"
                strokeWidth="1"
                strokeLinecap="butt"
                strokeLinejoin="round"
                markerEnd={`url(#${markerIdByColor.get(color) ?? markerDefinitions[0]?.id})`}
              />
            </g>
          );
        })}
        {groups.map((group, index) => {
          const isFocused = activeTeamId === group.team.id;
          const isDimmed = activeTeamId !== null && activeTeamId !== group.team.id;
          const isHeadToHeadRelated =
            selectedHeadToHead?.perspective === perspectiveLabel &&
            (selectedHeadToHead.sourceTeamId === group.team.id ||
              selectedHeadToHead.targetTeamId === group.team.id);
          const labelX = group.position.x + group.labelOffset.x;
          const labelY = group.position.y + group.labelOffset.y;

          return (
            <g
              key={group.team.id}
              className={`scenario-matchup-node-group${isFocused ? " active" : ""}${selectedTeamId === group.team.id ? " pinned" : ""}${isDimmed ? " inactive" : ""}${isHeadToHeadRelated ? " head-to-head-related" : ""}`}
              onMouseEnter={() => {
                if (selectedTeamId === null) {
                  setHoveredTeamId(group.team.id);
                }
              }}
              onMouseLeave={() => {
                if (selectedTeamId === null) {
                  setHoveredTeamId(null);
                }
              }}
              onClick={(event) => {
                event.stopPropagation();
                setSelectedTeamId((current) => (current === group.team.id ? null : group.team.id));
                setHoveredTeamId(null);
              }}
            >
              <circle
                cx={group.position.x}
                cy={group.position.y}
                r={MATCHUP_NODE_RADIUS}
                fill={group.team.color}
                stroke={isFocused ? "rgba(255,255,255,0.8)" : "rgba(255,255,255,0.22)"}
                strokeWidth={isFocused ? "2.6" : "1.5"}
                className={`scenario-matchup-chord-node${isFocused ? " active" : ""}${selectedTeamId === group.team.id ? " pinned" : ""}`}
              />
              <text
                x={labelX}
                y={labelY}
                textAnchor="middle"
                className={`scenario-matchup-chord-label${isFocused ? " active" : ""}${selectedTeamId === group.team.id ? " pinned" : ""}${isDimmed ? " inactive" : ""}`}
              >
                {getMatchupTeamLabelLines(getTeamDisplayName(group.team, index)).map((line, lineIndex, lines) => (
                  <tspan
                    key={`${group.team.id}:${line}:${lineIndex}`}
                    x={labelX}
                    dy={lineIndex === 0 ? `${-((lines.length - 1) * 0.58)}em` : "1.16em"}
                  >
                    {line}
                  </tspan>
                ))}
              </text>
            </g>
          );
        })}
      </svg>
      {hoveredEdgeTooltip ? (
        <div
          className="scenario-matchup-tooltip"
          style={{
            left: `${hoveredEdgeTooltip.x}px`,
            top: `${hoveredEdgeTooltip.y}px`
          }}
        >
          <div className="scenario-matchup-tooltip-title">{hoveredEdgeTooltip.title}</div>
          <div
            className="scenario-matchup-tooltip-score"
            style={{ color: hoveredEdgeTooltip.color }}
          >
            {hoveredEdgeTooltip.scoreLabel}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function TeamsPage() {
  return (
    <TournamentBuilderProvider>
      <TeamsContent />
    </TournamentBuilderProvider>
  );
}
