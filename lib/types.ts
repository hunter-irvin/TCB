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

export type Player = {
  id: number;
  rowNumber: number;
  name: string;
  positions: Position[];
  attributes: PlayerAttributes;
};

export type Team = {
  id: string;
  name: string;
  color: string;
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
