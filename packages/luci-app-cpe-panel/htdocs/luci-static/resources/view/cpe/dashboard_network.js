'use strict';
'require fs';
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
	link.href = L.resource('view/cpe/overview.css') + '?v=20261119';
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

const callMwan3Status = rpc.declare({
	object: 'mwan3',
	method: 'status',
	expect: { '': {} }
});

const callNetworkHealth = rpc.declare({
 object: 'cpe_network', method: 'status', expect: { '': {} }
});

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

/* E() creates HTML elements via document.createElement(), which puts <svg> and
   <use> into the HTML namespace and makes them invisible. Every SVG node has to
   be built with createElementNS(). */
function svgNode(tag, attributes, children) {
	const node = document.createElementNS(SVG_NS, tag);

	if (attributes) {
		Object.keys(attributes).forEach((key) => {
			const value = attributes[key];

			if (value == null || value === false)
				return;

			if (key === 'href')
				node.setAttributeNS(XLINK_NS, 'xlink:href', String(value));

			node.setAttribute(key, String(value));
		});
	}

	(children || []).forEach((child) => {
		if (child != null)
			node.appendChild(child);
	});

	return node;
}

function icon(name) {
	return svgNode('svg', {
		'class': 'cpe-icon',
		'aria-hidden': 'true'
	}, [
		svgNode('use', { 'href': L.resource('view/cpe/icons.svg') + '?v=20261119#' + (name || 'box') })
	]);
}

/* Label -> icon matching. Keys are matched against the translated label, so both
   the English source string and the Chinese translation resolve to the same
   symbol. The first matching rule wins: keep specific rules above generic ones. */
const factIconRules = [
	[ /(客户端|client|接入设备)/i, 'users' ],
	[ /(sim|uim|卡状态)/i, 'sim' ],
	[ /(无线|wireless|wifi|ssid)/i, 'wifi' ],
	[ /(网络类型|network\s*type|制式|rat)/i, 'radio' ],
	[ /(射频|radio|频段|band)/i, 'radio' ],
	[ /(信号|signal|csq|rsrp|rssi)/i, 'signal' ],
	[ /(运营商|operator|carrier|isp)/i, 'globe' ],
	[ /(策略|policy|rule)/i, 'settings' ],
	[ /(温度|temperature|热|thermal)/i, 'thermometer' ],
	[ /(风扇|fan|cooling)/i, 'fan' ],
	[ /(内存|memory|ram)/i, 'memory' ],
	[ /(负载|load|cpu)/i, 'activity' ],
	[ /(固件|firmware|版本|version|release)/i, 'package' ],
	[ /(内核|kernel)/i, 'terminal' ],
	[ /(运行时间|uptime|时间|time)/i, 'clock' ],
	[ /(主机名|hostname)/i, 'server' ],
	[ /(型号|model|模块|module)/i, 'cpu' ],
	[ /(网关|gateway)/i, 'router' ],
	[ /(mac|物理地址)/i, 'cpu' ],
	[ /(ipv4|ipv6|ip\s*地址|address|地址)/i, 'globe' ],
	[ /(协议|protocol|pppoe|dhcp)/i, 'link' ],
	[ /(接口|interface|端口|port)/i, 'network' ],
	[ /(连接状态|connection|状态|status)/i, 'activity' ],
	[ /(网络|network)/i, 'network' ]
];

function factIcon(label) {
	const value = String(label == null ? '' : label).trim();

	if (!value)
		return null;

	for (const rule of factIconRules)
		if (rule[0].test(value))
			return rule[1];

	return null;
}

function text(value, fallback) {
	if (value == null || value === '')
		return fallback || '-';

	return String(value);
}

function formatBytes(bytes) {
	if (!Number.isFinite(bytes) || bytes <= 0)
		return null;

	const units = [ 'B', 'KiB', 'MiB', 'GiB', 'TiB' ];
	let value = bytes;
	let unit = 0;

	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit++;
	}

	const rounded = unit === 0 ? Math.round(value) : Math.round(value * 10) / 10;
	return '%s %s'.format(rounded, units[unit]);
}

function soft(promise, fallback) {
	return Promise.resolve(promise).then(
		(value) => ({ ok: true, value: value }),
		() => ({ ok: false, value: fallback })
	);
}

function valueOf(entry, fallback) {
	if (entry && typeof entry === 'object' && 'ok' in entry)
		return entry.ok ? entry.value : fallback;

	return entry == null ? fallback : entry;
}

function failed(entry) {
	return !!(entry && typeof entry === 'object' && entry.ok === false);
}

function detachObservers(node) {
	if (!node || node.nodeType !== 1)
		return;

	if (node._linkObserver) {
		node._linkObserver.disconnect();
		node._linkObserver = null;
	}

	Array.from(node.children || []).forEach(detachObservers);
}

function syncAttributes(current, next) {
	Array.from(next.attributes).forEach((attr) => {
		if (current.getAttribute(attr.name) !== attr.value)
			current.setAttribute(attr.name, attr.value);
	});

	Array.from(current.attributes).forEach((attr) => {
		if (!next.hasAttribute(attr.name))
			current.removeAttribute(attr.name);
	});
}

function patchNode(current, next) {
	if (!current || !next)
		return next;

	if (current.nodeType !== next.nodeType || current.nodeName !== next.nodeName) {
		detachObservers(current);
		current.replaceWith(next);
		return next;
	}

	if (current.nodeType === 3) {
		if (current.nodeValue !== next.nodeValue)
			current.nodeValue = next.nodeValue;

		return current;
	}

	if (current.nodeType !== 1)
		return current;

	syncAttributes(current, next);

	const currentChildren = Array.from(current.childNodes);
	const nextChildren = Array.from(next.childNodes);

	for (let i = 0; i < nextChildren.length; i++) {
		if (i < currentChildren.length)
			patchNode(currentChildren[i], nextChildren[i]);
		else
			current.appendChild(nextChildren[i]);
	}

	for (let i = nextChildren.length; i < currentChildren.length; i++) {
		detachObservers(currentChildren[i]);
		current.removeChild(currentChildren[i]);
	}

	return current;
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
			soft(callSystemBoard(), {}),
			soft(callSystemInfo(), {}),
			soft(network.getWANNetworks(), []),
			soft(network.getHostHints(), null),
			soft(callDHCPLeases(), {}),
			soft(callModemInfo(), {}),
			soft(network.getNetwork('lan'), null),
			soft(callMwan3Status(), {}),
			soft(uci.load('mwan3'), null)
		]).then((data) => Promise.all([
			soft(callNetworkHealth(), {}),
			soft(network.getDevices(), []),
			soft(this.loadStorage(), { failed: true, usb: [], tf: [], mmc: false })
		]).then((extra) => data.concat(extra)));
	},

	loadStorage() {
		return Promise.all([
			soft(fs.read('/proc/partitions'), ''),
			soft(fs.read('/proc/mounts'), ''),
			soft(fs.list('/sys/class/mmc_host'), null)
		]).then((result) => {
			const partitions = result[0];
			const mounts = result[1];
			const hosts = result[2];
			const storage = {
				failed: !partitions.ok,
				usb: [],
				tf: [],
				mmc: !!(hosts.ok && hosts.value && hosts.value.length)
			};

			if (!partitions.ok)
				return storage;

			const mounted = {};

			(mounts.ok ? mounts.value : '').split('\n').forEach((line) => {
				const fields = line.trim().split(/\s+/);

				if (fields.length >= 3)
					mounted[fields[0]] = {
						mount: fields[1].replace(/\\040/g, ' '),
						type: fields[2]
					};
			});

			const byBase = {};

			partitions.value.split('\n').forEach((line) => {
				const fields = line.trim().split(/\s+/);

				if (fields.length < 4)
					return;

				const blocks = parseInt(fields[2], 10);
				const name = fields[3];

				if (!Number.isFinite(blocks) || !/^(sd|mmcblk)/.test(name))
					return;

				const device = '/dev/' + name;
				const base = name.replace(/p?\d+$/, '');
				const target = mounted[device] || null;

				if (!byBase[base])
					byBase[base] = [];

				byBase[base].push({
					name: name,
					device: device,
					type: target ? target.type : null,
					mount: target ? target.mount : null,
					bytes: blocks * 1024
				});
			});

			Object.values(byBase).forEach((group) => {
				const volumes = group.length > 1
					? group.filter((item) => item.name !== item.name.replace(/p?\d+$/, ''))
					: group;

				volumes.forEach((volume) => {
					storage[/^mmcblk/.test(volume.name) ? 'tf' : 'usb'].push(volume);
				});
			});

			return storage;
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

	errorBody(message) {
		return E('div', { 'class': 'cpe-card-error' }, [
			E('p', {}, [ message ]),
			E('button', {
				'type': 'button',
				'class': 'cpe-retry',
				'click': (ev) => {
					ev.preventDefault();
					this.refresh();
				}
			}, [ _('Retry') ])
		]);
	},

	errorCard(title, iconName, className, message) {
		return this.card(title, iconName, [ this.errorBody(message) ], {
			className: className,
			badge: E('span', { 'class': 'cpe-badge is-error' }, [ _('Error') ])
		});
	},

	refresh() {
		return network.flushCache()
			.then(() => this.load())
			.then((updated) => {
				const root = document.querySelector('.cpe-dashboard');

				if (!root)
					return;

				patchNode(root, this.renderDashboard(updated));
				this.bindFlow(root);
			});
	},

	bindFlow(root) {
		const flow = root.querySelector('.cpe-mwan-flow');

		if (!flow)
			return;

		if (typeof ResizeObserver !== 'undefined') {
			if (!flow._linkObserver)
				flow._linkObserver = new ResizeObserver(() => this.drawMwanFlowLinks(flow));

			flow._linkObserver.disconnect();
			flow._linkObserver.observe(flow);
		}

		this.drawMwanFlowLinks(flow);
	},

	badge(label, online) {
		return E('span', {
			'class': 'cpe-badge ' + (online ? 'is-online' : 'is-offline')
		}, [ label ]);
	},

	rows(items) {
		return E('dl', { 'class': 'cpe-facts' }, items.map((item) => {
			const iconName = item[2] !== undefined ? item[2] : factIcon(item[0]);
			const term = iconName
				? [ icon(iconName), E('span', {}, [ item[0] ]) ]
				: [ item[0] ];

			return [
				E('dt', {}, term),
				E('dd', {}, [ item[1] ])
			];
		}).flat());
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

	getUplinkRoutes(wans, mwanData, health, healthKnown) {
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
		const otherNames = sorted.filter((name) => name !== cellularName);
		const wanName = otherNames.find((name) => String(name).toLowerCase() === 'wan') ||
			otherNames.find((name) => /^(wan|eth|ethernet)/i.test(name)) || otherNames[0];

		const route = (kind, name) => {
			const net = name ? networkByName[name] : null;
			const state = name ? mwanInterfaces[name] : null;
			const probe = name && health && health.interfaces ? health.interfaces[name] : null;
			let online = false;

			if (name && healthKnown) {
				// A successful end-to-end probe is authoritative. MWAN3 may still
				// report "unknown" while its tracking has not converged yet.
				online = !!(probe && probe.internet === true);
			}
			else if (state) {
				online = state.enabled !== false && (state.status === 'online' ||
					(state.status === 'notracking' && state.up === true));
			}
			else if (net) {
				online = net.isUp();
			}

			return {
				kind: kind,
				name: name || null,
				network: net,
				online: online,
				unknown: !!name && !healthKnown,
				active: online && !!name && policyWeights[name] > 0,
				percent: name ? policyWeights[name] || 0 : 0,
				tracked: !!state,
				judged: !!(state && state.status && state.status !== 'unknown')
			};
		};

		const routes = [
			route('cellular', cellularName),
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
		let stateLabel = _('Unavailable');

		if (route.unknown)
			stateLabel = _('Status unknown');
		else if (route.online && route.active)
			stateLabel = route.percent > 0
				? '%s · %d%%'.format(_('Active path'), Math.round(route.percent))
				: _('Active path');
		else if (route.online)
			stateLabel = _('Standby online');
		else if (route.name && route.judged)
			stateLabel = _('MWAN3 offline');

		return E('a', {
			'class': 'cpe-uplink-route ' + (route.unknown ? 'is-unknown' : route.online ? 'is-online' : 'is-offline') +
				(route.active ? ' is-active' : ''),
			'href': cellular
				? L.url('admin', 'modem', 'qmodem')
				: L.url('admin', 'network', 'network')
		}, [
			E('span', { 'class': 'cpe-uplink-route__icon' }, [ icon(cellular ? 'radio' : 'network') ]),
			E('span', { 'class': 'cpe-uplink-route__copy' }, [
				E('small', {}, [ cellular ? _('Modem') : _('Ethernet WAN') ]),
				E('strong', {}, [ route.name || _('Not configured') ]),
				E('em', {}, [ stateLabel ])
			]),
			E('i', { 'class': 'cpe-uplink-route__state', 'aria-hidden': 'true' })
		]);
	},


	drawMwanFlowLinks(flow) {
		const svg = flow.querySelector('.cpe-mwan-flow__links');
		const routes = Array.from(flow.querySelectorAll('.cpe-uplink-route'));
		const router = flow.querySelector('.cpe-mwan-flow__router .cpe-flow-node__icon');
		const clients = Array.from(flow.querySelectorAll('.cpe-client-type'));

		if (!svg)
			return;

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
			paths.push(svgNode('path', { 'class': 'cpe-flow-link ' + state, 'd': d }));
		};

		sources.forEach((source, index) => {
			const route = routes[index];
			const state = route.classList.contains('is-active')
				? 'is-active'
				: route.classList.contains('is-unknown') ? 'is-unknown'
				: route.classList.contains('is-online') ? 'is-online' : 'is-offline';
			addPath('M' + source.right + ' ' + source.centerY + ' H' + leftBusX, state);
		});

		if (sources.length > 1)
			addPath('M' + leftBusX + ' ' + sources[0].centerY + ' V' + sources[sources.length - 1].centerY, 'is-trunk');
		const hasActiveRoute = routes.some((route) => route.classList.contains('is-active'));
		const online = routes.some((route) =>
			route.classList.contains('is-online') || route.classList.contains('is-active'));
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

	renderNetworkOverview(board, wans, mwanData, clients, health, healthKnown, wansFailed) {
		const uplinks = this.getUplinkRoutes(wans, mwanData, health, healthKnown);
		const routes = uplinks.routes;
		const probeUnknown = !healthKnown;
		const stateClass = wansFailed ? 'is-error' : probeUnknown ? 'is-unknown' :
			(uplinks.online ? 'is-online' : 'is-offline');
		const stateText = wansFailed ? _('Uplink information unavailable') :
			probeUnknown ? _('Connectivity unknown') :
			(uplinks.online ? _('Internet connected') : _('No Internet connection'));
		const flow = E('div', { 'class': 'cpe-mwan-flow' }, [
			svgNode('svg', {
				'class': 'cpe-mwan-flow__links',
				'viewBox': '0 0 1 1',
				'preserveAspectRatio': 'none',
				'aria-hidden': 'true'
			}),
			E('div', { 'class': 'cpe-mwan-flow__routes' }, wansFailed
				? [ this.errorBody(_('Unable to read uplink information.')) ]
				: routes.map((route) => this.uplinkRouteNode(route))),
			E('div', { 'class': 'cpe-mwan-flow__router' }, [
				this.flowNode('router', _('Router'), text(board.model), text(board.hostname), null,
					probeUnknown ? 'is-unknown' : uplinks.online ? 'is-online' : 'is-offline')
			]),
			E('div', { 'class': 'cpe-mwan-flow__clients' }, [
				E('a', { 'class': 'cpe-client-type', 'href': L.url('admin', 'network', 'network') }, [
					E('span', { 'class': 'cpe-client-type__icon' }, [ icon('network') ]),
					E('span', { 'class': 'cpe-client-type__copy' }, [
						E('small', {}, [ _('LAN clients') ]),
						E('strong', {}, [ '%d'.format(clients.length) ])
					])
				])
			])
		]);
		return E('section', { 'class': 'cpe-network-overview', 'aria-label': _('Network overview') }, [
			E('header', { 'class': 'cpe-network-overview__header' }, [
				E('h1', {}, [ _('Network overview') ]),
				E('div', { 'class': 'cpe-network-overview__meta' }, [
					E('span', { 'class': 'cpe-network-overview__updated' }, [
						'%s %s'.format(_('Updated'), new Date().toLocaleTimeString())
					]),
					E('span', { 'class': 'cpe-network-overview__state ' + stateClass }, [
						E('i', { 'aria-hidden': 'true' }),
						stateText
					])
				])
			]),
			flow
		]);
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

	renderInterfaces(wans, lan, devices, wansFailed, storage) {
		const devicesByName = {};
		(devices || []).forEach((device) => {
			const name = device && device.getName ? device.getName() : null;
			if (name)
				devicesByName[name] = device;
		});

		const networks = (wans || []).slice();
		if (lan)
			networks.push(lan);

		const items = networks.map((net) => {
			const name = net.getName();
			const up = net.isUp();
			const proto = net.getProtocol ? text(net.getProtocol()) : '-';
			const addrs = net.getIPAddrs ? net.getIPAddrs() : [];
			const address = addrs.find((addr) => /^\d+\.\d+\.\d+\.\d+/.test(addr)) || addrs[0] || '-';
			const netDevice = net.getDevice ? net.getDevice() : null;
			const deviceName = typeof netDevice === 'string'
				? netDevice
				: netDevice && netDevice.getName ? netDevice.getName() : null;
			const device = deviceName ? devicesByName[deviceName] : null;
			const speed = device && device.getSpeed ? device.getSpeed() : null;
			const duplex = device && device.getDuplex ? device.getDuplex() : null;
			let speedLabel = '-';

			if (speed > 0)
				speedLabel = '%d Mb/s'.format(speed) +
					(duplex === 'full' ? ' · ' + _('full duplex') : duplex === 'half' ? ' · ' + _('half duplex') : '');
			else if (speed === -1)
				speedLabel = _('No link');

			return {
				name: name,
				up: up,
				detail: '%s · %s · %s'.format(up ? _('Connected') : _('Disconnected'), proto, speedLabel),
				address: address
			};
		});

		const upCount = items.filter((item) => item.up).length;
		const unknown = !!wansFailed && !(wans || []).length;

		if (unknown) {
			items.unshift({
				name: 'wan',
				up: false,
				unknown: true,
				detail: _('Status unavailable'),
				address: '-'
			});
		}

		const badgeClass = unknown ? 'is-unknown'
			: items.length && upCount === items.length ? 'is-online' : 'is-offline';
		const body = items.length
			? E('ul', { 'class': 'cpe-iface-list' }, items.map((item) =>
				E('li', { 'class': 'cpe-iface ' + (item.unknown ? 'is-unknown' : item.up ? 'is-up' : 'is-down') }, [
					E('span', { 'class': 'cpe-iface__dot', 'aria-hidden': 'true' }),
					E('span', { 'class': 'cpe-iface__copy' }, [
						E('strong', {}, [ item.name ]),
						E('small', {}, [ item.detail ])
					]),
					E('span', { 'class': 'cpe-iface__address' }, [ item.address ])
				])
			))
			: E('p', { 'class': 'cpe-card__empty' }, [ _('No interfaces found.') ]);

		return this.card(_('Network interfaces'), 'network', [ body, this.renderStorageRows(storage) ], {
			className: 'cpe-card--interfaces',
			badge: E('span', { 'class': 'cpe-badge ' + badgeClass }, [
				unknown ? '-' : '%d/%d'.format(upCount, items.length)
			])
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

	collectClients(leases, hints, lan) {
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
		const addClient = (mac, hostname, ip) => {
			mac = String(mac || '').toUpperCase();
			if (!mac)
				return;

			const current = byMac[mac] || {};
			byMac[mac] = {
				hostname: hostname || current.hostname ||
					(hints && hints.getHostnameByMACAddr(mac)) || _('Unknown'),
				ip: ip || current.ip || lanAddress(mac) || '-',
				mac: mac
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

		return Object.values(byMac).sort((a, b) => a.hostname.localeCompare(b.hostname));
	},

	renderClients(clients, failedFlag) {
		if (failedFlag) {
			return this.card(_('Connected clients'), 'users', [ this.errorBody(_('Unable to load client information.')) ], {
				className: 'cpe-card--clients'
			});
		}

		const heading = (label) => [
			icon(factIcon(label)),
			E('span', {}, [ label ])
		];
		const table = E('div', { 'class': 'cpe-table-wrap' }, [
			E('table', { 'class': 'cpe-table' }, [
				E('thead', {}, [ E('tr', {}, [
					E('th', {}, heading(_('Hostname'))),
					E('th', {}, heading(_('IP address'))),
					E('th', {}, heading(_('MAC address')))
				]) ]),
				E('tbody', {}, clients.length ? clients.map((client) => E('tr', {}, [
					E('td', { 'data-title': _('Hostname') }, [
						E('span', { 'class': 'cpe-client-name' }, [
							icon('monitor'),
							E('span', {}, [ client.hostname ])
						])
					]),
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
			[ 'radio', _('Cellular'), [ 'admin', 'modem', 'qmodem' ] ],
			[ 'upload', _('Firmware upgrade'), [ 'admin', 'system', 'flash' ] ],
			[ 'power', _('Reboot'), [ 'admin', 'system', 'reboot' ] ],
			[ 'settings', _('Advanced settings'), [ 'admin', 'status', 'overview' ] ]
		];

		return E('section', { 'class': 'cpe-actions' }, [
			E('h2', {}, [ icon('zap'), _('Quick actions') ]),
			E('div', { 'class': 'cpe-actions__grid' }, actions.map((action) =>
				E('a', { 'href': L.url.apply(L, action[2]), 'class': 'cpe-action' }, [
					icon(action[0]),
					E('span', {}, [ action[1] ])
				])
			))
		]);
	},

	renderStorageRows(storage) {
		if (!storage || storage.failed) {
			return E('div', { 'class': 'cpe-iface-storage' }, [
				E('p', { 'class': 'cpe-card__empty' }, [
					storage ? _('Unable to read storage information.') : '-'
				])
			]);
		}

		const usb = storage.usb || [];
		const tf = storage.tf || [];
		const row = (label, volumes, emptyText) => {
			const details = volumes.length
				? volumes.map((volume) => [
					volume.device.replace('/dev/', ''),
					volume.type,
					formatBytes(volume.bytes),
					volume.mount || _('Not mounted')
				].map((part) => part || '-').join(' · '))
				: [ emptyText ];

			return E('li', { 'class': 'cpe-iface cpe-iface--storage ' + (volumes.length ? 'is-up' : 'is-idle') }, [
				E('span', { 'class': 'cpe-iface__dot', 'aria-hidden': 'true' }),
				E('span', { 'class': 'cpe-iface__copy' }, [
					E('strong', {}, [ label ])
				].concat(details.map((detail) => E('small', {}, [ detail ]))))
			]);
		};

		return E('div', { 'class': 'cpe-iface-storage' }, [
			E('ul', { 'class': 'cpe-iface-list' }, [
				row(_('USB storage'), usb, _('No USB device detected')),
				row(_('TF card'), tf, storage.mmc ? _('No card detected') : _('No card reader detected'))
			])
		]);
	},

	renderDashboard(data) {
		const board = valueOf(data[0], {});
		const system = valueOf(data[1], {});
		const wans = valueOf(data[2], []);
		const hints = valueOf(data[3], null);
		const leases = valueOf(data[4], {});
		const modem = valueOf(data[5], {});
		const lan = valueOf(data[6], null);
		const mwan = valueOf(data[7], {});
		const health = valueOf(data[9], {});
		const devices = valueOf(data[10], []);
		const storage = valueOf(data[11], { failed: true, usb: [], tf: [], mmc: false });
		const healthKnown = !failed(data[9]);
		const wansFailed = failed(data[2]);
		const clientsFailed = failed(data[3]) && failed(data[4]);
		const interfacesFailed = failed(data[6]) && failed(data[9]);
		const systemFailed = failed(data[0]) && failed(data[1]);
		const clients = this.collectClients(leases, hints, lan);

		return E('div', { 'class': 'cpe-dashboard' }, [
			this.renderNetworkOverview(board, wans, mwan, clients, health, healthKnown, wansFailed),
			systemFailed
				? this.errorCard(_('Router'), 'router', 'cpe-card--system', _('Unable to load system information.'))
				: this.renderSystem(board, system),
			E('section', { 'class': 'cpe-details' }, [
				E('div', { 'class': 'cpe-grid cpe-grid--status' }, [
					failed(data[5]) || failed(data[9])
						? this.errorCard(_('Cellular'), 'radio', 'cpe-card--cellular', _('Unable to load modem status.'))
						: this.renderModem(modem, health),
					interfacesFailed
						? this.errorCard(_('Network interfaces'), 'network', 'cpe-card--interfaces', _('Unable to load interface status.'))
						: this.renderInterfaces(wans, lan, devices, wansFailed, storage)
				])
			]),
			this.renderClients(clients, clientsFailed),
			this.renderActions()
		]);
	},

	render(data) {
		ensureStylesheet();

		if (!this.pollRegistered) {
			this.pollRegistered = true;
			poll.add(() => this.refresh(), 5);
		}

		const bind = () => {
			if (!document.querySelector('.cpe-mwan-flow'))
				return false;

			this.bindFlow(document);
			return true;
		};

		requestAnimationFrame(() => {
			if (!bind())
				window.setTimeout(bind, 80);
		});

		return this.renderDashboard(data);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
