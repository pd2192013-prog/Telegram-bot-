export default {
  async fetch(request, env, ctx) {
    if (request.method !== "POST") {
      return new Response("Bot is running!");
    }

    try {
      const update = await request.json();

      // अगर मैसेज नहीं है तो इग्नोर करें
      if (!update.message) return new Response("OK");

      const message = update.message;
      const chatId = message.chat.id;
      const userId = message.from.id;

      // Rule 4: अगर यूजर फोटो भेजे 
      if (message.photo) {
        await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, "माफ़ करें मैं अभी फोटो नहीं देख सकता कृपया सवाल लिखकर पूछें यह व्यवस्था कुछ दिन में आएगी।");
        return new Response("OK");
      }

      // टेक्स्ट मैसेज न होने पर इग्नोर करें
      if (!message.text) return new Response("OK");
      const userText = message.text;

      // ==========================================
      // Rule 3 & 6: 1 घंटे में 15 सवालों की लिमिट
      // ==========================================
      const kvKey = `user_${userId}`;
      let userData = await env.RATE_LIMIT_KV.get(kvKey, "json");
      const now = Date.now();
      const oneHour = 60 * 60 * 1000;

      if (!userData || now >= userData.reset_time) {
        // नया यूजर या 1 घंटा पूरा हो गया
        userData = { count: 1, reset_time: now + oneHour };
      } else {
        if (userData.count >= 15) {
          // लिमिट खत्म होने का मैसेज (Rule 6)
          const resetDate = new Date(userData.reset_time);
          // भारत के समय (IST) के अनुसार टाइम सेट करना
          const timeStr = resetDate.toLocaleTimeString('hi-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });
          const limitMsg = `आप अपनी फ्री सुविधा का लाभ उठा चुके हैं। आप मुझसे केवल 1 घंटे में 15 सवाल पूछ सकते हैं। अब आप ${timeStr} बजे ट्राई करें।`;
          
          await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, limitMsg);
          return new Response("OK");
        }
        // सवाल पूछने की गिनती बढ़ा दें
        userData.count++;
      }
      // KV में डेटा सेव करें
      await env.RATE_LIMIT_KV.put(kvKey, JSON.stringify(userData));

      // ==========================================
      // Rule 7: AI के टाइप करते समय "Typing..." शो करना
      // ==========================================
      await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendChatAction`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, action: "typing" })
      });

      // ==========================================
      // Rule 1, 2, 5, 8 & 9: Gemini AI Prompt Setup
      // ==========================================
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_MODEL}:generateContent?key=${env.GEMINI_API_KEY}`;
      
      const systemPrompt = `तुम एक गणित के शिक्षक हो। तुम्हारा काम केवल गणित (Maths) के सवालों को सही-सही हल करना है। 
यदि यूजर कोई ऐसा सवाल पूछता है जो गणित से संबंधित नहीं है (जैसे कोडिंग, चुटकुले, सामान्य ज्ञान), तो तुम्हें केवल यह जवाब देना है: "मैं केवल मैथ्स सॉल्व करने के लिए बना हूँ।"
जवाब हमेशा शुद्ध हिंदी (देवनागरी लिपि) में देना है, लेकिन संख्याओं के लिए केवल 0 से 9 (0, 1, 2, 3...) का ही उपयोग करना है।
जवाब बहुत ही सरल और स्पष्ट होना चाहिए ताकि छात्रों को आसानी से समझ में आ सके। OCR जैसी अजीब टाइपिंग या बहुत मुश्किल लेटेक्स (LaTeX) फॉर्मैटिंग का प्रयोग न करें।`;

      const geminiPayload = {
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ parts: [{ text: userText }] }]
      };

      // Gemini को रिक्वेस्ट भेजना
      const geminiResponse = await fetch(geminiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(geminiPayload)
      });

      const geminiData = await geminiResponse.json();
      let aiReply = "माफ़ करें, मुझे सवाल हल करने में कोई तकनीकी समस्या आ रही है।";

      if (geminiData.candidates && geminiData.candidates.length > 0) {
        aiReply = geminiData.candidates[0].content.parts[0].text;
      }

      // Telegram पर AI का जवाब भेजना
      await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, aiReply);

      return new Response("OK");
    } catch (error) {
      console.error(error);
      return new Response("Error", { status: 500 });
    }
  }
};

// Telegram पर मैसेज भेजने का फंक्शन
async function sendTelegramMessage(token, chatId, text) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: text
    })
  });
}
