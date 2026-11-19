'use strict';

import MSPCodes from './../js/msp/MSPCodes';
import MSP from './../js/msp';
import GUI from './../js/gui';
import FC from './../js/fc';
import CONFIGURATOR from './../js/data_storage';
import interval from './../js/intervals';
import i18n from './../js/localization';
import { zeroPad } from './../js/helpers';
import dialog from '../js/dialog';
import store from './../js/store';
import { createMultiSensorCsvSchema } from '../js/multiSensorTelemetry.js';
import { createLegacyLogSchema, createSensorLogPoll, createSensorLogWriter } from '../js/sensorLogPoll.js';


const loggingTab = {};
loggingTab.initialize = function (callback) {
    var self = this;

    let loggingFileName = null;
    let readyToWrite = false;
    let writer = null;
    let csvSchema = null;
    let legacySchema = null;
    self.active = true;
    self.poller = null;
    self.stopping = false;

    function flushLogBuffer() {
        return writer ? writer.append(log_buffer.splice(0)) : Promise.resolve();
    }
    self.finishLogging = function () {
        self.active = false;
        self.poller?.cancel();
        interval.remove('log_data_poll');
        interval.remove('write_data');
        return flushLogBuffer();
    };

    if (GUI.active_tab !== this) {
        GUI.active_tab = this;
    }

    var requested_properties = [],
        samples = 0,
        log_buffer = [];

    if (CONFIGURATOR.connectionValid) {
        var get_motor_data = function () {
            MSP.send_message(MSPCodes.MSP_MOTOR, false, false, function () {
                MSP.send_message(MSPCodes.MSP_SENSOR_CONFIG, false, false, function () {
                    if (self.active && GUI.active_tab === loggingTab) load_html();
                });
            });
        }

        var load_html = function () {
            import('./logging.html?raw').then(({default: html}) => GUI.load(html, process_html));
        }

        MSP.send_message(MSPCodes.MSP_RC, false, false, get_motor_data);
    }

    function process_html() {
        // translate to user-selected language
        i18n.localize();;

        const info = FC.SENSOR_CONFIG.multiSensors;
        if (info?.telemetrySupported && info.imuEnabled) $('.properties input[name="MSP_RAW_IMU"]').closest('dt').next('dd').text(i18n.getMessage('loggingMultiImuColumns'));
        if (info?.telemetrySupported && info.baroEnabled) $('.properties input[name="MSP_ALTITUDE"]').closest('dt').next('dd').text(i18n.getMessage('loggingMultiBaroColumns'));

        // UI hooks
        $('a.log_file').on('click', prepare_file);

        $('a.logging').on('click', async function () {
            if (self.stopping) return;
            if (GUI.connected_to) {
                if (readyToWrite) {
                    var clicks = $(this).data('clicks');

                    if (!clicks) {
                        // reset some variables before start
                        samples = 0;
                        log_buffer = [];
                        requested_properties = [];

                        $('.properties input:checked').each(function () {
                            requested_properties.push($(this).prop('name'));
                        });

                        if (requested_properties.length) {
                            const info = FC.SENSOR_CONFIG.multiSensors;
                            csvSchema = createMultiSensorCsvSchema({
                                imu: info?.telemetrySupported && info.imuEnabled && requested_properties.includes('MSP_RAW_IMU'),
                                baro: info?.telemetrySupported && info.baroEnabled && requested_properties.includes('MSP_ALTITUDE'),
                            });
                            legacySchema = createLegacyLogSchema(requested_properties, FC);
                            const sessionFileName = loggingFileName;
                            writer = createSensorLogWriter(
                                text => window.electronAPI.appendFile(sessionFileName, text),
                                count => $('.samples').text(samples += count),
                                error => {
                                    console.error('Sensor CSV write failed:', error);
                                    GUI.log(i18n.getMessage('loggingSensorWriteFailed'));
                                    readyToWrite = false;
                                    self.poller?.cancel();
                                    self.poller = null;
                                    interval.remove('log_data_poll');
                                    interval.remove('write_data');
                                    $('.speed').prop('disabled', false);
                                    $('a.logging').text(i18n.getMessage('loggingStart')).data('clicks', false);
                                });
                            print_head();
                            self.poller = createSensorLogPoll(MSP, requested_properties.map(name=>MSPCodes[name]), csvSchema.headers.length > 0, crunch_data);
                            interval.add('log_data_poll', () => self.poller.poll().catch(error => console.error('Sensor CSV sample failed:', error)), parseInt($('select.speed').val()), true);
                            interval.add('write_data', () => { if (readyToWrite) flushLogBuffer(); }, 1000);

                            $('.speed').prop('disabled', true);
                            $(this).text(i18n.getMessage('loggingStop'));
                            $(this).data("clicks", !clicks);
                        } else {
                            GUI.log(i18n.getMessage('loggingErrorOneProperty'));
                        }
                    } else {
                        self.stopping = true;
                        self.poller?.cancel();
                        interval.remove('log_data_poll');
                        interval.remove('write_data');
                        try { await flushLogBuffer(); } catch { /* Reported by the writer. */ }
                        self.stopping = false;
                        self.poller = null;

                        $('.speed').prop('disabled', false);
                        $(this).text(i18n.getMessage('loggingStart'));
                        $(this).data("clicks", !clicks);
                    }
                } else {
                    GUI.log(i18n.getMessage('loggingErrorLogFile'));
                }
            } else {
                GUI.log(i18n.getMessage('loggingErrorNotConnected'));
            }
        });

        GUI.content_ready(callback);
    }

    function print_head() {
        log_buffer.push(['timestamp', ...legacySchema.headers, ...csvSchema.headers].join(','));
    }

    function crunch_data(snapshot, successful) {
        log_buffer.push([millitime(), ...legacySchema.values(successful), ...csvSchema.values(snapshot)].join(','));
    }

    function prepare_file() {
        if (self.poller || self.stopping) return;
        // create or load the file

        const date = new Date();
        const filename = 'inav_data_log_' + date.getFullYear() + '-'  + zeroPad(date.getMonth() + 1, 2) + '-'
                + zeroPad(date.getDate(), 2) + '_' + zeroPad(date.getHours(), 2) + zeroPad(date.getMinutes(), 2)
                + zeroPad(date.getSeconds(), 2);

        var options = {
            defaultPath: filename + '.csv',
            filters: [ { name: "CSV", extensions: ['csv'] }, { name: "TXT", extensions: ['txt'] } ]
        };
        dialog.showSaveDialog(options).then(result => {
            if (result.canceled) {
                return;
            }
            
            loggingFileName = result.filePath;
            readyToWrite = true;
            store.set('logging_file_name', loggingFileName);
            store.set('logging_file_ready', readyToWrite);
                          
        });
    }

    function millitime() {
        return new Date().getTime();
    }
};

loggingTab.cleanup = function (callback) {
    Promise.resolve(loggingTab.finishLogging?.()).catch(error=>console.error('Final sensor CSV flush failed:', error)).finally(()=>{ if (callback) callback(); });
};

export default loggingTab;
