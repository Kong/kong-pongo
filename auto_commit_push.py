#!/usr/bin/env python3
import subprocess
import sys
from datetime import datetime

def run(cmd):
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"Error running '{cmd}':\n{result.stderr}")
        sys.exit(result.returncode)
    return result.stdout.strip()

def main():
    # Stage all changes
    run('git add -A')
    # Commit with timestamp
    commit_msg = f"Auto-commit: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"
    try:
        run(f'git commit -m "{commit_msg}"')
    except SystemExit as e:
        if 'nothing to commit' in str(e):
            print('No changes to commit.')
            return
        raise
    # Push to the current branch's upstream
    run('git push')
    print('Changes committed and pushed successfully.')

if __name__ == '__main__':
    main()
