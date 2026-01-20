import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { OrchestratorClient } from "./client.js";

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    console.debug(`[LEARNINGS] Path not accessible: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

export async function loadLearnings(
  client: OrchestratorClient,
  repo: string,
  destPath: string
): Promise<void> {
  const learnings = await client.getLearnings(repo);

  if (learnings.length === 0) {
    return;
  }

  await mkdir(dirname(destPath), { recursive: true });

  const content = formatLearningsAsMarkdown(
    learnings.map((l) => ({
      content: l.content,
      spec: l.spec,
      createdAt: l.createdAt,
    }))
  );

  await writeFile(destPath, content, "utf-8");
}

function formatLearningsAsMarkdown(
  learnings: Array<{ content: string; spec: string; createdAt: Date }>
): string {
  const lines = ["# Learnings from Previous Tasks", ""];

  for (const learning of learnings) {
    lines.push(`## From: ${learning.spec.slice(0, 50)}...`);
    lines.push("");
    lines.push(learning.content);
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  return lines.join("\n");
}

export interface ParsedLearning {
  content: string;
  spec: string;
}

export async function saveLearnings(
  client: OrchestratorClient,
  sourcePath: string,
  spec: string
): Promise<ParsedLearning[]> {
  if (!(await fileExists(sourcePath))) {
    return [];
  }

  const content = await readFile(sourcePath, "utf-8");
  const learnings = parseLearningsFromMarkdown(content, spec);

  return learnings;
}

export function parseLearningsFromMarkdown(
  content: string,
  spec: string
): ParsedLearning[] {
  const learnings: ParsedLearning[] = [];

  const sections = content.split(/^## /m).filter((s) => s.trim());

  for (const section of sections) {
    const lines = section.split("\n");
    const headerLine = lines[0] ?? "";

    if (
      headerLine.toLowerCase().includes("learning") ||
      headerLine.toLowerCase().includes("insight") ||
      headerLine.toLowerCase().includes("note")
    ) {
      const contentLines = lines.slice(1).filter((l) => l.trim());
      if (contentLines.length > 0) {
        learnings.push({
          content: contentLines.join("\n").trim(),
          spec,
        });
      }
    }
  }

  if (learnings.length === 0 && content.trim()) {
    const cleanContent = content
      .replace(/^#.*$/gm, "")
      .replace(/^---$/gm, "")
      .trim();

    if (cleanContent) {
      learnings.push({
        content: cleanContent,
        spec,
      });
    }
  }

  return learnings;
}

export function getLearningsPath(repoDir: string): string {
  return join(repoDir, ".ai", "learnings.md");
}

export function getNewLearningsPath(repoDir: string): string {
  return join(repoDir, ".ai", "new-learnings.md");
}
