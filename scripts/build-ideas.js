#!/usr/bin/env node

// Fetches GitHub issues with "vetted" label and builds ideas.json
// Requires Node 18+ (built-in fetch). Zero external dependencies.
// Env vars: GITHUB_TOKEN, GITHUB_REPOSITORY (owner/repo)

const token = process.env.GITHUB_TOKEN;
const repo = process.env.GITHUB_REPOSITORY;

if (!token || !repo) {
  console.error('Missing GITHUB_TOKEN or GITHUB_REPOSITORY env vars');
  process.exit(1);
}

const API = `https://api.github.com/repos/${repo}`;
const headers = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'notbuiltyet-build',
};

const categoryTagClass = {
  Healthcare: 'tag-health',
  Agriculture: 'tag-agri',
  Education: 'tag-edu',
  Infrastructure: 'tag-infra',
  Finance: 'tag-finance',
  Environment: 'tag-env',
  Logistics: 'tag-logistics',
  Other: 'tag-other',
};

const moatCssClass = {
  'Data Moat': 'moat-data',
  'Network Effects': 'moat-network',
  Regulatory: 'moat-regulatory',
  Technical: 'moat-technical',
  'Domain Expertise': 'moat-domain',
  'First Mover': 'moat-first-mover',
  'Integration Depth': 'moat-integration',
};

function parseBody(body) {
  const sections = {};
  const parts = body.split(/^### /m).filter(Boolean);
  for (const part of parts) {
    const newline = part.indexOf('\n');
    if (newline === -1) continue;
    const heading = part.slice(0, newline).trim();
    const content = part.slice(newline + 1).trim();
    sections[heading] = content;
  }
  return sections;
}

function extractMoats(text) {
  if (!text) return [];
  const moats = [];
  const lines = text.split('\n');
  for (const line of lines) {
    const match = line.match(/^\s*-\s*\[X\]\s*(.+)/i);
    if (match) {
      const name = match[1].trim();
      if (moatCssClass[name]) {
        moats.push({ name, cssClass: moatCssClass[name] });
      }
    }
  }
  return moats;
}

function stripMarkdown(text) {
  if (!text) return '';
  let clean = text.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1');
  clean = clean.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  clean = clean.replace(/^#+\s+/gm, '');
  clean = clean.replace(/^[\s]*[-*]\s+/gm, '');
  clean = clean.replace(/^[\s]*\d+\.\s+/gm, '');
  clean = clean.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
  return clean;
}

function truncate(text, maxLen) {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen).replace(/\s+\S*$/, '') + '...';
}

function parseDescription(text, full = false) {
  if (!text) return { problem: '', solution: '', why: '' };

  // Try to extract subsections by bold headings like **The Problem**, **The Solution**, etc.
  const sectionPattern = /\*\*(?:The\s+)?(Problem|Solution|Why\s+This\s+Matters)[:\s]*\*\*/gi;
  const matches = [...text.matchAll(sectionPattern)];

  let problem = '';
  let solution = '';
  let why = '';

  if (matches.length >= 2) {
    // Extract text between matched headings
    for (let i = 0; i < matches.length; i++) {
      const start = matches[i].index + matches[i][0].length;
      const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
      const content = stripMarkdown(text.slice(start, end));
      const label = matches[i][1].toLowerCase();
      if (label === 'problem') problem = full ? content : truncate(content, 150);
      else if (label === 'solution') solution = full ? content : truncate(content, 150);
      else why = full ? content : truncate(content, 150);
    }
  } else {
    // Fallback: split by paragraphs
    const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim());
    if (paragraphs.length >= 1) problem = full ? stripMarkdown(paragraphs[0]) : truncate(stripMarkdown(paragraphs[0]), 150);
    if (paragraphs.length >= 2) solution = full ? stripMarkdown(paragraphs[1]) : truncate(stripMarkdown(paragraphs[1]), 150);
    if (paragraphs.length >= 3) why = full ? stripMarkdown(paragraphs[2]) : truncate(stripMarkdown(paragraphs[2]), 150);
  }

  return { problem, solution, why };
}

function extractViability(text) {
  if (!text) return 0;
  const match = text.match(/(\d+)\s*-\s*(\d+)%/);
  if (match) return Math.round((parseInt(match[1]) + parseInt(match[2])) / 2);
  const single = text.match(/(\d+)%/);
  if (single) return parseInt(single[1]);
  return 0;
}

async function fetchAllPages(url) {
  const results = [];
  let page = 1;
  while (true) {
    const sep = url.includes('?') ? '&' : '?';
    const res = await fetch(`${url}${sep}per_page=100&page=${page}`, { headers });
    if (!res.ok) {
      console.error(`API error: ${res.status} ${res.statusText}`);
      process.exit(1);
    }
    const data = await res.json();
    if (data.length === 0) break;
    results.push(...data);
    if (data.length < 100) break;
    page++;
  }
  return results;
}

async function countByLabel(label) {
  const issues = await fetchAllPages(`${API}/issues?labels=${label}&state=all`);
  return issues.length;
}

async function main() {
  console.log(`Fetching issues from ${repo}...`);

  const [vettedIssues, beingBuiltCount, launchedCount] = await Promise.all([
    fetchAllPages(`${API}/issues?labels=vetted&state=all`),
    countByLabel('being-built'),
    countByLabel('launched'),
  ]);

  console.log(`Found ${vettedIssues.length} vetted issues`);

  const ideas = vettedIssues.map((issue) => {
    const sections = parseBody(issue.body || '');

    const category = (sections['Category'] || 'Other').replace(/\s*\n.*/s, '').trim();
    const title = (sections['Idea Title'] || issue.title).replace(/\s*\n.*/s, '').trim();
    const description = parseDescription(sections['Problem & Solution'] || '');
    const fullDescription = parseDescription(sections['Problem & Solution'] || '', true);
    const improvement = (sections['Estimated Improvement'] || '').replace(/\s*\n.*/s, '').trim();
    const moats = extractMoats(sections['Competitive Moats']);
    const viability = extractViability(sections['Viability Estimate'] || '');
    const defensibility = (sections['Overall Defensibility'] || 'Medium').replace(/\s*\n.*/s, '').trim();
    const votes = issue.reactions?.['+1'] || 0;

    return {
      id: issue.number,
      url: issue.html_url,
      title,
      category,
      categoryClass: categoryTagClass[category] || 'tag-other',
      description,
      fullDescription,
      improvement,
      moats,
      viability,
      defensibility,
      votes,
    };
  });

  ideas.sort((a, b) => b.votes - a.votes);

  const output = {
    stats: {
      vetted: vettedIssues.length,
      beingBuilt: beingBuiltCount,
      launched: launchedCount,
    },
    ideas,
  };

  const fs = await import('node:fs');
  const path = await import('node:path');
  const outPath = path.join(process.cwd(), 'ideas.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n');
  console.log(`Wrote ${ideas.length} ideas to ideas.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
