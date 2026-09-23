import { z } from "zod";
import { DOCS_BASE_URL, fetchKnowledgeBase, sliceSection } from "../docs-fetch.js";
import { fail, ok } from "../result.js";
import { R, type ToolDefinition } from "./defs.js";

export const docsTools: ToolDefinition[] = [
	{
		name: "get_docs",
		description:
			"Vertra Cloud's public knowledge base: plans, prices, limits, supported languages and error codes. Consult it before stating any number. `section` trims an excerpt by title.",
		group: "docs",
		scope: null,
		annotations: R,
		inputSchema: { section: z.string().optional().describe("Title (or part of it) of the desired section") },
		handler: async (args) => {
			const section = args.section as string | undefined;
			let markdown: string;
			try {
				markdown = await fetchKnowledgeBase();
			} catch (err) {
				return fail({
					code: "DOCS_UNAVAILABLE",
					message: `Could not read ${DOCS_BASE_URL}: ${err instanceof Error ? err.message : String(err)}`,
				});
			}
			if (!section) return ok(markdown);
			const slice = sliceSection(markdown, section);
			return slice
				? ok(slice)
				: fail({ code: "SECTION_NOT_FOUND", message: `No section matching "${section}".` });
		},
	},
];
