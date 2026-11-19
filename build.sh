#!/usr/bin/env bash
#
# MelonPi M21 (MT7621 / 16 MiB SPI NOR) 一键构建脚本
#
# 固定版本（与已验证的发布镜像一致）：
#   ImmortalWrt : https://github.com/immortalwrt/immortalwrt.git
#                 commit c4c69cfede1bd4a28fa01b9079a7eb61ef4fed4a
#   QModem feed : https://github.com/FUjr/QModem.git
#                 branch main, commit d28f330ee40ab5cc866e491e925a2e9e230c001a
#
# 用法：
#   ./build.sh                 # 默认 8 并发，工作目录 ~/melonpi-m21-build
#   JOBS=16 ./build.sh         # 指定并发
#   WORK_DIR=/data/build ./build.sh
#
# 依赖（Debian/Ubuntu，需 sudo）：
#   build-essential clang flex bison g++ gawk gcc-multilib g++-multilib \
#   gettext git libncurses-dev libssl-dev python3 python3-pyelftools \
#   rsync swig unzip zlib1g-dev libelf-dev texinfo
#
set -euo pipefail

IMMORTALWRT_REPO="https://github.com/immortalwrt/immortalwrt.git"
IMMORTALWRT_COMMIT="c4c69cfede1bd4a28fa01b9079a7eb61ef4fed4a"

QMODEM_REPO="https://github.com/FUjr/QModem.git"
QMODEM_BRANCH="main"
QMODEM_COMMIT="d28f330ee40ab5cc866e491e925a2e9e230c001a"

PROFILE="DEVICE_melonpi-m21"
IMAGE_SIZE_KIB=16064
IMAGE_MAX_BYTES=$((IMAGE_SIZE_KIB * 1024))

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK_DIR="${WORK_DIR:-$HOME/melonpi-m21-build}"
SRC="$WORK_DIR/immortalwrt"
JOBS="${JOBS:-$(nproc)}"

log()  { printf '\n==> [%s] %s\n' "$(date '+%H:%M:%S')" "$*"; }
die()  { printf '\nERROR: %s\n' "$*" >&2; exit 1; }
trap 'printf "\n构建失败，退出码 %s\n" "$?" >&2' ERR

log "检查宿主依赖"
for cmd in git make gcc g++ python3 rsync unzip wget; do
	command -v "$cmd" >/dev/null 2>&1 || die "缺少命令：$cmd（请先安装 README 中的依赖）"
done
command -v dtc >/dev/null 2>&1 || true

mkdir -p "$WORK_DIR"
log "工作目录：$WORK_DIR，并发：$JOBS"

if [ ! -d "$SRC/.git" ]; then
	log "克隆 ImmortalWrt"
	git clone "$IMMORTALWRT_REPO" "$SRC"
fi

log "切换到固定的 ImmortalWrt commit：$IMMORTALWRT_COMMIT"
git -C "$SRC" fetch origin
git -C "$SRC" checkout --force "$IMMORTALWRT_COMMIT"
git -C "$SRC" reset --hard "$IMMORTALWRT_COMMIT"
git -C "$SRC" clean -fdx -e dl
[ "$(git -C "$SRC" rev-parse HEAD)" = "$IMMORTALWRT_COMMIT" ] || die "ImmortalWrt commit 不匹配"

log "应用板级补丁 board/0001-ramips-add-melonpi-m21-support.patch"
PATCH="$REPO_DIR/board/0001-ramips-add-melonpi-m21-support.patch"
[ -f "$PATCH" ] || die "补丁不存在：$PATCH"
git -C "$SRC" apply --check "$PATCH" || die "补丁无法应用，请确认 ImmortalWrt commit 未被改动"
git -C "$SRC" apply "$PATCH"

grep -q 'define Device/melonpi-m21' "$SRC/target/linux/ramips/image/mt7621.mk" \
	|| die "补丁后未找到 Device/melonpi-m21"
grep -q "IMAGE_SIZE := ${IMAGE_SIZE_KIB}k" "$SRC/target/linux/ramips/image/mt7621.mk" \
	|| die "mt7621.mk 中 IMAGE_SIZE 不是 ${IMAGE_SIZE_KIB}k"
[ -f "$SRC/target/linux/ramips/dts/mt7621_melonpi-m21.dts" ] \
	|| die "板级 DTS 缺失"

log "配置 feeds（含第三方 QModem feed）"
cp "$REPO_DIR/config/feeds.conf" "$SRC/feeds.conf"
cd "$SRC"
./scripts/feeds update -a
git -C feeds/qmodem fetch origin || true
git -C feeds/qmodem checkout --detach "$QMODEM_COMMIT"
[ "$(git -C feeds/qmodem rev-parse HEAD)" = "$QMODEM_COMMIT" ] || die "QModem commit 不匹配"
./scripts/feeds update -i
./scripts/feeds install -a

log "放入 LuCI 主题与面板包"
cp -a "$REPO_DIR/packages/luci-theme-cpe" "$SRC/package/"
cp -a "$REPO_DIR/packages/luci-app-cpe-panel" "$SRC/package/"

log "应用 .config 并执行 defconfig"
cp "$REPO_DIR/config/final.config" "$SRC/.config"
make defconfig
grep -q "^CONFIG_TARGET_PROFILE=\"$PROFILE\"" .config || die "profile 不是 $PROFILE"
grep -q '^CONFIG_TARGET_ramips_mt7621_DEVICE_melonpi-m21=y' .config || die "melonpi-m21 设备未选中"
grep -q '^CONFIG_PACKAGE_luci-theme-cpe=y' .config || die "luci-theme-cpe 未选中"
grep -q '^CONFIG_PACKAGE_luci-app-cpe-panel=y' .config || die "luci-app-cpe-panel 未选中"
grep -q '^CONFIG_PACKAGE_luci-app-qmodem-next=y' .config || die "luci-app-qmodem-next 未选中"
if grep -qE '^CONFIG_PACKAGE_(wpad|hostapd)' .config; then
	die "本板无无线，但 .config 仍选中了 wpad/hostapd"
fi

log "开始编译（make -j$JOBS）"
make -j"$JOBS"

log "校验产物"
IMG="$(ls bin/targets/ramips/mt7621/*melonpi-m21*squashfs-sysupgrade.bin 2>/dev/null | head -n1)"
[ -n "$IMG" ] || die "未生成 squashfs sysupgrade 镜像"
SIZE=$(stat -c %s "$IMG")
[ "$SIZE" -le "$IMAGE_MAX_BYTES" ] || die "镜像 $SIZE 字节超过 $IMAGE_MAX_BYTES 字节（${IMAGE_SIZE_KIB} KiB）"

MANIFEST="$(ls bin/targets/ramips/mt7621/*melonpi-m21.manifest 2>/dev/null | head -n1)"
if [ -n "$MANIFEST" ] && grep -qE '^(wpad|hostapd|kmod-mt76|kmod-mac80211)' "$MANIFEST"; then
	die "manifest 中出现无线相关包，与本板规格不符"
fi

printf '\n构建成功\n'
printf '  镜像    : %s\n' "$IMG"
printf '  大小    : %s 字节（上限 %s）\n' "$SIZE" "$IMAGE_MAX_BYTES"
printf '  SHA-256 : %s\n' "$(sha256sum "$IMG" | awk '{print $1}')"
printf '  manifest: %s\n' "${MANIFEST:-未生成}"
