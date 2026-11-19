# MelonPi M21 — ImmortalWrt 板级支持与固件

面向 **MelonPi M21**（MediaTek MT7621，16 MiB SPI NOR，无无线、无 PCIe）的 ImmortalWrt 板级支持、可复现构建脚本与预编译固件。

- 目标平台：`ramips/mt7621`
- profile：`DEVICE_melonpi-m21`（单 profile，不使用 16M/32M 双档命名）
- 设备树 compatible：`melonpi,m21`
- 已验证源码基线：ImmortalWrt master `c4c69cfede1bd4a28fa01b9079a7eb61ef4fed4a`

## 硬件规格

| 项目 | 规格 |
|---|---|
| SoC | MediaTek MT7621，880 MHz，4 线程（2C2T） |
| 内存 | 256 MiB DDR（由 bootloader 传递，DTS 不定义 memory 节点） |
| Flash | 16 MiB SPI NOR |
| 分区 | u-boot `0x0-0x30000`（192K）；u-boot-env `0x30000-0x40000`（64K）；factory `0x40000-0x50000`（64K）；firmware `0x50000-0x1000000`（16064K） |
| 有线 | 1× WAN（gmac1）+ 1× LAN（MT7530 switch port 1） |
| USB | USB 3.0（xhci，DFT 默认路径未改动） |
| 存储卡 | microSD（sdhci） |
| 无线 | 无（pcie0/1/2 均无卡，无 802.11 设备） |
| PCIe | 无。DTS 用 `/delete-node/` 删除 PCIe 控制器、两个 PHY 及 pcie pinctrl |
| LED | GPIO0 = `green:sys`，高电平有效；GPIO16 = `blue:power`，高电平有效 |
| 按键 | GPIO13 = `user`（EV_SW），低电平有效；GPIO18 = `reset`，低电平有效 |
| 串口 | UART0，`console=ttyS0,115200` |

## 仓库结构

```
board/
  mt7621_melonpi-m21.dts               # 单 profile 板级 DTS
  mt7621.mk                            # ImmortalWrt 修改后的完整 image 定义
  02_network                           # 修改后的 board.d 网络脚本
  platform.sh                          # 修改后的 sysupgrade 脚本
  0001-ramips-add-melonpi-m21-support.patch  # 带 commit message 的完整补丁（可 git apply / git am）
  melonpi-m21-board.patch              # 纯 diff（不含邮件头）
  melonpi-m21.patch                    # 参考：qooke/openwrt 原始 16M/32M 双档补丁
packages/
  luci-theme-cpe/                      # CPE 主题（原样拷贝）
  luci-app-cpe-panel/                  # CPE 面板（原样拷贝）
config/
  final.config                         # 本次验证过的最终 .config
  feeds.conf                           # 五个官方 feed + qmodem
  config-diff-vs-reference.txt         # 与参考 16M 配置的完整 diff
  CONFIG-NOTES.md                      # 配置差异与原因说明
build.sh                               # 从零构建脚本（固定 ImmortalWrt 与 QModem 版本）
.github/workflows/build.yml            # GitHub Actions：构建并上传 artifact / release
LICENSE                                # GPL-2.0-only
```

## 构建

### 1. 安装依赖（Debian/Ubuntu，需要 sudo）

```bash
sudo apt-get update
sudo apt-get install -y build-essential clang flex bison g++ gawk \
  gcc-multilib g++-multilib gettext git libncurses-dev libssl-dev \
  python3 python3-pyelftools rsync swig unzip zlib1g-dev libelf-dev texinfo
```

### 2. 一键构建

```bash
git clone <本仓库地址> melonpi-m21-openwrt
cd melonpi-m21-openwrt
./build.sh                  # 默认 nproc 并发、工作目录 ~/melonpi-m21-build
# 可选：JOBS=16 WORK_DIR=/data/build ./build.sh
```

脚本会严格按以下顺序执行，任一步失败立即退出：

1. `git clone` ImmortalWrt 并检出固定 commit `c4c69cfe`；
2. `git apply` 板级补丁，并校验 `Device/melonpi-m21`、`IMAGE_SIZE := 16064k`、DTS 存在；
3. 写入 `feeds.conf`，`feeds update -a`，将 `feeds/qmodem` 固定到 `d28f330e` 后重建索引、`feeds install -a`；
4. 复制 `luci-theme-cpe`、`luci-app-cpe-panel` 到 `package/`；
5. 应用 `config/final.config`，`make defconfig`，校验 profile、关键包（含 USB 存储相关 kmod）与 board 元数据变量，拒绝 wpad/hostapd；
6. `make -j$(nproc)`；
7. 校验镜像存在、大小 ≤ 16,449,536 字节（16064 KiB），检查 manifest 不含无线包，输出 SHA-256。

产物位于 `~/melonpi-m21-build/immortalwrt/bin/targets/ramips/mt7621/`。

## 预编译固件

最新版本：`v1.3.0-20261119`（在 `v1.2.0-20261119` 基础上精简概览、移除无线/散热 UI 并新增接口状态）

| 文件 | 大小 | SHA-256 |
|---|---|---|
| `immortalwrt-ramips-mt7621-melonpi-m21-squashfs-sysupgrade.bin` | 14,156,325 字节（约 13.5 MiB） | `ea3bdcbbbfc7fdd687f1e6f23c5a37e16024eb3e9fecaff846b0ebcb8553824e` |

- 内核：`6.18.60~cbfbdaf4542642d3afbc7d77f8147cb0-r1`（与 v1.1.0/v1.2.0 相同，UI 改动不影响内核哈希）
- metadata：`new_supported_devices = ["melonpi,m21"]`、`board = "melonpi,m21"`，设备上 `sysupgrade -T` 可通过
- 镜像内含：`luci-theme-cpe`、`luci-app-cpe-panel`、`mwan3`、`qmodem` + `luci-app-qmodem-next`、`kmod-qmi_wwan_f/q/s`、`kmod-mmc-mtk`、`kmod-usb3`；不含 wpad/hostapd/kmod-mt76/kmod-mac80211
- USB 存储：`kmod-usb-storage`、`kmod-usb-storage-uas`、`kmod-scsi-core`、`kmod-fs-vfat`、`kmod-fs-exfat`、`kmod-nls-cp437`（依赖 `kmod-nls-iso8859-1`），支持 **FAT32 / exFAT / ext4**，**NTFS 不支持**
- 首次启动后 rootfs_data 约 **2.19 MB**（2176 KiB）

### 本版 UI 变更（v1.3.0）

- 网络总览只保留一个标题（去掉 NetDogg 眉题与 Network health 区块标题），压缩头部与拓扑高度，下方内容不再被挤压。
- 拓扑删除“无线桥接”节点和“无线客户端”区块；删除散热卡片及 `globalnet.fan` 请求（设备无 WiFi、无风扇）。
- 原散热位置改为“网络接口状态”：展示 WAN/LAN 的 up/down、协议、链路速率、双工与 IPv4 地址，数据来自现有 LuCI network 接口；WAN 获取失败时显示“状态不可用”。
- 路由器信息卡移到网络总览下方。
- 状态菜单中重复的 MultiWAN 管理器隐藏，保留“网络”下的入口（menu.d 覆盖 + 主题侧过滤）。
- 新增文案补全 zh_Hans 翻译。
- 延续上一版：5 秒增量刷新、失败/空态区分、12px 正文与 AA 对比度、1024 无横向裁切、SVG 命名空间图标修复、菜单/语言无障碍。
- 若浏览器仍显示旧样式或旧图标，请**硬刷新**一次（Ctrl+F5 / 清除站点缓存）；`dashboard_network.js` 本身不带版本参数。

### 用 U 盘扩展 overlay（extroot）

本版已具备 USB 存储与 ext4 支持，可把 overlay 迁移到 U 盘的 ext4 分区。先把目标分区格式化为 ext4（例如 `mkfs.ext4 /dev/sda2`），再编辑 `/etc/config/fstab`：

```
config mount
	option target '/overlay'
	option device '/dev/sda2'
	option fstype 'ext4'
	option enabled '1'
	option enabled_fsck '1'
```

要点：**必须写 `/dev/sda2`，不要用 UUID**。preinit 阶段的卷缓存识别不到 USB 分区，用 UUID 会在挂载 overlay 之前找不到设备，导致回落到内置 rootfs_data。启用 extroot 后内置 rootfs_data 不再用于 overlay。

## 已知限制

1. **只有 squashfs sysupgrade 镜像**。参考配置保留 `CONFIG_TARGET_ROOTFS_PARTSIZE=2048`（MiB），构建 ext4 变体会因超过 16 MiB flash 被丢弃并告警；squashfs 镜像不受影响。
2. **内核 PCI 代码仍会编译**。`CONFIG_PCI_SUPPORT` 由 mt7621 subtarget 的 Kconfig `select` 强制为 y，无法通过 `.config` 关闭；DTS 已删除全部 PCIe 节点，驱动不会绑定，但内核仍含 PCI 核心代码。要彻底移除需修改 `target/linux/ramips/Makefile` 的 subtarget `select`，会影响该树所有 mt7621 设备，本仓库未做。
3. **qmodem 依赖第三方 feed**：`https://github.com/FUjr/QModem.git`（main，固定 `d28f330e`）。上游未来变更可能导致需要重新适配。
4. 本板无无线，镜像内不含 wpad/hostapd；这是预期行为，不是缺包。
5. 仅在 16 MiB SPI NOR 的 MelonPi M21 上验证；未验证 32M 变体或其他板型。
6. 内存容量 256 MiB 由 bootloader 决定，DTS 不写死 memory 节点；更换 bootloader 参数会改变可用内存。
7. **内核模块必须与镜像同源**：本版内核为 `6.18.60~cbfbdaf4…`，只能使用同一棵树、同一 commit（`c4c69cfe`）编译出的 kmod。官方 snapshot 的 kmod 钉在 `6.18.60~6ddfb7f4…`，其他旧镜像的 kmod 也无法匹配，均不能安装。
8. **NTFS 不支持**：镜像只包含 vfat/exfat/ext4 驱动；如需要 NTFS，请自行编译 `kmod-fs-ntfs3` 或安装用户态 `ntfs-3g`（均未包含）。

## 刷写注意事项

> 本仓库不提供、也不执行任何刷写操作，以下仅为说明。

1. 确认设备为 **16 MiB flash** 版本；不要把 32M 布局镜像写入 16M 设备。
2. 从原厂/旧固件升级：`sysupgrade -F immortalwrt-ramips-mt7621-melonpi-m21-squashfs-sysupgrade.bin`。刷机可保留配置或按需清空；从非本仓库旧固件升级、或跨内核对齐时建议不保留配置。该镜像 compat 为 1.1，保留旧 swconfig 配置会触发强制擦除提示。
3. 刷写前校验 SHA-256，刷写过程中不要断电。
4. 恢复方式：上电时按住 reset 约 5 秒进入 U-Boot 恢复页面（默认 `192.168.1.1`），上传同一镜像。
5. 首次启动会创建 rootfs_data 覆盖层，本版约 2.19 MB（2176 KiB）；如需更大空间，可按上文用 U 盘 ext4 分区做 extroot。

## 上游来源与许可

- ImmortalWrt：<https://github.com/immortalwrt/immortalwrt>，GPL-2.0-only。
- 板级 DTS 的初始版本参考 qooke/openwrt 提交 `8d7e4f7934`（MelonPi M21 16M/32M 双档支持），本仓库改写为单 profile 并删除 PCIe 节点。参考补丁保留在 `board/melonpi-m21.patch`。
- LuCI 主题与面板包来自板卡供应方提供的 `netdogg-cpe` 包，版权归其作者所有。
- 本仓库整体以 **GPL-2.0-only** 发布，完整文本见 [LICENSE](LICENSE)。

## 免责声明

本仓库的板级支持、构建脚本与固件按“现状”提供，不附带任何明示或暗示担保。刷写第三方固件存在设备变砖、数据丢失与保修失效的风险，请在理解风险并做好恢复准备后自行决定是否使用。作者不对因使用本仓库内容造成的任何直接或间接损失负责。
