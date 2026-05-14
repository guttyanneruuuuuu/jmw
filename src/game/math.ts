import type { Vec2 } from "./types";

export const v = (x = 0, y = 0): Vec2 => ({ x, y });

export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });

export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });

export const mul = (a: Vec2, n: number): Vec2 => ({ x: a.x * n, y: a.y * n });

export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;

export const len = (a: Vec2): number => Math.hypot(a.x, a.y);

export const dist = (a: Vec2, b: Vec2): number => len(sub(a, b));

export const norm = (a: Vec2): Vec2 => {
  const l = len(a);
  if (l < 0.0001) return { x: 0, y: 1 };
  return { x: a.x / l, y: a.y / l };
};

export const clamp = (n: number, min: number, max: number): number => Math.max(min, Math.min(max, n));

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const rotate = (a: Vec2, radians: number): Vec2 => {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c };
};

export const shortId = (): string => Math.random().toString(36).slice(2, 8);
