import os
import sys
import subprocess
from pathlib import Path

def main():
    kx_filename = '/kong-plugin/kong.yml'
    print('')
    if Path(kx_filename).exists():
        if len(sys.argv) < 2 or sys.argv[1] != '-y':
            answer = input(f'The file "{kx_filename}" already exists, overwrite? (y/n, or use "-y") ')
            if not answer.lower().startswith('y'):
                sys.exit(0)
        os.remove(kx_filename)
    print(f'Exporting declarative config to "{kx_filename}"...')
    result = subprocess.run(['kong', 'config', 'db_export', kx_filename])
    if result.returncode != 0:
        print(f'Failed to export to "{kx_filename}"')
        sys.exit(1)
    print(f'Export to "{kx_filename}" complete.')

if __name__ == '__main__':
    main()
