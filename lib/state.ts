import {
  DEFAULT_PLAYER_SEEDS,
  DEFAULT_PLAYER_ATTRIBUTES_BY_ROW,
  PLAYER_ATTRIBUTE_GROUPS,
  POSITIONS,
  ROSTER_SIZE,
  SEED_VERSION,
  TEAMS
} from "@/lib/constants";
import type {
  AppState,
  Assignments,
  Player,
  PlayerAttributeKey,
  PlayerAttributes,
  Position,
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

export function getDefaultPlayerAttributes(rowNumber: number): PlayerAttributes {
  return sanitizePlayerAttributes(DEFAULT_PLAYER_ATTRIBUTES_BY_ROW[rowNumber]);
}

export function createEmptyAssignments(): Assignments {
  return TEAMS.reduce<Assignments>((teamAcc, team) => {
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
  const players = DEFAULT_PLAYER_SEEDS.map((seed) => ({
    id: seed.rowNumber,
    rowNumber: seed.rowNumber,
    name: seed.name,
    positions: [...seed.positions],
    attributes: getDefaultPlayerAttributes(seed.rowNumber)
  }));

  while (players.length < ROSTER_SIZE) {
    const next = players.length + 1;
    players.push({
      id: next,
      rowNumber: next,
      name: "",
      positions: [],
      attributes: createEmptyPlayerAttributes()
    });
  }

  return players.slice(0, ROSTER_SIZE);
}

export function sanitizePlayers(players: Player[]): Player[] {
  return players.map((player, index) => ({
    ...player,
    id: player.id ?? index + 1,
    rowNumber: Number(player.rowNumber) || index + 1,
    name: player.name ?? "",
    positions: [...new Set(player.positions)].sort((a, b) => a - b) as Position[],
    attributes: (() => {
      const nextAttributes = sanitizePlayerAttributes(player.attributes);
      return hasAnyPlayerAttribute(nextAttributes)
        ? nextAttributes
        : getDefaultPlayerAttributes(Number(player.rowNumber) || index + 1);
    })()
  }));
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
