# DevScan — GitHub Profile Analyzer

> Paste any GitHub username and instantly get an AI-powered breakdown of their dev profile.

![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)
![Tailwind](https://img.shields.io/badge/TailwindCSS-4-38bdf8?logo=tailwindcss)
![License](https://img.shields.io/badge/license-MIT-green)

## Features

- **Instant profile scan** — top languages, repos, stars, activity
- **Smart scoring algorithm** — categorizes repos as Products, Projects, or Experiments
- **Deep AI analysis** — Groq (Llama 3.3 70B) reviews each repo for showcase potential
- **Try-it-now buttons** — test with `torvalds`, `gaearon`, or any username
- **Dark, minimal UI** — built with Tailwind CSS

## Live Demo

[your-vercel-url-here]

## Tech Stack

| Layer | Tool |
|-------|------|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS v4 |
| AI | Groq (Llama 3.3 70B) API (free tier) |
| Data | GitHub REST API |
| Hosting | Vercel |

## Run Locally

```bash
git clone https://github.com/Rahul200512/devscan.git
cd devscan
npm install
```

Create a `.env.local` file:

```env
GITHUB_TOKEN=your_github_token
GROQ_API_KEY=your_groq_api_key
```

Then start the dev server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and start scanning.

## How It Works

1. Enter a GitHub username
2. DevScan fetches all public repos via the GitHub REST API
3. Each repo is scored on stars, activity, completeness, and community
4. Optional: send the repo to Gemini for an AI review with strengths, improvements, and showcase potential

## Author

Built by **Rahul** · [GitHub](https://github.com/Rahul200512)
