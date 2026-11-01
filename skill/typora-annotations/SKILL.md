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

For an anchor with `scope: "svg"`, the quote belongs to a diagram, not Markdown prose.
Read the SVG at `anchor.imagePath` (or resolve `imageSource` relative to the Markdown).
`target` describes the selected element: its SVG tag, original ID, text, child-index path,
and geometry attributes. Prefer a unique stable ID, then unique text or geometry;
the child-index path is only reliable while the SVG fingerprint is unchanged.
A null `target` means a rectangular region in SVG coordinates, stored in `bounds`;
`viewBox` gives the diagram coordinate space. Inspect the elements inside that region.
Do not guess if the image changed or the target is ambiguous. `imageOccurrence` is
zero-based among references to the same image in the document. Comments remain
associated with the Markdown document, and neither the Markdown nor SVG source is
changed merely by adding a comment.

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
