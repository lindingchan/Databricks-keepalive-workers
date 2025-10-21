// 环境变量优先，没有则使用代码里填写的
const DEFAULT_CONFIG = {
  DATABRICKS_HOST: 'https://dbc-a4f5d119-5683.cloud.databricks.com',    // (必填)直接在单引号内填写工作区host或添加环境变量,变量名：DATABRICKS_HOST
  DATABRICKS_TOKEN: '',        // (必填)直接在单引号内填写token或添加环境变量,变量名：DATABRICKS_TOKEN
  CHAT_ID: '1011577474',                                                       // 直接在单引号内填写Telegram聊天或添加环境变量CHAT_ID,须同时填写BOT_TOKEN(可选配置)
  BOT_TOKEN: '8031697059:AAGN9sIRMBJxXugX4k9GhM9U9eU58C40PgY'                                                      // 直接在单引号内填写Telegram机器人或添加环境变量,须同时填写CHAT_ID
};

// 获取配置
function getConfig(env) {
  const host = env.DATABRICKS_HOST || DEFAULT_CONFIG.DATABRICKS_HOST;
  const token = env.DATABRICKS_TOKEN || DEFAULT_CONFIG.DATABRICKS_TOKEN;
  const chatId = env.CHAT_ID || DEFAULT_CONFIG.CHAT_ID;
  const botToken = env.BOT_TOKEN || DEFAULT_CONFIG.BOT_TOKEN;
  
  return {
    DATABRICKS_HOST: host,
    DATABRICKS_TOKEN: token,
    CHAT_ID: chatId,
    BOT_TOKEN: botToken,
    source: {
      host: env.DATABRICKS_HOST ? '环境变量' : '默认值',
      token: env.DATABRICKS_TOKEN ? '环境变量' : '默认值',
      chatId: env.CHAT_ID ? '环境变量' : '默认值',
      botToken: env.BOT_TOKEN ? '环境变量' : '默认值'
    }
  };
}

// 发送 Telegram 通知
async function sendTelegramNotification(config, message) {
  const { CHAT_ID, BOT_TOKEN } = config;
  
  // 检查是否配置了 Telegram
  if (!CHAT_ID || !BOT_TOKEN) {
    console.log('Telegram 通知未配置，跳过发送');
    return false;
  }
  
  try {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text: message,
        parse_mode: 'HTML'
      }),
    });
    
    const result = await response.json();
    
    if (result.ok) {
      console.log('Telegram 通知发送成功');
      return true;
    } else {
      console.error('Telegram 通知发送失败:', result);
      return false;
    }
  } catch (error) {
    console.error('发送 Telegram 通知时出错:', error);
    return false;
  }
}

// 发送离线通知
async function sendOfflineNotification(config, appName, appId) {
  const message = `🔴 <b>Databricks App 离线</b>\n\n` +
                 `📱 App: <code>${appName}</code>\n` +
                 `🆔 ID: <code>${appId}</code>\n` +
                 `⏰ 时间: ${new Date().toLocaleString('zh-CN')}\n\n` +
                 `⚡ 系统正在尝试自动重启...`;
  
  return await sendTelegramNotification(config, message);
}

// 发送启动成功通知
async function sendStartSuccessNotification(config, appName, appId) {
  const message = `✅ <b>Databricks App 启动成功</b>\n\n` +
                 `📱 App: <code>${appName}</code>\n` +
                 `🆔 ID: <code>${appId}</code>\n` +
                 `⏰ 时间: ${new Date().toLocaleString('zh-CN')}\n\n` +
                 `🎉 App 正在启动中,过10分钟后再检查节点`;
  
  return await sendTelegramNotification(config, message);
}

// 发送启动失败通知
async function sendStartFailedNotification(config, appName, appId, error) {
  const message = `❌ <b>Databricks App 启动失败</b>\n\n` +
                 `📱 App: <code>${appName}</code>\n` +
                 `🆔 ID: <code>${appId}</code>\n` +
                 `⏰ 时间: ${new Date().toLocaleString('zh-CN')}\n` +
                 `💥 错误: <code>${error}</code>\n\n` +
                 `🔧 请检查 App 配置或手动访问 域名/start 启动`;
  
  return await sendTelegramNotification(config, message);
}

// 发送手动操作通知
async function sendManualOperationNotification(config, operation, results) {
  const successCount = results.filter(r => r.status === 'started').length;
  const failedCount = results.filter(r => r.status === 'start_failed' || r.status === 'error').length;
  const stoppedCount = results.filter(r => r.computeState === 'STOPPED').length;
  
  const message = `📊 <b>Databricks Apps ${operation}</b>\n\n` +
                 `✅ 成功启动: ${successCount} 个\n` +
                 `❌ 启动失败: ${failedCount} 个\n` +
                 `⏸️ 停止状态: ${stoppedCount} 个\n` +
                 `⏰ 时间: ${new Date().toLocaleString('zh-CN')}`;
  
  return await sendTelegramNotification(config, message);
}

// 获取 Apps 列表
async function getAppsList(config) {
  const { DATABRICKS_HOST, DATABRICKS_TOKEN } = config;
  
  let allApps = [];
  let pageToken = '';
  
  do {
    let url = `${DATABRICKS_HOST}/api/2.0/apps?page_size=50`;
    if (pageToken) {
      url += `&page_token=${encodeURIComponent(pageToken)}`;
    }

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${DATABRICKS_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API 请求失败: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const apps = data.apps || [];
    
    allApps = allApps.concat(apps);
    pageToken = data.next_page_token || '';
  } while (pageToken);

  return allApps;
}

// 获取 Apps 状态
async function getAppsStatus(config) {
  try {
    const apps = await getAppsList(config);
    
    const results = apps.map(app => ({
      name: app.name,
      id: app.id,
      state: app.compute_status?.state || 'UNKNOWN',
      url: app.url,
      createdAt: app.creation_timestamp,
      lastUpdated: app.last_updated_timestamp
    }));
    
    const summary = {
      total: results.length,
      active: results.filter(app => app.state === 'ACTIVE').length,
      stopped: results.filter(app => app.state === 'STOPPED').length,
      unknown: results.filter(app => app.state === 'UNKNOWN').length,
      other: results.filter(app => !['ACTIVE', 'STOPPED', 'UNKNOWN'].includes(app.state)).length
    };
    
    return {
      summary,
      apps: results
    };
  } catch (error) {
    throw error;
  }
}

// 检查并启动 Apps（定时任务使用）
async function checkAndStartApps(config) {
  const apps = await getAppsList(config);
  const results = [];
  
  for (const app of apps) {
    const result = await processApp(app, config);
    results.push(result);
  }
  
  // 注意：定时检查不发送批量通知，只发送单个App的离线/启动通知
  console.log(`定时检查完成，共处理 ${results.length} 个 Apps`);
  
  return results;
}

// 启动停止的 Apps（手动操作使用）
async function startStoppedApps(config) {
  const apps = await getAppsList(config);
  const stoppedApps = apps.filter(app => (app.compute_status?.state || 'UNKNOWN') === 'STOPPED');
  const results = [];
  
  console.log(`找到 ${stoppedApps.length} 个停止的 Apps`);
  
  for (const app of stoppedApps) {
    const result = await startSingleApp(app, config);
    results.push(result);
  }
  
  // 手动操作发送汇总通知
  if (stoppedApps.length > 0) {
    await sendManualOperationNotification(config, '手动启动', results);
  }
  
  return results;
}

// 处理单个 App
async function processApp(app, config) {
  const appName = app.name;
  const appId = app.id;
  const computeState = app.compute_status?.state || 'UNKNOWN';
  
  console.log(`检查 App: ${appName} (ID: ${appId}) | Compute状态: ${computeState}`);

  if (computeState === 'STOPPED') {
    console.log(`⚡ 启动停止的 App: ${appName}`);
    
    // 发送离线通知
    await sendOfflineNotification(config, appName, appId);
    
    return await startSingleApp(app, config);
  } else {
    console.log(`✅ App ${appName} 状态正常: ${computeState}`);
    return { 
      app: appName, 
      appId: appId, 
      status: 'healthy', 
      computeState,
      timestamp: new Date().toISOString()
    };
  }
}

// 启动单个 App
async function startSingleApp(app, config) {
  const { DATABRICKS_HOST, DATABRICKS_TOKEN } = config;
  const appName = app.name;
  const appId = app.id;
  
  try {
    const encodedAppName = encodeURIComponent(appName);
    const startUrl = `${DATABRICKS_HOST}/api/2.0/apps/${encodedAppName}/start`;
    
    console.log(`启动 URL: ${startUrl}`);
    
    const startResponse = await fetch(startUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${DATABRICKS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    const responseText = await startResponse.text();
    console.log(`启动响应: ${responseText}`);

    if (startResponse.ok) {
      console.log(`✅ App ${appName} 启动成功`);
      
      // 发送启动成功通知
      await sendStartSuccessNotification(config, appName, appId);
      
      return { 
        app: appName, 
        appId: appId, 
        status: 'started', 
        success: true,
        timestamp: new Date().toISOString()
      };
    } else {
      console.error(`❌ App ${appName} 启动失败:`, responseText);
      
      let errorDetails;
      try {
        errorDetails = JSON.parse(responseText);
      } catch {
        errorDetails = { message: responseText };
      }
      
      const errorMessage = errorDetails.message || '未知错误';
      
      // 发送启动失败通知
      await sendStartFailedNotification(config, appName, appId, errorMessage);
      
      return { 
        app: appName, 
        appId: appId, 
        status: 'start_failed', 
        error: errorDetails,
        timestamp: new Date().toISOString()
      };
    }
  } catch (error) {
    console.error(`❌ App ${appName} 启动请求错误:`, error);
    
    // 发送启动失败通知
    await sendStartFailedNotification(config, appName, appId, error.message);
    
    return { 
      app: appName, 
      appId: appId, 
      status: 'error', 
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

// 前端 HTML（保持不变）
function getFrontendHTML() {
  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Databricks Apps 监控面板</title>
    <style>
        /* 保持之前的样式不变 */
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: white: 100vh; padding: 20px; }
        .container { max-width: 1200px; margin: 0 auto; background: white; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.2); overflow: hidden; }
        .header { background: linear-gradient(135deg, #2c3e50, #34495e); color: white; padding: 30px; text-align: center; }
        .header h1 { font-size: 2.5em; margin-bottom: 10px; }
        .header p { opacity: 0.9; font-size: 1.1em; }
        .controls { padding: 25px; background: #f8f9fa; border-bottom: 1px solid #e9ecef; display: flex; gap: 15px; flex-wrap: wrap; align-items: center; }
        .btn { padding: 12px 24px; border: none; border-radius: 8px; font-size: 16px; font-weight: 600; cursor: pointer; transition: all 0.3s ease; display: flex; align-items: center; gap: 8px; }
        .btn-primary { background: #007bff; color: white; }
        .btn-primary:hover { background: #0056b3; transform: translateY(-2px); }
        .btn-success { background: #28a745; color: white; }
        .btn-success:hover { background: #1e7e34; transform: translateY(-2px); }
        .btn-info { background: #17a2b8; color: white; }
        .btn-info:hover { background: #138496; transform: translateY(-2px); }
        .btn:disabled { opacity: 0.6; cursor: not-allowed; transform: none !important; }
        .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; padding: 25px; background: white; }
        .stat-card { background: white; padding: 20px; border-radius: 10px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); text-align: center; border-left: 5px solid #007bff; }
        .stat-number { font-size: 2.5em; font-weight: bold; color: #2c3e50; }
        .stat-label { color: #6c757d; font-size: 0.9em; margin-top: 5px; }
        .apps-list { padding: 25px; }
        .apps-table { width: 100%; border-collapse: collapse; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.1); }
        .apps-table th, .apps-table td { padding: 15px; text-align: left; border-bottom: 1px solid #e9ecef; }
        .apps-table th { background: #f8f9fa; font-weight: 600; color: #2c3e50; }
        .apps-table tr:hover { background: #f8f9fa; }
        .state-badge { padding: 4px 12px; border-radius: 20px; font-size: 0.85em; font-weight: 600; }
        .state-active { background: #d4edda; color: #155724; }
        .state-stopped { background: #f8d7da; color: #721c24; }
        .state-unknown { background: #fff3cd; color: #856404; }
        .loading { text-align: center; padding: 40px; color: #6c757d; }
        .error { background: #f8d7da; color: #721c24; padding: 15px; border-radius: 8px; margin: 20px 0; }
        .success { background: #d4edda; color: #155724; padding: 15px; border-radius: 8px; margin: 20px 0; }
        .last-updated { text-align: center; padding: 15px; color: #6c757d; font-size: 0.9em; border-top: 1px solid #e9ecef; }
        .routes-info { background: #f8f9fa; padding: 25px; margin-top: 30px; border-radius: 8px; }
        .routes-info h3 { margin-bottom: 15px; color: #2c3e50; }
        .route-item { background: white; padding: 15px; margin: 10px 0; border-radius: 6px; border-left: 4px solid #007bff; }
        .footer-links { display: flex; justify-content: center; gap: 20px; padding: 20px; background: #2c3e50; margin-top: 30px; }
        .footer-links a { color: white; text-decoration: none; font-weight: 500; transition: color 0.3s ease; display: flex; align-items: center; gap: 8px; }
        .footer-links a:hover { color: #4da8ff; }
        .notification-status { background: #e7f3ff; padding: 15px; border-radius: 8px; margin: 15px 0; border-left: 4px solid #007bff; }
        @media (max-width: 768px) {
            .controls { flex-direction: column; align-items: stretch; }
            .btn { justify-content: center; }
            .apps-table { font-size: 0.9em; }
            .apps-table th, .apps-table td { padding: 10px 8px; }
            .footer-links { flex-direction: column; align-items: center; gap: 15px; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🚀 Databricks Apps 监控面板</h1>
            <p>实时监控和管理你的 Databricks Apps</p>
        </div>
        
        <div class="notification-status" id="notificationStatus">
            <strong>📢 通知状态:</strong> 
            <span id="telegramStatus">检查中...</span>
            <div style="margin-top: 8px; font-size: 0.9em; color: #666;">
                🔔 通知策略: 仅在App离线时和启动成功后发送通知，正常定时检查不发送通知
            </div>
        </div>
        
        <div class="controls">
            <button class="btn btn-primary" onclick="refreshStatus()">🔄 刷新状态</button>
            <button class="btn btn-success" onclick="startStoppedApps()">⚡ 启动停止的 Apps</button>
            <button class="btn btn-info" onclick="checkAndStart()">🔍 检查并自动启动</button>
            <button class="btn" onclick="testNotification()" style="background: #6f42c1; color: white;">🔔 测试通知</button>
            <div style="margin-left: auto; display: flex; align-items: center; gap: 10px;">
                <span id="lastUpdated">-</span>
                <div id="loadingIndicator" style="display: none;">加载中...</div>
            </div>
        </div>
        
        <div id="messageContainer"></div>
        
        <div class="stats" id="statsContainer">
            <div class="loading">加载统计数据...</div>
        </div>
        
        <div class="apps-list">
            <h2 style="margin-bottom: 20px; color: #2c3e50;">Apps 列表</h2>
            <div id="appsContainer">
                <div class="loading">加载 Apps 列表...</div>
            </div>
        </div>
        
        <div class="last-updated">
            最后更新: <span id="updateTime">-</span>
        </div>
        
        <div class="routes-info">
            <h3>📚 API 路由说明</h3>
            <div class="route-item"><strong>GET /</strong> - 显示此管理界面</div>
            <div class="route-item"><strong>GET /status</strong> - 获取当前所有 Apps 的状态</div>
            <div class="route-item"><strong>GET /check</strong> - 检查并自动启动停止的 Apps</div>
            <div class="route-item"><strong>POST /start</strong> - 手动启动所有停止的 Apps</div>
            <div class="route-item"><strong>GET /config</strong> - 查看当前配置信息</div>
            <div class="route-item"><strong>POST /test-notification</strong> - 测试 Telegram 通知</div>
        </div>
        
        <div class="footer-links">
            <a href="https://github.com/eooce/Databricks-depoly-and-keepalive" target="_blank">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                    <path fill-rule="evenodd" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
                </svg>
                GitHub
            </a>
            <a href="https://www.youtube.com/@eooce" target="_blank">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M8.051 1.999h.089c.822.003 4.987.033 6.11.335a2.01 2.01 0 011.415 1.42c.101.38.172.883.22 1.402l.01.104.022.26.008.104c.065.914.073 1.77.074 1.957v.075c-.001.194-.01 1.108-.082 2.06l-.008.105-.009.104c-.05.572-.124 1.14-.235 1.558a2.007 2.007 0 01-1.415 1.42c-1.16.312-5.569.334-6.18.335h-.142c-.309 0-1.587-.006-2.927-.052l-.17-.006-.087-.004-.171-.007-.171-.007c-1.11-.049-2.167-.128-2.654-.26a2.007 2.007 0 01-1.415-1.419c-.111-.417-.185-.986-.235-1.558L.09 9.82l-.008-.104A31.4 31.4 0 010 7.68v-.123c.002-.215.01-.958.064-1.778l.007-.103.003-.052.008-.104.022-.26.01-.104c.048-.519.119-1.023.22-1.402a2.007 2.007 0 011.415-1.42c.487-.13 1.544-.21 2.654-.26l.17-.007.172-.006.086-.003.171-.007A99.788 99.788 0 017.858 2h.193zM6.4 5.209v4.818l4.157-2.408L6.4 5.209z"/>
                </svg>
                YouTube
            </a>
            <a href="https://t.me/eooceu" target="_blank">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M16 8A8 8 0 110 8a8 8 0 0116 0zM8.287 5.906c-.778.324-2.334.994-4.666 2.01-.378.15-.577.298-.595.442-.03.243.275.339.69.47l.175.055c.408.133.958.288 1.243.294.26.006.549-.1.868-.32 2.179-1.471 3.304-2.214 3.374-2.23.05-.012.12-.026.166.016.047.041.042.12.037.141-.03.129-1.227 1.241-1.846 1.817-.193.18-.33.307-.358.336a8.154 8.154 0 01-.188.186c-.38.366-.664.64.015 1.088.327.216.589.393.85.571.284.194.568.387.936.629.093.06.183.125.27.187.331.236.63.448.997.414.214-.02.435-.22.547-.82.265-1.417.786-4.486.906-5.751a1.426 1.426 0 00-.013-.315.337.337 0 00-.114-.217.526.526 0 00-.31-.093c-.3.005-.763.166-2.984 1.09z"/>
                </svg>
                Telegram Group
            </a>
        </div>
    </div>

    <script>
        let currentData = null;
        
        // 页面加载时获取状态
        document.addEventListener('DOMContentLoaded', function() {
            refreshStatus();
            checkTelegramStatus();
        });
        
        // 检查 Telegram 状态
        async function checkTelegramStatus() {
            try {
                const response = await fetch('/config');
                const data = await response.json();
                
                const statusEl = document.getElementById('telegramStatus');
                if (data.DATABRICKS_HOST && data.DATABRICKS_TOKEN) {
                    if (data.CHAT_ID && data.BOT_TOKEN) {
                        statusEl.innerHTML = '<span style="color: #28a745;">✅ Telegram 通知已配置</span>';
                    } else {
                        statusEl.innerHTML = '<span style="color: #ffc107;">⚠️ Telegram 通知未配置</span>';
                    }
                } else {
                    statusEl.innerHTML = '<span style="color: #dc3545;">❌ 基础配置缺失</span>';
                }
            } catch (error) {
                document.getElementById('telegramStatus').innerHTML = '<span style="color: #dc3545;">❌ 检查失败</span>';
            }
        }
        
        // 测试通知
        async function testNotification() {
            setLoading(true);
            try {
                const response = await fetch('/test-notification', { method: 'POST' });
                const data = await response.json();
                
                if (data.success) {
                    showMessage('测试通知发送成功，请检查 Telegram', 'success');
                } else {
                    showMessage('测试通知发送失败: ' + data.error, 'error');
                }
            } catch (error) {
                showMessage('请求失败: ' + error.message, 'error');
            } finally {
                setLoading(false);
            }
        }
        
        // 显示消息
        function showMessage(message, type = 'info') {
            const container = document.getElementById('messageContainer');
            const messageEl = document.createElement('div');
            messageEl.className = type === 'error' ? 'error' : 'success';
            messageEl.textContent = message;
            container.appendChild(messageEl);
            
            // 3秒后自动移除
            setTimeout(() => {
                messageEl.remove();
            }, 5000);
        }
        
        // 显示加载状态
        function setLoading(loading) {
            const indicator = document.getElementById('loadingIndicator');
            const buttons = document.querySelectorAll('.btn');
            
            if (loading) {
                indicator.style.display = 'block';
                buttons.forEach(btn => btn.disabled = true);
            } else {
                indicator.style.display = 'none';
                buttons.forEach(btn => btn.disabled = false);
            }
        }
        
        // 刷新状态
        async function refreshStatus() {
            setLoading(true);
            try {
                const response = await fetch('/status');
                const data = await response.json();
                
                if (data.success) {
                    currentData = data;
                    updateStats(data.results);
                    updateAppsList(data.results);
                    updateLastUpdated();
                    showMessage('状态刷新成功', 'success');
                } else {
                    showMessage('刷新失败: ' + data.error, 'error');
                }
            } catch (error) {
                showMessage('请求失败: ' + error.message, 'error');
            } finally {
                setLoading(false);
            }
        }
        
        // 启动停止的 Apps
        async function startStoppedApps() {
            if (!confirm('确定要启动所有停止的 Apps 吗？')) return;
            
            setLoading(true);
            try {
                const response = await fetch('/start', { method: 'POST' });
                const data = await response.json();
                
                if (data.success) {
                    showMessage('启动操作完成', 'success');
                    // 刷新状态显示最新结果
                    setTimeout(refreshStatus, 2000);
                } else {
                    showMessage('启动失败: ' + data.error, 'error');
                }
            } catch (error) {
                showMessage('请求失败: ' + error.message, 'error');
            } finally {
                setLoading(false);
            }
        }
        
        // 检查并自动启动
        async function checkAndStart() {
            setLoading(true);
            try {
                const response = await fetch('/check');
                const data = await response.json();
                
                if (data.success) {
                    showMessage('检查完成', 'success');
                    // 刷新状态显示最新结果
                    setTimeout(refreshStatus, 2000);
                } else {
                    showMessage('检查失败: ' + data.error, 'error');
                }
            } catch (error) {
                showMessage('请求失败: ' + error.message, 'error');
            } finally {
                setLoading(false);
            }
        }
        
        // 更新统计信息
        function updateStats(data) {
            const container = document.getElementById('statsContainer');
            const { summary } = data;
            
            container.innerHTML = \`
                <div class="stat-card">
                    <div class="stat-number">\${summary.total}</div>
                    <div class="stat-label">总 Apps 数量</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number" style="color: #28a745;">\${summary.active}</div>
                    <div class="stat-label">运行中</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number" style="color: #dc3545;">\${summary.stopped}</div>
                    <div class="stat-label">已停止</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number" style="color: #ffc107;">\${summary.unknown}</div>
                    <div class="stat-label">状态未知</div>
                </div>
            \`;
        }
        
        // 更新 Apps 列表
        function updateAppsList(data) {
            const container = document.getElementById('appsContainer');
            const { apps } = data;
            
            if (apps.length === 0) {
                container.innerHTML = '<div class="loading">没有找到任何 Apps</div>';
                return;
            }
            
            let html = \`
                <table class="apps-table">
                    <thead>
                        <tr>
                            <th>App 名称</th>
                            <th>状态</th>
                            <th>App ID</th>
                            <th>创建时间</th>
                        </tr>
                    </thead>
                    <tbody>
            \`;
            
            apps.forEach(app => {
                const stateClass = \`state-\${app.state.toLowerCase()}\`;
                const createDate = app.createdAt ? new Date(app.createdAt).toLocaleString() : '未知';
                
                html += \`
                    <tr>
                        <td><strong>\${app.name}</strong></td>
                        <td>
                            <span class="state-badge \${stateClass}">
                                \${app.state}
                            </span>
                        </td>
                        <td><code>\${app.id}</code></td>
                        <td>\${createDate}</td>
                    </tr>
                \`;
            });
            
            html += '</tbody></table>';
            container.innerHTML = html;
        }
        
        // 更新最后更新时间
        function updateLastUpdated() {
            const now = new Date();
            document.getElementById('updateTime').textContent = now.toLocaleString();
            document.getElementById('lastUpdated').textContent = '最后更新: ' + now.toLocaleTimeString();
        }
        
        // 每60分钟自动刷新一次
        setInterval(refreshStatus, 60 * 60 * 1000);
    </script>
</body>
</html>
  `;
}

// 测试通知函数
async function testNotification(config) {
  const message = `🔔 <b>Databricks Apps 监控测试通知</b>\n\n` +
                 `✅ 这是一条测试消息\n` +
                 `⏰ 时间: ${new Date().toLocaleString('zh-CN')}\n\n` +
                 `🎉 如果你的 Telegram 配置正确，你应该能收到这条消息`;
  
  return await sendTelegramNotification(config, message);
}

// 主 Worker 处理器
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    
    // 前端页面
    if (path === '/' || path === '/index.html') {
      return new Response(getFrontendHTML(), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }
    
    // API 端点
    if (path === '/check') {
      try {
        const config = getConfig(env);
        const result = await checkAndStartApps(config);
        return new Response(JSON.stringify({
          success: true,
          message: '检查完成',
          timestamp: new Date().toISOString(),
          results: result
        }), {
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (error) {
        return new Response(JSON.stringify({
          success: false,
          error: error.message
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }
    
    if (path === '/start') {
      try {
        const config = getConfig(env);
        const result = await startStoppedApps(config);
        return new Response(JSON.stringify({
          success: true,
          message: '启动操作完成',
          timestamp: new Date().toISOString(),
          results: result
        }), {
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (error) {
        return new Response(JSON.stringify({
          success: false,
          error: error.message
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }
    
    if (path === '/status') {
      try {
        const config = getConfig(env);
        const result = await getAppsStatus(config);
        return new Response(JSON.stringify({
          success: true,
          message: '状态获取完成',
          timestamp: new Date().toISOString(),
          results: result
        }), {
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (error) {
        return new Response(JSON.stringify({
          success: false,
          error: error.message
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }
    
    if (path === '/config') {
      const config = getConfig(env);
      const maskedToken = config.DATABRICKS_TOKEN ? 
        config.DATABRICKS_TOKEN.substring(0, 10) + '...' : '未设置';
      const maskedBotToken = config.BOT_TOKEN ? 
        config.BOT_TOKEN.substring(0, 10) + '...' : '未设置';
      
      return new Response(JSON.stringify({
        DATABRICKS_HOST: config.DATABRICKS_HOST,
        DATABRICKS_TOKEN: maskedToken,
        CHAT_ID: config.CHAT_ID || '未设置',
        BOT_TOKEN: maskedBotToken,
        source: config.source
      }, null, 2), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    if (path === '/test-notification') {
      try {
        const config = getConfig(env);
        const success = await testNotification(config);
        
        if (success) {
          return new Response(JSON.stringify({
            success: true,
            message: '测试通知发送成功'
          }), {
            headers: { 'Content-Type': 'application/json' }
          });
        } else {
          return new Response(JSON.stringify({
            success: false,
            error: '测试通知发送失败，请检查 Telegram 配置'
          }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      } catch (error) {
        return new Response(JSON.stringify({
          success: false,
          error: error.message
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }
    
    // 未知路由
    return new Response(JSON.stringify({
      error: '路由不存在',
      available_routes: [
        { path: '/', method: 'GET', description: '前端管理界面' },
        { path: '/status', method: 'GET', description: '获取当前 Apps 状态' },
        { path: '/check', method: 'GET', description: '检查并自动启动停止的 Apps' },
        { path: '/start', method: 'POST', description: '手动启动所有停止的 Apps' },
        { path: '/config', method: 'GET', description: '查看当前配置信息' },
        { path: '/test-notification', method: 'POST', description: '测试 Telegram 通知' }
      ]
    }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  },
  
  // 定时任务处理器
  async scheduled(event, env, ctx) {
    console.log('开始定时检查 Databricks Apps 状态...');
    
    try {
      const config = getConfig(env);
      await checkAndStartApps(config);
      console.log('定时检查完成');
    } catch (error) {
      console.error('定时检查过程中出错:', error);
    }
  }
};
