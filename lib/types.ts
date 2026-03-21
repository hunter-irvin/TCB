export type Position = 1 | 2 | 3 | 4 | 5;

export type PlayerAttributeKey =
  | "shooting"
  | "driving"
  | "assisting"
  | "manDefense"
  | "helpDefense"
  | "shotBlocking"
  | "playmaking"
  | "rebounding"
  | "transition";

export type PlayerAttributeRating = 1 | 2 | 3 | 4 | 5;

export type PlayerAttributes = Record<PlayerAttributeKey, PlayerAttributeRating | null>;

export type PlayerChemistryKind = "bonus" | "tax";

export type PlayerChemistry = Record<PlayerChemistryKind, number[]>;

export type Player = {
  id: number;
  rowNumber: number;
  name: string;
  positions: Position[];
  attributes: PlayerAttributes;
  chemistry: PlayerChemistry;
};

export type Team = {
  id: string;
  name: string;
  color: string;
  displayOrder: number;
};

export type Assignments = Record<string, Record<Position, number | null>>;

export type AppState = {
  players: Player[];
  assignments: Assignments;
  seedVersion: string;
};

export type SlotDescriptor = {
  teamId: string;
  position: Position;
};

export type Scenario = {
  id: string;
  title: string;
  assignments: Assignments;
  collapsed: boolean;
};

export type PersistedScenarioState = {
  nextScenarioNumber: number;
  scenarios: Scenario[];
  teams: Team[];
};
