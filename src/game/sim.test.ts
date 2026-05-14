import { describe, expect, it } from "vitest";
import { createGame, makeInput, tickGame } from "./sim";

describe("KAMI simulation", () => {
  it("starts a two minute duel after countdown", () => {
    const game = createGame("duel", "Tester", 10);
    const playing = tickGame(game, 1900, []);
    expect(playing.phase).toBe("playing");
    expect(playing.timeRemainingMs).toBe(120000);
    expect(playing.players).toHaveLength(2);
  });

  it("scores a forward pierce", () => {
    let game = createGame("duel", "Tester", 11);
    game = tickGame(game, 1900, []);
    const attacker = game.players[0];
    const target = game.players[1];
    attacker.position = { x: 0, y: 0 };
    target.position = { x: 0, y: 1.05 };
    attacker.facing = { x: 0, y: 1 };
    target.invulnerableMs = 0;
    game = tickGame(game, 16, [makeInput(attacker.id, "thrust", { x: 0, y: 1 }, 1, 1)]);
    game = tickGame(game, 16, []);
    expect(game.players[0].score).toBe(1);
    expect(game.players[1].stunMs).toBeGreaterThan(0);
  });

  it("ends and declares winners when time expires", () => {
    let game = createGame("ffa6", "Tester", 12);
    game = tickGame(game, 1900, []);
    game.players[2].score = 4;
    game = tickGame(game, 120000, []);
    expect(game.phase).toBe("ended");
    expect(game.winnerIds).toEqual([game.players[2].id]);
  });
});
