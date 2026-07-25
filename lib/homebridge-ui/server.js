import { HomebridgePluginUiServer } from '@homebridge/plugin-ui-utils'

import platformConsts from '../utils/constants.js'

// Which config array each model category belongs in. The platform flattens
// every array into one lookup by device id, so this only decides which set of
// options the schema editor shows next to the entry. Sensor categories without
// an array of their own sit best in thermoDevices (the general sensor bucket).
const categoryToArray = {
  rgb: 'lightDevices',
  switchSingle: 'switchDevices',
  switchDouble: 'switchDevices',
  switchTriple: 'switchDevices',
  sensorLeak: 'leakDevices',
  sensorThermo: 'thermoDevices',
  sensorThermo4: 'thermoDevices',
  sensorMonitor: 'thermoDevices',
  sensorCO2: 'thermoDevices',
  sensorPresence: 'thermoDevices',
  sensorButton: 'thermoDevices',
  sensorContact: 'thermoDevices',
  fan: 'fanDevices',
  heater1: 'heaterDevices',
  heater2: 'heaterDevices',
  humidifier: 'humidifierDevices',
  dehumidifier: 'dehumidifierDevices',
  purifier: 'purifierDevices',
  diffuser: 'diffuserDevices',
  kettle: 'kettleDevices',
  iceMaker: 'iceMakerDevices',
  template: 'lightDevices',
}

class PluginUiServer extends HomebridgePluginUiServer {
  constructor() {
    super()

    // Used by the My Devices tab to know which config array a model belongs
    // in, built from the same model lists the plugin itself uses
    this.onRequest('/getModelMap', () => {
      const modelToArray = {}
      Object.entries(categoryToArray).forEach(([category, arrayKey]) => {
        (platformConsts.models[category] || []).forEach((model) => {
          modelToArray[model] = arrayKey
        })
      })
      return modelToArray
    })

    this.ready()
  }
}

(() => new PluginUiServer())()
