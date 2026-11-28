// The controller supplies fresh readings and performs validation/RAM writes.
// This view never sends MSP, predicts readings, or writes EEPROM.
export function openBatteryCalibrationDialog({
    $,
    jBox,
    i18n,
    title,
    unit,
    read,
    apply,
    isActive = () => true,
    onClose,
}) {
    const content = $('<div class="battery-calibration-dialog"></div>');
    const readings = $('<dl></dl>').appendTo(content);
    $('<dt>').text(i18n.getMessage('batteryCalibrationMeasured')).appendTo(readings);
    const value = $('<dd>').text('—').appendTo(readings);
    $('<dt>').text(i18n.getMessage('batteryCalibrationCurrentScale')).appendTo(readings);
    const scale = $('<dd>').text('—').appendTo(readings);
    const label = $('<label>')
        .text(i18n.getMessage('batteryCalibrationReference', [unit]))
        .appendTo(content);
    const reference = $('<input type="text" inputmode="decimal" autocomplete="off">').appendTo(label);
    reference.attr('aria-label', i18n.getMessage('batteryCalibrationReference', [unit]));
    reference.attr(
        'placeholder',
        i18n.getMessage(unit === 'A' ? 'batteryCalibrationPromptA' : 'batteryCalibrationPromptV')
    );
    $('<p>').text(i18n.getMessage('batteryCalibrationSaveHint')).appendTo(content);
    const status = $('<p role="status" aria-live="polite"></p>').appendTo(content);
    const buttons = $('<div class="modal__buttons"></div>').appendTo(content);
    const cancel = $('<button type="button" class="modal__button"></button>')
        .text(i18n.getMessage('batteryCalibrationCancel'))
        .appendTo(buttons);
    const recalculate = $('<button type="button" class="modal__button modal__button--main"></button>')
        .text(i18n.getMessage('batteryCalibrationRecalculate'))
        .appendTo(buttons);
    let closed = false,
        busy = false,
        activeRead = null,
        timer = null,
        awaitingSample = false,
        fatal = false,
        validationError = false;
    const active = () => !closed && isActive();
    const errors = new Set([
        'batteryCalibrationInvalidInput',
        'batteryCalibrationNoSample',
        'batteryCalibrationUnsupported',
        'batteryCalibrationUnsaved',
        'batteryCalibrationRange',
        'batteryCalibrationCommunication',
        'batteryCalibrationSettling',
        'batteryCalibrationUnconfirmed',
    ]);
    function message(error) {
        const key = errors.has(error?.code) ? error.code : 'batteryCalibrationCommunication';
        if (key === 'batteryCalibrationUnconfirmed') {
            fatal = true;
            awaitingSample = false;
            recalculate.prop('disabled', true);
        }
        if (fatal && key !== 'batteryCalibrationUnconfirmed') return;
        status.text(i18n.getMessage(key)).attr('data-error', key);
    }
    function display(snapshot) {
        if (!Number.isFinite(snapshot?.value) || !Number.isFinite(snapshot?.scale))
            throw Object.assign(new Error('Invalid sample'), { code: 'batteryCalibrationNoSample' });
        value.text(snapshot.value.toFixed(2) + ' ' + unit);
        scale.text(String(snapshot.scale));
    }
    function cleanup() {
        if (closed) return;
        closed = true;
        clearInterval(timer);
        onClose?.();
    }
    let modal,
        destroyed = false;
    function close() {
        cleanup();
        if (destroyed) return;
        destroyed = true;
        modal?.close();
        modal?.destroy();
    }
    function poll() {
        if (!active()) {
            close();
            return;
        }
        if (busy || activeRead) return;
        activeRead = Promise.resolve()
            .then(read)
            .then((snapshot) => {
                if (active()) {
                    display(snapshot);
                    if (awaitingSample) {
                        awaitingSample = false;
                        if (!fatal && !validationError)
                            status.text(i18n.getMessage('batteryCalibrationSuccess')).removeAttr('data-error');
                    }
                    if (!fatal && !validationError && status.attr('data-error'))
                        status.empty().removeAttr('data-error');
                }
            })
            .catch((error) => {
                if (active()) {
                    value.text('—');
                    if (awaitingSample) {
                        if (!validationError)
                            status.text(i18n.getMessage('batteryCalibrationAppliedNoSample')).removeAttr('data-error');
                    } else {
                        scale.text('—');
                        if (!validationError) message(error);
                    }
                }
            })
            .finally(() => {
                activeRead = null;
            });
    }
    function startPolling() {
        clearInterval(timer);
        if (active()) timer = setInterval(poll, 500);
    }
    async function submit() {
        if (!active() || busy || fatal) return;
        busy = true;
        clearInterval(timer);
        recalculate.prop('disabled', true);
        reference.prop('disabled', true);
        validationError = false;
        status.empty().removeAttr('data-error');
        try {
            if (activeRead) await activeRead;
            if (!active()) return;
            const result = await apply(reference.val());
            if (!active()) return;
            if (result?.pending && Number.isFinite(result.scale)) {
                awaitingSample = true;
                value.text('—');
                scale.text(String(result.scale));
                status.text(i18n.getMessage('batteryCalibrationAppliedNoSample'));
            } else {
                display(result);
                awaitingSample = false;
                status.text(
                    i18n.getMessage(result.unchanged ? 'batteryCalibrationUnchanged' : 'batteryCalibrationSuccess')
                );
            }
        } catch (error) {
            if (active()) {
                validationError =
                    error?.code === 'batteryCalibrationInvalidInput' || error?.code === 'batteryCalibrationRange';
                message(error);
            }
        } finally {
            busy = false;
            if (active()) {
                recalculate.prop('disabled', fatal);
                reference.prop('disabled', false);
                startPolling();
            } else close();
        }
    }
    reference.on('input', () => {
        if (validationError && !fatal) {
            validationError = false;
            status.empty().removeAttr('data-error');
        }
    });
    cancel.on('click', close);
    recalculate.on('click', submit);
    reference.on('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            submit();
        }
    });
    modal = new jBox('Modal', {
        title,
        content,
        closeOnClick: false,
        closeOnEsc: true,
        closeButton: true,
        onClose: cleanup,
    }).open();
    poll();
    startPolling();
    return { close, destroy: close };
}
