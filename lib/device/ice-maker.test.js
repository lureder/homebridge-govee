import { describe, expect, it } from 'vitest'

import { makeAccessory, makePlatform } from '../../test/harness.js'
import { base64ToHex } from '../utils/functions.js'
import deviceIceMaker from './ice-maker-H7172.js'

/**
 * Every one of these models sends `33 05 <size>`, but the older ones number the
 * sizes the opposite way round. Both families share this handler now, and the
 * order comes from the model.
 *
 * Getting this wrong swaps small and large silently - the device accepts the
 * command and makes the wrong ice - so it is pinned per model rather than left
 * to the shape of the code.
 */

function sizeByteFor(model, size) {
  const device = new deviceIceMaker(makePlatform(), makeAccessory(model))
  return base64ToHex(device.sizeCodes[size]).slice(4, 6)
}

describe('which byte means which ice size', () => {
  describe.each(['H7172', 'H717D', 'H8120'])('the older %s', (model) => {
    it('counts down, so small is the highest byte', () => {
      expect(sizeByteFor(model, 1)).toBe('03')
      expect(sizeByteFor(model, 2)).toBe('02')
      expect(sizeByteFor(model, 3)).toBe('01')
    })
  })

  describe.each(['H8121', 'H8122'])('the newer %s', (model) => {
    it('counts up, so small is the lowest byte', () => {
      expect(sizeByteFor(model, 1)).toBe('01')
      expect(sizeByteFor(model, 2)).toBe('02')
      expect(sizeByteFor(model, 3)).toBe('03')
    })
  })

  it('sends the same command bytes it always did', () => {
    // The codes used to be written out as base64 by hand; these are those exact
    // strings, so building them cannot have changed what goes on the wire
    const older = new deviceIceMaker(makePlatform(), makeAccessory('H7172'))
    expect(older.sizeCodes).toEqual({
      1: 'MwUDAAAAAAAAAAAAAAAAAAAAADU=',
      2: 'MwUCAAAAAAAAAAAAAAAAAAAAADQ=',
      3: 'MwUBAAAAAAAAAAAAAAAAAAAAADc=',
    })

    const newer = new deviceIceMaker(makePlatform(), makeAccessory('H8121'))
    expect(newer.sizeCodes).toEqual({
      1: 'MwUBAAAAAAAAAAAAAAAAAAAAADc=',
      2: 'MwUCAAAAAAAAAAAAAAAAAAAAADQ=',
      3: 'MwUDAAAAAAAAAAAAAAAAAAAAADU=',
    })
  })
})
