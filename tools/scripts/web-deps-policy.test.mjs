// Policy test for web dependency hygiene: shadcn-vue must be a devDependency
// (build-time Tailwind CSS input + CLI), not a production dependency, and the
// patched overrides from 6104c42 must stay in force. FAILS at HEAD; passes
// only after Task 5 moves the package via npm.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const webPkg = JSON.parse(
  readFileSync(resolve(here, "..", "..", "web", "package.json"), "utf8"),
);
const lock = readFileSync(
  resolve(here, "..", "..", "web", "package-lock.json"),
  "utf8",
);

describe("web dependency hygiene policy", () => {
  it("shadcn-vue is not a production dependency", () => {
    assert.equal(
      webPkg.dependencies?.["shadcn-vue"],
      undefined,
      "shadcn-vue must move from dependencies to devDependencies",
    );
  });

  it("shadcn-vue is a devDependency at ^2.8.1", () => {
    assert.equal(webPkg.devDependencies?.["shadcn-vue"], "^2.8.1");
  });

  it("patched overrides from 6104c42 remain in force", () => {
    assert.equal(webPkg.overrides?.["decode-uri-component"], "^0.5.0");
    assert.equal(webPkg.overrides?.["fast-uri"], "^4.1.4");
    assert.equal(webPkg.overrides?.["qs"], "^6.16.0");
  });

  it("the lockfile records shadcn-vue under a dev (root) edge", () => {
    // package-lock.json v3: root "packages[""]"."devDependencies" holds it.
    const rootEntry = JSON.parse(lock).packages[""];
    assert.equal(rootEntry.devDependencies?.["shadcn-vue"], "^2.8.1");
    assert.equal(rootEntry.dependencies?.["shadcn-vue"], undefined);
  });

  it("the @import stays in main.css (build-time Tailwind input)", () => {
    const css = readFileSync(
      resolve(here, "..", "..", "web", "src", "assets", "css", "main.css"),
      "utf8",
    );
    assert.match(css, /@import "shadcn-vue\/tailwind\.css";/);
  });
});
