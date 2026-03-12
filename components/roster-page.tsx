"use client";

import { useEffect, useRef, useState } from "react";

import { AppShell } from "@/components/app-shell";
import { TournamentBuilderProvider, useTournamentBuilder } from "@/components/tournament-builder";
import { PLAYER_ATTRIBUTE_GROUPS, POSITIONS } from "@/lib/constants";
import type {
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

function RosterContent() {
  const { loading, players, retrySync, syncError, togglePlayerPosition, updatePlayerAttribute, updatePlayerName } =
    useTournamentBuilder();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [columnWidths, setColumnWidths] = useState(() =>
    getRosterColumnWidths(ROSTER_MIN_TABLE_WIDTH)
  );

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
      title="Roster Builder"
      copy="Edit names, eligible positions, and player ratings here. Team assignment options update from this roster automatically."
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
                <th className="roster-head-cell row-number">#</th>
                <th className="roster-head-cell name">Player</th>
                <th className="roster-head-cell positions">Pos.</th>
                {PLAYER_ATTRIBUTE_GROUPS.flatMap((group) =>
                  group.attributes.map((attribute) => (
                    <th key={attribute.key} className="roster-head-cell attribute">
                      {attribute.label}
                    </th>
                  ))
                )}
              </tr>
            </thead>
            <tbody>
              {players.map((player) => (
                <RosterRow
                  key={player.id}
                  id={player.id}
                  rowNumber={player.rowNumber}
                  name={player.name}
                  positions={player.positions}
                  attributes={player.attributes}
                  onNameChange={updatePlayerName}
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
  rowNumber,
  name,
  positions,
  attributes,
  onNameChange,
  onPositionToggle,
  onAttributeChange
}: {
  id: number;
  rowNumber: number;
  name: string;
  positions: Position[];
  attributes: PlayerAttributes;
  onNameChange: (playerId: number, nextName: string) => void;
  onPositionToggle: (playerId: number, position: Position) => void;
  onAttributeChange: (
    playerId: number,
    attribute: PlayerAttributeKey,
    rating: PlayerAttributeRating | null
  ) => void;
}) {
  return (
    <tr>
      <td className="roster-rownum">{rowNumber}</td>
      <td className="roster-name-cell">
        <input
          className="roster-name"
          aria-label={`Player ${rowNumber} name`}
          value={name}
          onChange={(event) => onNameChange(id, event.target.value)}
          placeholder="Enter player name"
        />
      </td>
      <td className="roster-positions-cell">
        <div className="multi-select" role="group" aria-label={`Player ${rowNumber} positions`}>
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
              aria-label={`Player ${rowNumber} ${attribute.label}`}
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
