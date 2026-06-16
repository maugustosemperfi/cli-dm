import { useEffect } from "react";
import { Application, Container, Graphics } from "pixi.js";
import { useGameState } from "../../../stores/gameState";
import { soundManager } from "../../../audio/SoundManager";
import { setCharacterRenderer } from "../AgentSprite";
import { CharacterRenderer } from "../sprites/CharacterRenderer";
import { FogOfWar } from "../FogOfWar";
import { DayNightCycle } from "../DayNightCycle";
import { Camera } from "../Camera";
import { THEME } from "../theme";
import { Z } from "./constants";
import type { SceneRefs } from "./sceneRefs";

export function usePixiApp(refs: SceneRefs, setError: (msg: string | null) => void) {
  useEffect(() => {
    const containerRef = refs.containerRef;
    if (!containerRef.current) return;
    const container: HTMLDivElement = containerRef.current!;

    let cancelled = false;
    let app: Application | null = null;

    async function waitForDimensions(): Promise<void> {
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

        app.canvas.style.width = "100%";
        app.canvas.style.height = "100%";
        container.appendChild(app.canvas);
        refs.appRef.current = app;

        const charRenderer = new CharacterRenderer(app);
        setCharacterRenderer(charRenderer);

        const bgLayer = new Graphics();
        bgLayer.rect(0, 0, 8000, 8000).fill({ color: THEME.bg });
        bgLayer.position.set(-4000, -4000);
        bgLayer.eventMode = "static";
        app.stage.addChild(bgLayer);

        const world = new Container();
        world.sortableChildren = true;
        app.stage.addChild(world);
        refs.worldRef.current = world;

        const grid = new Graphics();
        const spacing = 40;
        const gs = 2000;
        for (let x = -gs; x <= gs; x += spacing) {
          grid.moveTo(x, -gs).lineTo(x, gs).stroke({ color: THEME.gridDot, width: 0.5, alpha: 0.12 });
        }
        for (let y = -gs; y <= gs; y += spacing) {
          grid.moveTo(-gs, y).lineTo(gs, y).stroke({ color: THEME.gridDot, width: 0.5, alpha: 0.12 });
        }
        grid.zIndex = Z.grid;
        world.addChild(grid);

        const fog = new FogOfWar();
        fog.zIndex = Z.fog;
        world.addChild(fog);
        refs.fogRef.current = fog;

        const camera = new Camera(world, { width: w, height: h }, bgLayer);
        refs.cameraRef.current = camera;

        const ro = new ResizeObserver(() => {
          if (!app || cancelled) return;
          const nw = container.clientWidth;
          const nh = container.clientHeight;
          app.renderer.resize(nw, nh);
          camera.resize(nw, nh);
        });
        ro.observe(container);

        const dayNight = new DayNightCycle(w, h);
        dayNight.zIndex = Z.dayNight;
        world.addChild(dayNight);
        refs.dayNightRef.current = dayNight;

        app.ticker.add((ticker) => {
          const dt = ticker.deltaTime;
          for (const room of refs.roomsRef.current.values()) room.tick(dt);
          for (const sprite of refs.spritesRef.current.values()) sprite.tick(dt);
          for (const corridor of refs.corridorsRef.current) corridor.tick(dt);
          for (const link of refs.spawnLinksRef.current.values()) link.tick(dt);

          const agentPositions: Array<{ id: string; x: number; y: number; isIdle: boolean; isComplete: boolean }> = [];
          for (const [id, sprite] of refs.spritesRef.current) {
            agentPositions.push({
              id,
              x: sprite.position.x,
              y: sprite.position.y,
              isIdle: sprite.currentActionPublic === "idle",
              isComplete: sprite.isCompletePublic,
            });
          }

          const creatures = refs.creaturesRef.current;
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

          const storeBosses = useGameState.getState().bosses;
          for (const [id, boss] of refs.bossesRef.current) {
            if (boss.isDone()) {
              world.removeChild(boss);
              boss.destroy();
              refs.bossesRef.current.delete(id);
            } else {
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

          for (const [id, pet] of refs.petsRef.current) {
            const sprite = refs.spritesRef.current.get(id);
            if (sprite) {
              pet.tick(dt, sprite.position.x, sprite.position.y, sprite.currentActionPublic);
            }
          }

          for (const [id, door] of refs.doorsRef.current) {
            if (door.isDone()) {
              world.removeChild(door);
              door.destroy();
              refs.doorsRef.current.delete(id);
            } else {
              door.tick(dt);
            }
          }

          for (const [agentId, doors] of refs.discoveryDoorsRef.current) {
            for (let i = doors.length - 1; i >= 0; i--) {
              if (doors[i].isDone()) {
                world.removeChild(doors[i]);
                doors[i].destroy();
                doors.splice(i, 1);
              } else {
                doors[i].tick(dt);
              }
            }
            if (doors.length === 0) refs.discoveryDoorsRef.current.delete(agentId);
          }

          for (const torch of refs.torchesRef.current) torch.tick(dt);

          const dayNightCycle = refs.dayNightRef.current;
          if (dayNightCycle) {
            dayNightCycle.tick(dt);
            const nightMult = dayNightCycle.getNightMultiplier();
            for (const torch of refs.torchesRef.current) torch.setNightMultiplier(nightMult);
          }

          if (refs.fogRef.current) refs.fogRef.current.tick(dt);

          const banners = refs.bannersRef.current;
          for (let i = banners.length - 1; i >= 0; i--) {
            if (banners[i].isDone()) {
              world.removeChild(banners[i]);
              banners[i].destroy();
              banners.splice(i, 1);
            } else {
              banners[i].tick(dt);
            }
          }

          const loots = refs.lootEffectsRef.current;
          for (let i = loots.length - 1; i >= 0; i--) {
            if (loots[i].isDone()) {
              world.removeChild(loots[i]);
              loots[i].destroy();
              loots.splice(i, 1);
            } else {
              loots[i].tick(dt);
            }
          }

          const greetings = refs.greetingMgrRef.current.tick(dt, agentPositions);
          for (const g of greetings) {
            const sp1 = refs.spritesRef.current.get(g.agent1Id);
            const sp2 = refs.spritesRef.current.get(g.agent2Id);
            if (sp1) sp1.showGreeting(g.text1);
            if (sp2) sp2.showGreeting(g.text2);
          }

          camera.tick();

          const vp = camera.getViewport();
          soundManager.setZoomVolume(vp.scale);

          const followPositions: Array<{ x: number; y: number }> = [];
          for (const sprite of refs.spritesRef.current.values()) {
            if (sprite.alpha > 0.5) {
              followPositions.push({ x: sprite.position.x, y: sprite.position.y });
            }
          }
          camera.autoFollow(followPositions);
        });
      } catch (err) {
        setError(String(err));
      }
    }

    setup();

    return () => {
      cancelled = true;
      if (app) {
        app.destroy(true, { children: true });
      }
      refs.appRef.current = null;
      refs.worldRef.current = null;
      refs.cameraRef.current = null;
      refs.roomsRef.current.clear();
      refs.corridorsRef.current = [];
      refs.spritesRef.current.clear();
      for (const t of refs.torchesRef.current) t.destroy();
      refs.torchesRef.current = [];
      if (refs.dayNightRef.current) {
        refs.dayNightRef.current.destroy();
        refs.dayNightRef.current = null;
      }
      if (refs.fogRef.current) {
        refs.fogRef.current.destroy();
        refs.fogRef.current = null;
      }
      for (const b of refs.bannersRef.current) b.destroy();
      refs.bannersRef.current = [];
      for (const link of refs.spawnLinksRef.current.values()) link.destroy();
      refs.spawnLinksRef.current.clear();
    };
    // Scene refs are stable RefObjects; init runs once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
