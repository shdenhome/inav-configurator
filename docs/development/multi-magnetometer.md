# Multi-magnetometer Configurator integration

The existing version-1 optional MSP_SENSOR_CONFIG tail and the 211-byte multi-IMU/
barometer state packet retain their layouts. Inventory flag bit 3 advertises the
multi-MAG protocol; bit 4 says the mode is enabled. The `multi_mag_enabled` setting
uses Settings.processHtml/saveInputs and the Configuration Save/Reboot chain. Older
firmware hides the unsupported setting and keeps existing single-compass behavior.

`MSP2_INAV_MULTI_MAG_STATE` (0x20A4) requests three bytes: cursor U8 and expected
inventory generation U16 little-endian (zero is wildcard). Version-1 replies have a
24-byte header and up to four 48-byte source records. Header: version/flags/total/
cursor/count/nextCursor U8; generation U16; captureUs, referenceUID, fallbackUID and
calibrationRunId U32. Next cursor 255 is end. Mode/calibrating/healthy/fallback are
header flag bits 0..3. A complete pass restarts once if generation or calibration
run changes; duplicate IDs/slots and truncated or inconsistent pages are rejected.
No partial inventory is exposed as a complete snapshot. Per-page receive times
prevent a delayed final page from making early pages look fresh.

Each record contains UID U32; stable slot/hardware/I2C bus/address U8; flags and
confidence U16; ageUs U32; raw XYZ I16; aligned calibrated XYZ I32; calibration state
and orientation quality U8; roll/pitch/yaw I16 decidegrees; sample count U16; failure
code U8 and three reserved bytes. Source flag bits 0..10 are detected, readable,
fresh, calibrated, calibrating, contributor, fallback, positive trust, orientation
valid, calibration failed and read error. Calibration states 0..4 are required,
running, successful, failed and unavailable during calibration. Positive confidence
is kept distinguishable from zero by the firmware quantizer.

Sensors retains the aggregate MAG graph. Its existing magnetometer checkbox also
controls every source card, keyed by stable UID, with physical slot label, hardware,
I2C endpoint, normalized XYZ, raw XYZ, confidence, participation, calibration outcome
and orientation/quality. Normalized values divide calibrated units by 1024; they
are explicitly not labelled gauss. Legacy aggregate decoding (/1090) is unchanged.
A zero-trust fallback retains a current graph and an explicit FALLBACK label. Missing
or uncalibrated/unoriented measurements produce gaps; missing devices do not remove
other source cards. A failed transport pass leaves known cards visible as no data.

Calibration uses the existing MSP_MAG_CALIBRATION command. In enabled supported
multi mode it first reads the old run ID, then follows the new run and each result;
it cannot declare completion from a stale completed snapshot. A hard-coded legacy
30-second countdown is retained only outside multi mode. Communication timeouts do
not announce success. Per-source failed/missing outcomes remain visible separately.
Cleanup suppresses late updates and removes the polling interval.

The Alignment tab hides the single-compass wizard/global compass editors in multi
mode, explains the Calibration workflow and skips their setters in its Save chain.
Manual board orientation and its save path remain available. Per-source orientation
is determined by firmware calibration, so no manual per-source setter is introduced.
The orientation quality percentage is an algorithmic comparison metric, not a
probability or heading-accuracy guarantee.

Validation: `yarn test` passes 440 tests locally, no skips. Eleven new pure/compatibility tests
cover the packet, paging/restart/failure, signed units, zero-trust fallback and
calibration run lifecycle. A browser test executes the production card-building
function with real jQuery and graph-rendering boundary stubs, checking source
identity, normalized/raw values, fallback, missing state, orientation, one checkbox
and retained cards after transport failure. Existing MSP test loaders are updated
for the new parser import. No product build or hardware test was run.

The checked-in `tests/fixtures/multi-mag-c-pages.json` was emitted by the actual
firmware C serializer. The JS test verifies all three 216-byte pages, twelve
unique source IDs, stable slots, request cursors and signed/quality fields.
The optional `INAV_MAG_UI_PREVIEW` browser-test path uses production graph helpers
and real D3 and writes a screenshot using synthetic measurements.

Automatic mounting detection currently searches 48 discrete orientations. Firmware
also checks its angular residual (10-degree acceptance limit); it does not promise
a solution for every arbitrary sensor mounting angle. An ambiguous/out-of-model
orientation is reported as invalid/failed and must not be presented as a usable
calibrated source. The screenshot is synthetic UI verification, not a physical
multi-compass test.

The multi-calibration UI timeout is 180 seconds: the firmware permits up to
120 seconds of acquisition, with 60 seconds reserved for per-source orientation
finalization and paged transport. A run still active after 120 seconds is not
misreported as timed out.

Configuration → Sensors and buses also lists the additional boot-detected
magnetometers as read-only numbered rows below the primary selector. Inventory
is fetched through the paged protocol after settings load, independently of
calibration status. One matching selected physical source is omitted; other
identical models are preserved. Endpoint details are available in the field
title. Runtime-disabled/unsupported firmware shows no invented extra devices,
and tab cleanup invalidates late inventory responses. The browser regression
checks the reported QMC5883 0x0D + LIS3MDL 0x1E case, changing the selection,
identical models on different buses and clearing the mode/inventory.
