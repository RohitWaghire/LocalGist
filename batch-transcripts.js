const fs = require("node:fs");
const path = require("node:path");

const { chromium } = require("playwright");

const TACTIQ_URL = "https://tactiq.io/tools/youtube-transcript";
const LINKS_PATH = path.join(__dirname, "links.txt");
const TRANSCRIPTS_DIR = path.join(__dirname, "transcripts");
const PROGRESS_PATH = path.join(__dirname, "progress.json");
const FAILURES_PATH = path.join(__dirname, "failures.csv");
const MIN_DELAY_MS = 3500;
const MAX_DELAY_MS = 6500;
const REQUEST_TIMEOUT_MS = 120000;
const TITLE_REQUEST_TIMEOUT_MS = 15000;

function parseArgs(argv) {
  const options = {
    batchSize: Number.POSITIVE_INFINITY,
    headless: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--batch-size") {
      const rawValue = argv[index + 1];
      const parsed = Number.parseInt(rawValue, 10);

      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error("`--batch-size` must be a positive integer.");
      }

      options.batchSize = parsed;
      index += 1;
      continue;
    }

    if (arg === "--headless") {
      options.headless = true;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function ensureFailuresFile() {
  if (!fs.existsSync(FAILURES_PATH)) {
    fs.writeFileSync(
      FAILURES_PATH,
      "timestamp,index,videoId,url,error,pageUrl\n",
      "utf8"
    );
  }
}

function readLinks() {
  if (!fs.existsSync(LINKS_PATH)) {
    throw new Error(`Missing input file: ${LINKS_PATH}`);
  }

  const lines = fs
    .readFileSync(LINKS_PATH, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^url$/i.test(line))
    .filter((line) => !line.startsWith("#"));

  if (lines.length === 0) {
    throw new Error("No YouTube URLs were found in links.txt.");
  }

  return lines.map((url, index) => {
    const videoId = extractVideoId(url);
    const key = videoId || `url:${url}`;

    return {
      index: index + 1,
      key,
      url,
      videoId
    };
  });
}

function extractVideoId(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    const hostname = parsed.hostname.replace(/^www\./i, "").toLowerCase();

    if (hostname === "youtu.be") {
      return parsed.pathname.replace(/^\/+/, "").split("/")[0] || null;
    }

    if (hostname.endsWith("youtube.com")) {
      if (parsed.pathname === "/watch") {
        return parsed.searchParams.get("v");
      }

      const parts = parsed.pathname.split("/").filter(Boolean);
      if (parts[0] === "shorts" || parts[0] === "embed") {
        return parts[1] || null;
      }
    }
  } catch (error) {
    return null;
  }

  return null;
}

function loadProgress() {
  if (!fs.existsSync(PROGRESS_PATH)) {
    return {
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      items: {}
    };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(PROGRESS_PATH, "utf8"));
    return {
      createdAt: parsed.createdAt || new Date().toISOString(),
      updatedAt: parsed.updatedAt || new Date().toISOString(),
      items: parsed.items && typeof parsed.items === "object" ? parsed.items : {}
    };
  } catch (error) {
    throw new Error(`Could not parse progress.json: ${error.message}`);
  }
}

function upsertProgressItems(progress, links) {
  for (const link of links) {
    const existing = progress.items[link.key] || {};
    progress.items[link.key] = {
      index: link.index,
      key: link.key,
      url: link.url,
      videoId: link.videoId,
      status: existing.status || "pending",
      attempts: existing.attempts || 0,
      title: existing.title || null,
      fileName: existing.fileName || null,
      lastError: existing.lastError || null,
      updatedAt: existing.updatedAt || null,
      completedAt: existing.completedAt || null
    };
  }

  return progress;
}

function summarizeProgress(progress, links) {
  const relevantItems = links.map((link) => progress.items[link.key]).filter(Boolean);
  const counts = {
    total: relevantItems.length,
    completed: 0,
    pending: 0,
    failed: 0,
    inProgress: 0
  };

  for (const item of relevantItems) {
    if (item.status === "completed") {
      counts.completed += 1;
    } else if (item.status === "failed") {
      counts.failed += 1;
    } else if (item.status === "in_progress") {
      counts.inProgress += 1;
    } else {
      counts.pending += 1;
    }
  }

  return counts;
}

function saveProgress(progress, links) {
  const payload = {
    createdAt: progress.createdAt,
    updatedAt: new Date().toISOString(),
    summary: summarizeProgress(progress, links),
    items: progress.items
  };

  fs.writeFileSync(PROGRESS_PATH, JSON.stringify(payload, null, 2), "utf8");
}

function sanitizeFilePart(input) {
  return (input || "")
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, "")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\.+$/g, "")
    .trim()
    .slice(0, 180);
}

function normalizeTitle(input) {
  return String(input || "")
    .replace(/\s+/g, " ")
    .replace(/\s+-\s+YouTube$/i, "")
    .trim();
}

function buildFallbackTitle(itemOrParts) {
  if (!itemOrParts) {
    return "video";
  }

  const videoId = itemOrParts.videoId || null;
  const index = itemOrParts.index || null;

  if (videoId) {
    return `video-${videoId}`;
  }

  if (index != null) {
    return `video-${index}`;
  }

  return "video";
}

function chooseFileName(item, title, progress) {
  if (item.fileName) {
    return item.fileName;
  }

  const safeTitle = sanitizeFilePart(title) || `video-${item.videoId || item.index}`;
  const baseName = `${safeTitle}.txt`;
  const transcriptPath = path.join(TRANSCRIPTS_DIR, baseName);

  const collision = Object.values(progress.items).some((otherItem) => {
    if (!otherItem || otherItem.key === item.key || !otherItem.fileName) {
      return false;
    }

    return otherItem.fileName.toLowerCase() === baseName.toLowerCase();
  });

  if (!collision && !fs.existsSync(transcriptPath)) {
    return baseName;
  }

  const suffixSeed = sanitizeFilePart(item.videoId || String(item.index)) || String(item.index);
  let candidate = `${safeTitle}__${suffixSeed}.txt`;
  let counter = 2;

  while (
    Object.values(progress.items).some((otherItem) => {
      if (!otherItem || otherItem.key === item.key || !otherItem.fileName) {
        return false;
      }

      return otherItem.fileName.toLowerCase() === candidate.toLowerCase();
    }) || fs.existsSync(path.join(TRANSCRIPTS_DIR, candidate))
  ) {
    candidate = `${safeTitle}__${suffixSeed}-${counter}.txt`;
    counter += 1;
  }

  return candidate;
}

function buildTranscriptFile(title, url, transcriptLines) {
  return [
    `Title: ${title}`,
    `URL: ${url}`,
    "",
    transcriptLines.join("\n")
  ].join("\n");
}

function csvCell(value) {
  const text = String(value ?? "");
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }
  return text;
}

function appendFailure(item, errorMessage, pageUrl) {
  const row = [
    new Date().toISOString(),
    item.index,
    item.videoId || "",
    item.url,
    errorMessage,
    pageUrl || ""
  ]
    .map(csvCell)
    .join(",");

  fs.appendFileSync(FAILURES_PATH, `${row}\n`, "utf8");
}

function randomDelayMs() {
  return Math.floor(Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS + 1)) + MIN_DELAY_MS;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForTranscript(page) {
  await page.locator("#transcript").waitFor({
    state: "visible",
    timeout: REQUEST_TIMEOUT_MS
  });

  await page.waitForFunction(
    () => {
      const transcript = document.querySelector("#transcript");
      if (!transcript) {
        return false;
      }

      const itemCount = transcript.querySelectorAll("li, a").length;
      const textLength = (transcript.textContent || "").replace(/\s+/g, "").length;
      return itemCount > 0 || textLength > 40;
    },
    {
      timeout: REQUEST_TIMEOUT_MS
    }
  );
}

async function fetchYouTubeTitleFromOEmbed(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TITLE_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
      {
        signal: controller.signal
      }
    );

    if (!response.ok) {
      return null;
    }

    const payload = await response.json();
    return normalizeTitle(payload?.title);
  } catch (error) {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveVideoTitle(page, item) {
  const pageTitle = await page.evaluate(() => {
    const pick = (...values) => {
      for (const value of values) {
        const normalized = String(value || "")
          .replace(/\s+/g, " ")
          .trim();

        if (normalized) {
          return normalized;
        }
      }

      return "";
    };

    const iframe = document.querySelector("#player");
    const selectedVideoTitle = document.querySelector("#selected-video-title");
    const firstHeading = document.querySelector("main h1, main h2, h1, h2");

    return pick(
      iframe?.getAttribute("title"),
      iframe?.getAttribute("aria-label"),
      selectedVideoTitle?.textContent,
      document.querySelector('meta[property="og:title"]')?.getAttribute("content"),
      document.querySelector('meta[name="twitter:title"]')?.getAttribute("content"),
      firstHeading?.textContent,
      document.title
    );
  });

  const normalizedPageTitle = normalizeTitle(pageTitle);
  if (normalizedPageTitle && !/^youtube transcript generator$/i.test(normalizedPageTitle)) {
    return normalizedPageTitle;
  }

  const canonicalUrl = item.videoId
    ? `https://www.youtube.com/watch?v=${item.videoId}`
    : item.url;
  const oEmbedTitle = await fetchYouTubeTitleFromOEmbed(canonicalUrl);

  if (oEmbedTitle) {
    return oEmbedTitle;
  }

  return buildFallbackTitle(item);
}

async function fetchTranscript(page, item) {
  await page.goto(TACTIQ_URL, {
    waitUntil: "domcontentloaded",
    timeout: REQUEST_TIMEOUT_MS
  });

  const form = page.locator('form[aria-label="YouTube Transcript"]');
  await form.waitFor({ state: "visible", timeout: REQUEST_TIMEOUT_MS });

  const input = form.locator('input[type="text"]');
  await input.fill(item.url);

  const submit = page.getByRole("button", { name: "Get Video Transcript" });
  await Promise.all([
    waitForTranscript(page),
    submit.click()
  ]);

  const title = await resolveVideoTitle(page, item);

  const transcriptLines = await page.locator("#transcript li").evaluateAll((items) => {
    return items
      .map((item) => {
        const timestamp = item.querySelector("code")?.textContent?.trim() || "";
        const text =
          item.querySelector("a")?.textContent?.trim() ||
          item.querySelector("span")?.textContent?.trim() ||
          item.textContent?.trim() ||
          "";

        if (!text) {
          return null;
        }

        return timestamp ? `${timestamp}\n${text}` : text;
      })
      .filter(Boolean);
  });

  if (!transcriptLines.length) {
    throw new Error("Transcript page loaded, but no transcript lines were found.");
  }

  return {
    pageUrl: page.url(),
    title,
    transcriptLines
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  ensureDirectory(TRANSCRIPTS_DIR);
  ensureFailuresFile();

  const links = readLinks();
  const progress = upsertProgressItems(loadProgress(), links);
  saveProgress(progress, links);

  const queue = links
    .map((link) => progress.items[link.key])
    .filter((item) => item && item.status !== "completed")
    .slice(0, options.batchSize);

  if (queue.length === 0) {
    console.log("Nothing to do. All links in links.txt are already completed.");
    return;
  }

  console.log(`Processing ${queue.length} video(s)...`);

  const browser = await chromium.launch({
    headless: options.headless
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    for (let index = 0; index < queue.length; index += 1) {
      const item = queue[index];
      item.status = "in_progress";
      item.attempts += 1;
      item.updatedAt = new Date().toISOString();
      saveProgress(progress, links);

      console.log(`[${index + 1}/${queue.length}] ${item.url}`);

      try {
        const result = await fetchTranscript(page, item);
        const fileName = chooseFileName(item, result.title, progress);
        const outputPath = path.join(TRANSCRIPTS_DIR, fileName);
        const outputText = buildTranscriptFile(result.title, item.url, result.transcriptLines);

        fs.writeFileSync(outputPath, outputText, "utf8");

        item.status = "completed";
        item.title = result.title;
        item.fileName = fileName;
        item.lastError = null;
        item.completedAt = new Date().toISOString();
        item.updatedAt = item.completedAt;

        saveProgress(progress, links);
        console.log(`Saved ${fileName}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const currentPageUrl = typeof page.url === "function" ? page.url() : "";

        item.status = "failed";
        item.lastError = message;
        item.updatedAt = new Date().toISOString();
        saveProgress(progress, links);

        appendFailure(item, message, currentPageUrl);
        console.error(`Failed: ${message}`);
      }

      if (index < queue.length - 1) {
        const delayMs = randomDelayMs();
        console.log(`Waiting ${delayMs}ms before the next request...`);
        await sleep(delayMs);
      }
    }
  } finally {
    await context.close();
    await browser.close();
    saveProgress(progress, links);
  }

  const summary = summarizeProgress(progress, links);
  console.log(
    `Done. Completed: ${summary.completed}, Pending: ${summary.pending}, Failed: ${summary.failed}`
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
