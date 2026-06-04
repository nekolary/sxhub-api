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
  // 允许所有来源（本地 + sxhub.xyz + Railway 自身）
  if (origin) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE');
  res.header('Access-Control-Allow-Credentials', 'true');
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
  if (systemPrompt.includes('每周评估') || systemPrompt.includes('weekly_eval')) {
    return generateMockWeeklyEvaluation(userPrompt);
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
  if (systemPrompt.includes('评估') || systemPrompt.includes('evaluation') || systemPrompt.includes('转正')) {
    return generateMockEvaluation(userPrompt);
  }
  return `[模拟回答] 收到你的问题：「${userPrompt.slice(0, 50)}...」\n\n根据当前上下文，建议你从以下几个方面入手：\n\n1. **明确目标**：先梳理清楚你想要达成的具体目标\n2. **拆解步骤**：将大目标分解为可执行的小步骤\n3. **寻求反馈**：定期与导师对齐进度，获取及时反馈\n4. **记录成长**：保持记录，每周回顾自己的进步\n\n> 💡 配置 AI API Key 后，即可获得 AI 实时生成的优质回答。`;
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

function generateMockEvaluation(userPrompt) {
  const nameMatch = userPrompt.match(/实习生[：:]\s*(\S+)/);
  const internName = nameMatch ? nameMatch[1] : '同学';
  return `## 📋 ${internName} · 实习转正评估报告\n\n### 基础信息\n- **实习时长**：3 个月\n- **岗位**：前端开发实习生\n- **导师评价等级**：A-（优秀）\n\n### 能力维度评分（满分 5 分）\n\n| 维度 | 评分 | 评语 |\n|:---|:---:|:---|\n| 技术能力 | 4.0 | 能独立完成常规开发任务，代码规范性好 |\n| 学习能力 | 4.5 | 上手速度快，善于总结和提问 |\n| 沟通协作 | 4.0 | 团队融入好，站会汇报清晰 |\n| 主动性 | 3.5 | 能完成分配任务，主动承担意愿可加强 |\n| 业务理解 | 3.5 | 对负责模块业务理解到位 |\n| **综合** | **3.9** | **达到转正标准** |\n\n### 导师评语摘要\n"该实习生在实习期间表现出色，学习能力强，代码质量稳步提升。能独立完成分配的任务，与团队协作顺畅。建议转正。"\n\n### AI 综合建议\n✅ **建议转正**。该实习生在技术能力、学习能力和团队协作方面均达到转正标准。建议：\n1. 转正后安排参与到核心项目的开发中\n2. 提供更多系统性的技术培训\n3. 指定一个长期技术导师持续带教\n\n---\n\n*本报告由 AI 辅助生成，最终决定以导师和 HR 审核为准。*`;
}

function generateMockWeeklyEvaluation(userPrompt) {
  const nameMatch = userPrompt.match(/实习生[：:]\s*(\S+)/);
  const weekMatch = userPrompt.match(/第\s*(\d+)\s*周/);
  const internName = nameMatch ? nameMatch[1] : '同学';
  const week = weekMatch ? weekMatch[1] : '本';
  const scores = {
    taskCompletion: (60 + Math.floor(Math.random() * 35)),
    quality: (60 + Math.floor(Math.random() * 35)),
    initiative: (55 + Math.floor(Math.random() * 40)),
    communication: (65 + Math.floor(Math.random() * 30)),
    learning: (65 + Math.floor(Math.random() * 30)),
  };
  const avg = Math.round(Object.values(scores).reduce((a, b) => a + b, 0) / 5);
  const level = avg >= 90 ? 'S' : avg >= 80 ? 'A' : avg >= 70 ? 'B' : avg >= 60 ? 'C' : 'D';
  const levelDesc = { S: '卓越', A: '优秀', B: '良好', C: '合格', D: '待提升' };
  const bar = (score) => '█'.repeat(Math.round(score / 10)) + '░'.repeat(10 - Math.round(score / 10));
  return `## HR 每周评估报告 · 第${week}周\n\n### 📊 综合评级：${level}（${levelDesc[level]}）· 综合得分 ${avg}/100\n\n### 📈 五维能力雷达\n\n**任务完成度**：${scores.taskCompletion}/100\n${bar(scores.taskCompletion)}\n${scores.taskCompletion >= 80 ? '按时交付，超出预期' : '基本按时完成，偶有延期'}\n\n**代码/产出质量**：${scores.quality}/100\n${bar(scores.quality)}\n${scores.quality >= 80 ? '质量稳定，Review 问题少' : '偶尔出现低级错误，需加强自测'}\n\n**主动性**：${scores.initiative}/100\n${bar(scores.initiative)}\n${scores.initiative >= 80 ? '主动承担任务，积极沟通' : '基本能完成分配任务，主动性有待提升'}\n\n**沟通协作**：${scores.communication}/100\n${bar(scores.communication)}\n${scores.communication >= 80 ? '沟通顺畅，主动同步进度' : '建议多主动向导师汇报进展'}\n\n**学习能力**：${scores.learning}/100\n${bar(scores.learning)}\n${scores.learning >= 80 ? '上手快，能举一反三' : '学习节奏适中，建议加强技术沉淀'}\n\n### ✅ 本周亮点\n${scores.taskCompletion >= 75 ? '- 任务完成度高，在团队中表现积极' : '- 基本完成本周任务'}\n${scores.quality >= 75 ? '- 产出质量稳定，代码规范执行到位' : '- 产出质量符合预期，仍有提升空间'}\n${scores.learning >= 75 ? '- 学习效率高，新技术上手快' : '- 学习态度端正，建议加大自驱学习投入'}\n\n### 🔧 改进建议\n${scores.initiative < 75 ? '- 建议主动承担更多任务，展现ownership' : '- 继续保持积极主动的工作态度'}\n${scores.communication < 75 ? '- 建议增加与导师的沟通频率，每周至少同步1次进展' : '- 沟通习惯良好'}\n- 建议每周复盘时总结技术沉淀和可复用经验\n\n### 🎯 下周关注\n1. 继续完成当前迭代的开发任务\n2. 在代码质量上追求更高标准\n3. 主动参与团队技术分享和讨论\n\n---\n\n*本评估由 AI 基于实习生周报及工作记录辅助生成，供 HR 参考。最终以导师反馈为准。*`;
}

// ─── AI 配置（支持三种模式：mock / gemini / deepseek） ───
const aiConfig = {
  provider: 'mock',
  apiKey: process.env.LLM_API_KEY || '',
};

// ─── AI LLM 调用 ───
async function callLLM(systemPrompt, userPrompt) {
  const provider = aiConfig.provider;
  const apiKey = aiConfig.apiKey;

  if (provider === 'gemini') {
    return callGemini(systemPrompt, userPrompt, apiKey);
  }
  if (provider === 'deepseek') {
    return callDeepSeek(systemPrompt, userPrompt, apiKey);
  }

  // deepseek-v4 模式（原生 API 直调）
  if (provider === 'deepseek-v4') {
    return callDeepSeekV4(systemPrompt, userPrompt, apiKey);
  }

  return mockLLMResponse(systemPrompt, userPrompt);
}

async function callGemini(systemPrompt, userPrompt, apiKey) {
  if (!apiKey) return mockLLMResponse(systemPrompt, userPrompt);
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
    if (!res.ok) return mockLLMResponse(systemPrompt, userPrompt);
    const data = await res.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || mockLLMResponse(systemPrompt, userPrompt);
  } catch (err) {
    console.warn('[Gemini] Error:', err.message);
    return mockLLMResponse(systemPrompt, userPrompt);
  }
}

async function callDeepSeek(systemPrompt, userPrompt, apiKey) {
  if (!apiKey) return mockLLMResponse(systemPrompt, userPrompt);
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
    if (!res.ok) return mockLLMResponse(systemPrompt, userPrompt);
    const data = await res.json();
    return data?.choices?.[0]?.message?.content?.trim() || mockLLMResponse(systemPrompt, userPrompt);
  } catch (err) {
    console.warn('[DeepSeek] Error:', err.message);
    return mockLLMResponse(systemPrompt, userPrompt);
  }
}

async function callDeepSeekV4(systemPrompt, userPrompt, apiKey) {
  if (!apiKey) return mockLLMResponse(systemPrompt, userPrompt);
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
        max_tokens: 4096,
      })
    });
    if (!res.ok) return mockLLMResponse(systemPrompt, userPrompt);
    const data = await res.json();
    return data?.choices?.[0]?.message?.content?.trim() || mockLLMResponse(systemPrompt, userPrompt);
  } catch (err) {
    console.warn('[DeepSeekV4] Error:', err.message);
    return mockLLMResponse(systemPrompt, userPrompt);
  }
}

// ════════════════════════════════════════
// REST API 路由
// ════════════════════════════════════════

// ─── 健康检查 ───
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    mode: aiConfig.provider,
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

// 保存完整数据
app.post('/api/db/save', (req, res) => {
  try {
    const { db } = req.body;
    if (!db) return res.status(400).json({ success: false, error: '缺少 db 数据' });
    saveAppData({ _id: 'main', ...db });
    res.json({ success: true });
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

// ─── AI 配置 ───
app.get('/api/ai/config', (req, res) => {
  res.json({
    provider: aiConfig.provider,
    hasApiKey: !!aiConfig.apiKey,
    keyPreview: aiConfig.apiKey ? aiConfig.apiKey.slice(0, 8) + '...' : null,
  });
});

app.post('/api/ai/config', (req, res) => {
  const { provider, apiKey } = req.body;
  if (provider) aiConfig.provider = provider;
  if (apiKey !== undefined) aiConfig.apiKey = apiKey;
  res.json({ success: true, provider: aiConfig.provider });
});

// ─── 周报 ───
app.post('/api/ai/generate-report', async (req, res) => {
  const { internId, internName, mentorName, week, tasks, notes } = req.body;
  const systemPrompt = `你是一个专业的实习管理 AI 助手，负责为实习生生成周报。请根据提供的实习生信息和任务内容，生成一份结构完整、评价客观的周报。周报应包含：本周完成、能力雷达评价、亮点表现、待改进、下周计划。语气要温暖、鼓励但实事求是。使用中文 Markdown 格式输出。`;
  const userPrompt = `实习生：${internName || '同学'}\n第 ${week || 1} 周\n本周主要工作：${tasks || '尚未记录具体工作内容'}\n实习生自述：${notes || '无'}`;
  try {
    const content = await callLLM(systemPrompt, userPrompt);
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
  const { internId, internName, question, mode } = req.body;
  const systemPrompt = `你是一个实习 AI 助手，负责回答实习生的技术问题和职场困惑。如果问题简单明确，直接给出详细解答。如果问题需要导师介入决策，在回答末尾注明"需要导师介入"。你的语气要耐心、鼓励性，用中文回答。`;
  const userPrompt = `实习生 ${internName || '同学'} 的问题：${question || '无'}\n提问模式：${mode === 'anonymous' ? '匿名提问' : '实名提问'}`;
  try {
    const reply = await callLLM(systemPrompt, userPrompt);
    const needsMentor = reply.includes('需要导师介入') || reply.includes('需要导师进一步解答');
    const qa = {
      internId: mode === 'anonymous' ? 'anonymous' : internId,
      internName: mode === 'anonymous' ? '匿名同学' : internName,
      question, aiReply: reply,
      mentorReply: null, needsMentor,
      status: needsMentor ? 'waiting_mentor' : 'resolved',
      isAnonymous: mode === 'anonymous',
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

// ─── 成长回望 ───
app.post('/api/ai/generate-reflection', async (req, res) => {
  const { internId, internName, mentorName, daysInto } = req.body;
  const systemPrompt = `你是一个温暖的 AI 成长顾问。请为实习生生成一份"成长回望"报告。报告要以第二人称"你"来写，回顾实习以来的成长历程。包含：时间线回顾、导师曾经的评价、以及一封五年后的自己写给现在的信。语气温暖、真诚、有力量。使用中文 Markdown 格式。`;
  const userPrompt = `实习生：${internName || '同学'}\n导师：${mentorName || '导师'}\n已实习天数：${daysInto || 45} 天`;
  try {
    const content = await callLLM(systemPrompt, userPrompt);
    const reflection = { internId, internName, content, daysInto: daysInto || 45 };
    const saved = addToCollection('reflections', reflection);
    res.json({ success: true, reflection: saved });
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

// ─── 转正评估 ───
app.post('/api/ai/generate-evaluation', async (req, res) => {
  const { internId, internName } = req.body;
  const internReports = getCollection('reports', { internId });
  const internQuestions = getCollection('questions', { internId });
  const systemPrompt = `你是一个专业的 HR 评估助手。请根据实习生的周报数据、提问记录等信息，生成一份转正评估报告。包含：能力维度评分、导师评语摘要、转正建议。评分客观公正，评语具体有依据。使用中文 Markdown 格式。`;
  const userPrompt = `实习生：${internName || '同学'}\n周报数量：${internReports.length}\n提问次数：${internQuestions.length}\n数据概览：${JSON.stringify({ reports: internReports.length, questions: internQuestions.length })}`;
  try {
    const content = await callLLM(systemPrompt, userPrompt);
    res.json({ success: true, evaluation: { content, generatedAt: new Date().toISOString() } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── 每周评估 ───
app.post('/api/ai/generate-weekly-evaluation', async (req, res) => {
  const { internId, internName, week, tasks, notes } = req.body;
  const internReports = getCollection('reports', { internId });
  const systemPrompt = `你是一个专业的实习评估助手，负责为实习生生成每周评估报告。评估报告应包含：综合评级（S/A/B/C/D）、五维能力雷达（任务完成度/产出质量/主动性/沟通协作/学习能力）、本周亮点、改进建议、下周关注。注意：评分不应全部偏高，要有区分度。语气专业、客观、有建设性。使用中文 Markdown 格式。`;
  const userPrompt = `实习生：${internName || '同学'}\n第 ${week || 1} 周\n本周主要工作：${tasks || '参与日常开发任务'}\n实习生自述：${notes || '无'}\n已有周报数量：${internReports.length}`;
  try {
    const content = await callLLM(systemPrompt, userPrompt);
    const evaluation = { internId, internName, week: week || 1, content };
    const saved = addToCollection('evaluations', evaluation);
    res.json({ success: true, evaluation: saved });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/ai/evaluations', (req, res) => {
  const { internId } = req.query;
  let list = getCollection('evaluations');
  if (internId) {
    list = list.filter(item => item.internId === internId);
  }
  res.json({ success: true, evaluations: list });
});

// ─── 启动服务器 ───
app.listen(PORT, () => {
  const modeLabel = {
    mock: '模拟模式（零成本）',
    gemini: 'Google Gemini API',
    deepseek: 'DeepSeek API',
    'deepseek-v4': 'DeepSeek V4 API',
  };
  console.log(`\n🚀 实习加油站 - 本地服务已启动！`);
  console.log(`📡 地址: http://localhost:${PORT}`);
  console.log(`🤖 AI 模式: ${modeLabel[aiConfig.provider] || aiConfig.provider}`);
  console.log(`🔑 API Key: ${aiConfig.apiKey ? '已配置' : '未配置（将使用 mock 回退）'}`);
  console.log(`💡 支持模式: mock / gemini / deepseek`);
  console.log(`🗄️  数据库: JSON 文件 (db.json + collections.json) - 浏览器清缓存不影响数据\n`);
});
