import "./style.css";
import { generateAiInputs, resetAiMemory } from "./game/ai";
import { makeInput, resetMatch, tickGame, timeLabel, topScorers, createGame, addRemotePlayer } from "./game/sim";
import type { GameMode, GameState, InputEvent, NetMessage, PlayerState, TouchAim, Vec2 } from "./game/types";
import { norm, shortId } from "./game/math";
import { GameRenderer } from "./game/renderer";
import type { PeerRoom } from "./net/peerRoom";

type View = "home" | "lobby" | "playing" | "ended";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("App root missing");

app.innerHTML = `
  <main class="shell">
    <canvas id="stage" class="stage" aria-label="KAMI arena"></canvas>
    <div class="paper-grain"></div>

    <header id="hud" class="hud" data-ui>
      <div class="timer">
        <span id="timerText">2:00</span>
        <span id="phaseText">READY</span>
      </div>
      <div id="scoreboard" class="scoreboard"></div>
    </header>

    <section id="homePanel" class="panel home-panel" data-ui>
      <p class="eyebrow">KAMI</p>
      <h1>KAMI</h1>
      <p class="tagline">Two minutes. One stroke.</p>
      <label class="field">
        <span>Name</span>
        <input id="nameInput" maxlength="14" autocomplete="nickname" />
      </label>
      <div class="primary-grid">
        <button id="soloButton" class="command primary">AI Duel</button>
        <button id="createRoomButton" class="command">Create Room</button>
      </div>
      <div class="join-row">
        <input id="roomInput" maxlength="32" placeholder="Room code" />
        <button id="joinButton" class="command compact">Join</button>
      </div>
      <div class="mode-grid">
        <button id="sixButton" class="command muted">6 FFA</button>
        <button id="teamsButton" class="command muted">3v3 Bots</button>
      </div>
    </section>

    <section id="lobbyPanel" class="panel lobby-panel hidden" data-ui>
      <p class="eyebrow">ROOM</p>
      <h2 id="roomTitle">Opening...</h2>
      <p id="roomStatus" class="status-line">Connecting to PeerJS</p>
      <div id="roomCode" class="room-code">----</div>
      <button id="shareButton" class="command primary">Share Link</button>
      <button id="lobbyAiButton" class="command muted">AI Duel</button>
    </section>

    <section id="resultPanel" class="panel result-panel hidden" data-ui>
      <p class="eyebrow">RESULT</p>
      <h2 id="resultTitle">Match Over</h2>
      <p id="resultText" class="status-line"></p>
      <button id="rematchButton" class="command primary">Again</button>
      <button id="homeButton" class="command muted">Title</button>
    </section>

    <aside id="eventLog" class="event-log" data-ui></aside>
    <div id="gesture" class="gesture hidden"></div>
    <div id="toast" class="toast hidden" data-ui></div>
  </main>
`;

const canvas = must<HTMLCanvasElement>("#stage");
const hud = must<HTMLElement>("#hud");
const homePanel = must<HTMLElement>("#homePanel");
const lobbyPanel = must<HTMLElement>("#lobbyPanel");
const resultPanel = must<HTMLElement>("#resultPanel");
const timerText = must<HTMLElement>("#timerText");
const phaseText = must<HTMLElement>("#phaseText");
const scoreboard = must<HTMLElement>("#scoreboard");
const eventLog = must<HTMLElement>("#eventLog");
const gesture = must<HTMLElement>("#gesture");
const toast = must<HTMLElement>("#toast");
const nameInput = must<HTMLInputElement>("#nameInput");
const roomInput = must<HTMLInputElement>("#roomInput");
const roomTitle = must<HTMLElement>("#roomTitle");
const roomStatus = must<HTMLElement>("#roomStatus");
const roomCode = must<HTMLElement>("#roomCode");
const resultTitle = must<HTMLElement>("#resultTitle");
const resultText = must<HTMLElement>("#resultText");

const savedName = localStorage.getItem("kami:name") ?? "";
nameInput.value = savedName || `Guest-${shortId().slice(0, 3)}`;
const urlRoom = new URLSearchParams(window.location.search).get("room");
if (urlRoom) roomInput.value = urlRoom;

const renderer = new GameRenderer(canvas);
let view: View = "home";
let game: GameState = createGame("duel", playerName(), Date.now() % 999_999);
let room: PeerRoom | undefined;
let roomId = "";
let localPlayerId = "p1";
let hasAuthority = true;
let inputSeq = 1;
let pendingInputs: InputEvent[] = [];
let lastFrame = performance.now();
let lastSnapshot = 0;
let statusText = "Local";
let resultShownFor = "";

const aim: TouchAim = {
  active: false,
  start: { x: 0, y: 0 },
  current: { x: 0, y: 0 },
  vector: { x: 0, y: 1 },
  power: 0
};

wireUi();
setView("home");
requestAnimationFrame(frame);

function wireUi(): void {
  must<HTMLButtonElement>("#soloButton").addEventListener("click", () => startSolo("duel"));
  must<HTMLButtonElement>("#sixButton").addEventListener("click", () => startSolo("ffa6"));
  must<HTMLButtonElement>("#teamsButton").addEventListener("click", () => startSolo("team3v3"));
  must<HTMLButtonElement>("#createRoomButton").addEventListener("click", () => void createRoom());
  must<HTMLButtonElement>("#joinButton").addEventListener("click", () => void joinRoom(roomInput.value.trim()));
  must<HTMLButtonElement>("#shareButton").addEventListener("click", () => void shareRoom());
  must<HTMLButtonElement>("#lobbyAiButton").addEventListener("click", () => startSolo("duel"));
  must<HTMLButtonElement>("#rematchButton").addEventListener("click", () => rematch());
  must<HTMLButtonElement>("#homeButton").addEventListener("click", () => setView("home"));
  nameInput.addEventListener("change", () => localStorage.setItem("kami:name", playerName()));

  window.addEventListener("resize", () => renderer.resize());
  window.addEventListener("blur", () => endGesture());
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) endGesture();
  });

  canvas.addEventListener("pointerdown", beginGesture, { passive: false });
  canvas.addEventListener("pointermove", moveGesture, { passive: false });
  canvas.addEventListener("pointerup", releaseGesture, { passive: false });
  canvas.addEventListener("pointercancel", endGesture, { passive: false });
}

function frame(now: number): void {
  const dt = Math.min(48, now - lastFrame);
  lastFrame = now;

  if (hasAuthority && (view === "playing" || game.phase === "playing" || game.phase === "countdown")) {
    const aiInputs = generateAiInputs(game, now, inputSeq);
    inputSeq += aiInputs.length;
    game = tickGame(game, dt, pendingInputs.concat(aiInputs));
    pendingInputs = [];
    if (room && now - lastSnapshot > 84) {
      room.broadcastSnapshot(game);
      lastSnapshot = now;
    }
  }

  renderer.update(game, localPlayerId, aim);
  syncHud();

  if (game.phase === "ended" && view === "playing" && resultShownFor !== game.matchId) {
    resultShownFor = game.matchId;
    showResult();
  }

  requestAnimationFrame(frame);
}

function startSolo(mode: GameMode): void {
  closeRoom();
  localPlayerId = "p1";
  hasAuthority = true;
  statusText = modeLabel(mode);
  resultShownFor = "";
  resetAiMemory();
  game = createGame(mode, playerName(), Date.now() % 999_999);
  setView("playing");
  pop("Match starts");
}

async function createRoom(): Promise<void> {
  closeRoom();
  saveName();
  hasAuthority = true;
  localPlayerId = "p1";
  statusText = "Opening room";
  game = createGame("online", playerName(), Date.now() % 999_999);
  game.phase = "lobby";
  setView("lobby");

  const { PeerRoom } = await import("./net/peerRoom");
  room = new PeerRoom({
    name: playerName(),
    onMessage: handleNetMessage,
    onStatus: handlePeerStatus
  });

  try {
    roomId = await room.create();
    roomCode.textContent = roomId;
    roomTitle.textContent = "Room Ready";
    roomStatus.textContent = "Waiting for one rival";
    history.replaceState(null, "", `?room=${encodeURIComponent(roomId)}`);
  } catch (error) {
    handlePeerError(error);
  }
}

async function joinRoom(code: string): Promise<void> {
  if (!code) {
    pop("Room code missing");
    return;
  }

  closeRoom();
  saveName();
  hasAuthority = false;
  localPlayerId = "";
  roomId = code;
  statusText = "Joining";
  game = createGame("online", playerName(), Date.now() % 999_999);
  game.phase = "lobby";
  setView("lobby");
  roomCode.textContent = code;
  roomTitle.textContent = "Joining Room";
  roomStatus.textContent = "Calling host";

  const { PeerRoom } = await import("./net/peerRoom");
  room = new PeerRoom({
    name: playerName(),
    onMessage: handleNetMessage,
    onStatus: handlePeerStatus
  });

  try {
    await room.join(code);
  } catch (error) {
    handlePeerError(error);
  }
}

function handleNetMessage(message: NetMessage, peerId: string): void {
  if (!room) return;

  switch (message.type) {
    case "join": {
      if (!hasAuthority) return;
      game = addRemotePlayer(game, peerId, message.name);
      game = resetMatch(game, Date.now() % 999_999);
      game.mode = "online";
      resultShownFor = "";
      room.sendTo(peerId, { type: "accept", playerId: peerId, snapshot: game });
      room.broadcastSnapshot(game);
      setView("playing");
      pop(`${message.name} joined`);
      break;
    }
    case "accept": {
      localPlayerId = message.playerId;
      game = message.snapshot;
      resultShownFor = "";
      setView("playing");
      pop("Connected");
      break;
    }
    case "input": {
      if (hasAuthority) pendingInputs.push(message.input);
      break;
    }
    case "snapshot": {
      if (!hasAuthority) game = message.snapshot;
      break;
    }
    case "rematch": {
      if (hasAuthority) {
        game = resetMatch(game, message.seed);
        resultShownFor = "";
        setView("playing");
        room.broadcast({ type: "snapshot", snapshot: game });
      }
      break;
    }
    case "leave": {
      markDisconnected(message.playerId);
      pop("Rival left");
      break;
    }
    case "error": {
      pop(message.message);
      break;
    }
    case "hello":
    case "ping":
      break;
  }
}

function handlePeerStatus(status: string, detail = ""): void {
  statusText = detail || status;
  if (view === "lobby") {
    roomStatus.textContent = status === "error" ? `Error: ${detail}` : statusText;
  }
}

function handlePeerError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  roomTitle.textContent = "Room Failed";
  roomStatus.textContent = message;
  pop("Online failed");
}

function rematch(): void {
  const seed = Date.now() % 999_999;
  resultShownFor = "";
  if (room && !hasAuthority) {
    room.send({ type: "rematch", seed });
    pop("Again requested");
    return;
  }
  game = resetMatch(game, seed);
  setView("playing");
  room?.broadcast({ type: "snapshot", snapshot: game });
}

async function shareRoom(): Promise<void> {
  if (!roomId) return;
  const { inviteUrl } = await import("./net/peerRoom");
  const link = inviteUrl(roomId);
  try {
    await navigator.clipboard.writeText(link);
    pop("Link copied");
  } catch {
    roomStatus.textContent = link;
  }
}

function beginGesture(event: PointerEvent): void {
  if (view !== "playing" || game.phase !== "playing") return;
  if (!localPlayerId || !game.players.some((player) => player.id === localPlayerId)) return;
  event.preventDefault();
  canvas.setPointerCapture(event.pointerId);
  aim.active = true;
  aim.start = { x: event.clientX, y: event.clientY };
  aim.current = { ...aim.start };
  aim.vector = currentFacing();
  aim.power = 0;
  gesture.classList.remove("hidden");
  moveGesture(event);
}

function moveGesture(event: PointerEvent): void {
  if (!aim.active) return;
  event.preventDefault();
  aim.current = { x: event.clientX, y: event.clientY };
  const delta = { x: aim.current.x - aim.start.x, y: aim.current.y - aim.start.y };
  const distance = Math.hypot(delta.x, delta.y);
  aim.vector = distance > 4 ? norm({ x: delta.x, y: -delta.y }) : currentFacing();
  aim.power = Math.min(1, distance / 142);
  gesture.style.left = `${aim.current.x}px`;
  gesture.style.top = `${aim.current.y}px`;
  gesture.style.transform = `translate(-50%, -50%) scale(${0.75 + aim.power * 0.8})`;
}

function releaseGesture(event: PointerEvent): void {
  if (!aim.active) return;
  event.preventDefault();
  const distance = Math.hypot(aim.current.x - aim.start.x, aim.current.y - aim.start.y);
  const player = game.players.find((candidate) => candidate.id === localPlayerId);
  const type = distance < 14 ? "brace" : "thrust";
  const input = makeInput(localPlayerId, type, type === "brace" ? player?.facing ?? { x: 0, y: 1 } : aim.vector, aim.power, inputSeq);
  inputSeq += 1;
  submitInput(input);
  if (type === "thrust") navigator.vibrate?.(14);
  else navigator.vibrate?.([8, 22, 8]);
  endGesture();
}

function endGesture(): void {
  aim.active = false;
  aim.power = 0;
  gesture.classList.add("hidden");
}

function submitInput(input: InputEvent): void {
  if (!localPlayerId) return;
  if (room && !hasAuthority) {
    room.send({ type: "input", input });
    return;
  }
  pendingInputs.push(input);
}

function syncHud(): void {
  timerText.textContent = game.phase === "countdown" ? "Ready" : timeLabel(game.timeRemainingMs);
  phaseText.textContent = game.phase === "playing" ? statusText : game.phase.toUpperCase();
  scoreboard.innerHTML = game.players
    .map((player) => scoreRow(player, player.id === localPlayerId))
    .join("");
  eventLog.innerHTML = game.events
    .slice(-3)
    .reverse()
    .map((event) => `<p>${escapeHtml(event.message)}</p>`)
    .join("");
}

function showResult(): void {
  const winners = topScorers(game);
  resultTitle.textContent = winners.some((winner) => winner.id === localPlayerId) ? "You Cut Clean" : `${winners[0]?.name ?? "No one"} Wins`;
  resultText.textContent = game.players
    .slice()
    .sort((a, b) => b.score - a.score)
    .map((player) => `${player.name} ${player.score}`)
    .join(" / ");
  setView("ended");
}

function setView(next: View): void {
  view = next;
  homePanel.classList.toggle("hidden", next !== "home");
  lobbyPanel.classList.toggle("hidden", next !== "lobby");
  resultPanel.classList.toggle("hidden", next !== "ended");
  hud.classList.toggle("quiet", next === "home" || next === "lobby");
  eventLog.classList.toggle("hidden", next !== "playing");
  if (next === "home") {
    history.replaceState(null, "", window.location.pathname);
  }
}

function closeRoom(): void {
  room?.close();
  room = undefined;
  roomId = "";
}

function markDisconnected(playerId: string): void {
  const player = game.players.find((candidate) => candidate.id === playerId);
  if (!player) return;
  player.connected = false;
  player.kind = "ai";
  player.name = "Echo";
}

function currentFacing(): Vec2 {
  return game.players.find((player) => player.id === localPlayerId)?.facing ?? { x: 0, y: 1 };
}

function playerName(): string {
  return (nameInput.value || "Guest").trim().slice(0, 14);
}

function saveName(): void {
  localStorage.setItem("kami:name", playerName());
}

function scoreRow(player: PlayerState, local: boolean): string {
  const classes = ["score-row", local ? "local" : "", player.connected ? "" : "offline"].join(" ");
  const team = game.mode === "team3v3" ? `T${player.teamId} ` : "";
  const kind = player.kind === "ai" ? `${team}AI` : player.kind === "remote" ? `${team}P2P` : `${team}YOU`;
  return `
    <div class="${classes}">
      <span class="score-swatch" style="background:${player.color}"></span>
      <span class="score-name">${escapeHtml(player.name)}</span>
      <span class="score-kind">${kind}</span>
      <b>${player.score}</b>
    </div>
  `;
}

function modeLabel(mode: GameMode): string {
  if (mode === "ffa6") return "6 FFA";
  if (mode === "team3v3") return "3v3";
  if (mode === "online") return "P2P";
  return "AI Duel";
}

function pop(message: string): void {
  toast.textContent = message;
  toast.classList.remove("hidden");
  window.setTimeout(() => toast.classList.add("hidden"), 1600);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const table: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    };
    return table[char];
  });
}

function must<T extends HTMLElement>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`Missing ${selector}`);
  return node;
}
