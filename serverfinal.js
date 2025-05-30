require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const pdfParse = require("pdf-parse");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const Groq = require("groq-sdk");

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());

// ========== Google Gemini setup ==========
const googleApiKey = process.env.GOOGLE_API_KEY || "AIzaSyDp1UUtqEyHN-UjDA12ovkhHYFKYlC5o6c"; // ideally from .env
const genAI = new GoogleGenerativeAI(googleApiKey);

// ========== Groq setup ==========
const groqApiKey = process.env.GROQ_API_KEY;
const groq = new Groq({ apiKey: groqApiKey });

// ========== Multer setup ==========
const uploadDisk = multer({ dest: "uploads/" }); // For Gemini route - file saved to disk
const uploadMemory = multer({ storage: multer.memoryStorage() }); // For PDF parse route - file in memory buffer

// === Google Gemini Contract analysis ===
async function analyzeContractWithGemini(filePath) {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const pdfBuffer = fs.readFileSync(filePath);
    const base64Pdf = pdfBuffer.toString("base64");

    console.log("🔹 Sending request to Gemini API...");

    const result = await model.generateContent([
      {
        inlineData: {
          mimeType: "application/pdf",
          data: base64Pdf,
        },
      },
      "Analyze this contract for 3 high-risk clauses, 2-3 compliance issues, and suggest 2-3 alternatives.",
    ]);

    console.log("✅ Response received from Gemini API:", result);

    if (!result || !result.response || !result.response.text) {
      throw new Error("Invalid response from Gemini API");
    }

    let textResponse = result.response.text();

    // Clean response
    textResponse = textResponse.replace(/\*/g, "");

    return textResponse;
  } catch (error) {
    console.error("❌ Error analyzing contract:", error);
    throw new Error("Failed to analyze contract. Details: " + error.message);
  }
}

// === Groq Chat Completion with PDF content ===
async function getGroqChatCompletion(pdfContent) {
  const prompt = `${pdfContent}\n\nCompare it with new Indian laws and highlight what are added or removed (changes).`;

  try {
    const chatCompletion = await groq.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: "llama-3.3-70b-versatile",
    });

    return chatCompletion.choices[0]?.message?.content || "No response from Groq.";
  } catch (error) {
    console.error("❌ Groq API error:", error);
    return "Error processing text with Groq.";
  }
}

// === Groq chat completion with query ===
async function getGroqChatCompletionForQuery(query) {
  try {
    const response = await groq.chat.completions.create({
      messages: [{ role: "user", content: query }],
      model: "llama-3.3-70b-versatile",
    });
    return response.choices[0]?.message?.content || "No response";
  } catch (error) {
    console.error("❌ Groq API query error:", error);
    return "Error processing query with Groq.";
  }
}

// === Routes ===

// 1. Google Gemini PDF Contract Analysis (file on disk)
app.post("/analyzecontract", uploadDisk.single("contract"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  const filePath = path.join(__dirname, req.file.path);

  try {
    const analysis = await analyzeContractWithGemini(filePath);
    res.json({ analysis });

    // Delete file after processing
    fs.unlinkSync(filePath);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 2. Groq PDF text extraction + Indian law comparison (file in memory)
app.post("/analyzepdf", uploadMemory.single("pdf"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "PDF file is required." });

  try {
    const pdfText = await pdfParse(req.file.buffer);
    const groqResponse = await getGroqChatCompletion(pdfText.text);
    res.json({ pdfContent: pdfText.text, groqResponse });
  } catch (error) {
    console.error("❌ Error processing PDF:", error);
    res.status(500).json({ error: "Error analyzing the PDF." });
  }
});

// 3. Groq free text query (POST JSON body)
app.post("/analyze", async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) return res.status(400).json({ error: "Query text is required." });

    const analysis = await getGroqChatCompletionForQuery(query);
    res.json({ analysis });
  } catch (error) {
    console.error("❌ Error fetching AI analysis:", error);
    res.status(500).json({ error: "Failed to fetch AI insights" });
  }
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
