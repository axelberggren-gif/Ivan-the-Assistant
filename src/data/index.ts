import type { Opening } from '../types'
import { italianGame } from './italian'
import { queensGambit } from './queensGambit'
import { sicilianDefense } from './sicilian'

export const openings: Opening[] = [italianGame, queensGambit, sicilianDefense]
