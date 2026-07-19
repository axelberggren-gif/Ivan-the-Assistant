import type { Opening } from '../types'
import { italianGame } from './italian'
import { queensGambit } from './queensGambit'
import { sicilianDefense } from './sicilian'
import { caroKann } from './caroKann'

export const openings: Opening[] = [queensGambit, caroKann, italianGame, sicilianDefense]
