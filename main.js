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

        // 通过临时 JS 脚本写 API Key 到 cc-switch 数据库（绕过 asar）
        if (apiKey && apiKey.trim()) {
          const dbPath = path.join(os.homedir(), '.cc-switch', 'cc-switch.db');
          if (fs.existsSync(dbPath)) {
            const safeKey = apiKey.trim().replace(/'/g, "\\'");
            const jsCode = `
const Database = require('better-sqlite3');
const db = new Database('${dbPath.replace(/\\/g, '\\\\')}', { readonly: false });
const { randomUUID } = require('crypto');

// 1. 清掉其他 Claude 供应商的 is_current
db.prepare("UPDATE providers SET is_current = 0 WHERE app_type = 'claude'").run();

// 2. 配置 DeepSeek 供应商
const settings = {
  env: {
    ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
    ANTHROPIC_API_KEY: '${safeKey}',
    ANTHROPIC_AUTH_TOKEN: '${safeKey}',
    ANTHROPIC_MODEL: 'deepseek-v4-pro',
    ANTHROPIC_DEFAULT_HAIKU_MODEL: 'deepseek-v4-flash',
    ANTHROPIC_DEFAULT_SONNET_MODEL: 'deepseek-v4-pro',
    ANTHROPIC_DEFAULT_OPUS_MODEL: 'deepseek-v4-pro',
  },
  includeCoAuthoredBy: false,
};
const meta = { commonConfigEnabled: true, endpointAutoSelect: true, apiFormat: 'anthropic' };
const ds = db.prepare("SELECT id FROM providers WHERE name = 'DeepSeek' LIMIT 1").get();
if (ds) {
  db.prepare("UPDATE providers SET settings_config = ?, meta = ?, is_current = 1 WHERE id = ?")
    .run(JSON.stringify(settings), JSON.stringify(meta), ds.id);
} else {
  db.prepare("INSERT INTO providers (id, app_type, name, settings_config, website_url, category, created_at, icon, icon_color, meta, is_current, cost_multiplier) VALUES (?, 'claude', 'DeepSeek', ?, 'https://platform.deepseek.com', 'cn_official', ?, 'deepseek', '#1E88E5', ?, 1, '1.0')")
    .run(randomUUID(), JSON.stringify(settings), Date.now(), JSON.stringify(meta));
}

// 3. 启用代理
db.prepare("UPDATE proxy_config SET proxy_enabled = 1, enabled = 1 WHERE app_type = 'claude'").run();

// 4. 添加 DeepSeek 模型显示名
const ms = [
  ['deepseek-v4-pro', 'DeepSeek V4 Pro', '2', '8', '0.50', '2.50'],
  ['deepseek-v4-flash', 'DeepSeek V4 Flash', '0.50', '2', '0.10', '0.60'],
];
const ins = db.prepare("INSERT OR REPLACE INTO model_pricing (model_id, display_name, input_cost_per_million, output_cost_per_million, cache_read_cost_per_million, cache_creation_cost_per_million) VALUES (?, ?, ?, ?, ?, ?)");
for (const m of ms) ins.run(...m);

console.log('OK');
db.close();
`;
            const globalNodeModules = path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'node_modules');
            const tmpJs = path.join(os.tmpdir(), `cc-apikey-${Date.now()}.js`);
            try {
              fs.writeFileSync(tmpJs, jsCode, 'utf-8');
              const r = require('child_process').execSync(`"${nodePath}" "${tmpJs}"`, {
                encoding: 'buffer', timeout: 15000, windowsHide: true,
                env: { ...process.env, NODE_PATH: globalNodeModules },
              });
              if (DECODE(r).trim() === 'OK') {
                log('[OK] API Key 已写入 cc-switch ✅', 'success');
              } else {
                log('[WARN] 未找到 cc-switch 中的 Claude 配置', 'warn');
              }
            } catch (e) {
              log(`[WARN] 写入 API Key 失败: ${e.message}`, 'warn');
            } finally {
              try { fs.unlinkSync(tmpJs); } catch (_) {}
            }
          } else {
            log('[WARN] 未找到 cc-switch 数据库（cc-switch 未安装）', 'warn');
          }
        }

        // 设持久环境变量，claude 开箱即用
        if (code === 0 && apiKey) {
          const key = apiKey.trim();
          try {
            require('child_process').execSync(`setx ANTHROPIC_API_KEY "${key}"`, { timeout: 5000, windowsHide: true });
            require('child_process').execSync(`setx ANTHROPIC_BASE_URL "https://api.deepseek.com/anthropic"`, { timeout: 5000, windowsHide: true });
          } catch (_) {}
        }

        // === 终验 + 一步到位弹终端 ===
        let allOk = code === 0;
        const dbPath = path.join(os.homedir(), '.cc-switch', 'cc-switch.db');
        const ms = path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'node_modules');

        // ① node 可用
        if (allOk) try {
          require('child_process').execSync(`"${nodePath}" -e "console.log('ok')"`, { timeout: 3000, windowsHide: true });
          log('[OK] Node.js 可用 ✅', 'success');
        } catch (_) { log('[WARN] Node.js 不可用', 'warn'); allOk = false; }

        // ② claude 命令存在
        if (allOk) {
          const claudePaths = [
            path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'claude.cmd'),
            path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'claude'),
            'C:\\Program Files\\nodejs\\claude.cmd',
          ];
          const foundClaude = claudePaths.find(p => fs.existsSync(p));
          if (foundClaude) {
            log('[OK] claude 命令已就绪 ✅', 'success');
          } else try {
            require('child_process').execSync('where claude', { timeout: 3000, windowsHide: true, encoding: 'buffer' });
            log('[OK] claude 命令已就绪 ✅', 'success');
          } catch (_) { log('[WARN] claude 命令未找到', 'warn'); allOk = false; }
        }

        // ③ cc-switch 数据库中 DeepSeek 已激活
        if (allOk && fs.existsSync(dbPath)) {
          const vCode = `
const Database = require('better-sqlite3');
const db = new Database('${dbPath.replace(/\\/g, '\\\\')}', { readonly: true });
const r = db.prepare("SELECT name FROM providers WHERE name = 'DeepSeek' AND is_current = 1 LIMIT 1").get();
console.log(r ? r.name : 'NONE');
db.close();
`;
          const vJs = path.join(os.tmpdir(), `cc-vfy-${Date.now()}.js`);
          try {
            fs.writeFileSync(vJs, vCode, 'utf-8');
            const r2 = require('child_process').execSync(`"${nodePath}" "${vJs}"`, { encoding: 'buffer', timeout: 10000, windowsHide: true, env: { ...process.env, NODE_PATH: ms } });
            const pn = DECODE(r2).trim();
            if (pn && pn !== 'NONE') { log(`[OK] 当前 Claude 供应商: ${pn} ✅`, 'success'); }
            else { log('[WARN] cc-switch 中没有激活的 Claude 供应商', 'warn'); allOk = false; }
          } catch (_) { allOk = false; } finally { try { fs.unlinkSync(vJs); } catch (_) {} }
        } else if (allOk) {
          allOk = false;
        }

        // 全部通过 → 一步到位：弹 cc-switch + cmd 终端（环境变量已就绪）
        if (allOk) {
          const key = apiKey.trim();
          try {
            const ccPaths = [
              path.join(process.env.LOCALAPPDATA || '', 'Programs', 'CC Switch', 'cc-switch.exe'),
              path.join(process.env.LOCALAPPDATA || '', 'Programs', 'cc-switch', 'cc-switch.exe'),
              path.join(process.env.ProgramFiles || '', 'CC Switch', 'cc-switch.exe'),
            ];
            const ccExe = ccPaths.find(p => fs.existsSync(p));
            if (ccExe) require('child_process').exec(`start "" "${ccExe}"`);
            // cmd 终端：预置 env var + PATH，敲 claude 即用
            const npmDir = path.join(os.homedir(), 'AppData', 'Roaming', 'npm');
            const banner = `echo 🎉 Claude Code 安装完成！ & echo. & echo 输入 claude 按回车即可使用`;
            require('child_process').exec(`start cmd.exe /k "set PATH=${npmDir};%PATH% & set ANTHROPIC_API_KEY=${key} & set ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic & ${banner} & mode con cols=80 lines=10"`);
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
