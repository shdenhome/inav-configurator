// Optional "MS" v1 tail of MSP_SENSOR_CONFIG; legacy six-byte replies stay valid.
export function parseMultiSensorInfo(data) {
    if (data.byteLength < 17 || data.getUint8(6) !== 77 || data.getUint8(7) !== 83 || data.getUint8(8) !== 1) {
        return null;
    }
    const flags = data.getUint8(9);
    return {
        imuEnabled: Boolean(flags & 1),
        baroEnabled: Boolean(flags & 2),
        telemetrySupported: Boolean(flags & 4),
        primaryImuTag: data.getUint8(10),
        accelerometers: [data.getUint8(11), data.getUint8(12), data.getUint8(13)],
        barometers: [data.getUint8(14), data.getUint8(15)],
        primaryBarometer: data.getUint8(16),
    };
}

// Remove one selected physical device, preserving other devices of the same type.
export function remainingSensorNames(hardware, selectedType, primaryIndex, names) {
    let excluded = hardware.findIndex(type => type > 1 && type === Number(selectedType));
    if (excluded < 0) {
        excluded = hardware[primaryIndex] > 1 ? primaryIndex : hardware.findIndex(type => type > 1);
    }
    return hardware.flatMap((type, index) => type > 1 && index !== excluded ? [names[type] || `#${type}`] : []);
}
