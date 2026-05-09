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
    let prompt;

    if (mode === 'detailed') {
      prompt = `You are an expert at explaining complex documents in a clear, engaging way.

Read this document and provide a detailed audio-friendly explanation. Structure it as:
- An engaging opening that explains what this document is about and why it matters (2-3 sentences)
- A thorough breakdown of the main sections or topics (5-8 key points, each 2-3 sentences)
- Important details, data, or findings worth noting
- A strong conclusion summarizing the key takeaways

Write in flowing, conversational paragraphs — no bullet points, no markdown, no headers.
It should sound great when read aloud.

Document:
${truncated}`;
    } else {
      prompt = `You are an expert at explaining complex documents in a clear, engaging way.

Read this document and provide a concise audio-friendly summary. Structure it as:
- A brief overview of what this document is about (1-2 sentences)
- The 3-5 most important key points (each in 1-2 sentences)
- A clear takeaway or conclusion

Write in flowing, conversational paragraphs — no bullet points, no markdown, no headers.
It should sound natural when read aloud. Keep it under 300 words.

Document:
${truncated}`;
    }

    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    const result = await model.generateContent(prompt);
    const summary = result.response.text();

    res.json({
      summary,
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
