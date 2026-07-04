#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const WORDS_PATH = path.join(ROOT, 'assets/json-data/words-crawl.json');
const QUESTIONS_PATH = path.join(ROOT, 'assets/json-data/duoi-hinh-bat-chu.json');
const QUESTIONS_REPO_PATH = '/root/duoi-hinh-bat-chu/questions.json';
const IMAGES_REPO_DIR = '/root/duoi-hinh-bat-chu/images';
const IMAGES_LOCAL_DIR = path.join(ROOT, 'assets/resources/game/duoi-hinh-bat-chu');

// Load keys from keys.json
const KEYS_PATH = path.join(ROOT, '../duoi-hinh-bat-chu/tools/keys.json');
let API_KEYS = [];
if (fs.existsSync(KEYS_PATH)) {
  API_KEYS = JSON.parse(fs.readFileSync(KEYS_PATH, 'utf8'));
} else {
  if (process.env.GEMINI_API_KEY) {
    API_KEYS = [process.env.GEMINI_API_KEY];
  } else {
    console.error("Warning: keys.json not found and GEMINI_API_KEY is not set.");
  }
}

async function callGeminiAPI(endpoint, payload, keyIndex = 0) {
  if (API_KEYS.length === 0) {
    throw new Error("No API keys found. Please supply keys in keys.json or GEMINI_API_KEY environment variable.");
  }
  if (keyIndex >= API_KEYS.length) {
    throw new Error("All Gemini API keys have failed or exhausted quota!");
  }
  const apiKey = API_KEYS[keyIndex];
  const url = `https://generativelanguage.googleapis.com/v1beta/${endpoint}?key=${apiKey}`;

  console.log(`[Key ${keyIndex}] Calling endpoint: ${endpoint}...`);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60000)
    });

    const data = await response.json();
    if (!response.ok) {
      console.warn(`[Key ${keyIndex}] Request failed: ${response.status} ${response.statusText}`, data);
      if (response.status === 429 || response.status === 403 || (data.error && data.error.message.includes("quota"))) {
        console.warn(`[Key ${keyIndex}] Quota/Rate limit reached. Falling back to next key...`);
        return callGeminiAPI(endpoint, payload, keyIndex + 1);
      }
      throw new Error(`API error: ${JSON.stringify(data)}`);
    }
    return { data, keyIndexUsed: keyIndex };
  } catch (err) {
    console.error(`[Key ${keyIndex}] Network/API error:`, err.message);
    console.warn(`Falling back to next key...`);
    return callGeminiAPI(endpoint, payload, keyIndex + 1);
  }
}

function selectCandidateWords() {
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

  if (candidates.length === 0) {
    throw new Error("No candidate words found in words-crawl.json that aren't already in duoi-hinh-bat-chu.json!");
  }

  // Shuffle and pick 15 candidates
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }

  return candidates.slice(0, 15);
}

function capitalizeFirstLetter(str) {
  const s = str.trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

async function main() {
  console.log("Selecting candidates from words-crawl.json...");
  const candidates = selectCandidateWords();
  console.log(`Found ${candidates.length} candidates.`);

  const selectionPrompt = `
Bạn là chuyên gia thiết kế câu đố cho trò chơi truyền hình "Đuổi hình bắt chữ" của Việt Nam.
Dưới đây là danh sách 15 cụm từ tiếng Việt ghép gồm 2 từ:
${candidates.map((w, idx) => `${idx + 1}. ${w}`).join('\n')}

Hãy thực hiện các bước sau:
1. Chọn ra đúng 1 cụm từ trong danh sách trên mà dễ thiết kế thành câu đố hình ảnh (rebus puzzle) sáng tạo, trực quan, hài hước nhất cho người Việt Nam. Tránh chọn các từ quá trừu tượng khó vẽ hoặc từ không thông dụng.
2. Thiết kế ý tưởng hình ảnh (rebus) cho từ đó bằng cách tách nghĩa các từ đơn hoặc dùng nghĩa đen/hình ảnh ẩn dụ ngộ nghĩnh (ví dụ: "Thất tình" = vẽ 7 trái tim, trong đó có trái tim vỡ; "Bao phủ" = vẽ một cái bao tải đang phủ lên cái gì đó; "Báo cáo" = vẽ con báo mặc áo).
3. Viết một prompt chi tiết bằng tiếng Anh dành cho mô hình AI tạo ảnh Imagen 3 để sinh ra hình ảnh đó.
   Yêu cầu đối với prompt tiếng Anh:
   - Phong cách: 3D render, game mobile style, vibrant colors, clear details.
   - TUYỆT ĐỐI KHÔNG chứa chữ viết (No text, no words, no letters) trong hình ảnh để tránh làm lộ đáp án.
   - Mô tả rõ ràng bố cục và các chi tiết trực quan để người chơi dễ dàng liên tưởng đến cụm từ tiếng Việt gốc.

Trả về kết quả dưới dạng JSON duy nhất, không kèm markdown hay văn bản nào khác ngoài JSON, cấu trúc:
{
  "word": "từ tiếng Việt được chọn",
  "explanation": "giải thích ý tưởng câu đố bằng tiếng Việt",
  "imagePrompt": "detailed English prompt for Imagen 3"
}
`;

  const textPayload = {
    contents: [
      {
        parts: [
          {
            text: selectionPrompt
          }
        ]
      }
    ],
    generationConfig: {
      responseMimeType: "application/json"
    }
  };

  console.log("Calling Gemini (1.5-flash) to select word and design prompt...");
  const textResult = await callGeminiAPI("models/gemini-1.5-flash:generateContent", textPayload);
  const responseJson = JSON.parse(textResult.data.candidates[0].content.parts[0].text);
  
  const chosenWord = responseJson.word;
  const explanation = responseJson.explanation;
  const imagePrompt = responseJson.imagePrompt;

  console.log(`\nChosen Word: ${chosenWord}`);
  console.log(`Explanation: ${explanation}`);
  console.log(`Image Prompt: ${imagePrompt}`);

  const formattedWord = capitalizeFirstLetter(chosenWord);
  const outputFileName = `${formattedWord}.png`;
  const repoFilePath = path.join(IMAGES_REPO_DIR, outputFileName);
  const localFilePath = path.join(IMAGES_LOCAL_DIR, outputFileName);

  const imagenPayload = {
    instances: [
      {
        prompt: imagePrompt
      }
    ],
    parameters: {
      sampleCount: 1,
      aspectRatio: "1:1",
      outputMimeType: "image/png"
    }
  };

  console.log("\nCalling Imagen 3 to generate the image...");
  const imageResult = await callGeminiAPI("models/imagen-3.0-generate-002:predict", imagenPayload, textResult.keyIndexUsed);
  const b64Data = imageResult.data.predictions[0].bytesBase64Encoded;
  const imageBuffer = Buffer.from(b64Data, 'base64');

  fs.mkdirSync(IMAGES_REPO_DIR, { recursive: true });
  fs.mkdirSync(IMAGES_LOCAL_DIR, { recursive: true });
  
  fs.writeFileSync(repoFilePath, imageBuffer);
  fs.copyFileSync(repoFilePath, localFilePath);
  console.log(`Successfully saved image to: ${repoFilePath}`);

  // Update repo questions.json
  if (fs.existsSync(QUESTIONS_REPO_PATH)) {
    const questionsData = JSON.parse(fs.readFileSync(QUESTIONS_REPO_PATH, 'utf8'));
    const alreadyExists = questionsData.some(q => q.answer.trim().toLowerCase() === formattedWord.toLowerCase());
    if (!alreadyExists) {
      questionsData.push({
        image: `images/${outputFileName}`,
        answer: formattedWord
      });
      fs.writeFileSync(QUESTIONS_REPO_PATH, JSON.stringify(questionsData, null, 2), 'utf8');
      console.log(`Updated repo questions.json`);
    }
  }

  // Update local duoi-hinh-bat-chu.json
  if (fs.existsSync(QUESTIONS_PATH)) {
    const localQuestions = JSON.parse(fs.readFileSync(QUESTIONS_PATH, 'utf8'));
    const alreadyExistsLocal = localQuestions.some(q => q.answer.trim().toLowerCase() === formattedWord.toLowerCase());
    if (!alreadyExistsLocal) {
      localQuestions.push({
        image: `assets/resources/game/duoi-hinh-bat-chu/${outputFileName}`,
        answer: formattedWord
      });
      fs.writeFileSync(QUESTIONS_PATH, JSON.stringify(localQuestions, null, 2), 'utf8');
      console.log(`Updated local duoi-hinh-bat-chu.json`);
    }
  }

  console.log("\nCommitting and pushing changes to GitHub...");
  try {
    execSync(`git -C /root/duoi-hinh-bat-chu add "images/${outputFileName}" questions.json`, { stdio: 'inherit' });
    execSync(`git -C /root/duoi-hinh-bat-chu commit -m "Add new DHBC question: ${formattedWord}"`, { stdio: 'inherit' });
    execSync('git -C /root/duoi-hinh-bat-chu push', { stdio: 'inherit' });
    console.log("Successfully pushed to GitHub!");
  } catch (gitErr) {
    console.error("Git error occurred:", gitErr.message);
  }
}

main().catch(err => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
