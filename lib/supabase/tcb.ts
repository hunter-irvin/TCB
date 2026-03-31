import { LEGACY_TEAM_COLOR_BY_TOKEN, MAX_TEAMS, TEAM_COLOR_PALETTE, TEAMS } from "@/lib/constants";
import { createEmptyAssignments, createEmptyPlayerChemistry, sanitizePlayers } from "@/lib/state";
import type {
  Assignments,
  PersistedScenarioState,
  Player,
  PlayerChemistryKind,
  Position,
  Scenario,
  SlotDescriptor,
  Team
} from "@/lib/types";

type DbPlayerRow = {
  id: number;
  run_id?: string;
  row_number: number;
  active: boolean | null;
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

export type DbPlayerChemistryRow = {
  run_id?: string;
  source_player_id: number;
  target_player_id: number;
  kind: PlayerChemistryKind;
};

export type DbPlayerInsertRow = Omit<DbPlayerRow, "id">;

export const PLAYER_SELECT_COLUMNS =
  "id,run_id,row_number,active,name,eligible_positions,shooting,driving,assisting,man_defense,help_defense,shot_blocking,playmaking,rebounding,transition";
export const PLAYER_CHEMISTRY_SELECT_COLUMNS = "run_id,source_player_id,target_player_id,kind";
export const TEAM_SELECT_COLUMNS = "id,run_id,name,color,display_order";
export const TEAM_SCENARIO_SELECT_COLUMNS = "id,run_id,title,sort_order";

type DbTeamRow = {
  id: string;
  run_id?: string;
  name: string;
  color: string;
  display_order: number;
};

type DbTeamScenarioRow = {
  id: string;
  run_id?: string;
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

function normalizeHexColor(color: string) {
  const trimmed = color.trim().toLowerCase();

  if (/^#[0-9a-f]{6}$/i.test(trimmed)) {
    return trimmed;
  }

  if (/^#[0-9a-f]{3}$/i.test(trimmed)) {
    const [red, green, blue] = trimmed.slice(1).split("");
    return `#${red}${red}${green}${green}${blue}${blue}`;
  }

  return null;
}

export function normalizeTeamColor(
  color: string | null | undefined,
  fallbackColor: string = TEAM_COLOR_PALETTE[0]
) {
  const normalizedHex = normalizeHexColor(color ?? "");
  if (normalizedHex) {
    return normalizedHex;
  }

  const legacyColor = LEGACY_TEAM_COLOR_BY_TOKEN[(color ?? "").trim()];
  if (legacyColor) {
    return legacyColor;
  }

  return fallbackColor;
}

export function normalizeTeams(
  teams: Team[],
  fallbackTeams: Team[] = TEAMS
): Team[] {
  const fallbackById = new Map(fallbackTeams.map((team) => [team.id, team] as const));

  return teams
    .slice()
    .sort((left, right) => (left.displayOrder ?? 0) - (right.displayOrder ?? 0))
    .slice(0, MAX_TEAMS)
    .map((team, index) => {
      const fallbackTeam = fallbackById.get(team.id) ?? fallbackTeams[index] ?? TEAMS[index] ?? TEAMS[0];
      return {
        id: team.id,
        name: team.name,
        color: normalizeTeamColor(team.color, fallbackTeam.color),
        displayOrder: index + 1
      };
    });
}

function normalizePositions(values: number[] | null | undefined): Position[] {
  return [...new Set((values ?? []).filter((value) => value >= 1 && value <= 5))].sort(
    (left, right) => left - right
  ) as Position[];
}

export function playerFromRow(
  row: DbPlayerRow,
  chemistry: Player["chemistry"] = createEmptyPlayerChemistry()
): Player {
  return {
    id: row.id,
    rowNumber: row.row_number,
    active: row.active ?? true,
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
    },
    chemistry
  };
}

export function playerToRow(player: Player, runId: string): DbPlayerRow {
  return {
    id: player.id,
    ...playerToInsertRow(player, runId)
  };
}

export function playerToInsertRow(player: Player, runId: string): DbPlayerInsertRow {
  return {
    run_id: runId,
    row_number: player.rowNumber,
    active: player.active,
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

export function playerChemistryRowsFromPlayers(players: Player[], runId: string): DbPlayerChemistryRow[] {
  return players
    .filter((player) => player.id > 0)
    .flatMap((player) =>
      (Object.entries(player.chemistry) as Array<[PlayerChemistryKind, number[]]>).flatMap(
        ([kind, chemistryPlayerIds]) =>
          chemistryPlayerIds
            .filter((targetPlayerId) => targetPlayerId > 0)
            .map((targetPlayerId) => ({
              run_id: runId,
              source_player_id: player.id,
              target_player_id: targetPlayerId,
              kind
            }))
      )
    );
}

function buildPlayerChemistryBySourceId(rows: DbPlayerChemistryRow[]) {
  const chemistryBySourceId = new Map<number, Player["chemistry"]>();

  for (const row of rows) {
    const nextChemistry = chemistryBySourceId.get(row.source_player_id) ?? createEmptyPlayerChemistry();
    nextChemistry[row.kind] = [...nextChemistry[row.kind], row.target_player_id];
    chemistryBySourceId.set(row.source_player_id, nextChemistry);
  }

  return chemistryBySourceId;
}

export function playersFromRows(
  rows: DbPlayerRow[],
  chemistryRows: DbPlayerChemistryRow[] = []
): Player[] {
  const chemistryBySourceId = buildPlayerChemistryBySourceId(chemistryRows);

  return sanitizePlayers(
    rows
      .slice()
      .sort((left, right) => left.row_number - right.row_number)
      .map((row) => playerFromRow(row, chemistryBySourceId.get(row.id)))
  );
}

export function teamFromRow(row: DbTeamRow, fallbackTeam: Team): Team {
  return {
    id: row.id,
    name: row.name,
    color: normalizeTeamColor(row.color, fallbackTeam.color),
    displayOrder: row.display_order
  };
}

export function teamsFromRows(rows: DbTeamRow[], fallbackTeams: Team[] = TEAMS): Team[] {
  if (rows.length === 0) {
    return [];
  }

  return normalizeTeams(
    rows
      .slice()
      .sort((left, right) => left.display_order - right.display_order)
      .map((row, index) => teamFromRow(row, fallbackTeams[index] ?? TEAMS[index] ?? TEAMS[0])),
    fallbackTeams
  );
}

export function teamsToRows(teams: Team[], runId: string) {
  return teams.map((team, index) => ({
    id: team.id,
    run_id: runId,
    name: team.name,
    color: normalizeTeamColor(team.color, TEAM_COLOR_PALETTE[index] ?? TEAM_COLOR_PALETTE[0]),
    display_order: index + 1
  }));
}

function serializeTeams(teams: Team[]) {
  return teams.map((team, index) => ({
    id: team.id,
    name: team.name,
    color: normalizeTeamColor(team.color, TEAM_COLOR_PALETTE[index] ?? TEAM_COLOR_PALETTE[0]),
    display_order: index + 1
  }));
}

export function areTeamsEqual(left: Team[], right: Team[]) {
  return JSON.stringify(serializeTeams(left)) === JSON.stringify(serializeTeams(right));
}

export function buildAssignmentsFromRows(rows: DbScenarioAssignmentRow[], teams: Team[] = TEAMS): Assignments {
  const assignments = createEmptyAssignments(teams);

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
  localScenarios: Scenario[] = [],
  teams: Team[] = TEAMS
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
      assignments: buildAssignmentsFromRows(rowsByScenario.get(scenario.id) ?? [], teams),
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

export function scenariosToRows(scenarios: Scenario[], runId: string) {
  return scenarios.map((scenario, index) => ({
    id: scenario.id,
    run_id: runId,
    title: scenario.title,
    sort_order: index + 1
  }));
}

export function isSamePlayer(left: Player, right: Player) {
  return (
    left.id === right.id &&
    left.rowNumber === right.rowNumber &&
    left.active === right.active &&
    left.name === right.name &&
    JSON.stringify(left.positions) === JSON.stringify(right.positions) &&
    JSON.stringify(left.attributes) === JSON.stringify(right.attributes) &&
    JSON.stringify(left.chemistry) === JSON.stringify(right.chemistry)
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

export function isScenarioPristine(scenarios: Scenario[], teams: Team[] = TEAMS) {
  return (
    scenarios.length === 1 &&
    scenarios[0].title === "Team Scenario 1" &&
    areAssignmentsEqual(scenarios[0].assignments, createEmptyAssignments(teams))
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

    const storedTeams = Array.isArray(parsed.teams) && parsed.teams.length > 0
      ? normalizeTeams(parsed.teams)
      : normalizeTeams(TEAMS);

    return {
      nextScenarioNumber: parsed.nextScenarioNumber,
      scenarios: normalizeScenarioIds(parsed.scenarios),
      teams: storedTeams
    };
  } catch {
    return null;
  }
}

export function slotKey(slot: SlotDescriptor) {
  return `${slot.teamId}:${slot.position}`;
}
