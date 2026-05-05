#!/usr/bin/env node
/**
 * Leaf-folder file-count check.
 * Per project-structure-and-module-boundaries.md §6 + §10:
 *   No directory leaf may exceed 50 source files.
 *
 * A "leaf" is any directory that contains files (regardless of subdirectories).
 * Counts files directly in the directory (non-recursive). Excludes node_modules,
 * .next, .git, build/, dist/, coverage/, playwright-report/, test-results/.
 */
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(process.cwd());
const LIMIT = 50;
const IGNORED = new Set([
  "node_modules",
  ".next",
  ".git",
  "build",
  "dist",
  "coverage",
  "playwright-report",
  "test-results",
  ".turbo",
]);

let violations = 0;

function walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  let fileCount = 0;
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (IGNORED.has(entry.name)) continue;
      walk(join(dir, entry.name));
    } else if (entry.isFile() && !entry.name.startsWith(".")) {
      fileCount += 1;
    }
  }

  if (fileCount > LIMIT) {
    const rel = dir.slice(ROOT.length + 1) || ".";
    console.error(
      `LEAF-COUNT VIOLATION: ${rel} contains ${fileCount} files (limit ${LIMIT}).`,
    );
    violations += 1;
  }
}

walk(ROOT);

if (violations > 0) {
  console.error(
    `\n${violations} leaf-folder violation(s). Split the folder or add structure.`,
  );
  process.exit(1);
}

console.log(`OK — every leaf folder has ≤ ${LIMIT} files.`);
