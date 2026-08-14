/**
 * Default persona seed for freshly created cloud agents.
 *
 * A cloud agent is created with a NAME and nothing else — no persona is
 * collected at creation time — so `agent_sandboxes.agent_config` was written as
 * `{}` and every downstream reader fell through to a stub: the shared turn and
 * the dedicated first-boot window synthesised `You are <name>, a helpful
 * assistant.`, and a dedicated container (which receives the same blob as
 * `ELIZA_AGENT_CHARACTER_JSON`) landed on the runtime's bare
 * `defaultCharacterSystemTemplate`, because a user-chosen agent name matches no
 * bundled preset. Seeding the shipped default preset (`CHARACTER_DEFINITIONS[0]`,
 * "eliza") into `agent_config` at create time fixes all four readers at once —
 * `projectSharedAgentCharacter`, `ElizaSandboxService.buildRuntimeBootstrapAgent`,
 * `buildWarmClaimCharacterPayload`, and the container's
 * `applySandboxCharacterFromEnv` — and leaves the row itself carrying a real,
 * editable persona for the character UI.
 *
 * Shape rules, dictated by those readers:
 *  - keys sit at the TOP LEVEL of `agent_config`. Only the shared turn tolerates
 *    the nested `{ character: {...} }` form; the other three are flat-only.
 *  - `name` is deliberately NOT seeded. Every reader prefers `agent_config.name`
 *    over the `agent_name` column, and `updateAgentProfile` renames only the
 *    column — a seeded name would win forever and strand the agent under its
 *    creation-time name.
 *  - `{{name}}` tokens are preserved rather than expanded, matching how the
 *    presets ship and how a rename keeps propagating. `@elizaos/core` resolves
 *    them at prompt-assembly time for container-backed agents; the shared turn
 *    resolves them in its own system-prompt builder.
 *  - `messageExamples` are emitted in the strict `{ examples: [{ name, content }] }`
 *    group form. The container normalises either form, but the warm-claim push
 *    validates against the agent's strict CharacterSchema and silently drops the
 *    legacy `[[{ user, content }]]` form.
 */

import { getDefaultStylePreset } from "@elizaos/shared";

/**
 * Persona-bearing keys. A create whose caller-supplied config already fills any
 * of these (flat, or nested under `character`) is left untouched — the caller
 * brought their own persona and the seed must not compete with it.
 */
const PERSONA_KEYS = ["system", "prompt", "bio"] as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Whether a persona field carries usable content. Mirrors what the readers
 * accept, so a blank string or an all-blank array counts as absent here exactly
 * as it does there — otherwise it would suppress the seed and still render the
 * stub.
 */
function hasPersonaValue(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) {
    return value.some((entry) => typeof entry === "string" && entry.trim().length > 0);
  }
  return false;
}

function hasPersonaKey(config: Record<string, unknown>): boolean {
  return PERSONA_KEYS.some((key) => hasPersonaValue(config[key]));
}

/**
 * Whether `agent_config` already describes a character, in either the flat or
 * the nested `{ character: {...} }` shape.
 */
export function agentConfigHasCharacter(agentConfig?: Record<string, unknown> | null): boolean {
  const config = asRecord(agentConfig);
  if (!config) return false;
  if (hasPersonaKey(config)) return true;
  const nested = asRecord(config.character);
  return nested ? hasPersonaKey(nested) : false;
}

/**
 * The shipped default preset ("eliza") projected onto the flat `agent_config`
 * persona keys. Returns a fresh object per call so a stored row never aliases
 * the preset catalog.
 */
export function buildDefaultAgentCharacterConfig(): Record<string, unknown> {
  const preset = getDefaultStylePreset();
  return {
    system: preset.system,
    bio: [...preset.bio],
    adjectives: [...preset.adjectives],
    topics: [...preset.topics],
    style: {
      all: [...preset.style.all],
      chat: [...preset.style.chat],
      post: [...preset.style.post],
    },
    postExamples: [...preset.postExamples],
    messageExamples: preset.messageExamples.map((group) => ({
      examples: group.map((turn) => ({ name: turn.user, content: { ...turn.content } })),
    })),
  };
}

/**
 * Seed the default persona under a caller's `agent_config`. Caller keys always
 * win, and a config that already carries a persona is returned unchanged, so
 * this can only ever fill the gap a persona-less create would otherwise leave.
 *
 * The one key the caller does not win is a BLANK persona field: `{ system: "" }`
 * carries no persona, and letting it survive the merge would shadow the seed and
 * put the reader back on its stub.
 */
export function withDefaultAgentCharacter(
  agentConfig?: Record<string, unknown> | null,
): Record<string, unknown> {
  const config = asRecord(agentConfig) ?? {};
  if (agentConfigHasCharacter(config)) return { ...config };
  const carried = Object.fromEntries(
    Object.entries(config).filter(([key]) => !(PERSONA_KEYS as readonly string[]).includes(key)),
  );
  return { ...buildDefaultAgentCharacterConfig(), ...carried };
}
