---
name: typora-annotations
description: Read and process non-destructive Typora highlights and text comments stored under ~/Documents/typora. Use when the user mentions Typora annotations, highlights, comments, document feedback, asks what feedback exists for a Markdown file, or asks an agent to address or resolve feedback created in Typora.
---

# Typora Annotations

Use the bundled CLI instead of inspecting WebKit LocalStorage or guessing JSON paths.

## Inspect annotations

Run commands relative to this skill directory:

```bash
scripts/typora-annotations list
scripts/typora-annotations show "/absolute/path/to/document.md" --json
scripts/typora-annotations path "/absolute/path/to/document.md"
```

Treat `quote`, `prefix`, and `suffix` as the anchor. A changed document may still match by quote and context. If multiple or no credible matches exist, report the stale annotation instead of guessing.

## Address feedback

1. Read the annotation JSON with `show --json`.
2. Inspect the referenced document and verify each anchor against current content.
3. Modify the document only when the user asked to address the feedback.
4. Preserve unrelated user changes.
5. Run relevant validation for the document or project.
6. Summarize addressed and stale annotations.
7. Mark an annotation resolved only when the user asked to update annotation status:

```bash
scripts/typora-annotations resolve "/absolute/path/to/document.md" ANNOTATION_ID
```

Never delete annotations as part of ordinary feedback handling. `resolved` is auditable and reversible by editing the human-readable JSON.

## Storage contract

- Root: `~/Documents/typora`
- Index: `~/Documents/typora/index.json`
- Documents: `~/Documents/typora/annotations/**/*.annotations.json`
- Source Markdown remains unchanged until the user explicitly asks for edits.
