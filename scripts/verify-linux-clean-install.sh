#!/usr/bin/env bash
# Resolve package dependencies in a clean native-architecture distro, before any
# browser, desktop, or FFmpeg test tools can accidentally supply missing libraries.
set -euo pipefail
package=$(realpath "${1:?Usage: verify-linux-clean-install.sh package.deb|package.rpm [container-image]}")
case "$package" in
  *.deb) image=${2:-ubuntu:24.04}; manager=deb ;;
  *.rpm) image=${2:-fedora:43}; manager=rpm ;;
  *) echo 'Expected a DEB or RPM package' >&2; exit 2 ;;
esac
docker run --rm -e DEBIAN_FRONTEND=noninteractive \
  -v "$package:/input/package.$manager:ro" "$image" \
  bash -euo pipefail -c '
    case "$1" in
      deb) apt-get update; apt-get install -y --no-install-recommends /input/package.deb ;;
      rpm) dnf install -y --setopt=install_weak_deps=False /input/package.rpm ;;
    esac
    test -x /opt/elecap/elecap
    test -x /usr/bin/elecap
    for binary in /opt/elecap/elecap /opt/elecap/chrome_crashpad_handler /opt/elecap/*.so; do
      ldd "$binary" | tee /tmp/elecap-library-check
      if grep -q "not found" /tmp/elecap-library-check; then
        echo "Missing runtime dependency: $binary" >&2
        exit 1
      fi
    done
    case "$1" in
      deb) apt-get remove -y vdon.electron.capture.app ;;
      rpm) dnf remove -y "$(rpm -qp --queryformat "%{NAME}" /input/package.rpm)" ;;
    esac
    test ! -e /opt/elecap/elecap
    test ! -e /usr/bin/elecap
    echo "Clean package dependency and removal checks passed."
  ' bash "$manager"
