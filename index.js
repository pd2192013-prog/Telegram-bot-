// =========================================================
// TELEGRAM MATH BOT — Cloudflare Worker (single file)
// XKIRO API + ADMIN PANEL + TELEGRAM STARS PAYMENTS
// =========================================================

const BOT_TOKEN_FALLBACK = "YAHAN_APNA_TELEGRAM_BOT_TOKEN_DALEIN";
const XKIRO_API_KEY_FALLBACK = "YAHAN_APNI_XKIRO_API_KEY_DALEIN";
const XKIRO_MODEL_FALLBACK = "openai/gpt-4o";
const ADMIN_ID_FALLBACK = "admin";
const ADMIN_PASSWORD_FALLBACK = "change_this_password";

function getConfig(env) {
  return {
    BOT_TOKEN: (env && env.BOT_TOKEN) || BOT_TOKEN_FALLBACK,
    XKIRO_API_KEY: (env && env.XKIRO_API_KEY) || XKIRO_API_KEY_FALLBACK,
    XKIRO_MODEL: (env && env.XKIRO_MODEL) || XKIRO_MODEL_FALLBACK,
    ADMIN_ID: (env && env.ADMIN_ID) || ADMIN_ID_FALLBACK,
    ADMIN_PASSWORD: (env && env.ADMIN_PASSWORD) || ADMIN_PASSWORD_FALLBACK,
  };
}

const RATE_LIMIT_COUNT = 15;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

const UNIT_MS = {
  second: 1000,
  minute: 60 * 1000,
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
  year: 365 * 24 * 60 * 60 * 1000,
};

const NON_MATH_REPLY = "मैं केवल गणित के सवाल हल कर सकता हूँ, कृपया गणित से जुड़ा सवाल लिखकर पूछें।";
const GENERIC_ERROR_REPLY = "क्षमा कीजिए, अभी उत्तर तैयार करने में समस्या आई है। कृपया थोड़ी देर बाद पुनः प्रयास करें।";
const BLOCKED_REPLY = "आपको इस बॉट का उपयोग करने से रोक दिया गया है। कृपया एडमिन से संपर्क करें।";
const NO_IMAGE_PLAN_REPLY = "फोटो भेजकर सवाल पूछने के लिए एक ऐसा प्लान खरीदना होगा जिसमें फोटो सुविधा शामिल हो। प्लान देखने के लिए /plans भेजें।";
const IMAGE_NOT_ENABLED_REPLY = "आपके मौजूदा प्लान में फोटो सुविधा शामिल नहीं है। दूसरे प्लान देखने के लिए /plans भेजें।";

const DEFAULT_LIMIT_MESSAGE = "आपकी सवाल पूछने की सीमा ({count} सवाल) समाप्त हो चुकी है। यह सीमा {resetTime} को रीसेट होगी।";
const DEFAULT_START_MESSAGE = "नमस्ते! मुझसे केवल गणित के सवाल पूछिए, मैं चरण-दर-चरण हल बताऊँगा।\nआप हर {windowText} में केवल {count} सवाल पूछ सकते हैं।\nज़्यादा सवाल/फोटो सुविधा वाले प्लान देखने के लिए /plans भेजें।";

const SYSTEM_PROMPT = `तुम एक ऐसा सहायक हो जो केवल गणित (Mathematics) के सवालों के उत्तर देता है, बिल्कुल एक school ki NCERT/Reference textbook ke solution jaisa.

नियम (इन सभी का सख्ती से पालन करो):

1. अगर उपयोगकर्ता का सवाल गणित (अंकगणित, बीजगणित, ज्यामिति, त्रिकोणमिति, कैलकुलस, सांख्यिकी आदि) से संबंधित नहीं है, तो सिर्फ और सिर्फ यही उत्तर दो, कोई अतिरिक्त शब्द मत लिखो:
"${NON_MATH_REPLY}"

2. अगर सवाल गणित का है, तो जवाब बिल्कुल Telegram पर सीधा पढ़े जाने लायक plain text में लिखो — jaise ek copy me haath se likha hua solution hota hai। नीचे दिए गए FORMAT RULES को 100% follow karo, ek bhi exception nahi:

FORMAT RULES (bahut zaroori, kabhi mat todna):
   - LaTeX code KABHI mat likho। Ye sab bilkul use mat karo: \\frac, \\neq, \\overline, \\boxed, \\quad, \\sqrt, \\pi, $, $$, ^{}, _{}, \\left, \\right, ya koi bhi backslash-command.
   - Markdown table (| | | ya |---|---|) KABHI mat banao।
   - Markdown heading (#, ##) ya bold markers (**, __) KABHI mat use karo।
   - Fraction hamesha simple slash se likho, jaise p/q, 3/4, 195°/3.
   - Ye normal keyboard/unicode symbols hi use karo: + - × ÷ = ° ∠ △ √ π ≠ ⇒ ∵ ∴ ± ≤ ≥
   - Har equation/step ek naya line par likho, jaise textbook me hota hai।
   - Agar ek se zyada equation number karni ho to "...(1)", "...(2)" jaisa likh sakte ho।
   - Solution ka structure simple plain labels se banao (bina # ya ** ke): हल:, अंतिम उत्तर:

3. भाषा हमेशा शुद्ध और स्पष्ट हिंदी में रखो। गणितीय संख्याएँ और चिन्ह (जैसे x, y, +, =) अंग्रेज़ी में ही रहेंगे, बाकी पूरा विवरण शुद्ध हिंदी में लिखो।

4. सिर्फ गणित का हल दो, कोई अनावश्यक बातचीत मत करो। कोई intro/outro sentence mat likho, seedha "हल:" se shuru karo।`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---- Telegram helpers ----
async function tgCall(env, method, payload) {
  const { BOT_TOKEN } = getConfig(env);
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return await res.json();
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function sendMessage(env, chatId, text, extra) {
  return tgCall(env, "sendMessage", Object.assign({ chat_id: chatId, text }, extra || {}));
}

async function sendTyping(env, chatId) {
  try {
    await tgCall(env, "sendChatAction", { chat_id: chatId, action: "typing" });
  } catch (e) {
    // ignore
  }
}

async function askXkiroWithTyping(env, chatId, question) {
  let finished = false;
  const p = askXkiro(env, question).then((res) => { finished = true; return res; });
  (async () => {
    while (!finished) {
      await sendTyping(env, chatId);
      await sleep(4000);
    }
  })();
  return p;
}

async function askXkiroImageWithTyping(env, chatId, base64Image, caption) {
  let finished = false;
  const p = askXkiroImage(env, base64Image, caption).then((res) => { finished = true; return res; });
  (async () => {
    while (!finished) {
      await sendTyping(env, chatId);
      await sleep(4000);
    }
  })();
  return p;
}

function formatResetTime(timestampMs) {
  const date = new Date(timestampMs);
  return date.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: true,
    day: "2-digit", month: "2-digit", year: "numeric",
  });
}

function formatDuration(ms) {
  if (ms >= UNIT_MS.year && ms % UNIT_MS.year === 0) return `${ms / UNIT_MS.year} साल`;
  if (ms >= UNIT_MS.month && ms % UNIT_MS.month === 0) return `${ms / UNIT_MS.month} महीने`;
  if (ms >= UNIT_MS.day && ms % UNIT_MS.day === 0) return `${ms / UNIT_MS.day} दिन`;
  if (ms >= UNIT_MS.hour && ms % UNIT_MS.hour === 0) return `${ms / UNIT_MS.hour} घंटे`;
  if (ms >= UNIT_MS.minute && ms % UNIT_MS.minute === 0) return `${ms / UNIT_MS.minute} मिनट`;
  return `${Math.round(ms / 1000)} सेकंड`;
}

function fillTemplate(template, vars) {
  let out = template;
  for (const k in vars) {
    out = out.split(`{${k}}`).join(String(vars[k]));
  }
  return out;
}

// =========================================================
// LIVE CONFIG (KV se)
// =========================================================
async function getEffectiveModel(env) {
  try {
    const m = await env.MATH_BOT_KV.get("cfg:model");
    if (m) return m;
  } catch (e) {}
  return getConfig(env).XKIRO_MODEL;
}

async function getEffectiveRateLimit(env) {
  let count = RATE_LIMIT_COUNT, windowMs = RATE_LIMIT_WINDOW_MS;
  try {
    const c = await env.MATH_BOT_KV.get("cfg:rateLimitCount");
    if (c) count = parseInt(c, 10);
    const w = await env.MATH_BOT_KV.get("cfg:rateLimitWindowMs");
    if (w) windowMs = parseInt(w, 10);
  } catch (e) {}
  return { count, windowMs };
}

async function getEffectiveLimitMessage(env) {
  try {
    const m = await env.MATH_BOT_KV.get("cfg:limitMessage");
    if (m) return m;
  } catch (e) {}
  return DEFAULT_LIMIT_MESSAGE;
}

async function getEffectiveStartMessage(env) {
  try {
    const m = await env.MATH_BOT_KV.get("cfg:startMessage");
    if (m) return m;
  } catch (e) {}
  return DEFAULT_START_MESSAGE;
}

async function getStarterPlanId(env) {
  try {
    return await env.MATH_BOT_KV.get("cfg:starterPlanId");
  } catch (e) {
    return null;
  }
}

// =========================================================
// USER RECORDS (KV: key = "user:<userId>")
// =========================================================
async function getUserRecord(env, userId) {
  const key = `user:${userId}`;
  let rec = null, isNew = false;
  try {
    const raw = await env.MATH_BOT_KV.get(key);
    rec = raw ? JSON.parse(raw) : null;
  } catch (e) { rec = null; }
  if (!rec) {
    isNew = true;
    const now = Date.now();
    rec = {
      blocked: false,
      planLimit: null, planWindowMs: null, planExpiresAt: null, planName: null,
      planImageEnabled: false, planImageLimit: 0,
      windowStart: now, windowCount: 0,
      imageWindowStart: now, imageWindowCount: 0,
      totalMessages: 0, firstSeen: now, lastActive: now,
      firstName: "", username: "", starsSpent: 0,
    };
  }
  return { rec, isNew };
}

async function saveUserRecord(env, userId, rec) {
  const key = `user:${userId}`;
  try {
    await env.MATH_BOT_KV.put(key, JSON.stringify(rec), {
      metadata: {
        blocked: !!rec.blocked,
        totalMessages: rec.totalMessages || 0,
        lastActive: rec.lastActive || 0,
        planExpiresAt: rec.planExpiresAt || null,
        planLimit: rec.planLimit || null,
        planWindowMs: rec.planWindowMs || null,
        planName: rec.planName || null,
        firstName: rec.firstName || "",
        username: rec.username || "",
        starsSpent: rec.starsSpent || 0,
      },
    });
  } catch (e) {}
}

async function listAllUserKeys(env) {
  let cursor = undefined, allKeys = [];
  do {
    const res = await env.MATH_BOT_KV.list({ prefix: "user:", cursor });
    allKeys = allKeys.concat(res.keys);
    cursor = res.list_complete ? undefined : res.cursor;
  } while (cursor);
  return allKeys;
}

// ---- Plan ko user par apply karna (admin assign + Stars purchase + starter plan, sab yahi use karte hain) ----
function applyPlanToRecord(rec, plan) {
  const now = Date.now();
  const windowMs = plan.windowValue * UNIT_MS[plan.windowUnit];
  const validityMs = plan.validityValue * UNIT_MS[plan.validityUnit];
  rec.planLimit = plan.limit;
  rec.planWindowMs = windowMs;
  rec.planExpiresAt = now + validityMs;
  rec.planName = plan.name;
  rec.planImageEnabled = !!plan.imageEnabled;
  rec.planImageLimit = plan.imageLimit || 0;
  rec.windowStart = now;
  rec.windowCount = 0;
  rec.imageWindowStart = now;
  rec.imageWindowCount = 0;
  return rec;
}

// ---- Rate limiting + block check ----
async function checkRateLimit(env, userId, from) {
  const now = Date.now();
  const { rec, isNew } = await getUserRecord(env, userId);

  if (from) {
    rec.firstName = from.first_name || rec.firstName || "";
    rec.username = from.username || rec.username || "";
  }

  if (isNew) {
    const starterId = await getStarterPlanId(env);
    if (starterId) {
      const plan = await getPlanById(env, starterId);
      if (plan) applyPlanToRecord(rec, plan);
    }
  }

  if (rec.blocked) {
    await saveUserRecord(env, userId, rec);
    return { allowed: false, blocked: true };
  }

  let limitCount, windowMs;
  const planActive = rec.planExpiresAt && rec.planExpiresAt > now && rec.planLimit && rec.planWindowMs;

  if (planActive) {
    limitCount = rec.planLimit;
    windowMs = rec.planWindowMs;
  } else {
    if (rec.planExpiresAt && rec.planExpiresAt <= now) {
      rec.planLimit = null; rec.planWindowMs = null; rec.planExpiresAt = null;
      rec.planName = null; rec.planImageEnabled = false; rec.planImageLimit = 0;
    }
    const defaults = await getEffectiveRateLimit(env);
    limitCount = defaults.count;
    windowMs = defaults.windowMs;
  }

  if (now - rec.windowStart >= windowMs) {
    rec.windowStart = now;
    rec.windowCount = 0;
  }

  if (rec.windowCount >= limitCount) {
    await saveUserRecord(env, userId, rec);
    return { allowed: false, resetTime: rec.windowStart + windowMs, limitCount };
  }

  rec.windowCount += 1;
  rec.totalMessages = (rec.totalMessages || 0) + 1;
  rec.lastActive = now;
  await saveUserRecord(env, userId, rec);

  return { allowed: true };
}

// ---- Image question quota check ----
async function checkImageQuota(env, userId) {
  const now = Date.now();
  const { rec } = await getUserRecord(env, userId);

  if (rec.blocked) return { allowed: false, reason: "blocked" };

  const planActive = rec.planExpiresAt && rec.planExpiresAt > now && rec.planLimit && rec.planWindowMs;
  if (!planActive) return { allowed: false, reason: "no_plan" };
  if (!rec.planImageEnabled) return { allowed: false, reason: "not_enabled" };

  if (now - rec.imageWindowStart >= rec.planWindowMs) {
    rec.imageWindowStart = now;
    rec.imageWindowCount = 0;
  }

  if (rec.imageWindowCount >= rec.planImageLimit) {
    await saveUserRecord(env, userId, rec);
    return { allowed: false, reason: "quota", resetTime: rec.imageWindowStart + rec.planWindowMs, limitCount: rec.planImageLimit };
  }

  rec.imageWindowCount += 1;
  rec.lastActive = now;
  await saveUserRecord(env, userId, rec);
  return { allowed: true };
}

// =========================================================
// PLAN TEMPLATES (KV: key = "plan:<planId>")
// =========================================================
async function getAllPlans(env) {
  const list = await env.MATH_BOT_KV.list({ prefix: "plan:" });
  const plans = [];
  for (const k of list.keys) {
    try {
      const raw = await env.MATH_BOT_KV.get(k.name);
      if (raw) plans.push(JSON.parse(raw));
    } catch (e) {}
  }
  return plans;
}

async function getPlanById(env, planId) {
  try {
    const raw = await env.MATH_BOT_KV.get(`plan:${planId}`);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

async function savePlan(env, plan) {
  await env.MATH_BOT_KV.put(`plan:${plan.id}`, JSON.stringify(plan));
}

async function deletePlanById(env, planId) {
  await env.MATH_BOT_KV.delete(`plan:${planId}`);
}

// =========================================================
// CHAT HISTORY LOG (7 din tak, KV: key = "log:<userId>")
// =========================================================
async function appendChatLog(env, userId, question, answer) {
  const key = `log:${userId}`;
  let arr = [];
  try {
    const raw = await env.MATH_BOT_KV.get(key);
    arr = raw ? JSON.parse(raw) : [];
  } catch (e) { arr = []; }
  const now = Date.now();
  arr.push({ ts: now, q: question, a: answer });
  arr = arr.filter((e) => now - e.ts < SEVEN_DAYS_MS);
  if (arr.length > 200) arr = arr.slice(arr.length - 200);
  try {
    await env.MATH_BOT_KV.put(key, JSON.stringify(arr), { expirationTtl: Math.ceil(SEVEN_DAYS_MS / 1000) + 86400 });
  } catch (e) {}
}

async function getChatLog(env, userId) {
  try {
    const raw = await env.MATH_BOT_KV.get(`log:${userId}`);
    const arr = raw ? JSON.parse(raw) : [];
    const now = Date.now();
    return arr.filter((e) => now - e.ts < SEVEN_DAYS_MS);
  } catch (e) {
    return [];
  }
}

// =========================================================
// PAYMENTS LOG (Telegram Stars)
// =========================================================
async function logPayment(env, userId, plan, stars) {
  const key = "log:payments";
  let arr = [];
  try {
    const raw = await env.MATH_BOT_KV.get(key);
    arr = raw ? JSON.parse(raw) : [];
  } catch (e) { arr = []; }
  arr.push({ ts: Date.now(), userId, planName: plan.name, stars });
  if (arr.length > 500) arr = arr.slice(arr.length - 500);
  try {
    await env.MATH_BOT_KV.put(key, JSON.stringify(arr));
  } catch (e) {}

  try {
    const cur = parseInt((await env.MATH_BOT_KV.get("stats:totalStars")) || "0", 10);
    await env.MATH_BOT_KV.put("stats:totalStars", String(cur + stars));
  } catch (e) {}
}

async function getPaymentsLog(env) {
  try {
    const raw = await env.MATH_BOT_KV.get("log:payments");
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

async function getTotalStars(env) {
  try {
    return parseInt((await env.MATH_BOT_KV.get("stats:totalStars")) || "0", 10);
  } catch (e) {
    return 0;
  }
}

// =========================================================
// XKIRO API CALLS
// =========================================================
async function askXkiro(env, question) {
  const { XKIRO_API_KEY } = getConfig(env);
  const XKIRO_MODEL = await getEffectiveModel(env);
  try {
    const res = await fetch("https://api.xkiro.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${XKIRO_API_KEY}` },
      body: JSON.stringify({
        model: XKIRO_MODEL,
        messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: question }],
      }),
    });
    const data = await res.json();
    if (!res.ok) return `DEBUG ERROR (status ${res.status}): ${JSON.stringify(data)}`;
    const text = data?.choices?.[0]?.message?.content;
    return text ? text.trim() : GENERIC_ERROR_REPLY;
  } catch (err) {
    return `DEBUG FETCH ERROR: ${err.message}`;
  }
}

async function askXkiroImage(env, base64Image, caption) {
  const { XKIRO_API_KEY } = getConfig(env);
  const XKIRO_MODEL = await getEffectiveModel(env);
  try {
    const res = await fetch("https://api.xkiro.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${XKIRO_API_KEY}` },
      body: JSON.stringify({
        model: XKIRO_MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              { type: "text", text: caption || "इस फोटो में दिए गणित के सवाल को हल करो।" },
              { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Image}` } },
            ],
          },
        ],
      }),
    });
    const data = await res.json();
    if (!res.ok) return `DEBUG ERROR (status ${res.status}): ${JSON.stringify(data)}`;
    const text = data?.choices?.[0]?.message?.content;
    return text ? text.trim() : GENERIC_ERROR_REPLY;
  } catch (err) {
    return `DEBUG FETCH ERROR: ${err.message}`;
  }
}

// ---- Telegram se photo ka file base64 me download karna ----
async function getTelegramFileAsBase64(env, fileId) {
  const { BOT_TOKEN } = getConfig(env);
  const fileInfo = await tgCall(env, "getFile", { file_id: fileId });
  if (!fileInfo.ok) throw new Error("getFile failed: " + JSON.stringify(fileInfo));
  const filePath = fileInfo.result.file_path;
  const res = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`);
  const buf = await res.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// =========================================================
// TELEGRAM STARS PAYMENTS
// =========================================================
async function sendInvoiceStars(env, chatId, plan) {
  const desc =
    `${plan.limit} सवाल हर ${plan.windowValue} ${plan.windowUnit}\n` +
    `Validity: ${plan.validityValue} ${plan.validityUnit}` +
    (plan.imageEnabled ? `\nफोटो सवाल: ${plan.imageLimit} प्रति ${plan.windowValue} ${plan.windowUnit}` : "");
  return tgCall(env, "sendInvoice", {
    chat_id: chatId,
    title: plan.name,
    description: desc,
    payload: JSON.stringify({ planId: plan.id }),
    currency: "XTR",
    prices: [{ label: plan.name, amount: plan.stars }],
    provider_token: "",
  });
}

async function handleSuccessfulPayment(env, chatId, userId, successfulPayment) {
  try {
    const payload = JSON.parse(successfulPayment.invoice_payload);
    const plan = await getPlanById(env, payload.planId);
    if (!plan) {
      await sendMessage(env, chatId, "भुगतान मिल गया, लेकिन प्लान अब उपलब्ध नहीं है। कृपया एडमिन से संपर्क करें।");
      return;
    }
    const { rec } = await getUserRecord(env, userId);
    applyPlanToRecord(rec, plan);
    rec.starsSpent = (rec.starsSpent || 0) + successfulPayment.total_amount;
    await saveUserRecord(env, userId, rec);
    await logPayment(env, userId, plan, successfulPayment.total_amount);
    await sendMessage(
      env,
      chatId,
      `भुगतान सफल ✅\n"${plan.name}" प्लान सक्रिय हो गया है।\nअब आप ${plan.limit} सवाल हर ${plan.windowValue} ${plan.windowUnit} पूछ सकते हैं, यह ${plan.validityValue} ${plan.validityUnit} तक मान्य रहेगा।`
    );
  } catch (e) {
    await sendMessage(env, chatId, "भुगतान प्रोसेस करने में समस्या आई, कृपया एडमिन से संपर्क करें।");
  }
}

// =========================================================
// ADMIN AUTH
// =========================================================
function isAdminAuthorized(request, env) {
  const { ADMIN_ID, ADMIN_PASSWORD } = getConfig(env);
  const id = request.headers.get("x-admin-id") || "";
  const pass = request.headers.get("x-admin-password") || "";
  return Boolean(ADMIN_ID) && Boolean(ADMIN_PASSWORD) && id === ADMIN_ID && pass === ADMIN_PASSWORD;
}

function jsonResponse(obj, status) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: { "Content-Type": "application/json" } });
}

// =========================================================
// ADMIN PANEL HTML
// =========================================================
const ADMIN_PAGE_HTML = `<!DOCTYPE html>
<html lang="hi">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Math Bot — Admin Panel</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: system-ui, Arial, sans-serif; background: #0f172a; color: #e2e8f0; margin: 0; padding: 20px; }
  h1 { font-size: 20px; margin-bottom: 4px; }
  h2 { font-size: 16px; margin: 24px 0 10px; color: #93c5fd; }
  .card { background: #1e293b; border-radius: 10px; padding: 16px; margin-bottom: 16px; }
  input, select, textarea, button { font-size: 14px; padding: 8px 10px; border-radius: 6px; border: 1px solid #334155; background: #0f172a; color: #e2e8f0; }
  textarea { width: 100%; min-height: 60px; }
  button { background: #2563eb; border: none; cursor: pointer; font-weight: 600; }
  button:hover { background: #1d4ed8; }
  button.danger { background: #dc2626; }
  button.danger:hover { background: #b91c1c; }
  button.secondary { background: #475569; }
  label { font-size: 13px; color: #cbd5e1; }
  .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin: 6px 0; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #334155; white-space: nowrap; }
  #loginBox { max-width: 340px; margin: 80px auto; }
  #dash { display: none; }
  .stat { display: inline-block; background: #0f172a; border: 1px solid #334155; border-radius: 8px; padding: 10px 16px; margin-right: 10px; }
  .stat b { font-size: 20px; display: block; color: #60a5fa; }
  .msg { font-size: 13px; margin-top: 8px; }
  .msg.ok { color: #4ade80; }
  .msg.err { color: #f87171; }
  .tag { padding: 2px 6px; border-radius: 4px; font-size: 11px; }
  .tag.blocked { background: #7f1d1d; color: #fecaca; }
  .tag.active { background: #14532d; color: #bbf7d0; }
  .tag.free { background: #334155; color: #cbd5e1; }
  .chatbubble { background: #0f172a; border-radius: 8px; padding: 8px 10px; margin: 6px 0; font-size: 13px; }
  .chatbubble .time { color: #64748b; font-size: 11px; }
  input[type=checkbox] { width: auto; }
</style>
</head>
<body>

<div id="loginBox" class="card">
  <h1>🔐 Admin Login</h1>
  <div class="row"><input id="loginId" placeholder="Admin ID" style="width:100%"></div>
  <div class="row"><input id="loginPass" type="password" placeholder="Password" style="width:100%"></div>
  <div class="row"><button onclick="doLogin()" style="width:100%">Login</button></div>
  <div id="loginMsg" class="msg"></div>
</div>

<div id="dash">
  <h1>📊 Math Bot — Admin Panel</h1>
  <div class="row">
    <div class="stat"><b id="statUsers">-</b>Total Users</div>
    <div class="stat"><b id="statMessages">-</b>Total Messages</div>
    <div class="stat"><b id="statStars">-</b>⭐ Total Stars Earned</div>
    <button class="secondary" onclick="loadAll()">🔄 Refresh</button>
    <button class="secondary" onclick="logout()">Logout</button>
  </div>

  <div class="card">
    <h2>⚙️ Global Config</h2>
    <div class="row">
      <label>Model:</label>
      <input id="cfgModel" placeholder="jaise openai/gpt-4o" style="width:220px">
    </div>
    <div class="row">
      <label>Free limit:</label>
      <input id="cfgCount" type="number" style="width:80px"> messages /
      <input id="cfgWindowVal" type="number" style="width:70px">
      <select id="cfgWindowUnit">
        <option value="second">second</option><option value="minute">minute</option>
        <option value="hour" selected>hour</option><option value="day">day</option>
        <option value="month">month</option><option value="year">year</option>
      </select>
    </div>
    <div class="row">
      <label>Naye user ko auto starter plan:</label>
      <select id="cfgStarterPlan"><option value="">-- Koi nahi (free hi) --</option></select>
    </div>
    <div class="row" style="flex-direction:column; align-items:flex-start;">
      <label>Limit khatam hone par message (placeholders: {count} {resetTime}):</label>
      <textarea id="cfgLimitMessage" style="width:100%"></textarea>
    </div>
    <div class="row" style="flex-direction:column; align-items:flex-start;">
      <label>/start message (placeholders: {count} {windowText}):</label>
      <textarea id="cfgStartMessage" style="width:100%"></textarea>
    </div>
    <div class="row"><button onclick="saveConfig()">Save Config</button></div>
    <div id="configMsg" class="msg"></div>
  </div>

  <div class="card">
    <h2>📦 Plans (banayein / edit karein, Telegram Stars price ke saath)</h2>
    <div class="row">
      Naam: <input id="planFormName" placeholder="jaise Gold Plan" style="width:130px">
      ⭐ Stars: <input id="planFormStars" type="number" placeholder="50" style="width:70px">
      ₹ Price (reference): <input id="planFormPrice" type="number" placeholder="99" style="width:70px">
    </div>
    <div class="row">
      Limit: <input id="planFormLimit" type="number" style="width:70px"> messages har
      <input id="planFormWindowVal" type="number" style="width:70px">
      <select id="planFormWindowUnit">
        <option value="second">second</option><option value="minute">minute</option>
        <option value="hour">hour</option><option value="day" selected>day</option>
        <option value="month">month</option><option value="year">year</option>
      </select>
    </div>
    <div class="row">
      Validity: <input id="planFormValidityVal" type="number" style="width:70px">
      <select id="planFormValidityUnit">
        <option value="second">second</option><option value="minute">minute</option>
        <option value="hour">hour</option><option value="day">day</option>
        <option value="month" selected>month</option><option value="year">year</option>
      </select>
    </div>
    <div class="row">
      <input type="checkbox" id="planFormImageEnabled"> <label for="planFormImageEnabled">फोटो से सवाल पूछने दो</label>
      Image limit: <input id="planFormImageLimit" type="number" style="width:70px" value="0">
    </div>
    <div class="row">
      <button onclick="savePlanForm()" id="planFormSaveBtn">Plan Banayein</button>
      <button class="secondary" onclick="resetPlanForm()">Cancel Edit</button>
    </div>
    <div id="planMsg" class="msg"></div>
    <table style="margin-top:10px;">
      <thead><tr><th>Naam</th><th>⭐</th><th>Limit</th><th>Validity</th><th>Image</th><th></th></tr></thead>
      <tbody id="plansBody"></tbody>
    </table>
  </div>

  <div class="card">
    <h2>📢 Broadcast</h2>
    <div class="row">
      Kisko bhejein:
      <select id="broadcastFilter"><option value="">Sabhi Users</option></select>
    </div>
    <textarea id="broadcastText" placeholder="Message likhein..."></textarea>
    <div class="row"><button onclick="sendBroadcast()">Broadcast Bhejo</button></div>
    <div id="broadcastMsg" class="msg"></div>
  </div>

  <div class="card">
    <h2>👤 Specific User Actions</h2>
    <div class="row">
      <input id="targetUserId" placeholder="User ID" style="width:160px">
    </div>
    <div class="row">
      <button onclick="toggleBlock(true)" class="danger">Block</button>
      <button onclick="toggleBlock(false)">Unblock</button>
      <button class="danger" onclick="deleteUser()">Hataye (Delete)</button>
      <button class="secondary" onclick="resetUserPlan()">Free Plan par Reset</button>
      <button class="secondary" onclick="viewHistory()">📜 7-din History Dekhein</button>
    </div>
    <div class="row">
      <textarea id="specificMsgText" placeholder="Is user ko specific message bhejein..."></textarea>
    </div>
    <div class="row"><button onclick="sendSpecificMessage()">Message Bhejo</button></div>

    <h2 style="margin-top:18px;">💳 Plan Assign Karein</h2>
    <div class="row">
      <select id="assignPlanSelect" style="min-width:200px"><option value="">-- Plan Chunein --</option></select>
      <button onclick="assignPlan()">User ko Assign Karo</button>
    </div>
    <div id="userActionMsg" class="msg"></div>
    <div id="historyBox" style="margin-top:10px; max-height:300px; overflow-y:auto;"></div>
  </div>

  <div class="card">
    <h2>💰 Payments (Telegram Stars)</h2>
    <table>
      <thead><tr><th>Date</th><th>User ID</th><th>Plan</th><th>⭐ Stars</th></tr></thead>
      <tbody id="paymentsBody"></tbody>
    </table>
  </div>

  <div class="card">
    <h2>📋 Users List</h2>
    <div class="row">
      <input id="searchBox" placeholder="ID/naam se search karein" style="width:220px" oninput="renderUsers()">
      <button class="secondary" onclick="exportCSV()">⬇️ CSV Export</button>
    </div>
    <div style="overflow-x:auto;">
      <table>
        <thead><tr><th>User ID</th><th>Naam</th><th>Status</th><th>Plan</th><th>Total Msgs</th><th>⭐ Spent</th><th>Last Active</th></tr></thead>
        <tbody id="usersBody"></tbody>
      </table>
    </div>
  </div>
</div>

<script>
let creds = null;
let allUsers = [];
let allPlans = [];
let editingPlanId = null;

function authHeaders() {
  return { "Content-Type": "application/json", "X-Admin-Id": creds.id, "X-Admin-Password": creds.pass };
}

async function doLogin() {
  const id = document.getElementById('loginId').value.trim();
  const pass = document.getElementById('loginPass').value;
  creds = { id, pass };
  const r = await fetch('/admin/api/stats', { headers: authHeaders() });
  if (r.status === 200) {
    localStorage.setItem('mb_admin_id', id);
    localStorage.setItem('mb_admin_pass', pass);
    document.getElementById('loginBox').style.display = 'none';
    document.getElementById('dash').style.display = 'block';
    loadAll();
  } else {
    document.getElementById('loginMsg').innerHTML = '<span class="err">Galat ID ya Password</span>';
  }
}

function logout() {
  localStorage.removeItem('mb_admin_id');
  localStorage.removeItem('mb_admin_pass');
  creds = null;
  document.getElementById('dash').style.display = 'none';
  document.getElementById('loginBox').style.display = 'block';
}

async function loadAll() {
  await loadStats();
  await loadPlans();
  await loadConfig();
  await loadUsers();
  await loadPayments();
}

async function loadStats() {
  const r = await fetch('/admin/api/stats', { headers: authHeaders() });
  const d = await r.json();
  document.getElementById('statUsers').textContent = d.totalUsers;
  document.getElementById('statMessages').textContent = d.totalMessages;
  document.getElementById('statStars').textContent = d.totalStars;
}

async function loadConfig() {
  const r = await fetch('/admin/api/config', { headers: authHeaders() });
  const d = await r.json();
  document.getElementById('cfgModel').value = d.model || '';
  document.getElementById('cfgCount').value = d.rateLimitCount;
  document.getElementById('cfgWindowVal').value = d.windowValue;
  document.getElementById('cfgWindowUnit').value = d.windowUnit;
  document.getElementById('cfgLimitMessage').value = d.limitMessage || '';
  document.getElementById('cfgStartMessage').value = d.startMessage || '';

  const sel = document.getElementById('cfgStarterPlan');
  sel.innerHTML = '<option value="">-- Koi nahi (free hi) --</option>';
  allPlans.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id; opt.textContent = p.name;
    if (p.id === d.starterPlanId) opt.selected = true;
    sel.appendChild(opt);
  });
}

async function saveConfig() {
  const body = {
    model: document.getElementById('cfgModel').value.trim(),
    rateLimitCount: parseInt(document.getElementById('cfgCount').value, 10),
    windowValue: parseFloat(document.getElementById('cfgWindowVal').value),
    windowUnit: document.getElementById('cfgWindowUnit').value,
    limitMessage: document.getElementById('cfgLimitMessage').value,
    startMessage: document.getElementById('cfgStartMessage').value,
    starterPlanId: document.getElementById('cfgStarterPlan').value,
  };
  const r = await fetch('/admin/api/config', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });
  const d = await r.json();
  document.getElementById('configMsg').innerHTML = r.ok ? '<span class="ok">Config save ho gaya ✅</span>' : '<span class="err">'+(d.error||'Error')+'</span>';
}

async function loadUsers() {
  const r = await fetch('/admin/api/users', { headers: authHeaders() });
  const d = await r.json();
  allUsers = d.users || [];
  renderUsers();
}

function renderUsers() {
  const q = (document.getElementById('searchBox').value || '').toLowerCase();
  const body = document.getElementById('usersBody');
  body.innerHTML = '';
  allUsers
    .filter(u => !q || u.id.toString().includes(q) || (u.firstName||'').toLowerCase().includes(q) || (u.username||'').toLowerCase().includes(q))
    .forEach(u => {
      const tr = document.createElement('tr');
      const statusTag = u.blocked ? '<span class="tag blocked">Blocked</span>' : '<span class="tag active">Active</span>';
      const planTag = (u.planExpiresAt && u.planExpiresAt > Date.now()) ? '<span class="tag active">'+(u.planName||'Plan Active')+'</span>' : '<span class="tag free">Free</span>';
      tr.innerHTML = '<td>'+u.id+'</td><td>'+(u.firstName||'')+' '+(u.username?'@'+u.username:'')+'</td><td>'+statusTag+'</td><td>'+planTag+'</td><td>'+(u.totalMessages||0)+'</td><td>'+(u.starsSpent||0)+'</td><td>'+(u.lastActive?new Date(u.lastActive).toLocaleString('en-IN'):'-')+'</td>';
      tr.style.cursor = 'pointer';
      tr.onclick = () => { document.getElementById('targetUserId').value = u.id; };
      body.appendChild(tr);
    });
}

function exportCSV() {
  let csv = 'ID,Naam,Username,Blocked,Plan,TotalMessages,StarsSpent,LastActive\\n';
  allUsers.forEach(u => {
    csv += [u.id, u.firstName||'', u.username||'', u.blocked, u.planName||'Free', u.totalMessages||0, u.starsSpent||0, u.lastActive?new Date(u.lastActive).toISOString():''].join(',') + '\\n';
  });
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'users.csv';
  a.click();
}

async function loadPlans() {
  const r = await fetch('/admin/api/plans', { headers: authHeaders() });
  const d = await r.json();
  allPlans = d.plans || [];
  renderPlans();
}

function renderPlans() {
  const body = document.getElementById('plansBody');
  body.innerHTML = '';
  const assignSelect = document.getElementById('assignPlanSelect');
  assignSelect.innerHTML = '<option value="">-- Plan Chunein --</option>';
  const broadcastSelect = document.getElementById('broadcastFilter');
  broadcastSelect.innerHTML = '<option value="">Sabhi Users</option>';

  allPlans.forEach(p => {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td>'+p.name+'</td><td>'+(p.stars||0)+'</td><td>'+p.limit+' / '+p.windowValue+' '+p.windowUnit+'</td><td>'+p.validityValue+' '+p.validityUnit+'</td><td>'+(p.imageEnabled?('✅ '+p.imageLimit):'❌')+'</td><td><button class="secondary" onclick="editPlan(\\''+p.id+'\\')">Edit</button> <button class="danger" onclick="deletePlanUI(\\''+p.id+'\\')">Del</button></td>';
    body.appendChild(tr);

    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name + ' (' + p.limit + '/' + p.windowValue + p.windowUnit[0] + ', valid ' + p.validityValue + p.validityUnit[0] + ')';
    assignSelect.appendChild(opt);

    const opt2 = document.createElement('option');
    opt2.value = p.name;
    opt2.textContent = 'Sirf "' + p.name + '" wale users';
    broadcastSelect.appendChild(opt2);
  });
}

function resetPlanForm() {
  editingPlanId = null;
  document.getElementById('planFormName').value = '';
  document.getElementById('planFormStars').value = '';
  document.getElementById('planFormPrice').value = '';
  document.getElementById('planFormLimit').value = '';
  document.getElementById('planFormWindowVal').value = '';
  document.getElementById('planFormValidityVal').value = '';
  document.getElementById('planFormImageEnabled').checked = false;
  document.getElementById('planFormImageLimit').value = 0;
  document.getElementById('planFormSaveBtn').textContent = 'Plan Banayein';
}

function editPlan(id) {
  const p = allPlans.find(x => x.id === id);
  if (!p) return;
  editingPlanId = id;
  document.getElementById('planFormName').value = p.name;
  document.getElementById('planFormStars').value = p.stars || 0;
  document.getElementById('planFormPrice').value = p.price || 0;
  document.getElementById('planFormLimit').value = p.limit;
  document.getElementById('planFormWindowVal').value = p.windowValue;
  document.getElementById('planFormWindowUnit').value = p.windowUnit;
  document.getElementById('planFormValidityVal').value = p.validityValue;
  document.getElementById('planFormValidityUnit').value = p.validityUnit;
  document.getElementById('planFormImageEnabled').checked = !!p.imageEnabled;
  document.getElementById('planFormImageLimit').value = p.imageLimit || 0;
  document.getElementById('planFormSaveBtn').textContent = 'Plan Update Karein';
  window.scrollTo(0, 0);
}

async function savePlanForm() {
  const body = {
    id: editingPlanId || undefined,
    name: document.getElementById('planFormName').value.trim(),
    stars: parseInt(document.getElementById('planFormStars').value, 10) || 0,
    price: parseFloat(document.getElementById('planFormPrice').value) || 0,
    limit: parseInt(document.getElementById('planFormLimit').value, 10),
    windowValue: parseFloat(document.getElementById('planFormWindowVal').value),
    windowUnit: document.getElementById('planFormWindowUnit').value,
    validityValue: parseFloat(document.getElementById('planFormValidityVal').value),
    validityUnit: document.getElementById('planFormValidityUnit').value,
    imageEnabled: document.getElementById('planFormImageEnabled').checked,
    imageLimit: parseInt(document.getElementById('planFormImageLimit').value, 10) || 0,
  };
  if (!body.name || !body.limit || !body.windowValue || !body.validityValue) {
    document.getElementById('planMsg').innerHTML = '<span class="err">Sabhi zaroori fields bharein</span>';
    return;
  }
  const r = await fetch('/admin/api/plans', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });
  const d = await r.json();
  document.getElementById('planMsg').innerHTML = r.ok ? '<span class="ok">Save ho gaya ✅</span>' : '<span class="err">'+(d.error||'Error')+'</span>';
  resetPlanForm();
  loadPlans();
}

async function deletePlanUI(id) {
  if (!confirm('Ye plan delete karein?')) return;
  await fetch('/admin/api/plans/delete', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ id }) });
  loadPlans();
}

async function sendBroadcast() {
  const text = document.getElementById('broadcastText').value.trim();
  if (!text) return;
  const planFilter = document.getElementById('broadcastFilter').value;
  document.getElementById('broadcastMsg').innerHTML = 'Bhej raha hai...';
  const r = await fetch('/admin/api/broadcast', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ text, planFilter }) });
  const d = await r.json();
  document.getElementById('broadcastMsg').innerHTML = r.ok ? '<span class="ok">'+d.sent+' users ko bhej diya ✅</span>' : '<span class="err">'+(d.error||'Error')+'</span>';
}

function getTargetId() {
  const id = document.getElementById('targetUserId').value.trim();
  if (!id) { alert('Pehle User ID daalein'); return null; }
  return id;
}

async function toggleBlock(blocked) {
  const id = getTargetId(); if (!id) return;
  const r = await fetch('/admin/api/user/block', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ userId: id, blocked }) });
  const d = await r.json();
  document.getElementById('userActionMsg').innerHTML = r.ok ? '<span class="ok">Kar diya ✅</span>' : '<span class="err">'+(d.error||'Error')+'</span>';
  loadUsers();
}

async function deleteUser() {
  const id = getTargetId(); if (!id) return;
  if (!confirm('Pakka is user ko poori tarah hata dein?')) return;
  const r = await fetch('/admin/api/user/delete', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ userId: id }) });
  const d = await r.json();
  document.getElementById('userActionMsg').innerHTML = r.ok ? '<span class="ok">Hata diya ✅</span>' : '<span class="err">'+(d.error||'Error')+'</span>';
  loadAll();
}

async function resetUserPlan() {
  const id = getTargetId(); if (!id) return;
  const r = await fetch('/admin/api/user/reset', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ userId: id }) });
  const d = await r.json();
  document.getElementById('userActionMsg').innerHTML = r.ok ? '<span class="ok">Free plan par reset ✅</span>' : '<span class="err">'+(d.error||'Error')+'</span>';
  loadUsers();
}

async function sendSpecificMessage() {
  const id = getTargetId(); if (!id) return;
  const text = document.getElementById('specificMsgText').value.trim();
  if (!text) return;
  const r = await fetch('/admin/api/user/message', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ userId: id, text }) });
  const d = await r.json();
  document.getElementById('userActionMsg').innerHTML = r.ok ? '<span class="ok">Message bhej diya ✅</span>' : '<span class="err">'+(d.error||'Error')+'</span>';
}

async function assignPlan() {
  const id = getTargetId(); if (!id) return;
  const planId = document.getElementById('assignPlanSelect').value;
  if (!planId) { alert('Pehle ek plan chunein'); return; }
  const r = await fetch('/admin/api/user/plan', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ userId: id, planId }) });
  const d = await r.json();
  document.getElementById('userActionMsg').innerHTML = r.ok ? '<span class="ok">Plan assign ho gaya ✅</span>' : '<span class="err">'+(d.error||'Error')+'</span>';
  loadUsers();
}

async function viewHistory() {
  const id = getTargetId(); if (!id) return;
  const r = await fetch('/admin/api/user/history?userId='+encodeURIComponent(id), { headers: authHeaders() });
  const d = await r.json();
  const box = document.getElementById('historyBox');
  box.innerHTML = '<h2>Pichle 7 din ke messages (' + (d.messages||[]).length + ')</h2>';
  (d.messages || []).slice().reverse().forEach(m => {
    const div = document.createElement('div');
    div.className = 'chatbubble';
    div.innerHTML = '<div class="time">' + new Date(m.ts).toLocaleString('en-IN') + '</div><b>Q:</b> ' + m.q + '<br><b>A:</b> ' + m.a.substring(0, 300);
    box.appendChild(div);
  });
}

async function loadPayments() {
  const r = await fetch('/admin/api/payments', { headers: authHeaders() });
  const d = await r.json();
  const body = document.getElementById('paymentsBody');
  body.innerHTML = '';
  (d.payments || []).slice().reverse().slice(0, 100).forEach(p => {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td>'+new Date(p.ts).toLocaleString('en-IN')+'</td><td>'+p.userId+'</td><td>'+p.planName+'</td><td>'+p.stars+'</td>';
    body.appendChild(tr);
  });
}

(function init() {
  const id = localStorage.getItem('mb_admin_id');
  const pass = localStorage.getItem('mb_admin_pass');
  if (id && pass) {
    document.getElementById('loginId').value = id;
    document.getElementById('loginPass').value = pass;
    doLogin();
  }
})();
</script>
</body>
</html>`;

// =========================================================
// ADMIN API HANDLER
// =========================================================
async function handleAdminApi(request, env, url) {
  const pathname = url.pathname;
  if (!isAdminAuthorized(request, env)) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  if (pathname === "/admin/api/stats" && request.method === "GET") {
    const keys = await listAllUserKeys(env);
    let totalMessages = 0;
    for (const k of keys) totalMessages += (k.metadata && k.metadata.totalMessages) || 0;
    const totalStars = await getTotalStars(env);
    return jsonResponse({ totalUsers: keys.length, totalMessages, totalStars });
  }

  if (pathname === "/admin/api/users" && request.method === "GET") {
    const keys = await listAllUserKeys(env);
    const users = keys.map((k) => {
      const id = k.name.replace("user:", "");
      const m = k.metadata || {};
      return {
        id, blocked: !!m.blocked, totalMessages: m.totalMessages || 0, lastActive: m.lastActive || 0,
        planExpiresAt: m.planExpiresAt || null, planName: m.planName || null,
        firstName: m.firstName || "", username: m.username || "", starsSpent: m.starsSpent || 0,
      };
    });
    return jsonResponse({ users });
  }

  if (pathname === "/admin/api/config" && request.method === "GET") {
    const model = await getEffectiveModel(env);
    const { count, windowMs } = await getEffectiveRateLimit(env);
    let windowValue = windowMs / UNIT_MS.hour, windowUnit = "hour";
    if (windowMs % UNIT_MS.day === 0) { windowValue = windowMs / UNIT_MS.day; windowUnit = "day"; }
    if (windowMs % UNIT_MS.hour === 0) { windowValue = windowMs / UNIT_MS.hour; windowUnit = "hour"; }
    const limitMessage = await getEffectiveLimitMessage(env);
    const startMessage = await getEffectiveStartMessage(env);
    const starterPlanId = await getStarterPlanId(env);
    return jsonResponse({ model, rateLimitCount: count, windowValue, windowUnit, limitMessage, startMessage, starterPlanId });
  }

  if (pathname === "/admin/api/config" && request.method === "POST") {
    try {
      const body = await request.json();
      if (body.model) await env.MATH_BOT_KV.put("cfg:model", body.model);
      if (body.rateLimitCount) await env.MATH_BOT_KV.put("cfg:rateLimitCount", String(body.rateLimitCount));
      if (body.windowValue && body.windowUnit && UNIT_MS[body.windowUnit]) {
        await env.MATH_BOT_KV.put("cfg:rateLimitWindowMs", String(body.windowValue * UNIT_MS[body.windowUnit]));
      }
      if (typeof body.limitMessage === "string") await env.MATH_BOT_KV.put("cfg:limitMessage", body.limitMessage);
      if (typeof body.startMessage === "string") await env.MATH_BOT_KV.put("cfg:startMessage", body.startMessage);
      if (typeof body.starterPlanId === "string") {
        if (body.starterPlanId) await env.MATH_BOT_KV.put("cfg:starterPlanId", body.starterPlanId);
        else await env.MATH_BOT_KV.delete("cfg:starterPlanId");
      }
      return jsonResponse({ ok: true });
    } catch (e) {
      return jsonResponse({ error: e.message }, 400);
    }
  }

  if (pathname === "/admin/api/user/block" && request.method === "POST") {
    try {
      const { userId, blocked } = await request.json();
      const { rec } = await getUserRecord(env, userId);
      rec.blocked = !!blocked;
      await saveUserRecord(env, userId, rec);
      return jsonResponse({ ok: true });
    } catch (e) { return jsonResponse({ error: e.message }, 400); }
  }

  if (pathname === "/admin/api/user/delete" && request.method === "POST") {
    try {
      const { userId } = await request.json();
      await env.MATH_BOT_KV.delete(`user:${userId}`);
      await env.MATH_BOT_KV.delete(`log:${userId}`);
      return jsonResponse({ ok: true });
    } catch (e) { return jsonResponse({ error: e.message }, 400); }
  }

  if (pathname === "/admin/api/user/reset" && request.method === "POST") {
    try {
      const { userId } = await request.json();
      const { rec } = await getUserRecord(env, userId);
      rec.planLimit = null; rec.planWindowMs = null; rec.planExpiresAt = null; rec.planName = null;
      rec.planImageEnabled = false; rec.planImageLimit = 0;
      rec.windowStart = Date.now(); rec.windowCount = 0;
      await saveUserRecord(env, userId, rec);
      return jsonResponse({ ok: true });
    } catch (e) { return jsonResponse({ error: e.message }, 400); }
  }

  if (pathname === "/admin/api/user/plan" && request.method === "POST") {
    try {
      const { userId, planId } = await request.json();
      const plan = await getPlanById(env, planId);
      if (!plan) return jsonResponse({ error: "Plan not found" }, 404);
      const { rec } = await getUserRecord(env, userId);
      applyPlanToRecord(rec, plan);
      await saveUserRecord(env, userId, rec);
      return jsonResponse({ ok: true });
    } catch (e) { return jsonResponse({ error: e.message }, 400); }
  }

  if (pathname === "/admin/api/user/message" && request.method === "POST") {
    try {
      const { userId, text } = await request.json();
      const result = await sendMessage(env, userId, text);
      return jsonResponse({ ok: true, telegramResult: result });
    } catch (e) { return jsonResponse({ error: e.message }, 400); }
  }

  if (pathname === "/admin/api/user/history" && request.method === "GET") {
    const userId = url.searchParams.get("userId");
    const messages = await getChatLog(env, userId);
    return jsonResponse({ messages });
  }

  if (pathname === "/admin/api/plans" && request.method === "GET") {
    return jsonResponse({ plans: await getAllPlans(env) });
  }

  if (pathname === "/admin/api/plans" && request.method === "POST") {
    try {
      const body = await request.json();
      if (!UNIT_MS[body.windowUnit] || !UNIT_MS[body.validityUnit]) return jsonResponse({ error: "Invalid time unit" }, 400);
      const plan = {
        id: body.id || `p${Date.now()}`,
        name: body.name, stars: body.stars || 0, price: body.price || 0,
        limit: body.limit, windowValue: body.windowValue, windowUnit: body.windowUnit,
        validityValue: body.validityValue, validityUnit: body.validityUnit,
        imageEnabled: !!body.imageEnabled, imageLimit: body.imageLimit || 0,
      };
      await savePlan(env, plan);
      return jsonResponse({ ok: true, plan });
    } catch (e) { return jsonResponse({ error: e.message }, 400); }
  }

  if (pathname === "/admin/api/plans/delete" && request.method === "POST") {
    try {
      const { id } = await request.json();
      await deletePlanById(env, id);
      return jsonResponse({ ok: true });
    } catch (e) { return jsonResponse({ error: e.message }, 400); }
  }

  if (pathname === "/admin/api/payments" && request.method === "GET") {
    return jsonResponse({ payments: await getPaymentsLog(env) });
  }

  if (pathname === "/admin/api/broadcast" && request.method === "POST") {
    try {
      const { text, planFilter } = await request.json();
      const keys = await listAllUserKeys(env);
      const targets = planFilter ? keys.filter((k) => k.metadata && k.metadata.planName === planFilter) : keys;
      let sent = 0;
      const chunkSize = 20;
      for (let i = 0; i < targets.length; i += chunkSize) {
        const chunk = targets.slice(i, i + chunkSize);
        await Promise.allSettled(chunk.map((k) => sendMessage(env, k.name.replace("user:", ""), text)));
        sent += chunk.length;
      }
      return jsonResponse({ ok: true, sent });
    } catch (e) { return jsonResponse({ error: e.message }, 400); }
  }

  return jsonResponse({ error: "Not found" }, 404);
}

// =========================================================
// MAIN WORKER
// =========================================================
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/admin" && request.method === "GET") {
      return new Response(ADMIN_PAGE_HTML, { headers: { "Content-Type": "text/html; charset=UTF-8" } });
    }

    if (url.pathname.startsWith("/admin/api/")) {
      return handleAdminApi(request, env, url);
    }

    if (url.pathname === "/debug") {
      const { BOT_TOKEN, XKIRO_API_KEY } = getConfig(env);
      const XKIRO_MODEL = await getEffectiveModel(env);
      let telegramCheck = "not tested";
      try {
        const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getMe`);
        telegramCheck = await r.json();
      } catch (e) { telegramCheck = `fetch failed: ${e.message}`; }
      let kvCheck = "not tested";
      try {
        await env.MATH_BOT_KV.put("debug_test", "ok", { expirationTtl: 60 });
        kvCheck = await env.MATH_BOT_KV.get("debug_test");
      } catch (e) { kvCheck = `KV failed: ${e.message}`; }
      let xkiroCheck = "not tested";
      try {
        const r2 = await fetch("https://api.xkiro.com/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${XKIRO_API_KEY}` },
          body: JSON.stringify({ model: XKIRO_MODEL, messages: [{ role: "user", content: "2+2 kitna hota hai, ek shabd me jawab do" }] }),
        });
        xkiroCheck = await r2.json();
      } catch (e) { xkiroCheck = `fetch failed: ${e.message}`; }
      return new Response(JSON.stringify({ telegramCheck, kvCheck, xkiroCheck, model: XKIRO_MODEL }, null, 2), { headers: { "Content-Type": "application/json" } });
    }

    if (url.pathname === "/setWebhook") {
      const { BOT_TOKEN } = getConfig(env);
      const webhookUrl = `${url.origin}/webhook`;
      const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${encodeURIComponent(webhookUrl)}`);
      const result = await res.text();
      return new Response(result, { headers: { "Content-Type": "application/json" } });
    }

    if (url.pathname === "/webhook" && request.method === "POST") {
      let update;
      try {
        update = await request.json();
      } catch (e) {
        return new Response("ok");
      }

      // ---- Callback query: "Buy Plan" button dabaya ----
      if (update.callback_query) {
        const cq = update.callback_query;
        ctx.waitUntil((async () => {
          await tgCall(env, "answerCallbackQuery", { callback_query_id: cq.id });
          if (cq.data && cq.data.startsWith("buy:")) {
            const planId = cq.data.slice(4);
            const plan = await getPlanById(env, planId);
            if (plan && plan.stars > 0) {
              await sendInvoiceStars(env, cq.message.chat.id, plan);
            } else {
              await sendMessage(env, cq.message.chat.id, "यह प्लान अभी उपलब्ध नहीं है।");
            }
          }
        })());
        return new Response("ok");
      }

      // ---- Pre-checkout query: payment confirm hone se pehle ----
      if (update.pre_checkout_query) {
        const pcq = update.pre_checkout_query;
        ctx.waitUntil(tgCall(env, "answerPreCheckoutQuery", { pre_checkout_query_id: pcq.id, ok: true }));
        return new Response("ok");
      }

      const message = update.message;
      if (!message || !message.chat || !message.from) {
        return new Response("ok");
      }

      const chatId = message.chat.id;
      const userId = message.from.id;
      const from = message.from;

      // ---- Successful payment ----
      if (message.successful_payment) {
        ctx.waitUntil(handleSuccessfulPayment(env, chatId, userId, message.successful_payment));
        return new Response("ok");
      }

      // ---- Photo/document: agar plan me image feature hai to solve karo ----
      if (message.photo || message.document) {
        ctx.waitUntil(handlePhotoMessage(env, chatId, userId, message, from));
        return new Response("ok");
      }

      if (!message.text) {
        return new Response("ok");
      }

      const text = message.text.trim();
      ctx.waitUntil(handleMessage(env, chatId, userId, text, from));

      return new Response("ok");
    }

    return new Response("Math Bot Worker chal raha hai ✅");
  },
};

// ---- /plans command: purchasable plans dikhana ----
async function handlePlansCommand(env, chatId) {
  const plans = await getAllPlans(env);
  const purchasable = plans.filter((p) => p.stars > 0);
  if (purchasable.length === 0) {
    await sendMessage(env, chatId, "अभी कोई प्लान खरीदने के लिए उपलब्ध नहीं है।");
    return;
  }
  const buttons = purchasable.map((p) => [
    { text: `${p.name} — ⭐${p.stars} (${p.limit}/${p.windowValue}${p.windowUnit[0]}, ${p.validityValue}${p.validityUnit[0]})`, callback_data: `buy:${p.id}` },
  ]);
  await sendMessage(env, chatId, "नीचे दिए गए प्लान में से चुनें (Telegram Stars से भुगतान होगा):", {
    reply_markup: { inline_keyboard: buttons },
  });
}

// ---- Photo message handling (vision quota check ke saath) ----
async function handlePhotoMessage(env, chatId, userId, message, from) {
  try {
    await checkRateLimit(env, userId, from); // profile update ke liye (limit consume nahi hoti image ke liye)
    const quota = await checkImageQuota(env, userId);

    if (!quota.allowed) {
      if (quota.reason === "blocked") {
        await sendMessage(env, chatId, BLOCKED_REPLY);
      } else if (quota.reason === "no_plan") {
        await sendMessage(env, chatId, NO_IMAGE_PLAN_REPLY);
      } else if (quota.reason === "not_enabled") {
        await sendMessage(env, chatId, IMAGE_NOT_ENABLED_REPLY);
      } else if (quota.reason === "quota") {
        const resetTimeStr = formatResetTime(quota.resetTime);
        await sendMessage(env, chatId, `आपकी फोटो भेजने की सीमा (${quota.limitCount}) समाप्त हो चुकी है। यह ${resetTimeStr} को रीसेट होगी।`);
      }
      return;
    }

    if (message.document) {
      await sendMessage(env, chatId, "कृपया फोटो (image) भेजें, document/file नहीं।");
      return;
    }

    const photos = message.photo;
    const best = photos[photos.length - 1]; // sabse bada size
    const base64 = await getTelegramFileAsBase64(env, best.file_id);
    const caption = message.caption || "";
    const answer = await askXkiroImageWithTyping(env, chatId, base64, caption);
    await sendMessage(env, chatId, answer);
    await appendChatLog(env, userId, "[फोटो सवाल] " + caption, answer);
  } catch (err) {
    try {
      await sendMessage(env, chatId, `DEBUG IMAGE ERROR: ${err.message}`);
    } catch (e) {}
  }
}

// ---- Message handling logic (text) ----
async function handleMessage(env, chatId, userId, text, from) {
  try {
    if (text === "/start") {
      const { count, windowMs } = await getEffectiveRateLimit(env);
      const template = await getEffectiveStartMessage(env);
      await sendMessage(env, chatId, fillTemplate(template, { count, windowText: formatDuration(windowMs) }));
      return;
    }

    if (text === "/plans") {
      await handlePlansCommand(env, chatId);
      return;
    }

    const rateCheck = await checkRateLimit(env, userId, from);

    if (!rateCheck.allowed) {
      if (rateCheck.blocked) {
        await sendMessage(env, chatId, BLOCKED_REPLY);
        return;
      }
      const resetTimeStr = formatResetTime(rateCheck.resetTime);
      const template = await getEffectiveLimitMessage(env);
      await sendMessage(env, chatId, fillTemplate(template, { count: rateCheck.limitCount || "", resetTime: resetTimeStr }));
      return;
    }

    const answer = await askXkiroWithTyping(env, chatId, text);
    await sendMessage(env, chatId, answer);
    await appendChatLog(env, userId, text, answer);
  } catch (err) {
    try {
      await sendMessage(env, chatId, `DEBUG HANDLE ERROR: ${err.message}`);
    } catch (e) {}
  }
}
