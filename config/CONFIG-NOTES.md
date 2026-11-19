# .config 与参考配置的差异说明

基线：`melonpi-m21-16m-reference.config`（来自板卡供应方的 MelonPi M21 16M 构建树）
最终：`final.config`（本次实际编译通过并产出镜像的配置）

完整 diff 见 `config-diff-vs-reference.txt`。主要差异如下。

## 1. 目标 profile 改为单档

```diff
-CONFIG_TARGET_ramips_mt7621_DEVICE_melonpi-m21-16m=y
-# CONFIG_TARGET_ramips_mt7621_DEVICE_melonpi-m21-32m is not set
-CONFIG_TARGET_PROFILE="DEVICE_melonpi-m21-16m"
+CONFIG_TARGET_ramips_mt7621_DEVICE_melonpi-m21=y
+CONFIG_TARGET_PROFILE="DEVICE_melonpi-m21"
```

DTS 从 `dtsi + 两个变体 dts` 合并为单文件 `mt7621_melonpi-m21.dts`，firmware 分区固定为 `0x50000 + 0xfb0000`（16064 KiB），`IMAGE_SIZE := 16064k`。

## 2. 删除无线相关选型

实机无无线模块（pcie0/1/2 无卡，`/sys/class/ieee80211` 为空），因此移除：

- `CONFIG_PACKAGE_kmod-mac80211`
- `CONFIG_PACKAGE_kmod-mt76-core`
- `CONFIG_PACKAGE_kmod-mt76x02-common`
- `CONFIG_PACKAGE_kmod-mt76x2`
- `CONFIG_PACKAGE_kmod-mt76x2-common`
- `CONFIG_PACKAGE_hostapd-common`
- `CONFIG_PACKAGE_wpad-openssl`

`mt7621.mk` 的 Device 定义中同时保留 `-wpad-basic-mbedtls`。构建脚本会校验 `.config` 与 manifest 中不出现上述包。

## 3. 保留的业务选型

- `luci-theme-cpe`、`luci-app-cpe-panel`
- `mwan3`、`luci-app-mwan3`
- `qmodem`、`luci-app-qmodem-next`、`kmod-qmi_wwan_f/q/s`、`qmodem` 相关工具
- `kmod-mmc-mtk`、`kmod-usb3`、`kmod-usb-net-qmi-wwan`

## 4. feeds 增加 qmodem

`config/feeds.conf` 在官方五个 feed 之外增加：

```
src-git qmodem https://github.com/FUjr/QModem.git;main
```

构建脚本在 `feeds update -a` 后把 `feeds/qmodem` 固定到 `d28f330ee40ab5cc866e491e925a2e9e230c001a`，再 `feeds update -i` 重建索引。

## 5. 保留但需要注意的项

- `CONFIG_TARGET_ROOTFS_PARTSIZE=2048`：单位为 MiB，仅影响 ext4/rootfs-part 镜像。16 MiB flash 下 ext4 镜像会因超限被丢弃（日志中有 `ext4-sysupgrade.bin is too big` 告警），squashfs 镜像正常。
- `CONFIG_PCI_SUPPORT=y`：由 mt7621 subtarget 的 Kconfig `select` 强制开启，`.config` 中改成 n 会被 defconfig 还原。DTS 已删除所有 PCIe 节点，硬件层面无 PCIe；如要连内核 PCI 代码一并去掉，需修改 `target/linux/ramips/Makefile` 的 subtarget select，影响所有 mt7621 设备，本仓库未做。
