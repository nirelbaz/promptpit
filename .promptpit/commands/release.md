Tag and publish the current main branch. Run this on main after merging a PR that includes a version bump.

## Steps

1. **Ensure we're on main.** If not, stop and tell the user to switch to main first.

2. **Ensure the working tree is clean.** If there are uncommitted changes, stop.

3. **Read the current version** from `package.json`.

4. **Check the tag doesn't already exist.** Run `git tag -l vX.Y.Z`. If it exists, stop and tell the user this version is already released.

5. **Verify CHANGELOG has an entry** for this version. If not, stop and tell the user to run `/version` on their branch first.

6. **Run all checks.** Run `npm test && npm run lint && npm run build`. If anything fails, stop.

7. **Tag and push the tag:**
   ```bash
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```

8. **Confirm.** Tell the user the tag is pushed and CI will now publish to npm and create a GitHub Release. Link to the Actions tab.
