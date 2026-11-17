// @vitest-environment node
// Runs in plain Node, with no DOM and no requestAnimationFrame: the clock moves only when a test
// calls advance().
import { describe, expect, it, vi } from 'vitest'
import { Animator, ease, Timeline } from './anim'

describe('Animator', () => {
  it('moves a tween with the manual clock and lands exactly on the end value', async () => {
    expect(typeof globalThis.requestAnimationFrame).toBe('undefined')
    const animator = new Animator()
    const card = { x: 0, y: 5 }
    const animation = animator.tween(card, { x: 10 }, { duration: 100, ease: ease.linear })

    expect(animator.busy).toBe(true)
    animator.advance(25)
    expect(card.x).toBeCloseTo(2.5)
    animator.advance(50)
    expect(card.x).toBeCloseTo(7.5)
    animator.advance(25)
    expect(card.x).toBe(10)
    expect(card.y).toBe(5)
    expect(animation.done).toBe(true)
    expect(animator.busy).toBe(false)
    await expect(animation.finished).resolves.toBe('completed')
  })

  it('lands on the end value with an ease that overshoots, and after a long jump', () => {
    const animator = new Animator()
    const card = { x: 0 }
    animator.tween(card, { x: 1 }, { duration: 300, ease: ease.outBack })
    animator.advance(150)
    expect(card.x).toBeGreaterThan(1) // the overshoot
    animator.advance(10_000)
    expect(card.x).toBe(1)
  })

  it('starts from wherever the value is when the tween starts', () => {
    const animator = new Animator()
    const card = { x: 0 }
    const timeline = new Timeline()
      .to(card, { x: 10 }, { duration: 100, ease: ease.linear })
      .to(card, { x: 20 }, { duration: 100, ease: ease.linear })
    animator.play(timeline)
    // Straight past the first tween: the second still starts from 10, not from 0.
    animator.advance(150)
    expect(card.x).toBeCloseTo(15)
    animator.advance(50)
    expect(card.x).toBe(20)
  })

  it('places steps one after another, together with "<", or at a set time', () => {
    const order: string[] = []
    const timeline = new Timeline()
      .call(() => order.push('a'))
      .wait(100)
      .call(() => order.push('b'))
      .call(() => order.push('c'), '<')
      .call(() => order.push('d'), 50)
    expect(timeline.duration).toBe(100)

    const animator = new Animator()
    animator.play(timeline)
    expect(order).toEqual(['a'])
    animator.advance(60)
    expect(order).toEqual(['a', 'd'])
    animator.advance(40)
    expect(order).toEqual(['a', 'd', 'b', 'c'])
  })

  it('honours delays and runs each call once', () => {
    const animator = new Animator()
    const card = { x: 0 }
    const done = vi.fn()
    animator.play(
      new Timeline().to(card, { x: 1 }, { duration: 100, delay: 50, ease: ease.linear }).call(done),
    )
    animator.advance(50)
    expect(card.x).toBe(0)
    animator.advance(50)
    expect(card.x).toBeCloseTo(0.5)
    animator.advance(50)
    animator.advance(50)
    expect(done).toHaveBeenCalledTimes(1)
  })

  it('nests timelines', () => {
    const animator = new Animator()
    const a = { x: 0 }
    const b = { x: 0 }
    const inner = new Timeline().to(b, { x: 1 }, { duration: 100, ease: ease.linear })
    animator.play(
      new Timeline().to(a, { x: 1 }, { duration: 100, ease: ease.linear }).add(inner, '<'),
    )
    animator.advance(50)
    expect([a.x, b.x]).toEqual([0.5, 0.5])
  })

  it('calls onUpdate on every change', () => {
    const animator = new Animator()
    const onUpdate = vi.fn()
    animator.tween({ x: 0 }, { x: 1 }, { duration: 100, onUpdate })
    animator.advance(50)
    animator.advance(50)
    // Once when it starts (time 0), then once per advance.
    expect(onUpdate).toHaveBeenCalledTimes(3)
  })

  it('wakes its owner when something starts playing while it was idle', () => {
    const animator = new Animator()
    const onWake = vi.fn()
    animator.onWake = onWake
    animator.tween({ x: 0 }, { x: 1 }, { duration: 100 })
    animator.tween({ x: 0 }, { x: 1 }, { duration: 100 })
    expect(onWake).toHaveBeenCalledTimes(1)
    // Nothing to wait for: done at once, no wake.
    animator.advance(100)
    animator.tween({ x: 0 }, { x: 1 }, { duration: 0 })
    expect(onWake).toHaveBeenCalledTimes(1)
    expect(animator.busy).toBe(false)
  })

  it('can jump an animation to its end or stop it where it is', async () => {
    const animator = new Animator()
    const a = { x: 0 }
    const b = { x: 0 }
    const toEnd = animator.tween(a, { x: 1 }, { duration: 100, ease: ease.linear })
    const stopped = animator.tween(b, { x: 1 }, { duration: 100, ease: ease.linear })
    animator.advance(50)
    toEnd.complete()
    stopped.cancel()
    animator.advance(50)
    expect(a.x).toBe(1)
    expect(b.x).toBeCloseTo(0.5)
    await expect(toEnd.finished).resolves.toBe('completed')
    await expect(stopped.finished).resolves.toBe('cancelled')
    expect(animator.busy).toBe(false)
  })

  it('completes or cancels everything at once', () => {
    const animator = new Animator()
    const card = { x: 0, y: 0 }
    animator.tween(card, { x: 1 }, { duration: 100 })
    animator.completeAll()
    expect(card.x).toBe(1)
    animator.tween(card, { y: 1 }, { duration: 100 })
    animator.cancelAll()
    expect(card.y).toBe(0)
    expect(animator.busy).toBe(false)
  })

  it('ignores time running backwards or not being a number', () => {
    const animator = new Animator()
    const card = { x: 0 }
    animator.tween(card, { x: 1 }, { duration: 100, ease: ease.linear })
    animator.advance(-50)
    animator.advance(Number.NaN)
    expect(card.x).toBe(0)
  })

  it('starts animations added by a callback on the next advance', () => {
    const animator = new Animator()
    const card = { x: 0 }
    animator.play(
      new Timeline().call(() => {
        animator.tween(card, { x: 1 }, { duration: 100, ease: ease.linear })
      }),
    )
    expect(animator.busy).toBe(true)
    animator.advance(50)
    expect(card.x).toBeCloseTo(0.5)
  })
})

describe('ease', () => {
  it.each(Object.entries(ease))('%s goes from 0 to 1', (_name, fn) => {
    expect(fn(0)).toBeCloseTo(0)
    expect(fn(1)).toBeCloseTo(1)
  })
})
