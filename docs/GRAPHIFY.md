# FuelPro Graphify — Code Intelligence

FuelPro uses the official open-source Graphify CLI (PyPI package: graphifyy; executable: graphify) to build a queryable knowledge graph of the repository. This is a developer/code-intelligence tool, not a replacement for FuelPro's production database or business records.

## What is indexed

- TypeScript, TSX, JavaScript and other supported source files through local AST parsing.
- Cross-file imports, calls, inheritance and structural relationships.
- Source locations and edge provenance.
- Documentation and supported non-code files when semantic extraction is explicitly enabled.

Graphify emits graphify-out/graph.json, graphify-out/GRAPH_REPORT.md and an interactive graphify-out/graph.html. Generated output and caches are intentionally ignored by Git and uploaded as CI artifacts.

## Install

Requirements: Python 3.11+ and uv.

    uv tool install "graphifyy[openai,gemini,anthropic,ollama,bedrock,svg,leiden,sql]"
    npm run graphify:doctor
    npm run graphify:build

The standard build is deterministic and local: graphify extract . --code-only, followed by graphify cluster-only . to generate the community report and visualization. The SQL extra is installed so SQL migrations are parsed rather than silently skipped. It does not send FuelPro source code or documentation to an AI provider and does not need an API key.

## Query and navigation

    npm run graphify:query -- "where is station access enforced?"
    npm run graphify:explain -- "StationAccess"
    npm run graphify:path -- "PointOfSale" "SalesInvoice"
    npm run graphify:update
    npm run graphify:doctor

Use real node labels and paths from the generated graph. Graphify returns ambiguity/no-match exit codes rather than silently guessing a node.

## Optional semantic extraction and AI providers

Semantic extraction is opt-in. Set GRAPHIFY_SEMANTIC=1 before npm run graphify:build. Choose a backend with GRAPHIFY_BACKEND or let Graphify auto-detect from configured provider environment variables. Provider credentials must be stored in GitHub Actions Secrets or a trusted server-side secret manager; never place them in VITE_* variables, source files, this document, graph output, or command-line arguments.

Supported provider families in the upstream Graphify release include:

| Provider | Server-side environment |
| --- | --- |
| Anthropic Claude | ANTHROPIC_API_KEY |
| OpenAI and compatible endpoints (including Qwen) | OPENAI_API_KEY, optional OPENAI_BASE_URL, OPENAI_MODEL; for Qwen, set QWEN_API_KEY and OPENAI_BASE_URL to its compatible-mode endpoint; the wrapper maps QWEN_API_KEY to OPENAI_API_KEY when that endpoint is configured |
| Google Gemini | GEMINI_API_KEY or GOOGLE_API_KEY |
| DeepSeek | DEEPSEEK_API_KEY |
| Moonshot / Kimi | MOONSHOT_API_KEY |
| Azure OpenAI | AZURE_OPENAI_API_KEY, AZURE_OPENAI_ENDPOINT |
| AWS Bedrock | Standard AWS credential chain |
| Ollama | OLLAMA_BASE_URL and optional OLLAMA_MODEL |

Qwen and other OpenAI-compatible providers can be connected through the provider's compatible-mode endpoint using the OpenAI-compatible backend and a server-side key. Use the provider's documented base URL and model identifier. A key for one provider is not necessarily valid at another provider's endpoint.

Graphify's auto-detection order and backend names can change with upstream releases. Pin/upgrade the CLI deliberately and consult its current provider documentation before changing production provider settings. A missing/invalid credential must fail semantic extraction clearly; it must not silently claim a successful AI analysis.

## GitHub Actions

The Graphify Code Intelligence workflow builds a local code-only graph for pushes, pull requests and scheduled refreshes. It uploads the generated graph/report/HTML as a run artifact. A manually dispatched run can opt into semantic extraction; provider keys are read only from GitHub Secrets. Fork pull requests run code-only, so secrets are never exposed to untrusted PR code.

Configure any desired provider as GitHub Actions repository Secrets using the exact environment variable names above. Configure GRAPHIFY_BACKEND as a repository Variable when you need to force a backend. No provider secret is required for the normal code graph.

## Safety and scope

- Graphify scans repository source; it does not connect to production customer data, Supabase tables, M-PESA records, or live FuelPro user accounts.
- The ignore file excludes local secrets, uploads, generated output, dependencies and build products.
- Never add credentials, user records, production database dumps or private customer documents to the graph corpus.
- Semantic mode sends eligible documentation/non-code inputs to the selected provider. Review the ignore list and provider data-residency terms before enabling it.
- The graph is an aid for code navigation. It is not a source of truth for runtime behavior; verify findings against source and tests.
