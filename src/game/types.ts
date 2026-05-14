export type MatchPhase = "lobby" | "countdown" | "playing" | "ended";
export type GameMode = "duel" | "online" | "ffa6" | "team3v3";
export type PlayerKind = "human" | "remote" | "ai";
export type InputType = "thrust" | "brace";

export interface Vec2 {
  x: number;
  y: number;
}

export interface ArenaState {
  radius: number;
  innerRadius: number;
}

export interface PlayerState {
  id: string;
  name: string;
  teamId: number;
  kind: PlayerKind;
  position: Vec2;
  velocity: Vec2;
  facing: Vec2;
  cooldownMs: number;
  score: number;
  stunMs: number;
  connected: boolean;
  color: string;
  invulnerableMs: number;
  braceMs: number;
  attackActiveMs: number;
  thrustGhostMs: number;
  hitIds: string[];
}

export interface GameEvent {
  id: string;
  type: "hit" | "brace" | "round" | "join" | "leave" | "finish";
  atMs: number;
  actorId?: string;
  targetId?: string;
  position?: Vec2;
  message: string;
}

export interface GameState {
  matchId: string;
  seed: number;
  phase: MatchPhase;
  mode: GameMode;
  timeRemainingMs: number;
  elapsedMs: number;
  players: PlayerState[];
  arena: ArenaState;
  events: GameEvent[];
  winnerIds: string[];
}

export interface InputEvent {
  seq: number;
  playerId: string;
  type: InputType;
  aimVector: Vec2;
  power: number;
  tap: boolean;
  clientTimeMs: number;
}

export type NetMessage =
  | { type: "hello"; version: 1; name: string }
  | { type: "join"; name: string }
  | { type: "accept"; playerId: string; snapshot: GameState }
  | { type: "input"; input: InputEvent }
  | { type: "snapshot"; snapshot: GameState }
  | { type: "rematch"; seed: number }
  | { type: "leave"; playerId: string }
  | { type: "ping"; at: number }
  | { type: "error"; message: string };

export interface TouchAim {
  active: boolean;
  start: Vec2;
  current: Vec2;
  vector: Vec2;
  power: number;
}
