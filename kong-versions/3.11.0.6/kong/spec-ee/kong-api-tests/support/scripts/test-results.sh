#!/usr/bin/env bash
set -euo pipefail

S3_FOLDER_NAME="s3://sdet-e2e-test-durations"
RESULTS_DIR="$(cd "$(dirname "$0")/../../results" && pwd)"

RANDOM_NUMBER=$((RANDOM % 100000))
MERGED_FILE_NAME="merged_results_${RANDOM_NUMBER}.json"
FOLDER_NAME="$(date +%Y%m%d-%H_%M_%S)_$RANDOM_NUMBER"
TODAY=$(date +%Y%m%d)

if date -v-1d +%Y%m%d >/dev/null 2>&1; then
  YESTERDAY=$(date -v-1d +%Y%m%d)
else
  YESTERDAY=$(date -d "yesterday" +%Y%m%d)
fi

READ_XML_TEST_RESULTS=${READ_XML_TEST_RESULTS:-false}
DOWNLOAD_DURATIONS=${DOWNLOAD_DURATIONS:-false}
UPLOAD_DURATIONS=${UPLOAD_DURATIONS:-false}
READ_AND_MERGE_JSON_RESULTS=${READ_AND_MERGE_JSON_RESULTS:-true}

cd "$RESULTS_DIR"


if [[ $DOWNLOAD_DURATIONS == "true" ]]; then
  # Pick a folder for today; fallback to yesterday
  FOLDER=$(aws s3 ls "$S3_FOLDER_NAME/data/" 2>/dev/null | awk -v d="$TODAY" '$0 ~ d {print $2}' | head -n1 | tr -d '/')
  
  if [[ -n "${FOLDER:-}" ]]; then
    echo "Downloading from folder: $FOLDER"
    aws s3 cp "$S3_FOLDER_NAME/data/$FOLDER/" . --recursive --exclude "*" --include "merged_results_*.json"
  else
    FOLDER=$(aws s3 ls "$S3_FOLDER_NAME/data/" 2>/dev/null | awk -v d="$YESTERDAY" '$0 ~ d {print $2}' | head -n1 | tr -d '/')
    if [[ -n "${FOLDER:-}" ]]; then
      echo "Downloading from folder: $FOLDER"
      aws s3 cp "$S3_FOLDER_NAME/data/$FOLDER/" . --recursive --exclude "*" --include "merged_results_*.json"
    else
      echo "No results found for today or yesterday." >&2
    fi
  fi
fi

if [[ $UPLOAD_DURATIONS == "true" ]]; then
  shopt -s nullglob
  files=(merged_results_*.json)
  if ((${#files[@]} > 0)); then
    for file in "${files[@]}"; do
      aws s3 cp "$file" "$S3_FOLDER_NAME/data/$FOLDER_NAME/$file"
    done
  else
    echo "No merged_results_*.json files to upload." >&2
  fi
  shopt -u nullglob
fi

if [[ $READ_XML_TEST_RESULTS == "true" ]]; then
  # Needs: xmlstarlet, jq
  shopt -s nullglob
  xmls=(*.xml)
  if ((${#xmls[@]} == 0)); then
    echo "No XML files found to read." >&2
  else
    output="e2e_test_durations_${RANDOM_NUMBER}.json"
    # Build a single JSON object mapping file->duration
    # 1) Extract testcase lines "file time" (excluding skipped), normalize to paths under test/gateway/
    # 2) Sum times per file
    # 3) Emit JSON object
    xmlstarlet sel -t -m "//testcase[not(skipped)]" -v "@file" -o " " -v "@time" -n "${xmls[@]}" |
      sed 's|.*\(test/gateway/.*\)|\1|' |
      awk '{sum[$1]+=$2} END { printf "{"; n=0; for (f in sum) { if(n++)printf ","; printf "\"%s\":%.3f", f, sum[f] } printf "}\n" }' \
      > "$output"

    # Optionally produce a merged file alongside others for upload/merge
    cp "$output" "$MERGED_FILE_NAME"
  fi
  shopt -u nullglob
fi

if [[ $READ_AND_MERGE_JSON_RESULTS == "true" ]]; then
  shopt -s nullglob
  files=(merged_results_*.json)
  if ((${#files[@]} > 0)); then
    jq -s 'add' "${files[@]}" > group_merged_results.json
  else
    echo "No merged_results_*.json files to merge." >&2
  fi
  shopt -u nullglob
fi