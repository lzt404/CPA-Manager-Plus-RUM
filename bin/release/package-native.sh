#!/usr/bin/env bash
set -euo pipefail

script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
repo_root="$(cd "${script_dir}/../.." && pwd)"
version="${VERSION:-dev}"
out_dir="${OUT_DIR:-"${repo_root}/dist/native"}"
web_html="${WEB_HTML:-"${repo_root}/apps/web/dist/index.html"}"
binary_name="cpa-manager-plus"
package_prefix="${PACKAGE_PREFIX:-cpa-manager-plus-rum}"
server_src="${repo_root}/apps/manager-server"

if [ ! -f "${web_html}" ]; then
  echo "missing ${web_html}; run npm run build first" >&2
  exit 1
fi

mkdir -p "${repo_root}/bin/tmp/release"
work_dir="$(mktemp -d "${repo_root}/bin/tmp/release/native.XXXXXX")"
trap 'rm -rf "${work_dir}"' EXIT

rm -rf "${out_dir}"
mkdir -p "${out_dir}"

cp -R "${server_src}" "${work_dir}/manager-server"
cp "${web_html}" "${work_dir}/manager-server/internal/httpapi/web/management.html"

create_zip() {
  src_dir="$1"
  dest_file="$2"

  if command -v zip >/dev/null 2>&1; then
    (
      cd "${src_dir}"
      zip -qr "${dest_file}" .
    )
    return
  fi

  zipper="${work_dir}/zipdir.go"
  cat >"${zipper}" <<'GO'
package main

import (
	"archive/zip"
	"io"
	"io/fs"
	"os"
	"path/filepath"
)

func main() {
	if len(os.Args) != 3 {
		panic("usage: zipdir <src-dir> <dest-file>")
	}

	srcDir := os.Args[1]
	destFile := os.Args[2]
	out, err := os.Create(destFile)
	if err != nil {
		panic(err)
	}
	defer out.Close()

	zw := zip.NewWriter(out)
	defer zw.Close()

	err = filepath.WalkDir(srcDir, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if path == srcDir {
			return nil
		}

		rel, err := filepath.Rel(srcDir, path)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)

		if entry.IsDir() {
			_, err = zw.Create(rel + "/")
			return err
		}

		info, err := entry.Info()
		if err != nil {
			return err
		}
		header, err := zip.FileInfoHeader(info)
		if err != nil {
			return err
		}
		header.Name = rel
		header.Method = zip.Deflate

		writer, err := zw.CreateHeader(header)
		if err != nil {
			return err
		}

		file, err := os.Open(path)
		if err != nil {
			return err
		}
		defer file.Close()

		_, err = io.Copy(writer, file)
		return err
	})
	if err != nil {
		panic(err)
	}
}
GO
  go run "${zipper}" "${src_dir}" "${dest_file}"
}

while read -r goos goarch; do
  if [ -z "${goos}" ]; then
    continue
  fi

  package_name="${package_prefix}_${version}_${goos}_${goarch}"
  package_dir="${work_dir}/${package_name}"
  exe_name="${binary_name}"

  if [ "${goos}" = "windows" ]; then
    exe_name="${binary_name}.exe"
  fi

  mkdir -p "${package_dir}"
  (
    cd "${work_dir}/manager-server"
    CGO_ENABLED=0 GOOS="${goos}" GOARCH="${goarch}" go build -trimpath -ldflags "-s -w" -o "${package_dir}/${exe_name}" ./cmd/cpa-manager-plus
  )

  cp "${repo_root}/README.md" "${package_dir}/README.md"
  cp "${repo_root}/README_CN.md" "${package_dir}/README_CN.md"
  cp -R "${repo_root}/docs" "${package_dir}/docs"
  cp "${repo_root}/LICENSE" "${package_dir}/LICENSE"

  if [ "${goos}" = "windows" ]; then
    create_zip "${package_dir}" "${out_dir}/${package_name}.zip"
  else
    tar -czf "${out_dir}/${package_name}.tar.gz" -C "${package_dir}" .
  fi
done <<'TARGETS'
linux amd64
linux arm64
darwin amd64
darwin arm64
windows amd64
windows arm64
TARGETS

(
  cd "${out_dir}"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum ./* > checksums.txt
  else
    shasum -a 256 ./* > checksums.txt
  fi
)
