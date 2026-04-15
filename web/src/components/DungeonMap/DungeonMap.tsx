import { useEffect, useRef, useCallback, useState } from "react";
import { Application, Container, Graphics } from "pixi.js";
import { useGameState } from "../../stores/gameState";
import type { DAGSnapshot } from "../../protocol/events";
import type { AgentState } from "../../stores/gameState";
import { computeLayout } from "./layout";
import { RoomNode } from "./RoomNode";
import { AgentSprite, setCharacterRenderer } from "./AgentSprite";
import { CharacterRenderer } from "./sprites/CharacterRenderer";
import { Corridor } from "./Corridor";
import { LootEffect } from "./LootEffect";
import { AmbientCreature, type CreatureType } from "./AmbientCreature";
import { BossEncounter, type BossType } from "./BossEncounter";
import { CompanionPet, petTypeForRole } from "./CompanionPet";
import { BlockedDoor } from "./BlockedDoor";
import { GreetingManager } from "./GreetingManager";
import { Camera } from "./Camera";
import { THEME } from "./theme";
import { Minimap } from "../Minimap/Minimap";
import { soundManager } from "../../audio/SoundManager";

export function DungeonMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const worldRef = useRef<Container | null>(null);
  const cameraRef = useRef<Camera | null>(null);
  const roomsRef = useRef(new Map<string, RoomNode>());
  const corridorsRef = useRef<Corridor[]>([]);
  const spritesRef = useRef(new Map<string, AgentSprite>());
  const lootEffectsRef = useRef<LootEffect[]>([]);
  const creaturesRef = useRef<AmbientCreature[]>([]);
  const bossesRef = useRef(new Map<string, BossEncounter>()); // agentId → boss
  const petsRef = useRef(new Map<string, CompanionPet>());    // agentId → pet
  const doorsRef = useRef(new Map<string, BlockedDoor>());    // agentId → door
  const greetingMgrRef = useRef(new GreetingManager());
  const completedAgentsRef = useRef(new Set<string>());
  const blockedAgentsRef = useRef(new Set<string>());
  const prevActionsRef = useRef(new Map<string, string>()); // agentId → last action
  const creatureSpawnCooldownRef = useRef(new Map<string, number>()); // agentId → timestamp
  const [error, setError] = useState<string | null>(null);

  const dag = useGameState((s) => s.dag);
  const agents = useGameState((s) => s.agents);
  const selectedAgent = useGameState((s) => s.selectedAgent);
  const selectAgent = useGameState((s) => s.selectAgent);

  // Initialize PixiJS — wait for container to have real dimensions
  useEffect(() => {
    if (!containerRef.current) return;
    const container: HTMLDivElement = containerRef.current;

    let cancelled = false;
    let app: Application | null = null;

    async function waitForDimensions(): Promise<void> {
      // Poll until the container has non-zero size (layout complete)
      for (let i = 0; i < 50; i++) {
        if (cancelled) return;
        if (container.clientWidth > 0 && container.clientHeight > 0) return;
        await new Promise((r) => requestAnimationFrame(r));
      }
    }

    async function setup() {
      await waitForDimensions();
      if (cancelled) return;

      const w = container.clientWidth;
      const h = container.clientHeight;
      console.log(`[CLI_DM] Container ready: ${w}x${h}`);

      try {
        app = new Application();
        await app.init({
          background: THEME.bg,
          width: w,
          height: h,
          antialias: true,
        });

        if (cancelled) {
          app.destroy(true);
          return;
        }

        // Style canvas to fill container
        app.canvas.style.width = "100%";
        app.canvas.style.height = "100%";
        container.appendChild(app.canvas);
        appRef.current = app;

        // Pre-render pixel art character textures
        const charRenderer = new CharacterRenderer(app);
        setCharacterRenderer(charRenderer);

        // Background layer for drag/zoom events
        const bgLayer = new Graphics();
        bgLayer.rect(0, 0, 8000, 8000).fill({ color: THEME.bg });
        bgLayer.position.set(-4000, -4000);
        bgLayer.eventMode = "static";
        app.stage.addChild(bgLayer);

        // World container
        const world = new Container();
        app.stage.addChild(world);
        worldRef.current = world;

        // Grid lines
        const grid = new Graphics();
        const spacing = 40;
        const gs = 2000;
        for (let x = -gs; x <= gs; x += spacing) {
          grid.moveTo(x, -gs).lineTo(x, gs).stroke({ color: THEME.gridDot, width: 0.5, alpha: 0.12 });
        }
        for (let y = -gs; y <= gs; y += spacing) {
          grid.moveTo(-gs, y).lineTo(gs, y).stroke({ color: THEME.gridDot, width: 0.5, alpha: 0.12 });
        }
        world.addChild(grid);

        // Camera
        const camera = new Camera(world, { width: w, height: h }, bgLayer);
        cameraRef.current = camera;

        // Resize
        const ro = new ResizeObserver(() => {
          if (!app || cancelled) return;
          const nw = container.clientWidth;
          const nh = container.clientHeight;
          app.renderer.resize(nw, nh);
          camera.resize(nw, nh);
        });
        ro.observe(container);

        // Ticker
        app.ticker.add((ticker) => {
          const dt = ticker.deltaTime;
          for (const room of roomsRef.current.values()) room.tick(dt);
          for (const sprite of spritesRef.current.values()) sprite.tick(dt);
          for (const corridor of corridorsRef.current) corridor.tick(dt);

          // Collect agent positions for creatures + greetings
          const agentPositions: Array<{ id: string; x: number; y: number; isIdle: boolean; isComplete: boolean }> = [];
          for (const [id, sprite] of spritesRef.current) {
            agentPositions.push({
              id,
              x: sprite.position.x,
              y: sprite.position.y,
              isIdle: sprite.currentActionPublic === "idle",
              isComplete: sprite.isCompletePublic,
            });
          }

          // Tick ambient creatures, remove dead ones
          const creatures = creaturesRef.current;
          const simplePos = agentPositions.map((a) => ({ x: a.x, y: a.y }));
          for (let i = creatures.length - 1; i >= 0; i--) {
            if (creatures[i].isDead()) {
              world.removeChild(creatures[i]);
              creatures[i].destroy();
              creatures.splice(i, 1);
            } else {
              creatures[i].tick(dt, simplePos);
            }
          }

          // Tick boss encounters, remove done ones
          for (const [id, boss] of bossesRef.current) {
            if (boss.isDone()) {
              world.removeChild(boss);
              boss.destroy();
              bossesRef.current.delete(id);
            } else {
              boss.tick(dt);
            }
          }

          // Tick companion pets
          for (const [id, pet] of petsRef.current) {
            const sprite = spritesRef.current.get(id);
            if (sprite) {
              pet.tick(dt, sprite.position.x, sprite.position.y, sprite.currentActionPublic);
            }
          }

          // Tick blocked doors, remove done ones
          for (const [id, door] of doorsRef.current) {
            if (door.isDone()) {
              world.removeChild(door);
              door.destroy();
              doorsRef.current.delete(id);
            } else {
              door.tick(dt);
            }
          }

          // Tick loot effects, remove finished ones
          const loots = lootEffectsRef.current;
          for (let i = loots.length - 1; i >= 0; i--) {
            if (loots[i].isDone()) {
              world.removeChild(loots[i]);
              loots[i].destroy();
              loots.splice(i, 1);
            } else {
              loots[i].tick(dt);
            }
          }

          // Agent greetings
          const greetings = greetingMgrRef.current.tick(dt, agentPositions);
          for (const g of greetings) {
            const sp1 = spritesRef.current.get(g.agent1Id);
            const sp2 = spritesRef.current.get(g.agent2Id);
            if (sp1) sp1.showGreeting(g.text1);
            if (sp2) sp2.showGreeting(g.text2);
          }

          camera.tick();

          const followPositions: Array<{ x: number; y: number }> = [];
          for (const sprite of spritesRef.current.values()) {
            if (sprite.alpha > 0.5) {
              followPositions.push({ x: sprite.position.x, y: sprite.position.y });
            }
          }
          camera.autoFollow(followPositions);
        });

        console.log("[CLI_DM] PixiJS running");
      } catch (err) {
        console.error("[CLI_DM] PixiJS init failed:", err);
        setError(String(err));
      }
    }

    setup();

    return () => {
      cancelled = true;
      if (app) {
        app.destroy(true, { children: true });
      }
      appRef.current = null;
      worldRef.current = null;
      cameraRef.current = null;
      roomsRef.current.clear();
      corridorsRef.current = [];
      spritesRef.current.clear();
    };
  }, []);

  // Sync DAG + agents to PixiJS objects
  const syncScene = useCallback(
    (dag: DAGSnapshot, agents: Map<string, AgentState>) => {
      const world = worldRef.current;
      if (!world) return;

      const layout = computeLayout(dag);
      const rooms = roomsRef.current;
      const sprites = spritesRef.current;
      const seen = new Set<string>();

      // Rooms
      for (const ln of layout.nodes) {
        seen.add(ln.nodeId);
        const dn = dag.nodes.find((n) => n.nodeId === ln.nodeId);
        if (!dn) continue;

        let room = rooms.get(ln.nodeId);
        if (!room) {
          room = new RoomNode(ln.nodeId, dn.label, ln.x, ln.y);
          room.on("pointertap", () => {
            if (dn.assignee) selectAgent(dn.assignee);
          });
          rooms.set(ln.nodeId, room);
          world.addChild(room);
        }
        room.position.set(ln.x - 90, ln.y - 35);
        const aa = agents.get(dn.assignee ?? "");
        room.update(dn.status, aa?.name, aa?.role);
      }
      for (const [id, r] of rooms) {
        if (!seen.has(id)) { world.removeChild(r); r.destroy(); rooms.delete(id); }
      }

      // Corridors — recreate (cheap)
      for (const c of corridorsRef.current) { world.removeChild(c); c.destroy(); }
      corridorsRef.current = [];
      for (const edge of layout.edges) {
        const c = new Corridor(edge.from, edge.to);
        const fd = dag.nodes.find((n) => n.nodeId === edge.from.nodeId);
        const td = dag.nodes.find((n) => n.nodeId === edge.to.nodeId);
        if (fd && td) c.update(fd.status, td.status, false);
        corridorsRef.current.push(c);
        world.addChildAt(c, 1);
      }

      // Helper: spawn creatures near an agent
      const spawnCreaturesNear = (x: number, y: number, count: number) => {
        const types: CreatureType[] = ["slime", "bat", "rat"];
        for (let c = 0; c < count; c++) {
          const angle = (Math.PI * 2 * c) / count + (Math.random() - 0.5);
          const dist = 30 + Math.random() * 50;
          const cx = x + Math.cos(angle) * dist;
          const cy = y + Math.sin(angle) * dist;
          const ct = types[Math.floor(Math.random() * types.length)];
          const creature = new AmbientCreature(
            ct,
            { x: cx, y: cy },
            { x: cx + (Math.random() - 0.5) * 60, y: cy + (Math.random() - 0.5) * 40 }
          );
          creaturesRef.current.push(creature);
          world.addChildAt(creature, 2);
        }
      };

      const CREATURE_COOLDOWN = 5000; // 5s between spawns per agent
      const now = Date.now();

      // Agent sprites
      const seenA = new Set<string>();
      for (const agent of agents.values()) {
        seenA.add(agent.agentId);
        let sp = sprites.get(agent.agentId);
        if (!sp) {
          sp = new AgentSprite(agent.agentId, agent.role);
          sp.on("pointertap", () => selectAgent(agent.agentId));
          sprites.set(agent.agentId, sp);
          world.addChild(sp);

          // Create companion pet for this agent
          const pet = new CompanionPet(petTypeForRole(agent.role));
          petsRef.current.set(agent.agentId, pet);
          world.addChild(pet);
        }
        sp.setName(agent.name);
        sp.update(agent.currentAction, agent.isBlocked ?? false, agent.isComplete ?? false, agent.currentDetail);

        // Spawn loot effect when agent newly completes
        if (agent.isComplete && !completedAgentsRef.current.has(agent.agentId)) {
          completedAgentsRef.current.add(agent.agentId);
          const loot = new LootEffect(sp.position.x, sp.position.y, sp.role);
          world.addChild(loot);
          lootEffectsRef.current.push(loot);
          soundManager.playLoot();
        }

        // Detect action transitions for spawning
        const prevAction = prevActionsRef.current.get(agent.agentId) ?? "idle";
        const curAction = agent.currentAction;
        const lastSpawn = creatureSpawnCooldownRef.current.get(agent.agentId) ?? 0;
        const canSpawn = now - lastSpawn > CREATURE_COOLDOWN;

        if (curAction !== prevAction && canSpawn) {
          prevActionsRef.current.set(agent.agentId, curAction);

          // Reading/searching → small creatures (exploring, encountering complexity)
          if (curAction === "read") {
            spawnCreaturesNear(sp.position.x, sp.position.y, 1 + Math.floor(Math.random() * 2));
            creatureSpawnCooldownRef.current.set(agent.agentId, now);
          }

          // Thinking → a creature or two (wrestling with the problem)
          if (curAction === "thinking") {
            spawnCreaturesNear(sp.position.x, sp.position.y, 1);
            creatureSpawnCooldownRef.current.set(agent.agentId, now);
          }

          // Testing → boss encounter (test suite is the enemy)
          if (curAction === "test" && !bossesRef.current.has(agent.agentId)) {
            const boss = new BossEncounter(sp.position.x + 50, sp.position.y, "skeleton");
            bossesRef.current.set(agent.agentId, boss);
            world.addChild(boss);
            spawnCreaturesNear(sp.position.x, sp.position.y, 2);
            creatureSpawnCooldownRef.current.set(agent.agentId, now);
          }

          // Building → boss encounter (build challenge)
          if (curAction === "build" && !bossesRef.current.has(agent.agentId)) {
            const boss = new BossEncounter(sp.position.x + 50, sp.position.y, "golem");
            bossesRef.current.set(agent.agentId, boss);
            world.addChild(boss);
            creatureSpawnCooldownRef.current.set(agent.agentId, now);
          }

          // Git → creatures scatter (version control chaos)
          if (curAction === "git") {
            spawnCreaturesNear(sp.position.x, sp.position.y, 2);
            creatureSpawnCooldownRef.current.set(agent.agentId, now);
          }

          // Shell → a creature (running commands in the wild)
          if (curAction === "shell") {
            spawnCreaturesNear(sp.position.x, sp.position.y, 1);
            creatureSpawnCooldownRef.current.set(agent.agentId, now);
          }

          // Edit → a creature (modifying code, something stirs)
          if (curAction === "edit") {
            spawnCreaturesNear(sp.position.x, sp.position.y, 1);
            creatureSpawnCooldownRef.current.set(agent.agentId, now);
          }

          // Test/build ended (went idle or to another action) → resolve boss
          if ((prevAction === "test" || prevAction === "build") &&
              curAction !== "test" && curAction !== "build") {
            const boss = bossesRef.current.get(agent.agentId);
            if (boss && !agent.isBlocked) boss.resolve();
          }
        } else {
          prevActionsRef.current.set(agent.agentId, curAction);
        }

        // Boss encounter on blocker (keep existing logic)
        const isBlocked = agent.isBlocked ?? false;
        const wasBlocked = blockedAgentsRef.current.has(agent.agentId);
        if (isBlocked && !wasBlocked) {
          blockedAgentsRef.current.add(agent.agentId);
          const detail = (agent.currentDetail ?? "").toLowerCase();
          let bossType: BossType = "skeleton";
          if (detail.includes("conflict") || detail.includes("merge")) bossType = "golem";
          else if (detail.includes("blocked") || detail.includes("waiting") || detail.includes("dependency")) bossType = "dragon";

          // Only spawn if no boss already active
          if (!bossesRef.current.has(agent.agentId)) {
            const boss = new BossEncounter(sp.position.x + 50, sp.position.y, bossType);
            bossesRef.current.set(agent.agentId, boss);
            world.addChild(boss);
          }

          // Spawn blocked door
          const dn = dag.nodes.find((n) => n.assignee === agent.agentId);
          if (dn) {
            const incomingEdge = layout.edges.find((e) => e.to.nodeId === dn.nodeId);
            if (incomingEdge) {
              const midX = (incomingEdge.from.x + incomingEdge.to.x) / 2;
              const midY = (incomingEdge.from.y + incomingEdge.to.y) / 2;
              const angle = Math.atan2(incomingEdge.to.y - incomingEdge.from.y, incomingEdge.to.x - incomingEdge.from.x);
              const door = new BlockedDoor(midX, midY, angle);
              doorsRef.current.set(agent.agentId, door);
              world.addChild(door);
            }
          }

          spawnCreaturesNear(sp.position.x, sp.position.y, 3);
        } else if (!isBlocked && wasBlocked) {
          blockedAgentsRef.current.delete(agent.agentId);
          const boss = bossesRef.current.get(agent.agentId);
          if (boss) boss.resolve();
          const door = doorsRef.current.get(agent.agentId);
          if (door) door.open();
        }

        // Error → spawn boss if none active
        if (curAction === "error" && !bossesRef.current.has(agent.agentId) && canSpawn) {
          const boss = new BossEncounter(sp.position.x + 50, sp.position.y, "dragon");
          bossesRef.current.set(agent.agentId, boss);
          world.addChild(boss);
          spawnCreaturesNear(sp.position.x, sp.position.y, 3);
          creatureSpawnCooldownRef.current.set(agent.agentId, now);
        }

        const dn = dag.nodes.find((n) => n.assignee === agent.agentId);
        if (dn) {
          const ln = layout.nodes.find((n) => n.nodeId === dn.nodeId);
          if (ln) sp.moveTo(ln.x, ln.y);
        }
      }
      for (const [id, sp] of sprites) {
        if (!seenA.has(id)) {
          world.removeChild(sp);
          sp.destroy();
          sprites.delete(id);
          const pet = petsRef.current.get(id);
          if (pet) { world.removeChild(pet); pet.destroy(); petsRef.current.delete(id); }
        }
      }
    },
    [selectAgent]
  );

  useEffect(() => { syncScene(dag, agents); }, [dag, agents, syncScene]);

  const handleMinimapClick = useCallback(
    (worldX: number, worldY: number) => {
      const camera = cameraRef.current;
      if (camera) {
        camera.focusOn(worldX, worldY, true);
      }
    },
    []
  );

  // Cross-highlighting
  useEffect(() => {
    for (const room of roomsRef.current.values()) {
      const dn = dag.nodes.find((n) => n.nodeId === room.nodeId);
      room.highlight(dn?.assignee === selectedAgent);
    }
  }, [selectedAgent, dag]);

  if (error) {
    return (
      <div style={{ padding: 20, color: "#bf6b5b", fontFamily: "monospace", fontSize: 13 }}>
        <div>PixiJS failed to initialize:</div>
        <pre style={{ marginTop: 8, color: "#8b9aab" }}>{error}</pre>
      </div>
    );
  }

  return (
    <div style={{ width: "100%", height: "100%", overflow: "hidden", position: "relative" }}>
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
      <Minimap
        dag={dag}
        agents={agents}
        camera={cameraRef.current}
        onClickWorld={handleMinimapClick}
      />
    </div>
  );
}
