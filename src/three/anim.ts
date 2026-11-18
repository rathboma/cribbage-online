/**
 * Tweens and timelines: every animation on the 3D table goes through this module.
 *
 * Time only moves when `Animator.advance(ms)` is called. The table scene calls it once per
 * frame from requestAnimationFrame; tests call it directly, so animation logic runs (and can be
 * checked frame by frame) without a browser. Nothing here touches the DOM or three.js.
 *
 * The API is small on purpose and loosely follows GSAP's (`to`, `call`, timeline positions), so
 * a library could take its place behind it later without touching the code that animates.
 */

/** Maps progress 0..1 to eased progress; must give 0 at 0 and 1 at 1. */
export type Ease = (t: number) => number

export const ease = {
  linear: (t: number) => t,
  inQuad: (t: number) => t * t,
  outQuad: (t: number) => t * (2 - t),
  inOutQuad: (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
  inCubic: (t: number) => t ** 3,
  outCubic: (t: number) => 1 - (1 - t) ** 3,
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2),
  /** Overshoots a little, then settles: for things that land. */
  outBack: (t: number) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2,
} satisfies Record<string, Ease>

/** The keys of T whose values are numbers: the only properties a tween can move. */
type NumericKeys<T> = { [K in keyof T]-?: T[K] extends number ? K : never }[keyof T]
export type TweenProps<T> = { [K in NumericKeys<T>]?: number }

export interface TweenOptions {
  /** Milliseconds; 0 jumps straight to the end values. */
  duration: number
  /** Milliseconds to wait before starting, counted from the tween's place on the timeline. */
  delay?: number
  ease?: Ease
  /** Runs after every change, e.g. to update a matrix or mark the scene as changed. */
  onUpdate?: () => void
}

/**
 * Where a step goes on a timeline: after everything added so far (the default), at the same
 * time as the step added just before it (`'<'`), or at an absolute time in milliseconds.
 */
export type Position = number | '<'

/** Anything that can be placed on a timeline or played by an Animator. */
export interface Step {
  /** Total length in milliseconds. */
  readonly duration: number
  /** Brings the step to local time t, where 0 ≤ t ≤ duration. Time only moves forward. */
  seek(t: number): void
  /** Readies the step to play again from the start (Animator.play calls it). */
  reset?(): void
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))

/**
 * Which tween is moving each property of each object. When a tween starts it takes over the
 * properties it moves from any older tween still running, as GSAP's `overwrite: 'auto'` does:
 * the newest instruction wins, so a card sent somewhere new mid-flight ends up there.
 */
const owners = new WeakMap<object, Map<PropertyKey, Step>>()

function ownersOf(target: object) {
  let map = owners.get(target)
  if (!map) owners.set(target, (map = new Map()))
  return map
}

/** Stops every running tween from moving these properties of `target` (all, if none given). */
export function stopTweensOf(target: object, keys?: readonly PropertyKey[]): void {
  const map = owners.get(target)
  if (!map) return
  for (const key of keys ?? [...map.keys()]) map.delete(key)
}

class TweenStep<T extends object> implements Step {
  readonly duration: number
  private readonly keys: (keyof T)[]
  private readonly to: number[]
  /** Captured when the tween starts, so it picks up wherever an earlier step left off. */
  private from: number[] | null = null

  constructor(
    private readonly target: T,
    props: TweenProps<T>,
    private readonly options: TweenOptions,
  ) {
    this.duration = Math.max(0, options.duration)
    this.keys = Object.keys(props) as (keyof T)[]
    this.to = this.keys.map((k) => (props as Record<keyof T, number>)[k])
  }

  seek(t: number): void {
    const target = this.target as Record<keyof T, number>
    const claims = ownersOf(this.target)
    if (!this.from) {
      this.from = this.keys.map((k) => target[k])
      for (const k of this.keys) claims.set(k, this)
    }
    const end = t >= this.duration
    const p = end ? 1 : (this.options.ease ?? ease.inOutCubic)(clamp01(t / this.duration))
    this.keys.forEach((k, i) => {
      // A newer tween has taken this property over (or it was stopped): leave it alone.
      if (claims.get(k) !== this) return
      const from = this.from![i]!
      const to = this.to[i]!
      // Exactly the end value at the end, whatever rounding the ease did.
      target[k] = end ? to : from + (to - from) * p
      if (end) claims.delete(k)
    })
    this.options.onUpdate?.()
  }

  reset(): void {
    const claims = owners.get(this.target)
    for (const k of this.keys) if (claims?.get(k) === this) claims.delete(k)
    this.from = null
  }
}

class CallStep implements Step {
  readonly duration = 0
  private called = false
  constructor(private readonly fn: () => void) {}
  seek(): void {
    if (this.called) return
    this.called = true
    this.fn()
  }
  reset(): void {
    this.called = false
  }
}

class WaitStep implements Step {
  constructor(readonly duration: number) {}
  seek(): void {}
}

interface Entry {
  start: number
  step: Step
  done: boolean
}

/**
 * Steps laid out in time. A timeline is itself a step, so timelines nest.
 *
 * ```ts
 * const tl = new Timeline()
 *   .to(card.position, { x: 1, z: 2 }, { duration: 300 })
 *   .to(card.rotation, { y: Math.PI }, { duration: 300 }, '<') // together with the move
 *   .call(() => card.setFace('5H'))                            // then this
 * animator.play(tl)
 * ```
 */
export class Timeline implements Step {
  private readonly entries: Entry[] = []
  private previousStart = 0

  get duration(): number {
    return this.entries.reduce((end, e) => Math.max(end, e.start + e.step.duration), 0)
  }

  /** Tweens numeric properties of `target` to the given values. */
  to<T extends object>(
    target: T,
    props: TweenProps<T>,
    options: TweenOptions,
    at?: Position,
  ): this {
    return this.add(new TweenStep(target, props, options), at, options.delay)
  }

  /** Runs `fn` once, when the timeline reaches this point. */
  call(fn: () => void, at?: Position): this {
    return this.add(new CallStep(fn), at)
  }

  /** Leaves a gap of `ms` after everything added so far. */
  wait(ms: number): this {
    return this.add(new WaitStep(Math.max(0, ms)))
  }

  /** Places any step, including another timeline, at `at` plus `delay`. */
  add(step: Step, at?: Position, delay = 0): this {
    const base = at === undefined ? this.duration : at === '<' ? this.previousStart : at
    const start = Math.max(0, base + delay)
    this.previousStart = start
    // Kept in order of start time (stable), so a step that starts later always reads the
    // values an earlier one has finished with.
    let i = this.entries.length
    while (i > 0 && this.entries[i - 1]!.start > start) i--
    this.entries.splice(i, 0, { start, step, done: false })
    return this
  }

  seek(t: number): void {
    for (const entry of this.entries) {
      if (entry.done || t < entry.start) continue
      const local = t - entry.start
      entry.step.seek(Math.min(local, entry.step.duration))
      if (local >= entry.step.duration) entry.done = true
    }
  }

  reset(): void {
    for (const entry of this.entries) {
      entry.done = false
      entry.step.reset?.()
    }
  }
}

export type AnimationResult = 'completed' | 'cancelled'

/** A playing step, as handed back by `Animator.play`. */
export interface Animation {
  /** Settles when the animation completes or is cancelled; it never rejects. */
  readonly finished: Promise<AnimationResult>
  readonly done: boolean
  /** Jumps to the end: every value reaches its target and every call runs. */
  complete(): void
  /** Stops where it is. */
  cancel(): void
}

class Playing {
  time = 0
  done = false
  readonly finished: Promise<AnimationResult>
  private settle!: (result: AnimationResult) => void

  constructor(
    readonly step: Step,
    private readonly onSettled: (playing: Playing) => void,
  ) {
    this.finished = new Promise((resolve) => (this.settle = resolve))
  }

  /** Moves time on. A step that throws is cancelled, and the error handed to `onError`. */
  advance(ms: number, onError: (error: unknown) => void): void {
    if (this.done) return
    this.time += ms
    const duration = this.step.duration
    try {
      this.step.seek(Math.min(this.time, duration))
    } catch (error) {
      this.end('cancelled')
      onError(error)
      return
    }
    if (this.time >= duration) this.end('completed')
  }

  complete(onError: (error: unknown) => void): void {
    if (this.done) return
    try {
      this.step.seek(this.step.duration)
    } catch (error) {
      this.end('cancelled')
      onError(error)
      return
    }
    this.end('completed')
  }

  cancel(): void {
    if (!this.done) this.end('cancelled')
  }

  private end(result: AnimationResult) {
    this.done = true
    this.onSettled(this)
    this.settle(result)
  }
}

/**
 * Plays steps against a clock that only moves when told to. The scene drives it from
 * requestAnimationFrame; tests drive it by hand.
 */
export class Animator {
  private readonly playing = new Set<Playing>()

  /**
   * Called when something starts playing while nothing else was: the scene uses it to start
   * drawing frames again.
   */
  onWake: (() => void) | null = null

  /**
   * Gets whatever a step throws (from an onUpdate or a call). The step is cancelled and every
   * other animation carries on. By default the error is rethrown on its own, so it reaches the
   * console and window.onerror without stopping the frame loop.
   */
  onError: (error: unknown) => void = (error) => {
    queueMicrotask(() => {
      throw error
    })
  }

  /** True while anything is playing. */
  get busy(): boolean {
    return this.playing.size > 0
  }

  /**
   * Starts a step now; it is brought to its start state at once (time 0). A step that has
   * played before starts over. Throws if the step is already playing.
   */
  play(step: Step): Animation {
    for (const p of this.playing) {
      if (p.step === step) throw new Error('Animator: this step is already playing')
    }
    step.reset?.()
    const wasBusy = this.busy
    const playing = new Playing(step, (p) => this.playing.delete(p))
    this.playing.add(playing)
    playing.advance(0, this.onError)
    if (!wasBusy && this.busy) this.onWake?.()
    return {
      finished: playing.finished,
      get done() {
        return playing.done
      },
      complete: () => playing.complete(this.onError),
      cancel: () => playing.cancel(),
    }
  }

  /** Shorthand for playing a timeline holding a single tween. */
  tween<T extends object>(target: T, props: TweenProps<T>, options: TweenOptions): Animation {
    return this.play(new Timeline().to(target, props, options))
  }

  /** Moves the clock on by `ms` milliseconds and updates everything that is playing. */
  advance(ms: number): void {
    const dt = Number.isFinite(ms) && ms > 0 ? ms : 0
    // A snapshot: anything started by a step's callback begins on the next advance.
    for (const playing of [...this.playing]) playing.advance(dt, this.onError)
  }

  /** Jumps every animation to its end. */
  completeAll(): void {
    // Until nothing is left: a call at the end of one animation may start another.
    for (let round = 0; this.busy && round < 100; round++) {
      for (const playing of [...this.playing]) playing.complete(this.onError)
    }
  }

  /** Stops every animation where it is. */
  cancelAll(): void {
    for (const playing of [...this.playing]) playing.cancel()
  }
}
