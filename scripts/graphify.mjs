#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const output = resolve(root, "graphify-out");
const [action = "build", ...args] = process.argv.slice(2);
const graph = resolve(output, "graph.json");

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    stdio: "inherit",
    shell: false,
    env: process.env,
  });
  if (result.error) {
    if (result.error.code === "ENOENT") {
      console.error("Graphify CLI not found. Install it with: npm run graphify:install");
    } else {
      console.error(result.error.message);
    }
    process.exit(127);
  }
  process.exit(result.status ?? 1);
}

function requireGraph() {
  if (!existsSync(graph)) {
    console.error("Graphify graph not found. Run: npm run graphify:build");
    process.exit(2);
  }
}

switch (action) {
  case "build": {
    const semantic = process.env.GRAPHIFY_SEMANTIC === "1";
    const backend = process.env.GRAPHIFY_BACKEND || (process.env.QWEN_API_KEY && process.env.OPENAI_BASE_URL ? "openai" : undefined);
    if (!process.env.OPENAI_API_KEY && process.env.QWEN_API_KEY && process.env.OPENAI_BASE_URL) {
      process.env.OPENAI_API_KEY = process.env.QWEN_API_KEY;
    }
    const commandArgs = ["extract", ".", ...(semantic ? [] : ["--code-only"])];
    if (backend) commandArgs.push("--backend", backend);
    run("graphify", commandArgs);
    break;
  }
  case "update":
    requireGraph();
    run("graphify", ["update", ".", ...args]);
    break;
  case "query":
  case "explain":
  case "path":
  case "affected":
    requireGraph();
    if (args.length === 0) {
      console.error("Missing Graphify " + action + " arguments.");
      process.exit(2);
    }
    run("graphify", [action, ...args]);
    break;
  case "export":
    requireGraph();
    run("graphify", ["export", ...args]);
    break;
  case "doctor": {
    const version = spawnSync("graphify", ["--version"], { encoding: "utf8", shell: false });
    if (version.error || version.status !== 0) {
      console.error("Graphify CLI is unavailable. Install with: npm run graphify:install");
      process.exit(1);
    }
    console.log(version.stdout.trim());
    if (existsSync(graph)) {
      const data = JSON.parse(readFileSync(graph, "utf8"));
      const rootGraph = data.graph ?? data;
      console.log(JSON.stringify({
        graph: graph,
        schema_version: rootGraph.schema_version ?? "unknown",
        graphify_version: rootGraph.graphify_version ?? "unknown",
        nodes: rootGraph.nodes?.length ?? "unknown",
        edges: rootGraph.edges?.length ?? "unknown",
      }, null, 2));
    } else {
      console.log("No graph generated yet. Run: npm run graphify:build");
    }
    break;
  }
  default:
    console.error("Unknown Graphify action. Use build, update, query, explain, path, affected, export, or doctor.");
    process.exit(2);
}
