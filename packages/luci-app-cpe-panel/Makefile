# SPDX-License-Identifier: Apache-2.0

include $(TOPDIR)/rules.mk

LUCI_TITLE:=NetDogg overview panel
LUCI_DEPENDS:=+luci-base +luci-mod-admin-full +luci-app-mwan3 +rpcd-mod-ucode +jq
LUCI_PKGARCH:=all

PKG_LICENSE:=Apache-2.0
PKG_MAINTAINER:=Local build

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
