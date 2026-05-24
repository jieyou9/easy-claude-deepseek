# Claude Code Deployer 🚀

**Claude Code 环境一键部署工具** — 全自动、零交互、桌面级安装体验。

## 快速开始

### 开发模式（推荐先试运行）

```bash
cd claude-code-deployer
npm start
```

### 编译为安装包

```bash
# 方式一：双击运行
scripts\build.bat

# 方式二：命令行
npm run build
```

编译后的 .exe 安装包在 `dist/` 目录下。

### 独立使用 PowerShell 脚本（无需 Electron）

```powershell
# 带 API Key 静默安装
.\install.ps1 -ApiKey "sk-ant-xxxx" -ProxyUrl "http://127.0.0.1:7890"

# 仅检测环境
.\install.ps1
```

## 功能特性

| 功能 | 说明 |
|------|------|
| ✅ 环境自动检测 | Node.js / npm / cc-switch / Claude Code |
| ✅ 淘宝镜像加速 | 自动切换 registry.npmmirror.com |
| ✅ cc-switch 安装 | 全局安装社区网络切换工具 |
| ✅ Claude Code 安装 | 全局安装 @anthropic-ai/claude-code |
| ✅ API Key 配置 | 写入 .claude.json + 环境变量 |
| ✅ 代理配置 | 可选，中国大陆用户配置 cc-switch 代理 |
| ✅ 桌面级 UI | 暗色主题、实时日志、进度动画 |

## 项目结构

```
claude-code-deployer/
├── main.js              # Electron 主进程
├── preload.js           # 安全 IPC 桥接
├── package.json         # 项目 + 构建配置
├── install.ps1          # 独立安装脚本（可脱离 Electron 使用）
├── renderer/
│   └── index.html       # 暗色主题 UI
└── scripts/
    └── build.bat        # 构建脚本
```

## 注意事项

- **API Key** 需要自行在 [DeepSeek API KEY](https://platform.deepseek.com/) 申请
- **网络**：在中国大陆使用需自行配置代理或 VPN
- **cc-switch** 是社区第三方工具，非 Anthropic 官方出品
- **[CC-Switch](https://github.com/farion1231/cc-switch)
