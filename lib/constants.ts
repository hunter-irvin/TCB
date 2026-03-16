import type {
  PlayerAttributeKey,
  PlayerAttributes,
  PlayerChemistry,
  Position,
  Team
} from "@/lib/types";

export const POSITIONS: Position[] = [1, 2, 3, 4, 5];
export const ROSTER_SIZE = 20;
export const STORAGE_KEY = "tcb-app-state";
export const SEED_VERSION = "2026-03-11-v1";
export const MAX_PLAYER_CHEMISTRY_LINKS = 5;
export const TEAM_CHEMISTRY_MAX_ABS = 20;

export const PLAYER_ATTRIBUTE_GROUPS: Array<{
  label: string;
  tone: "offense" | "defense" | "misc";
  attributes: Array<{
    key: PlayerAttributeKey;
    label: string;
  }>;
}> = [
  {
    label: "Offense",
    tone: "offense",
    attributes: [
      { key: "shooting", label: "3PT Shooting" },
      { key: "driving", label: "Offense Creation" },
      { key: "assisting", label: "Passing" }
    ]
  },
  {
    label: "Defense",
    tone: "defense",
    attributes: [
      { key: "manDefense", label: "Man Defense" },
      { key: "helpDefense", label: "Help Defense" },
      { key: "shotBlocking", label: "Contesting Shots" }
    ]
  },
  {
    label: "Miscellaneous",
    tone: "misc",
    attributes: [
      { key: "playmaking", label: "Activity Level" },
      { key: "rebounding", label: "Rebounding" },
      { key: "transition", label: "Transition" }
    ]
  }
];

export const DEFAULT_PLAYER_ATTRIBUTES_BY_ROW: Record<number, PlayerAttributes> = {
  1: {
    shooting: 4,
    driving: 4,
    assisting: 3,
    manDefense: 3,
    helpDefense: 3,
    shotBlocking: 1,
    playmaking: 4,
    rebounding: 3,
    transition: 5
  },
  2: {
    shooting: 4,
    driving: 5,
    assisting: 3,
    manDefense: 5,
    helpDefense: 5,
    shotBlocking: 1,
    playmaking: 5,
    rebounding: 5,
    transition: 5
  },
  3: {
    shooting: 5,
    driving: 5,
    assisting: 3,
    manDefense: 3,
    helpDefense: 3,
    shotBlocking: 1,
    playmaking: 4,
    rebounding: 2,
    transition: 4
  },
  4: {
    shooting: 4,
    driving: 3,
    assisting: 3,
    manDefense: 4,
    helpDefense: 3,
    shotBlocking: 1,
    playmaking: 4,
    rebounding: 3,
    transition: 4
  },
  5: {
    shooting: 5,
    driving: 5,
    assisting: 4,
    manDefense: 4,
    helpDefense: 3,
    shotBlocking: 1,
    playmaking: 4,
    rebounding: 2,
    transition: 4
  },
  6: {
    shooting: 5,
    driving: 4,
    assisting: 4,
    manDefense: 4,
    helpDefense: 2,
    shotBlocking: 1,
    playmaking: 4,
    rebounding: 2,
    transition: 4
  },
  7: {
    shooting: 4,
    driving: 4,
    assisting: 3,
    manDefense: 4,
    helpDefense: 3,
    shotBlocking: 2,
    playmaking: 3,
    rebounding: 4,
    transition: 4
  },
  8: {
    shooting: 4,
    driving: 5,
    assisting: 4,
    manDefense: 3,
    helpDefense: 3,
    shotBlocking: 1,
    playmaking: 5,
    rebounding: 2,
    transition: 4
  },
  9: {
    shooting: 2,
    driving: 1,
    assisting: 2,
    manDefense: 3,
    helpDefense: 2,
    shotBlocking: 1,
    playmaking: 2,
    rebounding: 2,
    transition: 1
  },
  10: {
    shooting: 3,
    driving: 1,
    assisting: 4,
    manDefense: 2,
    helpDefense: 2,
    shotBlocking: 1,
    playmaking: 3,
    rebounding: 1,
    transition: 1
  },
  11: {
    shooting: 4,
    driving: 2,
    assisting: 2,
    manDefense: 3,
    helpDefense: 3,
    shotBlocking: 1,
    playmaking: 3,
    rebounding: 3,
    transition: 1
  },
  12: {
    shooting: 3,
    driving: 2,
    assisting: 2,
    manDefense: 3,
    helpDefense: 3,
    shotBlocking: 1,
    playmaking: 3,
    rebounding: 3,
    transition: 3
  },
  13: {
    shooting: 3,
    driving: 2,
    assisting: 2,
    manDefense: 3,
    helpDefense: 3,
    shotBlocking: 2,
    playmaking: 3,
    rebounding: 4,
    transition: 3
  },
  14: {
    shooting: 3,
    driving: 3,
    assisting: 2,
    manDefense: 3,
    helpDefense: 3,
    shotBlocking: 1,
    playmaking: 3,
    rebounding: 3,
    transition: 1
  },
  15: {
    shooting: 4,
    driving: 4,
    assisting: 3,
    manDefense: 4,
    helpDefense: 4,
    shotBlocking: 4,
    playmaking: 3,
    rebounding: 5,
    transition: 3
  },
  16: {
    shooting: 4,
    driving: 3,
    assisting: 3,
    manDefense: 4,
    helpDefense: 4,
    shotBlocking: 3,
    playmaking: 4,
    rebounding: 5,
    transition: 3
  },
  17: {
    shooting: 2,
    driving: 1,
    assisting: 3,
    manDefense: 3,
    helpDefense: 4,
    shotBlocking: 3,
    playmaking: 2,
    rebounding: 4,
    transition: 1
  },
  18: {
    shooting: 3,
    driving: 1,
    assisting: 3,
    manDefense: 3,
    helpDefense: 3,
    shotBlocking: 2,
    playmaking: 3,
    rebounding: 3,
    transition: 1
  },
  19: {
    shooting: 4,
    driving: 3,
    assisting: 5,
    manDefense: 4,
    helpDefense: 4,
    shotBlocking: 4,
    playmaking: 5,
    rebounding: 5,
    transition: 3
  },
  20: {
    shooting: 3,
    driving: 3,
    assisting: 3,
    manDefense: 3,
    helpDefense: 3,
    shotBlocking: 3,
    playmaking: 3,
    rebounding: 3,
    transition: 1
  }
};

export const DEFAULT_PLAYER_SEEDS: Array<{
  rowNumber: number;
  name: string;
  positions: Position[];
}> = [
  { rowNumber: 1, name: "Alon A", positions: [1] },
  { rowNumber: 2, name: "David J", positions: [1] },
  { rowNumber: 3, name: "Juwan R", positions: [1] },
  { rowNumber: 4, name: "Nick P-S", positions: [1] },
  { rowNumber: 5, name: "Thomas A", positions: [2] },
  { rowNumber: 6, name: "Eric W", positions: [2] },
  { rowNumber: 7, name: "Lucas P", positions: [2] },
  { rowNumber: 8, name: "Jake P", positions: [2] },
  { rowNumber: 9, name: "Tano T", positions: [3] },
  { rowNumber: 10, name: "Aaron M", positions: [3] },
  { rowNumber: 11, name: "Leib S", positions: [3] },
  { rowNumber: 12, name: "Hunter I", positions: [3] },
  { rowNumber: 13, name: "Zach B", positions: [4] },
  { rowNumber: 14, name: "Noel", positions: [4] },
  { rowNumber: 15, name: "Kiyoshi M", positions: [4] },
  { rowNumber: 16, name: "Joe S", positions: [4] },
  { rowNumber: 17, name: "Henry K", positions: [5] },
  { rowNumber: 18, name: "Nes", positions: [5] },
  { rowNumber: 19, name: "Sam", positions: [5] },
  { rowNumber: 20, name: "Yonaton", positions: [5] }
];

export const DEFAULT_PLAYER_CHEMISTRY_BY_ROW: Partial<Record<number, PlayerChemistry>> = {
  1: { bonus: [2, 5], tax: [9] },
  2: { bonus: [1, 6], tax: [10] },
  3: { bonus: [4], tax: [7, 8] },
  4: { bonus: [3, 15], tax: [] },
  5: { bonus: [1, 6, 19], tax: [] },
  6: { bonus: [2, 5], tax: [17] },
  7: { bonus: [8], tax: [3] },
  8: { bonus: [7, 10], tax: [3] },
  9: { bonus: [], tax: [1, 2] },
  10: { bonus: [8], tax: [2] },
  15: { bonus: [4, 19], tax: [18] },
  17: { bonus: [19], tax: [6] },
  18: { bonus: [], tax: [15] },
  19: { bonus: [5, 15, 17], tax: [] }
};

export const TEAMS: Team[] = [
  { id: "dawgs", name: "Dave's Dawgs", color: "var(--dawgs)" },
  { id: "rangers", name: "Alon's Rangers", color: "var(--rangers)" },
  { id: "jackets", name: "Juwan's Jackets", color: "var(--jackets)" },
  { id: "enforcers", name: "Eric's Enforcers", color: "var(--enforcers)" }
];
