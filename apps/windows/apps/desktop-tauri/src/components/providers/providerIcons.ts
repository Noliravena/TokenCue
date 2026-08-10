// Brand identity for every provider the app can show: the tile swatch, the
// bundled mark, and the letter used when a provider ships no asset. Originally
// ported from the retired `rust/src/native_ui` registries, which no longer
// exist — this file is now the single source of truth, so a new provider needs
// an entry here (the catalog test in providerIcons.test.ts enforces that).

import abacus from "./icons/ProviderIcon-abacus.svg?raw";
import alibaba from "./icons/ProviderIcon-alibaba.svg?raw";
import amp from "./icons/ProviderIcon-amp.svg?raw";
import antigravity from "./icons/ProviderIcon-antigravity.svg?raw";
import augment from "./icons/ProviderIcon-augment.svg?raw";
import bedrock from "./icons/ProviderIcon-bedrock.svg?raw";
import claude from "./icons/ProviderIcon-claude.svg?raw";
import codebuff from "./icons/ProviderIcon-codebuff.svg?raw";
import codex from "./icons/ProviderIcon-codex.svg?raw";
import commandcode from "./icons/ProviderIcon-commandcode.svg?raw";
import copilot from "./icons/ProviderIcon-copilot.svg?raw";
import crof from "./icons/ProviderIcon-crof.svg?raw";
import crossmodel from "./icons/ProviderIcon-crossmodel.svg?raw";
import cursor from "./icons/ProviderIcon-cursor.svg?raw";
import deepgram from "./icons/ProviderIcon-deepgram.svg?raw";
import deepinfra from "./icons/ProviderIcon-deepinfra.svg?raw";
import aiand from "./icons/ProviderIcon-aiand.svg?raw";
import clinepass from "./icons/ProviderIcon-clinepass.svg?raw";
import longcat from "./icons/ProviderIcon-longcat.svg?raw";
import neuralwatt from "./icons/ProviderIcon-neuralwatt.svg?raw";
import zoommate from "./icons/ProviderIcon-zoommate.svg?raw";
import zenmux from "./icons/ProviderIcon-zenmux.svg?raw";
import deepseek from "./icons/ProviderIcon-deepseek.svg?raw";
import doubao from "./icons/ProviderIcon-doubao.svg?raw";
import elevenlabs from "./icons/ProviderIcon-elevenlabs.svg?raw";
import factory from "./icons/ProviderIcon-factory.svg?raw";
import gemini from "./icons/ProviderIcon-gemini.svg?raw";
import grok from "./icons/ProviderIcon-grok.svg?raw";
import groq from "./icons/ProviderIcon-groq.svg?raw";
import jetbrains from "./icons/ProviderIcon-jetbrains.svg?raw";
import kilo from "./icons/ProviderIcon-kilo.svg?raw";
import kimi from "./icons/ProviderIcon-kimi.svg?raw";
import kiro from "./icons/ProviderIcon-kiro.svg?raw";
import llmproxy from "./icons/ProviderIcon-llmproxy.svg?raw";
import manus from "./icons/ProviderIcon-manus.svg?raw";
import mimo from "./icons/ProviderIcon-mimo.svg?raw";
import minimax from "./icons/ProviderIcon-minimax.svg?raw";
import moonshot from "./icons/ProviderIcon-moonshot.svg?raw";
import mistral from "./icons/ProviderIcon-mistral.svg?raw";
import notion from "./icons/ProviderIcon-notion.svg?raw";
import xai from "./icons/ProviderIcon-xai.svg?raw";
import ollama from "./icons/ProviderIcon-ollama.svg?raw";
import opencode from "./icons/ProviderIcon-opencode.svg?raw";
import opencodego from "./icons/ProviderIcon-opencodego.svg?raw";
import openrouter from "./icons/ProviderIcon-openrouter.svg?raw";
import perplexity from "./icons/ProviderIcon-perplexity.svg?raw";
import qoder from "./icons/ProviderIcon-qoder.svg?raw";
import sakana from "./icons/ProviderIcon-sakana.svg?raw";
import stepfun from "./icons/ProviderIcon-stepfun.svg?raw";
import sub2api from "./icons/ProviderIcon-sub2api.svg?raw";
import t3chat from "./icons/ProviderIcon-t3chat.svg?raw";
import venice from "./icons/ProviderIcon-venice.svg?raw";
import vertexai from "./icons/ProviderIcon-vertexai.svg?raw";
import warp from "./icons/ProviderIcon-warp.svg?raw";
import windsurf from "./icons/ProviderIcon-windsurf.svg?raw";
import zai from "./icons/ProviderIcon-zai.svg?raw";
import synthetic from "./icons/ProviderIcon-synthetic.svg?raw";
import clawrouter from "./icons/ProviderIcon-clawrouter.svg?raw";

/**
 * Normalize every paint in a bundled brand SVG to `currentColor`.
 *
 * The assets arrive in three shapes — white-on-transparent, dark-on-transparent
 * and the odd gradient — so rendering them as-authored produced marks that
 * vanished on half the tiles. Flattening every fill/stroke (attribute form,
 * inline `style` form and `url(#gradient)` references alike) means the badge
 * decides the ink once, and the brand mark always reads at 16px.
 */
function tint(raw: string): string {
  const keep = /^(none|currentcolor|transparent|inherit)$/i;
  return (
    raw
      // fill="…" / stroke="…" attributes, including url(#gradient) refs.
      .replace(/(fill|stroke)="([^"]*)"/gi, (match, prop: string, value: string) =>
        keep.test(value.trim()) ? match : `${prop}="currentColor"`,
      )
      // `fill: #999` / `stroke:url(#…)` inside style="" attributes and <style> blocks.
      .replace(
        /(fill|stroke)\s*:\s*([^;"'}]+)/gi,
        (match, prop: string, value: string) =>
          keep.test(value.trim()) ? match : `${prop}:currentColor`,
      )
  );
}

/**
 * Ink used on a tile of `hex`. Brands span pure black (OpenAI, Cursor) to
 * near-fluorescent green (Codebuff), so the glyph color is derived from the
 * tile's relative luminance instead of being hard-coded to white.
 */
function inkFor(hex: string): string {
  const value = hex.replace("#", "");
  const full =
    value.length === 3
      ? value
          .split("")
          .map((char) => char + char)
          .join("")
      : value;
  const channel = (offset: number) => {
    const srgb = parseInt(full.slice(offset, offset + 2), 16) / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  const luminance =
    0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
  return luminance > 0.45 ? "#141210" : "#ffffff";
}

export interface ProviderIcon {
  /** CLI-style provider id (lowercase, normalized). */
  id: string;
  /** Brand hex color — the badge tile fill. */
  brandColor: string;
  /** Single-character fallback used when no SVG is available. */
  fallbackLetter: string;
  /** Raw SVG markup when the provider ships a brand asset. */
  svgPath?: string;
  /**
   * Optional CSS `background-image` painted over `brandColor`. Reserved for
   * the handful of brands whose mark is a gradient (Gemini) rather than a
   * flat swatch; `brandColor` stays a plain hex so `color-mix()` still works.
   */
  tileImage?: string;
  /** Explicit glyph color; defaults to the contrast pick for `brandColor`. */
  glyphColor?: string;
}

const RAW: Record<string, string> = {
  abacus: tint(abacus),
  alibaba: tint(alibaba),
  amp: tint(amp),
  antigravity: tint(antigravity),
  augment: tint(augment),
  bedrock: tint(bedrock),
  claude: tint(claude),
  codebuff: tint(codebuff),
  codex: tint(codex),
  commandcode: tint(commandcode),
  copilot: tint(copilot),
  crof: tint(crof),
  crossmodel: tint(crossmodel),
  cursor: tint(cursor),
  deepgram: tint(deepgram),
  deepinfra: tint(deepinfra),
  aiand: tint(aiand),
  clinepass: tint(clinepass),
  longcat: tint(longcat),
  neuralwatt: tint(neuralwatt),
  zoommate: tint(zoommate),
  zenmux: tint(zenmux),
  deepseek: tint(deepseek),
  doubao: tint(doubao),
  elevenlabs: tint(elevenlabs),
  factory: tint(factory),
  gemini: tint(gemini),
  grok: tint(grok),
  groq: tint(groq),
  jetbrains: tint(jetbrains),
  kilo: tint(kilo),
  kimi: tint(kimi),
  kiro: tint(kiro),
  llmproxy: tint(llmproxy),
  manus: tint(manus),
  mimo: tint(mimo),
  minimax: tint(minimax),
  moonshot: tint(moonshot),
  notion: tint(notion),
  xai: tint(xai),
  mistral: tint(mistral),
  ollama: tint(ollama),
  opencode: tint(opencode),
  opencodego: tint(opencodego),
  openrouter: tint(openrouter),
  perplexity: tint(perplexity),
  qoder: tint(qoder),
  sakana: tint(sakana),
  stepfun: tint(stepfun),
  sub2api: tint(sub2api),
  t3chat: tint(t3chat),
  venice: tint(venice),
  vertexai: tint(vertexai),
  warp: tint(warp),
  windsurf: tint(windsurf),
  zai: tint(zai),
  synthetic: tint(synthetic),
  clawrouter: tint(clawrouter),
};

/**
 * Registry of provider icons. Matches the entries in
 * `rust/src/native_ui/provider_icons.rs` and pulls brand colors / fallback
 * letters from `rust/src/native_ui/theme.rs::{provider_color, provider_icon}`.
 */
export const PROVIDER_ICON_REGISTRY: Record<string, ProviderIcon> = {
  alibaba:     { id: "alibaba",     brandColor: "#ff6a00", fallbackLetter: "阿", svgPath: RAW.alibaba },
  // The token plan is Qwen/Tongyi, not Alibaba Cloud: same mark, Qwen violet.
  alibabatokenplan: { id: "alibabatokenplan", brandColor: "#615ced", fallbackLetter: "Q", svgPath: RAW.alibaba },
  amp:         { id: "amp",         brandColor: "#dc2626", fallbackLetter: "⚡", svgPath: RAW.amp },
  antigravity: { id: "antigravity", brandColor: "#60ba7e", fallbackLetter: "◉", svgPath: RAW.antigravity },
  augment:     { id: "augment",     brandColor: "#6366f1", fallbackLetter: "A", svgPath: RAW.augment },
  claude:      { id: "claude",      brandColor: "#d97757", fallbackLetter: "◈", svgPath: RAW.claude },
  codebuff:    { id: "codebuff",    brandColor: "#44ff00", fallbackLetter: "B", svgPath: RAW.codebuff },
  // OpenAI ships the flower as white-on-black; a teal tile read as a stranger.
  codex:       { id: "codex",       brandColor: "#0d0d0d", fallbackLetter: "◆", svgPath: RAW.codex },
  copilot:     { id: "copilot",     brandColor: "#24292f", fallbackLetter: "⬡", svgPath: RAW.copilot },
  cursor:      { id: "cursor",      brandColor: "#0d0d0d", fallbackLetter: "▸", svgPath: RAW.cursor },
  deepgram:    { id: "deepgram",    brandColor: "#13ef93", fallbackLetter: "D", svgPath: RAW.deepgram },
  deepinfra:   { id: "deepinfra",   brandColor: "#2a3275", fallbackLetter: "D", svgPath: RAW.deepinfra },
  aiand:       { id: "aiand",       brandColor: "#e25c2b", fallbackLetter: "&", svgPath: RAW.aiand },
  clinepass:   { id: "clinepass",   brandColor: "#61a3fa", fallbackLetter: "C", svgPath: RAW.clinepass },
  longcat:     { id: "longcat",     brandColor: "#ffd100", fallbackLetter: "L", svgPath: RAW.longcat },
  neuralwatt:  { id: "neuralwatt",  brandColor: "#38d98c", fallbackLetter: "N", svgPath: RAW.neuralwatt },
  zoommate:    { id: "zoommate",    brandColor: "#0b5cff", fallbackLetter: "Z", svgPath: RAW.zoommate },
  zenmux:      { id: "zenmux",      brandColor: "#6c5ce7", fallbackLetter: "Z", svgPath: RAW.zenmux },
  deepseek:    { id: "deepseek",    brandColor: "#4d6bfe", fallbackLetter: "D", svgPath: RAW.deepseek },
  elevenlabs:  { id: "elevenlabs",  brandColor: "#0d0d0d", fallbackLetter: "E", svgPath: RAW.elevenlabs },
  factory:     { id: "factory",     brandColor: "#ff6b35", fallbackLetter: "◎", svgPath: RAW.factory },
  gemini:      {
    id: "gemini",
    brandColor: "#6b7ce8",
    tileImage: "linear-gradient(135deg, #4285f4 0%, #9b72cb 52%, #d96570 100%)",
    glyphColor: "#ffffff",
    fallbackLetter: "✦",
    svgPath: RAW.gemini,
  },
  grok:        { id: "grok",        brandColor: "#0d0d0d", fallbackLetter: "G", svgPath: RAW.grok },
  groq:        { id: "groq",        brandColor: "#f55036", fallbackLetter: "G", svgPath: RAW.groq },
  jetbrains:   { id: "jetbrains",   brandColor: "#ff3399", fallbackLetter: "J", svgPath: RAW.jetbrains },
  kilo:        { id: "kilo",        brandColor: "#5d87ff", fallbackLetter: "K", svgPath: RAW.kilo },
  bedrock:     { id: "bedrock",     brandColor: "#ff9900", fallbackLetter: "B", svgPath: RAW.bedrock },
  kimi:        { id: "kimi",        brandColor: "#16161a", fallbackLetter: "☽", svgPath: RAW.kimi },
  kimik2:      { id: "kimik2",      brandColor: "#16161a", fallbackLetter: "☽", svgPath: RAW.kimi },
  kiro:        { id: "kiro",        brandColor: "#ff9900", fallbackLetter: "K", svgPath: RAW.kiro },
  llmproxy:    { id: "llmproxy",    brandColor: "#4f46e5", fallbackLetter: "L", svgPath: RAW.llmproxy },
  minimax:     { id: "minimax",     brandColor: "#fe603c", fallbackLetter: "M", svgPath: RAW.minimax },
  moonshot:    { id: "moonshot",    brandColor: "#16161a", fallbackLetter: "M", svgPath: RAW.moonshot },
  synthetic:   { id: "synthetic",   brandColor: "#00b7a8", fallbackLetter: "S", svgPath: RAW.synthetic },
  clawrouter:  { id: "clawrouter",  brandColor: "#ef4444", fallbackLetter: "C", svgPath: RAW.clawrouter },
  mistral:     { id: "mistral",     brandColor: "#fa520f", fallbackLetter: "M", svgPath: RAW.mistral },
  ollama:      { id: "ollama",      brandColor: "#101010", fallbackLetter: "○", svgPath: RAW.ollama },
  azureopenai: { id: "azureopenai", brandColor: "#0078d4", fallbackLetter: "A" },
  t3chat:      { id: "t3chat",      brandColor: "#8b5cf6", fallbackLetter: "T", svgPath: RAW.t3chat },
  opencode:    { id: "opencode",    brandColor: "#3b82f6", fallbackLetter: "○", svgPath: RAW.opencode },
  opencodego:  { id: "opencodego",  brandColor: "#3b82f6", fallbackLetter: "○", svgPath: RAW.opencodego },
  openrouter:  { id: "openrouter",  brandColor: "#6467f2", fallbackLetter: "R", svgPath: RAW.openrouter },
  perplexity:  { id: "perplexity",  brandColor: "#20808d", fallbackLetter: "P", svgPath: RAW.perplexity },
  vertexai:    { id: "vertexai",    brandColor: "#4285f4", fallbackLetter: "△", svgPath: RAW.vertexai },
  warp:        { id: "warp",        brandColor: "#6366f1", fallbackLetter: "W", svgPath: RAW.warp },
  windsurf:    { id: "windsurf",    brandColor: "#09b6a2", fallbackLetter: "W", svgPath: RAW.windsurf },
  wayfinder:   { id: "wayfinder",   brandColor: "#14b8a6", fallbackLetter: "W" },
  zai:         { id: "zai",         brandColor: "#e85a6a", fallbackLetter: "Z", svgPath: RAW.zai },
  // Aliases / Rust-side normalizations without their own SVG.
  nanogpt:     { id: "nanogpt",     brandColor: "#687fa1", fallbackLetter: "N" },
  infini:      { id: "infini",      brandColor: "#687fa1", fallbackLetter: "I" },
  abacus:      { id: "abacus",      brandColor: "#7c3aed", fallbackLetter: "A", svgPath: RAW.abacus },
  manus:       { id: "manus",       brandColor: "#34322d", fallbackLetter: "M", svgPath: RAW.manus },
  mimo:        { id: "mimo",        brandColor: "#ff6900", fallbackLetter: "M", svgPath: RAW.mimo },
  doubao:      { id: "doubao",      brandColor: "#2563eb", fallbackLetter: "D", svgPath: RAW.doubao },
  commandcode: { id: "commandcode", brandColor: "#44ff00", fallbackLetter: "C", svgPath: RAW.commandcode },
  crof:        { id: "crof",        brandColor: "#7c3aed", fallbackLetter: "C", svgPath: RAW.crof },
  crossmodel:  { id: "crossmodel",  brandColor: "#c084fc", fallbackLetter: "X", svgPath: RAW.crossmodel },
  qoder:       { id: "qoder",       brandColor: "#2563eb", fallbackLetter: "Q", svgPath: RAW.qoder },
  sakana:      { id: "sakana",      brandColor: "#0ea5e9", fallbackLetter: "S", svgPath: RAW.sakana },
  stepfun:     { id: "stepfun",     brandColor: "#2c6bf2", fallbackLetter: "S", svgPath: RAW.stepfun },
  sub2api:     { id: "sub2api",     brandColor: "#2dc6d8", fallbackLetter: "S", svgPath: RAW.sub2api },
  venice:      { id: "venice",      brandColor: "#0d0d0d", fallbackLetter: "V", svgPath: RAW.venice },
  openai:      { id: "openai",      brandColor: "#0d0d0d", fallbackLetter: "O", svgPath: RAW.codex },
  chutes:      { id: "chutes",      brandColor: "#ff5c35", fallbackLetter: "C" },
  litellm:     { id: "litellm",     brandColor: "#0ea5e9", fallbackLetter: "L" },
  poe:         { id: "poe",         brandColor: "#5d5fef", fallbackLetter: "P" },
  devin:       { id: "devin",       brandColor: "#111827", fallbackLetter: "D" },
  zed:         { id: "zed",         brandColor: "#084ccf", fallbackLetter: "Z" },
  qwencloud:   { id: "qwencloud",   brandColor: "#615ced", fallbackLetter: "Q", svgPath: RAW.alibaba },
  notion:      { id: "notion",      brandColor: "#0d0d0d", fallbackLetter: "N", svgPath: RAW.notion },
  xai:         { id: "xai",         brandColor: "#0d0d0d", fallbackLetter: "X", svgPath: RAW.xai },
};

const ALIASES: Record<string, string> = {
  droid: "factory",
  "z.ai": "zai",
  "vertex ai": "vertexai",
  "jetbrains ai": "jetbrains",
  "kimi k2": "kimik2",
  tongyi: "alibaba",
  qwen: "qwencloud",
  "qwen cloud": "qwencloud",
  "qwen-cloud": "qwencloud",
  "notion ai": "notion",
  "notion-ai": "notion",
  notionai: "notion",
  qianwen: "alibaba",
  "alibaba token plan": "alibabatokenplan",
  "alibaba-token-plan": "alibabatokenplan",
  "alibaba-token": "alibabatokenplan",
  "bailian-token-plan": "alibabatokenplan",
  "open router": "openrouter",
  "aws bedrock": "bedrock",
  "aws-bedrock": "bedrock",
  "mistral ai": "mistral",
  "warp terminal": "warp",
  "warp ai": "warp",
  manicode: "codebuff",
  "deep seek": "deepseek",
  "deep-seek": "deepseek",
  "deep infra": "deepinfra",
  "deep-infra": "deepinfra",
  di: "deepinfra",
  "ai&": "aiand",
  "ai-and": "aiand",
  "ai and": "aiand",
  "zen-mux": "zenmux",
  "cline-pass": "clinepass",
  "long-cat": "longcat",
  lc: "longcat",
  "neural-watt": "neuralwatt",
  nw: "neuralwatt",
  "zoom-mate": "zoommate",
  "zoom mate": "zoommate",
  codeium: "windsurf",
  "xiaomi mimo": "mimo",
  xiaomimimo: "mimo",
  "command code": "commandcode",
  "command-code": "commandcode",
  "cross model": "crossmodel",
  "cross-model": "crossmodel",
  "sakana ai": "sakana",
  "sakana-ai": "sakana",
  "step fun": "stepfun",
  "step-fun": "stepfun",
  "sub-2-api": "sub2api",
  "sub 2 api": "sub2api",
  "openai api": "openai",
  "openai-api": "openai",
  openaiapi: "openai",
  "azure openai": "azureopenai",
  "azure-openai": "azureopenai",
  "t3 chat": "t3chat",
  "t3-chat": "t3chat",
  // xai is its own Management API provider (not an alias of consumer Grok).
  "x.ai": "xai",
  "x-ai": "xai",
  supergrok: "grok",
  "super-grok": "grok",
  "eleven labs": "elevenlabs",
  "eleven-labs": "elevenlabs",
  "11labs": "elevenlabs",
  dg: "deepgram",
  groqcloud: "groq",
  "groq cloud": "groq",
  "groq-cloud": "groq",
  "llm proxy": "llmproxy",
  "llm-proxy": "llmproxy",
  "chutes ai": "chutes",
  "chutes-ai": "chutes",
  "lite llm": "litellm",
  "lite-llm": "litellm",
  "zed ai": "zed",
  "zed-ai": "zed",
};

function normalize(id: string): string {
  const lower = id.toLowerCase();
  const aliased = ALIASES[lower];
  if (aliased) return aliased;
  return lower.replace(/[ \-]/g, "");
}

/** Return the registry entry for a provider id, falling back to a generic one. */
export function getProviderIcon(id: string): ProviderIcon {
  const key = normalize(id);
  return (
    PROVIDER_ICON_REGISTRY[key] ?? {
      id: key,
      brandColor: "#5d87ff",
      fallbackLetter: id.charAt(0).toUpperCase() || "●",
    }
  );
}

/**
 * Inline custom properties for a brand badge tile. Every surface that paints a
 * provider chip — tray cards, the tray footer switcher, the settings provider
 * list, the float bar — spreads this onto the tile element so the fill, the
 * glyph ink and the dark-theme lift stay defined in exactly one place.
 */
export function providerTileStyle(id: string): Record<string, string> {
  const entry = getProviderIcon(id);
  const style: Record<string, string> = {
    "--provider-tile": entry.brandColor,
    "--provider-glyph": entry.glyphColor ?? inkFor(entry.brandColor),
  };
  if (entry.tileImage) {
    style["--provider-tile-image"] = entry.tileImage;
  }
  return style;
}
