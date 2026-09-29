import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const manifest = JSON.parse(
  readFileSync(new URL("../upstream-manifest.json", import.meta.url)),
);
const overrides = manifest.overrides || {};
for (const [file, override] of Object.entries(overrides)) {
  if (!manifest.files[file] || !override.reason || !override.sha256) {
    throw new Error(`Invalid documented upstream override: ${file}`);
  }
}
const mismatches = Object.entries(manifest.files).filter(([file, hash]) => {
  return (
    createHash("sha256")
      .update(readFileSync(new URL(`../${file}`, import.meta.url)))
      .digest("hex") !== (overrides[file]?.sha256 || hash)
  );
});
if (mismatches.length)
  throw new Error(
    `Upstream files changed: ${mismatches.map(([file]) => file).join(", ")}`,
  );
console.log(
  `${Object.keys(manifest.files).length - Object.keys(overrides).length} original ReTale files match ${manifest.commit}; ${Object.keys(overrides).length} documented display overrides verified.`,
);
