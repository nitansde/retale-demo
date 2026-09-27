import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const manifest = JSON.parse(
  readFileSync(new URL("../upstream-manifest.json", import.meta.url)),
);
const mismatches = Object.entries(manifest.files).filter(([file, hash]) => {
  return (
    createHash("sha256")
      .update(readFileSync(new URL(`../${file}`, import.meta.url)))
      .digest("hex") !== hash
  );
});
if (mismatches.length)
  throw new Error(
    `Upstream files changed: ${mismatches.map(([file]) => file).join(", ")}`,
  );
console.log(
  `${Object.keys(manifest.files).length} original ReTale files match ${manifest.commit}.`,
);
