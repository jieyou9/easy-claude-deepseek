# easy-claude-deepseek 🚀

**Claude Code + DeepSeek 一键部署工具** — Windows 桌面安装程序，自动配置 Claude Code 使用 DeepSeek API。

---

## 使用方式

### 方式一：运行安装程序（推荐）

从 `dist/` 目录下载 `easy-claude-deepseek Setup 1.0.0.exe`，双击安装。

安装步骤：

1. 填写你的 **DeepSeek API Key**（去 [platform.deepseek.com](https://platform.deepseek.com) 申请）
2. 点击 **一键自动安装**
3. 程序自动完成：
   - 检测/安装 Node.js
   - 配置 npm 淘宝镜像（中国大陆加速）
   - 安装 cc-switch 网络切换工具
   - 安装 Git for Windows
   - 安装 `@anthropic-ai/claude-code`
   - 通过 **cc-switch DeepLink** 导入 DeepSeek 供应商配置
4. 在 cc-switch 弹窗中确认导入
5. 打开新终端，输入 `claude` 即可使用

### 方式二：独立 PowerShell 脚本（无需 GUI）

```powershell
# 安装全部 + 配置 DeepSeek API
.\install.ps1 -ApiKey "sk-xxxxxxxx"

# 仅检测环境（不安装）
.\install.ps1
```

### 方式三：开发模式

```bash
cd claude-code-deployer
npm start
```

---

## 安装流程（5 步）

| 步骤 | 说明 |
|------|------|
| ① 检测环境 | 检测 Node.js / npm，缺失则自动下载安装 |
| ② 配置源 | npm registry 切换至淘宝镜像 |
| ③ 装工具 | 安装 cc-switch + Git for Windows |
| ④ 装 Claude | `npm install -g @anthropic-ai/claude-code` |
| ⑤ 配 Key | 通过 cc-switch DeepLink 协议导入 DeepSeek 配置 |

## 原理

Claude Code 使用 `@anthropic-ai/sdk` 连接 API。cc-switch 拦截请求并路由到 DeepSeek 的 Anthropic 兼容接口 `https://api.deepseek.com/anthropic`，实现透明代理。

配置写入后，cc-switch 中会激活 DeepSeek 供应商，并设置以下模型映射：

| 环境变量 | 值 |
|---|---|
| `ANTHROPIC_BASE_URL` | `https://api.deepseek.com/anthropic` |
| `ANTHROPIC_MODEL` | `deepseek-v4-pro` |
| `ANTHROPIC_DEFAULT_HAIKU_MODEL` | `deepseek-v4-flash` |
| `ANTHROPIC_DEFAULT_SONNET_MODEL` | `deepseek-v4-pro` |
| `ANTHROPIC_DEFAULT_OPUS_MODEL` | `deepseek-v4-pro` |

---

## 项目结构

```
easy-claude-deepseek/
├── main.js                  # Electron 主进程
├── preload.js               # 安全 IPC 桥接
├── package.json             # 项目 + 构建配置
├── install.ps1              # 核心安装脚本（可脱离 Electron 使用）
├── CC-Switch-v3.15.0-Windows.msi  # cc-switch 离线安装包
├── renderer/
│   └── index.html           # 暗色主题 UI（5 步进度 + 实时日志）
├── scripts/
│   └── build.bat            # 构建脚本
└── README.md                # 本文件
```

## 构建

```bash
# 编译为 NSIS 安装包
npm run build

# 编译为免安装目录
npm run build:dir
```

编译产物在 `dist/` 目录下。

## 注意事项

- **API Key** 需要在 [DeepSeek 官网](https://platform.deepseek.com/) 注册获取
- 安装程序需要**管理员权限**（安装 MSI 和写系统环境变量需要）
- **cc-switch** 是社区开源工具，详见 [github.com/farion1231/cc-switch](https://github.com/farion1231/cc-switch)
- 首次安装后需在 cc-switch 弹窗中确认导入 DeepSeek 供应商配置
- 如需重新配置，在 cc-switch GUI 中切换供应商或重新运行安装程序

## 常见问题

**Q: 安装后 claude 命令不可用？**
A: 关掉当前终端，新开一个 cmd 或 PowerShell 再试。

**Q: claude 显示登录界面而不是直接进入？**
A: cc-switch 可能未正常配置。打开 cc-switch → 检查供应商是否切换为 DeepSeek。

**Q: 在中国大陆下载速度慢？**
A: 安装程序已自动配置 npm 淘宝镜像。如果 cc-switch MSI 下载慢，可手动下载放在项目目录。
