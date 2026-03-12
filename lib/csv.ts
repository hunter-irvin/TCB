import { ROSTER_SIZE } from "@/lib/constants";
import { createEmptyPlayerAttributes, getDefaultPlayerAttributes } from "@/lib/state";
import type { Player, Position } from "@/lib/types";

type SeedRow = {
  total: string;
  position: string;
  player: string;
};

function parseLine(line: string): string[] {
  return line
    .split(",")
    .map((part) => part.trim().replace(/^"|"$/g, ""));
}

export function parseRosterCsv(csv: string): Player[] {
  const lines = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const [, ...rows] = lines;
  const parsedRows = rows.map((line) => {
    const [total, position, player] = parseLine(line);
    return { total, position, player } satisfies SeedRow;
  });

  const players = parsedRows.map((row, index) => ({
    id: index + 1,
    rowNumber: Number(row.total) || index + 1,
    name: row.player,
    positions: [Number(row.position) as Position],
    attributes: getDefaultPlayerAttributes(Number(row.total) || index + 1)
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
