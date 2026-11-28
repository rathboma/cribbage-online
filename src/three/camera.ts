import { MathUtils, PerspectiveCamera, Vector3 } from 'three'

/**
 * Framing the table: where the camera stands so a given part of the table fills the canvas.
 * Pure maths on a PerspectiveCamera, with no renderer and no DOM, so the layout engine and the
 * unit tests can work out exactly what is on screen at any viewport size.
 *
 * Table space is the TableScene's: +x to the right, +y up, +z towards this player.
 */

/** A rectangle on the table top, centred on (x, z). */
export interface TableRect {
  x: number
  z: number
  width: number
  depth: number
}

/** Pixels along each edge of the canvas that something else (the HUD) covers. */
export interface Insets {
  top: number
  right: number
  bottom: number
  left: number
}

/** The canvas the table is drawn into, in CSS pixels. */
export interface Viewport {
  width: number
  height: number
  /** Parts of the canvas the table should keep clear of. None by default. */
  insets?: Partial<Insets>
}

/** Vertical field of view, in degrees. Narrow enough that cards near and far look alike. */
export const CAMERA_FOV = 36
/** How far the camera leans back from looking straight down. */
export const CAMERA_TILT = MathUtils.degToRad(24)
/** Fraction of the view kept clear around the frame, on every side. */
export const VIEW_MARGIN = 0.04

export function makeCamera(): PerspectiveCamera {
  return new PerspectiveCamera(CAMERA_FOV, 1, 0.5, 200)
}

function insetsOf(viewport: Viewport): Insets {
  const { top = 0, right = 0, bottom = 0, left = 0 } = viewport.insets ?? {}
  return { top, right, bottom, left }
}

/** The part of the canvas left once the insets are taken off: at least a pixel each way. */
export function innerSize(viewport: Viewport): { width: number; height: number } {
  const i = insetsOf(viewport)
  return {
    width: Math.max(1, viewport.width - i.left - i.right),
    height: Math.max(1, viewport.height - i.top - i.bottom),
  }
}

/**
 * Puts `camera` as close as it can be while all of `frame` stays inside the canvas, less its
 * insets and a small margin. The camera looks at the frame's centre, leaning back by
 * CAMERA_TILT, so this player's side of the table is nearest. Returns the distance from the
 * camera to the frame's centre: the smaller it is, the bigger everything looks.
 */
export function frameCamera(
  camera: PerspectiveCamera,
  frame: TableRect,
  viewport: Viewport,
): number {
  const insets = insetsOf(viewport)
  const inner = innerSize(viewport)
  // Fitted to the inner box as if it were the whole canvas...
  camera.aspect = inner.width / inner.height
  camera.clearViewOffset()
  camera.updateProjectionMatrix()

  const target = new Vector3(frame.x, 0, frame.z)
  const direction = new Vector3(0, Math.cos(CAMERA_TILT), Math.sin(CAMERA_TILT))
  const corners = [-1, 1].flatMap((sx) =>
    [-1, 1].map(
      (sz) => new Vector3(frame.x + (sx * frame.width) / 2, 0, frame.z + (sz * frame.depth) / 2),
    ),
  )
  const place = (distance: number) => {
    camera.position.copy(direction).multiplyScalar(distance).add(target)
    camera.lookAt(target)
    camera.updateMatrixWorld()
  }
  const point = new Vector3()
  const fits = () =>
    corners.every((corner) => {
      point.copy(corner).applyMatrix4(camera.matrixWorldInverse)
      if (point.z > -camera.near) return false // behind the camera
      point.applyMatrix4(camera.projectionMatrix)
      return Math.abs(point.x) <= 1 - VIEW_MARGIN && Math.abs(point.y) <= 1 - VIEW_MARGIN
    })

  // Further away always shows more, so a binary search finds the closest distance that fits.
  let near = 1
  let far = 150
  for (let i = 0; i < 32; i++) {
    const mid = (near + far) / 2
    place(mid)
    if (fits()) far = mid
    else near = mid
  }
  place(far)

  // ...then widened to the whole canvas, so the inner box shows exactly what was fitted and the
  // insets show more of the table around it.
  if (insets.top || insets.right || insets.bottom || insets.left) {
    camera.setViewOffset(
      inner.width,
      inner.height,
      -insets.left,
      -insets.top,
      viewport.width,
      viewport.height,
    )
    camera.updateProjectionMatrix()
  }
  return far
}

/** Where a point on the table appears on the canvas, in CSS pixels from the top left. */
export function toScreen(
  camera: PerspectiveCamera,
  viewport: Viewport,
  point: { x: number; y: number; z: number },
): { x: number; y: number; inFront: boolean } {
  const v = new Vector3(point.x, point.y, point.z).applyMatrix4(camera.matrixWorldInverse)
  const inFront = v.z < -camera.near
  v.applyMatrix4(camera.projectionMatrix)
  return {
    x: ((v.x + 1) / 2) * viewport.width,
    y: ((1 - v.y) / 2) * viewport.height,
    inFront,
  }
}
