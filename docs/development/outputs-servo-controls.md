# Outputs servo pulse controls

`tabs/outputs.js` builds the Servo Configuration rows from `FC.SERVO_CONFIG`.
Min/Mid/Max now accept mouse-wheel changes of 1 µs, or 10 µs with Shift. The
non-passive listener prevents native number-input stepping and page scrolling,
including at a limit. A Shift wheel represented as horizontal delta by the
platform is also supported. These are configuration values, not direct servo
position commands; Live Mode applies configuration through the firmware's normal
servo processing.

## Limits and centering

For the targeted INAV 10 firmware, `src/main/flight/servos.h` defines
`SERVO_OUTPUT_MIN=500` and `SERVO_OUTPUT_MAX=2500`. The `servo` CLI validation in
`src/main/fc/cli.c` uses these bounds and requires Min <= Mid <= Max. They match
the existing Outputs input bounds; no assumption of 750–2250 is used. The limits
are centralized in `js/servoOutputControls.js`; no MSP limit-discovery command is
provided by the current firmware.

Wheel and committed manual edits are integer/clamped. Min cannot pass Mid, Max
cannot pass Mid, and Mid is restricted to the current endpoints. Incomplete manual
input is allowed while typing, but is normalized on change and before transmitting
or saving; the symmetry action is disabled while input is invalid. Empty/nonfinite
input falls back to the last valid row values.

The ↔ button sits between Max and Rate. It computes
`halfSpan = round((Max - Min) / 2)`, then limits it to the smaller of its current
value, `Mid - 500` and `2500 - Mid`. It updates both endpoints as one transaction.
For 1000/1540/2000 the result is 1040/1540/2040. Odd spans use the required rounding;
a Mid at an absolute limit can produce a zero span. The amber highlight means
`2 * Mid != Min + Max`, not unsaved EEPROM state. Both actions and state descriptions
are localized in English/Russian.

## Live Mode and persistence

The existing serializer is `mspHelper.sendServoConfigurations`, which sends
`MSP2_INAV_SET_SERVO_CONFIG`, once per servo, in sequence. Its payload is index U8,
Min U16, Max U16, Mid U16, rate I8. Firmware `mspDeserializeServoParams` updates the
RAM parameters and recomputes servo scaling factors. This operation does not write
EEPROM.

Before this change, Outputs' live change handler called the entire save chain,
including `MSP_EEPROM_WRITE`. Live and persistent writes are now separated:

- Manual change, wheel and centering share `servoConfigurationChanged`.
- With Live off, only UI values change. Save reads those values normally.
- With Live on, the existing 10 ms delay is coalesced and only the standard servo
  serializer runs; it sends no EEPROM command or new direct position command.
- An in-flight live batch completes before another starts. Repeated pending edits
  coalesce; a requested save supersedes pending live work and reads the latest UI.
- Save retains `Settings.saveInputs`, servo serialization, advanced/misc/3D config
  writes and EEPROM as its last step. Save and Reboot uses that same sequence,
  then the existing reboot/reconnect path.
- Cleanup removes native listeners and cancels pending live work. A batch already
  handed to the MSP serializer may finish; it cannot start a queued follow-up.

No firmware, MSP format, mixer rule, servo rate or reverse behavior is changed.

## Verification

- Mathematical tests cover each field/direction, 1/10 µs steps, firmware limits,
  ordering, invalid/manual input, exact centering, odd and zero spans and edge shrink.
- Queue tests cover Live off, coalescing, serialized batches, save priority,
  duplicate queued saves, disabling Live and cleanup.
- The browser regression executes production `process_servos`, row HTML, pulse
  controls, the real MSP serializer, chainer and EEPROM/advanced/misc/3D helper
  methods. Only unrelated tab sections and transport/hardware are substituted.
  It checks actual servo packet contents, one batch for centering, no live EEPROM,
  Save waiting for a live batch, persistence/reload and Save/Reboot order. Two
  rows exercise row isolation, asymmetric state and unchanged rate/reverse.
- All 428 Configurator tests pass locally with the browser test enabled (no skips).
  The browser test uses an isolated Chrome profile and skips on systems without
  Chrome; `CHROME_BIN` can select a browser. `INAV_OUTPUTS_UI_PREVIEW` optionally
  writes a screenshot from the tested component, without a product build.

These are software/MSP-boundary checks. A physical bench test with secured aircraft
and propellers removed has not been performed. No product build or release is
created as part of this implementation.
