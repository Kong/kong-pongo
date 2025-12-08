import subprocess
import os
from pathlib import Path

def main():
    oldpwd = os.getcwd()
    try:
        os.chdir('/kong-plugin')
        result = subprocess.run(['git', 'branch'], capture_output=True, text=True)
        for line in result.stdout.splitlines():
            if line.startswith('* '):
                print(f'({line[2:]})')
                break
    finally:
        os.chdir(oldpwd)

if __name__ == '__main__':
    main()
