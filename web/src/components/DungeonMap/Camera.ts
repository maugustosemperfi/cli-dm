import { Container, FederatedPointerEvent } from "pixi.js";

const MIN_SCALE = 0.3;
const MAX_SCALE = 2.0;
const ZOOM_FACTOR = 0.1;
const PAN_LERP = 0.08;

export class Camera {
  world: Container;
  private viewWidth: number;
  private viewHeight: number;
  private isDragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private worldStartX = 0;
  private worldStartY = 0;

  // Auto-follow
  private followTargetX = 0;
  private followTargetY = 0;
  private autoFollowEnabled = true;

  constructor(
    world: Container,
    viewport: { width: number; height: number },
    interactionTarget: Container
  ) {
    this.world = world;
    this.viewWidth = viewport.width;
    this.viewHeight = viewport.height;

    // Interaction events on the stage/background
    interactionTarget.eventMode = "static";
    interactionTarget.on("pointerdown", this.onDragStart, this);
    interactionTarget.on("pointermove", this.onDragMove, this);
    interactionTarget.on("pointerup", this.onDragEnd, this);
    interactionTarget.on("pointerupoutside", this.onDragEnd, this);
    interactionTarget.on("wheel", this.onWheel as any, this);
  }

  resize(width: number, height: number) {
    this.viewWidth = width;
    this.viewHeight = height;
  }

  pan(dx: number, dy: number) {
    this.world.x += dx;
    this.world.y += dy;
    this.autoFollowEnabled = false; // Manual pan disables auto-follow
  }

  zoom(delta: number, centerX: number, centerY: number) {
    const oldScale = this.world.scale.x;
    const newScale = Math.max(
      MIN_SCALE,
      Math.min(MAX_SCALE, oldScale + delta * ZOOM_FACTOR)
    );

    // Zoom toward pointer position
    const worldX = (centerX - this.world.x) / oldScale;
    const worldY = (centerY - this.world.y) / oldScale;

    this.world.scale.set(newScale);
    this.world.x = centerX - worldX * newScale;
    this.world.y = centerY - worldY * newScale;
  }

  focusOn(worldX: number, worldY: number, animate = true) {
    const targetX = this.viewWidth / 2 - worldX * this.world.scale.x;
    const targetY = this.viewHeight / 2 - worldY * this.world.scale.x;

    if (animate) {
      this.followTargetX = targetX;
      this.followTargetY = targetY;
      this.autoFollowEnabled = true;
    } else {
      this.world.x = targetX;
      this.world.y = targetY;
    }
  }

  autoFollow(positions: Array<{ x: number; y: number }>) {
    if (!this.autoFollowEnabled || positions.length === 0) return;

    // Centroid of all active agents
    let cx = 0;
    let cy = 0;
    for (const p of positions) {
      cx += p.x;
      cy += p.y;
    }
    cx /= positions.length;
    cy /= positions.length;

    this.followTargetX =
      this.viewWidth / 2 - cx * this.world.scale.x;
    this.followTargetY =
      this.viewHeight / 2 - cy * this.world.scale.x;
  }

  tick() {
    if (!this.autoFollowEnabled || this.isDragging) return;

    // Smooth lerp toward follow target
    const dx = this.followTargetX - this.world.x;
    const dy = this.followTargetY - this.world.y;
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
      this.world.x += dx * PAN_LERP;
      this.world.y += dy * PAN_LERP;
    }
  }

  enableAutoFollow() {
    this.autoFollowEnabled = true;
  }

  /** Returns the current viewport bounds in world coordinates */
  getViewport(): { x: number; y: number; width: number; height: number; scale: number } {
    const scale = this.world.scale.x;
    return {
      x: -this.world.x / scale,
      y: -this.world.y / scale,
      width: this.viewWidth / scale,
      height: this.viewHeight / scale,
      scale,
    };
  }

  // --- Event handlers ---

  private onDragStart(e: FederatedPointerEvent) {
    this.isDragging = true;
    this.dragStartX = e.globalX;
    this.dragStartY = e.globalY;
    this.worldStartX = this.world.x;
    this.worldStartY = this.world.y;
    this.autoFollowEnabled = false;
  }

  private onDragMove(e: FederatedPointerEvent) {
    if (!this.isDragging) return;
    this.world.x = this.worldStartX + (e.globalX - this.dragStartX);
    this.world.y = this.worldStartY + (e.globalY - this.dragStartY);
  }

  private onDragEnd() {
    this.isDragging = false;
  }

  private onWheel(e: WheelEvent) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -1 : 1;
    this.zoom(delta, e.offsetX, e.offsetY);
  }
}
