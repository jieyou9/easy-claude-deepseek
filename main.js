const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const iconv = require('iconv-lite');

// GBK → UTF-8 解码
const DECODE = (buf) => {
  if (typeof buf === 'string') return buf;
  const utf8 = iconv.decode(buf, 'utf-8');
  if (/[\uFFFD\uFFFE\uFFFF]/.test(utf8)) return iconv.decode(buf, 'gbk');
  return utf8;
};

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 740, height: 520,
    resizable: true, frame: false,
    backgroundColor: '#121212',
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  if (process.argv.includes('--dev')) mainWindow.webContents.openDevTools({ mode: 'detach' });
}

function log(msg, type = 'info') {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('log', { msg, type, timestamp: Date.now() });
  }
}

// ==================== IPC ====================
function setupIPC() {
  // 窗口控制
  ipcMain.handle('window-minimize', () => mainWindow?.minimize());
  ipcMain.handle('window-maximize', () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize(); else mainWindow?.maximize();
  });
  ipcMain.handle('window-close', () => mainWindow?.close());
  ipcMain.handle('open-external', (_, url) => {
    if (url && typeof url === 'string') require('electron').shell.openExternal(url);
  });
  ipcMain.handle('show-context-menu', async () => {
    const { Menu } = require('electron');
    Menu.buildFromTemplate([
      { role: 'undo', label: '撤销' },
      { role: 'redo', label: '重做' },
      { type: 'separator' },
      { role: 'cut', label: '剪切' },
      { role: 'copy', label: '复制' },
      { role: 'paste', label: '粘贴' },
      { type: 'separator' },
      { role: 'selectAll', label: '全选' },
    ]).popup({ window: mainWindow });
  });

  // === 核心：跑 install.ps1 ===
  ipcMain.handle('run-install', async (_, { apiKey }) => {
    // 从 Electron（用户进程）找 node 完整路径，传给提权后的 PowerShell
    let nodePath = '';
    try {
      const r = require('child_process').execSync('where node', { encoding: 'buffer', windowsHide: true, timeout: 5000 });
      nodePath = DECODE(r).trim().split('\n')[0].trim();
    } catch (_) {}

    // 找 cc-switch 安装包
    const exeDir = path.dirname(process.execPath);
    const unpackedDir = path.join(path.dirname(__dirname), 'app.asar.unpacked');
    let ccInstallerPath = '';
    const candidates = [
      path.join(__dirname, 'CC-Switch-v3.15.0-Windows.msi'),
      path.join(unpackedDir, 'CC-Switch-v3.15.0-Windows.msi'),
      path.join(exeDir, 'CC-Switch-v3.15.0-Windows.msi'),
    ];
    for (const p of candidates) {
      try {
        if (fs.existsSync(p)) {
          // asar 里的文件 → 复制到临时目录
          if (p.includes('app.asar')) {
            const tmp = path.join(os.tmpdir(), `cc-switch-${Date.now()}.msi`);
            fs.copyFileSync(p, tmp);
            ccInstallerPath = tmp;
          } else {
            ccInstallerPath = p;
          }
          break;
        }
      } catch (_) {}
    }

    // asar 打包后 PowerShell 读不到，解到临时文件
    const tmpScript = path.join(os.tmpdir(), `cc-deploy-${Date.now()}.ps1`);
    try {
      const content = fs.readFileSync(path.join(__dirname, 'install.ps1'), 'utf-8');
      fs.writeFileSync(tmpScript, '\uFEFF' + content, 'utf-8');
    } catch (e) {
      log(`[ERR] 读取安装脚本失败: ${e.message}`, 'error');
      return { success: false, error: '脚本读取失败' };
    }

    return new Promise((resolve) => {
      const args = [
        '-NoProfile', '-ExecutionPolicy', 'Bypass',
        '-File', tmpScript,
        '-ApiKey', apiKey.trim(),
        '-Silent',
        '-NodePath', nodePath,
        '-ProjectDir', exeDir,
        '-CcInstaller', ccInstallerPath,
      ];
      const child = spawn('powershell.exe', args, { windowsHide: false });

      let allOutput = '';

      const onData = (data) => {
        const text = DECODE(data);
        allOutput += text;
        // 按行发送到前端
        const lines = text.split('\n').filter(l => l.trim());
        for (const line of lines) {
          // 识别步骤关键字 → 发送 step 事件
          const stepMatch = line.match(/步骤\s*(\d+)\/5/);
          if (stepMatch) {
            const stepIdx = parseInt(stepMatch[1]) - 1;
            mainWindow?.webContents.send('install-step', { index: stepIdx, text: line.trim() });
          }
          // 识别成功/失败
          if (line.includes('✅') || line.includes('✔')) {
            log(line.trim(), 'success');
          } else if (line.includes('❌') || line.includes('✘') || line.includes('失败')) {
            log(line.trim(), 'error');
          } else if (line.includes('🎉')) {
            log(line.trim(), 'big-success');
          } else if (line.includes('⏳') || line.includes('步骤')) {
            log(line.trim(), 'step');
          } else {
            log(line.trim(), 'info');
          }
        }
      };

      child.stdout.on('data', onData);
      child.stderr.on('data', onData);

      child.on('close', (code) => {
        // 清理临时脚本
        try { fs.unlinkSync(tmpScript); } catch (_) {}
        log(code === 0 ? '[OK] 安装脚本执行完成 ✅' : `[ERR] 安装脚本退出码: ${code}`, code === 0 ? 'success' : 'error');

        // 从脚本输出中读取 node 路径（脚本装的 Node，它自己最清楚装了哪）
        const npMatch = allOutput.match(/\[NODE_PATH\](.+)/);
        if (npMatch) nodePath = npMatch[1].trim();
        if (!nodePath) {
          const knownPaths = [
            'C:\\Program Files\\nodejs\\node.exe',
            'C:\\Program Files (x86)\\nodejs\\node.exe',
          ];
          nodePath = knownPaths.find(p => fs.existsSync(p)) || '';
          if (!nodePath) try {
            const r = require('child_process').execSync('where node', { encoding: 'buffer', windowsHide: true, timeout: 5000 });
            nodePath = DECODE(r).trim().split('\n')[0].trim();
          } catch (_) {}
        }

        // 通过 ccswitch:// DeepLink 协议配置 DeepSeek（原生方式）
        if (code === 0 && apiKey && apiKey.trim()) {
          const key = apiKey.trim();
          const ccSearchPaths = [
            path.join(process.env.LOCALAPPDATA || '', 'Programs', 'CC Switch', 'cc-switch.exe'),
            path.join(process.env.LOCALAPPDATA || '', 'Programs', 'cc-switch', 'cc-switch.exe'),
            path.join(process.env.ProgramFiles || '', 'CC Switch', 'cc-switch.exe'),
          ];
          const ccExe = ccSearchPaths.find(p => fs.existsSync(p));

          if (ccExe) {
            // 构造 ccswitch://v1/import DeepLink URL
            const params = new URLSearchParams({
              resource: 'provider',
              app: 'claude',
              name: 'DeepSeek',
              endpoint: 'https://api.deepseek.com/anthropic',
              apiKey: key,
              model: 'deepseek-v4-pro',
              haikuModel: 'deepseek-v4-flash',
              sonnetModel: 'deepseek-v4-pro',
              opusModel: 'deepseek-v4-pro',
              icon: 'deepseek',
              homepage: 'https://platform.deepseek.com',
              enabled: 'true',
            });
            const deeplink = `ccswitch://v1/import?${params.toString()}`;

            try {
              // 先启动 cc-switch 初始化数据库
              require('child_process').exec(`start "" "${ccExe}"`);
              log('[INFO] 正在启动 cc-switch...', 'info');
              // 等 3 秒确保启动完成
              require('child_process').execSync('ping 127.0.0.1 -n 4 >nul', { timeout: 5000, windowsHide: true });
              // 打开 DeepLink 触发导入
              require('child_process').exec(`start "" "${deeplink}"`);
              log('[OK] 已通过 DeepLink 触发 cc-switch 导入 ✅', 'success');
              log('💡 请在 cc-switch 弹窗中确认导入 DeepSeek 配置', 'step');
            } catch (e) {
              log(`[WARN] cc-switch DeepLink 触发失败: ${e.message}`, 'warn');
              log('💡 请手动打开 cc-switch → 添加供应商 → 选择 DeepSeek → 填入 API Key', 'step');
            }
          } else {
            log('[WARN] 未找到 cc-switch，请确认安装成功', 'warn');
          }
        }

        // 安装完成 → 弹终端（只设 PATH，不再设 ANTHROPIC_* 环境变量）
        if (code === 0) {
          try {
            const npmDir = path.join(os.homedir(), 'AppData', 'Roaming', 'npm');
            const banner = `echo 🎉 Claude Code 安装完成！ & echo. & echo 输入 claude 按回车即可使用`;
            require('child_process').exec(`start cmd.exe /k "set PATH=${npmDir};%PATH% & ${banner} & mode con cols=80 lines=10"`);
          } catch (_) {}
        }

        resolve({ success: code === 0, output: allOutput });
      });

      child.on('error', (err) => {
        log(`[ERR] 启动安装脚本失败: ${err.message}`, 'error');
        resolve({ success: false, error: err.message });
      });
    });
  });
}

app.whenReady().then(() => { setupIPC(); createWindow(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
