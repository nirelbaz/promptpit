import path from "node:path";
import { rm } from "node:fs/promises";
import { uninstallStack, type UninstallResult } from "./uninstall.js";
import { tryReadStackManifest } from "../core/stack.js";
import { exists, errorMessage } from "../shared/utils.js";
import { log } from "../shared/io.js";

export interface DeleteBundleOptions {
  /** Run `uninstallStack` first so installed artifacts come down with the
   *  bundle. Without this, the bundle vanishes and previously-installed
   *  files become orphans. */
  alsoUninstall?: boolean;
  dryRun?: boolean;
  /** When `alsoUninstall` is set, propagate force to uninstallStack so
   *  modified artifacts are also removed. */
  force?: boolean;
}

export interface DeleteBundleResult {
  /** Resolved bundle path (i.e. `<target>/.promptpit`). */
  bundlePath: string;
  bundleRemoved: boolean;
  uninstall?: UninstallResult;
  dryRun: boolean;
}

/** Delete the `.promptpit/` bundle from a project. Optionally uninstall the
 *  stack first so installed artifacts are removed in tandem.
 *
 *  Path guard: refuse if the resolved bundle path doesn't end in `/.promptpit`
 *  or doesn't exist. Belt-and-suspenders against future bugs that might pass
 *  a wrong root in. */
export async function deleteBundle(
  stackName: string,
  target: string,
  opts: DeleteBundleOptions = {},
): Promise<DeleteBundleResult> {
  const bundlePath = path.join(target, ".promptpit");

  if (path.basename(bundlePath) !== ".promptpit") {
    throw new Error(`Refusing to delete a path that is not a .promptpit bundle: ${bundlePath}`);
  }
  if (!(await exists(bundlePath))) {
    throw new Error(`No .promptpit/ bundle found in ${target}.`);
  }

  // Verify the bundle's declared stack name matches the requested name. The
  // CLI takes the stack name as a guard against accidental deletion when the
  // user is in the wrong directory; the TUI uses a typed-name confirm and so
  // already has its own guard, but this check applies to both surfaces.
  const manifest = await tryReadStackManifest(bundlePath);
  if (manifest && manifest.name !== stackName) {
    throw new Error(
      `Bundle's stack name is "${manifest.name}", not "${stackName}". ` +
        `Re-run with the correct name or pass the right project dir.`,
    );
  }

  let uninstall: UninstallResult | undefined;
  if (opts.alsoUninstall) {
    // Uninstall first while the manifest is still readable; deleting the
    // bundle takes installed.json with it, after which we couldn't
    // reconstruct what to remove.
    try {
      uninstall = await uninstallStack(stackName, target, {
        force: opts.force,
        dryRun: opts.dryRun,
      });
    } catch (err: unknown) {
      // No-op when nothing was installed — deletion can still proceed.
      const msg = errorMessage(err);
      if (!msg.includes("No stacks are installed") && !msg.includes("not installed")) {
        throw err;
      }
    }
  }

  if (!opts.dryRun) {
    await rm(bundlePath, { recursive: true, force: true });
    log.success(`Deleted bundle ${bundlePath}`);
  }

  return {
    bundlePath,
    bundleRemoved: !opts.dryRun,
    uninstall,
    dryRun: !!opts.dryRun,
  };
}
