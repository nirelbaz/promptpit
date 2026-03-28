---
name: changelog
description: Update CHANGELOG.md with user-facing changes. Use when the user wants to update the changelog, prepare for a release, or document what changed since the last version.
user-invocable: true
---

# Changelog

Update CHANGELOG.md with recent changes.

## Process

1. Read the existing CHANGELOG.md (create one if it doesn't exist)
2. Run `git log --oneline` since the last changelog entry to see what changed
3. Group changes by type and write the new entry

## Format

Follow [Keep a Changelog](https://keepachangelog.com):

```markdown
## [version] - YYYY-MM-DD

### Added
- New features

### Changed
- Changes to existing features

### Fixed
- Bug fixes

### Removed
- Removed features
```

## Rules

- Write for users, not developers. "Fixed crash when saving empty form" not "Fixed null pointer in FormHandler.save()"
- Skip internal changes (refactors, test updates, CI tweaks) unless they affect users
- Group related changes into one bullet. "Redesigned settings page" not five separate bullets about each settings panel.
- Most recent version goes at the top
- If there's no CHANGELOG.md, create one with an Unreleased section at the top
- Link version headers to the git diff when possible: `[1.2.0]: https://github.com/user/repo/compare/v1.1.0...v1.2.0`
