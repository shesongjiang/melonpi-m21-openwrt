'use strict';
'require baseclass';
'require ui';
'require uci';

const menuIcons = {
	cpe: 'gauge',
	status: 'chart',
	network: 'network',
	modem: 'radio',
	services: 'box',
	vpn: 'shield',
	system: 'settings'
};

function icon(name) {
	return E('svg', { 'class': 'cpe-nav-icon', 'aria-hidden': 'true' }, [
		E('use', { 'href': '/luci-static/cpe/icons.svg#' + (menuIcons[name] || 'box') })
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

		document.querySelector('#cpe-nav-toggle')?.addEventListener('click',
			ui.createHandlerFn(this, 'handleSidebarToggle'));
		document.querySelector('#cpe-backdrop')?.addEventListener('click',
			ui.createHandlerFn(this, 'handleSidebarToggle'));
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

		item.classList.toggle('expanded');
		ev.preventDefault();
	},

	renderMainMenu(tree, url, level) {
		const l = (level || 0) + 1;
		const ul = E('ul', { 'class': 'mainmenu l%d'.format(l) });
		const children = ui.menu.getChildren(tree);

		if (!children.length || l > 2)
			return E([]);

		children.forEach((child) => {
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
				linkChildren.push(icon(child.name));

			linkChildren.push(E('span', { 'class': 'cpe-nav-label' }, [
				passwordEntry ? _('Router Password') : _(child.title)
			]));

			if (l === 1 && descendants.length && !directChild)
				linkChildren.push(E('svg', { 'class': 'cpe-nav-chevron', 'aria-hidden': 'true' }, [
					E('use', { 'href': '/luci-static/cpe/icons.svg#chevron' })
				]));

			const submenu = directChild
				? E([])
				: this.renderMainMenu(child, url + '/' + child.name, l);

			ul.appendChild(E('li', { 'class': className }, [
				E('a', {
					'href': passwordEntry
						? L.url(url, child.name, 'password')
						: directChild
						? L.url(url, child.name, descendants[0].name)
						: L.url(url, child.name),
					'click': (l === 1 && descendants.length && !directChild)
						? ui.createHandlerFn(this, 'handleMenuExpand')
						: null
				}, linkChildren),
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
		document.body.classList.toggle('cpe-sidebar-open');
	}
});
