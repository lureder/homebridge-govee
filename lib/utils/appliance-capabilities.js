/**
 * What each appliance model can actually do.
 *
 * Appliance handlers are shared between models, which historically meant every
 * model in a group was given every control the group could offer - so a heater
 * without a turning head still got an oscillation switch that did nothing. This
 * map lets a shared handler offer only the controls a model really has, without
 * needing a separate file per model.
 *
 * A model that is not listed keeps the handler's full set of controls, so
 * adding an entry is opt-in and nothing changes for a model until it is
 * described here.
 */

/**
 * Heaters.
 *
 * ⚠️ Several models already in the plugin are believed not to have oscillation
 * (the H713A, H713B, H713C and H7135), but they have been offered it for a long
 * time. They are deliberately NOT restricted here: if any owner is using that
 * control today, taking it away would break a working setup for the sake of
 * tidiness. Restrict them only once an owner has confirmed the control does
 * nothing. New models are added with their real capabilities from the start,
 * where there is nobody to break.
 */
const heaterFeatures = {
  // Power and mode only - no turning head, no night light
  H7137: { swing: false, lock: false },
  H713E: { swing: false, lock: false },
}

const heaterDefaults = {
  swing: true,
  lock: true,
}

/**
 * Get the controls a heater model should offer.
 *
 * @param {string} model the govee model, eg 'H7130'
 * @returns {{ swing: boolean, lock: boolean }} the controls to offer
 */
export function getHeaterFeatures(model) {
  return { ...heaterDefaults, ...(heaterFeatures[model] || {}) }
}
