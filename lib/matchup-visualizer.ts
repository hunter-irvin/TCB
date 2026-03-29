export const MATCHUP_VISUALIZER_PERSPECTIVES = ["offense", "defense"] as const;
export const MATCHUP_VISUALIZER_VIEWS = ["good_matchup", "imbalanced", "overall"] as const;
export const MATCHUP_VISUALIZER_MIN_COUNT = 1;
export const MATCHUP_VISUALIZER_MAX_COUNT = 5;
export const MATCHUP_VISUALIZER_GOOD_DEADBAND = 0.3;

export type MatchupVisualizerPerspective = (typeof MATCHUP_VISUALIZER_PERSPECTIVES)[number];
export type MatchupVisualizerView = (typeof MATCHUP_VISUALIZER_VIEWS)[number];
export type MatchupVisualizerEdgeTone = "neutral" | "positive" | "negative";
export type MatchupVisualizerResult = "good_matchup" | "offense_wins" | "defense_wins";

export type MatchupVisualizerNode = {
  id: number;
  rowNumber: number;
  name: string;
};

export type MatchupVisualizerEdge = {
  sourcePlayerId: number;
  targetPlayerId: number;
  count: number;
  voteTotal: number;
  tone: MatchupVisualizerEdgeTone;
  winVotes: number;
  goodVotes: number;
  loseVotes: number;
  rawScore: number;
  normalizedScore: number;
  colorHex: string;
};

export type MatchupVisualizerResponse = {
  perspective: MatchupVisualizerPerspective;
  view: MatchupVisualizerView;
  minCount: number;
  nodes: MatchupVisualizerNode[];
  matrix: number[][];
  edges: MatchupVisualizerEdge[];
  maxCount: number;
  totalConnections: number;
  totalVotes: number;
};

export type MatchupVisualizerDatasetCollection = {
  offense: {
    good_matchup: MatchupVisualizerResponse;
    imbalanced: MatchupVisualizerResponse;
    overall: MatchupVisualizerResponse;
  };
  defense: {
    good_matchup: MatchupVisualizerResponse;
    imbalanced: MatchupVisualizerResponse;
    overall: MatchupVisualizerResponse;
  };
};

export type MatchupVisualizerBundleResponse = {
  minCount: number;
  rawVoteTotals: Record<MatchupVisualizerView, number>;
  datasets: MatchupVisualizerDatasetCollection;
};

type PlayerRow = {
  id: number;
  row_number: number;
  name: string;
};

type MatchupVisualizerResponseRow = {
  offense_player_id: number;
  defense_player_id: number;
  result: MatchupVisualizerResult;
};

type MatchupVisualizerPairAggregate = {
  sourcePlayerId: number;
  targetPlayerId: number;
  goodCount: number;
  positiveCount: number;
  negativeCount: number;
};

export function isMatchupVisualizerPerspective(
  value: unknown
): value is MatchupVisualizerPerspective {
  return MATCHUP_VISUALIZER_PERSPECTIVES.includes(value as MatchupVisualizerPerspective);
}

export function isMatchupVisualizerView(value: unknown): value is MatchupVisualizerView {
  return MATCHUP_VISUALIZER_VIEWS.includes(value as MatchupVisualizerView);
}

export function matchupVisualizerNodesFromRows(rows: PlayerRow[]): MatchupVisualizerNode[] {
  return rows
    .filter((row) => row.name.trim().length > 0)
    .map((row) => ({
      id: row.id,
      rowNumber: row.row_number,
      name: row.name.trim()
    }))
    .sort((left, right) => left.rowNumber - right.rowNumber);
}

export function abbreviateVisualizerName(name: string) {
  const compact = name.trim().replace(/\s+/g, " ");

  if (compact.length <= 12) {
    return compact;
  }

  const parts = compact.split(" ");
  if (parts.length < 2) {
    return compact.slice(0, 12);
  }

  const lastName = parts[parts.length - 1];
  const firstNames = parts.slice(0, -1).join(" ");
  return `${firstNames} ${lastName.charAt(0)}.`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function interpolateChannel(start: number, end: number, amount: number) {
  return Math.round(start + (end - start) * amount);
}

function rgbToHex(red: number, green: number, blue: number) {
  return `#${[red, green, blue]
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")}`;
}

export function normalizeUnifiedColorScore(rawScore: number) {
  const clampedScore = clamp(rawScore, -1, 1);

  if (clampedScore <= -MATCHUP_VISUALIZER_GOOD_DEADBAND) {
    return (clampedScore + MATCHUP_VISUALIZER_GOOD_DEADBAND) / (1 - MATCHUP_VISUALIZER_GOOD_DEADBAND);
  }

  if (clampedScore >= MATCHUP_VISUALIZER_GOOD_DEADBAND) {
    return (clampedScore - MATCHUP_VISUALIZER_GOOD_DEADBAND) / (1 - MATCHUP_VISUALIZER_GOOD_DEADBAND);
  }

  return 0;
}

export function getUnifiedEdgeTone(score: number): MatchupVisualizerEdgeTone {
  if (score > 0) {
    return "positive";
  }

  if (score < 0) {
    return "negative";
  }

  return "neutral";
}

export function interpolateUnifiedMatchupColor(score: number) {
  const clampedScore = clamp(score, -1, 1);
  const red = { red: 220, green: 38, blue: 38 };
  const yellow = { red: 250, green: 204, blue: 21 };
  const green = { red: 22, green: 163, blue: 74 };

  if (clampedScore < 0) {
    const amount = clampedScore + 1;
    return rgbToHex(
      interpolateChannel(red.red, yellow.red, amount),
      interpolateChannel(red.green, yellow.green, amount),
      interpolateChannel(red.blue, yellow.blue, amount)
    );
  }

  return rgbToHex(
    interpolateChannel(yellow.red, green.red, clampedScore),
    interpolateChannel(yellow.green, green.green, clampedScore),
    interpolateChannel(yellow.blue, green.blue, clampedScore)
  );
}

function createMatchupVisualizerResponse(
  players: MatchupVisualizerNode[],
  edges: MatchupVisualizerEdge[],
  perspective: MatchupVisualizerPerspective,
  view: MatchupVisualizerView,
  minCount: number
): MatchupVisualizerResponse {
  const indexByPlayerId = new Map(players.map((player, index) => [player.id, index] as const));
  const matrix = players.map(() => players.map(() => 0));
  let maxCount = 0;

  for (const edge of edges) {
    const sourceIndex = indexByPlayerId.get(edge.sourcePlayerId);
    const targetIndex = indexByPlayerId.get(edge.targetPlayerId);

    if (sourceIndex === undefined || targetIndex === undefined) {
      continue;
    }

    matrix[sourceIndex]![targetIndex] = edge.count;
    maxCount = Math.max(maxCount, edge.count);
  }

  return {
    perspective,
    view,
    minCount,
    nodes: players,
    matrix,
    edges,
    maxCount,
    totalConnections: edges.length,
    totalVotes: edges.reduce((sum, edge) => sum + edge.voteTotal, 0)
  };
}

function buildPairAggregates(
  players: MatchupVisualizerNode[],
  rows: MatchupVisualizerResponseRow[],
  perspective: MatchupVisualizerPerspective
) {
  const playerIds = new Set(players.map((player) => player.id));
  const aggregatesByPair = new Map<string, MatchupVisualizerPairAggregate>();

  for (const row of rows) {
    const offensePlayerId = row.offense_player_id;
    const defensePlayerId = row.defense_player_id;

    if (offensePlayerId === defensePlayerId) {
      continue;
    }

    const sourcePlayerId = perspective === "offense" ? offensePlayerId : defensePlayerId;
    const targetPlayerId = perspective === "offense" ? defensePlayerId : offensePlayerId;

    if (!playerIds.has(sourcePlayerId) || !playerIds.has(targetPlayerId)) {
      continue;
    }

    const key = `${sourcePlayerId}:${targetPlayerId}`;
    const aggregate = aggregatesByPair.get(key) ?? {
      sourcePlayerId,
      targetPlayerId,
      goodCount: 0,
      positiveCount: 0,
      negativeCount: 0
    };

    if (row.result === "good_matchup") {
      aggregate.goodCount += 1;
    } else {
      const isPositiveResult =
        perspective === "offense" ? row.result === "offense_wins" : row.result === "defense_wins";

      if (isPositiveResult) {
        aggregate.positiveCount += 1;
      } else {
        aggregate.negativeCount += 1;
      }
    }

    aggregatesByPair.set(key, aggregate);
  }

  return [...aggregatesByPair.values()];
}

export function buildMatchupVisualizerResponse(
  players: MatchupVisualizerNode[],
  rows: MatchupVisualizerResponseRow[],
  perspective: MatchupVisualizerPerspective,
  view: MatchupVisualizerView,
  minCount: number = MATCHUP_VISUALIZER_MIN_COUNT
): MatchupVisualizerResponse {
  const pairAggregates = buildPairAggregates(players, rows, perspective);
  const edges: MatchupVisualizerEdge[] = [];

  for (const aggregate of pairAggregates) {
    if (view === "good_matchup") {
      if (aggregate.goodCount < minCount) {
        continue;
      }

      const voteTotal = aggregate.goodCount;
      edges.push({
        sourcePlayerId: aggregate.sourcePlayerId,
        targetPlayerId: aggregate.targetPlayerId,
        count: aggregate.goodCount,
        voteTotal,
        tone: "neutral",
        winVotes: 0,
        goodVotes: aggregate.goodCount,
        loseVotes: 0,
        rawScore: 0,
        normalizedScore: 0,
        colorHex: interpolateUnifiedMatchupColor(0)
      });
      continue;
    }

    if (view === "overall") {
      const totalVotes =
        aggregate.goodCount + aggregate.positiveCount + aggregate.negativeCount;

      if (totalVotes < minCount) {
        continue;
      }

      const rawScore = (aggregate.positiveCount - aggregate.negativeCount) / totalVotes;
      const normalizedScore = normalizeUnifiedColorScore(rawScore);

      edges.push({
        sourcePlayerId: aggregate.sourcePlayerId,
        targetPlayerId: aggregate.targetPlayerId,
        count: totalVotes,
        voteTotal: totalVotes,
        tone: getUnifiedEdgeTone(normalizedScore),
        winVotes: aggregate.positiveCount,
        goodVotes: aggregate.goodCount,
        loseVotes: aggregate.negativeCount,
        rawScore,
        normalizedScore,
        colorHex: interpolateUnifiedMatchupColor(normalizedScore)
      });
      continue;
    }

    const netCount = aggregate.positiveCount - aggregate.negativeCount;
    if (Math.abs(netCount) < minCount || netCount === 0) {
      continue;
    }

    const voteTotal = aggregate.positiveCount + aggregate.negativeCount;
    const rawScore = netCount / voteTotal;
    const normalizedScore = normalizeUnifiedColorScore(rawScore);

    edges.push({
      sourcePlayerId: aggregate.sourcePlayerId,
      targetPlayerId: aggregate.targetPlayerId,
      count: Math.abs(netCount),
      voteTotal,
      tone: netCount > 0 ? "positive" : "negative",
      winVotes: aggregate.positiveCount,
      goodVotes: 0,
      loseVotes: aggregate.negativeCount,
      rawScore,
      normalizedScore,
      colorHex: interpolateUnifiedMatchupColor(normalizedScore)
    });
  }

  return createMatchupVisualizerResponse(players, edges, perspective, view, minCount);
}

export function buildMatchupVisualizerBundleResponse(
  players: MatchupVisualizerNode[],
  rows: MatchupVisualizerResponseRow[],
  minCount: number = MATCHUP_VISUALIZER_MIN_COUNT
): MatchupVisualizerBundleResponse {
  return {
    minCount,
    rawVoteTotals: {
      overall: rows.length,
      good_matchup: rows.filter((row) => row.result === "good_matchup").length,
      imbalanced: rows.filter((row) => row.result !== "good_matchup").length
    },
    datasets: {
      offense: {
        good_matchup: buildMatchupVisualizerResponse(
          players,
          rows,
          "offense",
          "good_matchup",
          minCount
        ),
        imbalanced: buildMatchupVisualizerResponse(
          players,
          rows,
          "offense",
          "imbalanced",
          minCount
        ),
        overall: buildMatchupVisualizerResponse(
          players,
          rows,
          "offense",
          "overall",
          minCount
        )
      },
      defense: {
        good_matchup: buildMatchupVisualizerResponse(
          players,
          rows,
          "defense",
          "good_matchup",
          minCount
        ),
        imbalanced: buildMatchupVisualizerResponse(
          players,
          rows,
          "defense",
          "imbalanced",
          minCount
        ),
        overall: buildMatchupVisualizerResponse(
          players,
          rows,
          "defense",
          "overall",
          minCount
        )
      }
    }
  };
}

export function filterMatchupVisualizerResponse(
  data: MatchupVisualizerResponse,
  minCount: number
): MatchupVisualizerResponse {
  return createMatchupVisualizerResponse(
    data.nodes,
    data.edges.filter((edge) =>
      data.view === "imbalanced" ? edge.count >= minCount : edge.voteTotal >= minCount
    ),
    data.perspective,
    data.view,
    minCount
  );
}
