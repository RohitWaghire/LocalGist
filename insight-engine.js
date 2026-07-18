const STOP_WORDS = new Set([
  "about", "after", "again", "also", "and", "are", "because", "been", "before", "begin", "being", "but", "can", "clearer", "could", "defined", "did", "does", "during", "each", "even", "first", "for", "from", "further", "guide", "have", "here", "how", "into", "its", "just", "made", "more", "most", "much", "next", "not", "only", "our", "out", "over", "same", "should", "some", "such", "than", "that", "the", "their", "them", "then", "there", "they", "this", "those", "through", "too", "under", "until", "very", "was", "were", "what", "well", "when", "where", "which", "while", "why", "will", "with", "within", "without", "would", "you", "your"
]);

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function splitSentences(text) {
  return cleanText(text)
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 36 && sentence.length <= 420);
}

function extractKeywords(documents, limit = 7) {
  const counts = new Map();

  for (const document of documents) {
    const words = cleanText(document.content)
      .toLowerCase()
      .match(/[a-z][a-z'-]{2,}/g) || [];

    for (const word of words) {
      if (!STOP_WORDS.has(word)) {
        counts.set(word, (counts.get(word) || 0) + 1);
      }
    }
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([term, count]) => ({ term, count }));
}

function makeFallbackAnalysis(documents, question) {
  const keywords = extractKeywords(documents);
  const questionWords = new Set(
    (cleanText(question).toLowerCase().match(/[a-z][a-z'-]{2,}/g) || [])
      .filter((word) => !STOP_WORDS.has(word))
  );
  const candidates = documents.flatMap((document) =>
    splitSentences(document.content).map((text) => ({ title: document.title, text }))
  );
  const ranked = candidates
    .map((candidate) => {
      const lower = candidate.text.toLowerCase();
      const overlap = [...questionWords].filter((word) => lower.includes(word)).length;
      const keywordHits = keywords.filter(({ term }) => lower.includes(term)).length;
      return { ...candidate, score: overlap * 5 + keywordHits + Math.min(candidate.text.length / 180, 1) };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, 4);

  return {
    overview: question
      ? `These passages are the strongest local evidence for: ${cleanText(question)}`
      : "This is an extractive local read of the selected transcripts. Connect Ollama for synthesized findings.",
    findings: ranked.map((item, index) => ({
      title: `Evidence ${index + 1}`,
      detail: item.text,
      evidence: [{ source: item.title, quote: item.text }]
    })),
    themes: keywords.map(({ term, count }) => ({ label: term, count })),
    followUps: question
      ? ["Which transcript provides the clearest supporting context?", "What is missing or contradicted across the selected transcripts?"]
      : ["What decision should this material inform?", "Where do the speakers agree or disagree?"]
  };
}

function parseModelResponse(text, fallback) {
  const match = String(text || "").match(/\{[\s\S]*\}/);
  if (!match) {
    return { ...fallback, overview: cleanText(text) || fallback.overview };
  }

  try {
    const parsed = JSON.parse(match[0]);
    if (typeof parsed.overview !== "string" || !Array.isArray(parsed.findings)) {
      return fallback;
    }
    return {
      overview: cleanText(parsed.overview),
      findings: parsed.findings.slice(0, 6).map((finding, index) => ({
        title: cleanText(finding.title) || `Finding ${index + 1}`,
        detail: cleanText(finding.detail),
        evidence: Array.isArray(finding.evidence) ? finding.evidence.slice(0, 3).map((item) => ({
          source: cleanText(item.source),
          quote: cleanText(item.quote)
        })) : []
      })),
      themes: Array.isArray(parsed.themes) ? parsed.themes.slice(0, 10).map((item) => ({
        label: cleanText(item.label || item),
        count: Number(item.count) || 1
      })).filter((item) => item.label) : fallback.themes,
      followUps: Array.isArray(parsed.followUps) ? parsed.followUps.slice(0, 4).map(cleanText).filter(Boolean) : fallback.followUps
    };
  } catch (error) {
    return fallback;
  }
}

module.exports = { cleanText, extractKeywords, makeFallbackAnalysis, parseModelResponse };
