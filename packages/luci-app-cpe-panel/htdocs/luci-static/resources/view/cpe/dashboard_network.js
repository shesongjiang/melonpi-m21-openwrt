'use strict';
'require network';
'require poll';
'require rpc';
'require uci';
'require view';

function ensureStylesheet() {
	if (document.getElementById('cpe-overview-styles'))
		return;

	const link = document.createElement('link');
	link.id = 'cpe-overview-styles';
	link.rel = 'stylesheet';
	link.href = L.resource('view/cpe/overview.css');
	document.head.appendChild(link);
}

const callSystemBoard = rpc.declare({
	object: 'system',
	method: 'board'
});

const callSystemInfo = rpc.declare({
	object: 'system',
	method: 'info'
});

const callDHCPLeases = rpc.declare({
	object: 'luci-rpc',
	method: 'getDHCPLeases',
	expect: { '': {} }
});

const callModemInfo = rpc.declare({
	object: 'modem_ctrl',
	method: 'info'
});

const callFanInfo = rpc.declare({
	object: 'globalnet.fan',
	method: 'info'
});

const callMwan3Status = rpc.declare({
	object: 'mwan3',
	method: 'status',
	expect: { '': {} }
});

const callNetworkHealth = rpc.declare({
 object: 'cpe_network', method: 'status', expect: { '': {} }
});

function icon(name) {
	return E('svg', {
		'class': 'cpe-icon',
		'aria-hidden': 'true'
	}, [
		E('use', { 'href': L.resource('view/cpe/icons.svg') + '#' + name })
	]);
}

function text(value, fallback) {
	if (value == null || value === '')
		return fallback || '-';

	return String(value);
}

function firstAddress(addresses) {
	return Array.isArray(addresses) && addresses.length
		? String(addresses[0]).replace(/\/\d+$/, '')
		: '-';
}

function ipv4ToInt(address) {
	const parts = String(address || '').split('.');

	if (parts.length !== 4)
		return null;

	let value = 0;
	for (const part of parts) {
		const octet = Number(part);
		if (!Number.isInteger(octet) || octet < 0 || octet > 255)
			return null;

		value = (value << 8) | octet;
	}

	return value >>> 0;
}

function addressInSubnet(address, cidr) {
	const parts = String(cidr || '').split('/');
	const addressValue = ipv4ToInt(address);
	const networkValue = ipv4ToInt(parts[0]);
	const prefix = Number(parts[1]);

	if (addressValue == null || networkValue == null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32)
		return false;

	const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
	return (addressValue & mask) === (networkValue & mask);
}

function formatMemory(bytes) {
	if (!Number.isFinite(bytes) || bytes <= 0)
		return '-';

	return '%1024.1mB'.format(bytes);
}

function formatTemperature(millicelsius) {
	if (!Number.isFinite(millicelsius))
		return '-';

	return '%0.1f C'.format(millicelsius / 1000);
}

function normalizeModemKey(value) {
	return String(value || '')
		.trim()
		.toLowerCase()
		.replace(/[_-]+/g, ' ')
		.replace(/\s+/g, ' ');
}

function findModemEntry(entries, aliases) {
	for (const alias of aliases.map(normalizeModemKey)) {
		const item = entries.find((entry) => [ entry.key, entry.name, entry.full_name ]
			.some((key) => normalizeModemKey(key) === alias));

		if (item && item.value != null && item.value !== '')
			return item;
	}

	return null;
}

function findModemValue(entries, aliases) {
	const item = findModemEntry(entries, aliases);
	return item ? text(item.value) : '-';
}

function modemSignal(entries) {
	const metrics = [
		{ aliases: [ 'rsrp', 'lte rsrp', 'nr rsrp', '5g rsrp' ], label: 'RSRP', min: -160, max: -20, percent: (v) => (v + 130) * 2 },
		{ aliases: [ 'rssi', 'lte rssi', 'nr rssi' ], label: 'RSSI', min: -130, max: 0, percent: (v) => (v + 110) * 100 / 60 },
		{ aliases: [ 'csq' ], label: 'CSQ', min: 0, max: 31, percent: (v) => v * 100 / 31 },
		{ aliases: [ 'signal', 'signal strength' ], label: 'Signal', min: 0, max: 100, percent: (v) => v }
	];

	for (const metric of metrics) {
		const item = findModemEntry(entries, metric.aliases);
		if (!item)
			continue;
		const match = String(item.value).replace(',', '.').match(/-?\d+(?:\.\d+)?/);
		if (!match)
			continue;
		const value = Number(match[0]);
		if (!Number.isFinite(value) || value < metric.min || value > metric.max)
			continue;

		return {
			label: metric.label,
			raw: text(item.value),
			percent: Math.round(Math.max(0, Math.min(100, metric.percent(value))))
		};
	}

	return { label: null, raw: findModemValue(entries, [ 'signal', 'csq', 'rsrp', 'rssi' ]), percent: null };
}

return view.extend({
	load() {
		return Promise.all([
			L.resolveDefault(callSystemBoard(), {}),
			L.resolveDefault(callSystemInfo(), {}),
			L.resolveDefault(network.getWANNetworks(), []),
			L.resolveDefault(network.getWifiDevices(), []),
			L.resolveDefault(network.getWifiNetworks(), []),
			L.resolveDefault(network.getHostHints(), null),
			L.resolveDefault(callDHCPLeases(), {}),
			L.resolveDefault(callModemInfo(), {}),
			L.resolveDefault(callFanInfo(), {}),
			L.resolveDefault(network.getNetwork('lan'), null),
			L.resolveDefault(callMwan3Status(), {}),
			L.resolveDefault(uci.load('mwan3'), null)
		]).then((data) => {
			const wifiNetworks = data[4] || [];
			return Promise.all(wifiNetworks.map((wifi) =>
				L.resolveDefault(wifi.getAssocList(), [])
			)).then((associations) => Promise.all([associations, L.resolveDefault(callNetworkHealth(), {})]).then((extra) => data.concat(extra)));
		});
	},

	card(title, iconName, body, options) {
		options = options || {};
		return E('section', {
			'class': 'cpe-card ' + (options.className || '')
		}, [
			E('header', { 'class': 'cpe-card__header' }, [
				E('span', { 'class': 'cpe-card__icon' }, [ icon(iconName) ]),
				E('h2', {}, [ title ]),
				options.badge || E([])
			]),
			E('div', { 'class': 'cpe-card__body' }, body),
			options.footer || E([])
		]);
	},

	badge(label, online) {
		return E('span', {
			'class': 'cpe-badge ' + (online ? 'is-online' : 'is-offline')
		}, [ label ]);
	},

	rows(items) {
		return E('dl', { 'class': 'cpe-facts' }, items.map((item) => [
			E('dt', {}, [ item[0] ]),
			E('dd', {}, [ item[1] ])
		]).flat());
	},

	link(label, path, style) {
		return E('a', {
			'class': 'cpe-link ' + (style || ''),
			'href': L.url.apply(L, path)
		}, [ label ]);
	},

	getWan(wans) {
		const sorted = (wans || []).slice().sort((a, b) => a.getMetric() - b.getMetric());
		return sorted.find((item) => item.isUp()) || sorted[0];
	},

	isCellularInterface(name, modemInterfaces) {
		name = String(name || '').toLowerCase();
		return modemInterfaces.has(name) ||
			/(^|[-_.])(wwan|modem|cell|lte|nr|5g|4g|qmi|mbim|ncm|rndis|rmnet|usb)([-_.]|$)/.test(name) ||
			/^(wwan|modem|cell|lte|nr|5g|4g|qmi|mbim|ncm|rndis|rmnet|usb)/.test(name);
	},

	getUplinkRoutes(wans, mwanData, health) {
		const mwanInterfaces = mwanData && mwanData.interfaces ? mwanData.interfaces : {};
		const mwanPolicies = mwanData && mwanData.policies && mwanData.policies.ipv4
			? mwanData.policies.ipv4 : {};
		const networkByName = {};
		const names = [];
		const modemInterfaces = new Set();
		const policyWeights = {};

		try {
			uci.sections('mwan3', 'interface').forEach((section) => {
				if (section.add_by === 'modem')
					modemInterfaces.add(String(section['.name'] || '').toLowerCase());
			});
		}
		catch (e) {
			/* mwan3 is optional; the WAN state below remains a safe fallback. */
		}

		(wans || []).slice().sort((a, b) => a.getMetric() - b.getMetric()).forEach((item) => {
			const name = item.getName();
			if (!name)
				return;

			networkByName[name] = item;
			if (!names.includes(name))
				names.push(name);
		});

		Object.keys(mwanInterfaces).forEach((name) => {
			if (!names.includes(name))
				names.push(name);
		});

		Object.keys(mwanPolicies).forEach((policy) => {
			(mwanPolicies[policy] || []).forEach((member) => {
				if (!member || !member.interface)
					return;

				const percent = Number(member.percent);
				policyWeights[member.interface] = Math.max(
					policyWeights[member.interface] || 0,
					Number.isFinite(percent) ? percent : 0
				);
			});
		});

		const mwanEnabled = Object.keys(mwanInterfaces).length > 0;
		const score = (name) => {
			const status = mwanInterfaces[name] || {};
			return (policyWeights[name] > 0 ? 100 : 0) +
				(status.status === 'online' ? 20 : 0) +
				(networkByName[name] && networkByName[name].isUp() ? 10 : 0);
		};
		const sorted = names.slice().sort((a, b) => score(b) - score(a));
		const cellularName = sorted.find((name) => this.isCellularInterface(name, modemInterfaces));
		const bridgeName = sorted.find((name) => name !== cellularName &&
			/(wbridge|wireless.?bridge|relay|repeater)/i.test(name));
		const otherNames = sorted.filter((name) => name !== cellularName && name !== bridgeName);
		const wanName = otherNames.find((name) => String(name).toLowerCase() === 'wan') ||
			otherNames.find((name) => /^(wan|eth|ethernet)/i.test(name)) || otherNames[0];

		const route = (kind, name) => {
			const net = name ? networkByName[name] : null;
			const state = name ? mwanInterfaces[name] : null;
			let online = false;

			if (state) {
				online = state.enabled !== false && (state.status === 'online' ||
					(state.status === 'notracking' && state.up === true));
			}
			else if (net) {
				online = net.isUp();
			}

            // Interface addresses and carrier state do not prove Internet access.
            online = online && !!(health && health.interfaces && health.interfaces[name] && health.interfaces[name].internet);

			return {
				kind: kind,
				name: name || null,
				network: net,
				online: online,
				active: online && !!name && policyWeights[name] > 0,
				percent: name ? policyWeights[name] || 0 : 0,
				tracked: !!state
			};
		};

		const routes = [
			route('cellular', cellularName),
			route('bridge', bridgeName),
			route('wan', wanName)
		];
		const onlineRoutes = routes.filter((item) => item.online);

		if (!Object.keys(policyWeights).length && onlineRoutes.length === 1)
			onlineRoutes[0].active = true;

		return { routes: routes, mwanEnabled: mwanEnabled, online: onlineRoutes.length > 0 };
	},

	flowNode(iconName, label, value, detail, path, state) {
		const attributes = {
			'class': 'cpe-flow-node ' + (state || '')
		};

		if (path)
			attributes.href = L.url.apply(L, path);

		return E(path ? 'a' : 'div', attributes, [
			E('span', { 'class': 'cpe-flow-node__icon' }, [ icon(iconName) ]),
			E('span', { 'class': 'cpe-flow-node__label' }, [ label ]),
			E('strong', {}, [ value ]),
			E('em', {}, [ detail ])
		]);
	},

	uplinkRouteNode(route) {
		const cellular = route.kind === 'cellular';
		const bridge = route.kind === 'bridge';
		let stateLabel = _('Unavailable');

		if (route.online && route.active)
			stateLabel = route.percent > 0
				? '%s · %d%%'.format(_('Active path'), Math.round(route.percent))
				: _('Active path');
		else if (route.online)
			stateLabel = _('Standby online');
		else if (route.name && route.tracked)
			stateLabel = _('MWAN3 offline');

		return E('a', {
			'class': 'cpe-uplink-route ' + (route.online ? 'is-online' : 'is-offline') +
				(route.active ? ' is-active' : ''),
			'href': cellular
				? L.url('admin', 'modem', 'qmodem')
				: L.url('admin', 'network', bridge ? 'wireless' : 'network')
		}, [
			E('span', { 'class': 'cpe-uplink-route__icon' }, [ icon(cellular ? 'radio' : bridge ? 'wifi' : 'network') ]),
			E('span', { 'class': 'cpe-uplink-route__copy' }, [
				E('small', {}, [ cellular ? _('Modem') : bridge ? _('Wireless bridge') : _('Ethernet WAN') ]),
				E('strong', {}, [ route.name || _('Not configured') ]),
				E('em', {}, [ stateLabel ])
			]),
			E('i', { 'class': 'cpe-uplink-route__state', 'aria-hidden': 'true' })
		]);
	},


	drawMwanFlowLinks(flow, online) {
		const svg = flow.querySelector('.cpe-mwan-flow__links');
		const routes = Array.from(flow.querySelectorAll('.cpe-uplink-route'));
		const router = flow.querySelector('.cpe-mwan-flow__router .cpe-flow-node__icon');
		const clients = Array.from(flow.querySelectorAll('.cpe-client-type'));
		const bounds = svg.getBoundingClientRect();

		if (!bounds.width || !bounds.height || !router || !routes.length || !clients.length)
			return;

		svg.setAttribute('viewBox', '0 0 ' + bounds.width + ' ' + bounds.height);

		const box = (node) => {
			const rect = node.getBoundingClientRect();
			return {
				left: rect.left - bounds.left,
				right: rect.right - bounds.left,
				top: rect.top - bounds.top,
				bottom: rect.bottom - bounds.top,
				centerY: rect.top - bounds.top + rect.height / 2
			};
		};
		const sources = routes.map(box);
		const device = box(router);
		const outputs = clients.map(box);
		const leftBusX = (sources[0].right + device.left) / 2;
		const rightBusX = (device.right + outputs[0].left) / 2;
		const routerY = device.centerY;
		const paths = [];
		const addPath = (d, state) => {
			const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
			path.setAttribute('class', 'cpe-flow-link ' + state);
			path.setAttribute('d', d);
			paths.push(path);
		};

		sources.forEach((source, index) => {
			const route = routes[index];
			const state = route.classList.contains('is-active')
				? 'is-active'
				: route.classList.contains('is-online') ? 'is-online' : 'is-offline';
			addPath('M' + source.right + ' ' + source.centerY + ' H' + leftBusX, state);
		});

		if (sources.length > 1)
			addPath('M' + leftBusX + ' ' + sources[0].centerY + ' V' + sources[sources.length - 1].centerY, 'is-trunk');
		const hasActiveRoute = routes.some((route) => route.classList.contains('is-active'));
		addPath('M' + leftBusX + ' ' + routerY + ' H' + device.left, hasActiveRoute ? 'is-active' : online ? 'is-online' : 'is-offline');

		if (outputs.length > 1)
			addPath('M' + rightBusX + ' ' + outputs[0].centerY + ' V' + outputs[outputs.length - 1].centerY, 'is-trunk');
		const clientCounts = clients.map((node) => {
			const countNode = node.querySelector('strong');
			return Number.parseInt(countNode ? countNode.textContent : '0', 10) || 0;
		});
		const hasClients = clientCounts.some((count) => count > 0);
		addPath('M' + device.right + ' ' + routerY + ' H' + rightBusX, hasClients ? 'is-active' : 'is-offline');
		outputs.forEach((output, index) => {
			addPath('M' + rightBusX + ' ' + output.centerY + ' H' + output.left,
				clientCounts[index] > 0 ? 'is-active' : 'is-offline');
		});

		svg.replaceChildren(...paths);
	},

	renderNetworkOverview(board, wans, mwanData, clients, health) {
		const uplinks = this.getUplinkRoutes(wans, mwanData, health);
		const routes = uplinks.routes;
		const flow = E('div', { 'class': 'cpe-mwan-flow' }, [
			E('svg', {
				'class': 'cpe-mwan-flow__links',
				'viewBox': '0 0 1 1',
				'preserveAspectRatio': 'none',
				'aria-hidden': 'true'
			}),
			E('div', { 'class': 'cpe-mwan-flow__routes' }, routes.map((route) => this.uplinkRouteNode(route))),
			E('div', { 'class': 'cpe-mwan-flow__router' }, [
				this.flowNode('router', _('Router'), text(board.model), text(board.hostname), null, uplinks.online ? 'is-online' : 'is-offline')
			]),
			E('div', { 'class': 'cpe-mwan-flow__clients' }, [
				E('a', { 'class': 'cpe-client-type', 'href': L.url('admin', 'network', 'wireless') }, [
					E('span', { 'class': 'cpe-client-type__icon' }, [ icon('wifi') ]),
					E('span', { 'class': 'cpe-client-type__copy' }, [
						E('small', {}, [ _('Wireless clients') ]),
						E('strong', {}, [ '%d'.format(clients.filter((client) => client.wireless).length) ])
					])
				]),
				E('a', { 'class': 'cpe-client-type', 'href': L.url('admin', 'network', 'network') }, [
					E('span', { 'class': 'cpe-client-type__icon' }, [ icon('network') ]),
					E('span', { 'class': 'cpe-client-type__copy' }, [
						E('small', {}, [ _('LAN clients') ]),
						E('strong', {}, [ '%d'.format(clients.filter((client) => !client.wireless).length) ])
					])
				])
			])
		]);
		const redraw = () => this.drawMwanFlowLinks(flow, uplinks.online);

		if (typeof ResizeObserver !== 'undefined') {
			flow._linkObserver = new ResizeObserver(redraw);
			flow._linkObserver.observe(flow);
		}
		requestAnimationFrame(redraw);

		return E('section', { 'class': 'cpe-network-overview', 'aria-label': _('Network overview') }, [
			E('header', { 'class': 'cpe-network-overview__header' }, [
				E('div', {}, [
					E('p', { 'class': 'cpe-network-overview__eyebrow' }, [ 'NetDogg' ]),
					E('h1', {}, [ _('Network overview') ]),
					E('p', {}, [ text(board.model) ])
				]),
				E('span', { 'class': 'cpe-network-overview__state ' + (uplinks.online ? 'is-online' : 'is-offline') }, [
					E('i', { 'aria-hidden': 'true' }),
					uplinks.online ? _('Internet connected') : _('No Internet connection')
				])
			]),
			flow
		]);
	},
	renderInternet(wans) {
		const sorted = (wans || []).slice().sort((a, b) => a.getMetric() - b.getMetric());
		const wan = sorted.find((item) => item.isUp()) || sorted[0];
		const online = !!wan && wan.isUp();
		const protocol = wan ? (wan.getI18n() || wan.getProtocol()) : '-';

		return this.card(_('Internet'), 'globe', this.rows([
			[ _('Interface'), wan ? wan.getName() : '-' ],
			[ _('Protocol'), text(protocol) ],
			[ _('IPv4 address'), wan ? firstAddress(wan.getIPAddrs()) : '-' ],
			[ _('Gateway'), wan ? text(wan.getGatewayAddr()) : '-' ]
		]), {
			className: 'cpe-card--internet',
			badge: this.badge(online ? _('Online') : _('Offline'), online),
			footer: E('footer', { 'class': 'cpe-card__footer' }, [
				this.link(_('Manage interfaces'), [ 'admin', 'network', 'network' ])
			])
		});
	},

	renderWireless(radios, wifiNetworks, associations) {
		const active = (wifiNetworks || []).filter((wifi) => !wifi.isDisabled());
		const clients = (associations || []).reduce((count, list) => count + list.length, 0);
		const names = active.map((wifi) => wifi.getActiveSSID()).filter(Boolean);

		return this.card(_('Wireless'), 'wifi', this.rows([
			[ _('Active radios'), '%d / %d'.format(active.length, (radios || []).length) ],
			[ _('Networks'), names.length ? names.join(', ') : '-' ],
			[ _('Wireless clients'), String(clients) ]
		]), {
			className: 'cpe-card--wireless',
			badge: this.badge(active.length ? _('Online') : _('Offline'), active.length > 0),
			footer: E('footer', { 'class': 'cpe-card__footer' }, [
				this.link(_('Manage wireless'), [ 'admin', 'network', 'wireless' ])
			])
		});
	},

	renderModem(modemData, health) {
		const modems = Array.isArray(modemData.info) ? modemData.info : [];
		const entries = modems.reduce((all, modem) =>
			all.concat(Array.isArray(modem.modem_info) ? modem.modem_info : []), []);
		const cellular = health && health.cellular || {};
        const detected = cellular.present === true || entries.length > 0;
        const internet = Object.values(health && health.interfaces || {}).some((item) => item.device === cellular.device && item.internet === true);
        const noSim = /ABSENT|NOT INSERTED|NO SIM/i.test(cellular.sim_status || '');
        const connected = !noSim && (cellular.present ? cellular.connection === 'connected' && internet : Object.entries(health && health.interfaces || {}).some(([name, item]) => this.isCellularInterface(name, new Set()) && item.internet === true));
        const statusLabel = !detected ? _('No modem detected') : noSim ? _('No SIM card') : connected ? _('Internet connected') : _('Not connected');
		const signal = cellular.present ? (() => {
            const value = cellular.nr_signal != null ? cellular.nr_signal : cellular.lte_signal;
            return {percent: cellular.signal_valid && value != null ? Math.round(Math.max(0, Math.min(100, (value + 120) * 2))) : null, label: 'dBm', raw: value == null ? '-' : String(value)};
        })() : modemSignal(entries);
		const signalLevel = signal.percent == null ? 0 : Math.ceil(signal.percent / 25);

		return this.card(_('Cellular'), 'radio', this.rows([
			[ _('Model'), cellular.model || findModemValue(entries, [ 'name', 'model', 'module' ]) ],
			[ _('Operator'), findModemValue(entries, [ 'operator', 'isp' ]) ],
            [ _('Connection status'), statusLabel ],
            [ _('SIM status'), noSim ? _('No SIM card') : text(cellular.sim_status) ],
			[ _('Network type'), cellular.present ? text(cellular.radio) : findModemValue(entries, [ 'network_type', 'network type', 'mode', 'rat' ]) ],
			[ _('Signal'), E('span', {
				'class': 'cpe-signal ' + (signal.percent == null ? 'is-unavailable' : signal.percent >= 60 ? 'is-strong' : signal.percent >= 30 ? 'is-medium' : 'is-weak'),
				'title': signal.percent == null ? _('Signal strength unavailable') : _('Estimated from radio signal level')
			}, [
				E('span', { 'class': 'cpe-signal__bars', 'aria-hidden': 'true' }, [ 1, 2, 3, 4 ].map((bar) =>
					E('i', { 'class': 'cpe-signal__bar' + (bar <= signalLevel ? ' is-active' : '') })
				)),
				E('strong', {}, [ signal.percent == null ? '-' : '%d%%'.format(signal.percent) ]),
				E('small', {}, [ signal.label ? '%s %s'.format(signal.label, signal.raw) : signal.raw ])
			]) ]
		]), {
			className: 'cpe-card--cellular',
			badge: this.badge(statusLabel, connected),
			footer: E('footer', { 'class': 'cpe-card__footer' }, [
				this.link(_('Open QModem'), [ 'admin', 'modem', 'qmodem' ])
			])
		});
	},

	renderCooling(fanData) {
		const fan = fanData.fan || {};
		const current = Number(fan.current_state);
		const maximum = Number(fan.max_state);
		const available = !!fan.present && Number.isFinite(current) && Number.isFinite(maximum);
		const level = available
			? '%d / %d%s'.format(
				current,
				maximum,
				maximum > 0 ? ' (%d%%)'.format(Math.round(current * 100 / maximum)) : ''
			)
			: '-';

		return this.card(_('Cooling'), 'fan', this.rows([
			[ _('System temperature'), formatTemperature(Number(fanData.temperature)) ],
			[ _('Fan policy'), available ? _('Automatic') : '-' ],
			[ _('Fan level'), level ],
			[ _('Thermal zone'), text(fanData.thermal_zone) ]
		]), {
			className: 'cpe-card--cooling',
			badge: this.badge(available ? _('Automatic') : _('Unavailable'), available)
		});
	},

	renderSystem(board, system) {
		const memory = system.memory || {};
		const available = memory.available || memory.free || 0;
		const used = memory.total ? Math.max(memory.total - available, 0) : 0;
		const memoryValue = memory.total
			? '%s / %s'.format(formatMemory(used), formatMemory(memory.total))
			: '-';
		const load = Array.isArray(system.load)
			? system.load.map((value) => (value / 65535).toFixed(2)).join(' / ')
			: '-';

		return this.card(_('Router'), 'router', this.rows([
			[ _('Model'), text(board.model) ],
			[ _('Hostname'), text(board.hostname) ],
			[ _('Firmware'), text(board.release && board.release.description) ],
			[ _('Kernel'), text(board.kernel) ],
			[ _('Uptime'), system.uptime ? '%t'.format(system.uptime) : '-' ],
			[ _('Memory'), memoryValue ],
			[ _('System load'), load ]
		]), { className: 'cpe-card--system' });
	},

	collectClients(leases, associations, hints, lan) {
		const byMac = {};
		const dhcp = Array.isArray(leases.dhcp_leases) ? leases.dhcp_leases : [];
		const lanCidrs = lan ? lan.getIPAddrs() : [];
		const routerAddresses = new Set(lanCidrs.map((cidr) => String(cidr).split('/')[0]));
		const hintAddresses = (mac) => {
			const host = hints && hints.hosts ? hints.hosts[mac] : null;
			return host ? L.toArray(host.ipaddrs || host.ipv4) : [];
		};
		const lanAddress = (mac) => hintAddresses(mac).find((address) =>
			!routerAddresses.has(address) && lanCidrs.some((cidr) => addressInSubnet(address, cidr))
		);
		const addClient = (mac, hostname, ip, wireless) => {
			mac = String(mac || '').toUpperCase();
			if (!mac)
				return;

			const current = byMac[mac] || {};
			byMac[mac] = {
				hostname: hostname || current.hostname ||
					(hints && hints.getHostnameByMACAddr(mac)) || _('Unknown'),
				ip: ip || current.ip || lanAddress(mac) || '-',
				mac: mac,
				wireless: !!wireless || !!current.wireless
			};
		};

		dhcp.forEach((lease) => {
			addClient(lease.macaddr, lease.hostname, lease.ipaddr);
		});

		if (hints && typeof hints.getMACHints === 'function') {
			hints.getMACHints(false).forEach((entry) => {
				const mac = String(entry[0] || '').toUpperCase();
				const ip = lanAddress(mac);

				if (ip)
					addClient(mac, hints.getHostnameByMACAddr(mac), ip);
			});
		}

		(associations || []).forEach((stations) => {
			(stations || []).forEach((station) => {
				const mac = String(station.mac || '').toUpperCase();
				addClient(mac, null, lanAddress(mac), true);
			});
		});

		return Object.values(byMac).sort((a, b) => a.hostname.localeCompare(b.hostname));
	},

	renderClients(clients) {
		const table = E('div', { 'class': 'cpe-table-wrap' }, [
			E('table', { 'class': 'cpe-table' }, [
				E('thead', {}, [ E('tr', {}, [
					E('th', {}, [ _('Hostname') ]),
					E('th', {}, [ _('IP address') ]),
					E('th', {}, [ _('MAC address') ])
				]) ]),
				E('tbody', {}, clients.length ? clients.map((client) => E('tr', {}, [
					E('td', { 'data-title': _('Hostname') }, [ client.hostname ]),
					E('td', { 'data-title': _('IP address') }, [ client.ip ]),
					E('td', { 'data-title': _('MAC address') }, [ client.mac ])
				])) : [ E('tr', {}, [
					E('td', { 'class': 'cpe-empty', 'colspan': '3' }, [ _('No active clients') ])
				]) ])
			])
		]);

		return this.card('%s · %d'.format(_('Connected clients'), clients.length), 'users', [ table ], {
			className: 'cpe-card--clients'
		});
	},

	renderActions() {
		const actions = [
			[ 'network', _('Network'), [ 'admin', 'network', 'network' ] ],
			[ 'wifi', _('Wireless'), [ 'admin', 'network', 'wireless' ] ],
			[ 'radio', _('Cellular'), [ 'admin', 'modem', 'qmodem' ] ],
			[ 'upload', _('Firmware upgrade'), [ 'admin', 'system', 'flash' ] ],
			[ 'refresh', _('Reboot'), [ 'admin', 'system', 'reboot' ] ],
			[ 'settings', _('Advanced settings'), [ 'admin', 'status', 'overview' ] ]
		];

		return E('section', { 'class': 'cpe-actions' }, [
			E('h2', {}, [ _('Quick actions') ]),
			E('div', { 'class': 'cpe-actions__grid' }, actions.map((action) =>
				E('a', { 'href': L.url.apply(L, action[2]), 'class': 'cpe-action' }, [
					icon(action[0]),
					E('span', {}, [ action[1] ])
				])
			))
		]);
	},

	renderDashboard(data) {
		const board = data[0] || {};
		const system = data[1] || {};
		const wans = data[2] || [];
		const radios = data[3] || [];
		const wifiNetworks = data[4] || [];
		const hints = data[5];
		const leases = data[6] || {};
		const modem = data[7] || {};
		const fan = data[8] || {};
		const lan = data[9];
		const mwan = data[10] || {};
		const associations = data[12] || [];
        const health = data[13] || {};
		const clients = this.collectClients(leases, associations, hints, lan);

		return E('div', { 'class': 'cpe-dashboard' }, [
			this.renderNetworkOverview(board, wans, mwan, clients, health),
			E('section', { 'class': 'cpe-details' }, [
				E('div', { 'class': 'cpe-section-heading' }, [
					E('h2', {}, [ _('Network health') ]),
					E('span', {}, [ new Date().toLocaleString() ])
				]),
				E('div', { 'class': 'cpe-grid cpe-grid--status' }, [
				this.renderModem(modem, health),
				this.renderCooling(fan),
				this.renderSystem(board, system)
				])
			]),
			this.renderClients(clients),
			this.renderActions()
		]);
	},

	render(data) {
		ensureStylesheet();

		if (!this.pollRegistered) {
			this.pollRegistered = true;
			poll.add(() => network.flushCache().then(() => this.load()).then((updated) => {
				const current = document.querySelector('.cpe-dashboard');

				if (current)
					current.replaceWith(this.renderDashboard(updated));
			}), 5);
		}

		return this.renderDashboard(data);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
