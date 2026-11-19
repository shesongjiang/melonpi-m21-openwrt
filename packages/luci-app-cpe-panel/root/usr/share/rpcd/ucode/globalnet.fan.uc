#!/usr/bin/env ucode

'use strict';

import { glob, readfile } from 'fs';

function read_text(path) {
	const value = readfile(path);
	return value == null ? null : trim(value);
}

function read_number(path) {
	const value = read_text(path);
	return value != null && match(value, /^-?[0-9]+$/) ? int(value) : null;
}

function find_fan() {
	for (let type_path in glob('/sys/class/thermal/cooling_device*/type')) {
		if (read_text(type_path) != 'pwm-fan')
			continue;

		const path = replace(type_path, /\/type$/, '');
		return {
			present: true,
			current_state: read_number(`${path}/cur_state`),
			max_state: read_number(`${path}/max_state`)
		};
	}

	return { present: false };
}

function find_temperature() {
	let fallback = null;

	for (let type_path in glob('/sys/class/thermal/thermal_zone*/type')) {
		const path = replace(type_path, /\/type$/, '');
		const temperature = read_number(`${path}/temp`);
		const zone = read_text(type_path);

		if (temperature == null)
			continue;

		if (zone && match(zone, /cpu/i))
			return { temperature, thermal_zone: zone };

		fallback ||= { temperature, thermal_zone: zone || '-' };
	}

	return fallback || { temperature: null, thermal_zone: '-' };
}

const methods = {
	info: {
		call: function() {
			return {
				...find_temperature(),
				fan: find_fan()
			};
		}
	}
};

return { 'globalnet.fan': methods };
