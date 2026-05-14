import { dist, norm, rotate, sub } from "./math";
import type { GameState, InputEvent, PlayerState } from "./types";

interface AiMemory {
  nextAt: number;
  jitter: number;
}

const memory = new Map<string, AiMemory>();

export function resetAiMemory(): void {
  memory.clear();
}

export function generateAiInputs(state: GameState, nowMs: number, seqStart: number): InputEvent[] {
  if (state.phase !== "playing") return [];

  const inputs: InputEvent[] = [];
  let seq = seqStart;

  for (const player of state.players) {
    if (player.kind !== "ai") continue;
    const brain = memory.get(player.id) ?? { nextAt: 0, jitter: Math.random() * 0.9 - 0.45 };
    memory.set(player.id, brain);

    if (nowMs < brain.nextAt || player.cooldownMs > 0 || player.stunMs > 0) continue;

    const target = chooseTarget(state, player);
    if (!target) continue;

    const toTarget = sub(target.position, player.position);
    const distance = dist(target.position, player.position);
    const lead = norm({
      x: toTarget.x + target.velocity.x * 0.18,
      y: toTarget.y + target.velocity.y * 0.18
    });
    const aim = rotate(lead, brain.jitter * Math.min(0.45, distance / 10));
    const shouldBrace = distance < 1.35 && target.attackActiveMs > 0 && Math.random() < 0.58;

    inputs.push({
      seq,
      playerId: player.id,
      type: shouldBrace ? "brace" : "thrust",
      aimVector: shouldBrace ? player.facing : aim,
      power: distance > 3.6 ? 1 : 0.55 + Math.random() * 0.28,
      tap: shouldBrace,
      clientTimeMs: nowMs
    });
    seq += 1;
    brain.nextAt = nowMs + 460 + Math.random() * 620;
    brain.jitter = Math.random() * 0.9 - 0.45;
  }

  return inputs;
}

function chooseTarget(state: GameState, player: PlayerState): PlayerState | undefined {
  const candidates = state.players.filter(
    (candidate) => candidate.id !== player.id && candidate.connected && !(state.mode === "team3v3" && candidate.teamId === player.teamId)
  );
  candidates.sort((a, b) => dist(a.position, player.position) - dist(b.position, player.position));
  return candidates[0];
}
