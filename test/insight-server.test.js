const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

process.env.OLLAMA_URL = "http://127.0.0.1:1";
const { startInsightServer } = require("../insight-server");

const DOCUMENT = {
  title: "Pilot interview",
  content: "The rollout stalled because onboarding requires three approvals before a team can begin. Leaders want ownership defined before the next launch, even though the new guide made setup much clearer."
};

async function withServer(run) {
  const transcriptsDir = await fs.mkdtemp(path.join(os.tmpdir(), "localgist-test-"));
  const handle = await startInsightServer({ transcriptsDir, port: 0 });
  try {
    await run({ ...handle, transcriptsDir });
  } finally {
    await new Promise((resolve) => handle.server.close(resolve));
    await fs.rm(transcriptsDir, { recursive: true, force: true });
  }
}

test("serves a transcript library and fallback analysis", async () => {
  await withServer(async ({ url, transcriptsDir }) => {
    await fs.writeFile(path.join(transcriptsDir, "interview.txt"), DOCUMENT.content, "utf8");
    const status = await fetch(`${url}/api/status`).then((response) => response.json());
    assert.equal(status.transcripts.length, 1);
    assert.equal(status.transcripts[0].title, "interview");

    const response = await fetch(`${url}/api/analyze`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ documents: [DOCUMENT], question: "What blocks rollout?" })
    });
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.engine, "Local extractive analysis");
    assert.ok(result.analysis.findings.length > 0);
  });
});

test("stays responsive during concurrent fallback analysis", async () => {
  await withServer(async ({ url }) => {
    const requests = Array.from({ length: 40 }, (_, index) => fetch(`${url}/api/analyze`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ documents: [{ ...DOCUMENT, title: `Interview ${index}` }], question: "What blocks rollout?" })
    }));
    const responses = await Promise.all(requests);
    assert.ok(responses.every((response) => response.status === 200));
    const payloads = await Promise.all(responses.map((response) => response.json()));
    assert.ok(payloads.every((payload) => payload.analysis.findings.length > 0));
  });
});

test("rejects oversized source selections without crashing", async () => {
  await withServer(async ({ url }) => {
    const response = await fetch(`${url}/api/analyze`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ documents: Array.from({ length: 21 }, () => DOCUMENT) })
    });
    const result = await response.json();
    assert.equal(response.status, 400);
    assert.match(result.error, /no more than 20/i);
  });
});
