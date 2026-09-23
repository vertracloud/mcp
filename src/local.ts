/**
 * Access to the user's own machine disk. Only exists on the local (stdio) transport.
 * Every path comes from the user/agent; nothing the API returns is used to build a path.
 */
import AdmZip from "adm-zip";
import { lstatSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

/** Same ceiling as the API's upload route. */
export const MAX_ZIP_BYTES = 100 * 1024 * 1024;

/** Same criteria as the official CLI. */
export const DEFAULT_IGNORE = [
	"node_modules",
	".git",
	".gitignore",
	".vscode",
	".github",
	".vertraignore",
	".vertracloudignore",
	"__pycache__",
	"venv",
	".venv",
	"vendor",
	"target",
	".next",
];

const IGNORE_FILES = [".vertraignore", ".vertracloudignore"];

/** System credential folders: never go into a zip, even inside the allowed root. */
const NEVER_READ = [".ssh", ".aws", ".gnupg", ".kube", ".docker", ".npmrc", ".netrc", ".config"];

export class LocalError extends Error {
	code: string;
	constructor(code: string, message: string) {
		super(message);
		this.code = code;
	}
}

/**
 * `true` only when this process is the stdio transport on the user's own machine
 * (`createServer(key, { local: true })`). `apply_fix` uses this to reject `target: "local"`
 * on the remote server (`mcp.vertracloud.app`, no disk access at all) without needing a
 * second parameter threaded through the whole handler chain.
 */
let localModeEnabled = false;
export function setLocalMode(enabled: boolean): void {
	localModeEnabled = enabled;
}
export function isLocalMode(): boolean {
	return localModeEnabled;
}

/**
 * Allowed root for reading and writing. Every local tool stays inside it: without this, text
 * read from the platform (a log, a file, a note) could get the agent to zip `~/.ssh` and upload it.
 * Default: the folder the server was started in. `VERTRA_MCP_ROOT` overrides it.
 */
export function allowedRoot(): string {
	const configured = process.env.VERTRA_MCP_ROOT;
	const root = resolve(configured && configured.trim() ? configured : process.cwd());
	if (root === sep || root === resolve(homedir())) {
		throw new LocalError(
			"ROOT_TOO_BROAD",
			`The working folder (${root}) is too broad to read or write files. Set VERTRA_MCP_ROOT to the project folder.`,
		);
	}
	return root;
}

/** Resolves the path and rejects anything outside the allowed root. */
export function ensureInsideRoot(path: string): string {
	const root = allowedRoot();
	const full = resolve(root, path);
	if (full !== root && !full.startsWith(root + sep)) {
		throw new LocalError("PATH_OUTSIDE_ROOT", `${full} is outside the allowed folder (${root}).`);
	}
	if (full.split(sep).some((part) => NEVER_READ.includes(part))) {
		throw new LocalError("PATH_NOT_ALLOWED", `${full} is inside a system credentials folder.`);
	}
	return full;
}

function loadUserIgnore(dir: string): string[] {
	for (const file of IGNORE_FILES) {
		try {
			return readFileSync(join(dir, file), "utf8")
				.split(/\r?\n/)
				.map((line) => line.trim())
				.filter((line) => line && !line.startsWith("#"));
		} catch {
			continue;
		}
	}
	return [];
}

function matchesIgnore(name: string, patterns: string[]): boolean {
	return patterns.some((pattern) => {
		const suffix = pattern.startsWith("*") ? pattern.slice(1) : pattern;
		return name === pattern || name.endsWith(suffix);
	});
}

function walk(dir: string, root: string, patterns: string[], out: string[]): void {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (matchesIgnore(entry.name, patterns) || NEVER_READ.includes(entry.name)) continue;
			// Symlinks are not followed: the zip only takes regular files.
		if (entry.isDirectory()) walk(full, root, patterns, out);
		else if (entry.isFile()) out.push(full);
	}
}

/** Zips the folder in memory, honoring the default ignore list and the project's `.vertraignore`. */
export function zipDirectory(dir: string): Buffer {
	const root = ensureInsideRoot(dir);
	if (!statSync(root).isDirectory()) throw new LocalError("NOT_A_DIRECTORY", `${root} is not a folder.`);
	const patterns = [...DEFAULT_IGNORE, ...loadUserIgnore(root)];
	const files: string[] = [];
	walk(root, root, patterns, files);
	if (files.length === 0) throw new LocalError("EMPTY_PROJECT", `No files to upload in ${root}.`);

	const zip = new AdmZip();
	for (const file of files) {
		const dirPart = dirname(relative(root, file));
		zip.addLocalFile(file, dirPart === "." ? undefined : dirPart);
	}
	return checkSize(zip.toBuffer());
}

/** Zips loose files, all placed under `destDir` inside the zip. */
export function zipFiles(paths: string[], destDir = ""): Buffer {
	if (paths.length === 0) throw new LocalError("EMPTY_PROJECT", "No files were provided.");
	const zip = new AdmZip();
	for (const path of paths) {
		const full = ensureInsideRoot(path);
		// lstat, not stat: symlinks are not followed — pointing outside the root doesn't work.
		if (!lstatSync(full).isFile()) throw new LocalError("NOT_A_FILE", `${full} is not a regular file.`);
		zip.addLocalFile(full, destDir.replace(/^\/+/, "") || undefined);
	}
	return checkSize(zip.toBuffer());
}

function checkSize(buffer: Buffer): Buffer {
	if (buffer.length > MAX_ZIP_BYTES) {
		throw new LocalError("FILE_TOO_LARGE", `The zip is ${buffer.length} bytes; the limit is ${MAX_ZIP_BYTES}.`);
	}
	return buffer;
}

/** Writes bytes inside the allowed root. Never overwrites: an existing file is an error. */
export function writeLocalFile(dest: string, bytes: Uint8Array): { path: string; bytes: number } {
	const full = ensureInsideRoot(dest);
	mkdirSync(dirname(full), { recursive: true });
	try {
		writeFileSync(full, bytes, { flag: "wx" });
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "EEXIST") {
			throw new LocalError("DEST_EXISTS", `${full} already exists; choose another name.`);
		}
		throw err;
	}
	return { path: full, bytes: bytes.byteLength };
}

export function fileName(path: string): string {
	return basename(resolve(path));
}
