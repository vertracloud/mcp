/** Generates the README's tools table from the registry. `npm run docs:tools`. */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { type ToolGroup, toolScope, tools } from "../src/tools/index.js";

const START = "<!-- tools:start -->";
const END = "<!-- tools:end -->";

const GROUP_TITLES: Record<ToolGroup, string> = {
	docs: "Documentation",
	apps: "Applications",
	deploys: "Deploys",
	envs: "Environment variables",
	files: "Files",
	network: "Network and domains",
	databases: "Databases",
	snapshots: "Snapshots",
	account: "Account",
	workspaces: "Workspaces",
	billing: "Billing",
};

export function renderToolsTable(): string {
	const groups = new Map<ToolGroup, typeof tools>();
	for (const tool of tools) {
		const list = groups.get(tool.group) ?? [];
		list.push(tool);
		groups.set(tool.group, list);
	}

	const out: string[] = [];
	for (const [group, list] of groups) {
		out.push(`#### ${GROUP_TITLES[group]}`, "", "| tool | what it does | scope | local only |", "|---|---|---|---|");
		for (const tool of list) {
			const scope = toolScope(tool);
			out.push(
				`| \`${tool.name}\` | ${tool.description.replace(/\|/g, "\\|")} | ${scope ? `\`${scope}\`` : "—"} | ${tool.local ? "yes" : ""} |`,
			);
		}
		out.push("");
	}
	return out.join("\n").trim();
}

function main(): void {
	const path = new URL("../README.md", import.meta.url);
	const readme = readFileSync(path, "utf8");
	const start = readme.indexOf(START);
	const end = readme.indexOf(END);
	if (start === -1 || end === -1) throw new Error(`README.md is missing the ${START} / ${END} markers`);
	const next = `${readme.slice(0, start + START.length)}\n\n${renderToolsTable()}\n\n${readme.slice(end)}`;
	writeFileSync(path, next);
	console.log(`README.md: ${tools.length} tools (${tools.filter((t) => t.local).length} local only).`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
