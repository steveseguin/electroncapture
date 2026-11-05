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

The remaining two reviewed extract-zip build-tool advisory exceptions apply to exactly
2.23.5 while it is under GitHub prerelease review. The December 4, 2026 expiration,
manual opt-in, production/native dependency gates, and rejection of unknown
advisories are unchanged. Ordinary strict audits remain strict. The minimatch and glob findings were fixed in the refreshed build; the two
extract-zip findings still have no upstream patched version.

Manual builds can select `publish_release` to upload verified packages to the
explicit `version` tag. Packages are uploaded only after each platform's existing
verification steps pass. The maintainer can clear GitHub's pre-release checkbox
when satisfied; no application version change is needed for that promotion.

This build includes the later Linux pinning/fullscreen restoration fix and closed-window
reference cleanup, plus stricter recording analysis and native Linux CI coverage.
Version 2.23.4 remains a separate earlier snapshot; its already uploaded assets and tag
are preserved.

The November 5, 2026 refresh replaces all 26 platform downloads with the verified
artifacts from workflow run `41949763781`, source commit
`78b4faba5e3d4b8a2b811d0006d0231dede583c9`. It adds recovery of shortcuts after a
conflicting app process exits, removes the electron-is-dev dependency, updates
build dependencies, and fixes security findings in test fixtures. The release tag
now identifies that common build source. Checksums and validation metadata are
refreshed alongside the binaries; earlier hardware testing remains labeled with
its original source snapshot. Application version and runtime pins are unchanged.
