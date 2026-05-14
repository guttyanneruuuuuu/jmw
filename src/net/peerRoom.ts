import Peer, { DataConnection } from "peerjs";
import type { GameState, InputEvent, NetMessage } from "../game/types";

export type PeerStatus = "idle" | "opening" | "ready" | "connected" | "closed" | "error";

interface PeerRoomOptions {
  name: string;
  onMessage: (message: NetMessage, peerId: string) => void;
  onStatus: (status: PeerStatus, detail?: string) => void;
}

export class PeerRoom {
  private peer?: Peer;
  private hostConnection?: DataConnection;
  private readonly guests = new Map<string, DataConnection>();
  private isHost = false;

  constructor(private readonly options: PeerRoomOptions) {}

  async create(): Promise<string> {
    this.isHost = true;
    this.options.onStatus("opening");
    this.peer = this.makePeer();
    const id = await this.waitForOpen(this.peer);
    this.options.onStatus("ready", id);
    this.peer.on("connection", (connection) => this.acceptGuest(connection));
    return id;
  }

  async join(roomId: string): Promise<string> {
    this.isHost = false;
    this.options.onStatus("opening");
    this.peer = this.makePeer();
    const id = await this.waitForOpen(this.peer);
    const connection = this.peer.connect(roomId, { reliable: true, metadata: { name: this.options.name } });
    this.hostConnection = connection;
    this.bindConnection(connection);
    connection.on("open", () => {
      this.options.onStatus("connected", roomId);
      this.send({ type: "join", name: this.options.name });
    });
    return id;
  }

  send(message: NetMessage): void {
    if (this.isHost) {
      this.broadcast(message);
      return;
    }
    if (this.hostConnection?.open) this.hostConnection.send(message);
  }

  sendTo(peerId: string, message: NetMessage): void {
    const connection = this.guests.get(peerId);
    if (connection?.open) connection.send(message);
  }

  broadcast(message: NetMessage): void {
    for (const connection of this.guests.values()) {
      if (connection.open) connection.send(message);
    }
  }

  broadcastSnapshot(snapshot: GameState): void {
    this.broadcast({ type: "snapshot", snapshot });
  }

  close(): void {
    for (const connection of this.guests.values()) connection.close();
    this.hostConnection?.close();
    this.peer?.destroy();
    this.options.onStatus("closed");
  }

  private makePeer(): Peer {
    const peer = new Peer({
      host: "0.peerjs.com",
      port: 443,
      path: "/",
      secure: true,
      debug: 0
    });
    peer.on("error", (error) => this.options.onStatus("error", error.message));
    peer.on("disconnected", () => this.options.onStatus("closed"));
    return peer;
  }

  private waitForOpen(peer: Peer): Promise<string> {
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error("Peer server timeout")), 12000);
      peer.on("open", (id) => {
        window.clearTimeout(timeout);
        resolve(id);
      });
      peer.on("error", (error) => {
        window.clearTimeout(timeout);
        reject(error);
      });
    });
  }

  private acceptGuest(connection: DataConnection): void {
    this.guests.set(connection.peer, connection);
    this.bindConnection(connection);
    connection.on("open", () => this.options.onStatus("connected", connection.peer));
  }

  private bindConnection(connection: DataConnection): void {
    connection.on("data", (data) => {
      if (isNetMessage(data)) this.options.onMessage(data, connection.peer);
    });
    connection.on("close", () => {
      this.guests.delete(connection.peer);
      this.options.onMessage({ type: "leave", playerId: connection.peer }, connection.peer);
    });
    connection.on("error", (error) => this.options.onStatus("error", error.message));
  }
}

function isNetMessage(data: unknown): data is NetMessage {
  return typeof data === "object" && data !== null && "type" in data;
}

export function inviteUrl(roomId: string): string {
  const url = new URL(window.location.href);
  url.searchParams.set("room", roomId);
  return url.toString();
}

export function isInputMessage(message: NetMessage): message is { type: "input"; input: InputEvent } {
  return message.type === "input";
}
