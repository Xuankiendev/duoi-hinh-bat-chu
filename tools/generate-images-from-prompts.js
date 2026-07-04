#!/usr/bin/env node
/**
 * Generate images from pre-designed prompts in dhbc-prompts-to-generate.json
 * 
 * Usage:
 *   GEMINI_API_KEY=your_paid_key_here node tools/generate-images-from-prompts.js
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const PROMPTS_PATH = path.join(ROOT, 'dhbc-prompts-to-generate.json');
const QUESTIONS_LOCAL_PATH = path.join(ROOT, 'assets/json-data/duoi-hinh-bat-chu.json');
const QUESTIONS_REPO_PATH = '/root/duoi-hinh-bat-chu/questions.json';
const IMAGES_REPO_DIR = '/root/duoi-hinh-bat-chu/images';
const IMAGES_LOCAL_DIR = path.join(ROOT, 'assets/resources/game/duoi-hinh-bat-chu');

const API_KEY = process.env.GEMINI_API_KEY;

if (!API_KEY) {
  console.error("Error: GEMINI_API_KEY environment variable is not set!");
  console.error("Please run the script with a paid API key like this:");
  console.error("  GEMINI_API_KEY=your_paid_key node tools/generate-images-from-prompts.js");
  process.exit(1);
}

if (!fs.existsSync(PROMPTS_PATH)) {
  console.error(`Error: Prompts file not found at ${PROMPTS_PATH}`);
  console.error("Please wait for the prompt generation task to complete.");
  process.exit(1);
}

async function callImagenAPI(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict?key=${API_KEY}`;
  const payload = {
    instances: [{ prompt }],
    parameters: {
      sampleCount: 1,
      aspectRatio: "1:1",
      outputMimeType: "image/png"
    }
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': API_KEY
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(60000)
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error ? data.error.message : `${response.status} ${response.statusText}`);
  }

  return data.predictions[0].bytesBase64Encoded;
}

function capitalizeFirstLetter(str) {
  const s = str.trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

async function main() {
  const promptsList = JSON.parse(fs.readFileSync(PROMPTS_PATH, 'utf8'));
  console.log(`Loaded ${promptsList.length} prompts to generate.`);

  // Load existing questions to skip duplicates
  const localQuestions = fs.existsSync(QUESTIONS_LOCAL_PATH) ? JSON.parse(fs.readFileSync(QUESTIONS_LOCAL_PATH, 'utf8')) : [];
  const existingAnswers = new Set(localQuestions.map(q => q.answer.trim().toLowerCase()));

  fs.mkdirSync(IMAGES_REPO_DIR, { recursive: true });
  fs.mkdirSync(IMAGES_LOCAL_DIR, { recursive: true });

  let successCount = 0;

  for (let i = 0; i < promptsList.length; i++) {
    const item = promptsList[i];
    const word = capitalizeFirstLetter(item.word);
    
    if (existingAnswers.has(word.toLowerCase())) {
      console.log(`[${i + 1}/${promptsList.length}] Skipping "${word}" (already exists in game database).`);
      continue;
    }

    console.log(`\n[${i + 1}/${promptsList.length}] Generating image for: "${word}"...`);
    console.log(`Concept: ${item.explanation}`);
    
    try {
      // 1. Call Imagen API
      const b64 = await callImagenAPI(item.imagePrompt);
      const buffer = Buffer.from(b64, 'base64');

      // 2. Save paths
      const repoImgPath = path.join(IMAGES_REPO_DIR, `${word}.png`);
      const localImgPath = path.join(IMAGES_LOCAL_DIR, `${word}.png`);

      // 3. Convert/Save as PNG
      await sharp(buffer).png().toFile(repoImgPath);
      fs.copyFileSync(repoImgPath, localImgPath);
      console.log(`Saved image to repo and local assets.`);

      // 4. Update Repo questions.json
      if (fs.existsSync(QUESTIONS_REPO_PATH)) {
        const repoQuestions = JSON.parse(fs.readFileSync(QUESTIONS_REPO_PATH, 'utf8'));
        if (!repoQuestions.some(q => q.answer.trim().toLowerCase() === word.toLowerCase())) {
          repoQuestions.push({ image: `images/${word}.png`, answer: word });
          fs.writeFileSync(QUESTIONS_REPO_PATH, JSON.stringify(repoQuestions, null, 2), 'utf8');
        }
      }

      // 5. Update Local duoi-hinh-bat-chu.json
      if (fs.existsSync(QUESTIONS_LOCAL_PATH)) {
        const localQs = JSON.parse(fs.readFileSync(QUESTIONS_LOCAL_PATH, 'utf8'));
        if (!localQs.some(q => q.answer.trim().toLowerCase() === word.toLowerCase())) {
          localQs.push({ image: `assets/resources/game/duoi-hinh-bat-chu/${word}.png`, answer: word });
          fs.writeFileSync(QUESTIONS_LOCAL_PATH, JSON.stringify(localQs, null, 2), 'utf8');
        }
      }

      successCount++;
      existingAnswers.add(word.toLowerCase());

      // Small delay between calls to respect rate limits
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (err) {
      console.error(`Failed to generate image for "${word}": ${err.message}`);
      if (err.message.includes("quota") || err.message.includes("limit") || err.message.includes("paid")) {
        console.error("API Key quota/tier error. Stopping execution.");
        break;
      }
    }
  }

  console.log(`\nSuccessfully generated ${successCount} new questions.`);

  if (successCount > 0) {
    console.log("Committing and pushing new images to GitHub...");
    try {
      execSync('git -C /root/duoi-hinh-bat-chu add images/ questions.json', { stdio: 'inherit' });
      execSync(`git -C /root/duoi-hinh-bat-chu commit -m "Add ${successCount} new DHBC questions generated via script"`, { stdio: 'inherit' });
      execSync('git -C /root/duoi-hinh-bat-chu push', { stdio: 'inherit' });
      console.log("Successfully pushed to GitHub!");

      console.log("Restarting bot to apply changes...");
      execSync('npx pm2 restart all', { stdio: 'inherit' });
    } catch (gitErr) {
      console.error("Post-generation steps failed:", gitErr.message);
    }
  }
}

main().catch(err => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
