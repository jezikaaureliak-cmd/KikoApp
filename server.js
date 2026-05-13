require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const pdfParse = require('pdf-parse/lib/pdf-parse.js');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Only PDF files are allowed'));
  }
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.use(express.static(path.join(__dirname)));
app.use(express.json());

app.post('/api/summarize', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No PDF file uploaded' });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(401).json({ error: 'GEMINI_API_KEY is not set in .env' });
    }

    const data = await pdfParse(req.file.buffer);
    const rawText = data.text || '';

    if (rawText.trim().length < 30) {
      return res.status(400).json({ error: 'Could not extract readable text from this PDF. It may be scanned or image-based.' });
    }

    const truncated = rawText.length > 60000 ? rawText.slice(0, 60000) + '\n\n[Document continues — summarizing the above portion]' : rawText;

    const mode = req.body.mode || 'summary';

    const prompt = `Analyze this document and return a JSON object with two outputs.

1. "summary": A concise, audio-friendly summary in 3-5 flowing sentences covering the document's key points. Write as natural prose — no bullet points, no markdown, no headers. It should sound natural when read aloud.

2. "mindmap": A mindmap structure with:
   - "center": The document's core topic (2-3 words max)
   - "nodes": Exactly 5 branch topics, each an object with a "label" (2-4 words max)

Return ONLY a valid JSON object — no markdown fences, no explanation:
{
  "summary": "...",
  "mindmap": {
    "center": "...",
    "nodes": [
      {"label": "..."},
      {"label": "..."},
      {"label": "..."},
      {"label": "..."},
      {"label": "..."}
    ]
  }
}

Document:
${truncated}`;

    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    const result = await model.generateContent(prompt);
    const raw = result.response.text().trim().replace(/^```json\s*/i, '').replace(/\s*```$/, '');

    let summary, mindmap;
    try {
      const parsed = JSON.parse(raw);
      summary = parsed.summary || '';
      mindmap = parsed.mindmap || null;
    } catch {
      summary = raw;
      mindmap = null;
    }

    res.json({
      summary,
      mindmap,
      pageCount: data.numpages,
      wordCount: rawText.split(/\s+/).filter(Boolean).length,
      filename: req.file.originalname,
      mode
    });

  } catch (err) {
    console.error('Error processing PDF:', err.message);
    if (err.status === 400 && err.message?.includes('API key')) {
      return res.status(401).json({ error: 'Invalid Gemini API key. Check your .env file.' });
    }
    if (err.message === 'Only PDF files are allowed') {
      return res.status(400).json({ error: 'Please upload a PDF file.' });
    }
    res.status(500).json({ error: err.message || 'Something went wrong processing your PDF.' });
  }
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    apiKeySet: !!process.env.GEMINI_API_KEY
  });
});

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`\n  Kiko PDF Reader → http://localhost:${PORT}\n`);
    if (!process.env.GEMINI_API_KEY) {
      console.log('  ⚠  GEMINI_API_KEY not set — add it to .env to enable summaries\n');
    }
  });
}

module.exports = app;
