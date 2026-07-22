import { describe, expect, it } from 'vitest'
import { advance, dateKey, withSolved, type ActivityState } from './activity'

describe('activity streak maths', () => {
  it('starts a streak of 1 on the first ever visit', () => {
    expect(advance(null, '2026-07-22')).toEqual({
      date: '2026-07-22',
      streak: 1,
      solvedToday: 0,
    })
  })

  it('leaves state untouched when opened again the same day', () => {
    const prev: ActivityState = { date: '2026-07-22', streak: 4, solvedToday: 2 }
    expect(advance(prev, '2026-07-22')).toBe(prev)
  })

  it('increments the streak on the very next day and resets the daily count', () => {
    const prev: ActivityState = { date: '2026-07-22', streak: 4, solvedToday: 2 }
    expect(advance(prev, '2026-07-23')).toEqual({
      date: '2026-07-23',
      streak: 5,
      solvedToday: 0,
    })
  })

  it('resets the streak to 1 after a gap of two or more days', () => {
    const prev: ActivityState = { date: '2026-07-22', streak: 9, solvedToday: 3 }
    expect(advance(prev, '2026-07-25')).toEqual({
      date: '2026-07-25',
      streak: 1,
      solvedToday: 0,
    })
  })

  it('spans month and year boundaries by whole days', () => {
    const endOfMonth: ActivityState = { date: '2026-07-31', streak: 2, solvedToday: 0 }
    expect(advance(endOfMonth, '2026-08-01').streak).toBe(3)
    const endOfYear: ActivityState = { date: '2026-12-31', streak: 6, solvedToday: 1 }
    expect(advance(endOfYear, '2027-01-01').streak).toBe(7)
    expect(advance(endOfYear, '2027-01-03').streak).toBe(1)
  })
})

describe('withSolved', () => {
  it('adds to the daily solved count without touching the streak', () => {
    const state: ActivityState = { date: '2026-07-22', streak: 5, solvedToday: 1 }
    expect(withSolved(state)).toEqual({ date: '2026-07-22', streak: 5, solvedToday: 2 })
    expect(withSolved(state, 2).solvedToday).toBe(3)
  })
})

describe('dateKey', () => {
  it('formats a local calendar day as YYYY-MM-DD zero-padded', () => {
    expect(dateKey(new Date(2026, 0, 5))).toBe('2026-01-05')
    expect(dateKey(new Date(2026, 11, 31))).toBe('2026-12-31')
  })
})
