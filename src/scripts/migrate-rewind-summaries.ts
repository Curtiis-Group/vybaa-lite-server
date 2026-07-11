import { GoogleGenerativeAI } from "@google/generative-ai";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/db.config";
import dotenv from "dotenv";

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
const model = genAI.getGenerativeModel({ model: "gemini-pro" });

async function migrateRewindSummaries() {
  console.log("🔍 Fetching sessions with responses but no summary...");

  const sessions = await prisma.rewindSession.findMany({
    where: {
      summary: null,
      responses: {
        not: Prisma.DbNull,
      },
    },
  });

  console.log(`📊 Found ${sessions.length} sessions to migrate.`);

  for (const session of sessions) {
    try {
      console.log(`🔄 Summarizing session ${session.id}...`);
      
      const responses = session.responses as any;
      if (!responses || Object.keys(responses).length === 0) {
        console.log(`⏩ Skipping session ${session.id} (no responses).`);
        continue;
      }

      const formattedResponses = Object.entries(responses)
        .map(([id, res]: [string, any]) => `${id}: ${res.shortSummary}`)
        .join("\n");

      const prompt = `
        You are an AI assistant that summarizes reflective sessions. 
        Below are the short reflections from a user's Rewind session with their AI partner.
        Based on these responses, generate a cohesive, single-paragraph summary (2-3 sentences) that captures the essence of their day and their current state of mind.
        Do not use placeholders. Speak directly about the user's experiences.

        Reflections:
        ${formattedResponses}

        Summary:
      `;

      const result = await model.generateContent(prompt);
      const summary = result.response.text().trim();

      await prisma.rewindSession.update({
        where: { id: session.id },
        data: { summary },
      });

      console.log(`✅ Updated session ${session.id}.`);
    } catch (error) {
      console.error(`❌ Failed to migrate session ${session.id}:`, error);
    }
  }

  console.log("\n✨ Migration complete!");
}

migrateRewindSummaries()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
