/**
 * Parse interaction blocks out of message text. This is a connector-agnostic
 * superset of the dashboard's per-feature parsers (`message-choice-parser`,
 * `message-form-parser`, `message-task-parser`, `message-followups-parser`) so
 * the exact same agent output renders identically on every surface.
 *
 * Wire markers:
 *   [FORM]\n{json}\n[/FORM]
 *   [CHOICE:<scope>( id=<id>)?]\n value=label …\n[/CHOICE]
 *   [FOLLOWUPS( id=<id>)?]\n <kind>:<payload>=<label> …\n[/FOLLOWUPS]
 *   [TASK:<threadId>]<title>[/TASK]
 *
 * Parsing is intentionally strict: a malformed block is left as plain text
 * rather than rendered as a broken control.
 */

import type {
	ChoiceInteraction,
	FollowupKind,
	FollowupOption,
	FollowupsInteraction,
	FormInteraction,
	InteractionBlock,
	InteractionField,
	InteractionFieldType,
	InteractionOption,
	TaskInteraction,
} from "../../types/interactions";

/** Hard caps mirroring the dashboard parsers — keep a runaway template safe. */
export const MAX_FORM_FIELDS = 20;
export const MAX_FOLLOWUPS = 4;
export const MAX_TASK_TITLE_LEN = 200;

// Group 2 captures the header attributes (`id=…`, `allow_custom`) in any order.
const CHOICE_RE =
	/\[[ \t]*CHOICE:[ \t]*([\w-]+)([^\]]*)\]\n([\s\S]*?)\n\[[ \t]*\/[ \t]*CHOICE[ \t]*\]/g;
const FOLLOWUPS_RE =
	/\[[ \t]*FOLLOWUPS(?:\s+id=(\S+))?[ \t]*\]\n([\s\S]*?)\n\[[ \t]*\/[ \t]*FOLLOWUPS[ \t]*\]/g;
const FORM_RE =
	/\[[ \t]*FORM[ \t]*\]\n([\s\S]*?)\n\[[ \t]*\/[ \t]*FORM[ \t]*\]/g;
const TASK_RE =
	/\[[ \t]*TASK:[ \t]*([a-f0-9-]{8,64})\]([\s\S]*?)\[[ \t]*\/[ \t]*TASK[ \t]*\]/g;

const FIELD_TYPES: ReadonlySet<InteractionFieldType> = new Set([
	"text",
	"number",
	"select",
	"checkbox",
	"secret",
	"image",
	"file",
	"date",
	"time",
	"datetime",
]);
const UNSAFE_OBJECT_FIELD_NAMES: ReadonlySet<string> = new Set([
	"__defineGetter__",
	"__defineSetter__",
	"__lookupGetter__",
	"__lookupSetter__",
	"__proto__",
	"constructor",
	"hasOwnProperty",
	"isPrototypeOf",
	"propertyIsEnumerable",
	"toLocaleString",
	"toString",
	"valueOf",
]);
const FOLLOWUP_KINDS: ReadonlySet<FollowupKind> = new Set([
	"reply",
	"navigate",
	"prompt",
]);

/** A parsed block together with the character region it occupied in the text. */
export interface InteractionRegion {
	start: number;
	end: number;
	block: InteractionBlock;
}

function randomId(prefix: string): string {
	if (
		typeof crypto !== "undefined" &&
		typeof crypto.randomUUID === "function"
	) {
		return crypto.randomUUID();
	}
	return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

/** `value=label` lines → options (shared by CHOICE). */
function parseOptionLines(body: string): InteractionOption[] {
	const options: InteractionOption[] = [];
	for (const rawLine of body.split("\n")) {
		const line = rawLine.trim();
		if (!line) continue;
		const eq = line.indexOf("=");
		if (eq < 0) continue;
		const value = line.slice(0, eq).trim();
		const label = line.slice(eq + 1).trim();
		if (!value || !label) continue;
		options.push({ value, label });
	}
	return options;
}

function parseFollowupLines(body: string): FollowupOption[] {
	const options: FollowupOption[] = [];
	for (const rawLine of body.split("\n")) {
		const line = rawLine.trim();
		if (!line) continue;
		if (options.length >= MAX_FOLLOWUPS) break;
		const eq = line.indexOf("=");
		if (eq < 0) continue;
		const head = line.slice(0, eq);
		const label = line.slice(eq + 1).trim();
		const colon = head.indexOf(":");
		let kind: FollowupKind = "reply";
		let payload = head.trim();
		if (colon > 0) {
			const maybe = head.slice(0, colon).trim().toLowerCase();
			if (FOLLOWUP_KINDS.has(maybe as FollowupKind)) {
				kind = maybe as FollowupKind;
				payload = head.slice(colon + 1).trim();
			}
		}
		if (!payload || !label) continue;
		options.push({ kind, payload, label });
	}
	return options;
}

function parseFormField(raw: unknown): InteractionField | null {
	if (!raw || typeof raw !== "object") return null;
	const r = raw as Record<string, unknown>;
	const name = typeof r.name === "string" ? r.name.trim() : "";
	const type =
		typeof r.type === "string" ? (r.type as InteractionFieldType) : "text";
	if (!name || !/^[\w.-]+$/.test(name) || UNSAFE_OBJECT_FIELD_NAMES.has(name)) {
		return null;
	}
	if (!FIELD_TYPES.has(type)) return null;
	const field: InteractionField = { name, type };
	if (typeof r.label === "string") field.label = r.label;
	if (typeof r.placeholder === "string") field.placeholder = r.placeholder;
	if (typeof r.required === "boolean") field.required = r.required;
	if (type === "select" && Array.isArray(r.options)) {
		const opts: InteractionOption[] = [];
		for (const o of r.options) {
			if (o && typeof o === "object") {
				const oo = o as Record<string, unknown>;
				if (typeof oo.value === "string" && typeof oo.label === "string") {
					opts.push({ value: oo.value, label: oo.label });
				}
			}
		}
		field.options = opts;
	}
	if (type === "image" || type === "file") {
		if (Array.isArray(r.mimeTypes)) {
			const mimes = r.mimeTypes.filter(
				(m): m is string => typeof m === "string",
			);
			if (mimes.length > 0) field.mimeTypes = mimes;
		}
		if (typeof r.maxBytes === "number" && r.maxBytes > 0) {
			field.maxBytes = r.maxBytes;
		}
	}
	return field;
}

function parseFormBody(body: string): FormInteraction | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(body.trim());
	} catch {
		// error-policy:J3 interaction bodies are untrusted transport input;
		// malformed JSON is an explicit invalid form.
		return null;
	}
	if (!parsed || typeof parsed !== "object") return null;
	const p = parsed as Record<string, unknown>;
	if (!Array.isArray(p.fields)) return null;
	const fields: InteractionField[] = [];
	for (const raw of p.fields) {
		if (fields.length >= MAX_FORM_FIELDS) break;
		const field = parseFormField(raw);
		if (field) fields.push(field);
	}
	if (fields.length === 0) return null;
	const form: FormInteraction = {
		kind: "form",
		id: typeof p.id === "string" && p.id ? p.id : randomId("form"),
		submitLabel: typeof p.submitLabel === "string" ? p.submitLabel : "Submit",
		fields,
	};
	if (typeof p.title === "string") form.title = p.title;
	if (typeof p.description === "string") form.description = p.description;
	return form;
}

function pushMatches(
	text: string,
	re: RegExp,
	build: (m: RegExpExecArray) => InteractionBlock | null,
	out: InteractionRegion[],
): void {
	re.lastIndex = 0;
	let m: RegExpExecArray | null = re.exec(text);
	while (m !== null) {
		const block = build(m);
		if (block) out.push({ start: m.index, end: m.index + m[0].length, block });
		m = re.exec(text);
	}
}

/** Find every interaction-block region in `text`, sorted by position, de-overlapped. */
export function findInteractionRegions(text: string): InteractionRegion[] {
	if (!text) return [];
	const regions: InteractionRegion[] = [];

	pushMatches(
		text,
		CHOICE_RE,
		(m): ChoiceInteraction | null => {
			const options = parseOptionLines(m[3]);
			if (options.length === 0) return null;
			const attrs = m[2] ?? "";
			const id = attrs.match(/\bid=(\S+)/)?.[1] ?? randomId("choice");
			const block: ChoiceInteraction = {
				kind: "choice",
				id,
				scope: m[1],
				options,
			};
			if (/\ballow_custom\b/.test(attrs)) block.allowCustom = true;
			return block;
		},
		regions,
	);
	pushMatches(
		text,
		FOLLOWUPS_RE,
		(m): FollowupsInteraction | null => {
			const options = parseFollowupLines(m[2]);
			if (options.length === 0) return null;
			return { kind: "followups", id: m[1] || randomId("followups"), options };
		},
		regions,
	);
	pushMatches(
		text,
		FORM_RE,
		(m): FormInteraction | null => parseFormBody(m[1]),
		regions,
	);
	pushMatches(
		text,
		TASK_RE,
		(m): TaskInteraction | null => {
			const threadId = m[1];
			const rawTitle = (m[2] ?? "").trim();
			if (!threadId || !rawTitle) return null;
			const title =
				rawTitle.length > MAX_TASK_TITLE_LEN
					? `${rawTitle.slice(0, MAX_TASK_TITLE_LEN - 1)}…`
					: rawTitle;
			return { kind: "task", threadId, title };
		},
		regions,
	);

	regions.sort((a, b) => a.start - b.start);
	// Drop any region that overlaps one already accepted (left-to-right wins).
	const accepted: InteractionRegion[] = [];
	let cursor = 0;
	for (const r of regions) {
		if (r.start < cursor) continue;
		accepted.push(r);
		cursor = r.end;
	}
	return accepted;
}

export interface ParsedInteractions {
	/** Blocks in document order. */
	blocks: InteractionBlock[];
	/** Message text with every block marker removed and whitespace tidied. */
	cleanedText: string;
}

/**
 * Parse `text` into its interaction blocks plus the human-readable text with
 * the markers stripped. The cleaned text is what a connector shows above the
 * native controls it renders from `blocks`.
 */
/**
 * Remove marker lines the parsers could not claim.
 *
 * The block regexes need an exact open/close pair. A model that emits one half,
 * misspells the close tag, or invents spacing the regex misses leaves the
 * marker in place — and it ships to the user as literal text. Live 2026-08-14, a
 * Discord reply ended with a raw `[ FOLLOWUPS ]` block listing `reply:…=Label`
 * lines, because the spaced variant did not match and nothing downstream
 * removes an unclaimed marker.
 *
 * Keyed on the marker vocabulary, not on any one dialect: a line that is
 * nothing but a bracketed interaction keyword is machinery by construction, and
 * so are the `kind:payload=label` option lines that belong to one. Prose never
 * looks like this, so dropping it cannot eat a real answer.
 */
// FORM is deliberately EXCLUDED. #14489 pins that a form whose fields were all
// rejected (prototype-pollution names) keeps its raw text: a FORM carries user
// DATA, and silently deleting it loses something the caller may still need.
// FOLLOWUPS/CHOICE/TASK are passive affordances — dropping an unrenderable chip
// costs nothing, while shipping it costs the user a face full of machinery.
const UNCLAIMED_MARKER_LINE =
	/^[ \t]*\[[ \t]*\/?[ \t]*(?:FOLLOWUPS|CHOICE|TASK)\b[^\]]*\][ \t]*$/i;
const ORPHAN_OPTION_LINE = /^[ \t]*(?:reply|value|action|url):[^\n]*=[^\n]*$/i;

function stripUnclaimedMarkers(text: string): string {
	if (!/\[[ \t]*\/?[ \t]*(?:FOLLOWUPS|CHOICE|TASK)\b/i.test(text)) {
		return text;
	}
	const kept: string[] = [];
	let insideOrphanBlock = false;
	for (const line of text.split("\n")) {
		if (UNCLAIMED_MARKER_LINE.test(line)) {
			insideOrphanBlock = !/\[[ \t]*\//.test(line);
			continue;
		}
		if (insideOrphanBlock && ORPHAN_OPTION_LINE.test(line)) continue;
		insideOrphanBlock = false;
		kept.push(line);
	}
	return kept.join("\n");
}

export function parseInteractionBlocks(text: string): ParsedInteractions {
	const regions = findInteractionRegions(text);
	// No claimable region is the LEAK path, not the safe one: a half-open or
	// misspelled marker parses to nothing and the old early return handed the
	// raw text straight to the user. Sweep residue before returning.
	if (regions.length === 0) {
		return { blocks: [], cleanedText: stripUnclaimedMarkers(text) };
	}
	const blocks: InteractionBlock[] = [];
	const parts: string[] = [];
	let cursor = 0;
	for (const r of regions) {
		if (r.start > cursor) parts.push(text.slice(cursor, r.start));
		blocks.push(r.block);
		cursor = r.end;
	}
	if (cursor < text.length) parts.push(text.slice(cursor));
	const cleanedText = stripUnclaimedMarkers(parts.join(""))
		.replace(/\n{3,}/g, "\n\n")
		.trim();
	return { blocks, cleanedText };
}

/** True when `text` contains at least one interaction block. */
export function hasInteractionBlocks(text: string): boolean {
	return findInteractionRegions(text).length > 0;
}
