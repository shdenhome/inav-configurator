# Per-timer ESC protocols (experimental V1)

Mixer probes MSP2 `0x20A5` (stored/resolved configuration) and `0x20A7`
(intrinsic timer capabilities). Unsupported or malformed replies hide the new
controls. This is capability detection, not a firmware-version guess. Old timer
mode/output mapping packet formats are unchanged.

For each group explicitly assigned the MOTORS role, a second selector offers DEFAULT and
firmware-advertised protocols, even before motor rules exist. AUTO and other
roles show a dash; their stored
protocol is retained, not applied. Presets and mixer profiles do not rewrite
protocol overrides. Timer IDs are firmware packed indices; the existing UI's
Timer group number is index+1, not a universally correct physical TIM number.

The global motor protocol remains a real default. Outputs displays MIXED only
when explicit MOTORS groups or allocated motor groups resolve to multiple
configured protocols. In MIXED the global protocol selector is hidden and the
explanation remains visible. The summary lists
each motor's output/group/protocol. The global-reset button changes only the
local override model; normal Save and Reboot applies it. It does not send a
motor command. Configured values are not a live waveform/boot-runtime report.

Save uses MSP2 `0x20A6`: `[1,count,{timer,configured}...]`, DEFAULT=255.
Mixer saves new rules/modes/settings before submitting protocols so the firmware
validates the proposed mapping. Explicit success `[1,0]` is required before
EEPROM/reboot; missing, rejected and malformed responses stop the save chain.
As with other tab saves, RAM writes preceding a failure are not transactional:
reconnect/reload and inspect settings after an error. No per-selector EEPROM
write or live timer reinitialization occurs.

V1 permits STANDARD plus one DShot speed. Other inherited uniform protocols keep
legacy behavior; mixed reversible motors, mixed DShot speeds, and mixed other
analog protocols are rejected. Intrinsic capability does not prove DMA is free;
firmware combined validation and boot initialization are authoritative.

The branch-local MSP IDs require coordination before upstream submission.
Automated decoder, validation and UI tests cannot substitute physical signal
validation. Before flight/release, test physical PWM/DShot, stop/disarm/failsafe,
telemetry, DMA/servo/LED conflicts, motor tests, both VTOL profiles, persistence
and old/new client compatibility on the intended controller.
