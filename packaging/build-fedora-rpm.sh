#!/usr/bin/env bash
# Build the noarch RPM directly from a checked-out repository.
set -Eeuo pipefail

repo_root="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
version="${1:-0.1.0}"
[[ "$version" =~ ^[0-9]+(\.[0-9]+){1,3}([a-zA-Z0-9._-]+)?$ ]] || {
  printf 'Errore: versione RPM non valida: %s\n' "$version" >&2
  exit 2
}
command -v rpmbuild >/dev/null || {
  printf '%s\n' 'Errore: rpmbuild mancante. Su Fedora: sudo dnf install -y rpm-build' >&2
  exit 1
}

topdir="$(mktemp -d "${TMPDIR:-/tmp}/omarchy-rpm.XXXXXX")"
cleanup() { rm -rf -- "$topdir"; }
trap cleanup EXIT
mkdir -p "$topdir"/{BUILD,BUILDROOT,RPMS,SOURCES,SPECS,SRPMS}
rpmbuild -bb \
  --define "_topdir $topdir" \
  --define "_sourcedir $repo_root" \
  --define "version $version" \
  "$repo_root/packaging/omarchy-fedora-client.spec"
mkdir -p "$repo_root/dist"
find "$topdir/RPMS" -type f -name '*.rpm' -exec cp -f {} "$repo_root/dist/" \;
printf 'RPM creato in %s\n' "$repo_root/dist"
