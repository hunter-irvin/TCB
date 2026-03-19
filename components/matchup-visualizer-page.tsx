"use client";

import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { arc, scaleLinear } from "d3";
import { AppShell } from "@/components/app-shell";
import {
  abbreviateVisualizerName,
  filterMatchupVisualizerResponse,
  MATCHUP_VISUALIZER_MAX_COUNT,
  MATCHUP_VISUALIZER_MIN_COUNT,
  type MatchupVisualizerBundleResponse,
  type MatchupVisualizerPerspective,
  type MatchupVisualizerResponse,
  type MatchupVisualizerView
} from "@/lib/matchup-visualizer";

type MatchupVisualizerRequestState =
  | { status: "loading"; error: null; data: null }
  | { status: "error"; error: string; data: null }
  | { status: "ready"; error: null; data: MatchupVisualizerBundleResponse };

const CHART_SIZE = 700;
const CHART_HEIGHT = 540;
const CHART_CENTER_X = CHART_SIZE / 2;
const CHART_CENTER_Y = 244;
const OUTER_RADIUS = 172;
const INNER_RADIUS = 162;
const LABEL_BASE_RADIAL_DISTANCE = OUTER_RADIUS + 24;
const LABEL_SIDE_EXTRA_DISTANCE = 28;
const WEDGE_VISUAL_OFFSET = 5;
const NODE_PAD_ANGLE = 0.045;

function polarToCartesianFromOrigin(radius: number, angle: number) {
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius
  };
}

function createCurvedLinkPath(sourceAngle: number, targetAngle: number) {
  const linkRadius = INNER_RADIUS - 10;
  const controlRadius = INNER_RADIUS * 0.34;
  const start = polarToCartesianFromOrigin(linkRadius, sourceAngle);
  const end = polarToCartesianFromOrigin(linkRadius, targetAngle);
  const sourceControl = polarToCartesianFromOrigin(controlRadius, sourceAngle);
  const targetControl = polarToCartesianFromOrigin(controlRadius, targetAngle);

  return `M ${start.x} ${start.y} C ${sourceControl.x} ${sourceControl.y}, ${targetControl.x} ${targetControl.y}, ${end.x} ${end.y}`;
}

function MatchupChordDiagram({
  data,
  perspective,
  selectedPlayerId,
  onSelectedPlayerChange
}: {
  data: MatchupVisualizerResponse;
  perspective: MatchupVisualizerPerspective;
  selectedPlayerId: number | null;
  onSelectedPlayerChange: (playerId: number | null) => void;
}) {
  const [hoveredPlayerId, setHoveredPlayerId] = useState<number | null>(null);
  const arcGenerator = useMemo(() => arc().innerRadius(INNER_RADIUS).outerRadius(OUTER_RADIUS), []);

  useEffect(() => {
    setHoveredPlayerId(null);
    if (
      selectedPlayerId !== null &&
      !data.nodes.some((node) => node.id === selectedPlayerId)
    ) {
      onSelectedPlayerChange(null);
    }
  }, [data, onSelectedPlayerChange, selectedPlayerId]);

  const groups = useMemo(() => {
    const count = data.nodes.length;
    if (count === 0) {
      return [];
    }

    const segmentAngle = (Math.PI * 2 - NODE_PAD_ANGLE * count) / count;

    return data.nodes.map((node, index) => {
      const startAngle = -Math.PI / 2 + index * (segmentAngle + NODE_PAD_ANGLE);
      const endAngle = startAngle + segmentAngle;
      const angle = (startAngle + endAngle) / 2;
      const sideBias = Math.abs(Math.cos(angle));
      const labelRadius =
        LABEL_BASE_RADIAL_DISTANCE + LABEL_SIDE_EXTRA_DISTANCE * sideBias;
      const labelPoint = polarToCartesianFromOrigin(labelRadius, angle);

      return {
        index,
        node,
        startAngle,
        endAngle,
        angle,
        path:
          arcGenerator({
            startAngle,
            endAngle,
            innerRadius: INNER_RADIUS,
            outerRadius: OUTER_RADIUS
          }) ?? "",
        labelPoint
      };
    });
  }, [arcGenerator, data.nodes]);

  const groupByPlayerId = useMemo(
    () => new Map(groups.map((group) => [group.node.id, group] as const)),
    [groups]
  );
  const nodeIdsInOrder = useMemo(() => data.nodes.map((node) => node.id), [data.nodes]);

  const strokeWidthScale = useMemo(
    () =>
      scaleLinear()
        .domain([1, Math.max(data.maxCount, 1)])
        .range([2.5, 14])
        .clamp(true),
    [data.maxCount]
  );

  const links = useMemo(() => {
    return data.edges
      .map((edge) => {
        const sourceGroup = groupByPlayerId.get(edge.sourcePlayerId);
        const targetGroup = groupByPlayerId.get(edge.targetPlayerId);

        if (!sourceGroup || !targetGroup) {
          return null;
        }

        return {
          key: `${edge.sourcePlayerId}:${edge.targetPlayerId}`,
          sourcePlayerId: edge.sourcePlayerId,
          targetPlayerId: edge.targetPlayerId,
          count: edge.count,
          tone: edge.tone,
          path: createCurvedLinkPath(sourceGroup.angle, targetGroup.angle),
          strokeWidth: strokeWidthScale(edge.count)
        };
      })
      .filter((link: any): link is NonNullable<typeof link> => Boolean(link));
  }, [data.edges, groupByPlayerId, strokeWidthScale]);

  const activePlayerId = selectedPlayerId ?? hoveredPlayerId;
  const activeTargetIds = useMemo(() => {
    if (activePlayerId === null) {
      return new Set<number>();
    }

    return new Set(
      links
        .filter((link) => link.sourcePlayerId === activePlayerId)
        .map((link) => link.targetPlayerId)
    );
  }, [activePlayerId, links]);

  const clearHoveredPlayer = () => {
    if (selectedPlayerId === null) {
      setHoveredPlayerId(null);
    }
  };

  const handleLabelPointerEnter = (playerId: number) => {
    if (selectedPlayerId === null) {
      setHoveredPlayerId(playerId);
    }
  };

  const handleLabelClick = (event: MouseEvent<SVGTextElement>, playerId: number) => {
    event.stopPropagation();
    togglePinnedPlayer(playerId);
  };

  const togglePinnedPlayer = (playerId: number) => {
    onSelectedPlayerChange(selectedPlayerId === playerId ? null : playerId);
    setHoveredPlayerId(null);
  };

  return (
    <div className="matchup-visualizer-chart-wrap">
      <svg
        className="matchup-visualizer-chart"
        viewBox={`0 0 ${CHART_SIZE} ${CHART_HEIGHT}`}
        role="img"
        aria-label={`${perspective === "offense" ? "Offense" : "Defense"} ${data.view === "good_matchup" ? "good matchup" : "imbalanced matchup"} chord diagram`}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            onSelectedPlayerChange(null);
            setHoveredPlayerId(null);
          }
        }}
      >
        <defs>
          <radialGradient id="matchup-visualizer-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(255,244,219,0.32)" />
            <stop offset="100%" stopColor="rgba(255,244,219,0)" />
          </radialGradient>
        </defs>

        <circle
          cx={CHART_CENTER_X}
          cy={CHART_CENTER_Y}
          r={INNER_RADIUS + 12}
          fill="url(#matchup-visualizer-glow)"
          aria-hidden="true"
        />

        <g transform={`translate(${CHART_CENTER_X} ${CHART_CENTER_Y})`} className="matchup-visualizer-links">
          {links.map((link: any) => {
            const relatedToHoveredPlayer =
              activePlayerId === null || link.sourcePlayerId === activePlayerId;

            return (
              <path
                key={link.key}
                d={link.path}
                className={`matchup-visualizer-link matchup-visualizer-link-${link.tone}${relatedToHoveredPlayer ? " active" : " inactive"}`}
                data-source-player-id={link.sourcePlayerId}
                data-target-player-id={link.targetPlayerId}
                strokeWidth={link.strokeWidth}
              />
            );
          })}
        </g>

        <g transform={`translate(${CHART_CENTER_X} ${CHART_CENTER_Y})`} className="matchup-visualizer-nodes">
          {groups.map((group: any) => {
            const wedgePlayerId =
              nodeIdsInOrder[
                (group.index - WEDGE_VISUAL_OFFSET + nodeIdsInOrder.length) % nodeIdsInOrder.length
              ] ?? group.node.id;
            const isFocused = wedgePlayerId === activePlayerId;
            const isRelated = activePlayerId !== null && activeTargetIds.has(wedgePlayerId);
            const isVisible = activePlayerId === null || isFocused || isRelated;

            return (
              <path
                key={group.node.id}
                d={group.path}
                className={`matchup-visualizer-node-arc${isFocused ? " active" : ""}${isRelated ? " related" : ""}${selectedPlayerId === wedgePlayerId ? " pinned" : ""}`}
                data-player-id={wedgePlayerId}
                style={{
                  opacity: isVisible ? 1 : 0.18
                }}
              />
            );
          })}
        </g>

        <g className="matchup-visualizer-labels">
          {groups.map((group: any) => {
            const isFocused = group.node.id === activePlayerId;
            const isRelated = activePlayerId !== null && activeTargetIds.has(group.node.id);
            const isDimmed =
              activePlayerId !== null &&
              !isFocused &&
              !isRelated;

            return (
              <g key={group.node.id}>
                <text
                  className={`matchup-visualizer-label${isFocused ? " active" : ""}${isRelated ? " related" : ""}${selectedPlayerId === group.node.id ? " pinned" : ""}`}
                  data-player-id={group.node.id}
                  x={CHART_CENTER_X + group.labelPoint.x}
                  y={CHART_CENTER_Y + group.labelPoint.y}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  style={{ opacity: isDimmed ? 0.22 : 1 }}
                  onPointerEnter={() => handleLabelPointerEnter(group.node.id)}
                  onPointerLeave={clearHoveredPlayer}
                  onClick={(event) => handleLabelClick(event, group.node.id)}
                >
                  {abbreviateVisualizerName(group.node.name)}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}

export function MatchupVisualizerPage() {
  const [perspective, setPerspective] = useState<MatchupVisualizerPerspective>("offense");
  const [view, setView] = useState<MatchupVisualizerView>("good_matchup");
  const [minimumMatchups, setMinimumMatchups] = useState(MATCHUP_VISUALIZER_MIN_COUNT);
  const [selectedPlayerId, setSelectedPlayerId] = useState<number | null>(null);
  const [requestState, setRequestState] = useState<MatchupVisualizerRequestState>({
    status: "loading",
    error: null,
    data: null
  });

  useEffect(() => {
    const controller = new AbortController();

    setRequestState({
      status: "loading",
      error: null,
      data: null
    });

    async function load() {
      try {
        const response = await fetch("/api/matchup-visualizer/chord", {
          method: "GET",
          cache: "no-store",
          signal: controller.signal
        });
        const payload = (await response.json()) as MatchupVisualizerBundleResponse & { error?: string };

        if (!response.ok) {
          throw new Error(payload.error ?? "Unable to load matchup visualization data.");
        }

        setRequestState({
          status: "ready",
          error: null,
          data: payload
        });
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        setRequestState({
          status: "error",
          error: error instanceof Error ? error.message : "Unable to load matchup visualization data.",
          data: null
        });
      }
    }

    void load();

    return () => controller.abort();
  }, []);

  const readyBundle = requestState.status === "ready" ? requestState.data : null;
  const selectedData = readyBundle ? readyBundle.datasets[perspective][view] : null;
  const filteredData = useMemo(
    () => (selectedData ? filterMatchupVisualizerResponse(selectedData, minimumMatchups) : null),
    [minimumMatchups, selectedData]
  );
  const hasConnections = Boolean(filteredData && filteredData.totalConnections > 0);
  const visibleVoteCount = filteredData
    ? selectedPlayerId !== null && filteredData.nodes.some((node) => node.id === selectedPlayerId)
      ? filteredData.edges
          .filter((edge) => edge.sourcePlayerId === selectedPlayerId)
          .reduce((sum, edge) => sum + edge.voteTotal, 0)
      : filteredData.totalVotes
    : 0;
  const countLabel = view === "good_matchup" ? "Good Matchup Votes:" : "Imbalanced Votes:";
  const countUnitLabel = minimumMatchups === 1 ? "vote" : "votes";
  const emptyStateTitle =
    view === "good_matchup" ? "No strong good-matchup links yet" : "No strong imbalanced links yet";
  const emptyStateDescription =
    view === "good_matchup"
      ? `This view only includes play responses marked good matchup with at least ${minimumMatchups} ${countUnitLabel}. Collect more matchup-tinder data or lower the filter to light up the network.`
      : `This view only includes imbalanced play responses with a net margin of at least ${minimumMatchups} ${countUnitLabel}. Collect more matchup-tinder data or lower the filter to light up the network.`;

  return (
    <AppShell
      title="Matchup Visualizer"
      copy="Explore play-mode matchup relationships across the current roster."
    >
      <div className="matchup-visualizer-page">
        <div className="matchup-visualizer-controls">
          <div className="matchup-visualizer-toggle" role="tablist" aria-label="Matchup visualizer type">
            {(["good_matchup", "imbalanced"] as MatchupVisualizerView[]).map((option) => (
              <button
                key={option}
                type="button"
                role="tab"
                aria-selected={view === option}
                className={`matchup-visualizer-toggle-button${view === option ? " active" : ""}`}
                onClick={() => setView(option)}
              >
                {option === "good_matchup" ? "Good Matchup" : "Imbalanced"}
              </button>
            ))}
          </div>

          <div className="matchup-visualizer-toggle" role="tablist" aria-label="Matchup visualizer perspective">
            {(["offense", "defense"] as MatchupVisualizerPerspective[]).map((option) => (
              <button
                key={option}
                type="button"
                role="tab"
                aria-selected={perspective === option}
                className={`matchup-visualizer-toggle-button${perspective === option ? " active" : ""}`}
                onClick={() => setPerspective(option)}
              >
                {option === "offense" ? "Offense" : "Defense"}
              </button>
            ))}
          </div>

          <label className="matchup-visualizer-filter" htmlFor="matchup-visualizer-min-good-matchups">
            <span className="matchup-visualizer-filter-endpoint" aria-hidden="true">
              {MATCHUP_VISUALIZER_MIN_COUNT}
            </span>
            <input
              id="matchup-visualizer-min-good-matchups"
              className="matchup-visualizer-filter-slider"
              type="range"
              min={MATCHUP_VISUALIZER_MIN_COUNT}
              max={MATCHUP_VISUALIZER_MAX_COUNT}
              step={1}
              value={minimumMatchups}
              aria-label={`Minimum ${view === "good_matchup" ? "good" : "imbalanced"} matchup threshold: ${minimumMatchups}`}
              onChange={(event) => setMinimumMatchups(Number(event.target.value))}
            />
            <span className="matchup-visualizer-filter-endpoint" aria-hidden="true">
              {MATCHUP_VISUALIZER_MAX_COUNT}
            </span>
          </label>
        </div>

        <section className="panel matchup-visualizer-shell">
          {requestState.status === "loading" ? (
            <div className="matchup-visualizer-state-card">
              <div className="matchup-visualizer-loading-orb" />
              <p>Loading matchup relationships...</p>
            </div>
          ) : requestState.status === "error" ? (
            <div className="matchup-visualizer-state-card">
              <h2>Unable to load the visualizer</h2>
              <p>{requestState.error}</p>
            </div>
          ) : !hasConnections || !filteredData ? (
            <div className="matchup-visualizer-state-card">
              <h2>{emptyStateTitle}</h2>
              <p>{emptyStateDescription}</p>
            </div>
          ) : (
            <>
              <div className="matchup-visualizer-count-text" aria-live="polite">
                <span className="matchup-visualizer-count-label">{countLabel}</span>
                <strong>{visibleVoteCount}</strong>
              </div>
              <MatchupChordDiagram
                data={filteredData}
                perspective={perspective}
                selectedPlayerId={selectedPlayerId}
                onSelectedPlayerChange={setSelectedPlayerId}
              />
            </>
          )}
        </section>
      </div>
    </AppShell>
  );
}
