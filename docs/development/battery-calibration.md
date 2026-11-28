# Battery scale calibration

Configuration exposes four localized calibration actions beside the information
icons for voltage/current scales of batteries1/2. The dialog accepts a positive
external instrument value (decimal dot or comma), displays fresh INAV telemetry,
and leaves EEPROM saving to Configuration's normal Save action.

## Supported transformations

| Channel | Supported source | New scale |
| --- | --- | --- |
| Voltage1 | ADC, Raw voltage source | S × reference / measured |
| Current1 | ADC | S × measured / reference |
| Voltage2 | ADC/I2C | S × (reference − voltageOffset) / (measured − voltageOffset) |
| Current2 | ADC/I2C | S × measured / reference |

Offsets are unchanged. Current offsets are subtracted before division in firmware
and are already represented by the measured current. First-battery INA226 and CAN,
ESC, SmartPort, CRSF, virtual/fake modes do not use these ADC scale transformations.
The actions are disabled for them. Sag-compensated voltage is not a raw ADC sample
and cannot be used for voltage1 calibration. Integer scales are rounded; zero or
out-of-range results are rejected, never clamped. A result equal to the old integer
scale reports unchanged and sends no write. In particular, the default I2C current2
scale2 has coarse integer resolution; small corrections can round to the same scale.

## State and transport

`batteryCalibration.js` owns calculation and the transaction controller.
`batteryCalibrationMsp.js` supplies fresh settings/state, preserves unrelated DOM
fields and performs one `MSPV2_SET_SETTING` using the existing setting encoder.
`batteryCalibrationDialog.js` only renders and calls injected read/apply functions.

Measurement and scale come from confirmed replies, never cached DOM strings.
Relevant unsaved source, scale, offset or monitoring changes must first be saved.
Reference parsing, positive/finite sample, presence, wire saturation, mode, integer
bounds and cancellation are checked before dispatch. Reads have bounded timeouts;
a pending encode is checked for cancellation again before sending. A second apply
cannot overlap. Readback confirms the actual scale even if an ACK was lost.

A 2-second settling interval accounts for existing 1Hz firmware filters. The dialog
then displays a new actual measurement, not a predicted match to the reference.
If telemetry is unavailable after confirmed application, it shows the confirmed
scale and a missing-value indicator until a real sample arrives.

An unresolved ACK can still be retried by the shared queue. On a 15-second ACK
timeout, or unconfirmable readback, calibration/Configuration Save remain blocked
for that session with a reconnect instruction. No automatic rollback or EEPROM
write is attempted. `MSP.connectionGeneration` advances on protocol/connection
cleanup, allowing reconnect to clear the guard even for transports that reuse IDs.
Old-session callbacks cannot send a new write, read back or mark the new session
uncertain. Closing a dialog before dispatch cancels its write; a command already
sent can complete and is reconciled without pretending it was undone.

## Firmware dependency

Battery1 already exposes `vbat_scale` and `current_meter_scale`. Battery2 calibration
requires the new `battery2_voltage_scale` and `battery2_current_scale` settings.
Older firmware without them keeps its existing manual fields; automatic battery2
calibration stays unavailable. No new MSP command or PG layout/version is required.

The associated firmware fix correctly parses15/20/21-byte battery2 configurations,
validates unsigned setting minima, and preserves stored battery2 scales/offsets at
initialization. Previous experimental boot heuristics could overwrite legitimate
calibration values and are removed. Factory defaults and explicit UI defaults on
source changes remain. Ordinary Save reads the updated scale fields and keeps the
existing EEPROM/reboot chain; recalculation itself never calls that chain.

## Verification

- `npm test`: full existing and added Node/browser suite; exact result in the task report.
- `tests/battery-calibration.test.mjs`: real formulas, validation, per-channel isolation,
  lost/refused ACK, readback, cancellation, serialization, pending telemetry, cleanup.
- `tests/battery-calibration-adapter.test.mjs`: production setting encoder, packet
  layouts, no EEPROM/reboot, modes, presence/saturation and connection races.
- Browser tests exercise dialog behavior and full configuration/CSS/jBox layouts
  at1920/1280/1024 widths. They use synthetic data, not attached instruments.
- Firmware tests exercise production packet decoder/minimum validation and repeated
  actual battery2 initialization with24 ADC/I2C configurations and nonzero offsets.

No product packaging or firmware image build is implied by these tests. Physical
instrument comparison, flash save/reboot and hardware telemetry remain bench work.
