import type { Container } from "pixi.js";
import type { DAGSnapshot } from "../../../../protocol/events";
import type { AgentState } from "../../../../stores/gameState";
import { useGameState } from "../../../../stores/gameState";
import { soundManager } from "../../../../audio/SoundManager";
import { AgentSprite } from "../../AgentSprite";
import { LootEffect } from "../../LootEffect";
import { AmbientCreature, type CreatureType } from "../../AmbientCreature";
import { BossEncounter, type BossType, BOSS_DATA_TO_VISUAL } from "../../BossEncounter";
import { CompanionPet, petTypeForRole } from "../../CompanionPet";
import { BlockedDoor } from "../../BlockedDoor";
import { DiscoveryDoor } from "../../DiscoveryDoor";
import { AchievementBanner, type AchievementType } from "../../AchievementBanner";
import { SpawnLink } from "../../SpawnLink";
import { Z } from "../constants";
import type { SceneRefs } from "../sceneRefs";
import type { LayoutResult } from "../../layout";
import type { CorridorGraph } from "./syncSelection";

/** Golden-angle spiral so many subagents fan out instead of stacking. */
function subagentPosition(
  parentX: number,
  parentY: number,
  siblingIndex: number,
  agentId: string,
): [number, number] {
  if (siblingIndex <= 0) {
    const hash = agentId.split("").reduce((h, c) => h * 31 + c.charCodeAt(0), 0);
    const angle = (hash % 360) * (Math.PI / 180);
    const dist = 32 + (hash % 18);
    return [parentX + Math.cos(angle) * dist, parentY + Math.sin(angle) * dist];
  }
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const angle = siblingIndex * goldenAngle;
  const dist = 40 + Math.sqrt(siblingIndex) * 28;
  return [parentX + Math.cos(angle) * dist, parentY + Math.sin(angle) * dist];
}

function groupSubagentsByParent(agents: Map<string, AgentState>): Map<string, string[]> {
  const byParent = new Map<string, string[]>();
  for (const agent of agents.values()) {
    const colonIdx = agent.agentId.indexOf(":");
    if (colonIdx <= 0) continue;
    const parentId = agent.agentId.substring(0, colonIdx);
    const list = byParent.get(parentId) ?? [];
    list.push(agent.agentId);
    byParent.set(parentId, list);
  }
  for (const list of byParent.values()) {
    list.sort();
  }
  return byParent;
}

function unassignedRootAgents(
  agents: Map<string, AgentState>,
  dag: DAGSnapshot,
): string[] {
  const ids: string[] = [];
  for (const agent of agents.values()) {
    if (agent.agentId.includes(":")) continue;
    if (dag.nodes.some((n) => n.assignee === agent.agentId)) continue;
    ids.push(agent.agentId);
  }
  ids.sort();
  return ids;
}

export function syncAgents(
  world: Container,
  refs: SceneRefs,
  dag: DAGSnapshot,
  agents: Map<string, AgentState>,
  layout: LayoutResult,
  graph: CorridorGraph,
  selectAgent: (id: string) => void,
): void {
  const { connectedPairs } = graph;
  const sprites = refs.spritesRef.current;
  const MAX_CREATURES = useGameState.getState().reducedEffects ? 0 : 25;

  const spawnCreaturesNear = (x: number, y: number, count: number) => {
    if (MAX_CREATURES === 0 || refs.creaturesRef.current.length >= MAX_CREATURES) return;
    const types: CreatureType[] = ["slime", "bat", "rat"];
    for (let c = 0; c < count; c++) {
      if (refs.creaturesRef.current.length >= MAX_CREATURES) break;
      const angle = (Math.PI * 2 * c) / count + (Math.random() - 0.5);
      const dist = 30 + Math.random() * 50;
      const cx = x + Math.cos(angle) * dist;
      const cy = y + Math.sin(angle) * dist;
      const ct = types[Math.floor(Math.random() * types.length)];
      const creature = new AmbientCreature(
        ct,
        { x: cx, y: cy },
        { x: cx + (Math.random() - 0.5) * 60, y: cy + (Math.random() - 0.5) * 40 },
      );
      creature.zIndex = Z.creature;
      refs.creaturesRef.current.push(creature);
      world.addChildAt(creature, 2);
    }
  };

  const CREATURE_COOLDOWN = 5000;
  const now = Date.now();
  const seenA = new Set<string>();
  const subagentsByParent = groupSubagentsByParent(agents);
  const orphanRoots = unassignedRootAgents(agents, dag);
  const layoutCenter = layout.nodes.length > 0
    ? {
        x: layout.nodes.reduce((s, n) => s + n.x, 0) / layout.nodes.length,
        y: layout.nodes.reduce((s, n) => s + n.y, 0) / layout.nodes.length + 100,
      }
    : { x: 400, y: 320 };

  for (const agent of agents.values()) {
    seenA.add(agent.agentId);
    let sp = sprites.get(agent.agentId);
    if (!sp) {
      sp = new AgentSprite(agent.agentId, agent.role);
      sp.zIndex = Z.agent;
      sp.on("pointertap", () => selectAgent(agent.agentId));
      sprites.set(agent.agentId, sp);
      world.addChild(sp);

      const pet = new CompanionPet(petTypeForRole(agent.role));
      pet.zIndex = Z.pet;
      refs.petsRef.current.set(agent.agentId, pet);
      world.addChild(pet);
    }
    sp.setName(agent.name);
    sp.update(agent.currentAction, agent.isBlocked ?? false, agent.isComplete ?? false, agent.currentDetail);
    sp.setCost(agent.gold);
    const IDLE_THRESHOLD = 30_000;
    sp.setTrulyIdle(agent.lastActiveTs === 0 || now - agent.lastActiveTs > IDLE_THRESHOLD);
    sp.setLastEventTime(agent.lastActiveTs);

    if (agent.level > agent.prevLevel) sp.triggerLevelUp(agent.level);

    if (agent.actionProfile && sp.getAgentClass() !== agent.actionProfile.classType) {
      sp.setAgentClass(agent.actionProfile.classType);
    }

    if (agent.isComplete && !refs.completedAgentsRef.current.has(agent.agentId)) {
      refs.completedAgentsRef.current.set(agent.agentId, now);
      const loot = new LootEffect(sp.position.x, sp.position.y, sp.role);
      loot.zIndex = Z.loot;
      world.addChild(loot);
      refs.lootEffectsRef.current.push(loot);
      soundManager.playLoot();
    }

    const prevAction = refs.prevActionsRef.current.get(agent.agentId) ?? "idle";
    const curAction = agent.currentAction;
    const lastSpawn = refs.creatureSpawnCooldownRef.current.get(agent.agentId) ?? 0;
    const canSpawn = now - lastSpawn > CREATURE_COOLDOWN;

    if (curAction !== prevAction && canSpawn) {
      refs.prevActionsRef.current.set(agent.agentId, curAction);

      if (curAction === "read") {
        spawnCreaturesNear(sp.position.x, sp.position.y, 1 + Math.floor(Math.random() * 2));
        refs.creatureSpawnCooldownRef.current.set(agent.agentId, now);
      }
      if (curAction === "thinking") {
        spawnCreaturesNear(sp.position.x, sp.position.y, 1);
        refs.creatureSpawnCooldownRef.current.set(agent.agentId, now);
      }
      if (curAction === "test" && !refs.bossesRef.current.has(agent.agentId)) {
        const boss = new BossEncounter(sp.position.x + 50, sp.position.y, BOSS_DATA_TO_VISUAL.test_hydra);
        boss.setDataType("test_hydra");
        boss.zIndex = Z.boss;
        refs.bossesRef.current.set(agent.agentId, boss);
        world.addChild(boss);
        spawnCreaturesNear(sp.position.x, sp.position.y, 2);
        refs.creatureSpawnCooldownRef.current.set(agent.agentId, now);
      }
      if (curAction === "build" && !refs.bossesRef.current.has(agent.agentId)) {
        const boss = new BossEncounter(sp.position.x + 50, sp.position.y, BOSS_DATA_TO_VISUAL.forge_golem);
        boss.setDataType("forge_golem");
        boss.zIndex = Z.boss;
        refs.bossesRef.current.set(agent.agentId, boss);
        world.addChild(boss);
        refs.creatureSpawnCooldownRef.current.set(agent.agentId, now);
      }
      if (curAction === "git") {
        spawnCreaturesNear(sp.position.x, sp.position.y, 2);
        refs.creatureSpawnCooldownRef.current.set(agent.agentId, now);
      }
      if (curAction === "shell") {
        spawnCreaturesNear(sp.position.x, sp.position.y, 1);
        refs.creatureSpawnCooldownRef.current.set(agent.agentId, now);
      }
      if (curAction === "edit") {
        spawnCreaturesNear(sp.position.x, sp.position.y, 1);
        refs.creatureSpawnCooldownRef.current.set(agent.agentId, now);
      }
      if ((prevAction === "test" || prevAction === "build") && curAction !== "test" && curAction !== "build") {
        const boss = refs.bossesRef.current.get(agent.agentId);
        if (boss && !agent.isBlocked) boss.resolve();
      }
    } else {
      refs.prevActionsRef.current.set(agent.agentId, curAction);
    }

    const isBlocked = agent.isBlocked ?? false;
    const wasBlocked = refs.blockedAgentsRef.current.has(agent.agentId);
    if (isBlocked && !wasBlocked) {
      refs.blockedAgentsRef.current.add(agent.agentId);
      const detail = (agent.currentDetail ?? "").toLowerCase();
      let bossType: BossType = "skeleton";
      if (detail.includes("conflict") || detail.includes("merge")) bossType = "golem";
      else if (detail.includes("blocked") || detail.includes("waiting") || detail.includes("dependency")) {
        bossType = "dragon";
      }

      if (!refs.bossesRef.current.has(agent.agentId)) {
        const boss = new BossEncounter(sp.position.x + 50, sp.position.y, bossType);
        boss.setDataType("gate_keeper");
        boss.zIndex = Z.boss;
        refs.bossesRef.current.set(agent.agentId, boss);
        world.addChild(boss);
      }

      const dn = dag.nodes.find((n) => n.assignee === agent.agentId);
      if (dn) {
        const incomingEdge = layout.edges.find((e) => e.to.nodeId === dn.nodeId);
        if (incomingEdge) {
          const midX = (incomingEdge.from.x + incomingEdge.to.x) / 2;
          const midY = (incomingEdge.from.y + incomingEdge.to.y) / 2;
          const angle = Math.atan2(incomingEdge.to.y - incomingEdge.from.y, incomingEdge.to.x - incomingEdge.from.x);
          const door = new BlockedDoor(midX, midY, angle);
          door.zIndex = Z.door;
          refs.doorsRef.current.set(agent.agentId, door);
          world.addChild(door);
        }
      }

      spawnCreaturesNear(sp.position.x, sp.position.y, 3);
    } else if (!isBlocked && wasBlocked) {
      refs.blockedAgentsRef.current.delete(agent.agentId);
      refs.bossesRef.current.get(agent.agentId)?.resolve();
      refs.doorsRef.current.get(agent.agentId)?.open();
    }

    if (curAction === "error" && !refs.bossesRef.current.has(agent.agentId) && canSpawn) {
      const boss = new BossEncounter(sp.position.x + 50, sp.position.y, "dragon");
      boss.zIndex = Z.boss;
      refs.bossesRef.current.set(agent.agentId, boss);
      world.addChild(boss);
      spawnCreaturesNear(sp.position.x, sp.position.y, 3);
      refs.creatureSpawnCooldownRef.current.set(agent.agentId, now);
    }

    const prevDiscCount = refs.prevDiscoveryCountRef.current.get(agent.agentId) ?? 0;
    if (agent.discoveredPathCount > prevDiscCount) {
      refs.prevDiscoveryCountRef.current.set(agent.agentId, agent.discoveredPathCount);
      const agentDn = dag.nodes.find((n) => n.assignee === agent.agentId);
      if (agentDn) {
        for (const key of connectedPairs) {
          const [fromId, toId] = key.split(":");
          if (fromId !== agentDn.nodeId) continue;
          const fromLn = layout.nodes.find((n) => n.nodeId === fromId);
          const toLn = layout.nodes.find((n) => n.nodeId === toId);
          if (!fromLn || !toLn) continue;

          const midX = (fromLn.x + toLn.x) / 2;
          const midY = (fromLn.y + toLn.y) / 2;
          const angle = Math.atan2(toLn.y - fromLn.y, toLn.x - fromLn.x);
          const door = new DiscoveryDoor(midX, midY, angle, agent.lastDiscoveredPath ?? "unknown");
          door.zIndex = Z.door;

          let agentDoors = refs.discoveryDoorsRef.current.get(agent.agentId);
          if (!agentDoors) {
            agentDoors = [];
            refs.discoveryDoorsRef.current.set(agent.agentId, agentDoors);
          }
          while (agentDoors.length >= 3) agentDoors.shift()!.forceFade();
          agentDoors.push(door);
          world.addChild(door);
          break;
        }
      }
    }

    const earned = refs.checkedAchievementsRef.current.get(agent.agentId) ?? new Set<string>();
    const checkAchievement = (type: AchievementType, condition: boolean) => {
      if (condition && !earned.has(type)) {
        earned.add(type);
        const banner = new AchievementBanner(sp.position.x, sp.position.y, type);
        banner.zIndex = Z.banner;
        refs.bannersRef.current.push(banner);
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
    refs.checkedAchievementsRef.current.set(agent.agentId, earned);

    const dn = dag.nodes.find((n) => n.assignee === agent.agentId);
    if (dn) {
      const ln = layout.nodes.find((n) => n.nodeId === dn.nodeId);
      if (ln) {
        const prevNode = refs.prevActionsRef.current.get("node:" + agent.agentId);
        if (prevNode && prevNode !== dn.nodeId) {
          const prevLn = layout.nodes.find((n) => n.nodeId === prevNode);
          if (prevLn) {
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
              waypoints.push([
                u * u * u * x1 + 3 * u * u * t * midX + 3 * u * t * t * midX + t * t * t * x2,
                u * u * u * y1 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y2,
              ]);
            }
            sp.setWanderPath(waypoints);
          }
        }
        refs.prevActionsRef.current.set("node:" + agent.agentId, dn.nodeId);

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
      const colonIdx = agent.agentId.indexOf(":");
      const parentId = colonIdx > 0 ? agent.agentId.substring(0, colonIdx) : null;
      if (parentId) {
        const parentDn = dag.nodes.find((n) => n.assignee === parentId);
        if (parentDn) {
          const parentLn = layout.nodes.find((n) => n.nodeId === parentDn.nodeId);
          if (parentLn) {
            const siblings = subagentsByParent.get(parentId) ?? [agent.agentId];
            const siblingIndex = siblings.indexOf(agent.agentId);
            const [sx, sy] = subagentPosition(parentLn.x, parentLn.y, siblingIndex, agent.agentId);
            sp.moveTo(sx, sy);

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

            const parentSprite = sprites.get(parentId);
            if (parentSprite && sp) {
              let link = refs.spawnLinksRef.current.get(agent.agentId);
              if (!link) {
                link = new SpawnLink(
                  parentSprite.position.x,
                  parentSprite.position.y,
                  sp.position.x,
                  sp.position.y,
                  agent.role,
                );
                link.zIndex = Z.corridor;
                refs.spawnLinksRef.current.set(agent.agentId, link);
                world.addChildAt(link, 1);
              }
              link.updatePositions(
                parentSprite.position.x,
                parentSprite.position.y,
                sp.position.x,
                sp.position.y,
              );
            }
          }
        }
      } else {
        const orphanIdx = orphanRoots.indexOf(agent.agentId);
        if (orphanIdx >= 0) {
          const angle = (orphanIdx / Math.max(orphanRoots.length, 1)) * Math.PI * 2;
          const dist = 70 + orphanIdx * 12;
          sp.moveTo(
            layoutCenter.x + Math.cos(angle) * dist,
            layoutCenter.y + Math.sin(angle) * dist,
          );
        }
      }
    }
  }

  const REMOVE_AFTER = 10_000;
  for (const [id, completedAt] of refs.completedAgentsRef.current) {
    if (now - completedAt > REMOVE_AFTER) {
      seenA.delete(id);
      refs.completedAgentsRef.current.delete(id);
    }
  }
  for (const [id, sp] of sprites) {
    if (!seenA.has(id)) {
      world.removeChild(sp);
      sp.destroy();
      sprites.delete(id);
      const pet = refs.petsRef.current.get(id);
      if (pet) {
        world.removeChild(pet);
        pet.destroy();
        refs.petsRef.current.delete(id);
      }
      const link = refs.spawnLinksRef.current.get(id);
      if (link) {
        world.removeChild(link);
        link.destroy();
        refs.spawnLinksRef.current.delete(id);
      }
    }
  }
}
