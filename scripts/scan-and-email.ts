/**
 * 股票信号扫描 + 邮件推送工具
 * 
 * 配置环境变量 (在 .env 文件中):
 * EMAIL_HOST=smtp.qq.com          # SMTP服务器
 * EMAIL_PORT=465                  # 端口
 * EMAIL_USER=your_email@qq.com    # 发件邮箱
 * EMAIL_PASS=your_auth_code       # 邮箱授权码（不是密码）
 * EMAIL_TO=receive@example.com    # 收件邮箱
 * 
 * 使用:
 * npx tsx scripts/scan-and-email.ts <股票列表.csv>
 */

import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';
import nodemailer from 'nodemailer';

// 加载环境变量
try {
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    envContent.split('\n').forEach(line => {
      const match = line.match(/^([^=]+)=(.*)$/);
      if (match) {
        process.env[match[1].trim()] = match[2].trim();
      }
    });
  }
} catch (e) {}

// ============ 邮件配置 ============

interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  auth: {
    user: string;
    pass: string;
  };
}

function getEmailConfig(): EmailConfig | null {
  const host = process.env.EMAIL_HOST;
  const port = process.env.EMAIL_PORT;
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;
  
  if (!host || !user || !pass) {
    console.log('⚠️  邮件配置不完整，请在 .env 文件中设置:');
    console.log('  EMAIL_HOST=smtp.qq.com');
    console.log('  EMAIL_PORT=465');
    console.log('  EMAIL_USER=your_email@qq.com');
    console.log('  EMAIL_PASS=your_auth_code');
    console.log('  EMAIL_TO=receive@example.com');
    return null;
  }
  
  return {
    host,
    port: parseInt(port || '465'),
    secure: true,
    auth: { user, pass }
  };
}

async function sendEmail(
  subject: string,
  htmlContent: string,
  attachments: { filename: string; path: string }[] = []
): Promise<boolean> {
  const config = getEmailConfig();
  if (!config) return false;
  
  const to = process.env.EMAIL_TO || config.auth.user;
  
  try {
    const transporter = nodemailer.createTransport(config);
    
    await transporter.sendMail({
      from: `"股票信号扫描" <${config.auth.user}>`,
      to,
      subject,
      html: htmlContent,
      attachments
    });
    
    console.log(`✅ 邮件已发送至: ${to}`);
    return true;
  } catch (error: any) {
    console.error('❌ 邮件发送失败:', error.message);
    return false;
  }
}

// ============ CSV 解析工具 ============

function parseCSV(content: string): string[][] {
  const lines = content.trim().split('\n');
  return lines.map(line => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    
    for (const char of line) {
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  });
}

function extractStockCode(rawCode: string): string | null {
  const clean = rawCode.trim().toUpperCase();
  const sanitized = clean.replace(/^\uFEFF/, '');
  const matchA = sanitized.match(/^(SH|SZ)(\d{6})$/);
  if (matchA) return matchA[2];
  if (/^\d{5}$/.test(sanitized)) return sanitized;
  if (/^\d{6}$/.test(sanitized)) return sanitized;
  return null;
}

// ============ 股票扫描（简化版，只获取最后一天的信号） ============

interface ScanResult {
  code: string;
  name: string;
  date: string;
  close: number;
  signals: string[];
  bias225Pct: number | null;
  error?: string;
}

function formatSymbol(symbol: string): string {
  const clean = symbol.replace(/[^0-9a-zA-Z]/g, '');
  if (clean.length === 5) return `hk${clean}`;
  if (clean.startsWith('6') || clean.startsWith('5')) return `sh${clean}`;
  return `sz${clean}`;
}

async function getQuote(symbol: string): Promise<{ name: string }> {
  const tencentSymbol = formatSymbol(symbol);
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${tencentSymbol},day,,,1,qfq`;
  
  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'Referer': 'https://stock.qq.com',
    },
  });
  
  if (!response.ok) throw new Error('API请求失败');
  const result = await response.json();
  if (result.code !== 0 || !result.data || !result.data[tencentSymbol]) {
    throw new Error('无数据');
  }
  
  const qt = result.data[tencentSymbol].qt?.[tencentSymbol];
  return { name: qt?.[1] || symbol };
}

async function getLatestData(symbol: string): Promise<any> {
  const tencentSymbol = formatSymbol(symbol);
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${tencentSymbol},day,,,300,qfq`;
  
  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'Referer': 'https://stock.qq.com',
    },
  });
  
  if (!response.ok) throw new Error('API请求失败');
  const result = await response.json();
  if (result.code !== 0 || !result.data || !result.data[tencentSymbol]) {
    throw new Error('无数据');
  }
  
  const klines = result.data[tencentSymbol].qfqday || result.data[tencentSymbol].day || [];
  if (klines.length < 250) throw new Error('数据不足');
  
  return klines;
}

// 简化版信号检测（仅基于最新价格相对225日均线）
function detectSimpleSignals(klines: any[]): string[] {
  const closes = klines.map((k: any) => parseFloat(k[2]));
  const n = closes.length;
  
  // 计算225日均线
  const ma225 = closes.slice(-225).reduce((a, b) => a + b, 0) / 225;
  const currentPrice = closes[n - 1];
  const bias = ((currentPrice - ma225) / ma225) * 100;
  
  const signals: string[] = [];
  
  // BIAS > 50% 认为偏高
  if (bias > 50) {
    signals.push('S(高估)');
  }
  // BIAS < -30% 认为偏低
  if (bias < -30) {
    signals.push('B(低估)');
  }
  // BIAS > 80% 极度高估
  if (bias > 80) {
    signals.push('S(极度贪婪)');
  }
  
  return signals;
}

async function scanStock(code: string): Promise<ScanResult> {
  try {
    const [klines, quote] = await Promise.all([
      getLatestData(code),
      getQuote(code)
    ]);
    
    const latest = klines[klines.length - 1];
    const signals = detectSimpleSignals(klines);
    
    // 计算BIAS
    const closes = klines.map((k: any) => parseFloat(k[2]));
    const ma225 = closes.slice(-225).reduce((a, b) => a + b, 0) / 225;
    const bias = ((closes[closes.length - 1] - ma225) / ma225) * 100;
    
    return {
      code,
      name: quote.name,
      date: latest[0],
      close: parseFloat(latest[2]),
      signals,
      bias225Pct: Math.round(bias * 100) / 100
    };
  } catch (error: any) {
    return {
      code,
      name: '',
      date: '',
      close: 0,
      signals: [],
      bias225Pct: null,
      error: error.message
    };
  }
}

// ============ 主程序 ============

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 1) {
    console.log('使用方法: npx tsx scripts/scan-and-email.ts <股票列表.csv>');
    process.exit(1);
  }
  
  const inputPath = args[0];
  const outputPath = `signals_${new Date().toISOString().split('T')[0]}.xlsx`;
  
  if (!fs.existsSync(inputPath)) {
    console.error(`错误: 找不到文件 ${inputPath}`);
    process.exit(1);
  }
  
  console.log('📊 开始扫描股票信号...\n');
  
  // 读取CSV
  const content = fs.readFileSync(inputPath, 'utf-8');
  const rows = parseCSV(content);
  
  const codes: string[] = [];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i] && rows[i][2]) {
      const code = extractStockCode(String(rows[i][2]));
      if (code) codes.push(code);
    }
  }
  
  console.log(`找到 ${codes.length} 个股票代码\n`);
  
  // 扫描
  const results: ScanResult[] = [];
  for (let i = 0; i < codes.length; i++) {
    console.log(`[${i + 1}/${codes.length}] ${codes[i]}...`);
    const result = await scanStock(codes[i]);
    results.push(result);
    if (i < codes.length - 1) await new Promise(r => setTimeout(r, 300));
  }
  
  // 生成Excel
  const withSignals = results.filter(r => r.signals.length > 0);
  const highRisk = results.filter(r => r.signals.some(s => s.includes('极度')));
  
  const outputData = results.map(r => ({
    '股票代码': r.code,
    '股票名称': r.name,
    '日期': r.date,
    '收盘价': r.close,
    '信号': r.signals.join(', ') || '无',
    'BIAS225%': r.bias225Pct,
    '错误': r.error || ''
  }));
  
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(outputData);
  XLSX.utils.book_append_sheet(wb, ws, 'Signals');
  XLSX.writeFile(wb, outputPath);
  
  console.log(`\n✅ 结果已保存: ${outputPath}`);
  
  // 生成邮件内容
  const date = new Date().toLocaleDateString('zh-CN');
  const subject = `📊 股票信号扫描报告 - ${date} (${withSignals.length}只信号)`;
  
  let html = `
    <h2>📊 股票信号扫描报告 - ${date}</h2>
    <p><b>总股票数:</b> ${results.length} | <b>有信号:</b> ${withSignals.length} | <b>高风险:</b> ${highRisk.length}</p>
    <hr>
  `;
  
  if (withSignals.length > 0) {
    html += '<h3>⚠️ 关注以下股票：</h3><table border="1" cellpadding="8" style="border-collapse:collapse;">';
    html += '<tr style="background:#f0f0f0;"><th>代码</th><th>名称</th><th>收盘价</th><th>信号</th><th>BIAS</th></tr>';
    
    for (const r of withSignals) {
      const signalColor = r.signals.some(s => s.includes('极度')) ? '#ff4444' : 
                         r.signals.some(s => s.includes('S')) ? '#ff8800' : '#00aa00';
      html += `<tr>
        <td>${r.code}</td>
        <td>${r.name}</td>
        <td>¥${r.close}</td>
        <td style="color:${signalColor};font-weight:bold;">${r.signals.join(', ')}</td>
        <td>${r.bias225Pct?.toFixed(2)}%</td>
      </tr>`;
    }
    html += '</table>';
  } else {
    html += '<p>✅ 今日无特殊信号股票</p>';
  }
  
  html += '<hr><p style="color:#888;font-size:12px;">由 Peter趋势交易系统 自动生成</p>';
  
  // 发送邮件
  console.log('\n📧 正在发送邮件...');
  const sent = await sendEmail(subject, html, [
    { filename: outputPath, path: path.resolve(process.cwd(), outputPath) }
  ]);
  
  if (!sent) {
    console.log('\n⚠️  邮件未发送，请检查邮箱配置');
    console.log('请在 .env 文件中添加:');
    console.log('  EMAIL_HOST=smtp.qq.com');
    console.log('  EMAIL_PORT=465');
    console.log('  EMAIL_USER=你的邮箱@qq.com');
    console.log('  EMAIL_PASS=邮箱授权码');
    console.log('  EMAIL_TO=收件邮箱');
  }
}

main().catch(console.error);
