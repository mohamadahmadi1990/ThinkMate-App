# Sentence Type MVP

Minimal Next.js App Router MVP that classifies a short input as a word, number, or sentence type using the OpenAI Responses API.

## Setup

Install dependencies:

```bash
npm install
```

Create `.env.local`:

```env
OPENAI_API_KEY=your_api_key_here
OPENAI_MODEL=gpt-5.4-nano
```

## Run

Start the development server:

```bash
npm run dev
```

Open http://localhost:3000.

## Checks

```bash
npm run lint
npm run build
```
