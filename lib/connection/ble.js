import { Buffer } from 'node:buffer'

import btClient from '@stoprocent/noble'

import { base64ToHex, generateCodeFromHexValues, hexToTwoItems } from '../utils/functions.js'
import platformLang from '../utils/lang-en.js'

/*
  The necessary commands to send and functions are taken from and credit to:
  https://www.npmjs.com/package/govee-led-client
*/

export default class {
  constructor(platform) {
    this.log = platform.log
    this.platform = platform
    this.stateChange = false

    // Can only scan/connect/send if the noble stateChange is 'poweredOn'
    btClient.on('stateChange', (state) => {
      this.stateChange = state
      this.log.debug('[BLE] stateChange: %s.', state)
    })

    // Event listener for noble scanning start
    btClient.on('scanStart', () => {
      this.log.debug('[BLE] %s.', platformLang.bleStart)
    })

    // Event listener for noble scanning stop
    btClient.on('scanStop', () => {
      this.log.debug('[BLE] %s.', platformLang.bleStop)
    })

    // Event and log noble warnings
    btClient.on('warning', (message) => {
      this.log.warn('[BLE] %s.', message)
    })
  }

  async updateDevice(accessory, params) {
    // This is called by the platform on sending a device update via bluetooth
    accessory.logDebug(`starting BLE update with params [${JSON.stringify(params)}]`)

    // Check the noble state is ready for bluetooth action
    if (this.stateChange !== 'poweredOn') {
      throw new Error(`${platformLang.bleWrongState} [${this.stateChange}]`)
    }

    // Connect to the accessory
    btClient.reset()
    accessory.logDebug('attempting connection with device')
    const peripheral = await btClient.connectAsync(accessory.context.bleAddress)
    accessory.logDebug('connected to device')

    // Find the characteristic we need for controlling the device
    accessory.logDebug('looking for control characteristic')
    const { characteristics } = await peripheral.discoverAllServicesAndCharacteristicsAsync()
    const characteristic = Object.values(characteristics).find(char => char.uuid.replace(/-/g, '') === '000102030405060708090a0b0c0d1910')
    if (!characteristic) {
      accessory.logWarn('could not find control characteristic')
    }
    accessory.logDebug('found control characteristic')

    // Prepare the command - we can be sent either:
    // - a base64 action code (with params.cmd === 'ptReal')
    // - an array containing a varied amount of already-hex values
    const finalBuffer = params.cmd === 'ptReal'
      ? Buffer.from(hexToTwoItems(base64ToHex(params.data)).map(byte => `0x${byte}`))
      : generateCodeFromHexValues([0x33, params.cmd, params.data], true)

    // Send the data to the device
    accessory.logDebug(`[BLE] ${platformLang.sendingUpdate} [${finalBuffer.toString('hex')}]`)
    await characteristic.writeAsync(finalBuffer, true)

    // Disconnect from device
    accessory.logDebug('disconnecting from device')
    await peripheral.disconnectAsync()
    accessory.logDebug('disconnected from device - all done')
  }

  stopScan() {
    btClient.stopScanning()
  }
}
