import { describe, expect, it } from 'vitest'
import {
  actionRequestSchema,
  createGameRequestSchema,
  gameCodeSchema,
  joinGameRequestSchema,
  syncQuerySchema,
} from './schemas'

describe('createGameRequestSchema', () => {
  it('accepts a valid body and normalizes the name', () => {
    expect(createGameRequestSchema.parse({ name: '  Ada ', chatOn: true, videoOn: false })).toEqual(
      { name: 'Ada', chatOn: true, videoOn: false },
    )
  })

  it.each([
    ['missing name', { chatOn: true, videoOn: false }],
    ['empty name', { name: '  ', chatOn: true, videoOn: false }],
    ['name too long', { name: 'x'.repeat(21), chatOn: true, videoOn: false }],
    ['name not a string', { name: 42, chatOn: true, videoOn: false }],
    ['chatOn not a boolean', { name: 'Ada', chatOn: 'yes', videoOn: false }],
    ['videoOn missing', { name: 'Ada', chatOn: true }],
    ['extra field', { name: 'Ada', chatOn: true, videoOn: false, admin: true }],
    ['not an object', 'Ada'],
    ['null', null],
  ])('rejects %s', (_, body) => {
    expect(createGameRequestSchema.safeParse(body).success).toBe(false)
  })
})

describe('joinGameRequestSchema', () => {
  it('accepts a name alone or with switches', () => {
    expect(joinGameRequestSchema.parse({ name: 'Bo' })).toEqual({ name: 'Bo' })
    expect(joinGameRequestSchema.parse({ name: 'Bo', chatOn: false, videoOn: true })).toEqual({
      name: 'Bo',
      chatOn: false,
      videoOn: true,
    })
  })

  it.each([[{}], [{ name: '' }], [{ name: 'Bo', chatOn: 1 }], [{ name: 'Bo', code: 'BCDFG' }]])(
    'rejects %j',
    (body) => {
      expect(joinGameRequestSchema.safeParse(body).success).toBe(false)
    },
  )
})

describe('gameCodeSchema', () => {
  it('accepts codes case-insensitively and outputs the canonical form', () => {
    expect(gameCodeSchema.parse('bcd-fg')).toBe('BCDFG')
  })

  it.each(['ABCDE', 'BCDF', 'BCDFGH', 'BCDF1', '', 42])('rejects %j', (code) => {
    expect(gameCodeSchema.safeParse(code).success).toBe(false)
  })
})

describe('syncQuerySchema', () => {
  it('reads numbers from query strings', () => {
    expect(syncQuerySchema.parse({ cursor: '12', v: '3' })).toEqual({ cursor: 12, v: 3 })
    expect(syncQuerySchema.parse({})).toEqual({})
  })

  it('ignores unknown parameters', () => {
    expect(syncQuerySchema.parse({ cursor: '4', _: '123' })).toEqual({ cursor: 4 })
  })

  it.each([
    [{ cursor: '-1' }],
    [{ cursor: 'abc' }],
    [{ v: '1.5' }],
    [{ cursor: '' }],
    [{ cursor: ' 7' }],
    [{ cursor: '0x10' }],
    [{ cursor: '1e3' }],
    [{ cursor: 7 }],
  ])('rejects %j', (query) => {
    expect(syncQuerySchema.safeParse(query).success).toBe(false)
  })
})

describe('actionRequestSchema', () => {
  const base = { hand: 1, cursor: 10, v: 4 }

  it.each([
    { type: 'discard', cards: ['5H', 'KD'] },
    { type: 'cut' },
    { type: 'play', card: 'TS' },
    { type: 'go' },
    { type: 'ready' },
  ])('accepts %j', (action) => {
    expect(actionRequestSchema.parse({ ...base, action })).toEqual({ ...base, action })
  })

  it.each([
    ['the server-only start action', { ...base, action: { type: 'start' } }],
    ['an unknown action', { ...base, action: { type: 'fold' } }],
    ['three discards', { ...base, action: { type: 'discard', cards: ['5H', 'KD', '2C'] } }],
    ['one discard', { ...base, action: { type: 'discard', cards: ['5H'] } }],
    ['a bad card', { ...base, action: { type: 'play', card: '10S' } }],
    ['a lower-case card', { ...base, action: { type: 'play', card: 'ts' } }],
    ['an extra field in the action', { ...base, action: { type: 'go', card: '5H' } }],
    ['a missing hand number', { cursor: 1, v: 1, action: { type: 'go' } }],
    ['a negative cursor', { ...base, cursor: -1, action: { type: 'go' } }],
    ['a fractional version', { ...base, v: 1.5, action: { type: 'go' } }],
    ['a string hand number', { ...base, hand: '1', action: { type: 'go' } }],
  ])('rejects %s', (_, body) => {
    expect(actionRequestSchema.safeParse(body).success).toBe(false)
  })
})
