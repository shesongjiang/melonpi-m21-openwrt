# SPDX-License-Identifier: Apache-2.0

include $(TOPDIR)/rules.mk

LUCI_TITLE:=NetDogg UI
LUCI_DEPENDS:=+luci-base
LUCI_PKGARCH:=all

PKG_LICENSE:=Apache-2.0
PKG_MAINTAINER:=Local build

define Package/luci-theme-cpe/postrm
#!/bin/sh
	[ -n "$${IPKG_INSTROOT}" ] || {
		[ "$$(uci -q get luci.main.mediaurlbase)" != "/luci-static/cpe" ] || \
			uci set luci.main.mediaurlbase=/luci-static/bootstrap
		uci -q delete luci.themes.CPE
		uci -q delete luci.themes.DogeNetUI
		uci -q delete luci.main.dogenet_initialized
		uci -q delete luci.main.dogenet_theme_user_selected
		uci commit luci
	}
endef

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
