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
OPENAI_MODEL=gpt-4.1-nano
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
DATABASE_URL=postgresql://user:password@host:5432/database?sslmode=require
# Optional for Neon migrations when using a pooled DATABASE_URL:
DIRECT_URL=postgresql://user:password@host:5432/database?sslmode=require
```

## Run

Start the development server:

```bash
npm run dev
```

Open http://localhost:3000.

Local development review page:

```txt
http://localhost:3000/review
```

The review page is read-only, returns 404 in production, and shows active ephemeral inputs plus recent aggregated match events.

## Checks

```bash
npm run lint
npm run build
```

Run the classify route stability benchmark against a running app:

```bash
npm run benchmark:classify
```

Optional settings:

```bash
CLASSIFY_BASE_URL=http://127.0.0.1:3000 CLASSIFY_BENCHMARK_REPEATS=2 npm run benchmark:classify
```

The benchmark uses a fixed classification regression set and reports average, median, and p90 latency. It calls the real API route, so unseen inputs may be stored and later runs may exercise the exact-duplicate path for those same fixed inputs.

## Database

Generate the Prisma client:

```bash
npm run db:generate
```

Apply migrations:

```bash
npm run db:migrate
```

## Text Normalization

Exact duplicate checks currently use trim-only normalization. Leading and trailing whitespace are removed before lookup and storage, but case, punctuation, and internal spacing are preserved.

Examples:

- `" hello "` matches `hello`
- `Hello` and `hello` are treated as different text

## Retention Model

Raw user inputs are stored in `EphemeralInput` with a 5-minute `expiresAt` window. Matching only considers rows where `expiresAt` is still in the future.

Expired ephemeral inputs are removed opportunistically during classify requests. No queue, cron job, or external cleanup service is used for the MVP.

Aggregated match events are stored in `MatchEvent` when active-window matches reach a threshold:

- exact matches: 3 active occurrences including the current input
- strong approximate matches: 3 active occurrences including the current input

The strong approximate threshold remains `0.90`. The older `UserInput` table is no longer used by the classify flow.
