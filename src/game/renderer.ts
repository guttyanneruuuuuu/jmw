import * as THREE from "three";
import { HIT_RANGE } from "./constants";
import type { GameEvent, GameState, PlayerState, TouchAim } from "./types";

interface PlayerMeshes {
  root: THREE.Group;
  body: THREE.Mesh;
  spear: THREE.Mesh;
  shadow: THREE.Mesh;
  ring: THREE.Mesh;
}

interface Burst {
  id: string;
  mesh: THREE.Mesh;
  age: number;
}

export class GameRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(39, 1, 0.1, 100);
  private readonly players = new Map<string, PlayerMeshes>();
  private readonly bursts: Burst[] = [];
  private readonly aimGroup = new THREE.Group();
  private readonly clock = new THREE.Clock();
  private frame = 0;
  private arena?: THREE.Group;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: "high-performance"
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.65));
    this.renderer.setClearColor(0xefe7d4, 1);
    this.renderer.shadowMap.enabled = false;

    this.scene.fog = new THREE.Fog(0xefe7d4, 16, 34);
    this.camera.position.set(0, 13.2, 12.5);
    this.camera.lookAt(0, 0, 0);

    const hemi = new THREE.HemisphereLight(0xfff6dc, 0x41352a, 2.4);
    this.scene.add(hemi);

    const key = new THREE.DirectionalLight(0xf5d29b, 2.8);
    key.position.set(-5, 11, 6);
    this.scene.add(key);

    this.aimGroup.visible = false;
    this.scene.add(this.aimGroup);
    this.rebuildAimGroup();
    this.resize();
  }

  dispose(): void {
    this.renderer.dispose();
  }

  resize(): void {
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  update(state: GameState, localPlayerId: string, aim: TouchAim): void {
    this.frame += 1;
    this.ensureArena(state);
    this.syncPlayers(state, localPlayerId);
    this.syncBursts(state.events);
    this.updateAim(state, localPlayerId, aim);
    this.animateBursts();
    this.renderer.render(this.scene, this.camera);
  }

  canvasHasInk(): boolean {
    const gl = this.renderer.getContext();
    const pixel = new Uint8Array(4);
    gl.readPixels(Math.floor(this.canvas.width / 2), Math.floor(this.canvas.height / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    return pixel.some((value) => value > 0);
  }

  private ensureArena(state: GameState): void {
    if (this.arena) return;

    const group = new THREE.Group();
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(state.arena.radius, 80),
      new THREE.MeshStandardMaterial({ color: 0xd8c8a7, roughness: 0.92, metalness: 0.02 })
    );
    floor.rotation.x = -Math.PI / 2;
    group.add(floor);

    const inner = new THREE.Mesh(
      new THREE.RingGeometry(state.arena.innerRadius, state.arena.innerRadius + 0.07, 80),
      new THREE.MeshBasicMaterial({ color: 0x2b2118, transparent: true, opacity: 0.42, side: THREE.DoubleSide })
    );
    inner.rotation.x = -Math.PI / 2;
    inner.position.y = 0.012;
    group.add(inner);

    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(state.arena.radius, 0.075, 8, 96),
      new THREE.MeshStandardMaterial({ color: 0x1f1812, roughness: 0.76 })
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.1;
    group.add(rim);

    for (let i = 0; i < 18; i += 1) {
      const length = 1.4 + (i % 4) * 0.52;
      const mark = new THREE.Mesh(
        new THREE.BoxGeometry(0.035, 0.018, length),
        new THREE.MeshBasicMaterial({ color: i % 3 === 0 ? 0x8c2f25 : 0x41352a, transparent: true, opacity: 0.18 })
      );
      const angle = (i / 18) * Math.PI * 2;
      mark.position.set(Math.cos(angle) * (2.4 + (i % 3) * 1.4), 0.03, Math.sin(angle) * (2.4 + (i % 3) * 1.4));
      mark.rotation.y = -angle + Math.PI / 2;
      group.add(mark);
    }

    this.scene.add(group);
    this.arena = group;
  }

  private syncPlayers(state: GameState, localPlayerId: string): void {
    const liveIds = new Set(state.players.map((player) => player.id));
    for (const [id, meshes] of this.players) {
      if (!liveIds.has(id)) {
        this.scene.remove(meshes.root);
        this.players.delete(id);
      }
    }

    for (const player of state.players) {
      const meshes = this.players.get(player.id) ?? this.createPlayerMeshes(player);
      const t = 0.3;
      meshes.root.position.x += (player.position.x - meshes.root.position.x) * t;
      meshes.root.position.z += (player.position.y - meshes.root.position.z) * t;
      const angle = Math.atan2(player.facing.x, player.facing.y);
      meshes.root.rotation.y += wrapAngle(angle - meshes.root.rotation.y) * 0.38;

      const isLocal = player.id === localPlayerId;
      const attacking = player.attackActiveMs > 0;
      const bracing = player.braceMs > 0;
      const stunned = player.stunMs > 0;
      meshes.body.scale.setScalar(isLocal ? 1.1 : 1);
      meshes.body.position.y = 0.47 + Math.sin(this.frame * 0.08 + player.position.x) * 0.025;
      meshes.body.material = playerMaterial(player, isLocal, stunned);
      meshes.spear.scale.z = attacking ? 1.26 : 1;
      meshes.spear.position.z = attacking ? 0.68 : 0.43;
      meshes.ring.visible = isLocal || bracing || stunned;
      meshes.ring.scale.setScalar(bracing ? 1.3 : stunned ? 0.82 : 1);
      meshes.ring.material = ringMaterial(isLocal, bracing, stunned);
      meshes.shadow.scale.set(1.05 + player.thrustGhostMs / 420, 1, 0.82 + player.thrustGhostMs / 720);
    }
  }

  private createPlayerMeshes(player: PlayerState): PlayerMeshes {
    const root = new THREE.Group();
    root.position.set(player.position.x, 0, player.position.y);

    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.56, 24),
      new THREE.MeshBasicMaterial({ color: 0x1a120d, transparent: true, opacity: 0.16 })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.025;
    root.add(shadow);

    const body = new THREE.Mesh(new THREE.ConeGeometry(0.38, 0.92, 6), playerMaterial(player, false, false));
    body.position.y = 0.47;
    root.add(body);

    const cap = new THREE.Mesh(
      new THREE.SphereGeometry(0.19, 10, 6),
      new THREE.MeshStandardMaterial({ color: 0x241a14, roughness: 0.7 })
    );
    cap.position.set(0, 1.02, -0.08);
    root.add(cap);

    const spear = new THREE.Mesh(
      new THREE.ConeGeometry(0.105, 1.65, 8),
      new THREE.MeshStandardMaterial({ color: 0x2a221b, roughness: 0.48, metalness: 0.08 })
    );
    spear.rotation.x = Math.PI / 2;
    spear.position.set(0, 0.55, 0.43);
    root.add(spear);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.56, 0.61, 28),
      ringMaterial(false, false, false)
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.035;
    root.add(ring);

    const meshes = { root, body, spear, shadow, ring };
    this.players.set(player.id, meshes);
    this.scene.add(root);
    return meshes;
  }

  private syncBursts(events: GameEvent[]): void {
    for (const event of events) {
      if (event.type !== "hit" || !event.position) continue;
      if (this.bursts.some((burst) => burst.id === event.id)) continue;
      const mesh = new THREE.Mesh(
        new THREE.RingGeometry(0.2, 0.24, 28),
        new THREE.MeshBasicMaterial({ color: 0x8a2e24, transparent: true, opacity: 0.72, side: THREE.DoubleSide })
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(event.position.x, 0.08, event.position.y);
      this.scene.add(mesh);
      this.bursts.push({ id: event.id, mesh, age: 0 });
    }
  }

  private animateBursts(): void {
    const dt = Math.min(0.05, this.clock.getDelta());
    for (let i = this.bursts.length - 1; i >= 0; i -= 1) {
      const burst = this.bursts[i];
      burst.age += dt;
      const life = burst.age / 0.52;
      burst.mesh.scale.setScalar(1 + life * 4.5);
      const material = burst.mesh.material as THREE.MeshBasicMaterial;
      material.opacity = Math.max(0, 0.72 * (1 - life));
      if (life >= 1) {
        this.scene.remove(burst.mesh);
        this.bursts.splice(i, 1);
      }
    }
  }

  private updateAim(state: GameState, localPlayerId: string, aim: TouchAim): void {
    const player = state.players.find((candidate) => candidate.id === localPlayerId);
    if (!player || !aim.active || state.phase !== "playing") {
      this.aimGroup.visible = false;
      return;
    }

    this.aimGroup.visible = true;
    this.aimGroup.position.set(player.position.x, 0.09, player.position.y);
    this.aimGroup.rotation.y = Math.atan2(aim.vector.x, aim.vector.y);
    this.aimGroup.scale.set(0.7 + aim.power * 0.7, 1, 0.8 + aim.power * 1.1);
  }

  private rebuildAimGroup(): void {
    const line = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.035, HIT_RANGE * 1.2),
      new THREE.MeshBasicMaterial({ color: 0x4a3426, transparent: true, opacity: 0.5 })
    );
    line.position.z = HIT_RANGE * 0.55;
    this.aimGroup.add(line);

    const point = new THREE.Mesh(
      new THREE.ConeGeometry(0.18, 0.42, 3),
      new THREE.MeshBasicMaterial({ color: 0x8a2e24, transparent: true, opacity: 0.72 })
    );
    point.rotation.x = Math.PI / 2;
    point.position.z = HIT_RANGE * 1.25;
    this.aimGroup.add(point);
  }
}

function playerMaterial(player: PlayerState, isLocal: boolean, stunned: boolean): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: stunned ? 0x8b8174 : new THREE.Color(player.color),
    roughness: 0.82,
    metalness: isLocal ? 0.08 : 0.03,
    emissive: isLocal ? new THREE.Color(0x241208) : new THREE.Color(0x000000),
    emissiveIntensity: isLocal ? 0.15 : 0
  });
}

function ringMaterial(isLocal: boolean, bracing: boolean, stunned: boolean): THREE.MeshBasicMaterial {
  const color = bracing ? 0x1f5037 : stunned ? 0x8a2e24 : isLocal ? 0x211914 : 0x574939;
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity: bracing ? 0.74 : 0.45, side: THREE.DoubleSide });
}

function wrapAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}
