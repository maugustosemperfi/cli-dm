import { useRef, type RefObject } from "react";
import type { Application, Container } from "pixi.js";
import type { LayoutResult } from "../layout";
import type { RoomNode } from "../RoomNode";
import type { AgentSprite } from "../AgentSprite";
import type { Corridor } from "../Corridor";
import type { LootEffect } from "../LootEffect";
import type { AmbientCreature } from "../AmbientCreature";
import type { BossEncounter } from "../BossEncounter";
import type { CompanionPet } from "../CompanionPet";
import type { BlockedDoor } from "../BlockedDoor";
import type { DiscoveryDoor } from "../DiscoveryDoor";
import type { TorchLight } from "../TorchLight";
import type { DayNightCycle } from "../DayNightCycle";
import type { FogOfWar } from "../FogOfWar";
import type { AchievementBanner } from "../AchievementBanner";
import { GreetingManager } from "../GreetingManager";
import type { Camera } from "../Camera";
import type { SpawnLink } from "../SpawnLink";
import type { SceneOverlay } from "./constants";
import { pickSceneOverlay } from "./constants";
import { useGameState } from "../../../stores/gameState";

export interface LayoutCache {
  layout: LayoutResult;
  topoKey: string;
  weightsKey: string;
}

export interface SceneRefs {
  containerRef: RefObject<HTMLDivElement | null>;
  appRef: RefObject<Application | null>;
  worldRef: RefObject<Container | null>;
  cameraRef: RefObject<Camera | null>;
  roomsRef: RefObject<Map<string, RoomNode>>;
  corridorsRef: RefObject<Corridor[]>;
  spritesRef: RefObject<Map<string, AgentSprite>>;
  lootEffectsRef: RefObject<LootEffect[]>;
  creaturesRef: RefObject<AmbientCreature[]>;
  bossesRef: RefObject<Map<string, BossEncounter>>;
  petsRef: RefObject<Map<string, CompanionPet>>;
  doorsRef: RefObject<Map<string, BlockedDoor>>;
  discoveryDoorsRef: RefObject<Map<string, DiscoveryDoor[]>>;
  prevDiscoveryCountRef: RefObject<Map<string, number>>;
  torchesRef: RefObject<TorchLight[]>;
  dayNightRef: RefObject<DayNightCycle | null>;
  fogRef: RefObject<FogOfWar | null>;
  bannersRef: RefObject<AchievementBanner[]>;
  checkedAchievementsRef: RefObject<Map<string, Set<string>>>;
  greetingMgrRef: RefObject<GreetingManager>;
  completedAgentsRef: RefObject<Map<string, number>>;
  blockedAgentsRef: RefObject<Set<string>>;
  prevActionsRef: RefObject<Map<string, string>>;
  creatureSpawnCooldownRef: RefObject<Map<string, number>>;
  spawnLinksRef: RefObject<Map<string, SpawnLink>>;
  prevNodeIdsRef: RefObject<Set<string> | null>;
  prevTopoKeyRef: RefObject<string>;
  layoutCacheRef: RefObject<LayoutCache | null>;
  sceneOverlayRef: RefObject<SceneOverlay>;
}

export function useSceneRefs(): SceneRefs {
  return {
    containerRef: useRef<HTMLDivElement>(null),
    appRef: useRef<Application | null>(null),
    worldRef: useRef<Container | null>(null),
    cameraRef: useRef<Camera | null>(null),
    roomsRef: useRef(new Map<string, RoomNode>()),
    corridorsRef: useRef<Corridor[]>([]),
    spritesRef: useRef(new Map<string, AgentSprite>()),
    lootEffectsRef: useRef<LootEffect[]>([]),
    creaturesRef: useRef<AmbientCreature[]>([]),
    bossesRef: useRef(new Map<string, BossEncounter>()),
    petsRef: useRef(new Map<string, CompanionPet>()),
    doorsRef: useRef(new Map<string, BlockedDoor>()),
    discoveryDoorsRef: useRef(new Map<string, DiscoveryDoor[]>()),
    prevDiscoveryCountRef: useRef(new Map<string, number>()),
    torchesRef: useRef<TorchLight[]>([]),
    dayNightRef: useRef<DayNightCycle | null>(null),
    fogRef: useRef<FogOfWar | null>(null),
    bannersRef: useRef<AchievementBanner[]>([]),
    checkedAchievementsRef: useRef(new Map<string, Set<string>>()),
    greetingMgrRef: useRef(new GreetingManager()),
    completedAgentsRef: useRef(new Map<string, number>()),
    blockedAgentsRef: useRef(new Set<string>()),
    prevActionsRef: useRef(new Map<string, string>()),
    creatureSpawnCooldownRef: useRef(new Map<string, number>()),
    spawnLinksRef: useRef(new Map<string, SpawnLink>()),
    prevNodeIdsRef: useRef<Set<string> | null>(null),
    prevTopoKeyRef: useRef(""),
    layoutCacheRef: useRef<LayoutCache | null>(null),
    sceneOverlayRef: useRef<SceneOverlay>(pickSceneOverlay(useGameState.getState())),
  };
}
