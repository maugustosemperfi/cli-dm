import { useEffect, useRef, useCallback, useState } from "react";
import { Application, Container, Graphics } from "pixi.js";
import { useGameState } from "../../stores/gameState";
import type { DAGSnapshot } from "../../protocol/events";
import type { AgentState } from "../../stores/gameState";
import { computeLayout, type NodeWeight } from "./layout";
import { RoomNode } from "./RoomNode";
import { AgentSprite, setCharacterRenderer } from "./AgentSprite";
import { CharacterRenderer } from "./sprites/CharacterRenderer";
import { Corridor } from "./Corridor";
import { LootEffect } from "./LootEffect";
import { AmbientCreature, type CreatureType } from "./AmbientCreature";
import { BossEncounter, type BossType, BOSS_DATA_TO_VISUAL } from "./BossEncounter";
import { CompanionPet, petTypeForRole } from "./CompanionPet";
import { BlockedDoor } from "./BlockedDoor";
import { DiscoveryDoor } from "./DiscoveryDoor";
import { TorchLight } from "./TorchLight";
import { DayNightCycle } from "./DayNightCycle";
import { FogOfWar } from "./FogOfWar";
import { AchievementBanner, type AchievementType } from "./AchievementBanner";
import { GreetingManager } from "./GreetingManager";
import { Camera } from "./Camera";
import { THEME } from "./theme";
import { Minimap } from "../Minimap/Minimap";
import { soundManager } from "../../audio/SoundManager";
import { SpawnLink } from "./SpawnLink";
import { LayerControls } from "./LayerControls";

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
  const discoveryDoorsRef = useRef(new Map<string, DiscoveryDoor[]>()); // agentId → doors
  const prevDiscoveryCountRef = useRef(new Map<string, number>());
  const torchesRef = useRef<TorchLight[]>([]);
  const dayNightRef = useRef<DayNightCycle | null>(null);
  const fogRef = useRef<FogOfWar | null>(null);
  const bannersRef = useRef<AchievementBanner[]>([]);
  const checkedAchievementsRef = useRef(new Map<string, Set<string>>());
  const greetingMgrRef = useRef(new GreetingManager());
  const completedAgentsRef = useRef(new Map<string, number>()); // agentId → completion timestamp
  const blockedAgentsRef = useRef(new Set<string>());
  const prevActionsRef = useRef(new Map<string, string>()); // agentId → last action
  const creatureSpawnCooldownRef = useRef(new Map<string, number>()); // agentId → timestamp
  const spawnLinksRef = useRef(new Map<string, SpawnLink>());
  const prevNodeIdsRef = useRef(new Set<string>());
  const [error, setError] = useState<string | null>(null);

  const dag = useGameState((s) => s.dag);
  const agents = useGameState((s) => s.agents);
  const selectedAgent = useGameState((s) => s.selectedAgent);
  const selectAgent = useGameState((s) => s.selectAgent);
  const toolFlows = useGameState((s) => s.toolFlows);
  const errorPropagations = useGameState((s) => s.errorPropagations);
  const activeLayer = useGameState((s) => s.activeLayer);
  const roomMetrics = useGameState((s) => s.roomMetrics);
  const roomHistory = useGameState((s) => s.roomHistory);
  const burnRates = useGameState((s) => s.burnRates);

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

        // Fog of war layer (above grid, below rooms/corridors)
        const fog = new FogOfWar();
        world.addChild(fog);
        fogRef.current = fog;

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

        // Day/Night cycle overlay (topmost world layer)
        const dayNight = new DayNightCycle(w, h);
        world.addChild(dayNight);
        dayNightRef.current = dayNight;

        // Ticker
        app.ticker.add((ticker) => {
          const dt = ticker.deltaTime;
          for (const room of roomsRef.current.values()) room.tick(dt);
          for (const sprite of spritesRef.current.values()) sprite.tick(dt);
          for (const corridor of corridorsRef.current) corridor.tick(dt);
          for (const link of spawnLinksRef.current.values()) link.tick(dt);

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

          // Tick boss encounters, sync from store, remove done ones
          const storeBosses = useGameState.getState().bosses;
          for (const [id, boss] of bossesRef.current) {
            if (boss.isDone()) {
              world.removeChild(boss);
              boss.destroy();
              bossesRef.current.delete(id);
            } else {
              // Sync data-driven boss visuals from store
              const dataType = boss.getDataType();
              if (dataType) {
                for (const sb of storeBosses.values()) {
                  if (sb.bossType === dataType && sb.agentId === id) {
                    boss.updateFromBossState(sb);
                    break;
                  }
                }
              }
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

          // Tick discovery doors, remove done ones
          for (const [agentId, doors] of discoveryDoorsRef.current) {
            for (let i = doors.length - 1; i >= 0; i--) {
              if (doors[i].isDone()) {
                world.removeChild(doors[i]);
                doors[i].destroy();
                doors.splice(i, 1);
              } else {
                doors[i].tick(dt);
              }
            }
            if (doors.length === 0) discoveryDoorsRef.current.delete(agentId);
          }

          // Tick torches
          for (const torch of torchesRef.current) torch.tick(dt);

          // Day/Night cycle + update torch glow
          const dayNight = dayNightRef.current;
          if (dayNight) {
            dayNight.tick(dt);
            const nightMult = dayNight.getNightMultiplier();
            for (const torch of torchesRef.current) torch.setNightMultiplier(nightMult);
          }

          // Tick fog of war
          if (fogRef.current) fogRef.current.tick(dt);

          // Tick achievement banners, remove done ones
          const banners = bannersRef.current;
          for (let i = banners.length - 1; i >= 0; i--) {
            if (banners[i].isDone()) {
              world.removeChild(banners[i]);
              banners[i].destroy();
              banners.splice(i, 1);
            } else {
              banners[i].tick(dt);
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

          // Zoom-to-volume: feed camera zoom level to sound manager
          const vp = camera.getViewport();
          soundManager.setZoomVolume(vp.scale);

          // Day/night: feed to sound manager
          if (dayNightRef.current) {
            soundManager.setDayNight(dayNightRef.current.isNight());
          }

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
      for (const t of torchesRef.current) t.destroy();
      torchesRef.current = [];
      if (dayNightRef.current) { dayNightRef.current.destroy(); dayNightRef.current = null; }
      if (fogRef.current) { fogRef.current.destroy(); fogRef.current = null; }
      for (const b of bannersRef.current) b.destroy();
      bannersRef.current = [];
      for (const link of spawnLinksRef.current.values()) link.destroy();
      spawnLinksRef.current.clear();
    };
  }, []);

  // Sync DAG + agents to PixiJS objects
  const syncScene = useCallback(
    (dag: DAGSnapshot, agents: Map<string, AgentState>) => {
      const world = worldRef.current;
      if (!world) return;

      // Build weight hints from room metrics for organic sizing
      const nodeWeights: NodeWeight[] = [];
      if (roomMetrics.size > 0) {
        let maxTokens = 1;
        for (const m of roomMetrics.values()) maxTokens = Math.max(maxTokens, m.totalTokens);
        for (const [nodeId, m] of roomMetrics) {
          nodeWeights.push({ nodeId, weight: Math.min(1, m.totalTokens / maxTokens) });
        }
      }

      const layout = computeLayout(dag, nodeWeights, prevNodeIdsRef.current);

      // Update prevNodeIds for next frame's new-node detection
      const currentNodeIds = new Set<string>();
      for (const ln of layout.nodes) currentNodeIds.add(ln.nodeId);
      prevNodeIdsRef.current = currentNodeIds;

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
          // Growth animation for new rooms
          if (ln.isNew) {
            room.alpha = 0;
            room.scale.set(0.3);
          }
        }
        room.position.set(ln.x - 90, ln.y - 35);
        // Organic scale — lerp toward target for smooth transitions
        const targetScale = ln.scale;
        const curScale = room.scale.x;
        const newScale = curScale + (targetScale - curScale) * 0.08;
        room.scale.set(newScale);
        // Growth fade-in
        if (room.alpha < 1) {
          room.alpha = Math.min(1, room.alpha + 0.04);
        }
        const aa = agents.get(dn.assignee ?? "");
        room.update(dn.status, aa?.name, aa?.role, aa?.currentAction);
        // Building tier from agent level
        if (aa) {
          const tier = aa.level >= 8 ? 4 : aa.level >= 5 ? 3 : aa.level >= 3 ? 2 : 1;
          room.setTier(tier);
        }
        // File attention heatmap — rooms glow by agent activity
        room.setHeat(aa?.activityHeat ?? 0);

        // Context-sensitive decorations
        const rh = roomHistory.get(ln.nodeId);
        if (rh) room.updateDecorations(rh);

        // Error propagation fire — rooms glow red when errors cascade
        for (const prop of errorPropagations) {
          if (prop.intensity < 0.05) continue;
          if (prop.affectedNodes.includes(ln.nodeId)) {
            const isSource = prop.sourceNodeId === ln.nodeId;
            room.setFire(isSource ? prop.intensity : prop.intensity * 0.5);
          }
        }
      }
      for (const [id, r] of rooms) {
        if (!seen.has(id)) { world.removeChild(r); r.destroy(); rooms.delete(id); }
      }

      // Corridors — recreate (cheap)
      for (const c of corridorsRef.current) { world.removeChild(c); c.destroy(); }
      corridorsRef.current = [];
      const corridorMap = new Map<string, Corridor>(); // "from:to" → corridor
      const connectedPairs = new Set<string>(); // track which node pairs have corridors

      // DAG-edge corridors
      for (const edge of layout.edges) {
        const c = new Corridor(edge.from, edge.to);
        const fd = dag.nodes.find((n) => n.nodeId === edge.from.nodeId);
        const td = dag.nodes.find((n) => n.nodeId === edge.to.nodeId);
        if (fd && td) c.update(fd.status, td.status, false);
        corridorsRef.current.push(c);
        corridorMap.set(`${edge.from.nodeId}:${edge.to.nodeId}`, c);
        corridorMap.set(`${edge.to.nodeId}:${edge.from.nodeId}`, c);
        connectedPairs.add(`${edge.from.nodeId}:${edge.to.nodeId}`);
        connectedPairs.add(`${edge.to.nodeId}:${edge.from.nodeId}`);
        world.addChildAt(c, 1);
      }

      // Grid-adjacency corridors — connect 4-directional neighbors
      const gridLookup = new Map<string, typeof layout.nodes[0]>();
      for (const ln of layout.nodes) {
        gridLookup.set(`${ln.gridCol},${ln.gridRow}`, ln);
      }
      const directions: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (const ln of layout.nodes) {
        for (const [dc, dr] of directions) {
          const neighbor = gridLookup.get(`${ln.gridCol + dc},${ln.gridRow + dr}`);
          if (!neighbor) continue;
          const key = `${ln.nodeId}:${neighbor.nodeId}`;
          if (connectedPairs.has(key)) continue;
          const c = new Corridor(ln, neighbor);
          corridorsRef.current.push(c);
          corridorMap.set(key, c);
          corridorMap.set(`${neighbor.nodeId}:${ln.nodeId}`, c);
          connectedPairs.add(key);
          connectedPairs.add(`${neighbor.nodeId}:${ln.nodeId}`);
          world.addChildAt(c, 1);
        }
      }

      // Place torches on corridors (2 per corridor at 25%/75% spine)
      for (const t of torchesRef.current) { world.removeChild(t); t.destroy(); }
      torchesRef.current = [];
      for (const corridor of corridorsRef.current) {
        const STEPS = 24; // matches SPINE_STEPS in Corridor
        for (const pct of [0.25, 0.75]) {
          const idx = Math.floor(STEPS * pct);
          const pt = corridor.getSpinePoint(idx);
          const nm = corridor.getNormal(idx);
          if (pt && nm) {
            const t1 = new TorchLight(pt[0] + nm[0] * 22, pt[1] + nm[1] * 22, false);
            const t2 = new TorchLight(pt[0] - nm[0] * 22, pt[1] - nm[1] * 22, true);
            torchesRef.current.push(t1, t2);
            world.addChildAt(t1, 2);
            world.addChildAt(t2, 2);
          }
        }
      }

      // Update fog of war
      const fog = fogRef.current;
      if (fog) {
        for (const ln of layout.nodes) fog.setCell(ln.nodeId, ln.x, ln.y);
        const allVisited = new Set<string>();
        for (const agent of agents.values()) {
          if (agent.visitedRooms) {
            for (const roomId of agent.visitedRooms) allVisited.add(roomId);
          }
        }
        const adjacency = new Map<string, string[]>();
        for (const ln of layout.nodes) adjacency.set(ln.nodeId, []);
        for (const key of connectedPairs) {
          const [a, b] = key.split(":");
          adjacency.get(a)?.push(b);
        }
        fog.updateVisibility(allVisited, adjacency);
      }

      // Apply tool flows to corridors — recent flows light up
      const flowCutoff = Date.now() - 10000; // last 10s
      for (const flow of toolFlows) {
        if (flow.ts < flowCutoff) continue;
        const key = `${flow.fromNodeId}:${flow.toNodeId}`;
        const c = corridorMap.get(key);
        if (c) c.addFlow(flow.agentRole);
      }

      // Apply error propagation fire to corridors
      for (const prop of errorPropagations) {
        if (prop.intensity < 0.05) continue;
        for (let i = 0; i < prop.affectedNodes.length - 1; i++) {
          const key = `${prop.affectedNodes[i]}:${prop.affectedNodes[i + 1]}`;
          const c = corridorMap.get(key);
          if (c) c.ignite(prop.intensity);
          // Also ignite from source to each affected
          if (prop.sourceNodeId) {
            const sKey = `${prop.sourceNodeId}:${prop.affectedNodes[i]}`;
            const sc = corridorMap.get(sKey);
            if (sc) sc.ignite(prop.intensity * 0.7);
          }
        }
      }

      // Apply token burn rate visualization to corridors
      {
        // Total tokens across all nodes for bottleneck detection
        let totalTokensAll = 0;
        for (const br of burnRates.values()) totalTokensAll += br.totalTokens;
        const tokenFlowCutoff = Date.now() - 5000; // last 5s

        for (const corridor of corridorsRef.current) {
          const fromId = corridor.fromNode.nodeId;
          const toId = corridor.toNode.nodeId;
          const fromBurn = burnRates.get(fromId);
          const toBurn = burnRates.get(toId);

          // Burn intensity = max rate of connected nodes
          const maxRate = Math.max(fromBurn?.ratePerMin ?? 0, toBurn?.ratePerMin ?? 0);
          corridor.setBurnIntensity(maxRate);

          // Bottleneck = if either node has >50% of total tokens
          if (totalTokensAll > 0) {
            const fromRatio = (fromBurn?.totalTokens ?? 0) / totalTokensAll;
            const toRatio = (toBurn?.totalTokens ?? 0) / totalTokensAll;
            corridor.setBottleneck(Math.max(fromRatio, toRatio));
          }

          // Spawn token particles for recent activity
          for (const burn of [fromBurn, toBurn]) {
            if (!burn) continue;
            const recentTokens = burn.tokenHistory
              .filter((h) => h.ts >= tokenFlowCutoff)
              .reduce((s, h) => s + h.tokens, 0);
            if (recentTokens > 0) {
              corridor.addTokenFlow(recentTokens);
            }
          }
        }
      }

      // Apply cost display to rooms
      for (const [nodeId, room] of rooms) {
        const br = burnRates.get(nodeId);
        if (br) {
          room.setCostDisplay(br.totalTokens, br.totalCostUSD);
        }
      }

      // Apply map layer overlays to rooms and corridors
      {
        // Compute max values for normalization
        let maxTokens = 0;
        let maxErrors = 0;
        for (const m of roomMetrics.values()) {
          if (m.totalTokens > maxTokens) maxTokens = m.totalTokens;
          if (m.errorCount > maxErrors) maxErrors = m.errorCount;
        }
        // Ensure at least 1 to avoid division by zero
        if (maxTokens === 0) maxTokens = 1;
        if (maxErrors === 0) maxErrors = 1;

        for (const [nodeId, room] of rooms) {
          const metrics = roomMetrics.get(nodeId) ?? null;
          room.setOverlay(activeLayer, metrics, maxTokens, maxErrors);
        }

        for (const corridor of corridorsRef.current) {
          const fromMetrics = roomMetrics.get(corridor.fromNode.nodeId) ?? null;
          const toMetrics = roomMetrics.get(corridor.toNode.nodeId) ?? null;
          corridor.setOverlay(activeLayer, fromMetrics, toMetrics, maxTokens, maxErrors);
        }
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
        sp.setCost(agent.gold);
        // Dim agents that have never been active or haven't acted for 30+ seconds
        const IDLE_THRESHOLD = 30_000;
        sp.setTrulyIdle(agent.lastActiveTs === 0 || (now - agent.lastActiveTs) > IDLE_THRESHOLD);
        sp.setLastEventTime(agent.lastActiveTs);

        // Detect level-up
        if (agent.level > agent.prevLevel) {
          sp.triggerLevelUp(agent.level);
        }

        // Sync agent class from behavior profile
        if (agent.actionProfile && sp.getAgentClass() !== agent.actionProfile.classType) {
          sp.setAgentClass(agent.actionProfile.classType);
        }

        // Spawn loot effect when agent newly completes
        if (agent.isComplete && !completedAgentsRef.current.has(agent.agentId)) {
          completedAgentsRef.current.set(agent.agentId, now);
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

          // Testing → boss encounter (Test Hydra)
          if (curAction === "test" && !bossesRef.current.has(agent.agentId)) {
            const boss = new BossEncounter(sp.position.x + 50, sp.position.y, BOSS_DATA_TO_VISUAL['test_hydra']);
            boss.setDataType('test_hydra');
            bossesRef.current.set(agent.agentId, boss);
            world.addChild(boss);
            spawnCreaturesNear(sp.position.x, sp.position.y, 2);
            creatureSpawnCooldownRef.current.set(agent.agentId, now);
          }

          // Building → boss encounter (Forge Golem)
          if (curAction === "build" && !bossesRef.current.has(agent.agentId)) {
            const boss = new BossEncounter(sp.position.x + 50, sp.position.y, BOSS_DATA_TO_VISUAL['forge_golem']);
            boss.setDataType('forge_golem');
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
            boss.setDataType('gate_keeper');
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

        // Discovery doors — spawn when agent discovers a new directory
        const prevDiscCount = prevDiscoveryCountRef.current.get(agent.agentId) ?? 0;
        if (agent.discoveredPathCount > prevDiscCount) {
          prevDiscoveryCountRef.current.set(agent.agentId, agent.discoveredPathCount);

          const agentDn = dag.nodes.find((n) => n.assignee === agent.agentId);
          if (agentDn) {
            // Pick a neighbor corridor to place the door on
            for (const key of connectedPairs) {
              const [fromId, toId] = key.split(":");
              if (fromId !== agentDn.nodeId) continue;
              const fromLn = layout.nodes.find((n) => n.nodeId === fromId);
              const toLn = layout.nodes.find((n) => n.nodeId === toId);
              if (!fromLn || !toLn) continue;

              const midX = (fromLn.x + toLn.x) / 2;
              const midY = (fromLn.y + toLn.y) / 2;
              const angle = Math.atan2(toLn.y - fromLn.y, toLn.x - fromLn.x);
              const dirName = agent.lastDiscoveredPath ?? "unknown";
              const door = new DiscoveryDoor(midX, midY, angle, dirName);

              let agentDoors = discoveryDoorsRef.current.get(agent.agentId);
              if (!agentDoors) {
                agentDoors = [];
                discoveryDoorsRef.current.set(agent.agentId, agentDoors);
              }

              // Cap at 3 doors — force-fade oldest when 4th spawns
              while (agentDoors.length >= 3) {
                const oldest = agentDoors.shift()!;
                oldest.forceFade();
              }

              agentDoors.push(door);
              world.addChild(door);
              break; // one door per discovery event
            }
          }
        }

        // Achievement checks
        const earned = checkedAchievementsRef.current.get(agent.agentId) ?? new Set<string>();
        const checkAchievement = (type: AchievementType, condition: boolean) => {
          if (condition && !earned.has(type)) {
            earned.add(type);
            const banner = new AchievementBanner(sp.position.x, sp.position.y, type);
            bannersRef.current.push(banner);
            world.addChild(banner);
            soundManager.playAchievement();
          }
        };
        checkAchievement("first_edit", agent.totalEdits >= 1);
        checkAchievement("first_build", agent.totalBuilds >= 1);
        checkAchievement("first_test", agent.totalTests >= 1);
        checkAchievement("level_5", agent.level >= 5);
        checkAchievement("level_10", agent.level >= 10);
        checkAchievement("explorer_10", agent.discoveredPathCount >= 10);
        checkAchievement("explorer_25", agent.discoveredPathCount >= 25);
        checkAchievement("error_survivor", (agent.errorCount ?? 0) >= 5 && !agent.isComplete);
        checkedAchievementsRef.current.set(agent.agentId, earned);

        const dn = dag.nodes.find((n) => n.assignee === agent.agentId);
        if (dn) {
          const ln = layout.nodes.find((n) => n.nodeId === dn.nodeId);
          if (ln) {
            // Check if agent moved to a different room — walk along corridor
            const prevNode = prevActionsRef.current.get("node:" + agent.agentId);
            if (prevNode && prevNode !== dn.nodeId) {
              const prevLn = layout.nodes.find((n) => n.nodeId === prevNode);
              if (prevLn) {
                // Build bezier waypoints from old room to new room
                const waypoints: Array<[number, number]> = [];
                const steps = 20;
                const x1 = prevLn.x;
                const y1 = prevLn.y;
                const x2 = ln.x;
                const y2 = ln.y;
                const midX = (x1 + x2) / 2;
                for (let i = 0; i <= steps; i++) {
                  const t = i / steps;
                  const u = 1 - t;
                  const px = u * u * u * x1 + 3 * u * u * t * midX + 3 * u * t * t * midX + t * t * t * x2;
                  const py = u * u * u * y1 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y2;
                  waypoints.push([px, py]);
                }
                sp.setWanderPath(waypoints);
              }
            }
            prevActionsRef.current.set("node:" + agent.agentId, dn.nodeId);

            // Tell agent about neighboring rooms it can wander to
            // Include both DAG edges AND proximity corridors
            const neighborNodes: Array<{ nodeId: string; x: number; y: number }> = [];
            const addedNeighbors = new Set<string>();
            for (const key of connectedPairs) {
              const [fromId, toId] = key.split(":");
              let neighborId: string | null = null;
              if (fromId === dn.nodeId) neighborId = toId;
              if (toId === dn.nodeId) neighborId = fromId;
              if (neighborId && !addedNeighbors.has(neighborId)) {
                const nln = layout.nodes.find((n) => n.nodeId === neighborId);
                if (nln) {
                  neighborNodes.push({ nodeId: neighborId, x: nln.x, y: nln.y });
                  addedNeighbors.add(neighborId);
                }
              }
            }
            sp.setNeighbors(neighborNodes);

            sp.moveTo(ln.x, ln.y);
          }
        } else {
          // No DAG node — subagent. Spawn inside parent's room.
          // Subagent IDs use "parentId:name" format (e.g. "t1:researcher")
          // or "parentId.N" format for multi-session agents.
          const colonIdx = agent.agentId.indexOf(":");
          const parentId = colonIdx > 0
            ? agent.agentId.substring(0, colonIdx)
            : null;
          if (parentId) {
            // Find parent's DAG node and position there with a small offset
            const parentDn = dag.nodes.find((n) => n.assignee === parentId);
            if (parentDn) {
              const parentLn = layout.nodes.find((n) => n.nodeId === parentDn.nodeId);
              if (parentLn) {
                // Offset slightly so subagents don't stack exactly on the parent
                const hash = agent.agentId.split("").reduce((h, c) => h * 31 + c.charCodeAt(0), 0);
                const angle = (hash % 360) * (Math.PI / 180);
                const offsetDist = 20 + (hash % 30);
                sp.moveTo(
                  parentLn.x + Math.cos(angle) * offsetDist,
                  parentLn.y + Math.sin(angle) * offsetDist,
                );
                // Share parent's neighbors so subagent can wander the same corridors
                const neighborNodes: Array<{ nodeId: string; x: number; y: number }> = [];
                const addedNeighbors = new Set<string>();
                for (const key of connectedPairs) {
                  const [fromId, toId] = key.split(":");
                  let neighborId: string | null = null;
                  if (fromId === parentDn.nodeId) neighborId = toId;
                  if (toId === parentDn.nodeId) neighborId = fromId;
                  if (neighborId && !addedNeighbors.has(neighborId)) {
                    const nln = layout.nodes.find((n) => n.nodeId === neighborId);
                    if (nln) {
                      neighborNodes.push({ nodeId: neighborId, x: nln.x, y: nln.y });
                      addedNeighbors.add(neighborId);
                    }
                  }
                }
                sp.setNeighbors(neighborNodes);

                // Create/update spawn link from parent to child
                const parentSprite = sprites.get(parentId);
                if (parentSprite && sp) {
                  let link = spawnLinksRef.current.get(agent.agentId);
                  if (!link) {
                    link = new SpawnLink(
                      parentSprite.position.x, parentSprite.position.y,
                      sp.position.x, sp.position.y,
                      agent.role
                    );
                    spawnLinksRef.current.set(agent.agentId, link);
                    world.addChildAt(link, 1); // corridor layer
                  }
                  link.updatePositions(
                    parentSprite.position.x, parentSprite.position.y,
                    sp.position.x, sp.position.y
                  );
                }
              }
            }
          }
        }
      }
      // Remove completed agents after 10 seconds
      const REMOVE_AFTER = 10_000;
      for (const [id, completedAt] of completedAgentsRef.current) {
        if (now - completedAt > REMOVE_AFTER) {
          seenA.delete(id); // force removal below
          completedAgentsRef.current.delete(id);
        }
      }
      for (const [id, sp] of sprites) {
        if (!seenA.has(id)) {
          world.removeChild(sp);
          sp.destroy();
          sprites.delete(id);
          const pet = petsRef.current.get(id);
          if (pet) { world.removeChild(pet); pet.destroy(); petsRef.current.delete(id); }
          const link = spawnLinksRef.current.get(id);
          if (link) { world.removeChild(link); link.destroy(); spawnLinksRef.current.delete(id); }
        }
      }
    },
    [selectAgent, toolFlows, errorPropagations, activeLayer, roomMetrics, burnRates, roomHistory]
  );

  useEffect(() => {
    syncScene(dag, agents);
    // Debug: log agent states to console
    const summary = [...agents.entries()].map(([_id, a]) =>
      `${a.name.padEnd(20)} | action=${a.currentAction.padEnd(10)} | lastActive=${a.lastActiveTs} | complete=${a.isComplete}`
    ).join('\n');
    if (agents.size > 0) console.log('[CLI_DM] Agent states:\n' + summary);
  }, [dag, agents, syncScene]);

  const handleMinimapClick = useCallback(
    (worldX: number, worldY: number) => {
      const camera = cameraRef.current;
      if (camera) {
        camera.focusOn(worldX, worldY, true);
      }
    },
    []
  );

  // Listen for focusNodeId and pan camera to the room
  const focusNodeId = useGameState((s) => s.focusNodeId);
  const focusOnNode = useGameState((s) => s.focusOnNode);
  useEffect(() => {
    if (!focusNodeId) return;
    const room = roomsRef.current.get(focusNodeId);
    const camera = cameraRef.current;
    if (room && camera) {
      camera.focusOn(room.position.x + 90, room.position.y + 35, true);
    }
    focusOnNode(null); // clear after handling
  }, [focusNodeId, focusOnNode]);

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
      <LayerControls />
      <Minimap
        dag={dag}
        agents={agents}
        camera={cameraRef.current}
        roomMetrics={roomMetrics}
        onClickWorld={handleMinimapClick}
      />
    </div>
  );
}
