# Individual multi-sensor graphs and logs

Requires firmware advertising bit 2 in the version-1 optional multi-sensor
inventory tail of MSP_SENSOR_CONFIG. Earlier firmware keeps its existing
aggregate graphs and CSV columns; firmware version numbers alone are not used
as a capability test.

The Sensors tab adds per-source gyroscope/accelerometer cards and barometer
cards under the existing type checkboxes. Physical numbering stays stable if
the selected primary IMU changes. Each IMU shows XYZ, trust and sample state;
barometers show pressure and altitude relative to the common ground datum.
Raw uncalibrated acceleration is explicitly labelled, and missing samples
produce graph gaps. One shared request is limited to 20 Hz; slower selected
graph rates still apply.

In Logging, selecting raw IMU includes all individual IMUs; selecting altitude
includes both barometers. This adds 86 columns when both multi modes/types are
selected, without replacing aggregate fields. Column names carry source and
units; metadata includes types, confidence (0..1000), calibration, validity,
contributor flags and microsecond sample ages. Empty measurements mean missing
or invalid samples, not zero. Header width and order stay fixed during a session.

MSP2_INAV_MULTI_SENSOR_STATE (0x20A3), version 1, is a 211-byte read-only packet:
8-byte header, three 51-byte IMUs ordered by physical tag, two 25-byte barometers.
Wire integers are little-endian; gyro is millidegrees/s, acceleration millig,
pressure Pa, temperature hundredths C and altitude cm. Presentation/CSV convert
to degrees/s, g, C and metres. Source polling and state reads finish in response
callbacks. Late replies are ignored after cancellation or tab changes.

CSV sampling waits for the requested responses and prevents overlapping batches.
Failed groups receive blank cells; file appends remain in order. Stop and tab
cleanup flush the remaining rows. Write errors stop polling and permit selection
of another file. Existing field selections and legacy column order are retained.

Tests cover packet parsing, all physical source series, missing/uncalibrated
states, CSV shape, response order, cancellation and file-write order/errors.
The complete Configurator test suite passes (413 cases). Actual connected UI,
CSV recording and on-board Blackbox tests remain bench acceptance work. No
packaged build is performed by this change.
