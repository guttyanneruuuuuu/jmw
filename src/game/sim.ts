import {
  ARENA_RADIUS,
  BRACE_COOLDOWN_MS,
  BRACE_MS,
  COUNTDOWN_MS,
  FRICTION_PER_SECOND,
  HIT_ARC_DOT,
  HIT_RANGE,
  INVULNERABLE_MS,
  MATCH_MS,
  MAX_PLAYERS,
  PLAYER_COLORS,
  PLAYER_RADIUS,
  STUN_MS,
  THRUST_ACTIVE_MS,
  THRUST_COOLDOWN_MS,
  THRUST_GHOST_MS,
  WALL_BOUNCE
} from "./constants";
import { add, clamp, dot, len, mul, norm, rotate, shortId, sub, v } from "./math";
import { Rng } from "./random";
import type { GameEvent, GameMode, GameState, InputEvent, PlayerKind, PlayerState, Vec2 } from "./types";

const botNames = ["Sumi", "Kiwa", "Nagi", "Aka", "Towa", "Muku"];

export function createPlayer(id: string, name: string, kind: PlayerKind, teamId: number, index: number, total: number): PlayerState {
  const angle = (index / total) * Math.PI * 2 - Math.PI / 2;
  const radius = total <= 2 ? 4.2 : 5.6;
  const position = { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  const facing = norm(mul(position, -1));
  return {
    id,
    name,
    teamId,
    kind,
    position,
    velocity: v(),
    facing,
    cooldownMs: 0,
    score: 0,
    stunMs: 0,
    connected: true,
    color: PLAYER_COLORS[index % PLAYER_COLORS.length],
    invulnerableMs: 900,
    braceMs: 0,
    attackActiveMs: 0,
    thrustGhostMs: 0,
    hitIds: []
  };
}

export function createGame(mode: GameMode, localName = "You", seed = Date.now() % 1_000_000): GameState {
  const roster = mode === "ffa6" ? 6 : mode === "team3v3" ? 6 : 2;
  const players: PlayerState[] = [];
  players.push(createPlayer("p1", localName || "You", "human", 1, 0, roster));

  for (let i = 1; i < roster; i += 1) {
    const teamId = mode === "team3v3" ? (i < 3 ? 1 : 2) : i + 1;
    players.push(createPlayer(`ai${i}`, botNames[(i - 1) % botNames.length], "ai", teamId, i, roster));
  }

  return {
    matchId: `kami-${seed}-${shortId()}`,
    seed,
    phase: "countdown",
    mode,
    timeRemainingMs: MATCH_MS,
    elapsedMs: -COUNTDOWN_MS,
    players,
    arena: {
      radius: ARENA_RADIUS,
      innerRadius: ARENA_RADIUS - 1.2
    },
    events: [],
    winnerIds: []
  };
}

export function addRemotePlayer(state: GameState, id: string, name: string): GameState {
  if (state.players.some((player) => player.id === id)) return state;
  if (state.players.length >= MAX_PLAYERS) return state;

  const next = cloneGame(state);
  const aiIndex = next.players.findIndex((player) => player.kind === "ai");
  const index = aiIndex >= 0 ? aiIndex : next.players.length;
  const remote = createPlayer(id, name || "Guest", "remote", 2, index, Math.max(2, next.players.length + 1));

  if (aiIndex >= 0) next.players.splice(aiIndex, 1, remote);
  else next.players.push(remote);

  next.mode = "online";
  pushEvent(next, "join", `${remote.name} entered the circle.`, remote.id, undefined, remote.position);
  return next;
}

export function resetMatch(previous: GameState, seed = Date.now() % 1_000_000): GameState {
  const rng = new Rng(seed);
  const players = previous.players.map((oldPlayer, index) => {
    const fresh = createPlayer(oldPlayer.id, oldPlayer.name, oldPlayer.kind, oldPlayer.teamId, index, previous.players.length);
    fresh.color = oldPlayer.color;
    fresh.position = rotate(fresh.position, rng.range(-0.12, 0.12));
    return fresh;
  });

  return {
    ...previous,
    matchId: `kami-${seed}-${shortId()}`,
    seed,
    phase: "countdown",
    timeRemainingMs: MATCH_MS,
    elapsedMs: -COUNTDOWN_MS,
    players,
    events: [],
    winnerIds: []
  };
}

export function tickGame(source: GameState, dtMs: number, inputs: InputEvent[]): GameState {
  const state = cloneGame(source);
  const dt = clamp(dtMs, 0, 48) / 1000;

  if (state.phase === "countdown") {
    state.elapsedMs += dtMs;
    if (state.elapsedMs >= 0) {
      state.phase = "playing";
      state.elapsedMs = 0;
      pushEvent(state, "round", "The paper gate opens.");
    }
    return state;
  }

  if (state.phase !== "playing") return state;

  state.elapsedMs += dtMs;
  state.timeRemainingMs = Math.max(0, state.timeRemainingMs - dtMs);

  const inputByPlayer = new Map<string, InputEvent>();
  for (const input of inputs) inputByPlayer.set(input.playerId, input);

  for (const player of state.players) {
    player.cooldownMs = Math.max(0, player.cooldownMs - dtMs);
    player.stunMs = Math.max(0, player.stunMs - dtMs);
    player.invulnerableMs = Math.max(0, player.invulnerableMs - dtMs);
    player.braceMs = Math.max(0, player.braceMs - dtMs);
    player.attackActiveMs = Math.max(0, player.attackActiveMs - dtMs);
    player.thrustGhostMs = Math.max(0, player.thrustGhostMs - dtMs);
    if (player.attackActiveMs <= 0) player.hitIds = [];

    const input = inputByPlayer.get(player.id);
    if (input && player.cooldownMs <= 0 && player.stunMs <= 0) {
      applyInput(state, player, input);
    }
  }

  integratePlayers(state, dt);
  resolvePlayerCollisions(state);
  resolveHits(state);

  if (state.timeRemainingMs <= 0) {
    finishMatch(state);
  }

  state.events = state.events.slice(-16);
  return state;
}

function applyInput(state: GameState, player: PlayerState, input: InputEvent): void {
  const aim = norm(input.aimVector);
  player.facing = aim;

  if (input.type === "brace" || input.tap) {
    player.braceMs = BRACE_MS;
    player.cooldownMs = BRACE_COOLDOWN_MS;
    player.velocity = mul(player.velocity, 0.3);
    pushEvent(state, "brace", `${player.name} holds the line.`, player.id, undefined, player.position);
    return;
  }

  const impulse = 5.9 + clamp(input.power, 0.2, 1) * 6.9;
  player.velocity = add(player.velocity, mul(aim, impulse));
  player.cooldownMs = THRUST_COOLDOWN_MS;
  player.attackActiveMs = THRUST_ACTIVE_MS;
  player.thrustGhostMs = THRUST_GHOST_MS;
  player.hitIds = [];
}

function integratePlayers(state: GameState, dt: number): void {
  const friction = Math.exp(-FRICTION_PER_SECOND * dt);
  for (const player of state.players) {
    const stunDrag = player.stunMs > 0 ? 0.92 : 1;
    player.velocity = mul(player.velocity, friction * stunDrag);
    if (len(player.velocity) > 0.04) player.facing = norm(player.velocity);

    player.position = add(player.position, mul(player.velocity, dt));

    const distanceFromCenter = len(player.position);
    const maxDistance = state.arena.radius - PLAYER_RADIUS;
    if (distanceFromCenter > maxDistance) {
      const outward = norm(player.position);
      player.position = mul(outward, maxDistance);
      const outwardSpeed = dot(player.velocity, outward);
      if (outwardSpeed > 0) {
        player.velocity = sub(player.velocity, mul(outward, outwardSpeed * (1 + WALL_BOUNCE)));
      }
    }
  }
}

function resolvePlayerCollisions(state: GameState): void {
  for (let i = 0; i < state.players.length; i += 1) {
    for (let j = i + 1; j < state.players.length; j += 1) {
      const a = state.players[i];
      const b = state.players[j];
      const delta = sub(b.position, a.position);
      const d = len(delta);
      const minD = PLAYER_RADIUS * 2;
      if (d <= 0 || d >= minD) continue;
      const n = norm(delta);
      const overlap = minD - d;
      a.position = add(a.position, mul(n, -overlap * 0.5));
      b.position = add(b.position, mul(n, overlap * 0.5));
      const push = mul(n, 1.6 * overlap);
      a.velocity = add(a.velocity, mul(push, -1));
      b.velocity = add(b.velocity, push);
    }
  }
}

function resolveHits(state: GameState): void {
  for (const attacker of state.players) {
    if (attacker.attackActiveMs <= 0) continue;

    for (const target of state.players) {
      if (target.id === attacker.id) continue;
      if (target.teamId === attacker.teamId && state.mode === "team3v3") continue;
      if (attacker.hitIds.includes(target.id)) continue;
      if (target.invulnerableMs > 0) continue;

      const toTarget = sub(target.position, attacker.position);
      const distance = len(toTarget);
      const guarded = target.braceMs > 0 && dot(target.facing, mul(norm(toTarget), -1)) > 0.2;
      const inArc = dot(attacker.facing, norm(toTarget)) > HIT_ARC_DOT;

      if (distance <= HIT_RANGE && inArc) {
        attacker.hitIds.push(target.id);
        const scoreDelta = guarded ? 0 : 1;
        attacker.score += scoreDelta;
        target.score -= guarded ? 0 : 1;
        target.stunMs = guarded ? 160 : STUN_MS;
        target.invulnerableMs = guarded ? 280 : INVULNERABLE_MS;
        target.velocity = add(target.velocity, mul(attacker.facing, guarded ? 3.4 : 7.6));
        attacker.velocity = mul(attacker.velocity, guarded ? -0.16 : 0.32);
        pushEvent(
          state,
          "hit",
          guarded ? `${target.name} deflected ${attacker.name}.` : `${attacker.name} pierced ${target.name}.`,
          attacker.id,
          target.id,
          target.position
        );
      }
    }
  }
}

function finishMatch(state: GameState): void {
  const best = Math.max(...state.players.map((player) => player.score));
  state.winnerIds = state.players.filter((player) => player.score === best).map((player) => player.id);
  state.phase = "ended";
  pushEvent(state, "finish", best <= 0 ? "No blade found the mark." : "The last stroke lands.");
}

function pushEvent(
  state: GameState,
  type: GameEvent["type"],
  message: string,
  actorId?: string,
  targetId?: string,
  position?: Vec2
): void {
  state.events.push({
    id: shortId(),
    type,
    atMs: state.elapsedMs,
    actorId,
    targetId,
    position,
    message
  });
}

export function cloneGame(state: GameState): GameState {
  return {
    ...state,
    arena: { ...state.arena },
    players: state.players.map((player) => ({
      ...player,
      position: { ...player.position },
      velocity: { ...player.velocity },
      facing: { ...player.facing },
      hitIds: [...player.hitIds]
    })),
    events: state.events.map((event) => ({
      ...event,
      position: event.position ? { ...event.position } : undefined
    })),
    winnerIds: [...state.winnerIds]
  };
}

export function makeInput(playerId: string, type: "thrust" | "brace", aimVector: Vec2, power: number, seq: number): InputEvent {
  return {
    seq,
    playerId,
    type,
    aimVector: norm(aimVector),
    power: clamp(power, 0, 1),
    tap: type === "brace",
    clientTimeMs: performance.now()
  };
}

export function topScorers(state: GameState): PlayerState[] {
  const best = Math.max(...state.players.map((player) => player.score));
  return state.players.filter((player) => player.score === best);
}

export function timeLabel(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
