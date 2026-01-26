#!/usr/bin/env bash
set -euo pipefail

# txray installer script
# Downloads and installs the latest txray binary for your platform

REPO="AlexanderKolberg/txray"
INSTALL_DIR="${INSTALL_DIR:-$HOME/.local/bin}"
BINARY_NAME="txray"

# Detect OS and architecture
detect_platform() {
    local os arch

    case "$(uname -s)" in
        Linux*)  os="linux" ;;
        Darwin*) os="darwin" ;;
        *)       echo "Unsupported OS: $(uname -s)" >&2; exit 1 ;;
    esac

    case "$(uname -m)" in
        x86_64|amd64)  arch="x64" ;;
        arm64|aarch64) arch="arm64" ;;
        *)             echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
    esac

    echo "${os}-${arch}"
}

# Get latest release tag from GitHub
get_latest_version() {
    curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" \
        | grep '"tag_name":' \
        | sed -E 's/.*"([^"]+)".*/\1/'
}

main() {
    local platform version download_url tmp_file

    echo "Installing txray..."

    platform=$(detect_platform)
    echo "Detected platform: ${platform}"

    version=$(get_latest_version)
    if [[ -z "$version" ]]; then
        echo "Failed to get latest version" >&2
        exit 1
    fi
    echo "Latest version: ${version}"

    download_url="https://github.com/${REPO}/releases/download/${version}/txray-${platform}"
    echo "Downloading from: ${download_url}"

    tmp_file=$(mktemp)
    trap 'rm -f "$tmp_file"' EXIT

    if ! curl -fsSL -o "$tmp_file" "$download_url"; then
        echo "Failed to download binary" >&2
        exit 1
    fi

    # Create install directory if needed
    mkdir -p "$INSTALL_DIR"

    # Install binary
    chmod +x "$tmp_file"
    mv "$tmp_file" "${INSTALL_DIR}/${BINARY_NAME}"
    trap - EXIT  # Clear trap since we moved the file

    echo ""
    echo "Successfully installed txray to ${INSTALL_DIR}/${BINARY_NAME}"
    echo ""

    # Check if install dir is in PATH
    if [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
        echo "Add the following to your shell profile to use txray:"
        echo ""
        echo "  export PATH=\"\$PATH:$INSTALL_DIR\""
        echo ""
    else
        echo "Run 'txray --help' to get started"
    fi
}

main "$@"
