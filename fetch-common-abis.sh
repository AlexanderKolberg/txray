#!/usr/bin/env bash
set -e

ABIS=(
  "https://raw.githubusercontent.com/ProjectOpenSea/seaport-js/main/src/abi/ERC20.ts"
  "https://raw.githubusercontent.com/ProjectOpenSea/seaport-js/main/src/abi/ERC721.ts"
  "https://raw.githubusercontent.com/ProjectOpenSea/seaport-js/main/src/abi/ERC1155.ts"
  "https://raw.githubusercontent.com/ProjectOpenSea/seaport-js/main/src/abi/Seaport.ts"
)

ABI_DIR="$(dirname "$0")/abi"

for url in "${ABIS[@]}"; do
  name=$(basename "$url")

  echo "Fetching $name from $url..."

  content=$(curl -sf "$url") || {
    echo "  Failed to fetch $name"
    continue
  }

  content=$(echo "$content" | sed 's/^export { [a-zA-Z0-9_]* };$//')

  {
    echo "// Source: $url"
    echo ""
    echo "$content"
  } >"$ABI_DIR/$name"

  echo "  Saved to $ABI_DIR/$name"
done

echo ""
echo "Done! ABIs saved to abi/ folder."
