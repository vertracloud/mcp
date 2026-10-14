/**
 * Access to the user's own machine disk. Only exists on the local (stdio) transport.
 * Every path comes from the user/agent; nothing the API returns is used to build a path.
 */
import AdmZip from "adm-zip";
import { constants, fstatSync, lstatSync, mkdirSync, openSync, closeSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
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
const NEVER_READ = [".ssh", ".aws", ".gnupg", ".kube", ".docker", ".azure", ".gcloud", ".oci", ".npmrc", ".netrc", ".config"];
const isNeverRead = (part: string) => NEVER_READ.includes(part.toLowerCase());

export class LocalError extends Error {
	code: string;
	constructor(code: string, message: string) {
		super(message);
		this.code = code;
	}
}

/**
 * `true` only for the stdio transport on the user's own machine. The remote server has no disk
 * access; `apply_fix` checks this to reject `target: "local"`.
 */
let localModeEnabled = false;
export function setLocalMode(enabled: boolean): void {
	localModeEnabled = enabled;
}
export function isLocalMode(): boolean {
	return localModeEnabled;
}

/**
 * Root for every local read and write. Without it, text from the platform (a log, a note) could
 * make the agent zip `~/.ssh`. Defaults to the start folder; `VERTRA_MCP_ROOT` overrides it.
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

function realOrSelf(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		return path;
	}
}

/** Closest existing ancestor of `path` (itself if it exists, even as a dangling symlink), by lstat. */
function existingAncestor(path: string): string {
	let current = path;
	while (true) {
		try {
			lstatSync(current);
			return current;
		} catch {
			const parent = dirname(current);
			if (parent === current) return current;
			current = parent;
		}
	}
}

/** `path` with every symlink resolved, also when its tail doesn't exist yet. A dangling symlink is refused. */
function resolveReal(path: string): string {
	const ancestor = existingAncestor(path);
	try {
		return join(realpathSync(ancestor), relative(ancestor, path));
	} catch {
		throw new LocalError("PATH_NOT_ALLOWED", `${path} is a broken symlink.`);
	}
}

/**
 * Rejects paths outside the allowed root, including ones that escape through a symlinked folder.
 * Returns the path with the folders resolved: use that one to open, so the checked path and the
 * accessed path are the same. The last component stays unresolved; readers refuse a symlink there.
 */
export function ensureInsideRoot(path: string): string {
	const root = allowedRoot();
	const full = resolve(root, path);
	if (full !== root && !full.startsWith(root + sep)) {
		throw new LocalError("PATH_OUTSIDE_ROOT", `${full} is outside the allowed folder (${root}).`);
	}
	const realRoot = realOrSelf(root);
	// Where the path really lands, following every link, and the same with the last component kept.
	const target = resolveReal(full);
	const safe = join(resolveReal(dirname(full)), basename(full));
	for (const real of [target, safe]) {
		if (real !== realRoot && !real.startsWith(realRoot + sep)) {
			throw new LocalError("PATH_OUTSIDE_ROOT", `${full} is outside the allowed folder (${root}).`);
		}
	}
	// Both the typed path and the resolved ones, so a symlink can't hide a credentials folder.
	if ([full, target, safe].some((p) => p.split(sep).some(isNeverRead))) {
		throw new LocalError("PATH_NOT_ALLOWED", `${full} is inside a system credentials folder.`);
	}
	return safe;
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
		if (matchesIgnore(entry.name, patterns) || isNeverRead(entry.name)) continue;
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

/**
 * Reads one regular file inside the allowed root. `O_NOFOLLOW` plus `fstat` on the open descriptor:
 * a symlink swapped in after the path check is refused, not followed.
 */
export function readLocalFile(path: string, maxBytes: number): { name: string; bytes: Buffer } {
	assertNotSensitiveFile(path);
	const full = ensureInsideRoot(path);
	let fd: number;
	try {
		fd = openSync(full, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
	} catch {
		throw new LocalError("NOT_A_FILE", `${full} could not be opened as a regular file.`);
	}
	try {
		const stat = fstatSync(fd);
		if (!stat.isFile()) throw new LocalError("NOT_A_FILE", `${full} is not a regular file.`);
		if (stat.size > maxBytes) {
			throw new LocalError("FILE_TOO_LARGE", `${full} is ${stat.size} bytes; the limit for this tool is ${maxBytes}.`);
		}
		return { name: basename(full), bytes: readFileSync(fd) };
	} finally {
		closeSync(fd);
	}
}

const SENSITIVE_NAME = new RegExp(
	"^(" +
		[
			"\\.env(\\..*)?",
			".*\\.(pem|key|p12|pfx|ppk|jks|keystore|kdbx|gpg|tfstate|tfvars)",
			"id_(rsa|dsa|ecdsa|ed25519).*",
			"\\.(npmrc|yarnrc|netrc|pgpass|pypirc|htpasswd|dockercfg|git-credentials|vault-token|my\\.cnf|s3cfg)",
			"credentials(\\..*)?",
			"kubeconfig",
			"service[-_]?account.*\\.json",
			"secrets?\\.(json|ya?ml|toml)",
		].join("|") +
		")$",
	"i",
);

/**
 * Secret files are refused as upload sources even inside the allowed root, since agent input can
 * ask for them. Checked on the typed path (resolved from the same root the read uses) and on the
 * symlink-resolved one, on the file name and on a `.git` path segment.
 */
export function assertNotSensitiveFile(path: string): void {
	const full = resolve(allowedRoot(), path);
	for (const candidate of [full, realOrSelf(full)]) {
		const segments = candidate.split(sep);
		const name = segments[segments.length - 1] ?? "";
		if (segments.some((s) => s.toLowerCase() === ".git") || SENSITIVE_NAME.test(name)) {
			throw new LocalError("SENSITIVE_FILE", `${name} looks like a secret or credential file and will not be uploaded.`);
		}
	}
}

export function fileName(path: string): string {
	return basename(resolve(path));
}
