# Electron Capture 2.23.5

The application version, package versions and release tag use `2.23.5` / `v2.23.5`,
without a beta or prerelease suffix. GitHub's separate **pre-release** flag stays
set until the maintainer approves promotion. Both electron-builder's publishing
configuration and the release workflow default to that status; a suffix-free
version must not automatically promote the release.

This is a fresh build of all existing platform variants, preserving their runtime
pins: custom Windows x64 39.8.10-qp20, custom Windows 11 x64 43.3.0-qp20, and official
43.8.7 for macOS, Windows ARM64 and Linux x64/ARM64/ARMv7. Previous beta downloads
remain separate. New packages embed the actual 2.23.5 version.

The existing four reviewed build-tool advisory exceptions are re-scoped to exactly
2.23.5 while it is under GitHub prerelease review. The December 4, 2026 expiration,
manual opt-in, production/native dependency gates, and rejection of unknown
advisories are unchanged. Ordinary strict audits remain strict. This version
rename is not a claim that those build-tool advisories were fixed.

Manual builds can select `publish_release` to upload verified packages to the
explicit `version` tag. Packages are uploaded only after each platform's existing
verification steps pass. The maintainer can clear GitHub's pre-release checkbox
when satisfied; no application version change is needed for that promotion.

This build includes the later Linux pinning/fullscreen restoration fix and closed-window
reference cleanup, plus stricter recording analysis and native Linux CI coverage.
Version 2.23.4 remains a separate earlier snapshot; its already uploaded assets and tag
are preserved.
