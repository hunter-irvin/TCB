import {
  interpolateUnifiedMatchupColor,
  MATCHUP_VISUALIZER_GOOD_DEADBAND,
  normalizeUnifiedColorScore,
  type MatchupVisualizerBundleResponse,
  type MatchupVisualizerPerspective
} from "@/lib/matchup-visualizer";
import { POSITIONS } from "@/lib/constants";
import type { Assignments, Player, Team } from "@/lib/types";

export type TeamMatchupPairScore = {
  rawScore: number;
  normalizedScore: number;
  colorHex: string;
  isFair: boolean;
  voteTotal: number;
};

export type TeamMatchupChosenPair = {
  sourcePlayerId: number;
  targetPlayerId: number;
  rawScore: number;
  normalizedScore: number;
  colorHex: string;
  isFair: boolean;
  voteTotal: number;
};

export type TeamMatchupPerspectiveReport = {
  sourceTeamId: string;
  targetTeamId: string;
  pairCount: number;
  pairs: TeamMatchupChosenPair[];
  fairPairCount: number;
  unfairnessMagnitude: number;
  cumulativeScore: number;
  averageScore: number;
  normalizedScore: number;
  colorHex: string;
};

export type TeamMatchupPairReport = {
  leftTeamId: string;
  rightTeamId: string;
  offense: TeamMatchupPerspectiveReport;
  defense: TeamMatchupPerspectiveReport;
  overallCumulativeScore: number;
};

export type TeamMatchupNetAdvantage = {
  teamId: string;
  overall: number;
  offense: number;
  defense: number;
};

export type TeamMatchupDirectionalEdge = {
  sourceTeamId: string;
  targetTeamId: string;
  cumulativeScore: number;
  averageScore: number;
  normalizedScore: number;
  colorHex: string;
};

export type ScenarioMatchupReport = {
  teamPairs: TeamMatchupPairReport[];
  teamNetAdvantages: TeamMatchupNetAdvantage[];
  totalFairPairCount: number;
  totalUnfairnessMagnitude: number;
  overallNetSpread: number;
  offenseEdges: TeamMatchupDirectionalEdge[];
  defenseEdges: TeamMatchupDirectionalEdge[];
};

export type ScenarioMatchupSwapSuggestion = {
  sourceTeamId: string;
  targetTeamId: string;
  sourcePlayerId: number;
  targetPlayerId: number;
  nextReport: ScenarioMatchupReport;
};

export type MatchupScoreLookup = {
  offense: Map<string, TeamMatchupPairScore>;
  defense: Map<string, TeamMatchupPairScore>;
};

const NEUTRAL_MATCHUP_SCORE: TeamMatchupPairScore = {
  rawScore: 0,
  normalizedScore: 0,
  colorHex: interpolateUnifiedMatchupColor(0),
  isFair: true,
  voteTotal: 0
};

type RankedAssignment = {
  pairs: TeamMatchupChosenPair[];
  fairPairCount: number;
  unfairnessMagnitude: number;
  cumulativeScore: number;
};

function buildLookupKey(sourcePlayerId: number, targetPlayerId: number) {
  return `${sourcePlayerId}:${targetPlayerId}`;
}

function buildPairScore(
  rawScore: number,
  normalizedScore: number,
  colorHex: string,
  voteTotal: number
): TeamMatchupPairScore {
  return {
    rawScore,
    normalizedScore,
    colorHex,
    isFair: Math.abs(rawScore) <= MATCHUP_VISUALIZER_GOOD_DEADBAND,
    voteTotal
  };
}

function getAssignedPlayerIds(assignments: Assignments, teamId: string) {
  return POSITIONS.map((position) => assignments[teamId]?.[position] ?? null).filter(
    (playerId): playerId is number => playerId !== null
  );
}

function getValueRange(values: number[]) {
  if (values.length <= 1) {
    return 0;
  }

  return Math.max(...values) - Math.min(...values);
}

function getPairMismatchMagnitude(pair: Pick<TeamMatchupChosenPair, "rawScore">) {
  return Math.abs(pair.rawScore);
}

function summarizePairs(
  sourceTeamId: string,
  targetTeamId: string,
  pairs: TeamMatchupChosenPair[]
): TeamMatchupPerspectiveReport {
  const fairPairCount = pairs.filter((pair) => pair.isFair).length;
  const unfairnessMagnitude = pairs.reduce(
    (sum, pair) => sum + getPairMismatchMagnitude(pair),
    0
  );
  const cumulativeScore = pairs.reduce((sum, pair) => sum + pair.rawScore, 0);
  const averageScore = pairs.length > 0 ? cumulativeScore / pairs.length : 0;
  const normalizedScore = normalizeUnifiedColorScore(averageScore);

  return {
    sourceTeamId,
    targetTeamId,
    pairCount: pairs.length,
    pairs,
    fairPairCount,
    unfairnessMagnitude,
    cumulativeScore,
    averageScore,
    normalizedScore,
    colorHex: interpolateUnifiedMatchupColor(normalizedScore)
  };
}

function isBetterAssignment(candidate: RankedAssignment, currentBest: RankedAssignment | null) {
  if (!currentBest) {
    return true;
  }

  if (candidate.fairPairCount !== currentBest.fairPairCount) {
    return candidate.fairPairCount > currentBest.fairPairCount;
  }

  if (candidate.unfairnessMagnitude !== currentBest.unfairnessMagnitude) {
    return candidate.unfairnessMagnitude < currentBest.unfairnessMagnitude;
  }

  return false;
}

function rankPairs(pairs: TeamMatchupChosenPair[]): RankedAssignment {
  return {
    pairs,
    fairPairCount: pairs.filter((pair) => pair.isFair).length,
    unfairnessMagnitude: pairs.reduce((sum, pair) => sum + getPairMismatchMagnitude(pair), 0),
    cumulativeScore: pairs.reduce((sum, pair) => sum + pair.rawScore, 0)
  };
}

function cloneAssignments(assignments: Assignments): Assignments {
  return Object.fromEntries(
    Object.entries(assignments).map(([teamId, slots]) => [teamId, { ...slots }])
  );
}

function isCompleteScenario(assignments: Assignments, teams: Team[]) {
  return teams.every((team) =>
    POSITIONS.every((position) => (assignments[team.id]?.[position] ?? null) !== null)
  );
}

function isBetterScenarioReport(candidate: ScenarioMatchupReport, currentBest: ScenarioMatchupReport) {
  if (candidate.totalFairPairCount !== currentBest.totalFairPairCount) {
    return candidate.totalFairPairCount > currentBest.totalFairPairCount;
  }

  if (candidate.totalUnfairnessMagnitude !== currentBest.totalUnfairnessMagnitude) {
    return candidate.totalUnfairnessMagnitude < currentBest.totalUnfairnessMagnitude;
  }

  if (candidate.overallNetSpread !== currentBest.overallNetSpread) {
    return candidate.overallNetSpread < currentBest.overallNetSpread;
  }

  return false;
}

function swapAssignedPlayers(
  assignments: Assignments,
  leftTeamId: string,
  leftPosition: (typeof POSITIONS)[number],
  rightTeamId: string,
  rightPosition: (typeof POSITIONS)[number]
) {
  const nextAssignments = cloneAssignments(assignments);
  const leftPlayerId = nextAssignments[leftTeamId]?.[leftPosition] ?? null;
  const rightPlayerId = nextAssignments[rightTeamId]?.[rightPosition] ?? null;

  nextAssignments[leftTeamId][leftPosition] = rightPlayerId;
  nextAssignments[rightTeamId][rightPosition] = leftPlayerId;

  return nextAssignments;
}

function getPairScore(
  lookup: MatchupScoreLookup,
  perspective: MatchupVisualizerPerspective,
  sourcePlayerId: number,
  targetPlayerId: number
) {
  const perspectiveLookup = perspective === "offense" ? lookup.offense : lookup.defense;
  return (
    perspectiveLookup.get(buildLookupKey(sourcePlayerId, targetPlayerId)) ??
    NEUTRAL_MATCHUP_SCORE
  );
}

function solveBestPerspectiveAssignment(
  sourcePlayerIds: number[],
  targetPlayerIds: number[],
  sourceTeamId: string,
  targetTeamId: string,
  perspective: MatchupVisualizerPerspective,
  lookup: MatchupScoreLookup
): TeamMatchupPerspectiveReport {
  if (sourcePlayerIds.length === 0 || targetPlayerIds.length === 0) {
    return summarizePairs(sourceTeamId, targetTeamId, []);
  }

  let hasBest = false;
  let best: RankedAssignment = {
    pairs: [],
    fairPairCount: -1,
    unfairnessMagnitude: Number.POSITIVE_INFINITY,
    cumulativeScore: 0
  };

  if (sourcePlayerIds.length <= targetPlayerIds.length) {
    const recurse = (
      sourceIndex: number,
      remainingTargetIds: number[],
      currentPairs: TeamMatchupChosenPair[]
    ) => {
      if (sourceIndex >= sourcePlayerIds.length) {
        const candidate = rankPairs(currentPairs);
        if (!hasBest || isBetterAssignment(candidate, best)) {
          hasBest = true;
          best = candidate;
        }
        return;
      }

      const sourcePlayerId = sourcePlayerIds[sourceIndex];

      for (const targetPlayerId of remainingTargetIds) {
        const score = getPairScore(lookup, perspective, sourcePlayerId, targetPlayerId);
        recurse(
          sourceIndex + 1,
          remainingTargetIds.filter((candidateId) => candidateId !== targetPlayerId),
          [
            ...currentPairs,
            {
              sourcePlayerId,
              targetPlayerId,
              rawScore: score.rawScore,
              normalizedScore: score.normalizedScore,
              colorHex: score.colorHex,
              isFair: score.isFair,
              voteTotal: score.voteTotal
            }
          ]
        );
      }
    };

    recurse(0, [...targetPlayerIds], []);
  } else {
    const recurse = (
      targetIndex: number,
      remainingSourceIds: number[],
      currentPairs: TeamMatchupChosenPair[]
    ) => {
      if (targetIndex >= targetPlayerIds.length) {
        const candidate = rankPairs(currentPairs);
        if (!hasBest || isBetterAssignment(candidate, best)) {
          hasBest = true;
          best = candidate;
        }
        return;
      }

      const targetPlayerId = targetPlayerIds[targetIndex];

      for (const sourcePlayerId of remainingSourceIds) {
        const score = getPairScore(lookup, perspective, sourcePlayerId, targetPlayerId);
        recurse(
          targetIndex + 1,
          remainingSourceIds.filter((candidateId) => candidateId !== sourcePlayerId),
          [
            ...currentPairs,
            {
              sourcePlayerId,
              targetPlayerId,
              rawScore: score.rawScore,
              normalizedScore: score.normalizedScore,
              colorHex: score.colorHex,
              isFair: score.isFair,
              voteTotal: score.voteTotal
            }
          ]
        );
      }
    };

    recurse(0, [...sourcePlayerIds], []);
  }

  return summarizePairs(sourceTeamId, targetTeamId, best.pairs);
}

function buildDirectionalEdge(
  sourceTeamId: string,
  targetTeamId: string,
  cumulativeScore: number,
  pairCount: number
): TeamMatchupDirectionalEdge {
  const averageScore = pairCount > 0 ? cumulativeScore / pairCount : 0;
  const normalizedScore = normalizeUnifiedColorScore(averageScore);

  return {
    sourceTeamId,
    targetTeamId,
    cumulativeScore,
    averageScore,
    normalizedScore,
    colorHex: interpolateUnifiedMatchupColor(normalizedScore)
  };
}

export function buildMatchupScoreLookup(
  bundle: MatchupVisualizerBundleResponse | null | undefined
): MatchupScoreLookup {
  const offense = new Map<string, TeamMatchupPairScore>();
  const defense = new Map<string, TeamMatchupPairScore>();

  if (!bundle) {
    return { offense, defense };
  }

  for (const edge of bundle.datasets.offense.overall.edges) {
    offense.set(
      buildLookupKey(edge.sourcePlayerId, edge.targetPlayerId),
      buildPairScore(edge.rawScore, edge.normalizedScore, edge.colorHex, edge.voteTotal)
    );
  }

  for (const edge of bundle.datasets.defense.overall.edges) {
    defense.set(
      buildLookupKey(edge.sourcePlayerId, edge.targetPlayerId),
      buildPairScore(edge.rawScore, edge.normalizedScore, edge.colorHex, edge.voteTotal)
    );
  }

  return { offense, defense };
}

export function buildScenarioMatchupReport(
  assignments: Assignments,
  teams: Team[],
  lookup: MatchupScoreLookup
): ScenarioMatchupReport {
  const teamPairs: TeamMatchupPairReport[] = [];
  const teamNetAdvantages = new Map<string, TeamMatchupNetAdvantage>(
    teams.map((team) => [
      team.id,
      {
        teamId: team.id,
        overall: 0,
        offense: 0,
        defense: 0
      }
    ])
  );
  const offenseEdges: TeamMatchupDirectionalEdge[] = [];
  const defenseEdges: TeamMatchupDirectionalEdge[] = [];
  let totalFairPairCount = 0;
  let totalUnfairnessMagnitude = 0;

  for (let leftIndex = 0; leftIndex < teams.length; leftIndex += 1) {
    const leftTeam = teams[leftIndex];
    const leftPlayerIds = getAssignedPlayerIds(assignments, leftTeam.id);

    for (let rightIndex = leftIndex + 1; rightIndex < teams.length; rightIndex += 1) {
      const rightTeam = teams[rightIndex];
      const rightPlayerIds = getAssignedPlayerIds(assignments, rightTeam.id);

      const offense = solveBestPerspectiveAssignment(
        leftPlayerIds,
        rightPlayerIds,
        leftTeam.id,
        rightTeam.id,
        "offense",
        lookup
      );
      const defense = solveBestPerspectiveAssignment(
        leftPlayerIds,
        rightPlayerIds,
        leftTeam.id,
        rightTeam.id,
        "defense",
        lookup
      );
      const overallCumulativeScore = offense.cumulativeScore + defense.cumulativeScore;

      teamPairs.push({
        leftTeamId: leftTeam.id,
        rightTeamId: rightTeam.id,
        offense,
        defense,
        overallCumulativeScore
      });

      totalFairPairCount += offense.fairPairCount + defense.fairPairCount;
      totalUnfairnessMagnitude += offense.unfairnessMagnitude + defense.unfairnessMagnitude;

      const leftNet = teamNetAdvantages.get(leftTeam.id);
      const rightNet = teamNetAdvantages.get(rightTeam.id);

      if (leftNet && rightNet) {
        leftNet.overall += overallCumulativeScore;
        leftNet.offense += offense.cumulativeScore;
        leftNet.defense += defense.cumulativeScore;
        rightNet.overall -= overallCumulativeScore;
        rightNet.offense -= defense.cumulativeScore;
        rightNet.defense -= offense.cumulativeScore;
      }

      offenseEdges.push(
        buildDirectionalEdge(
          leftTeam.id,
          rightTeam.id,
          offense.cumulativeScore,
          offense.pairCount
        ),
        buildDirectionalEdge(
          rightTeam.id,
          leftTeam.id,
          -defense.cumulativeScore,
          defense.pairCount
        )
      );

      defenseEdges.push(
        buildDirectionalEdge(
          leftTeam.id,
          rightTeam.id,
          defense.cumulativeScore,
          defense.pairCount
        ),
        buildDirectionalEdge(
          rightTeam.id,
          leftTeam.id,
          -offense.cumulativeScore,
          offense.pairCount
        )
      );
    }
  }

  const netAdvantages = teams.map(
    (team) =>
      teamNetAdvantages.get(team.id) ?? {
        teamId: team.id,
        overall: 0,
        offense: 0,
        defense: 0
      }
  );

  return {
    teamPairs,
    teamNetAdvantages: netAdvantages,
    totalFairPairCount,
    totalUnfairnessMagnitude,
    overallNetSpread: getValueRange(netAdvantages.map((team) => team.overall)),
    offenseEdges,
    defenseEdges
  };
}

export function findBestScenarioMatchupSwap(
  assignments: Assignments,
  teams: Team[],
  playersById: ReadonlyMap<number, Player>,
  lookup: MatchupScoreLookup,
  currentReport: ScenarioMatchupReport = buildScenarioMatchupReport(assignments, teams, lookup)
): ScenarioMatchupSwapSuggestion | null {
  if (!isCompleteScenario(assignments, teams)) {
    return null;
  }

  let bestSuggestion: ScenarioMatchupSwapSuggestion | null = null;

  for (let leftIndex = 0; leftIndex < teams.length; leftIndex += 1) {
    const leftTeam = teams[leftIndex];

    for (let rightIndex = leftIndex + 1; rightIndex < teams.length; rightIndex += 1) {
      const rightTeam = teams[rightIndex];

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

          const nextAssignments = swapAssignedPlayers(
            assignments,
            leftTeam.id,
            leftPosition,
            rightTeam.id,
            rightPosition
          );
          const nextReport = buildScenarioMatchupReport(nextAssignments, teams, lookup);

          if (!isBetterScenarioReport(nextReport, currentReport)) {
            continue;
          }

          const candidateSuggestion: ScenarioMatchupSwapSuggestion = {
            sourceTeamId: leftTeam.id,
            targetTeamId: rightTeam.id,
            sourcePlayerId: leftPlayerId,
            targetPlayerId: rightPlayerId,
            nextReport
          };

          if (!bestSuggestion || isBetterScenarioReport(nextReport, bestSuggestion.nextReport)) {
            bestSuggestion = candidateSuggestion;
            continue;
          }

          if (
            bestSuggestion &&
            !isBetterScenarioReport(bestSuggestion.nextReport, nextReport) &&
            `${leftTeam.id}:${leftPlayerId}:${rightTeam.id}:${rightPlayerId}` <
              `${bestSuggestion.sourceTeamId}:${bestSuggestion.sourcePlayerId}:${bestSuggestion.targetTeamId}:${bestSuggestion.targetPlayerId}`
          ) {
            bestSuggestion = candidateSuggestion;
          }
        }
      }
    }
  }

  return bestSuggestion;
}
