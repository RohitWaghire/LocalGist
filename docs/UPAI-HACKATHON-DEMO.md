# UPAI Hackdays Demo Guide

## One-line pitch

LocalGist turns private meeting and interview transcripts into evidence-backed decision briefs without sending the source material to the cloud.

## Judge walkthrough

1. Launch LocalGist and add the included `docs/sample-transcript.txt` with the plus button.
2. Select the transcript and ask: `Why do new teams stall during onboarding?`
3. Choose **Decision brief** and click **Find insights**.
4. Show the recommendation and the evidence summary.
5. Point out that each quote is checked against the original source and marked **Verified source quote** or **Needs verification**.
6. Show the risks and follow-up questions.
7. Click **Export brief** to create a Markdown decision brief.

## What is new in this direction

- The product has moved from general transcript browsing to an evidence-to-action workflow.
- Model output is constrained to a structured decision format.
- Citations are verified locally after model generation instead of being trusted blindly.
- The UI exposes the difference between local AI synthesis and extractive fallback analysis.
- Results can be exported as a useful Markdown artifact.

## Privacy and responsible AI

- Transcript content stays on the user's computer.
- Optional synthesis uses a local Ollama endpoint.
- The app does not treat an unverified model quote as trusted evidence.
- The original source remains available for inspection before acting on a recommendation.

## Honest project history

LocalGist started as a local transcript-insight prototype. This hackathon direction reuses its Electron shell, local server, import flow, and fallback analysis while adding the decision-brief workflow, citation verification, structured output, and export behavior.
