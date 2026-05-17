# Edit File Atomic Validation and Anchor Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `edit_file` fail without hidden partial writes and report anchor failures with path, line number, current content, and requested content.

**Architecture:** Keep `applyAnchoredEdits` as the pure line-edit engine, but replace string-only anchor failures with structured `EditFileError` diagnostics. `registerEditFileTool` will read, validate, diff, and stage every file in memory first; only after all files validate will it write staged files. Error text remains concise for agents/humans, while details preserve machine-readable failure information.

**Tech Stack:** TypeScript, pi extension tool API, Vitest, Node `fs/promises`, existing Wayfinder anchor and diff utilities.

---

## File structure

- Modify: `src/tools/edit-file.ts`
  - Add structured edit failure classes/types.
  - Add line-number-aware anchor resolution diagnostics.
  - Stage all per-file changes before writing any file.
  - Include failure details in thrown messages and tool result details where available.
- Modify: `test/edit-file.test.ts`
  - Update the current partial-write test to expect no writes after any file fails.
  - Add tests for line-numbered stale-anchor messages.
  - Add tests for human-readable path + line diagnostics from the registered tool.

---

### Task 1: Add structured anchor failure diagnostics

**Files:**
- Modify: `src/tools/edit-file.ts`
- Test: `test/edit-file.test.ts`

- [ ] **Step 1: Write failing unit tests for anchor mismatch diagnostics**

Add these tests inside `describe("applyAnchoredEdits", ...)` in `test/edit-file.test.ts`:

```ts
  it("reports stale anchor mismatches with line numbers and both contents", () => {
    const lines = ["alpha", "beta", "gamma"];
    const anchors = anchorsFor(lines);

    expect(() =>
      applyAnchoredEdits(lines, anchors, [
        {
          edit_type: "replace",
          anchor: formatLineWithHash("old beta", anchors[1]),
          text: "BETA"
        }
      ])
    ).toThrow(
      'anchor content mismatch for ' +
        anchors[1] +
        ' at line 2; current "beta", requested "old beta"'
    );
  });

  it("reports missing anchors with the anchor name", () => {
    const lines = ["alpha", "beta"];

    expect(() =>
      applyAnchoredEdits(lines, ["WayA", "WayB"], [
        {
          edit_type: "replace",
          anchor: "WayMissing│beta",
          text: "BETA"
        }
      ])
    ).toThrow("anchor not found: WayMissing");
  });
```

- [ ] **Step 2: Run tests to verify red**

Run:

```bash
npm test -- test/edit-file.test.ts -t "reports stale anchor mismatches"
```

Expected: FAIL because the stale-anchor message does not include `at line 2`, `current`, and `requested` in the new wording.

- [ ] **Step 3: Implement structured edit errors and line-numbered anchor mismatch messages**

In `src/tools/edit-file.ts`, replace `ResolvedEdit`/`EditFileToolDetails` near the top with:

```ts
interface ResolvedEdit {
  edit: EditOperation;
  start: number;
  end: number;
}

export interface EditFailureDetails {
  path?: string;
  anchor?: string;
  line?: number;
  fieldName?: string;
  currentContent?: string;
  requestedContent?: string;
  message: string;
}

class EditFileError extends Error {
  constructor(
    message: string,
    readonly failure: EditFailureDetails
  ) {
    super(message);
    this.name = "EditFileError";
  }
}

interface EditFileToolDetails {
  files: string[];
  diff: string;
  diffs: DiffDetails[];
  firstChangedLine?: number;
  failures?: EditFailureDetails[];
}
```

Replace `resolveAnchor` with:

```ts
function resolveAnchor(rawAnchor: string | undefined, anchors: string[], lines: string[], fieldName = "anchor"): number {
  if (!rawAnchor) {
    throw new EditFileError(`${fieldName} is missing`, { fieldName, message: `${fieldName} is missing` });
  }
  if (!rawAnchor.includes(ANCHOR_DELIMITER)) {
    const message = `${fieldName} must be a raw anchored line in the form AnchorWord${ANCHOR_DELIMITER}exact line content`;
    throw new EditFileError(message, { fieldName, message });
  }

  const { anchor, content } = splitAnchor(rawAnchor);
  if (!/^[A-Z][a-zA-Z]*$/.test(anchor)) {
    const message = `invalid anchor format: ${rawAnchor}`;
    throw new EditFileError(message, { anchor, fieldName, requestedContent: content, message });
  }

  const index = anchors.indexOf(anchor);
  if (index === -1) {
    const message = `anchor not found: ${anchor}`;
    throw new EditFileError(message, { anchor, fieldName, requestedContent: content, message });
  }

  if (lines[index] !== content) {
    const line = index + 1;
    const message = `anchor content mismatch for ${anchor} at line ${line}; current ${JSON.stringify(lines[index])}, requested ${JSON.stringify(content)}`;
    throw new EditFileError(message, {
      anchor,
      line,
      fieldName,
      currentContent: lines[index],
      requestedContent: content,
      message
    });
  }
  return index;
}
```

- [ ] **Step 4: Run focused tests to verify green**

Run:

```bash
npm test -- test/edit-file.test.ts -t "reports stale anchor mismatches|reports missing anchors"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tools/edit-file.ts test/edit-file.test.ts
git commit -m "fix: report anchor failures with line diagnostics"
```

---

### Task 2: Validate all files before writing any files

**Files:**
- Modify: `src/tools/edit-file.ts`
- Test: `test/edit-file.test.ts`

- [ ] **Step 1: Replace the partial-write test with a no-partial-write test**

In `test/edit-file.test.ts`, replace the test named `"applies valid file edits before throwing for failed files"` with:

```ts
  it("does not write any files when one file in the batch fails validation", async () => {
    const cwd = await createTempDir();
    const invalidPath = join(cwd, "invalid.txt");
    const validPath = join(cwd, "valid.txt");
    await writeFile(invalidPath, "alpha\nbeta\n", "utf8");
    await writeFile(validPath, "one\ntwo\n", "utf8");

    const invalidAnchors = anchorsFor(["alpha", "beta", ""]);
    const validAnchors = anchorsFor(["one", "two", ""]);
    const tool = registerToolForTest();

    await expect(
      tool.execute(
        "call-atomic-failure",
        {
          files: [
            {
              path: "valid.txt",
              edits: [
                {
                  edit_type: "replace",
                  anchor: formatLineWithHash("two", validAnchors[1]),
                  text: "TWO"
                }
              ]
            },
            {
              path: "invalid.txt",
              edits: [
                {
                  edit_type: "replace_range",
                  anchor: formatLineWithHash("beta", invalidAnchors[1]),
                  text: "BETA"
                }
              ]
            }
          ]
        },
        undefined,
        undefined,
        { cwd } as never
      )
    ).rejects.toThrow(/Failed invalid\.txt: end_anchor is required for replace_range edits/);

    await expect(readFile(invalidPath, "utf8")).resolves.toBe("alpha\nbeta\n");
    await expect(readFile(validPath, "utf8")).resolves.toBe("one\ntwo\n");
  });
```

- [ ] **Step 2: Run test to verify red**

Run:

```bash
npm test -- test/edit-file.test.ts -t "does not write any files when one file in the batch fails validation"
```

Expected: FAIL because `valid.txt` is currently written before `invalid.txt` fails.

- [ ] **Step 3: Stage all file edits in memory before writing**

In `src/tools/edit-file.ts`, add this interface near `EditFileToolDetails`:

```ts
interface StagedFileEdit {
  path: string;
  absolutePath: string;
  lineEnding: "\r\n" | "\n";
  beforeContent: string;
  nextLines: string[];
  nextContent: string;
  diff: DiffDetails;
  editCount: number;
}
```

Then replace the `async execute(...)` body with this implementation:

```ts
    async execute(_id, params, signal, _onUpdate, ctx) {
      const staged: StagedFileEdit[] = [];
      const failures: EditFailureDetails[] = [];

      for (const file of params.files) {
        throwIfAborted(signal);
        const absolutePath = resolve(ctx.cwd, file.path.replace(/^@/, ""));

        try {
          const content = await readFile(absolutePath, { encoding: "utf8", signal });
          throwIfAborted(signal);

          const lineEnding = detectLineEnding(content);
          const lines = content.split(/\r?\n/);
          const currentAnchors = anchors.reconcile(absolutePath, lines);

          throwIfAborted(signal);
          const nextLines = applyAnchoredEdits(lines, currentAnchors, file.edits);
          throwIfAborted(signal);
          const nextContent = nextLines.join(lineEnding);
          const diff = createUnifiedDiff(file.path, content, nextContent);

          staged.push({
            path: file.path,
            absolutePath,
            lineEnding,
            beforeContent: content,
            nextLines,
            nextContent,
            diff,
            editCount: file.edits.length
          });
        } catch (error) {
          throwIfAborted(signal);
          const message = error instanceof Error ? error.message : String(error);
          const failure = error instanceof EditFileError ? error.failure : { message };
          failures.push({ ...failure, path: file.path, message: `Failed ${file.path}: ${message}` });
        }
      }

      if (failures.length > 0) {
        const error = new Error(failures.map((failure) => failure.message).join("\n"));
        (error as Error & { details?: EditFileToolDetails }).details = {
          files: params.files.map((file) => file.path),
          diffs: [],
          diff: "",
          failures
        };
        throw error;
      }

      for (const item of staged) {
        throwIfAborted(signal);
        await withFileMutationQueue(item.absolutePath, async () => {
          throwIfAborted(signal);
          await mkdir(dirname(item.absolutePath), { recursive: true });
          throwIfAborted(signal);
          await writeFile(item.absolutePath, item.nextContent, { encoding: "utf8", signal });
          anchors.reconcile(item.absolutePath, item.nextLines);
        });
      }

      const diffs = staged.map((item) => item.diff).filter((diff) => diff.diff);
      const summaries = staged.map((item) => `Updated ${item.path}: ${item.editCount} anchored edit(s).`);

      return {
        content: [{ type: "text", text: summaries.join("\n") }],
        details: {
          files: params.files.map((file) => file.path),
          diffs,
          diff: combineDiffs(diffs),
          firstChangedLine: diffs[0]?.firstChangedLine
        } satisfies EditFileToolDetails
      };
    }
```

- [ ] **Step 4: Run focused test to verify green**

Run:

```bash
npm test -- test/edit-file.test.ts -t "does not write any files when one file in the batch fails validation"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tools/edit-file.ts test/edit-file.test.ts
git commit -m "fix: validate edit_file batches before writing"
```

---

### Task 3: Add registered-tool diagnostics for path and line numbers

**Files:**
- Modify: `test/edit-file.test.ts`
- Modify: `src/tools/edit-file.ts` only if Task 2 error details are not sufficient

- [ ] **Step 1: Add a registered-tool test for path + line stale-anchor failures**

Add this test inside `describe("edit_file tool", ...)` in `test/edit-file.test.ts`:

```ts
  it("reports stale anchor failures with file path and line number", async () => {
    const cwd = await createTempDir();
    const path = join(cwd, "stale.txt");
    await writeFile(path, "alpha\nbeta\ngamma\n", "utf8");

    const anchors = anchorsFor(["alpha", "beta", "gamma", ""]);
    const tool = registerToolForTest();

    await expect(
      tool.execute(
        "call-stale-anchor",
        {
          files: [
            {
              path: "stale.txt",
              edits: [
                {
                  edit_type: "replace",
                  anchor: formatLineWithHash("old beta", anchors[1]),
                  text: "BETA"
                }
              ]
            }
          ]
        },
        undefined,
        undefined,
        { cwd } as never
      )
    ).rejects.toThrow('Failed stale.txt: anchor content mismatch for ' + anchors[1] + ' at line 2; current "beta", requested "old beta"');

    await expect(readFile(path, "utf8")).resolves.toBe("alpha\nbeta\ngamma\n");
  });
```

- [ ] **Step 2: Run the test**

Run:

```bash
npm test -- test/edit-file.test.ts -t "reports stale anchor failures with file path and line number"
```

Expected: PASS if Tasks 1 and 2 were implemented correctly. If it fails because the message lacks file path or line, update failure formatting in `execute(...)` to use the `Failed ${file.path}: ${message}` format shown in Task 2.

- [ ] **Step 3: Run all edit-file tests**

Run:

```bash
npm test -- test/edit-file.test.ts
```

Expected: all `test/edit-file.test.ts` tests pass.

- [ ] **Step 4: Commit if changes were needed**

If Step 2 required code changes, run:

```bash
git add src/tools/edit-file.ts test/edit-file.test.ts
git commit -m "test: cover edit_file anchor diagnostics"
```

If no code changes were needed, no commit is required for this task beyond the test addition commit:

```bash
git add test/edit-file.test.ts
git commit -m "test: cover edit_file anchor diagnostics"
```

---

### Task 4: Full verification

**Files:**
- Verify all project files

- [ ] **Step 1: Run full test suite**

Run:

```bash
npm test
```

Expected: all Vitest tests pass.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: TypeScript completes without errors.

- [ ] **Step 3: Inspect git diff**

Run:

```bash
git diff --stat HEAD~3..HEAD
git diff HEAD~3..HEAD -- src/tools/edit-file.ts test/edit-file.test.ts
```

Expected: diff shows only the atomic validation and diagnostics changes described in this plan.

- [ ] **Step 4: Final commit if verification-only fixes were needed**

If verification required small fixes, commit them:

```bash
git add src/tools/edit-file.ts test/edit-file.test.ts
git commit -m "fix: polish edit_file validation diagnostics"
```

Expected: working tree is clean after commit.

---

## Self-review

- Spec coverage: The plan covers all-or-nothing batch writes, per-file validation before mutation, human-readable path/line anchor diagnostics, and machine-preserved failure details.
- Placeholder scan: No TBD/TODO/placeholder implementation steps remain.
- Type consistency: `EditFailureDetails`, `EditFileError`, `StagedFileEdit`, and `EditFileToolDetails.failures` are introduced before use and reused consistently.
