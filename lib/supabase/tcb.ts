import { createEmptyAssignments, sanitizePlayers } from "@/lib/state";
import type {
  Assignments,
  PersistedScenarioState,
  Player,
  Position,
  Scenario,
  SlotDescriptor
} from "@/lib/types";

type DbPlayerRow = {
  id: number;
  row_number: number;
  name: string;
  eligible_positions: number[] | null;
  shooting: number | null;
  driving: number | null;
  assisting: number | null;
  man_defense: number | null;
  help_defense: number | null;
  shot_blocking: number | null;
  playmaking: number | null;
  rebounding: number | null;
  transition: number | null;
};

export type DbPlayerInsertRow = Omit<DbPlayerRow, "id">;

export const PLAYER_SELECT_COLUMNS =
  "id,row_number,name,eligible_positions,shooting,driving,assisting,man_defense,help_defense,shot_blocking,playmaking,rebounding,transition";

type DbTeamScenarioRow = {
  id: string;
  title: string;
  sort_order: number;
};

type DbScenarioAssignmentRow = {
  scenario_id: string;
  team_id: string;
  position: number;
  player_id: number | null;
};

export const TEAM_SCENARIOS_STORAGE_KEY = "tcb-team-scenarios";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fallbackUuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (value) => {
    const random = Math.floor(Math.random() * 16);
    const next = value === "x" ? random : (random & 0x3) | 0x8;
    return next.toString(16);
  });
}

export function createScenarioId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return fallbackUuid();
}

export function isUuid(value: string) {
  return UUID_PATTERN.test(value);
}

export function normalizeScenarioIds(scenarios: Scenario[]) {
  return scenarios.map((scenario) => ({
    ...scenario,
    id: isUuid(scenario.id) ? scenario.id : createScenarioId()
  }));
}

function normalizePositions(values: number[] | null | undefined): Position[] {
  return [...new Set((values ?? []).filter((value) => value >= 1 && value <= 5))].sort(
    (left, right) => left - right
  ) as Position[];
}

export function playerFromRow(row: DbPlayerRow): Player {
  return {
    id: row.id,
    rowNumber: row.row_number,
    name: row.name,
    positions: normalizePositions(row.eligible_positions),
    attributes: {
      shooting: row.shooting as Player["attributes"]["shooting"],
      driving: row.driving as Player["attributes"]["driving"],
      assisting: row.assisting as Player["attributes"]["assisting"],
      manDefense: row.man_defense as Player["attributes"]["manDefense"],
      helpDefense: row.help_defense as Player["attributes"]["helpDefense"],
      shotBlocking: row.shot_blocking as Player["attributes"]["shotBlocking"],
      playmaking: row.playmaking as Player["attributes"]["playmaking"],
      rebounding: row.rebounding as Player["attributes"]["rebounding"],
      transition: row.transition as Player["attributes"]["transition"]
    }
  };
}

export function playerToRow(player: Player): DbPlayerRow {
  return {
    id: player.id,
    ...playerToInsertRow(player)
  };
}

export function playerToInsertRow(player: Player): DbPlayerInsertRow {
  return {
    row_number: player.rowNumber,
    name: player.name,
    eligible_positions: player.positions,
    shooting: player.attributes.shooting,
    driving: player.attributes.driving,
    assisting: player.attributes.assisting,
    man_defense: player.attributes.manDefense,
    help_defense: player.attributes.helpDefense,
    shot_blocking: player.attributes.shotBlocking,
    playmaking: player.attributes.playmaking,
    rebounding: player.attributes.rebounding,
    transition: player.attributes.transition
  };
}

export function playersFromRows(rows: DbPlayerRow[]): Player[] {
  return sanitizePlayers(
    rows
      .slice()
      .sort((left, right) => left.row_number - right.row_number)
      .map(playerFromRow)
  );
}

export function buildAssignmentsFromRows(rows: DbScenarioAssignmentRow[]): Assignments {
  const assignments = createEmptyAssignments();

  for (const row of rows) {
    const position = row.position as Position;
    if (!(position >= 1 && position <= 5) || !(row.team_id in assignments)) {
      continue;
    }

    assignments[row.team_id][position] = row.player_id;
  }

  return assignments;
}

export function buildScenarioState(
  scenarios: DbTeamScenarioRow[],
  assignmentRows: DbScenarioAssignmentRow[],
  localScenarios: Scenario[] = []
): Scenario[] {
  const collapsedById = new Map(localScenarios.map((scenario) => [scenario.id, scenario.collapsed]));
  const rowsByScenario = assignmentRows.reduce<Map<string, DbScenarioAssignmentRow[]>>((acc, row) => {
    const current = acc.get(row.scenario_id) ?? [];
    current.push(row);
    acc.set(row.scenario_id, current);
    return acc;
  }, new Map());

  return scenarios
    .slice()
    .sort((left, right) => left.sort_order - right.sort_order)
    .map((scenario) => ({
      id: scenario.id,
      title: scenario.title,
      assignments: buildAssignmentsFromRows(rowsByScenario.get(scenario.id) ?? []),
      collapsed: collapsedById.get(scenario.id) ?? false
    }));
}

export function scenarioAssignmentsToRows(scenarioId: string, assignments: Assignments) {
  return Object.entries(assignments).flatMap(([teamId, teamAssignments]) =>
    Object.entries(teamAssignments)
      .filter(([, playerId]) => playerId !== null)
      .map(([position, playerId]) => ({
        scenario_id: scenarioId,
        team_id: teamId,
        position: Number(position),
        player_id: playerId,
        updated_at: new Date().toISOString()
      }))
  );
}

export function scenariosToRows(scenarios: Scenario[]) {
  return scenarios.map((scenario, index) => ({
    id: scenario.id,
    title: scenario.title,
    sort_order: index + 1
  }));
}

export function isSamePlayer(left: Player, right: Player) {
  return (
    left.id === right.id &&
    left.rowNumber === right.rowNumber &&
    left.name === right.name &&
    JSON.stringify(left.positions) === JSON.stringify(right.positions) &&
    JSON.stringify(left.attributes) === JSON.stringify(right.attributes)
  );
}

export function arePlayersEqual(left: Player[], right: Player[]) {
  return (
    left.length === right.length &&
    left.every((player, index) => {
      const other = right[index];
      return other ? isSamePlayer(player, other) : false;
    })
  );
}

export function areAssignmentsEqual(left: Assignments, right: Assignments) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function areScenariosEquivalent(left: Scenario[], right: Scenario[]) {
  return (
    left.length === right.length &&
    left.every((scenario, index) => {
      const other = right[index];
      return (
        Boolean(other) &&
        scenario.id === other.id &&
        scenario.title === other.title &&
        areAssignmentsEqual(scenario.assignments, other.assignments)
      );
    })
  );
}

export function isScenarioPristine(scenarios: Scenario[]) {
  return (
    scenarios.length === 1 &&
    scenarios[0].title === "Team Scenario 1" &&
    areAssignmentsEqual(scenarios[0].assignments, createEmptyAssignments())
  );
}

export function getNextScenarioNumber(scenarios: Scenario[]) {
  const numericTitles = scenarios
    .map((scenario) => Number(scenario.title.replace(/^Team Scenario\s+/i, "")))
    .filter((value) => Number.isFinite(value) && value > 0);

  const maxTitle = numericTitles.length > 0 ? Math.max(...numericTitles) : scenarios.length;
  return Math.max(maxTitle + 1, scenarios.length + 1);
}

export function parseStoredScenarioState(value: string | null): PersistedScenarioState | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as PersistedScenarioState;
    if (!Array.isArray(parsed.scenarios) || parsed.scenarios.length === 0) {
      return null;
    }

    return {
      nextScenarioNumber: parsed.nextScenarioNumber,
      scenarios: normalizeScenarioIds(parsed.scenarios)
    };
  } catch {
    return null;
  }
}

export function slotKey(slot: SlotDescriptor) {
  return `${slot.teamId}:${slot.position}`;
}
