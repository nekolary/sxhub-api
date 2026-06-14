/**
 * 实习加油站 - 本地服务端（文件持久化）
 * 
 * 使用 JSON 文件存储替代 CloudBase 文档数据库
 * 数据存储在 db.json 文件中，浏览器清缓存不影响
 * 零额外依赖，仅需 express
 */
import express from 'express';
import fs from 'fs';

// ─── 防止未处理异常崩溃进程 ───
process.on('unhandledRejection', (err) => {
  console.warn('[Server] 未捕获的 Promise 拒绝（已忽略，不崩溃）:', err?.message || err);
});
process.on('uncaughtException', (err) => {
  console.warn('[Server] 未捕获的异常（已忽略，不崩溃）:', err?.message || err);
});

const DATA_FILE = './db.json';
const COLLECTIONS_FILE = './collections.json';

// ─── 文件持久化工具函数 ───
function readJSON(filepath, defaultVal) {
  try {
    if (fs.existsSync(filepath)) {
      return JSON.parse(fs.readFileSync(filepath, 'utf-8'));
    }
  } catch (e) {
    console.warn('[DB] 读文件失败:', filepath, e.message);
  }
  return defaultVal;
}

function writeJSON(filepath, data) {
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf-8');
}

const PORT = process.env.PORT || 3001;
const app = express();
app.use(express.json({ limit: '10mb' }));

// ─── CORS：允许本地前端跨域访问 ───
app.use((req, res, next) => {
  const origin = req.headers.origin;
  // 本地开发 + 同源请求放行
  if (!origin || origin === 'null' || origin.includes('localhost') || origin.includes('127.0.0.1')) {
    res.header('Access-Control-Allow-Origin', origin || '*');
  } else {
    // 生产环境：允许同源（origin 匹配 host）
    const host = req.headers.host || '';
    try {
      const originHost = new URL(origin).host;
      if (originHost === host) {
        res.header('Access-Control-Allow-Origin', origin);
      }
    } catch (e) { /* ignore */ }
  }
  res.header('Access-Control-Allow-Headers', 'Content-Type, X-Provider');
  res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// 静态文件服务
app.use(express.static('.'));

// ─── 数据库辅助函数（基于 JSON 文件存储） ───

// 应用主数据（用户、批次、邀请码等）
function getAppData() {
  try {
    return readJSON(DATA_FILE, null);
  } catch (e) {
    console.warn('[DB] getAppData 失败:', e.message);
  }
  return { users: [], batches: [], codePool: [], relations: [],
           applications: [], visitors: [], tasks: [], announcements: [],
           missions: [], crossMentorAutoApprove: {},
           autoApprove: true };
}

function saveAppData(data) {
  try {
    const { _id, _openid, ...clean } = data;
    writeJSON(DATA_FILE, clean);
  } catch (e) {
    console.error('[DB] saveAppData 失败:', e.message);
    throw e;
  }
}

// 集合数据 CRUD（reports / questions / reflections / evaluations）
function getCollection(collectionName, filter = {}) {
  try {
    const all = readJSON(COLLECTIONS_FILE, []);
    let rows = all.filter(item => item._collection === collectionName);
    // 返回时添加兼容字段
    return rows.map(r => {
      r._id = r._id || String(r.id || Date.now());
      r.docId = r.docId || r._id;
      return r;
    });
  } catch (e) {
    console.warn('[DB] getCollection 失败:', e.message);
    return [];
  }
}

function addToCollection(collectionName, doc) {
  const all = readJSON(COLLECTIONS_FILE, []);
  const newDoc = {
    ...doc,
    _collection: collectionName,
    _id: String(Date.now()) + String(Math.random()).slice(2, 8),
    id: Date.now(),
    createdAt: doc.createdAt || new Date().toISOString()
  };
  all.push(newDoc);
  writeJSON(COLLECTIONS_FILE, all);
  return newDoc;
}

function updateInCollection(collectionName, docId, updates) {
  const all = readJSON(COLLECTIONS_FILE, []);
  const idx = all.findIndex(item =>
    item._collection === collectionName && (item._id === docId || item.docId === docId || String(item.id) === docId)
  );
  if (idx === -1) return;
  all[idx] = { ...all[idx], ...updates };
  writeJSON(COLLECTIONS_FILE, all);
}

// ─── Mock 模式（零成本，始终可用） ───
function mockLLMResponse(systemPrompt, userPrompt) {
  if (systemPrompt.includes('匹配') || systemPrompt.includes('match')) {
    return generateMockMatch(userPrompt);
  }
  if (systemPrompt.includes('周报') || systemPrompt.includes('weekly')) {
    return generateMockWeeklyReport(userPrompt);
  }
  if (systemPrompt.includes('问答') || systemPrompt.includes('question') || systemPrompt.includes('问题')) {
    return generateMockAnswer(userPrompt);
  }
  if (systemPrompt.includes('成长') || systemPrompt.includes('回望') || systemPrompt.includes('reflection')) {
    return generateMockReflection(userPrompt);
  }
  if (systemPrompt.includes('hr_eval_weekly')) {
    return generateMockWeeklyEvalForHR(userPrompt);
  }
  if (systemPrompt.includes('hr_eval_overall')) {
    return generateMockOverallEvalForHR(userPrompt);
  }
  return `[模拟回答] 收到你的问题：「${userPrompt.slice(0, 50)}...」\n\n根据当前上下文，建议你从以下几个方面入手：\n\n1. **明确目标**：先梳理清楚你想要达成的具体目标\n2. **拆解步骤**：将大目标分解为可执行的小步骤\n3. **寻求反馈**：定期与导师对齐进度，获取及时反馈\n4. **记录成长**：保持记录，每周回顾自己的进步\n\n> 💡 配置 AI API Key 后，即可获得 AI 实时生成的优质回答。`;
}

function generateMockMatch(userPrompt) {
  // 从 userPrompt 中提取学生和导师数据
  var students = [];
  var mentors = [];
  var stuMatch = userPrompt.match(/## 学生列表\n([\s\S]*?)(?=\n##|$)/);
  var mtrMatch = userPrompt.match(/## 导师列表\n([\s\S]*?)(?=\n##|$)/);
  
  if (stuMatch) {
    stuMatch[1].split('\n').forEach(function(line) {
      var m = line.match(/- (\S+)（(.+?)）专业:(.+?)\s+学校:(.+?)\s+意向岗位:(.+)/);
      if (m) students.push({ studentId: m[1], realname: m[2], major: m[3], school: m[4], dept: m[5] });
    });
  }
  if (mtrMatch) {
    mtrMatch[1].split('\n').forEach(function(line) {
      var m = line.match(/- (\S+)（(.+?)）岗位:(.+?)\s+当前带教:(\d+)\/(\d+)/);
      if (m) mentors.push({ mentorId: m[1], realname: m[2], dept: m[3], currentLoad: parseInt(m[4]), maxStudents: parseInt(m[5]) });
    });
  }
  return JSON.stringify(smartLocalMatch(students, mentors));
}

function generateMockWeeklyReport(userPrompt) {
  const nameMatch = userPrompt.match(/实习生[：:]\s*(\S+)/);
  const weekMatch = userPrompt.match(/第\s*(\d+)\s*周/);
  const internName = nameMatch ? nameMatch[1] : '同学';
  const week = weekMatch ? weekMatch[1] : '本';
  return `## ${internName} · 第${week}周实习周报\n\n### 📋 本周完成\n1. 完成了项目需求文档的初步阅读和理解\n2. 参与了每日站会，跟进项目进展\n3. 在导师指导下完成了第一个功能模块的代码编写\n4. 学习了团队使用的技术栈和开发流程\n5. 撰写了个人学习笔记，整理了常见问题\n\n### 📈 能力雷达\n- **代码规范**：★★★☆☆\n- **需求理解**：★★★★☆\n- **沟通协作**：★★★☆☆\n- **技术栈掌握**：★★☆☆☆\n\n### 💪 亮点表现\n- 学习态度积极主动，遇到问题能先自行查阅资料\n- 代码质量逐步提升，review 反馈的问题越来越少\n- 与团队沟通顺畅，能清晰表达自己的想法\n\n### 🔧 待改进\n- 对业务领域的理解还需要加深\n- 复杂场景下的问题分析和拆解能力有待提升\n- 建议多阅读项目历史代码，了解架构设计思路\n\n### 🎯 下周计划\n1. 完成当前功能模块的单元测试\n2. 参与需求评审，尝试独立评估技术方案\n3. 阅读团队技术文档，加深对系统架构的理解\n\n---\n\n*本报告由 AI 辅助生成 · 导师复核后可确认*`;
}

function generateMockAnswer(userPrompt) {
  return `🤖 AI 初步应答\n\n关于你的问题，建议从以下几个方面入手：\n\n1. **先自查**：翻阅团队文档、历史代码、常见问题 FAQ\n2. **明确问题**：把问题拆解成具体的小问题，描述清楚上下文\n3. **尝试解决**：先按自己的理解尝试解决，记录过程\n\n如果以上步骤后问题仍然存在，可以把具体场景告诉我，我来帮你分析。\n\n---\n\n🤔 这个回答解决了你的问题吗？\n• ✅ 解决了，不需要导师介入\n• ❌ 还需要导师进一步解答`;
}

function generateMockReflection(userPrompt) {
  const nameMatch = userPrompt.match(/实习生[：:]\s*(\S+)/);
  const internName = nameMatch ? nameMatch[1] : '同学';
  const futureDate = new Date();
  futureDate.setFullYear(futureDate.getFullYear() + 5);
  return `## 🌟 写给 ${internName} 的成长回望\n\n### 📅 实习第 45 天 · 纪念时刻\n\n还记得你第一天走进办公室的样子吗？带着一点点紧张和很多的期待，小心翼翼地熟悉每一条代码规范。那时的你还不知道 git rebase 和 git merge 有什么区别，现在你已经能独立完成 feature 开发了。\n\n### 📊 这 45 天的成长轨迹\n\n**第 1 周** — 熟悉环境，搭建开发环境就花了两天\n**第 2 周** — 完成了第一个小需求，虽然代码被 review 改了三遍\n**第 3 周** — 开始主动在站会上分享进展\n**第 4 周** — 导师说"代码质量有明显提升"\n**第 5 周** — 独立承担一个小模块的开发\n**第 6 周** — 今天，你已经是一个能独当一面的团队成员了\n\n### 💬 导师说过的那些话\n\n> "这个问题你先自己排查一下，不行再来找我。"—— 第 2 周\n> "这次的代码写得不错，基本不用改。"—— 第 5 周\n> "下周有个新需求，你来做吧。"—— 第 6 周\n\n### 🔮 五年后的你\n\n${futureDate.getFullYear()} 年，${internName}：\n\n你好呀。我是 2026 年正在实习的你。不知道你现在在做什么工作？是不是还在写代码？还是已经成了带新人的那个？\n\n如果让我猜的话——你一定还记得这段实习的日子。不是因为技术学了多少，而是因为在这里，你第一次感受到了"把一件事做好"的快乐。代码跑通的那一刻、需求上线的那一刻、被肯定的时候——这些瞬间组成了你职业生涯最珍贵的底色。\n\n继续加油，未来的你一定会感谢现在努力的自己。\n\n---\n\n*这份成长回望由 AI 根据实习期间的记录自动生成。每一份努力都值得被看见。*`;
}

function generateMockWeeklyEvalForHR(userPrompt) {
  const data = userPrompt;
  const nameMatch = data.match(/实习生[：:]\s*(\S+)/);
  const internName = nameMatch ? nameMatch[1] : '同学';
  const scoreMatch = data.match(/评分[：:]\s*(\d+)/);
  const score = scoreMatch ? parseInt(scoreMatch[1]) : Math.floor(Math.random() * 40) + 50;
  const submitMatch = data.match(/提交状态[：:]\s*(\S+)/);
  const submitStatus = submitMatch ? submitMatch[1] : '正常';
  const moodMatch = data.match(/情绪[：:]\s*(.+)/);
  const mood = moodMatch ? moodMatch[1] : '无明显消极信号';

  let evalText = `${internName}本周表现评估：\n\n`;
  if (score >= 85) evalText += `本周整体表现不错，导师评分${score}分。`;
  else if (score >= 70) evalText += `本周基本完成任务，导师评分${score}分，有提升空间。`;
  else evalText += `本周表现欠佳，导师评分${score}分，需要警惕。`;

  if (submitStatus === '逾期') evalText += '周报逾期提交，时间管理需要改善。';
  else if (submitStatus === 'DDL当天') evalText += '周报踩着截止日提交，建议提前完成。';

  if (mood.includes('消极') || mood.includes('累') || mood.includes('焦虑') || mood.includes('困惑')) {
    evalText += `情绪方面检测到潜在消极信号（${mood}），建议主动沟通了解情况。`;
  } else evalText += '情绪状态无明显异常。';

  evalText += '\n\n[模拟评估] 配置AI API Key后可获得更精准的分析。';
  return evalText;
}

function generateMockOverallEvalForHR(userPrompt) {
  const nameMatch = userPrompt.match(/实习生[：:]\s*(\S+)/);
  const internName = nameMatch ? nameMatch[1] : '同学';
  const weeks = (userPrompt.match(/共\s*(\d+)\s*周/) || [])[1] || '?';
  const avgScore = (userPrompt.match(/均分\s*(\d+)/) || [])[1] || '?';
  const submitRate = (userPrompt.match(/提交率\s*(\d+)%/) || [])[1] || '?';

  let evalText = `${internName}实习至今（共${weeks}周）表现总评：\n\n`;
  evalText += `周报提交率${submitRate}%，评分均分${avgScore}。`;
  evalText += '\n\n[模拟评估] 配置AI API Key后可获得更精准的全面分析。';
  return evalText;
}

// ─── AI 配置（预配模型 + 用户切换） ───
const AI_CONFIG_FILE = './ai-config.json';
function loadAIConfig() {
  try {
    if (fs.existsSync(AI_CONFIG_FILE)) {
      const raw = JSON.parse(fs.readFileSync(AI_CONFIG_FILE, 'utf-8'));
      // 兼容旧格式：如果只有 provider + apiKey 则迁移
      if (raw.provider && !raw.presets) {
        const migrated = {
          presets: {
            deepseek: { apiKey: raw.provider === 'deepseek' ? (raw.apiKey || '') : '' },
            gemini: { apiKey: raw.provider === 'gemini' ? (raw.apiKey || '') : '' },
            cloudbase: { apiKey: raw.provider === 'cloudbase' ? (raw.apiKey || '') : '' },
          },
          currentProvider: raw.provider === 'deepseek-v4' ? 'deepseek' : raw.provider
        };
        saveAIConfigToDisk(migrated);
        return migrated;
      }
      return raw;
    }
  } catch (e) { /* ignore */ }
  return { presets: { deepseek: { apiKey: '' }, gemini: { apiKey: '' }, cloudbase: { apiKey: '' } }, currentProvider: 'mock' };
}

// 环境变量覆盖：.env 中的 Key 优先（生产环境）
(function injectEnvKeys() {
  if (process.env.LLM_API_KEY) {
    aiConfig.presets.deepseek.apiKey = aiConfig.presets.deepseek.apiKey || process.env.LLM_API_KEY;
  }
  if (process.env.GEMINI_API_KEY) {
    aiConfig.presets.gemini.apiKey = aiConfig.presets.gemini.apiKey || process.env.GEMINI_API_KEY;
  }
  if (process.env.LLM_PROVIDER && aiConfig.currentProvider === 'mock') {
    aiConfig.currentProvider = process.env.LLM_PROVIDER;
  }
})();
function saveAIConfigToDisk(config) {
  try { fs.writeFileSync(AI_CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8'); } catch (e) { /* ignore */ }
}
const aiConfig = loadAIConfig();

// ─── AI LLM 调用 ───
async function callLLM(systemPrompt, userPrompt, provider) {
  const activeProvider = provider || aiConfig.currentProvider || 'mock';
  const presets = aiConfig.presets || {};
  const preset = presets[activeProvider] || {};

  if (activeProvider === 'gemini') {
    return callGemini(systemPrompt, userPrompt, preset.apiKey || '');
  }
  if (activeProvider === 'deepseek') {
    return callDeepSeek(systemPrompt, userPrompt, preset.apiKey || '');
  }


  return mockLLMResponse(systemPrompt, userPrompt);
}

async function callGemini(systemPrompt, userPrompt, apiKey) {
  if (!apiKey) throw new Error('Gemini API Key 未配置，请在 AI 配置中心填写 Key');
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 2048 },
      })
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Gemini API 返回错误 (${res.status}): ${errText.slice(0, 200)}`);
    }
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) throw new Error('Gemini API 返回内容为空');
    return text;
  } catch (err) {
    console.warn('[Gemini] Error:', err.message);
    throw err;
  }
}

async function callDeepSeek(systemPrompt, userPrompt, apiKey) {
  if (!apiKey) throw new Error('DeepSeek API Key 未配置，请在 AI 配置中心填写 Key');
  try {
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.7,
        max_tokens: 2048,
      })
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`DeepSeek API 返回错误 (${res.status}): ${errText.slice(0, 200)}`);
    }
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('DeepSeek API 返回内容为空');
    return text;
  } catch (err) {
    console.warn('[DeepSeek] Error:', err.message);
    throw err;
  }
}
// ════════════════════════════════════════
// REST API 路由
// ════════════════════════════════════════

// ─── 健康检查 ───
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    mode: aiConfig.currentProvider || 'mock',
    modified: Date.now(),
    dbConnected: true,
  });
});

// ─── 应用数据 API ───

// 获取完整数据
app.get('/api/db', (req, res) => {
  try {
    const data = getAppData();
    res.json({ success: true, db: data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 保存完整数据（直接覆盖，不合并）
app.post('/api/db/save', (req, res) => {
  try {
    const { db } = req.body;
    if (!db) return res.status(400).json({ success: false, error: '缺少 db 数据' });
    saveAppData(db);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── 数据恢复：直接覆写 collections.json ───
app.post('/api/collections/restore', (req, res) => {
  try {
    const { data } = req.body;
    if (!Array.isArray(data)) return res.status(400).json({ success: false, error: '需要 data 数组' });
    writeJSON(COLLECTIONS_FILE, data);
    res.json({ success: true, count: data.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
// ─── 数据恢复：直接覆写 collections.json ───
app.post('/api/collections/restore', (req, res) => {
  try {
    const { data } = req.body;
    if (!Array.isArray(data)) return res.status(400).json({ success: false, error: '需要 data 数组' });
    writeJSON(COLLECTIONS_FILE, data);
    res.json({ success: true, count: data.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});


// 初始化数据（从浏览器 localStorage 迁移到服务器）
app.post('/api/db/init', (req, res) => {
  try {
    const { presetUsers, presetData } = req.body;
    const ad = getAppData();
    if (ad.users && ad.users.length > 0) {
      return res.json({ success: true, alreadyInitialized: true, db: ad });
    }
    if (presetUsers) ad.users = presetUsers;
    if (presetData) Object.assign(ad, presetData);
    if (ad.users && ad.users.length > 0 && (!ad.visitors || ad.visitors.length === 0)) {
      ad.visitors = [];
      ad.users.filter(u => u.role === 'intern' && u.batchId).forEach(u => {
        ad.visitors.push({ userId: u.username, batchId: u.batchId, status: 'active', exitTime: null, blacklistReason: null });
      });
    }
    saveAppData(ad);
    res.json({ success: true, db: ad });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── AI 模型切换（任意用户可用，无需 API Key） ───
app.get('/api/ai/config', (req, res) => {
  const presets = aiConfig.presets || {};
  const availableProviders = [
    { id: 'mock', name: '模拟模式', desc: '零成本，本地模拟回答', configured: true },
    { id: 'deepseek', name: 'DeepSeek', desc: '价格便宜，中文效果好，国内网络友好', configured: !!(presets.deepseek && presets.deepseek.apiKey) },
    { id: 'gemini', name: 'Google Gemini', desc: '每天 1500 次免费调用', configured: !!(presets.gemini && presets.gemini.apiKey) },
  ];
  res.json({
    provider: aiConfig.currentProvider || 'mock',
    availableProviders,
  });
});

app.post('/api/ai/config', (req, res) => {
  const { provider } = req.body;
  // 只允许切换到已预配的模型或 mock
  const validProviders = ['mock', 'deepseek', 'gemini'];
  if (provider && validProviders.includes(provider)) {
    aiConfig.currentProvider = provider;
    saveAIConfigToDisk(aiConfig);
    res.json({ success: true, provider: aiConfig.currentProvider });
  } else {
    res.status(400).json({ success: false, error: '不支持的模型' });
  }
});

// ─── 测试连接 ───
app.post('/api/ai/test-connection', async (req, res) => {
  const { provider } = req.body;
  const presets = aiConfig.presets || {};
  const preset = presets[provider] || {};
  try {
    if (provider === 'gemini') {
      if (!preset.apiKey) throw new Error('Gemini API Key 未配置');
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${preset.apiKey}`;
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: 'Hello' }] }], generationConfig: { maxOutputTokens: 5 } })
      });
      if (!r.ok) { const t = await r.text().catch(() => ''); throw new Error(`Gemini 返回 ${r.status}`); }
      return res.json({ success: true, message: '✅ Gemini 连接成功' });
    }
    if (provider === 'deepseek') {
      if (!preset.apiKey) throw new Error('DeepSeek API Key 未配置');
      const r = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${preset.apiKey}` },
        body: JSON.stringify({ model: 'deepseek-chat', messages: [{ role: 'user', content: 'Hello' }], max_tokens: 5 })
      });
      if (!r.ok) { const t = await r.text().catch(() => ''); throw new Error(`DeepSeek 返回 ${r.status}`); }
      return res.json({ success: true, message: '✅ DeepSeek 连接成功' });
    }
    return res.json({ success: true, message: '✅ 模拟模式无需测试' });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// ─── 周报 ───
app.post('/api/ai/generate-report', async (req, res) => {
  const { internId, internName, mentorName, week, tasks, notes } = req.body;
  const provider = req.headers['x-provider'] || '';
  const systemPrompt = `你是一个专业的实习管理 AI 助手，负责为实习生生成周报。请根据提供的实习生信息和任务内容，生成一份结构完整、评价客观的周报。周报应包含：本周完成、能力雷达评价、亮点表现、待改进、下周计划。语气要温暖、鼓励但实事求是。使用中文 Markdown 格式输出。`;
  const userPrompt = `实习生：${internName || '同学'}\n第 ${week || 1} 周\n本周主要工作：${tasks || '尚未记录具体工作内容'}\n实习生自述：${notes || '无'}`;
  try {
    const content = await callLLM(systemPrompt, userPrompt, provider);
    const report = {
      internId, internName, mentorName,
      week: week || 1, content,
      tasks: tasks || '', notes: notes || '',
    };
    const saved = addToCollection('reports', report);
    res.json({ success: true, report: saved });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/ai/reports', (req, res) => {
  const { internId } = req.query;
  const filter = internId ? { internId } : {};
  let list = getCollection('reports', filter);
  if (internId) {
    list = list.filter(item => item.internId === internId);
  }
  res.json({ success: true, reports: list });
});

// ─── 问答 ───
app.post('/api/ai/ask', async (req, res) => {
  const { internId, question } = req.body;
  const systemPrompt = `你是一个实习 AI 助手，负责回答实习生的技术问题和职场困惑。如果问题简单明确，直接给出详细解答。如果问题需要导师介入决策，在回答末尾注明"需要导师介入"。你的语气要耐心、鼓励性，用中文回答。`;
  const userPrompt = `同学的问题：${question || '无'}`;
  try {
    const provider = req.headers['x-provider'] || '';
    const reply = await callLLM(systemPrompt, userPrompt, provider);
    const needsMentor = reply.includes('需要导师介入') || reply.includes('需要导师进一步解答');
    const qa = {
      internId,
      internName,
      question, aiReply: reply,
      mentorReply: null, needsMentor,
      status: needsMentor ? 'waiting_mentor' : 'resolved',
      isAnonymous: false,
    };
    const saved = addToCollection('questions', qa);
    res.json({ success: true, qa: saved });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/ai/questions', (req, res) => {
  const { internId } = req.query;
  let list = getCollection('questions');
  if (internId && internId !== 'all') {
    list = list.filter(item => item.internId === internId || item.internId === 'anonymous');
  }
  res.json({ success: true, questions: list });
});

app.post('/api/ai/mentor-reply', (req, res) => {
  const { questionId, reply, mentorName } = req.body;
  try {
    updateInCollection('questions', questionId, {
      mentorReply: reply, mentorName, status: 'resolved', needsMentor: false
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ════════════════════════════════════════
// Q&A 问答系统 API（线程化多人问答）
// ════════════════════════════════════════

// 获取用户列表（用于提问时选择对象）
app.get('/api/qa/users', (req, res) => {
  try {
    const { role, dept, keyword } = req.query;
    const db = getAppData();
    let users = db.users || [];

    if (role) users = users.filter(u => u.role === role);
    if (dept) users = users.filter(u => u.dept === dept);
    if (keyword) {
      const kw = keyword.toLowerCase();
      users = users.filter(u =>
        (u.realname || '').toLowerCase().includes(kw) ||
        (u.username || '').toLowerCase().includes(kw) ||
        (u.dept || '').toLowerCase().includes(kw)
      );
    }

    // 排除当前用户自身
    const exclude = req.query.exclude || '';
    if (exclude) users = users.filter(u => u.username !== exclude);

    const result = users.map(u => ({
      username: u.username, realname: u.realname,
      role: u.role, dept: u.dept || '',
      hasQAFlag: !!u.hasQAFlag,
    }));
    res.json({ success: true, users: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 创建新问答线程
app.post('/api/qa/threads', (req, res) => {
  try {
    const { creatorId, creatorName, isAnonymous, title, content, targetIds } = req.body;
    if (!creatorId || !content || !targetIds || targetIds.length === 0) {
      return res.status(400).json({ success: false, error: '缺少必填字段' });
    }
    const db = getAppData();
    const creator = db.users.find(u => u.username === creatorId);
    const thread = {
      id: 'TH_' + Date.now(),
      creatorId: creatorId,
      creatorName: isAnonymous ? '🙈 匿名用户' : (creator?.realname || creatorName || creatorId),
      isAnonymous: !!isAnonymous,
      title: title || content.slice(0, 40) + (content.length > 40 ? '...' : ''),
      content: content,
      status: 'open',
      path: (isAnonymous ? '🙈匿名用户' : (creator?.realname || creatorName || creatorId)) + ' → ' + targetIds.length + '人',
      resolvedAt: null,
      resolvedBy: null,
      resolvedByRole: null,
      createdAt: new Date().toISOString()
    };
    const saved = addToCollection('qa_threads', thread);

    // 创建参与者记录并发送通知
    targetIds.forEach(tid => {
      const targetUser = db.users.find(u => u.username === tid);
      addToCollection('qa_participants', {
        threadId: saved._id,
        userId: tid,
        role: targetUser?.role || 'unknown',
        invitedBy: creatorId,
        invitedByName: creator?.realname || creatorName || creatorId,
        unreadCount: 1,
        lastReadAt: new Date().toISOString(),
        isActive: true
      });
      // 给参与者发送通知
      addToCollection('qa_notifications', {
        threadId: saved._id,
        toUserId: tid,
        type: 'qa_new_thread',
        message: (isAnonymous ? '🙈 有人' : (creator?.realname || creatorName || creatorId)) + ' 向你提问：' + (title || content.slice(0, 30)),
        extra: content.slice(0, 80),
        read: false,
        createdAt: new Date().toISOString()
      });
    });

    // 给创建者自己加一条参与者记录（便于查看自己的历史）
    addToCollection('qa_participants', {
      threadId: saved._id,
      userId: creatorId,
      role: creator?.role || 'intern',
      invitedBy: 'self',
      invitedByName: 'self',
      unreadCount: 0,
      lastReadAt: new Date().toISOString(),
      isActive: true
    });

    res.json({ success: true, thread: saved });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 获取用户的问答线程列表
app.get('/api/qa/threads', (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ success: false, error: '缺少 userId' });

    const participants = getCollection('qa_participants').filter(p => p.userId === userId && p.isActive);
    const threadIds = participants.map(p => p.threadId);
    let threads = getCollection('qa_threads').filter(t => threadIds.includes(t._id));

    // 附加未读数
    threads = threads.map(t => {
      const myPart = participants.find(p => p.threadId === t._id);
      const allParts = getCollection('qa_participants').filter(p => p.threadId === t._id);
      const messages = getCollection('qa_messages').filter(m => m.threadId === t._id);
      return {
        ...t,
        unreadCount: myPart?.unreadCount || 0,
        participantCount: allParts.length,
        messageCount: messages.length,
        lastMessageAt: messages.length > 0 ? messages[messages.length - 1].createdAt : t.createdAt
      };
    });

    // 按最后消息时间降序
    threads.sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt));
    res.json({ success: true, threads });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 获取线程详情 + 消息
app.get('/api/qa/threads/:id', (req, res) => {
  try {
    const threadId = req.params.id;
    const threads = getCollection('qa_threads').filter(t => t._id === threadId || t.id === threadId);
    if (threads.length === 0) return res.status(404).json({ success: false, error: '线程不存在' });
    const thread = threads[0];

    const messages = getCollection('qa_messages').filter(m => m.threadId === (thread._id || thread.id));
    const participants = getCollection('qa_participants').filter(p => p.threadId === (thread._id || thread.id));

    // 获取参与者用户信息
    const db = getAppData();
    const participantUsers = participants.map(p => {
      const u = db.users.find(x => x.username === p.userId);
      return { ...p, realname: u?.realname || p.userId, role: u?.role || p.role };
    });

    res.json({ success: true, thread, messages, participants: participantUsers });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 发送消息（回复问题）
app.post('/api/qa/threads/:id/messages', (req, res) => {
  try {
    const threadId = req.params.id;
    const { senderId, senderName, senderRole, content } = req.body;
    if (!senderId || !content) {
      return res.status(400).json({ success: false, error: '缺少必填字段' });
    }

    const threads = getCollection('qa_threads').filter(t => t._id === threadId || t.id === threadId);
    if (threads.length === 0) return res.status(404).json({ success: false, error: '线程不存在' });
    const thread = threads[0];
    const realId = thread._id || thread.id;

    const msg = addToCollection('qa_messages', {
      threadId: realId,
      senderId, senderName, senderRole,
      content,
      type: 'text',
      createdAt: new Date().toISOString()
    });

    // 更新其他参与者的未读计数
    const participants = getCollection('qa_participants').filter(p => p.threadId === realId && p.userId !== senderId);
    participants.forEach(p => {
      updateInCollection('qa_participants', p._id, { unreadCount: (p.unreadCount || 0) + 1 });
    });

    res.json({ success: true, message: msg });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 标记已解决
app.post('/api/qa/threads/:id/resolve', (req, res) => {
  try {
    const threadId = req.params.id;
    const { userId, userName, userRole } = req.body;

    const threads = getCollection('qa_threads').filter(t => t._id === threadId || t.id === threadId);
    if (threads.length === 0) return res.status(404).json({ success: false, error: '线程不存在' });
    const thread = threads[0];
    const realId = thread._id || thread.id;

    updateInCollection('qa_threads', realId, {
      status: 'resolved',
      resolvedAt: new Date().toISOString(),
      resolvedBy: userId,
      resolvedByRole: userRole
    });

    // 添加系统消息
    addToCollection('qa_messages', {
      threadId: realId,
      senderId: 'system',
      senderName: '系统',
      senderRole: 'system',
      content: (userName || userId) + ' 已将问题标记为已解决',
      type: 'system',
      systemAction: 'resolve',
      createdAt: new Date().toISOString()
    });

    // 通知所有参与者
    const participants = getCollection('qa_participants').filter(p => p.threadId === realId && p.userId !== userId);
    participants.forEach(p => {
      addToCollection('qa_notifications', {
        threadId: realId,
        toUserId: p.userId,
        type: 'qa_resolved',
        message: '问题已解决：「' + (thread.title || content?.slice(0, 20)) + '」',
        read: false,
        createdAt: new Date().toISOString()
      });
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 转交问题
app.post('/api/qa/threads/:id/transfer', (req, res) => {
  try {
    const threadId = req.params.id;
    const { fromUserId, fromUserName, fromUserRole, targetId, targetRole, targetName, reason } = req.body;

    const threads = getCollection('qa_threads').filter(t => t._id === threadId || t.id === threadId);
    if (threads.length === 0) return res.status(404).json({ success: false, error: '线程不存在' });
    const thread = threads[0];
    const realId = thread._id || thread.id;

    // 更新流转路径
    const newPath = thread.path + ' → ' + (targetName || targetId) + '(' + targetRole + ')';
    updateInCollection('qa_threads', realId, { path: newPath });

    // 添加系统消息
    addToCollection('qa_messages', {
      threadId: realId,
      senderId: fromUserId,
      senderName: fromUserName || fromUserId,
      senderRole: fromUserRole || 'unknown',
      content: '该问题已转交给 ' + (targetName || targetId) + (reason ? '，原因：' + reason : ''),
      type: 'system',
      systemAction: 'transfer',
      transferTargetId: targetId,
      transferTargetRole: targetRole,
      transferTargetName: targetName || targetId,
      createdAt: new Date().toISOString()
    });

    // 添加新参与者或激活已有参与者
    const existingPart = getCollection('qa_participants').find(p => p.threadId === realId && p.userId === targetId);
    if (existingPart) {
      updateInCollection('qa_participants', existingPart._id, { isActive: true, unreadCount: (existingPart.unreadCount || 0) + 1 });
    } else {
      const db = getAppData();
      const targetUser = db.users.find(u => u.username === targetId);
      addToCollection('qa_participants', {
        threadId: realId,
        userId: targetId,
        role: targetRole || targetUser?.role || 'unknown',
        invitedBy: fromUserId,
        invitedByName: fromUserName || fromUserId,
        unreadCount: 1,
        lastReadAt: new Date().toISOString(),
        isActive: true
      });
    }

    // 通知目标用户
    addToCollection('qa_notifications', {
      threadId: realId,
      toUserId: targetId,
      type: 'qa_new_thread',
      message: (fromUserName || fromUserId) + ' 转交了一个问题给你：「' + (thread.title || '') + '」',
      extra: reason || '无附加说明',
      read: false,
      createdAt: new Date().toISOString()
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 邀请更多参与者
app.post('/api/qa/threads/:id/invite', (req, res) => {
  try {
    const threadId = req.params.id;
    const { inviterId, inviterName, targetIds } = req.body;

    const threads = getCollection('qa_threads').filter(t => t._id === threadId || t.id === threadId);
    if (threads.length === 0) return res.status(404).json({ success: false, error: '线程不存在' });
    const thread = threads[0];
    const realId = thread._id || thread.id;

    const db = getAppData();
    const added = [];

    targetIds.forEach(tid => {
      const existing = getCollection('qa_participants').find(p => p.threadId === realId && p.userId === tid);
      const targetUser = db.users.find(u => u.username === tid);

      // 如果已经参与（活跃）则跳过
      if (existing && existing.isActive) return;

      if (existing) {
        updateInCollection('qa_participants', existing._id, { isActive: true, unreadCount: (existing.unreadCount || 0) + 1 });
      } else {
        addToCollection('qa_participants', {
          threadId: realId,
          userId: tid,
          role: targetUser?.role || 'unknown',
          invitedBy: inviterId,
          invitedByName: inviterName || inviterId,
          unreadCount: 1,
          lastReadAt: new Date().toISOString(),
          isActive: true
        });
      }
      added.push(tid);

      // 通知
      addToCollection('qa_notifications', {
        threadId: realId,
        toUserId: tid,
        type: 'qa_new_thread',
        message: (inviterName || inviterId) + ' 邀请你参与问答：「' + (thread.title || '') + '」',
        read: false,
        createdAt: new Date().toISOString()
      });
    });

    if (added.length > 0) {
      // 添加系统消息
      addToCollection('qa_messages', {
        threadId: realId,
        senderId: inviterId,
        senderName: inviterName || inviterId,
        senderRole: db.users.find(u => u.username === inviterId)?.role || 'unknown',
        content: '邀请了 ' + added.length + ' 人加入讨论',
        type: 'system',
        systemAction: 'invite',
        createdAt: new Date().toISOString()
      });

      // 更新路径
      const newPath = thread.path + ' → +' + added.length + '人';
      updateInCollection('qa_threads', realId, { path: newPath });
    }

    res.json({ success: true, added });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// HR 管理：获取所有线程
app.get('/api/qa/admin/threads', (req, res) => {
  try {
    const { status } = req.query;
    let threads = getCollection('qa_threads');

    if (status) threads = threads.filter(t => t.status === status);

    // 附加统计信息
    threads = threads.map(t => {
      const realId = t._id || t.id;
      const messages = getCollection('qa_messages').filter(m => m.threadId === realId);
      const participants = getCollection('qa_participants').filter(p => p.threadId === realId);

      // 查找回复者（非创建者、非系统、有消息记录的人）
      const msgSenders = [...new Set(messages
        .filter(m => m.senderId !== t.creatorId && m.senderId !== 'system')
        .map(m => m.senderId)
      )];

      // 判断是否经过转交到达 HR
      const transferMsgs = messages.filter(function(m) {
        return m.systemAction === 'transfer' && m.transferTargetRole === 'hr';
      });
      const isTransferred = transferMsgs.length > 0;

      // 判断是否直接提问给 HR（有 HR 参与者且未被转交）
      const hasHrParticipant = participants.some(function(p) { return p.role === 'hr'; });
      const isDirectToHR = hasHrParticipant && !isTransferred;

      // 转交来源信息
      var transferFromInfo = '';
      if (isTransferred) {
        var lastTransfer = transferMsgs[transferMsgs.length - 1];
        transferFromInfo = (lastTransfer.senderName || lastTransfer.senderId || '未知') + ' 转交';
      }

      return {
        ...t,
        messageCount: messages.length,
        participantCount: participants.length,
        replierIds: msgSenders,
        lastMessageAt: messages.length > 0 ? messages[messages.length - 1].createdAt : t.createdAt,
        isTransferred: isTransferred,
        isDirectToHR: isDirectToHR,
        transferFromInfo: transferFromInfo
      };
    });

    threads.sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt));
    res.json({ success: true, threads });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// HR 管理：统计数据
app.get('/api/qa/admin/stats', (req, res) => {
  try {
    const threads = getCollection('qa_threads');
    const openCount = threads.filter(t => t.status === 'open').length;
    const resolvedCount = threads.filter(t => t.status === 'resolved').length;
    const messages = getCollection('qa_messages');

    // 各角色参与
    const roleStats = {};
    getCollection('qa_participants').forEach(p => {
      if (!roleStats[p.role]) roleStats[p.role] = { count: 0, threads: new Set() };
      roleStats[p.role].count++;
      roleStats[p.role].threads.add(p.threadId);
    });

    res.json({
      success: true,
      stats: {
        total: threads.length,
        open: openCount,
        resolved: resolvedCount,
        totalMessages: messages.length,
        roleParticipation: Object.fromEntries(
          Object.entries(roleStats).map(([k, v]) => [k, { participants: v.count, threads: v.threads.size }])
        )
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 获取通知列表
app.get('/api/qa/notifications', (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ success: false, error: '缺少 userId' });
    const notifs = getCollection('qa_notifications')
      .filter(n => n.toUserId === userId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json({ success: true, notifications: notifs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 标记未读为已读
app.post('/api/qa/threads/:id/read', (req, res) => {
  try {
    const threadId = req.params.id;
    const { userId } = req.body;
    const participants = getCollection('qa_participants').filter(p => p.threadId === threadId && p.userId === userId);
    if (participants.length > 0) {
      updateInCollection('qa_participants', participants[0]._id, { unreadCount: 0, lastReadAt: new Date().toISOString() });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── 成长回望 ───
app.post('/api/ai/generate-reflection', async (req, res) => {
  const { internId, internName, mentorName, daysInto } = req.body;
  const systemPrompt = `你是一个温暖的 AI 成长顾问。请为实习生生成一份"成长回望"报告。报告要以第二人称"你"来写，回顾实习以来的成长历程。包含：时间线回顾、导师曾经的评价、以及一封五年后的自己写给现在的信。语气温暖、真诚、有力量。使用中文 Markdown 格式。`;
  const userPrompt = `实习生：${internName || '同学'}\n导师：${mentorName || '导师'}\n已实习天数：${daysInto || 45} 天`;
  try {
    const provider = req.headers['x-provider'] || '';
    const content = await callLLM(systemPrompt, userPrompt, provider);
    const reflection = { internId, internName, content, daysInto: daysInto || 45 };
    const saved = addToCollection('reflections', reflection);
    res.json({ success: true, reflection: saved });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── AI 辅助创建任务 ───
app.post('/api/ai/generate-mission', async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ success: false, error: '缺少 prompt' });
  const systemPrompt = `你是一个专业的实习任务创建助手。根据用户描述，生成一个任务结构。输出必须是 JSON 格式，包含 title 和 content 两个字段。title 是简洁的任务名称（不超过 20 字），content 是详细的任务描述和具体要求。不要输出 markdown 代码块，只输出纯 JSON。`;
  try {
    const provider = req.headers['x-provider'] || '';
    const content = await callLLM(systemPrompt, prompt, provider);
    // 尝试解析 JSON
    let mission;
    try {
      // 去掉可能的 markdown 包裹
      let clean = content.trim();
      if (clean.startsWith('```')) clean = clean.replace(/```[a-z]*\n?/gi, '').trim();
      if (clean.endsWith('```')) clean = clean.slice(0, -3).trim();
      mission = JSON.parse(clean);
    } catch (e) {
      // 如果解析失败，直接用整个响应作为 content
      mission = { title: prompt.slice(0, 20), content: content };
    }
    res.json({ success: true, mission: { title: (mission.title || '').slice(0, 30), content: mission.content || content } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/ai/reflections', (req, res) => {
  const { internId } = req.query;
  let list = getCollection('reflections');
  if (internId) {
    list = list.filter(item => item.internId === internId);
  }
  res.json({ success: true, reflections: list });
});

// ════════════════════════════════════════
// HR 新评估系统 API（数据存在 collections.json 云数据库）
// ════════════════════════════════════════

// 每周评估（模式一）- 支持覆盖：同一实习生同一周只保留最新版
app.post('/api/evaluate/weekly', async (req, res) => {
  try {
    const { hrId, internId, internName, weekNum, weekStart, reportStats, interaction, interactionDesc, globalInstruction, contentDetail, internMemory } = req.body;
    if (!internId) return res.status(400).json({ success: false, error: '缺少参数' });

    const statusDesc = reportStats.submitted > 0
      ? (reportStats.overdue > 0 ? '逾期' : reportStats.ddlDay > 0 ? 'DDL当天' : '正常提交')
      : '未提交';
    const scoreInfo = reportStats.avgScore > 0 ? `${reportStats.avgScore}` : '暂无';
    const moodHint = interaction.moodHint || '无明显消极信号';
    const interactionDescText = interactionDesc || `提问${interaction.qaCount}次，广场参与${(interaction.plazaPostCount||0)+(interaction.plazaCommentCount||0)}次`;

    let memoryHint = '';
    if (internMemory) memoryHint = '\nHR补充信息：' + internMemory;

    const systemPrompt = `你是一位直言不讳的实习评估官，只说事实不给空话。这是HR评估系统的每周评估（hr_eval_weekly）。
输出要求：优点说具体，问题不回避，不谈套话。有消极情绪或困惑必须指出。严格200字以内。${globalInstruction ? '\nHR额外要求：' + globalInstruction : ''}${memoryHint}`;

    const userPrompt = `实习生：${internName}
第${weekNum}周（${weekStart}）
- 导师评分：${scoreInfo}/100
- 提交状态：${statusDesc}（逾期${reportStats.overdue}次，DDL当天${reportStats.ddlDay}次）
- 本周互动情况：${interactionDescText}
- 情绪信号：${moodHint}
- 周报内容摘要：${(contentDetail || '').slice(0, 300)}`;

    const provider = req.headers['x-provider'] || '';
    const content = await callLLM(systemPrompt, userPrompt, provider);

    const weekEnd = weekStart ? (function(){
      var d = new Date(weekStart);
      d.setDate(d.getDate() + 6);
      return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    })() : '';

    // 检查是否已存在同实习生+同周的评估，有则覆盖
    const allEvals = getCollection('evaluations');
    const existing = allEvals.find(e =>
      e._collection === 'evaluations' &&
      e.internId === internId &&
      e.type === 'weekly' &&
      e.weekNum === (weekNum || 1)
    );

    if (existing) {
      // 覆盖
      updateInCollection('evaluations', existing._id, {
        content, score: reportStats.avgScore || 0,
        generatedAt: new Date().toISOString()
      });
      res.json({ success: true, evaluation: { ...existing, content, score: reportStats.avgScore, generatedAt: new Date().toISOString() }, overwritten: true });
    } else {
      // 新增
      const saved = addToCollection('evaluations', {
        internId, internName, type: 'weekly',
        weekNum: weekNum || 1, weekStart: weekStart || '', weekEnd,
        content, score: reportStats.avgScore || 0,
        hrId: hrId || '',
        generatedAt: new Date().toISOString()
      });
      res.json({ success: true, evaluation: saved });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 实习至今总评估（模式二）- 最多20篇，满了自动覆盖最旧的
app.post('/api/evaluate/overall', async (req, res) => {
  try {
    const { hrId, internId, internName, reportStats, interaction, weeklyEvals } = req.body;
    if (!internId) return res.status(400).json({ success: false, error: '缺少参数' });

    const totalWeeks = weeklyEvals.length;
    const submitRate = reportStats.totalReports > 0 ? Math.round(reportStats.submitted / reportStats.totalReports * 100) : 0;
    const lateRate = reportStats.totalReports > 0 ? Math.round(reportStats.ddlDay / reportStats.totalReports * 100) : 0;
    const overdueRate = reportStats.totalReports > 0 ? Math.round(reportStats.overdue / reportStats.totalReports * 100) : 0;
    const weeklySummaries = weeklyEvals.map(w => `第${w.weekNum}周：${(w.content || '').slice(0, 100)}`).join('\n');

    const systemPrompt = `你是一位严谨的实习评估专家，根据全部历史数据出具评估。这是实习至今总评估（hr_eval_overall）。
输出要求：一针见血，不讲场面话。优点讲突出之处，问题讲具体维度，进步讲对比根据。严格500字以内。`;

    const userPrompt = `实习生：${internName}
共${totalWeeks}周评估，周报提交率${submitRate}%，DDL率${lateRate}%，逾期率${overdueRate}%
周报均分${reportStats.avgScore || 0}，最高${reportStats.maxScore || 0}，最低${reportStats.minScore || 0}
总提问${interaction.qaCount}次
历史评估摘要：
${weeklySummaries || '暂无历史周评估'}`;

    const provider = req.headers['x-provider'] || '';
    const content = await callLLM(systemPrompt, userPrompt, provider);

    // 检查该实习生总评估是否已达到20篇，满了则删除最旧的
    const allEvals = getCollection('evaluations');
    const existingOveralls = allEvals.filter(e =>
      e._collection === 'evaluations' && e.internId === internId && e.type === 'overall'
    ).sort((a, b) => new Date(a.generatedAt) - new Date(b.generatedAt));

    var deletedOld = null;
    if (existingOveralls.length >= 20) {
      // 删除最旧的一篇
      const oldest = existingOveralls[0];
      const allData = readJSON(COLLECTIONS_FILE, []);
      const idx = allData.findIndex(item =>
        item._collection === 'evaluations' && (item._id === oldest._id || item.id == oldest.id)
      );
      if (idx !== -1) {
        allData.splice(idx, 1);
        writeJSON(COLLECTIONS_FILE, allData);
        deletedOld = oldest.generatedAt;
      }
    }

    const saved = addToCollection('evaluations', {
      internId, internName, type: 'overall',
      content,
      stats: { totalWeeks, submitRate, lateRate, overdueRate, avgScore: reportStats.avgScore },
      hrId: hrId || '',
      generatedAt: new Date().toISOString()
    });

    res.json({ success: true, evaluation: saved, deletedOld: !!deletedOld });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 获取某实习生的所有评估记录（区分周评估和总评估）
app.get('/api/evaluate/archive/:internId', (req, res) => {
  try {
    const allEvals = getCollection('evaluations');
    const internEvals = allEvals.filter(e => e.internId === req.params.internId);
    const weekly = internEvals.filter(e => e.type === 'weekly').sort((a, b) => (b.weekNum || 0) - (a.weekNum || 0));
    const overall = internEvals.filter(e => e.type === 'overall').sort((a, b) => new Date(b.generatedAt) - new Date(a.generatedAt));
    res.json({ success: true, archive: { weekly, overall } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 获取所有实习生的评估概览（用于档案库列表）
app.get('/api/evaluate/all-archives', (req, res) => {
  try {
    const allEvals = getCollection('evaluations');
    const summary = {};
    allEvals.forEach(e => {
      if (!summary[e.internId]) summary[e.internId] = { internName: e.internName, weeklyCount: 0, overallCount: 0 };
      if (e.type === 'weekly') summary[e.internId].weeklyCount++;
      if (e.type === 'overall') summary[e.internId].overallCount++;
    });
    res.json({ success: true, archives: summary });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 重新生成评估（覆盖数据库中指定评估）
app.post('/api/evaluate/regenerate', async (req, res) => {
  try {
    const { hrId, internId, internName, type, evalId, instruction, applyAll, internMemory, weekNum, weekStart, reportStats, interaction, interactionDesc, contentDetail, globalInstruction } = req.body;
    if (!internId || !type) return res.status(400).json({ success: false, error: '缺少参数' });

    // 保存记忆（追加到列表）
    if (applyAll && hrId && instruction) {
      const db = getAppData();
      if (!db.evaluationMemory) db.evaluationMemory = {};
      if (!db.evaluationMemory[hrId]) db.evaluationMemory[hrId] = { globalInstructions: [], internInstructions: {} };
      if (!db.evaluationMemory[hrId].globalInstructions) db.evaluationMemory[hrId].globalInstructions = [];
      if (typeof db.evaluationMemory[hrId].globalInstruction === 'string' && db.evaluationMemory[hrId].globalInstruction.trim() && !db.evaluationMemory[hrId].globalInstructions.length) {
        db.evaluationMemory[hrId].globalInstructions.push({ id: 'legacy', text: db.evaluationMemory[hrId].globalInstruction, createdAt: new Date().toISOString() });
        delete db.evaluationMemory[hrId].globalInstruction;
      }
      db.evaluationMemory[hrId].globalInstructions.push({
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
        text: instruction,
        createdAt: new Date().toISOString()
      });
      saveAppData(db);
    }

    // 如果传了 internMemory（永久记忆），保存到该实习生的记忆列表里
    if (hrId && internMemory) {
      const db = getAppData();
      if (!db.evaluationMemory) db.evaluationMemory = {};
      if (!db.evaluationMemory[hrId]) db.evaluationMemory[hrId] = { globalInstructions: [], internInstructions: {} };
      if (!db.evaluationMemory[hrId].internInstructions) db.evaluationMemory[hrId].internInstructions = {};
      if (!db.evaluationMemory[hrId].internInstructions[internId]) {
        db.evaluationMemory[hrId].internInstructions[internId] = { instructions: [], updatedAt: new Date().toISOString() };
      }
      const entry = db.evaluationMemory[hrId].internInstructions[internId];
      // 兼容旧数据
      if (entry.instruction && (!entry.instructions || !entry.instructions.length)) {
        entry.instructions = [{ id: 'legacy', text: entry.instruction, createdAt: entry.updatedAt || new Date().toISOString() }];
        delete entry.instruction;
      }
      if (!entry.instructions) entry.instructions = [];
      entry.instructions.push({
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
        text: internMemory,
        createdAt: new Date().toISOString()
      });
      entry.updatedAt = new Date().toISOString();
      saveAppData(db);
    }

    let memoryHint = '';
    let globalText = '';
    if (hrId) {
      const db = getAppData();
      const mem = (db.evaluationMemory || {})[hrId];
      if (mem) {
        const gList = mem.globalInstructions || [];
        if (gList.length) globalText = gList.map(i => i.text).join('\n');
        if (mem.internInstructions && mem.internInstructions[internId]) {
          const iList = mem.internInstructions[internId].instructions || [];
          if (iList.length) memoryHint = '\nHR补充信息（已记忆）：' + iList.map(i => i.text).join('\n');
        }
      }
    }

    let systemPrompt, userPrompt;
    if (type === 'weekly') {
      const statusDesc = reportStats?.submitted > 0
        ? (reportStats.overdue > 0 ? '逾期' : reportStats.ddlDay > 0 ? 'DDL当天' : '正常提交')
        : '未提交';
      const scoreInfo = reportStats?.avgScore > 0 ? `${reportStats.avgScore}` : '暂无';
      const moodHint = interaction?.moodHint || '无明显消极信号';
      const interactionDescText = interactionDesc || `提问${interaction?.qaCount||0}次，广场参与${(interaction?.plazaPostCount||0)+(interaction?.plazaCommentCount||0)}次`;

      systemPrompt = `你是一位直言不讳的实习评估官，只说事实不给空话。这是HR评估系统的每周评估（hr_eval_weekly）。
输出要求：优点说具体，问题不回避，不谈套话。有消极情绪或困惑必须指出。严格200字以内。${globalText ? '\nHR额外要求：' + globalText : ''}${memoryHint}${internMemory ? '\nHR本次补充：' + internMemory : ''}`;

      userPrompt = `实习生：${internName}
第${weekNum}周（${weekStart}）
- 导师评分：${scoreInfo}/100
- 提交状态：${statusDesc}（逾期${reportStats?.overdue||0}次，DDL当天${reportStats?.ddlDay||0}次）
- 本周互动情况：${interactionDescText}
- 情绪信号：${moodHint}
- 周报内容摘要：${(contentDetail || '').slice(0, 300)}`;
    } else {
      systemPrompt = `你是一位严谨的实习评估专家，根据全部历史数据出具评估。这是实习至今总评估（hr_eval_overall）。
输出要求：一针见血，不讲场面话。优点讲突出之处，问题讲具体维度，进步讲对比根据。严格500字以内。${memoryHint}${internMemory ? '\nHR补充信息：' + internMemory : ''}`;
      userPrompt = `请重新生成该实习生的总评估。${instruction || ''}${internMemory ? '\nHR补充信息：' + internMemory : ''}`;
    }

    const provider = req.headers['x-provider'] || '';
    const content = await callLLM(systemPrompt, userPrompt, provider);

    // 更新数据库中的评估内容
    if (evalId) {
      updateInCollection('evaluations', evalId, {
        content,
        generatedAt: new Date().toISOString()
      });
    }

    res.json({ success: true, content, evalId });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 保存评估记忆（追加到历史列表）
app.post('/api/evaluate/memory', (req, res) => {
  try {
    const { hrId, type, internId, instruction, itemId } = req.body;
    if (!hrId) return res.status(400).json({ success: false, error: '缺少hrId' });

    const db = getAppData();
    if (!db.evaluationMemory) db.evaluationMemory = {};
    if (!db.evaluationMemory[hrId]) db.evaluationMemory[hrId] = { globalInstructions: [], internInstructions: {} };

    if (type === 'global') {
      // 兼容旧数据迁移（仅迁移非空字符串）
      if (typeof db.evaluationMemory[hrId].globalInstruction === 'string' && db.evaluationMemory[hrId].globalInstruction.trim() && (!db.evaluationMemory[hrId].globalInstructions || !db.evaluationMemory[hrId].globalInstructions.length)) {
        db.evaluationMemory[hrId].globalInstructions = [{ id: 'legacy', text: db.evaluationMemory[hrId].globalInstruction, createdAt: new Date().toISOString() }];
        delete db.evaluationMemory[hrId].globalInstruction;
      }
      if (!db.evaluationMemory[hrId].globalInstructions) db.evaluationMemory[hrId].globalInstructions = [];
      if (instruction) {
        db.evaluationMemory[hrId].globalInstructions.push({
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
          text: instruction,
          createdAt: new Date().toISOString()
        });
      }
    } else if (type === 'intern' && internId) {
      if (!db.evaluationMemory[hrId].internInstructions) db.evaluationMemory[hrId].internInstructions = {};
      if (!db.evaluationMemory[hrId].internInstructions[internId]) {
        db.evaluationMemory[hrId].internInstructions[internId] = { instructions: [], updatedAt: new Date().toISOString() };
      }
      const entry = db.evaluationMemory[hrId].internInstructions[internId];
      // 兼容旧数据迁移
      if (entry.instruction && (!entry.instructions || !entry.instructions.length)) {
        entry.instructions = [{ id: 'legacy', text: entry.instruction, createdAt: entry.updatedAt || new Date().toISOString() }];
        delete entry.instruction;
      }
      if (!entry.instructions) entry.instructions = [];
      if (instruction) {
        entry.instructions.push({
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
          text: instruction,
          createdAt: new Date().toISOString()
        });
      }
      entry.updatedAt = new Date().toISOString();
    }
    saveAppData(db);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 删除单条评估（模式二可手动删除）
app.delete('/api/evaluate/delete/:evalId', (req, res) => {
  try {
    const { evalId } = req.params;
    if (!evalId) return res.status(400).json({ success: false, error: '缺少evalId' });

    const allData = readJSON(COLLECTIONS_FILE, []);
    const idx = allData.findIndex(item =>
      item._collection === 'evaluations' && (item._id === evalId || item.id == evalId)
    );
    if (idx === -1) return res.status(404).json({ success: false, error: '评估不存在' });

    const deleted = allData.splice(idx, 1);
    writeJSON(COLLECTIONS_FILE, allData);
    res.json({ success: true, deleted: deleted[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 获取评估记忆（返回列表格式，兼容旧数据）
app.get('/api/evaluate/memory/:hrId', (req, res) => {
  try {
    const db = getAppData();
    const raw = (db.evaluationMemory || {})[req.params.hrId] || {};
    // 兼容旧数据迁移（仅迁移非空）
    const memory = { globalInstructions: [], internInstructions: {} };
    if (raw.globalInstruction && typeof raw.globalInstruction === 'string' && raw.globalInstruction.trim() && (!raw.globalInstructions || !raw.globalInstructions.length)) {
      memory.globalInstructions = [{ id: 'legacy', text: raw.globalInstruction, createdAt: new Date().toISOString() }];
    } else {
      memory.globalInstructions = raw.globalInstructions || [];
    }
    // 迁移个人记忆
    if (raw.internInstructions) {
      for (const id of Object.keys(raw.internInstructions)) {
        const entry = raw.internInstructions[id];
        if (entry.instruction && (!entry.instructions || !entry.instructions.length)) {
          memory.internInstructions[id] = {
            instructions: [{ id: 'legacy', text: entry.instruction, createdAt: entry.updatedAt || new Date().toISOString() }],
            updatedAt: entry.updatedAt || new Date().toISOString()
          };
        } else {
          memory.internInstructions[id] = {
            instructions: entry.instructions || [],
            updatedAt: entry.updatedAt || new Date().toISOString()
          };
        }
      }
    }
    res.json({ success: true, memory });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 删除某条全局记忆
app.delete('/api/evaluate/memory/:hrId/global/:itemId', (req, res) => {
  try {
    const { hrId, itemId } = req.params;
    const db = getAppData();
    const mem = (db.evaluationMemory || {})[hrId];
    if (mem && mem.globalInstructions) {
      mem.globalInstructions = mem.globalInstructions.filter(i => i.id !== itemId);
      saveAppData(db);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 删除某条个人记忆
app.delete('/api/evaluate/memory/:hrId/intern/:internId/:itemId', (req, res) => {
  try {
    const { hrId, internId, itemId } = req.params;
    const db = getAppData();
    const mem = (db.evaluationMemory || {})[hrId];
    if (mem && mem.internInstructions && mem.internInstructions[internId] && mem.internInstructions[internId].instructions) {
      mem.internInstructions[internId].instructions = mem.internInstructions[internId].instructions.filter(i => i.id !== itemId);
      mem.internInstructions[internId].updatedAt = new Date().toISOString();
      saveAppData(db);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 删除某实习生的所有个人记忆
app.delete('/api/evaluate/memory/:hrId/:internId', (req, res) => {
  try {
    const { hrId, internId } = req.params;
    const db = getAppData();
    if (db.evaluationMemory && db.evaluationMemory[hrId] && db.evaluationMemory[hrId].internInstructions) {
      delete db.evaluationMemory[hrId].internInstructions[internId];
      saveAppData(db);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── 导师批注 ───
app.post('/api/ai/generate-comment', async (req, res) => {
  const { internId, internName, mentorName, reportContent, weekNum, aiGenerated, wordCount } = req.body;
  const systemPrompt = `你是一位经验丰富的技术导师，正在为实习生的周报撰写批注。

## 核心原则
1. **极度精炼**：批注不超过 150 字，导师没空读长文。直击要点，不绕弯子。
2. **关注事实**：只评论学生实际做了什么、学到了什么，忽略套话空话。
3. **区分AI与否**：如果内容结构过于模板化、用词空洞（如"在导师指导下"、"积极学习"等套话），说明学生可能用AI生成，在批注开头用 📝 标注。
4. **直言不讳但留余地**：有问题直接指出，但用建议口吻而非指责。表现好就具体表扬。
5. **字数统计**：如果周报总字数偏少(< 50字)，提醒下周多写细节。
6. **不重复周报内容**：不要复述学生写了什么，直接给出你的判断和建议。

## 输出格式
回复纯文本，不要 Markdown 格式，不要多余的空行。`;

  const userPrompt = `实习生：${internName || '未知'}
导师：${mentorName || '未知'}
第 ${weekNum || '?'} 周
总字数：${wordCount || 0} 字
AI生成标记：${aiGenerated ? '是' : '否'}

本周工作内容：
${reportContent?.workDone || '未填写'}

遇到的问题：
${reportContent?.issues || '未填写'}

心得与反思：
${reportContent?.reflection || '未填写'}

下周计划：
${reportContent?.plan || '未填写'}`;
  try {
    const provider = req.headers['x-provider'] || '';
    const content = await callLLM(systemPrompt, userPrompt, provider);
    res.json({ success: true, comment: content });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── AI 智能匹配 ───
app.post('/api/ai/match', async (req, res) => {
  const { students, mentors, previousResults, feedback } = req.body;
  if (!students || !mentors) {
    return res.status(400).json({ success: false, error: '缺少学生或导师数据' });
  }
  
  const isRevision = !!(previousResults && feedback);
  
  const systemPrompt = `你是一个实习师生匹配专家。你需要根据学生和导师的信息，生成最优的师生匹配方案。

## 核心规则
1. **专业/岗位匹配优先**：尽量将学生的专业（major）与导师的岗位方向（dept）对齐
2. **负载均衡**：每个导师带教人数不超过其 maxStudents 上限，尽量均匀分配
3. **学校背景考量**：同校背景可作为加分项，但不是决定因素
4. **必须为每位学生分配导师**：不能有学生落单
5. **不能超过导师容量**：每个 mentor 分配的学生数 <= mentor.maxStudents

## 输出格式（严格 JSON 数组）
必须返回纯 JSON 数组，不要 markdown 代码块，不要任何解释文字：
[{"studentId":"intern01","mentorId":"mentorda","reason":"专业匹配：计算机科学→研发"},...]

${isRevision ? '## 用户反馈\n用户对上一轮结果不满意，反馈如下：' + feedback + '\n请结合反馈重新分配。' : ''}`;

  const userPrompt = `## 学生列表
${students.map(s => `- ${s.studentId}（${s.realname}）专业:${s.major||'未知'} 学校:${s.school||'未知'} 意向岗位:${s.dept||'未知'}`).join('\n')}

## 导师列表
${mentors.map(m => `- ${m.mentorId}（${m.realname}）岗位:${m.dept||'未知'} 当前带教:${m.currentLoad||0}/${m.maxStudents||5}`).join('\n')}

请给出最优匹配方案 JSON 数组。`;

  try {
    const provider = req.headers['x-provider'] || '';
    const content = await callLLM(systemPrompt, userPrompt, provider);
    // 尝试解析 JSON
    let results;
    try {
      const cleaned = content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      results = JSON.parse(cleaned);
    } catch (parseErr) {
      const match = content.match(/\[[\s\S]*\]/);
      if (match) {
        results = JSON.parse(match[0]);
      } else {
        throw new Error('AI 返回格式异常，无法解析匹配结果');
      }
    }
    res.json({ success: true, results });
  } catch (err) {
    console.warn('[AI Match] Error:', err.message);
    const localResults = smartLocalMatch(students, mentors);
    res.json({ success: true, results: localResults, fallback: true, fallbackReason: 'AI 调用失败，已使用本地智能匹配算法' });
  }
});

// 本地智能匹配算法（AI 不可用时的降级方案）
function smartLocalMatch(students, mentors) {
  var mentorsCopy = mentors.map(function(m) { 
    return { mentorId: m.mentorId, realname: m.realname, dept: m.dept, currentLoad: m.currentLoad || 0, maxStudents: m.maxStudents || 5 };
  });
  
  var studentGroups = {};
  students.forEach(function(s) {
    var dept = s.dept || '未设置';
    if (!studentGroups[dept]) studentGroups[dept] = [];
    studentGroups[dept].push(s);
  });
  
  var results = [];
  
  Object.keys(studentGroups).forEach(function(dept) {
    var matchingMentors = mentorsCopy.filter(function(m) { return m.dept === dept && m.currentLoad < m.maxStudents; });
    var unmatched = [];
    
    studentGroups[dept].forEach(function(stu) {
      if (matchingMentors.length === 0) {
        unmatched.push(stu);
        return;
      }
      matchingMentors.sort(function(a, b) { return a.currentLoad - b.currentLoad; });
      var best = matchingMentors[0];
      results.push({ studentId: stu.studentId, mentorId: best.mentorId, reason: '岗位匹配：' + (stu.major || dept) + String.fromCharCode(8594) + best.dept });
      best.currentLoad++;
      if (best.currentLoad >= best.maxStudents) {
        matchingMentors = matchingMentors.filter(function(m) { return m.mentorId !== best.mentorId; });
      }
    });
    
    unmatched.forEach(function(stu) {
      var available = mentorsCopy.filter(function(m) { return m.currentLoad < m.maxStudents; });
      if (available.length === 0) return;
      available.sort(function(a, b) { return a.currentLoad - b.currentLoad; });
      var best = available[0];
      results.push({ studentId: stu.studentId, mentorId: best.mentorId, reason: '跨岗位调剂：' + (stu.major || dept) + String.fromCharCode(8594) + best.dept });
      best.currentLoad++;
    });
  });
  
  return results;
}

// 静态文件服务 — 上传的图片
app.use('/uploads', express.static('uploads'));

// ─── 图片上传 ───
app.post('/api/upload', express.json({ limit: '5mb' }), (req, res) => {
  const { image, folder } = req.body;
  if (!image) return res.status(400).json({ success: false, error: '缺少图片数据' });
  try {
    const matches = image.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!matches) return res.status(400).json({ success: false, error: '图片格式不正确' });
    const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
    const data = Buffer.from(matches[2], 'base64');
    const dir = folder || 'treehole';
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const subDir = `uploads/${dir}/${now.getFullYear()}-${month}`;
    if (!fs.existsSync(subDir)) fs.mkdirSync(subDir, { recursive: true });
    const filename = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const filepath = `${subDir}/${filename}`;
    fs.writeFileSync(filepath, data);
    const url = `/${filepath.replace(/\\/g, '/')}`;
    res.json({ success: true, url });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── 启动服务器（含端口重试） ───
function startServer(port, retriesLeft) {
  const server = app.listen(port, () => {
    const addr = server.address();
    const actualPort = addr.port;
    const presets = aiConfig.presets || {};
    const configuredList = [];
    if (presets.deepseek && presets.deepseek.apiKey) configuredList.push('DeepSeek');
    if (presets.gemini && presets.gemini.apiKey) configuredList.push('Gemini');
    if (presets.cloudbase && presets.cloudbase.apiKey) configuredList.push('CloudBase');
    console.log(`\n🚀 实习加油站 - 本地服务已启动！`);
    console.log(`📡 地址: http://localhost:${actualPort}`);
    console.log(`🤖 当前模型: ${aiConfig.currentProvider || 'mock'}`);
    console.log(`🔑 已预配模型: ${configuredList.length > 0 ? configuredList.join(', ') : '无（仅模拟模式可用）'}`);
    console.log(`💡 任意用户可在主页切换模型\n`);
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && retriesLeft > 0) {
      console.warn(`[Server] 端口 ${port} 被占用，${2}s 后重试（剩余 ${retriesLeft} 次）...`);
      setTimeout(function(){ startServer(port, retriesLeft - 1); }, 2000);
    } else {
      console.error(`[Server] 启动失败: ${err.message}`);
    }
  });
}
startServer(PORT, 10);
