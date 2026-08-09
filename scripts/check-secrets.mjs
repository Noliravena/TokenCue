import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skippedDirectories = new Set([".git", "node_modules", "target", "dist"]);
const patterns = [
  ["api-token", /sk-[A-Za-z0-9_-]{24,}/g],
  ["github-token", /gh[pousr]_[A-Za-z0-9]{30,}/g],
  ["aws-access-key", /AKIA[0-9A-Z]{16}/g],
  ["google-api-key", /AIza[0-9A-Za-z_-]{35}/g],
  ["stripe-live-key", /sk_live_[A-Za-z0-9]{16,}/g],
  ["private-key-header", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
];

const allowedSyntheticMatches = new Map([
  [
    "apps/macos/Tests/TokenCueTests/BedrockUsageStatsTests.swift|aws-access-key|1a5d44a2dca19669",
    2,
  ],
  [
    "apps/macos/Tests/TokenCueTests/ClaudeTokenAccountRoutingTests.swift|api-token|0e6d2d159f36342d",
    2,
  ],
  [
    "apps/macos/Tests/TokenCueTests/VertexAIOAuthCredentialsTests.swift|private-key-header|3021d90eb9437b2d",
    1,
  ],
]);

async function listFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && skippedDirectories.has(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

const observed = new Map();
const failures = [];
for (const path of await listFiles(root)) {
  let source;
  try {
    source = await readFile(path, "utf8");
  } catch {
    continue;
  }
  if (source.includes("\0")) continue;
  const file = relative(root, path).replaceAll("\\", "/");
  if (file === "scripts/check-secrets.mjs") continue;
  for (const [kind, expression] of patterns) {
    expression.lastIndex = 0;
    for (const match of source.matchAll(expression)) {
      const digest = createHash("sha256").update(match[0]).digest("hex").slice(0, 16);
      const key = `${file}|${kind}|${digest}`;
      if (!allowedSyntheticMatches.has(key)) failures.push(`${file}: unexpected ${kind} shape`);
      observed.set(key, (observed.get(key) ?? 0) + 1);
    }
  }
}

for (const [key, count] of allowedSyntheticMatches) {
  if (observed.get(key) !== count) failures.push(`synthetic credential fixture drift: ${key}`);
}

const vertexFixture = await readFile(
  resolve(root, "apps/macos/Tests/TokenCueTests/VertexAIOAuthCredentialsTests.swift"),
  "utf8",
);
if (!vertexFixture.includes(String.raw`"private_key": "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n"`)) {
  failures.push("Vertex OAuth private-key fixture is no longer the approved abc sentinel");
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Secret-shape gate passed; only 3 exact synthetic fixture values are allowlisted.");
}
