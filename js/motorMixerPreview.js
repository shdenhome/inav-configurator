// Match motors to schematic positions by their roll/pitch signs, not list order.
function positionKey(rule) {
    const axis = value => Math.abs(value) < 0.1 ? 0 : Math.sign(value);
    return [axis(rule.getRoll()), axis(rule.getPitch())].join(',');
}

export function getMotorPreviewLabels(presetRules, rules, outputMap) {
    return presetRules.map((presetRule, index) => {
        const motorNumbers = rules.flatMap((rule, motorIndex) =>
            rule.getThrottle() !== 0 && positionKey(rule) === positionKey(presetRule) ? [motorIndex + 1] : []);
        const outputs = outputMap.flatMap((assignment, outputIndex) => {
            const match = /^Motor (\d+)$/.exec(assignment);
            return match && motorNumbers.includes(Number(match[1])) ? ['S' + (outputIndex + 1)] : [];
        });
        return { baseNumber: index + 1, outputs };
    });
}
