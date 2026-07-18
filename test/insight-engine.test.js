const test = require("node:test");
const assert = require("node:assert/strict");
const { extractKeywords, makeFallbackAnalysis, parseModelResponse } = require("../insight-engine");

const documents = [
  { title: "Interview", content: "Customers describe onboarding as slow and confusing. The new workflow reduces setup time for teams. Teams also want clearer ownership." }
];

test("extractKeywords returns meaningful frequent words", () => {
  assert.deepEqual(extractKeywords(documents, 3).map((item) => item.term), ["teams", "confusing", "customers"]);
});

test("fallback analysis provides grounded evidence", () => {
  const analysis = makeFallbackAnalysis(documents, "What slows onboarding?");
  assert.ok(analysis.findings.length > 0);
  assert.equal(analysis.findings[0].evidence[0].source, "Interview");
});

test("parseModelResponse accepts a structured model response", () => {
  const fallback = makeFallbackAnalysis(documents, "");
  const parsed = parseModelResponse('{"overview":"A concise answer.","findings":[{"title":"Friction","detail":"Onboarding is slow.","evidence":[{"source":"Interview","quote":"onboarding as slow"}]}],"themes":[{"label":"onboarding","count":2}],"followUps":["Who owns it?"]}', fallback);
  assert.equal(parsed.overview, "A concise answer.");
  assert.equal(parsed.findings[0].title, "Friction");
});
