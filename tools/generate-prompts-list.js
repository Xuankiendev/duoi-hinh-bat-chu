#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenerativeAI } from '@google/generative-ai';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const WORDS_PATH = path.join(ROOT, 'assets/json-data/words-crawl.json');
const QUESTIONS_PATH = path.join(ROOT, 'assets/json-data/duoi-hinh-bat-chu.json');
const OUTPUT_PATH = path.join(ROOT, 'dhbc-prompts-to-generate.json');

// Load keys from keys.json
const KEYS_PATH = path.join(ROOT, '../duoi-hinh-bat-chu/tools/keys.json');
let API_KEYS = [];
if (fs.existsSync(KEYS_PATH)) {
  API_KEYS = JSON.parse(fs.readFileSync(KEYS_PATH, 'utf8'));
} else {
  // Try environment variable
  if (process.env.GEMINI_API_KEY) {
    API_KEYS = [process.env.GEMINI_API_KEY];
  } else {
    console.error("Warning: keys.json not found and GEMINI_API_KEY is not set.");
  }
}

// Fallback logic for calling Gemini text model
async function callGeminiText(prompt, keyIndex = 0) {
  if (API_KEYS.length === 0) {
    throw new Error("No API keys found. Please supply keys in keys.json or GEMINI_API_KEY environment variable.");
  }
  if (keyIndex >= API_KEYS.length) {
    throw new Error("All Gemini API keys have failed or exhausted quota!");
  }
  const apiKey = API_KEYS[keyIndex];
  const genAI = new GoogleGenerativeAI(apiKey);

  try {
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: { responseMimeType: "application/json" }
    });
    const result = await model.generateContent(prompt);
    return { text: result.response.text(), keyIndexUsed: keyIndex };
  } catch (err) {
    console.warn(`[Key ${keyIndex}] Failed: ${err.message}. Retrying next key...`);
    return callGeminiText(prompt, keyIndex + 1);
  }
}

function selectCandidates(count = 200) {
  const wordsData = JSON.parse(fs.readFileSync(WORDS_PATH, 'utf8'));
  const questionsData = JSON.parse(fs.readFileSync(QUESTIONS_PATH, 'utf8'));

  const existingAnswers = new Set(questionsData.map(q => q.answer.trim().toLowerCase()));

  // Filter 2-word keys consisting only of standard Vietnamese letters
  const candidates = Object.keys(wordsData).filter(word => {
    const w = word.trim();
    if (w.split(/\s+/).length !== 2) return false;
    const isOnlyLetters = /^[a-zA-Zà-ỹÀ-ỸđĐ\s]+$/.test(w);
    if (!isOnlyLetters) return false;
    if (existingAnswers.has(w.toLowerCase())) return false;
    return true;
  });

  // Shuffle candidates
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }

  return candidates.slice(0, count);
}

async function main() {
  console.log("Selecting 200 candidate words...");
  const candidates = selectCandidates(220); // Get slightly more in case of filters
  console.log(`Selected ${candidates.length} candidates.`);

  const batchSize = 10;
  const results = [];
  let keyIndex = 0;

  for (let i = 0; i < candidates.length; i += batchSize) {
    const batch = candidates.slice(i, i + batchSize);
    console.log(`\nProcessing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(candidates.length / batchSize)}: ${batch.join(', ')}...`);

    const prompt = `
Bạn là chuyên gia thiết kế câu đố cho trò chơi truyền hình "Đuổi hình bắt chữ" của Việt Nam.
Dưới đây là danh sách ${batch.length} cụm từ tiếng Việt ghép gồm 2 từ:
${batch.map((w, idx) => `${idx + 1}. ${w}`).join('\n')}

Hãy thiết kế ý tưởng câu đố hình ảnh (rebus puzzle) cho TẤT CẢ các từ trên bằng cách tách nghĩa các từ đơn hoặc dùng nghĩa đen/hình ảnh ẩn dụ ngộ nghĩnh (ví dụ: "Thất tình" = vẽ 7 trái tim, trong đó có trái tim vỡ; "Bao phủ" = vẽ một cái bao tải đang phủ lên cái gì đó; "Báo cáo" = vẽ con báo mặc áo).
Sau đó viết một prompt chi tiết bằng tiếng Anh dành cho mô hình AI tạo ảnh Imagen để sinh ra hình ảnh đó.
Yêu cầu đối với prompt tiếng Anh:
- Phong cách: 3D render, game mobile style, vibrant colors, clear details.
- TUYỆT ĐỐI KHÔNG chứa chữ viết (No text, no words, no letters) trong hình ảnh để tránh làm lộ đáp án.
- Mô tả rõ ràng bố cục và các chi tiết trực quan để người chơi dễ dàng liên tưởng đến cụm từ tiếng Việt gốc.

Trả về kết quả dưới dạng mảng JSON duy nhất, không kèm markdown hay văn bản nào khác ngoài JSON, cấu trúc:
[
  {
    "word": "từ ghép 1",
    "explanation": "giải thích ý tưởng câu đố bằng tiếng Việt",
    "imagePrompt": "detailed English prompt for Imagen"
  },
  ...
]
`;

    try {
      const res = await callGeminiText(prompt, keyIndex);
      keyIndex = res.keyIndexUsed; // Reuse working key index
      const batchResults = JSON.parse(res.text);
      if (Array.isArray(batchResults)) {
        results.push(...batchResults);
        console.log(`Saved batch results. Total designed so far: ${results.length}`);
      }
    } catch (err) {
      console.error(`Failed to process batch: ${err.message}`);
    }

    // Small delay to respect rate limit
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(results, null, 2), 'utf8');
  console.log(`\nSuccessfully designed ${results.length} questions and saved to ${OUTPUT_PATH}!`);
}

main().catch(err => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
