import { describe, expect, it } from 'vitest'

import { getHeaterFeatures } from './appliance-capabilities.js'

describe('appliance capabilities', () => {
  describe('heaters', () => {
    it('offers the full set to a model that is not described', () => {
      // Anything not listed keeps what the shared handler has always offered,
      // so adding an entry is opt-in and no existing model changes by accident
      expect(getHeaterFeatures('H7130')).toEqual({ swing: true, lock: true })
      expect(getHeaterFeatures('H713A')).toEqual({ swing: true, lock: true })
    })

    it('withholds controls the newer lite heaters do not have', () => {
      expect(getHeaterFeatures('H7137')).toEqual({ swing: false, lock: false })
      expect(getHeaterFeatures('H713E')).toEqual({ swing: false, lock: false })
    })

    it('copes with an unknown or missing model', () => {
      expect(getHeaterFeatures('NOPE')).toEqual({ swing: true, lock: true })
      expect(getHeaterFeatures(undefined)).toEqual({ swing: true, lock: true })
    })

    it('does not let a caller change the stored defaults', () => {
      const features = getHeaterFeatures('H7130')
      features.swing = false

      expect(getHeaterFeatures('H7130').swing).toBe(true)
    })
  })
})
