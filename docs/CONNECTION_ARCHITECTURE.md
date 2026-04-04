# Connection Architecture

This document describes how homebridge-govee communicates with Govee devices across its multiple connection methods.

## What Gets Activated Based on Config

| Config Provided | Connections Set Up | MQTT Channels | REST Polling |
|---|---|---|---|
| API key only | OpenAPI | OpenAPI MQTT | OpenAPI polling for all devices |
| Credentials only | AWS, BLE, HTTP | AWS IoT MQTT | AWS polling (60s), HTTP polling (sensors), BLE scanning |
| Both | All | AWS IoT MQTT + OpenAPI MQTT | AWS polling (60s), HTTP polling (sensors), BLE scanning. OpenAPI polling only for devices without AWS |

### Config Options

| Option | Type | Default | Description |
|---|---|---|---|
| `apiKey` | string | — | Govee OpenAPI key. Enables OpenAPI discovery, control, and MQTT. |
| `username` / `password` | string | — | Govee app credentials. Enables AWS, BLE, and HTTP connections. |
| `openApiDisable` | boolean | false | Disable OpenAPI connection entirely. |
| `openApiRefreshTime` | integer | 30 | OpenAPI polling interval in seconds (only for devices without AWS). |
| `awsDisable` | boolean | false | Disable AWS connection. |
| `bleDisable` | boolean | false | Disable BLE connection. |
| `lanDisable` | boolean | false | Disable LAN connection. |

## Send Priority

When a HomeKit command is issued, the plugin tries connections in this order:

```
LAN -> AWS -> OpenAPI -> BLE
```

The first successful connection returns immediately — remaining connections are skipped. If all fail, an error is thrown.

**Why this order:**
- **LAN** is fastest (local network, no cloud round-trip)
- **AWS** uses a persistent MQTT connection (fast) and has no rate limit
- **OpenAPI** is a REST call with a 10,000 req/day rate limit
- **BLE** is slowest (connection setup, one-at-a-time queue)

## Receive Channels

### Real-time (Push)

| Channel | Protocol | What It Receives | When Active |
|---|---|---|---|
| AWS IoT MQTT | MQTTS (X.509 certs) | Device state: on/off, brightness, color, mode, commands | Credentials provided |
| OpenAPI MQTT | MQTTS (API key auth) | Capability events: water alerts, presence, tank full, etc. | API key provided |
| LAN UDP | UDP port 4002 | Device status responses, scan responses | LAN not disabled |

### Polling

| Channel | Protocol | Interval | What It Polls | When Active |
|---|---|---|---|---|
| AWS | MQTT publish/subscribe | 60s | Device status requests | Credentials provided, devices need polling |
| OpenAPI | REST POST | `openApiRefreshTime` (default 30s) | Device state via capabilities | API key provided, **only for devices without AWS** |
| HTTP | REST GET | `httpRefreshTime` (default 30s) | Leak sensor warnings, thermo sensor data | Credentials provided, sensor devices exist |
| BLE | Bluetooth scan | `bleRefreshTime` (default 300s) | Sensor advertisements (temp, humidity, battery) | BLE not disabled, sensor devices exist |

### Why OpenAPI Polling Skips AWS Devices

When a device has an active AWS connection, it already receives:
1. Real-time state push via AWS IoT MQTT
2. Periodic status polling every 60 seconds

Adding OpenAPI polling on top would be redundant and waste the 10,000 req/day rate limit. OpenAPI polling only runs for devices that **don't** have AWS — typically when the user only provides an API key without app credentials.

## Per-Device Flags

Each accessory stores connection capability flags in its context:

| Flag | Meaning |
|---|---|
| `hasXxxControl` | The device supports this connection method (discovered during init) |
| `useXxxControl` | The connection is enabled AND the client exists |

Where `Xxx` is one of: `Aws`, `Ble`, `Lan`, `OpenApi`.

These flags are set during `initialiseDevice()` and determine which connections are attempted for each device in `sendDeviceUpdate()` and which devices are included in polling.

## Device Merging

Devices can be discovered via multiple sources:
1. **HTTP** (app credentials) — provides device list, BLE address, firmware info
2. **OpenAPI** (API key) — provides capabilities, supported commands, scene data
3. **LAN** (network scan) — provides IP address, LAN support confirmation

When a device appears in multiple sources, data is merged:
- HTTP-discovered devices get OpenAPI capabilities merged in (if the same device exists in both)
- LAN device info is merged with whichever source has the device
- The combined device object is passed to `initialiseDevice()`, which sets all relevant connection flags

## Command Flow

```
HomeKit User Input
  |
  v
Device Handler (e.g. light.js, humidifier-H7140.js)
  | calls platform.sendDeviceUpdate(accessory, { cmd, value })
  v
platform.js sendDeviceUpdate()
  | translates to connection-specific params:
  |   data.lanParams, data.awsParams, data.openApiParams, data.bleParams
  v
Connection Waterfall (LAN -> AWS -> OpenAPI -> BLE)
  | first success returns
  v
Connection Client (lan.js / aws.js / openapi.js / ble.js)
  | sends to physical device
  v
Device
```

## State Update Flow

```
Device State Change
  |
  v
Received via: AWS MQTT / OpenAPI MQTT / LAN UDP / REST polling / BLE scan
  |
  v
platform.js receiveUpdateXxx()
  | wraps in { source: 'XXX', state: { ... } }
  v
platform.js receiveDeviceUpdate()
  | normalizes to standard format:
  |   { state, brightness, rgb, kelvin, battery, temperature, humidity, commands, ... }
  v
accessory.control.externalUpdate(data)
  | device handler updates HomeKit characteristics
  v
HomeKit
```

## OpenAPI Commands Supported

Currently, OpenAPI supports these commands:

### Power & Light Commands

| Command | Description | OpenAPI Capability | Devices |
|---|---|---|---|
| `state` | Power on/off | `powerSwitch` | Lights |
| `brightness` | Brightness 0-100 | `brightness` | Lights |
| `color` | RGB color | `colorRgb` | Lights |
| `colorTem` | Color temperature (Kelvin) | `colorTemperatureK` | Lights |
| `lightScene` / `diyScene` | Dynamic scenes | `dynamic_scene` | Lights |
| `stateOutlet` | Power on/off | `powerSwitch` | Outlets, switches, taps, valves, coolers, heaters |
| `stateDual` | Dual switch control | `powerSwitch` | Double/triple outlets and switches |
| `stateHumi` | Power on/off | `powerSwitch` | Humidifiers, dehumidifiers, diffusers |
| `statePuri` | Power on/off | `powerSwitch` | Purifiers |
| `stateHeat` | Power on/off | `powerSwitch` | Heaters |

### Appliance Mode Commands (via `ptReal`/`multiSync` + `openApi` field)

Device handlers pass an `openApi` field alongside their base64 commands. When OpenAPI is available, the structured capability is used instead of the raw code.

| Operation | OpenAPI Capability | Instance | Devices |
|---|---|---|---|
| Speed/mode control | `work_mode` | `workMode` | Humidifiers, dehumidifiers, purifiers, fans, heaters, kettles, ice makers |
| Target temperature | `temperature_setting` | `targetTemperature` | Heaters (H7130, H7131, H7132) |
| Swing/oscillation | `toggle` | `oscillationToggle` | Heaters, fans |
| Night light on/off | `toggle` | `nightlightToggle` | Humidifiers (H7140, H7142, H7160), purifiers |
| Child lock | `toggle` | `lockToggle` | Heaters, purifiers |
| Display light | `toggle` | `displayToggle` | Purifiers (H7122-H712C) |

### Incoming State (OpenAPI → Device Handlers)

OpenAPI state responses and MQTT events are parsed into structured properties that device handlers process alongside the traditional hex command path:

| OpenAPI Capability | Parsed Property | Description |
|---|---|---|
| `workMode` | `data.workMode` | `{workMode, modeValue}` — mode and speed/value |
| Toggle instances | `data.toggles` | `{nightlightToggle, oscillationToggle, lockToggle, ...}` |
| `targetTemperature` | `data.targetTemperature` | `{temperature, unit}` |
| `humidity` (range) | `data.targetHumidity` | Target humidity percentage |
| `sensorTemperature` | `data.temperature` | Sensor reading (×100 for internal format) |
| `sensorHumidity` | `data.humidity` | Sensor reading (×100 for internal format) |

### Not Yet Mapped to OpenAPI

| Command | Reason |
|---|---|
| `rgbScene` (light scenes via raw codes) | Raw base64 codes don't map to OpenAPI scene paramId/id pairs |
| Night light brightness/color | Structured RGB+brightness value needs OpenAPI capability mapping |
| `ptReal`/`multiSync` without `openApi` field | Legacy commands from handlers not yet updated |
