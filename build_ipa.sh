#!/bin/bash
# 补药 iOS 一键打包脚本
#
# 用法：在 Mac 上打开「终端」，cd 到本目录，执行
#   chmod +x build_ipa.sh
#   ./build_ipa.sh
#
# 产出：ipa/BuYao.ipa
#
# 免费 Apple ID 也能用（development 签名，装到自己的手机，7 天有效期）。
# 首次运行会弹窗让你登录 Apple ID 并选择证书，按提示点即可。

set -euo pipefail

cd "$(dirname "$0")"

PROJECT="BuYao.xcodeproj"
SCHEME="BuYao"
ARCHIVE="build/BuYao.xcarchive"
EXPORT_DIR="build/ipa"

echo "=============================================="
echo " 补药 iOS 打包"
echo "=============================================="
echo ""

# ---- 环境检查 ----
if [[ "$(uname)" != "Darwin" ]]; then
  echo "✗ 本脚本只能在 macOS 上运行（需要 Xcode）"
  exit 1
fi

if ! command -v xcodebuild >/dev/null 2>&1; then
  echo "✗ 未找到 xcodebuild，请先安装 Xcode："
  echo "    App Store 搜索 Xcode 安装，然后执行"
  echo "    sudo xcode-select -s /Applications/Xcode.app"
  exit 1
fi

echo "✓ Xcode: $(xcodebuild -version | head -1)"
echo ""

# ---- 清理 ----
rm -rf build
mkdir -p "$EXPORT_DIR"

# ---- 1. 归档 ----
echo "[1/2] 正在归档..."
xcodebuild \
  -project "$PROJECT" \
  -scheme "$SCHEME" \
  -configuration Release \
  -sdk iphoneos \
  -archivePath "$ARCHIVE" \
  -allowProvisioningUpdates \
  -quiet \
  archive

if [[ ! -d "$ARCHIVE" ]]; then
  echo "✗ 归档失败"
  exit 1
fi
echo "✓ 归档完成"
echo ""

# ---- 2. 导出 IPA ----
echo "[2/2] 正在导出 IPA..."
xcodebuild \
  -exportArchive \
  -archivePath "$ARCHIVE" \
  -exportPath "$EXPORT_DIR" \
  -exportOptionsPlist ExportOptions.plist \
  -allowProvisioningUpdates \
  -quiet

IPA=$(find "$EXPORT_DIR" -name "*.ipa" | head -1)
if [[ -z "$IPA" ]]; then
  echo "✗ 导出失败"
  exit 1
fi

echo ""
echo "=============================================="
echo " ✓ 打包成功"
echo "=============================================="
echo ""
echo " IPA 路径: $PWD/$IPA"
echo " 大小:     $(du -h "$IPA" | cut -f1)"
echo ""
echo " 安装方式："
echo "   1. 手机连上 Mac，打开 Xcode → Devices and Simulators"
echo "   2. 把上面的 .ipa 拖进设备列表即可"
echo ""
echo "   或用爱思助手 / 蒲公英等工具安装"
echo ""
