"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { AppShell } from "@/components/app-shell";
import { TournamentBuilderProvider, useTournamentBuilder } from "@/components/tournament-builder";
import {
  MAX_PLAYER_CHEMISTRY_LINKS,
  PLAYER_ATTRIBUTE_GROUPS,
  POSITIONS
} from "@/lib/constants";
import type {
  Player,
  PlayerAttributeKey,
  PlayerAttributeRating,
  PlayerAttributes,
  PlayerChemistry,
  Position
} from "@/lib/types";

const ATTRIBUTE_RATINGS: PlayerAttributeRating[] = [1, 2, 3, 4, 5];
const CHEMISTRY_COLUMNS: Array<{
  key: "bonus";
  label: string;
  sortKey: "chemistryBonus";
}> = [
  { key: "bonus", label: "Bonus", sortKey: "chemistryBonus" }
];
const ROSTER_MIN_WIDTHS = {
  rowNumber: 28,
  playerName: 150,
  positions: 118,
  attribute: 76,
  chemistry: 84,
  actions: 44
} as const;
const ROSTER_EXTRA_WEIGHTS = {
  rowNumber: 0,
  playerName: 0.18,
  positions: 0,
  attribute: 1,
  chemistry: 0.72,
  actions: 0
} as const;
const ATTRIBUTE_COUNT = PLAYER_ATTRIBUTE_GROUPS.reduce(
  (total, group) => total + group.attributes.length,
  0
);
const CHEMISTRY_COUNT = CHEMISTRY_COLUMNS.length;
const ROSTER_MIN_TABLE_WIDTH =
  ROSTER_MIN_WIDTHS.rowNumber +
  ROSTER_MIN_WIDTHS.playerName +
  ROSTER_MIN_WIDTHS.positions +
  ROSTER_MIN_WIDTHS.attribute * ATTRIBUTE_COUNT +
  ROSTER_MIN_WIDTHS.chemistry * CHEMISTRY_COUNT +
  ROSTER_MIN_WIDTHS.actions;
const ROSTER_TOTAL_WEIGHT =
  ROSTER_EXTRA_WEIGHTS.rowNumber +
  ROSTER_EXTRA_WEIGHTS.playerName +
  ROSTER_EXTRA_WEIGHTS.positions +
  ROSTER_EXTRA_WEIGHTS.attribute * ATTRIBUTE_COUNT +
  ROSTER_EXTRA_WEIGHTS.chemistry * CHEMISTRY_COUNT +
  ROSTER_EXTRA_WEIGHTS.actions;

type RosterChemistrySortKey = (typeof CHEMISTRY_COLUMNS)[number]["sortKey"];
type RosterSortKey = "name" | "positions" | PlayerAttributeKey | RosterChemistrySortKey;
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
      ROSTER_MIN_WIDTHS.attribute + weightUnit * ROSTER_EXTRA_WEIGHTS.attribute,
    chemistry:
      ROSTER_MIN_WIDTHS.chemistry + weightUnit * ROSTER_EXTRA_WEIGHTS.chemistry,
    actions:
      ROSTER_MIN_WIDTHS.actions + weightUnit * ROSTER_EXTRA_WEIGHTS.actions
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
    previous.attribute === next.attribute &&
    previous.chemistry === next.chemistry &&
    previous.actions === next.actions
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
    } else if (sortState.key === "chemistryBonus") {
      primary = compareNullableNumbers(
        left.chemistry.bonus.length,
        right.chemistry.bonus.length,
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

function formatAttributeSelectValue(value: number | null) {
  if (value === null) {
    return "";
  }

  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function shouldShowCustomAttributeValue(value: number | null) {
  return value !== null && !Number.isInteger(value);
}

function RosterContent() {
  const {
    addPlayer,
    deletePlayer,
    loading,
    players,
    retrySync,
    syncError,
    togglePlayerPosition,
    updatePlayerAttribute,
    updatePlayerChemistry,
    updatePlayerName
  } = useTournamentBuilder();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [sortState, setSortState] = useState<RosterSortState>(null);
  const [pendingFocusPlayerId, setPendingFocusPlayerId] = useState<number | null>(null);
  const [columnWidths, setColumnWidths] = useState(() =>
    getRosterColumnWidths(ROSTER_MIN_TABLE_WIDTH)
  );
  const displayedPlayers = useMemo(() => sortPlayers(players, sortState), [players, sortState]);

  const handleAddPlayer = () => {
    const playerId = addPlayer();
    if (playerId !== null) {
      setPendingFocusPlayerId(playerId);
    }
  };

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
      {loading || syncError ? (
        <div className="status-bar">
          {loading ? <div className="status-chip">Loading roster seed...</div> : null}
          {syncError ? (
            <button type="button" className="status-chip error" onClick={retrySync}>
              {syncError} Retry sync
            </button>
          ) : null}
        </div>
      ) : null}
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
              {CHEMISTRY_COLUMNS.map((column) => (
                <col
                  key={column.key}
                  className="roster-col chemistry"
                  style={{ width: `${columnWidths.chemistry}px` }}
                />
              ))}
              <col className="roster-col actions" style={{ width: `${columnWidths.actions}px` }} />
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
                <th className="roster-group-head chemistry" colSpan={CHEMISTRY_COLUMNS.length}>
                  Chemistry
                </th>
                <th className="roster-group-spacer" />
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
                    Position
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
                {CHEMISTRY_COLUMNS.map((column) => (
                  <th key={column.key} className="roster-head-cell chemistry">
                    <button
                      type="button"
                      className={`roster-sort-button${sortState?.key === column.sortKey ? " active" : ""}`}
                      onClick={() => handleSort(column.sortKey)}
                    >
                      {column.label}
                      <span className="roster-sort-indicator" aria-hidden="true">
                        {sortState?.key === column.sortKey
                          ? sortState.direction === "asc"
                            ? "↑"
                            : "↓"
                          : "↕"}
                      </span>
                    </button>
                  </th>
                ))}
                <th className="roster-head-cell actions" aria-label="Player actions" />
              </tr>
            </thead>
            <tbody>
              {displayedPlayers.map((player) => (
                <RosterRow
                  key={player.rowNumber}
                  id={player.id}
                  rowNumber={player.rowNumber}
                  name={player.name}
                  positions={player.positions}
                  attributes={player.attributes}
                  chemistry={player.chemistry}
                  players={players}
                  shouldAutoFocus={player.id === pendingFocusPlayerId}
                  onNameChange={updatePlayerName}
                  onNameBlur={retrySync}
                  onDelete={deletePlayer}
                  onPositionToggle={togglePlayerPosition}
                  onAttributeChange={updatePlayerAttribute}
                  onChemistryChange={updatePlayerChemistry}
                />
              ))}
            </tbody>
          </table>
        </div>
        <div
          className="roster-add-row"
          style={{ marginLeft: `${columnWidths.rowNumber}px`, marginTop: "15px" }}
        >
          <button type="button" className="roster-add-button" onClick={handleAddPlayer}>
            Add player
          </button>
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
  chemistry,
  players,
  shouldAutoFocus,
  onNameChange,
  onNameBlur,
  onDelete,
  onPositionToggle,
  onAttributeChange,
  onChemistryChange
}: {
  id: number;
  rowNumber: number;
  name: string;
  positions: Position[];
  attributes: PlayerAttributes;
  chemistry: PlayerChemistry;
  players: Player[];
  shouldAutoFocus: boolean;
  onNameChange: (playerId: number, nextName: string) => void;
  onNameBlur: () => void;
  onDelete: (playerId: number) => void;
  onPositionToggle: (playerId: number, position: Position) => void;
  onAttributeChange: (
    playerId: number,
    attribute: PlayerAttributeKey,
    rating: PlayerAttributeRating | null
  ) => void;
  onChemistryChange: (
    playerId: number,
    kind: "bonus",
    chemistryPlayerIds: number[]
  ) => void;
}) {
  const [openPanel, setOpenPanel] = useState<"menu" | "bonus" | null>(null);
  const rowRef = useRef<HTMLTableRowElement | null>(null);
  const playerLabelById = useMemo(
    () =>
      new Map(
        players.map((player) => [
          player.id,
          player.name.trim() || `Player ${player.rowNumber}`
        ] as const)
      ),
    [players]
  );
  const comparePlayerLabels = useMemo(
    () => (leftId: number, rightId: number) =>
      (playerLabelById.get(leftId) ?? `Player ${leftId}`).localeCompare(
        playerLabelById.get(rightId) ?? `Player ${rightId}`,
        undefined,
        { sensitivity: "base" }
      ),
    [playerLabelById]
  );
  const menuOpen = openPanel === "menu";

  useEffect(() => {
    if (!openPanel) {
      return undefined;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!rowRef.current?.contains(event.target as Node)) {
        setOpenPanel(null);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenPanel(null);
      }
    };

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [openPanel]);

  return (
    <tr ref={rowRef} className="roster-row">
      <td className="roster-rownum">{rowNumber}</td>
      <td className="roster-name-cell">
        <input
          className="roster-name"
          aria-label={`Player ${rowNumber} name`}
          autoFocus={shouldAutoFocus}
          value={name}
          onChange={(event) => onNameChange(id, event.target.value)}
          onBlur={onNameBlur}
          placeholder="Enter player name"
        />
      </td>
      <td className="roster-positions-cell">
        <div
          className="multi-select roster-positions-control"
          role="group"
          aria-label={`Player ${rowNumber} positions`}
        >
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
            {(() => {
              const currentValue = attributes[attribute.key];
              const selectValue = formatAttributeSelectValue(currentValue);
              const showCustomValue = shouldShowCustomAttributeValue(currentValue);

              return (
            <select
              className="roster-attribute-select"
              aria-label={`Player ${rowNumber} ${attribute.label}`}
              value={selectValue}
              onChange={(event) =>
                onAttributeChange(
                  id,
                  attribute.key,
                  event.target.value ? (Number(event.target.value) as PlayerAttributeRating) : null
                )
              }
            >
              <option value="">-</option>
              {showCustomValue ? (
                <option value={selectValue}>{selectValue}</option>
              ) : null}
              {ATTRIBUTE_RATINGS.map((rating) => (
                <option key={rating} value={rating}>
                  {rating}
                </option>
              ))}
            </select>
              );
            })()}
          </td>
        ))
      )}
      {CHEMISTRY_COLUMNS.map((column) => {
        const activeSelection = [...chemistry[column.key]].sort(comparePlayerLabels);
        const remainingPlayers =
          activeSelection.length >= MAX_PLAYER_CHEMISTRY_LINKS
            ? []
            : players
                .filter(
                  (player) =>
                    player.id !== id && !activeSelection.includes(player.id)
                )
                .sort((left, right) =>
                  (playerLabelById.get(left.id) ?? `Player ${left.rowNumber}`).localeCompare(
                    playerLabelById.get(right.id) ?? `Player ${right.rowNumber}`,
                    undefined,
                    { sensitivity: "base" }
                  )
                );

        return (
          <td key={column.key} className="roster-chemistry-cell">
            <div className="roster-chemistry-wrap">
              <button
                type="button"
                className={`roster-chemistry-button${openPanel === column.key ? " active" : ""}`}
                onClick={() =>
                  setOpenPanel((current) => (current === column.key ? null : column.key))
                }
                aria-expanded={openPanel === column.key}
                aria-label={`${column.label} chemistry for player ${name.trim() || rowNumber}`}
              >
                {activeSelection.length}
              </button>
              {openPanel === column.key ? (
                <div className="roster-chemistry-popover">
                  <div className="roster-chemistry-section">
                    <div className="roster-chemistry-heading">Active Selection</div>
                    {activeSelection.length > 0 ? (
                      <div className="roster-chemistry-chip-list">
                        {activeSelection.map((chemistryPlayerId) => (
                          <div key={chemistryPlayerId} className="roster-chemistry-chip">
                            <span>{playerLabelById.get(chemistryPlayerId) ?? `Player ${chemistryPlayerId}`}</span>
                            <button
                              type="button"
                              className="roster-chemistry-chip-remove"
                              onClick={() =>
                                onChemistryChange(
                                  id,
                                  column.key,
                                  activeSelection.filter(
                                    (currentPlayerId) => currentPlayerId !== chemistryPlayerId
                                  )
                                )
                              }
                              aria-label={`Remove ${playerLabelById.get(chemistryPlayerId) ?? `Player ${chemistryPlayerId}`}`}
                            >
                              x
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="roster-chemistry-empty">No players selected</div>
                    )}
                  </div>
                  <div className="roster-chemistry-section">
                    <div className="roster-chemistry-heading">Remaining Players</div>
                    {activeSelection.length >= MAX_PLAYER_CHEMISTRY_LINKS ? (
                      <div className="roster-chemistry-limit">Only 5 players allowed</div>
                    ) : remainingPlayers.length > 0 ? (
                      <div className="roster-chemistry-option-list">
                        {remainingPlayers.map((player) => (
                          <button
                            key={player.id}
                            type="button"
                            className="roster-chemistry-option"
                            onClick={() =>
                              onChemistryChange(id, column.key, [...activeSelection, player.id])
                            }
                          >
                            {playerLabelById.get(player.id) ?? `Player ${player.rowNumber}`}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="roster-chemistry-empty">No remaining players</div>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          </td>
        );
      })}
      <td className="roster-actions-cell">
        <div className="roster-action-menu">
          <button
            type="button"
            className="roster-menu-button"
            onClick={() => setOpenPanel((current) => (current === "menu" ? null : "menu"))}
            aria-label={`More actions for player ${name.trim() || rowNumber}`}
            aria-expanded={menuOpen}
          >
            <span className="roster-menu-dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          </button>
          {menuOpen ? (
            <div className="roster-action-popover">
              <button
                type="button"
                className="roster-delete-button"
                onClick={() => {
                  setOpenPanel(null);
                  onDelete(id);
                }}
                aria-label={`Delete player ${name.trim() || rowNumber}`}
              >
                Delete
              </button>
            </div>
          ) : null}
        </div>
      </td>
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
