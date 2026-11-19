'use strict';
'require baseclass';
'require ui';
'require uci';

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';
const SPRITE = '/luci-static/cpe/icons.svg?v=20261119';

/* 一级菜单名 -> 图标。名字来自 menu.d 的 section key（英文标识符），
   这里按语义直接对应到 icons.svg 里的 symbol id。 */
const menuIcons = {
	overview: 'dashboard',
	dashboard: 'dashboard',
	cpe: 'dashboard',
	status: 'activity',
	statistics: 'chart',
	graphs: 'chart',
	realtime: 'activity',
	network: 'network',
	interfaces: 'network',
	devices: 'lan',
	wireless: 'wifi',
	wifi: 'wifi',
	modem: 'radio',
	qmodem: 'radio',
	cellular: 'radio',
	services: 'package',
	vpn: 'shield-check',
	openvpn: 'shield-check',
	wireguard: 'shield-check',
	tailscale: 'shield-check',
	zerotier: 'shield-check',
	wifidog: 'wifi',
	system: 'settings',
	admin: 'lock',
	password: 'lock',
	flash: 'upload',
	firmware: 'upload',
	backup: 'archive',
	reboot: 'power',
	startup: 'power',
	crontab: 'clock',
	mount: 'database',
	leds: 'lightbulb',
	packages: 'package',
	diagnostics: 'terminal',
	dhcp: 'server',
	dns: 'globe',
	hosts: 'server',
	static: 'route',
	routes: 'route',
	firewall: 'shield',
	nat: 'route',
	logs: 'file-text',
	syslog: 'file-text',
	dmesg: 'file-text',
	kernel: 'terminal',
	processes: 'cpu',
	users: 'users',
	upnp: 'plug',
	sqm: 'gauge',
	ddns: 'globe',
	monitor: 'monitor',
	bandwidth: 'chart'
};

/* section key 本身没命中时按名字片段兜底。 */
const menuIconRules = [
	[ /^(overview|dashboard|home)$/i, 'dashboard' ],
	[ /(overview|dashboard)/i, 'dashboard' ],
	[ /(wireless|wifi|wlan|ssid)/i, 'wifi' ],
	[ /(modem|cellular|lte|nr|sim|4g|5g)/i, 'radio' ],
	[ /(vpn|tunnel|proxy)/i, 'shield-check' ],
	[ /(firewall|acl|nat)/i, 'shield' ],
	[ /(route|routing|gateway|wan)/i, 'route' ],
	[ /(dns|hosts|ddns)/i, 'globe' ],
	[ /(dhcp|lease|server)/i, 'server' ],
	[ /(log|syslog|dmesg)/i, 'file-text' ],
	[ /(flash|upload|firmware|upgrade)/i, 'upload' ],
	[ /(reboot|power|startup)/i, 'power' ],
	[ /(backup|restore|archive)/i, 'archive' ],
	[ /(package|software|opkg)/i, 'package' ],
	[ /(diagnostic|terminal|shell)/i, 'terminal' ],
	[ /(process|cpu|load)/i, 'cpu' ],
	[ /(client|user|device|host)/i, 'users' ],
	[ /(network|interface|port)/i, 'network' ],
	[ /(system|admin|setting)/i, 'settings' ],
	[ /(status|state|monitor)/i, 'activity' ],
	[ /(statistic|graph|chart|bandwidth)/i, 'chart' ],
	[ /(service)/i, 'package' ]
];

/* 最后按菜单显示名（含中文翻译）兜底，保证没有 key 也能配上图标。 */
const menuTitleRules = [
	[ /(概览|总览|overview|dashboard)/i, 'dashboard' ],
	[ /(无线|wireless|wifi)/i, 'wifi' ],
	[ /(蜂窝|模块|modem|cellular)/i, 'radio' ],
	[ /(网络|network)/i, 'network' ],
	[ /(服务|services)/i, 'package' ],
	[ /(vpn|虚拟专用)/i, 'shield-check' ],
	[ /(系统|system)/i, 'settings' ],
	[ /(密码|password|登录|login)/i, 'lock' ],
	[ /(固件|升级|firmware|flash)/i, 'upload' ],
	[ /(重启|reboot)/i, 'power' ],
	[ /(备份|恢复|backup)/i, 'archive' ],
	[ /(日志|log)/i, 'file-text' ],
	[ /(防火墙|firewall)/i, 'shield' ],
	[ /(诊断|diagnostic)/i, 'terminal' ],
	[ /(路由|route)/i, 'route' ],
	[ /(状态|status)/i, 'activity' ],
	[ /(客户端|设备|client)/i, 'users' ],
	[ /(统计|图表|statistic|chart)/i, 'chart' ]
];

function normalize(value) {
	return String(value == null ? '' : value)
		.trim()
		.toLowerCase()
		.replace(/[\s_.\-]+/g, '');
}

function resolveIcon(name, title) {
	const key = normalize(name);
	const label = String(title == null ? '' : title).trim();

	if (key && menuIcons[key])
		return menuIcons[key];

	for (const rule of menuIconRules)
		if (key && rule[0].test(key))
			return rule[1];

	for (const rule of menuTitleRules)
		if (label && rule[0].test(label))
			return rule[1];

	return 'box';
}

/* document.createElement() 会把 svg 造进 HTML 命名空间导致不渲染，
   图标必须用 createElementNS() 建立。 */
function svgElement(tag, attributes, children) {
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

function icon(name, title) {
	return svgElement('svg', { 'class': 'cpe-nav-icon', 'aria-hidden': 'true' }, [
		svgElement('use', { 'href': SPRITE + '#' + resolveIcon(name, title) })
	]);
}

function chevron() {
	return svgElement('svg', { 'class': 'cpe-nav-chevron', 'aria-hidden': 'true' }, [
		svgElement('use', { 'href': SPRITE + '#chevron' })
	]);
}

return baseclass.extend({
	__init__() {
		Promise.all([
			ui.menu.load(),
			uci.load('luci')
		]).then((data) => this.render(data[0]));
	},

	render(tree) {
		let node = tree;
		let url = '';

		this.renderModeMenu(node);
		this.renderLanguageToggle();
		this.renderThemeName();
		this.bindThemeSelection();

		if (L.env.dispatchpath.length >= 3) {
			for (let i = 0; i < 3 && node; i++) {
				node = node.children[L.env.dispatchpath[i]];
				url += (url ? '/' : '') + L.env.dispatchpath[i];
			}

			if (node)
				this.renderTabMenu(node, url);
		}

		const navToggle = document.querySelector('#cpe-nav-toggle');
		const backdrop = document.querySelector('#cpe-backdrop');

		navToggle?.setAttribute('aria-controls', 'cpe-sidebar');
		navToggle?.setAttribute('aria-expanded',
			document.body.classList.contains('cpe-sidebar-open') ? 'true' : 'false');
		navToggle?.addEventListener('click', ui.createHandlerFn(this, 'handleSidebarToggle'));
		backdrop?.addEventListener('click', ui.createHandlerFn(this, 'handleSidebarToggle'));
		backdrop?.addEventListener('keydown', (ev) => {
			if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Escape')
				this.handleSidebarToggle(ev);
		});
	},

	renderThemeName() {
		const content = document.querySelector('#maincontent');
		const updateThemeName = () => {
			const options = content.querySelectorAll('option[value="/luci-static/cpe"]');

			options.forEach((option) => {
				if (option.textContent !== 'NetDogg UI')
					option.textContent = 'NetDogg UI';
			});

			return options.length > 0;
		};

		if (!content)
			return;

		if (updateThemeName())
			return;

		const observer = new MutationObserver(() => {
			if (updateThemeName())
				observer.disconnect();
		});
		observer.observe(content, { childList: true, subtree: true });
		window.setTimeout(() => observer.disconnect(), 10000);
	},

	bindThemeSelection() {
		document.querySelector('#maincontent')?.addEventListener('change', (ev) => {
			if (!ev.target.matches?.('select[id$="._mediaurlbase"]'))
				return;

			uci.set('luci', 'main', 'dogenet_theme_user_selected', '1');
		});
	},

	renderLanguageToggle() {
		const control = document.querySelector('#cpe-language');
		if (!control)
			return;

		const requestLanguage = String(control.dataset.current || '').toLowerCase();
		const configuredLanguage = uci.get('luci', 'main', 'lang') || 'auto';
		const activeLanguage = configuredLanguage === 'auto'
			? (requestLanguage.startsWith('zh') ? 'zh_cn' : 'en')
			: configuredLanguage;

		control.querySelectorAll('button').forEach((button) => {
			button.classList.toggle('active', button.dataset.lang === activeLanguage);
			button.setAttribute('aria-pressed', button.dataset.lang === activeLanguage ? 'true' : 'false');
			button.addEventListener('click', () => {
				if (button.dataset.lang === activeLanguage)
					return;

				control.querySelectorAll('button').forEach((item) => item.disabled = true);
				uci.set('luci', 'main', 'lang', button.dataset.lang);
				uci.save()
					.then(() => uci.apply(5))
					.then(() => window.setTimeout(() => window.location.reload(), 1200))
					.catch((error) => {
						control.querySelectorAll('button').forEach((item) => item.disabled = false);
						ui.addNotification(null, E('p', {}, [ _('Unable to switch language: %s').format(error) ]));
					});
			});
		});
	},

	handleMenuExpand(ev) {
		const item = ev.currentTarget.parentNode;
		const submenu = ev.currentTarget.nextElementSibling;

		if (!submenu)
			return;

		const expanded = item.classList.toggle('expanded');
		ev.currentTarget.setAttribute('aria-expanded', expanded ? 'true' : 'false');
		ev.preventDefault();
	},

	renderMainMenu(tree, url, level) {
		const l = (level || 0) + 1;
		const ul = E('ul', { 'class': 'mainmenu l%d'.format(l) });
		const children = ui.menu.getChildren(tree);

		if (!children.length || l > 2)
			return E([]);

		children.forEach((child) => {
			/* mwan3 registers the same page under both Status and Network.
			   Keep the Network one and hide the duplicate in this theme. */
			if (url === 'admin/status' && child.name === 'mwan3')
				return;

			const selected = L.env.dispatchpath[l] === child.name;
			const descendants = ui.menu.getChildren(child);
			const passwordEntry = url === 'admin/system' && child.name === 'admin';
			const directChild = l === 1 && descendants.length === 1 &&
				(child.name === 'cpe' || child.name === 'modem');
			const className = 'mainmenu-item-%s%s%s'.format(
				child.name,
				selected ? ' selected' : '',
				selected && descendants.length && !directChild ? ' expanded' : ''
			);
			const linkChildren = [];

			if (l === 1)
				linkChildren.push(icon(child.name, child.title));

			linkChildren.push(E('span', { 'class': 'cpe-nav-label' }, [
				passwordEntry ? _('Router Password') : _(child.title)
			]));

			if (l === 1 && descendants.length && !directChild)
				linkChildren.push(chevron());

			const submenu = directChild
				? E([])
				: this.renderMainMenu(child, url + '/' + child.name, l);

			const linkAttributes = {
				'href': passwordEntry
					? L.url(url, child.name, 'password')
					: directChild
					? L.url(url, child.name, descendants[0].name)
					: L.url(url, child.name),
				'click': (l === 1 && descendants.length && !directChild)
					? ui.createHandlerFn(this, 'handleMenuExpand')
					: null
			};

			if (l === 1 && descendants.length && !directChild)
				linkAttributes['aria-expanded'] = selected ? 'true' : 'false';

			ul.appendChild(E('li', { 'class': className }, [
				E('a', linkAttributes, linkChildren),
				submenu
			]));
		});

		if (l === 1)
			document.querySelector('#mainmenu').appendChild(ul);

		return ul;
	},

	renderModeMenu(tree) {
		const children = ui.menu.getChildren(tree);

		children.forEach((child, index) => {
			const active = L.env.requestpath.length
				? child.name === L.env.requestpath[0]
				: index === 0;

			if (active)
				this.renderMainMenu(child, child.name);
		});
	},

	renderTabMenu(tree, url, level) {
		const container = document.querySelector('#tabmenu');
		const l = (level || 0) + 1;
		const ul = E('ul', { 'class': 'cbi-tabmenu' });
		const children = ui.menu.getChildren(tree);
		let activeNode = null;

		if (!children.length)
			return E([]);

		children.forEach((child) => {
			const active = L.env.dispatchpath[l + 2] === child.name;
			ul.appendChild(E('li', {
				'class': 'tabmenu-item-%s%s'.format(child.name, active ? ' cbi-tab' : '')
			}, [
				E('a', { 'href': L.url(url, child.name) }, [ _(child.title) ])
			]));

			if (active)
				activeNode = child;
		});

		container.appendChild(ul);
		container.style.display = '';

		if (activeNode)
			container.appendChild(this.renderTabMenu(activeNode, url + '/' + activeNode.name, l));

		return ul;
	},

	handleSidebarToggle() {
		const open = document.body.classList.toggle('cpe-sidebar-open');
		document.querySelector('#cpe-nav-toggle')?.setAttribute('aria-expanded', open ? 'true' : 'false');
	}
});
