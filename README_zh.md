# PortWeaver OpenWrt 软件包

[English](README.md) | [中文](README_zh.md)

本仓库包含 [PortWeaver](https://github.com/LazuliKao/PortWeaver) 的 OpenWrt 软件包 — 一款灵活的端口转发与 NAT 穿透工具。

## 软件包

- **package/portweaver/** - 核心端口转发引擎二进制文件
- **package/portweaver-lite/** - 轻量化核心端口转发引擎二进制文件
- **package/luci-app-portweaver/** - LuCI Web 管理界面

## 安装

### 预构建包

从 [Releases](../../releases) 下载最新的预构建包并安装：

```bash
# 安装核心包
opkg install portweaver_*.ipk

# 安装 LuCI Web 界面（可选）
opkg install luci-app-portweaver_*.ipk
```

### 从源码构建

#### 使用 GitHub Actions

软件包通过 GitHub Actions 自动构建，支持多种架构：
- x86_64
- aarch64 (ARM64: Raspberry Pi 3/4)
- arm_cortex-a7 (Raspberry Pi 2)
- mipsel_24kc (MT7621 路由器)
- mips_24kc (AR71xx/AR9xxx 路由器)
- 及更多...

#### 手动构建

1. 设置 OpenWrt SDK：
```bash
wget https://downloads.openwrt.org/releases/24.10.5/targets/x86/64/openwrt-sdk-24.10.5-x86-64_gcc-13.3.0_musl.Linux-x86_64.tar.xz
tar -xJf openwrt-sdk-*.tar.xz
cd openwrt-sdk-*
```

2. 将软件包复制到 SDK：
```bash
git clone https://github.com/LazuliKao/openwrt-portweaver.git
cp -r openwrt-portweaver/package/portweaver package/network/portweaver
cp -r openwrt-portweaver/package/luci-app-portweaver package/luci/applications/luci-app-portweaver
```

3. 更新 feeds 并构建：
```bash
./scripts/feeds update -a
./scripts/feeds install -a
make defconfig
make package/portweaver/compile V=s
make package/luci-app-portweaver/compile V=s
```

## LuCI Web 管理界面

安装 `luci-app-portweaver` 后，通过以下路径访问 Web 界面：

**服务 → 网络 → PortWeaver**（admin/network/portweaver）

支持语言：English（默认）、简体中文（zh_Hans）

### 功能标签页

界面包含 6 个功能标签页：

| 标签页 | 功能 |
|--------|------|
| 全局设置 | 服务开关、运行状态仪表板、重启服务 |
| 端口转发 | 项目管理（单端口/多端口模式）、防火墙配置、FRP 集成 |
| DDNS | 25 个 DNS 提供商、IPv4/IPv6 独立配置、Webhook 支持 |
| FRP 隧道 | FRP 客户端节点管理、代理统计 |
| FRP 服务器 | FRP 服务器节点管理、仪表板配置 |
| 系统日志 | 日志查看器（搜索/过滤/高亮/导出） |

> 详细界面截图和说明请参考项目文档。

## UCI 配置

配置文件位于 `/etc/config/portweaver`。

### 配置段

| 配置段 | 说明 | 支持操作 |
|--------|------|----------|
| `portweaver.global` | 全局设置 | 单一实例 |
| `portweaver.project` | 端口转发规则 | 添加/删除/排序/克隆 |
| `portweaver.frpc_node` | FRP 客户端节点 | 添加/删除/排序/克隆 |
| `portweaver.frps_node` | FRP 服务器节点 | 添加/删除/排序/克隆 |
| `portweaver.ddns` | DDNS 配置 | 添加/删除/排序 |

### 示例配置

```uci
config project 'rdp'
    option remark 'Windows RDP'
    option family 'any'
    option protocol 'tcp'
    option listen_port '3389'
    option reuseaddr '1'
    option target_address '192.168.1.100'
    option target_port '3389'
    option open_firewall_port '1'
    option add_firewall_forward '1'

config project 'web'
    option remark 'Web Server'
    option family 'ipv4'
    option protocol 'tcp'
    option listen_port '8080'
    option reuseaddr '1'
    option target_address '192.168.1.200'
    option target_port '80'
    option open_firewall_port '1'
    option add_firewall_forward '0'
```

### 配置选项

| 选项 | 值 | 说明 |
|------|-----|------|
| `remark` | string | 规则描述 |
| `family` | `any`/`ipv4`/`ipv6` | 地址族限制 |
| `protocol` | `both`/`tcp`/`udp` | 转发协议 |
| `listen_port` | 1-65535 | 监听端口 |
| `reuseaddr` | `0`/`1` | 启用 SO_REUSEADDR |
| `target_address` | IP/主机名 | 目标地址 |
| `target_port` | 1-65535 | 目标端口 |
| `open_firewall_port` | `0`/`1` | 自动开放防火墙端口 |
| `add_firewall_forward` | `0`/`1` | 添加防火墙转发规则 |

## UBUS RPC API

### 读取接口

| 端点 | 说明 |
|------|------|
| `get_full_status` | 获取完整服务状态 |
| `list_projects` | 列出所有端口转发项目 |
| `get_frpc_info` | 获取 FRP 客户端信息 |
| `get_frps_info` | 获取 FRP 服务器信息 |
| `get_ddns_status` | 获取 DDNS 状态 |
| `get_ddns_info` | 获取 DDNS 详细信息 |
| `get_frpc_proxy_stats` | 获取 FRP 客户端代理统计 |
| `get_frps_proxy_stats` | 获取 FRP 服务器代理统计 |

### 写入接口

| 端点 | 说明 |
|------|------|
| `set_enabled` | 启用/禁用服务 |
| `clear_frpc_logs` | 清除 FRP 客户端日志 |
| `clear_frps_logs` | 清除 FRP 服务器日志 |
| `clear_ddns_logs` | 清除 DDNS 日志 |

## 服务管理

```bash
# 启动服务
/etc/init.d/portweaver start

# 停止服务
/etc/init.d/portweaver stop

# 重启服务
/etc/init.d/portweaver restart

# 开机自启
/etc/init.d/portweaver enable

# 禁用开机自启
/etc/init.d/portweaver disable
```

### 验证配置

```bash
# 查看 UCI 配置
uci show portweaver

# 前台运行测试
portweaver
```

## 开发

### 前端源码

前端源码位于项目根目录。

```bash
pnpm install
pnpm build
```

- TypeScript，自定义 JSX 工厂（非 React）
- 2 空格缩进，Biome 格式化
- 严格模式，目标 ES5

### 仓库结构

```
openwrt-portweaver/
├── .github/
│   └── workflows/
│       ├── build-openwrt.yml
│       ├── release.yml
│       └── update_hash.sh
├── components/                       # 前端 UI 组件
├── modules/                          # 前端业务逻辑模块
├── types/                            # TypeScript 类型定义
├── utils/                            # 工具函数
├── package/                          # OpenWrt 软件包源码
│   ├── portweaver/                   # 核心 PortWeaver 软件包
│   │   ├── Makefile
│   │   └── files/
│   ├── portweaver-lite/              # 轻量版 PortWeaver 软件包
│   │   └── Makefile
│   └── luci-app-portweaver/          # LuCI 界面软件包
│       ├── Makefile
│       ├── htdocs/
│       │   └── luci-static/resources/view/portweaver/
│       │       └── config.js         # 编译后的前端代码
│       ├── po/                       # 翻译文件 (PO)
│       └── root/                     # 菜单、权限等系统文件
├── main.tsx                          # 前端入口文件
├── rsbuild.config.ts                 # 前端构建配置
├── tsconfig.json                     # TypeScript 配置
├── package.json                      # 依赖与脚本配置
└── README.md
```

## 系统要求

- OpenWrt 24.10.5 或更高版本（或 SNAPSHOT 构建）
- 依赖（自动安装）：
  - `libuci`

## 许可证

MIT License - 详见 [LICENSE](LICENSE) 文件

## 相关项目

- **[PortWeaver](https://github.com/LazuliKao/PortWeaver)** - 核心项目（Zig 实现）
- 使用 [Zig](https://ziglang.org/) 构建

## 支持

相关问题反馈：
- **PortWeaver 核心功能**：[PortWeaver Issues](https://github.com/LazuliKao/PortWeaver/issues)
- **OpenWrt 打包及 LuCI 界面**：[提交 Issue](../../issues)
