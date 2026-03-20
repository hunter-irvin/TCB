import {
  DEFAULT_PLAYER_CHEMISTRY_BY_ROW,
  DEFAULT_PLAYER_SEEDS,
  DEFAULT_PLAYER_ATTRIBUTES_BY_ROW,
  MAX_PLAYER_CHEMISTRY_LINKS,
  PLAYER_ATTRIBUTE_GROUPS,
  POSITIONS,
  SEED_VERSION,
  TEAMS
} from "@/lib/constants";
import type {
  AppState,
  Assignments,
  Player,
  PlayerAttributeKey,
  PlayerAttributes,
  PlayerChemistry,
  PlayerChemistryKind,
  Position,
  Team,
  SlotDescriptor
} from "@/lib/types";

export function createEmptyPlayerAttributes(): PlayerAttributes {
  return PLAYER_ATTRIBUTE_GROUPS.flatMap((group) => group.attributes).reduce<PlayerAttributes>(
    (attributes, attribute) => {
      attributes[attribute.key] = null;
      return attributes;
    },
    {} as PlayerAttributes
  );
}

export function createEmptyPlayerChemistry(): PlayerChemistry {
  return {
    bonus: [],
    tax: []
  };
}

export function sanitizePlayerAttributes(
  attributes: Partial<Record<PlayerAttributeKey, number | null>> | undefined
): PlayerAttributes {
  const base = createEmptyPlayerAttributes();

  for (const key of Object.keys(base) as PlayerAttributeKey[]) {
    const value = attributes?.[key];
    base[key] =
      value === 1 || value === 2 || value === 3 || value === 4 || value === 5 ? value : null;
  }

  return base;
}

function hasAnyPlayerAttribute(attributes: PlayerAttributes): boolean {
  return Object.values(attributes).some((value) => value !== null);
}

function sanitizePlayerChemistryIds(
  values: number[] | null | undefined,
  validPlayerIds: ReadonlySet<number>,
  excludedIds: ReadonlySet<number>
) {
  const next: number[] = [];
  const seen = new Set<number>();

  for (const value of values ?? []) {
    const chemistryPlayerId = Number(value);
    if (
      !Number.isInteger(chemistryPlayerId) ||
      seen.has(chemistryPlayerId) ||
      excludedIds.has(chemistryPlayerId) ||
      !validPlayerIds.has(chemistryPlayerId)
    ) {
      continue;
    }

    seen.add(chemistryPlayerId);
    next.push(chemistryPlayerId);

    if (next.length >= MAX_PLAYER_CHEMISTRY_LINKS) {
      break;
    }
  }

  return next;
}

export function sanitizePlayerChemistry(
  chemistry: Partial<Record<PlayerChemistryKind, number[]>> | undefined,
  validPlayerIds: ReadonlySet<number>,
  playerId: number
): PlayerChemistry {
  const excludedIds = new Set<number>([playerId]);
  const bonus = sanitizePlayerChemistryIds(chemistry?.bonus, validPlayerIds, excludedIds);

  for (const chemistryPlayerId of bonus) {
    excludedIds.add(chemistryPlayerId);
  }

  const tax = sanitizePlayerChemistryIds(chemistry?.tax, validPlayerIds, excludedIds);

  return {
    bonus,
    tax
  };
}

export function getDefaultPlayerAttributes(rowNumber: number): PlayerAttributes {
  return sanitizePlayerAttributes(DEFAULT_PLAYER_ATTRIBUTES_BY_ROW[rowNumber]);
}

export function getDefaultPlayerChemistry(rowNumber: number): PlayerChemistry {
  const chemistry = DEFAULT_PLAYER_CHEMISTRY_BY_ROW[rowNumber];
  if (!chemistry) {
    return createEmptyPlayerChemistry();
  }

  return {
    bonus: [...chemistry.bonus],
    tax: [...chemistry.tax]
  };
}

export function createEmptyAssignments(teams: Team[] = TEAMS): Assignments {
  return teams.reduce<Assignments>((teamAcc, team) => {
    const slots = POSITIONS.reduce<Record<Position, number | null>>((posAcc, position) => {
      posAcc[position] = null;
      return posAcc;
    }, {} as Record<Position, number | null>);

    teamAcc[team.id] = slots;
    return teamAcc;
  }, {});
}

export function createInitialState(players: Player[]): AppState {
  return {
    players,
    assignments: createEmptyAssignments(),
    seedVersion: SEED_VERSION
  };
}

export function createDefaultPlayers(): Player[] {
  return DEFAULT_PLAYER_SEEDS.map((seed) => ({
    id: seed.rowNumber,
    rowNumber: seed.rowNumber,
    name: seed.name,
    positions: [...seed.positions],
    attributes: getDefaultPlayerAttributes(seed.rowNumber),
    chemistry: getDefaultPlayerChemistry(seed.rowNumber)
  }));
}

export function sanitizePlayers(players: Player[]): Player[] {
  const normalizedPlayers = players.map((player, index) => {
    const rowNumber = Number(player.rowNumber) || index + 1;
    return {
      ...player,
      id: player.id ?? index + 1,
      rowNumber,
      name: player.name ?? "",
      positions: [...new Set(player.positions)].sort((a, b) => a - b) as Position[],
      attributes: (() => {
        const nextAttributes = sanitizePlayerAttributes(player.attributes);
        return hasAnyPlayerAttribute(nextAttributes)
          ? nextAttributes
          : getDefaultPlayerAttributes(rowNumber);
      })()
    };
  });
  const validPlayerIds = new Set(normalizedPlayers.map((player) => player.id));

  return normalizedPlayers
    .map((player, index) => {
      const rowNumber = Number(player.rowNumber) || index + 1;
      return {
        ...player,
        chemistry: sanitizePlayerChemistry(player.chemistry, validPlayerIds, player.id)
      };
    })
    .sort((left, right) => left.rowNumber - right.rowNumber);
}

export function getNextPlayerRowNumber(players: Player[]) {
  return players.reduce((maxRowNumber, player) => Math.max(maxRowNumber, player.rowNumber), 0) + 1;
}

export function getNextTemporaryPlayerId(players: Player[]) {
  const minimumId = players.reduce((minimum, player) => Math.min(minimum, player.id), 0);
  return minimumId <= 0 ? minimumId - 1 : -1;
}

export function createPlayerDraft(players: Player[]): Player {
  const rowNumber = getNextPlayerRowNumber(players);
  return {
    id: getNextTemporaryPlayerId(players),
    rowNumber,
    name: "",
    positions: [],
    attributes: createEmptyPlayerAttributes(),
    chemistry: createEmptyPlayerChemistry()
  };
}

export function remapPlayersById(players: Player[], idMap: ReadonlyMap<number, number>): Player[] {
  if (idMap.size === 0) {
    return players;
  }

  return players.map((player) =>
    idMap.has(player.id)
      ? {
          ...player,
          id: idMap.get(player.id) ?? player.id,
          chemistry: {
            bonus: player.chemistry.bonus.map(
              (chemistryPlayerId) => idMap.get(chemistryPlayerId) ?? chemistryPlayerId
            ),
            tax: player.chemistry.tax.map(
              (chemistryPlayerId) => idMap.get(chemistryPlayerId) ?? chemistryPlayerId
            )
          }
        }
      : player
  );
}

export function removePlayerFromChemistry(players: Player[], playerId: number): Player[] {
  return players
    .filter((player) => player.id !== playerId)
    .map((player) => ({
      ...player,
      chemistry: {
        bonus: player.chemistry.bonus.filter((chemistryPlayerId) => chemistryPlayerId !== playerId),
        tax: player.chemistry.tax.filter((chemistryPlayerId) => chemistryPlayerId !== playerId)
      }
    }));
}

export function remapAssignmentsByPlayerId(
  assignments: Assignments,
  idMap: ReadonlyMap<number, number>
): Assignments {
  if (idMap.size === 0) {
    return assignments;
  }

  return Object.fromEntries(
    Object.entries(assignments).map(([teamId, slots]) => [
      teamId,
      Object.fromEntries(
        POSITIONS.map((position) => {
          const playerId = slots[position];
          return [position, playerId === null ? null : (idMap.get(playerId) ?? playerId)];
        })
      )
    ])
  ) as Assignments;
}

export function findPlayerSlot(assignments: Assignments, playerId: number): SlotDescriptor | null {
  for (const [teamId, positions] of Object.entries(assignments)) {
    for (const position of POSITIONS) {
      if (positions[position] === playerId) {
        return { teamId, position };
      }
    }
  }

  return null;
}

export function isPlayerAssigned(assignments: Assignments, playerId: number): boolean {
  return findPlayerSlot(assignments, playerId) !== null;
}

export function getEligiblePlayers(
  players: Player[],
  assignments: Assignments,
  position: Position,
  targetPlayerId: number | null
): Player[] {
  return players.filter((player) => {
    if (!player.name.trim()) {
      return false;
    }

    if (!player.positions.includes(position)) {
      return false;
    }

    if (targetPlayerId !== null && player.id === targetPlayerId) {
      return true;
    }

    return !isPlayerAssigned(assignments, player.id);
  });
}

export function clearPlayerFromAssignments(assignments: Assignments, playerId: number): Assignments {
  const currentSlot = findPlayerSlot(assignments, playerId);
  if (!currentSlot) {
    return assignments;
  }

  return {
    ...assignments,
    [currentSlot.teamId]: {
      ...assignments[currentSlot.teamId],
      [currentSlot.position]: null
    }
  };
}

export function assignPlayerToSlot(
  assignments: Assignments,
  playerId: number,
  slot: SlotDescriptor
): Assignments {
  const sourceSlot = findPlayerSlot(assignments, playerId);
  let nextAssignments = clearPlayerFromAssignments(assignments, playerId);
  const displacedPlayerId = assignments[slot.teamId][slot.position];

  if (displacedPlayerId !== null) {
    if (sourceSlot) {
      nextAssignments = {
        ...nextAssignments,
        [sourceSlot.teamId]: {
          ...nextAssignments[sourceSlot.teamId],
          [sourceSlot.position]: displacedPlayerId
        }
      };
    } else {
      nextAssignments = clearPlayerFromAssignments(nextAssignments, displacedPlayerId);
    }
  }

  return {
    ...nextAssignments,
    [slot.teamId]: {
      ...nextAssignments[slot.teamId],
      [slot.position]: playerId
    }
  };
}

export function clearSlot(assignments: Assignments, slot: SlotDescriptor): Assignments {
  return {
    ...assignments,
    [slot.teamId]: {
      ...assignments[slot.teamId],
      [slot.position]: null
    }
  };
}

export function pruneAssignments(players: Player[], assignments: Assignments): Assignments {
  let nextAssignments = assignments;

  for (const [teamId, slots] of Object.entries(assignments)) {
    for (const position of POSITIONS) {
      const playerId = slots[position];
      if (playerId === null) {
        continue;
      }

      const player = players.find((candidate) => candidate.id === playerId);
      const stillValid = Boolean(
        player && player.name.trim() && player.positions.includes(position)
      );

      if (!stillValid) {
        nextAssignments = clearSlot(nextAssignments, {
          teamId,
          position
        });
      }
    }
  }

  return nextAssignments;
}
