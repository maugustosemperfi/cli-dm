import type { AgentState } from "../../../stores/gameState";
import type { SceneRefs } from "./sceneRefs";

function destroyChildren(world: NonNullable<SceneRefs["worldRef"]["current"]>, items: { destroy: () => void }[]) {
  for (const item of items) {
    world.removeChild(item as never);
    item.destroy();
  }
}

/** Remove decorative / ephemeral Pixi objects after StatusBar CLEAR. */
export function purgeSceneOnClear(refs: SceneRefs): void {
  const world = refs.worldRef.current;
  if (!world) return;

  destroyChildren(world, refs.creaturesRef.current);
  refs.creaturesRef.current = [];

  destroyChildren(world, refs.lootEffectsRef.current);
  refs.lootEffectsRef.current = [];

  destroyChildren(world, refs.bannersRef.current);
  refs.bannersRef.current = [];

  for (const doors of refs.discoveryDoorsRef.current.values()) {
    destroyChildren(world, doors);
  }
  refs.discoveryDoorsRef.current.clear();
  refs.prevDiscoveryCountRef.current.clear();

  for (const corridor of refs.corridorsRef.current) {
    corridor.resetEphemeral();
  }
  for (const room of refs.roomsRef.current.values()) {
    room.resetEphemeral();
  }

  refs.checkedAchievementsRef.current.clear();
  refs.creatureSpawnCooldownRef.current.clear();
}

/** Remove Pixi objects for agents evicted by PRUNE and trim ephemeral effects. */
export function purgeSceneOnPrune(
  refs: SceneRefs,
  prevAgents: Map<string, AgentState>,
  nextAgents: Map<string, AgentState>,
): void {
  const world = refs.worldRef.current;
  if (!world) return;

  for (const id of prevAgents.keys()) {
    if (nextAgents.has(id)) continue;

    const sp = refs.spritesRef.current.get(id);
    if (sp) {
      world.removeChild(sp);
      sp.destroy();
      refs.spritesRef.current.delete(id);
    }
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
    const boss = refs.bossesRef.current.get(id);
    if (boss) {
      world.removeChild(boss);
      boss.destroy();
      refs.bossesRef.current.delete(id);
    }
    const door = refs.doorsRef.current.get(id);
    if (door) {
      world.removeChild(door);
      door.destroy();
      refs.doorsRef.current.delete(id);
    }
    refs.blockedAgentsRef.current.delete(id);
    refs.completedAgentsRef.current.delete(id);
    refs.prevActionsRef.current.delete(id);
    refs.prevActionsRef.current.delete("node:" + id);
    refs.checkedAchievementsRef.current.delete(id);
  }

  for (const corridor of refs.corridorsRef.current) {
    corridor.resetEphemeral();
  }
  for (const room of refs.roomsRef.current.values()) {
    room.resetEphemeral();
  }
}
