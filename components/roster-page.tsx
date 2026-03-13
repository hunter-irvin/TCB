"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { AppShell } from "@/components/app-shell";
import { TournamentBuilderProvider, useTournamentBuilder } from "@/components/tournament-builder";
import { PLAYER_ATTRIBUTE_GROUPS, POSITIONS } from "@/lib/constants";
import type {
  Player,
  PlayerAttributeKey,
  PlayerAttributeRating,
  PlayerAttributes,
  Position
} from "@/lib/types";

const ATTRIBUTE_RATINGS: PlayerAttributeRating[] = [1, 2, 3, 4, 5];
const ROSTER_MIN_WIDTHS = {
  rowNumber: 28,
  playerName: 150,
  positions: 138,
  attribute: 50
} as const;
const ROSTER_EXTRA_WEIGHTS = {
  rowNumber: 0,
  playerName: 0.18,
  positions: 0.24,
  attribute: 1
} as const;
const ATTRIBUTE_COUNT = PLAYER_ATTRIBUTE_GROUPS.reduce(
  (total, group) => total + group.attributes.length,
  0
);
const ROSTER_MIN_TABLE_WIDTH =
  ROSTER_MIN_WIDTHS.rowNumber +
  ROSTER_MIN_WIDTHS.playerName +
  ROSTER_MIN_WIDTHS.positions +
  ROSTER_MIN_WIDTHS.attribute * ATTRIBUTE_COUNT;
const ROSTER_TOTAL_WEIGHT =
  ROSTER_EXTRA_WEIGHTS.rowNumber +
  ROSTER_EXTRA_WEIGHTS.playerName +
  ROSTER_EXTRA_WEIGHTS.positions +
  ROSTER_EXTRA_WEIGHTS.attribute * ATTRIBUTE_COUNT;

type RosterSortKey = "name" | "positions" | PlayerAttributeKey;
type RosterSortDirection = "asc" | "desc";

type RosterSortState = {
  key: RosterSortKey;
  direction: RosterSortDirection;
} | null;

function getRosterColumnWidths(containerWidth: number) {
  const tableWidth = Math.max(containerWidth, ROSTER_MIN_TABLE_WIDTH);
  const extraWidth = tableWidth - ROSTER_MIN_TABLE_WIDTH;
  const weightUnit = ROSTER_TOTAL_WEIGHT > 0 ? extraWidth / ROSTER_TOTAL_WEIGHT : 0;

  return {
    tableWidth,
    rowNumber:
      ROSTER_MIN_WIDTHS.rowNumber + weightUnit * ROSTER_EXTRA_WEIGHTS.rowNumber,
    playerName:
      ROSTER_MIN_WIDTHS.playerName + weightUnit * ROSTER_EXTRA_WEIGHTS.playerName,
    positions:
      ROSTER_MIN_WIDTHS.positions + weightUnit * ROSTER_EXTRA_WEIGHTS.positions,
    attribute:
      ROSTER_MIN_WIDTHS.attribute + weightUnit * ROSTER_EXTRA_WEIGHTS.attribute
  };
}

function areWidthsEqual(
  previous: ReturnType<typeof getRosterColumnWidths>,
  next: ReturnType<typeof getRosterColumnWidths>
) {
  return (
    previous.tableWidth === next.tableWidth &&
    previous.rowNumber === next.rowNumber &&
    previous.playerName === next.playerName &&
    previous.positions === next.positions &&
    previous.attribute === next.attribute
  );
}

function getPlayerNameForSort(player: Player) {
  return player.name.trim().toLocaleLowerCase();
}

function compareAlphabetical(left: Player, right: Player) {
  const nameCompare = getPlayerNameForSort(left).localeCompare(getPlayerNameForSort(right));
  if (nameCompare !== 0) {
    return nameCompare;
  }

  return left.rowNumber - right.rowNumber;
}

function getLowestPosition(positions: Position[]) {
  return positions.length > 0 ? Math.min(...positions) : null;
}

function compareNullableNumbers(
  left: number | null,
  right: number | null,
  direction: RosterSortDirection
) {
  if (left === null && right === null) {
    return 0;
  }

  if (left === null) {
    return 1;
  }

  if (right === null) {
    return -1;
  }

  return direction === "asc" ? left - right : right - left;
}

function sortPlayers(players: Player[], sortState: RosterSortState) {
  if (!sortState) {
    return players;
  }

  const nextPlayers = [...players];

  nextPlayers.sort((left, right) => {
    let primary = 0;

    if (sortState.key === "name") {
      primary =
        sortState.direction === "asc"
          ? getPlayerNameForSort(left).localeCompare(getPlayerNameForSort(right))
          : getPlayerNameForSort(right).localeCompare(getPlayerNameForSort(left));
    } else if (sortState.key === "positions") {
      primary = compareNullableNumbers(
        getLowestPosition(left.positions),
        getLowestPosition(right.positions),
        sortState.direction
      );
    } else {
      primary = compareNullableNumbers(
        left.attributes[sortState.key],
        right.attributes[sortState.key],
        sortState.direction
      );
    }

    if (primary !== 0) {
      return primary;
    }

    return compareAlphabetical(left, right);
  });

  return nextPlayers;
}

function getInitialSortDirection(key: RosterSortKey): RosterSortDirection {
  if (key === "name" || key === "positions") {
    return "asc";
  }

  return "desc";
}

function RosterContent() {
  const { loading, players, retrySync, syncError, togglePlayerPosition, updatePlayerAttribute, updatePlayerName } =
    useTournamentBuilder();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [sortState, setSortState] = useState<RosterSortState>(null);
  const [columnWidths, setColumnWidths] = useState(() =>
    getRosterColumnWidths(ROSTER_MIN_TABLE_WIDTH)
  );
  const displayedPlayers = useMemo(() => sortPlayers(players, sortState), [players, sortState]);

  const handleSort = (key: RosterSortKey) => {
    setSortState((current) => {
      if (current?.key === key) {
        return {
          key,
          direction: current.direction === "asc" ? "desc" : "asc"
        };
      }

      return {
        key,
        direction: getInitialSortDirection(key)
      };
    });
  };

  useEffect(() => {
    const wrapElement = wrapRef.current;
    if (!wrapElement) {
      return undefined;
    }

    const updateWidths = (width: number) => {
      const nextWidths = getRosterColumnWidths(Math.round(width));
      setColumnWidths((previous) => (areWidthsEqual(previous, nextWidths) ? previous : nextWidths));
    };

    updateWidths(wrapElement.clientWidth);

    const observer = new ResizeObserver((entries) => {
      const nextWidth = entries[0]?.contentRect.width ?? wrapElement.clientWidth;
      updateWidths(nextWidth);
    });

    observer.observe(wrapElement);

    return () => observer.disconnect();
  }, []);

  return (
    <AppShell
      title="Roster"
      copy="Edit names, eligible positions, and player ratings here."
    >
      <div className="status-bar">
        <div className="status-chip">
          {loading ? "Loading roster seed..." : "Changes save in this browser automatically"}
        </div>
        {syncError ? (
          <button type="button" className="status-chip error" onClick={retrySync}>
            {syncError} Retry sync
          </button>
        ) : null}
      </div>
      <section className="panel table-shell">
        <div ref={wrapRef} className="roster-sheet-wrap">
          <table className="roster-sheet" style={{ width: `${columnWidths.tableWidth}px` }}>
            <colgroup>
              <col className="roster-col row-number" style={{ width: `${columnWidths.rowNumber}px` }} />
              <col className="roster-col player-name" style={{ width: `${columnWidths.playerName}px` }} />
              <col className="roster-col positions" style={{ width: `${columnWidths.positions}px` }} />
              {PLAYER_ATTRIBUTE_GROUPS.flatMap((group) =>
                group.attributes.map((attribute) => (
                  <col
                    key={attribute.key}
                    className="roster-col attribute"
                    style={{ width: `${columnWidths.attribute}px` }}
                  />
                ))
              )}
            </colgroup>
            <thead>
              <tr>
                <th className="roster-group-spacer" colSpan={3} />
                {PLAYER_ATTRIBUTE_GROUPS.map((group) => (
                  <th
                    key={group.label}
                    className={`roster-group-head ${group.tone}`}
                    colSpan={group.attributes.length}
                  >
                    {group.label}
                  </th>
                ))}
              </tr>
              <tr>
                <th className="roster-head-cell row-number" aria-label="Row count" />
                <th className="roster-head-cell name">
                  <button
                    type="button"
                    className={`roster-sort-button${sortState?.key === "name" ? " active" : ""}`}
                    onClick={() => handleSort("name")}
                  >
                    Player
                    <span className="roster-sort-indicator" aria-hidden="true">
                      {sortState?.key === "name"
                        ? sortState.direction === "asc"
                          ? "↑"
                          : "↓"
                        : "↕"}
                    </span>
                  </button>
                </th>
                <th className="roster-head-cell positions">
                  <button
                    type="button"
                    className={`roster-sort-button${sortState?.key === "positions" ? " active" : ""}`}
                    onClick={() => handleSort("positions")}
                  >
                    Pos.
                    <span className="roster-sort-indicator" aria-hidden="true">
                      {sortState?.key === "positions"
                        ? sortState.direction === "asc"
                          ? "↑"
                          : "↓"
                        : "↕"}
                    </span>
                  </button>
                </th>
                {PLAYER_ATTRIBUTE_GROUPS.flatMap((group) =>
                  group.attributes.map((attribute) => (
                    <th key={attribute.key} className="roster-head-cell attribute">
                      <button
                        type="button"
                        className={`roster-sort-button${sortState?.key === attribute.key ? " active" : ""}`}
                        onClick={() => handleSort(attribute.key)}
                      >
                        {attribute.label}
                        <span className="roster-sort-indicator" aria-hidden="true">
                          {sortState?.key === attribute.key
                            ? sortState.direction === "asc"
                              ? "↑"
                              : "↓"
                            : "↕"}
                        </span>
                      </button>
                    </th>
                  ))
                )}
              </tr>
            </thead>
            <tbody>
              {displayedPlayers.map((player, index) => (
                <RosterRow
                  key={player.id}
                  id={player.id}
                  displayIndex={index + 1}
                  name={player.name}
                  positions={player.positions}
                  attributes={player.attributes}
                  onNameChange={updatePlayerName}
                  onNameBlur={retrySync}
                  onPositionToggle={togglePlayerPosition}
                  onAttributeChange={updatePlayerAttribute}
                />
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </AppShell>
  );
}

function RosterRow({
  id,
  displayIndex,
  name,
  positions,
  attributes,
  onNameChange,
  onNameBlur,
  onPositionToggle,
  onAttributeChange
}: {
  id: number;
  displayIndex: number;
  name: string;
  positions: Position[];
  attributes: PlayerAttributes;
  onNameChange: (playerId: number, nextName: string) => void;
  onNameBlur: () => void;
  onPositionToggle: (playerId: number, position: Position) => void;
  onAttributeChange: (
    playerId: number,
    attribute: PlayerAttributeKey,
    rating: PlayerAttributeRating | null
  ) => void;
}) {
  return (
    <tr>
      <td className="roster-rownum">{displayIndex}</td>
      <td className="roster-name-cell">
        <input
          className="roster-name"
          aria-label={`Player ${displayIndex} name`}
          value={name}
          onChange={(event) => onNameChange(id, event.target.value)}
          onBlur={onNameBlur}
          placeholder="Enter player name"
        />
      </td>
      <td className="roster-positions-cell">
        <div className="multi-select" role="group" aria-label={`Player ${displayIndex} positions`}>
          {POSITIONS.map((position) => {
            const active = positions.includes(position);
            return (
              <button
                key={position}
                type="button"
                className={`multi-pill${active ? " active" : ""}`}
                onClick={() => onPositionToggle(id, position)}
                aria-pressed={active}
              >
                {position}
              </button>
            );
          })}
        </div>
      </td>
      {PLAYER_ATTRIBUTE_GROUPS.flatMap((group) =>
        group.attributes.map((attribute) => (
          <td key={attribute.key} className="roster-attribute-cell">
            <select
              className="roster-attribute-select"
              aria-label={`Player ${displayIndex} ${attribute.label}`}
              value={attributes[attribute.key] ?? ""}
              onChange={(event) =>
                onAttributeChange(
                  id,
                  attribute.key,
                  event.target.value ? (Number(event.target.value) as PlayerAttributeRating) : null
                )
              }
            >
              <option value="">-</option>
              {ATTRIBUTE_RATINGS.map((rating) => (
                <option key={rating} value={rating}>
                  {rating}
                </option>
              ))}
            </select>
          </td>
        ))
      )}
    </tr>
  );
}

export function RosterPage() {
  return (
    <TournamentBuilderProvider>
      <RosterContent />
    </TournamentBuilderProvider>
  );
}
