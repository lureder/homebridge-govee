import { describe, expect, it } from 'vitest'

import { describeSources, modelControls, resolveControls, unconfirmedMissing } from './capabilities.js'

describe('working out what a device can do', () => {
  it('falls back to what the family usually offers', () => {
    const { controls, sources } = resolveControls({ model: 'H7130', family: 'heater1' })

    expect(controls.swing).toBe(true)
    expect(controls.lock).toBe(true)
    expect(sources.swing).toBe('family')
  })

  it('lets a written-down model take a control away', () => {
    // The H7137 has no turning head, and that was confirmed rather than assumed
    const { controls, sources } = resolveControls({ model: 'H7137', family: 'heater1' })

    expect(controls.swing).toBe(false)
    expect(sources.swing).toBe('model')
  })

  it('uses what the device itself reported', () => {
    const { controls, sources } = resolveControls({
      model: 'H7999',
      family: 'purifier',
      openApiCapabilities: { oscillationToggle: {}, sensorHumidity: {} },
    })

    expect(controls.swing).toBe(true)
    expect(controls.humiditySensor).toBe(true)
    expect(sources.swing).toBe('discovered')
  })

  it('trusts a written-down model over what the device reported', () => {
    // Govee has listed capabilities a device does not really have, so a model
    // someone checked wins
    const { controls, sources } = resolveControls({
      model: 'H7137',
      family: 'heater1',
      openApiCapabilities: { oscillationToggle: {} },
    })

    expect(controls.swing).toBe(false)
    expect(sources.swing).toBe('model')
  })

  it('never narrows a control just because the device did not mention it', () => {
    // The api staying quiet is not proof the device cannot do something, and
    // taking a control away would break a setup that works today
    const { controls } = resolveControls({
      model: 'H7130',
      family: 'heater1',
      openApiCapabilities: { powerSwitch: {} },
    })

    expect(controls.swing).toBe(true)
  })

  it('lets the owner turn a control off', () => {
    const { controls, sources } = resolveControls({
      model: 'H7130',
      family: 'heater1',
      deviceConf: { hideSwing: true },
    })

    expect(controls.swing).toBe(false)
    expect(sources.swing).toBe('config')
  })

  it('answers for a model nobody has written down', () => {
    // The whole point - an unknown model still gets a sensible answer
    const { controls } = resolveControls({ model: 'H9999', family: 'fan' })

    expect(controls).toMatchObject({ swing: true, lock: false, light: false })
  })

  it('gives nothing away for a device with no family and no entry', () => {
    const { controls } = resolveControls({ model: 'H9999' })

    expect(Object.values(controls).every(value => value === false)).toBe(true)
  })

  it('keeps offering controls that are only believed to be missing', () => {
    // These are written down but deliberately not applied, because someone may
    // be using them today. Applying one is a decision that needs an owner to
    // confirm it first, not something that should slip in
    Object.entries(unconfirmedMissing).forEach(([model, believed]) => {
      const { controls } = resolveControls({ model, family: 'heater2' })
      Object.keys(believed).forEach((control) => {
        expect(controls[control], `${model} lost its ${control}`).toBe(true)
      })
      expect(modelControls[model], `${model} is in both lists`).toBeUndefined()
    })
  })

  it('says where each answer came from', () => {
    const { sources } = resolveControls({
      model: 'H7137',
      family: 'heater1',
      openApiCapabilities: { sensorTemperature: {} },
    })

    const described = describeSources(sources)
    expect(described).toContain('swing from model')
    expect(described).toContain('temperatureSensor from discovered')
  })
})
