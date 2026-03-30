Bump the version and add a CHANGELOG entry. Run this on your feature branch before opening a PR that you want to release.

## Steps

1. **Determine the new version.** If the user provided a version argument like `$ARGUMENTS`, use that. Otherwise, read the current version from `package.json` and bump the patch number (e.g., 0.1.4 → 0.1.5). Ask the user to confirm the version before proceeding.

2. **Update `package.json`.** Set the `version` field to the new version.

3. **Update `CHANGELOG.md`.** Add a new entry at the top (below the `# Changelog` heading) with the format:
   ```
   ## X.Y.Z (YYYY-MM-DD)
   ```
   Summarize what changed on this branch by reading `git log origin/main..HEAD`. Write user-facing bullet points (what they can now do), not implementation details. Match the tone of existing entries.

4. **Commit.** Stage only `package.json` and `CHANGELOG.md`, commit with message: `chore: bump version to X.Y.Z`
