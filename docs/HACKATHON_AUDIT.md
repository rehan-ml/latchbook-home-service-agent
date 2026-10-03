# Amazon Developer Hackathon requirements — checked 2 October 2026

Sources: [overview](https://amazonappdev2026.devpost.com/), [official rules](https://amazonappdev2026.devpost.com/rules), [resources](https://amazonappdev2026.devpost.com/resources), [FAQs](https://amazonappdev2026.devpost.com/details/faqs), [updates](https://amazonappdev2026.devpost.com/updates).

- Deadline: 23 October 2026, noon PDT = 24 October, 12:30 am IST.
- Primary track: Alexa+. The rules accept a self-hosted MCP server on Streamable HTTP version `2025-11-25` or later, an Agent Skill, or a simulated Alexa+ experience in a web app. Physical hardware is not required.
- The gated Alexa+ Category SDK, MCP Toolkit, CLI, and Web Simulator are **not** accessible to hackathon entrants. Latchbook does not depend on them or claim production Alexa+ installation.
- Stage one is a pass/fail track and required-tech check. Stage two weights tech implementation, design, potential impact, and idea quality equally. The rules explicitly call a single-turn Q&A bot or thin API wrapper obvious, and reward stateful, agentic workflows.
- A GitHub repo with all source/setup instructions is mandatory. Public repos need an open-source license; private repos need reviewer access. Alexa+-track technology must actually appear in executable code.
- A **public English YouTube/Vimeo demo video under three minutes is mandatory**, as are text description, tool/API/SDK product feedback, and track selection. A local runnable repo plus video is enough for Alexa+; external hosting is not required.
- A factual friction log can add up to a recommended 10% judging bonus. Document genuine obstacles, not invented complaints.
- Open Source mini-challenge requires a new additional open-source contribution/project with its own URL, repo URL, GitHub username, and description. The primary Latchbook repo alone is not automatically that extra contribution.
- AWS Builder mini-challenge requires actual AWS integration. The zero-spend plan does not assume paid AWS usage or promotional credits.
- The project gallery was not published at this check, so idea overlap cannot be certified.

## Score-to-product mapping

| Criterion | Concrete evidence to show |
|---|---|
| Tech implementation | MCP 2025-11-25 handshake, twelve callable tools, live in-browser protocol inspector, persistent interview and case state, thirteen protocol/workflow tests. |
| Design | Symptom-specific follow-up, voice when supported, reliable text fallback, citations, evidence-integrity panel, tool trace, clear approval state, copyable brief. |
| Potential impact | Homeowners and renters lose appliance/model/history/warranty context before service; Latchbook creates a useful handoff and preserves household-reported outcomes without unsupported repair claims. |
| Idea quality | Moves beyond manual Q&A: an adaptive, approval-first service-case compiler with recurring-outcome memory, provenance checks, and explicit non-action boundaries. |

## How to verify the implementation

Run `npm test` for the HTTP protocol and workflow checks, then `npm start` for the simulator and MCP endpoint. The local app needs no API key, paid hosting, or physical device. The demo video and final Devpost form are separate submission materials; neither is claimed to be part of this repository.
