'use strict';

import MSPChainerClass from './../js/msp/MSPchainer';
import mspHelper from './../js/msp/MSPHelper';
import MSPCodes from './../js/msp/MSPCodes';
import MSP from './../js/msp';
import GUI from './../js/gui';
import FC from './../js/fc';
import interval from './../js/intervals';
import VTX from './../js/vtx';
import i18n from './../js/localization';
import Settings from './../js/settings';
import features from './../js/feature_framework';

const configurationTab = {};

function isIna226Selected($meterType) {
    const settingInfo = $meterType.data('setting-info');
    const selectedValue = Number.parseInt($meterType.val());

    return settingInfo?.table?.values?.[selectedValue] === 'INA226';
}

function labelIna226Option($meterType) {
    const values = $meterType.data('setting-info')?.table?.values || [];
    $meterType.find('option').each(function (index) {
        if (values[index] === 'INA226') {
            $(this).text(i18n.getMessage('configurationIna226SensorLabel'));
        }
    });
}

function updateIna226SettingsVisibility() {
    labelIna226Option($('#vbat_meter_type'));
    labelIna226Option($('#current_meter_type'));
    const usesIna226Voltage = isIna226Selected($('#vbat_meter_type'));
    const usesIna226Current = isIna226Selected($('#current_meter_type'));

    $('.ina226-common-setting').prop('hidden', !(usesIna226Voltage || usesIna226Current));
    $('.ina226-current-setting').prop('hidden', !usesIna226Current);
    $('.adc-voltage-setting').toggle(!usesIna226Voltage);
    $('.adc-current-setting').toggle(!usesIna226Current);
}

function updateBattery2SettingsVisibility() {
    const usesCan = ($('#battery2-voltage-enabled').prop('checked') && $('#battery2-voltage-sensor').val() === '1')
        || ($('#battery2-current-enabled').prop('checked') && $('#battery2-current-sensor').val() === '1');
    $('.battery2-can-id-setting').prop('hidden', !usesCan);
    const usesI2cCurrent = $('#battery2-current-sensor').val() === '0';
    $('.battery2-current-i2c-address-setting').prop('hidden', !usesI2cCurrent);
    $('#battery2-current-i2c-address').prop('disabled', !usesI2cCurrent || !$('#battery2-current-enabled').prop('checked'));
    $('#battery2-voltage-sensor').prop('disabled', !$('#battery2-voltage-enabled').prop('checked'));
    $('#battery2-current-sensor').prop('disabled', !$('#battery2-current-enabled').prop('checked'));
    $('#battery2-voltage-scale, #battery2-voltage-offset').prop('disabled', !$('#battery2-voltage-enabled').prop('checked'));
    const usesCalibratedCurrent = $('#battery2-current-enabled').prop('checked') && $('#battery2-current-sensor').val() !== '1';
    $('#battery2-current-scale, #battery2-current-offset').prop('disabled', !usesCalibratedCurrent);
    $('#battery2-voltage-scale, #battery2-voltage-offset').prop('disabled', !$('#battery2-voltage-enabled').prop('checked') || $('#battery2-voltage-sensor').val() === '1');
}

function updateMztcSettingsVisibility() {
    // The camera settings only reach the firmware over a UART, so the card is
    // meaningless until the peripheral is assigned in the Ports tab.
    $('.config-mztc').toggle(FC.isMztcPortAssigned());
}

// Applying a preset is an action on the firmware, not a stored value. The
// firmware writes the palette, brightness, contrast, enhancement, both denoise
// levels, the shutter mode and the correction interval, then reports them back.
// Sending MSP2_SET_MZTC_PRESET is what makes that happen. Saving the setting on
// its own would only record the label.
function applyMztcPreset(presetIndex, onDone) {
    MSP.send_message(MSPCodes.MSP2_SET_MZTC_PRESET, [presetIndex], false, function () {
        // Re-read every setting so the advanced fields show what the firmware
        // actually applied instead of the values the user was looking at.
        Settings.processHtml(onDone || function () {})();
    });
}

function bindMztcPresetSelector() {
    const $preset = $('#mztc_preset');
    if (!$preset.length) {
        return;
    }

    $preset.on('change', function () {
        const value = Number.parseInt($(this).val(), 10);
        if (Number.isNaN(value)) {
            return;
        }
        applyMztcPreset(value);
    });
}

configurationTab.initialize = function (callback, scrollPosition) {

    if (GUI.active_tab !== this) {
        GUI.active_tab = this;

    }

    var loadChainer = new MSPChainerClass();

    var loadChain = [
        mspHelper.loadFeatures,
        mspHelper.loadSensorAlignment,
        mspHelper.loadAdvancedConfig,
        mspHelper.loadVTXConfig,
        mspHelper.loadBoardAlignment,
        mspHelper.loadCurrentMeterConfig,
        mspHelper.loadMiscV2,
        mspHelper.loadSerialPorts,
        mspHelper.loadBattery2Config
    ];

    loadChainer.setChain(loadChain);
    loadChainer.setExitPoint(load_html);
    loadChainer.execute();

    var saveChainer = new MSPChainerClass();

    var saveChain = [
        mspHelper.saveAccTrim,
        mspHelper.saveAdvancedConfig,
        mspHelper.saveVTXConfig,
        mspHelper.saveCurrentMeterConfig,
        mspHelper.saveMiscV2,
        saveBattery2Config,
        saveSettings,
        mspHelper.saveToEeprom
    ];

    function saveSettings(onComplete) {
        Settings.saveInputs(onComplete);
    }

    function saveBattery2Config(onComplete) {
        if (!FC.BATTERY2.config_supported) {
            onComplete();
            return;
        }

        const config = FC.BATTERY2.config;
        config.voltage_scale = Math.round(parseFloat($('#battery2-voltage-scale').val()));
        config.voltage_offset = Math.round(parseFloat($('#battery2-voltage-offset').val()) * 100);
        config.current_scale = Math.round(parseFloat($('#battery2-current-scale').val()));
        config.current_offset = Math.round(parseFloat($('#battery2-current-offset').val()));
        config.voltage_enabled = $('#battery2-voltage-enabled').prop('checked') ? 1 : 0;
        config.voltage_sensor = parseInt($('#battery2-voltage-sensor').val(), 10);
        config.current_enabled = $('#battery2-current-enabled').prop('checked') ? 1 : 0;
        config.current_sensor = parseInt($('#battery2-current-sensor').val(), 10);
        config.can_battery_id = parseInt($('#battery2-can-id').val(), 10);
        config.current_i2c_address = parseInt($('#battery2-current-i2c-address').val(), 10);
        config.cells = parseInt($('#battery2-cells').val(), 10);
        config.cell_detect = Math.round(parseFloat($('#battery2-cell-detect').val()) * 100);
        config.cell_warning = Math.round(parseFloat($('#battery2-cell-warning').val()) * 100);
        config.cell_critical = Math.round(parseFloat($('#battery2-cell-critical').val()) * 100);

        mspHelper.saveBattery2Config(onComplete);
    }

    saveChainer.setChain(saveChain);
    saveChainer.setExitPoint(reboot);

    function reboot() {
        //noinspection JSUnresolvedVariable
        GUI.log(i18n.getMessage('configurationEepromSaved'));

        GUI.tab_switch_cleanup(function () {
            MSP.send_message(MSPCodes.MSP_SET_REBOOT, false, false, reinitialize);
        });
    }

    function reinitialize() {
        //noinspection JSUnresolvedVariable
        GUI.log(i18n.getMessage('deviceRebooting'));
        GUI.handleReconnect($('.tab_configuration a'));
    }

    function load_html() {
        import('./configuration.html?raw').then(({default: html}) => GUI.load(html, Settings.processHtml(process_html)));
    }

    function process_html(settingsPromise) {

        let i;

        // generate features
        var fcFeatures = FC.getFeatures();

        var features_e = $('.features');
        for (let i = 0; i < fcFeatures.length; i++) {
            var row_e,
                tips = [],
                feature_tip_html = '';

            if (fcFeatures[i].showNameInTip) {
                tips.push(i18n.getMessage("manualEnablingTemplate").replace("{name}", fcFeatures[i].name));
            }

            if (fcFeatures[i].haveTip) {
                tips.push(i18n.getMessage("feature" + fcFeatures[i].name + "Tip"));
            }

            if (tips.length > 0) {
                feature_tip_html = '<div class="helpicon cf_tip" title="' + tips.join("<br><br>") + '"></div>';
            }

            row_e = $('<div class="checkbox">' +
                '<input type="checkbox" data-bit="' + fcFeatures[i].bit + '" class="feature toggle" name="' + fcFeatures[i].name + '" title="' + fcFeatures[i].name + '"' +
                ' id="feature-' + fcFeatures[i].bit + '" ' +
                '>' +
                '<label for="feature-' + fcFeatures[i].bit + '">' +
                '<span data-i18n="feature' + fcFeatures[i].name + '"></span>' +
                '</label>' +
                feature_tip_html +
                '</div>');

            features_e.each(function () {
                if ($(this).hasClass(fcFeatures[i].group)) {
                    $(this).after(row_e);
                }
            });
        }

        features.updateUI($('.tab-configuration'), FC.FEATURES);

        // translate to user-selected language
       i18n.localize();;

        // VTX
        var config_vtx = $('.config-vtx');
        if (FC.VTX_CONFIG.device_type != VTX.DEV_UNKNOWN) {

            var vtx_band = $('#vtx_band');
            vtx_band.empty();
            var vtx_no_band_note = $('#vtx_no_band');
            if (FC.VTX_CONFIG.band < VTX.BAND_MIN || FC.VTX_CONFIG.band > VTX.BAND_MAX) {
                var noBandName = i18n.getMessage("configurationNoBand");
                $('<option value="0">' + noBandName + '</option>').appendTo(vtx_band);
                vtx_no_band_note.show();
            } else {
                vtx_no_band_note.hide();
            }
            for (var ii = 0; ii < VTX.BANDS.length; ii++) {
                var band_name = VTX.BANDS[ii].name;
                var option = $('<option value="' + VTX.BANDS[ii].code + '">' + band_name + '</option>');
                if (VTX.BANDS[ii].code == FC.VTX_CONFIG.band) {
                    option.prop('selected', true);
                }
                option.appendTo(vtx_band);
            }
            vtx_band.on('change', function () {
                FC.VTX_CONFIG.band = parseInt($(this).val());
            });

            var vtx_channel = $('#vtx_channel');
            vtx_channel.empty();
            for (var ii = VTX.CHANNEL_MIN; ii <= VTX.CHANNEL_MAX; ii++) {
                var option = $('<option value="' + ii + '">' + ii + '</option>');
                if (ii == FC.VTX_CONFIG.channel) {
                    option.prop('selected', true);
                }
                option.appendTo(vtx_channel);
            }
            vtx_channel.on('change', function () {
                FC.VTX_CONFIG.channel = parseInt($(this).val());
            });

            var vtx_power = $('#vtx_power');
            vtx_power.empty();
            for (var ii = FC.VTX_CONFIG.power_min; ii <= FC.VTX_CONFIG.power_count; ii++) {
                var option = $('<option value="' + ii + '">' + ii + '</option>');
                if (ii == FC.VTX_CONFIG.power) {
                    option.prop('selected', true);
                }
                option.appendTo(vtx_power);
            }
            vtx_power.on('change', function () {
                FC.VTX_CONFIG.power = parseInt($(this).val());
            });

            var vtx_low_power_disarm = $('#vtx_low_power_disarm');
            vtx_low_power_disarm.empty();
            for (var ii = VTX.LOW_POWER_DISARM_MIN; ii <= VTX.LOW_POWER_DISARM_MAX; ii++) {
                var name = i18n.getMessage("configurationVTXLowPowerDisarmValue_" + ii);
                if (!name) {
                    name = ii;
                }
                var option = $('<option value="' + ii + '">' + name + '</option>');
                if (ii == FC.VTX_CONFIG.low_power_disarm) {
                    option.prop('selected', true);
                }
                option.appendTo(vtx_low_power_disarm);
            }
            vtx_low_power_disarm.on('change', function () {
                FC.VTX_CONFIG.low_power_disarm = parseInt($(this).val());
            });

            config_vtx.show();
        } else {
            config_vtx.hide();
        }

        // for some odd reason chrome 38+ changes scroll according to the touched select element
        // i am guessing this is a bug, since this wasn't happening on 37
        // code below is a temporary fix, which we will be able to remove in the future (hopefully)
        //noinspection JSValidateTypes
        $('#content').scrollTop((scrollPosition) ? scrollPosition : 0);

        // fill board alignment
        $('input[name="board_align_yaw"]').val((FC.BOARD_ALIGNMENT.yaw / 10.0).toFixed(1));

        // fill magnetometer
        //UPDATE: moved to GPS tab and hidden
        //$('#mag_declination').val(FC.MISC.mag_declination);

        // fill battery voltage
        $('#voltagesource').val(FC.MISC.voltage_source);
        $('#cells').val(FC.MISC.battery_cells);
        $('#celldetectvoltage').val(FC.MISC.vbatdetectcellvoltage);
        $('#mincellvoltage').val(FC.MISC.vbatmincellvoltage);
        $('#maxcellvoltage').val(FC.MISC.vbatmaxcellvoltage);
        $('#warningcellvoltage').val(FC.MISC.vbatwarningcellvoltage);
        $('#voltagescale').val(FC.MISC.vbatscale);

        // fill current
        $('#currentscale').val(FC.CURRENT_METER_CONFIG.scale);
        $('#currentoffset').val(FC.CURRENT_METER_CONFIG.offset / 10);

        if (FC.BATTERY2.config_supported) {
            $('.battery2-section').prop('hidden', false);
            const supportsBattery2Adc = FC.CONFIG.target === 'MATEKH743';
            $('#battery2-voltage-sensor option[value="2"], #battery2-current-sensor option[value="2"]').prop('hidden', !supportsBattery2Adc);
            const config = FC.BATTERY2.config;
            $('#battery2-voltage-scale').val(config.voltage_scale);
            $('#battery2-voltage-offset').val((config.voltage_offset / 100).toFixed(2));
            $('#battery2-current-scale').val(config.current_scale);
            $('#battery2-current-offset').val(config.current_offset);
            $('#battery2-voltage-enabled').prop('checked', config.voltage_enabled !== 0);
            $('#battery2-voltage-sensor').val(config.voltage_sensor);
            $('#battery2-current-enabled').prop('checked', config.current_enabled !== 0);
            $('#battery2-current-sensor').val(config.current_sensor);
            $('#battery2-can-id').val(config.can_battery_id);
            $('#battery2-current-i2c-address').val(config.current_i2c_address || 69);
            $('#battery2-cells').val(config.cells);
            $('#battery2-cell-detect').val((config.cell_detect / 100).toFixed(2));
            $('#battery2-cell-warning').val((config.cell_warning / 100).toFixed(2));
            $('#battery2-cell-critical').val((config.cell_critical / 100).toFixed(2));
            $('#battery2-voltage-enabled, #battery2-current-enabled').on('change', updateBattery2SettingsVisibility);
            $('#battery2-voltage-sensor').on('change', function () {
                const voltageScale = parseInt($('#battery2-voltage-scale').val(), 10);
                if ($(this).val() === '2' && voltageScale === 1000) {
                    $('#battery2-voltage-scale').val(2100);
                } else if ($(this).val() === '0' && voltageScale === 2100) {
                    $('#battery2-voltage-scale').val(1000);
                }
                updateBattery2SettingsVisibility();
            });
            $('#battery2-current-sensor').on('change', function () {
                const adcDefaultScale = FC.CURRENT_METER_CONFIG.scale || 250;
                const currentScale = parseInt($('#battery2-current-scale').val(), 10);
                if ($(this).val() === '2' && currentScale === 2) {
                    $('#battery2-current-scale').val(adcDefaultScale);
                    $('#battery2-current-offset').val(FC.CURRENT_METER_CONFIG.offset || 0);
                } else if ($(this).val() === '0' && currentScale === adcDefaultScale) {
                    $('#battery2-current-scale').val(2);
                    $('#battery2-current-offset').val(0);
                }
                updateBattery2SettingsVisibility();
            });
            updateBattery2SettingsVisibility();
        }

        // fill battery capacity
        $('#battery_capacity').val(FC.MISC.battery_capacity);
        let batCapWarn = Math.round(FC.MISC.battery_capacity_warning * 100 / FC.MISC.battery_capacity);
        $('#battery_capacity_warning').val(isNaN(batCapWarn) ? "" : batCapWarn);
        let batCapWarnCrit = Math.round(FC.MISC.battery_capacity_critical * 100 / FC.MISC.battery_capacity);
        $('#battery_capacity_critical').val(isNaN(batCapWarnCrit) ? "" : batCapWarnCrit);
        $('#battery_capacity_unit').val(FC.MISC.battery_capacity_unit);

        let $i2cSpeed = $('#i2c_speed'),
            $i2cSpeedInfo = $('#i2c_speed-info');

        $i2cSpeed.on('change', function () {
            let $this = $(this),
                value = $this.children("option:selected").text();

            if (value == "400KHZ") {

                $i2cSpeedInfo.removeClass('ok-box');
                $i2cSpeedInfo.addClass('info-box');
                $i2cSpeedInfo.removeClass('warning-box');

                $i2cSpeedInfo.html(i18n.getMessage('i2cSpeedSuggested800khz'));
                $i2cSpeedInfo.show();

            } else if (value == "800KHZ") {
                $i2cSpeedInfo.removeClass('ok-box');
                $i2cSpeedInfo.removeClass('info-box');
                $i2cSpeedInfo.removeClass('warning-box');
                $i2cSpeedInfo.hide();
            } else {
                $i2cSpeedInfo.removeClass('ok-box');
                $i2cSpeedInfo.removeClass('info-box');
                $i2cSpeedInfo.addClass('warning-box');
                $i2cSpeedInfo.html(i18n.getMessage('i2cSpeedTooLow'));
                $i2cSpeedInfo.show();
            }

        });

        // Wait for settings to load before triggering change event
        settingsPromise.then(function() {
            $i2cSpeed.trigger('change');
            $('#vbat_meter_type, #current_meter_type').on('change', updateIna226SettingsVisibility);
            updateIna226SettingsVisibility();
            updateMztcSettingsVisibility();
            bindMztcPresetSelector();
        }).catch(function(error) {
            console.error('Settings load failed, dependent controls not initialized:', error);
        });

        $('a.save').on('click', function () {
            //UPDATE: moved to GPS tab and hidden
            //FC.MISC.mag_declination = parseFloat($('#mag_declination').val());

            FC.MISC.battery_cells = parseInt($('#cells').val());
            FC.MISC.voltage_source = parseInt($('#voltagesource').val());
            FC.MISC.vbatdetectcellvoltage = parseFloat($('#celldetectvoltage').val());
            FC.MISC.vbatmincellvoltage = parseFloat($('#mincellvoltage').val());
            FC.MISC.vbatmaxcellvoltage = parseFloat($('#maxcellvoltage').val());
            FC.MISC.vbatwarningcellvoltage = parseFloat($('#warningcellvoltage').val());
            FC.MISC.vbatscale = parseInt($('#voltagescale').val());

            FC.MISC.battery_capacity = parseInt($('#battery_capacity').val());
            FC.MISC.battery_capacity_warning = parseInt($('#battery_capacity_warning').val() * FC.MISC.battery_capacity / 100);
            FC.MISC.battery_capacity_critical = parseInt($('#battery_capacity_critical').val() * FC.MISC.battery_capacity / 100);
            FC.MISC.battery_capacity_unit = $('#battery_capacity_unit').val();

            features.reset();
            features.fromUI($('.tab-configuration'));
            features.execute(function () {
                FC.CURRENT_METER_CONFIG.scale = parseInt($('#currentscale').val());
                FC.CURRENT_METER_CONFIG.offset = Math.round(parseFloat($('#currentoffset').val()) * 10);
                saveChainer.execute();
            });
        });
        interval.add('config_load_analog', function () {
            $('#batteryvoltage').val([FC.ANALOG.voltage.toFixed(2)]);
            $('#batterycurrent').val([FC.ANALOG.amperage.toFixed(2)]);
        }, 100, true); // 10 fps

        interval.add('config_load_battery2', function () {
            if (!FC.BATTERY2.state_supported) {
                $('#battery2-voltage, #battery2-current').val('—');
                return;
            }
            const fresh = Date.now() - FC.BATTERY2.last_received_timestamp < 3000;
            const validState = FC.BATTERY2.state >= 0 && FC.BATTERY2.state <= 2;
            const available = fresh && FC.BATTERY2.present && validState;
            $('#battery2-voltage').val(available ? `${FC.BATTERY2.voltage.toFixed(2)} V` : '—');
            $('#battery2-current').val(available ? `${FC.BATTERY2.current.toFixed(2)} A` : '—');
        }, 100, true);

        GUI.content_ready(callback);
    }
};

configurationTab.cleanup = function (callback) {
    interval.remove('config_load_analog');
    interval.remove('config_load_battery2');
    if (callback) callback();
};

export default configurationTab;
