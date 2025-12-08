import os
import sys
import subprocess
from pathlib import Path

def main():
    # Will (re)start Kong with a clean database, and an optional imported config
    subprocess.run(['docker', 'exec', 'kong-gateway-test', 'kong', 'stop'])
    if subprocess.run(['docker', 'exec', 'kong-gateway-test', 'kong', 'migrations', 'bootstrap', '--force']).returncode != 0:
        sys.exit(1)
    print('')
    config_dir = Path('./kong-plugin')
    for fname in ['kong.yml', 'kong.yaml', 'kong.json']:
        if (config_dir / fname).exists():
            kms_filename = fname
            break
    else:
        kms_filename = ''
    if kms_filename:
        if len(sys.argv) < 2 or sys.argv[1] != '-y':
            answer = input(f'Found file "{kms_filename}", import? (y/n, or use "-y") ')
            if not answer.lower().startswith('y'):
                print('Skipping import...')
                kms_filename = ''
    if kms_filename:
        import_file = f'./kong-plugin/{kms_filename}'
        print(f'Importing declarative config from "{import_file}"')
        subprocess.run(['docker', 'exec', 'kong-gateway-test', 'kong', 'prepare'])
        # workspace update logic would go here if needed
        subprocess.run(['docker', 'exec', 'kong-gateway-test', 'kong', 'config', 'db_import', import_file])
    subprocess.run(['docker', 'exec', 'kong-gateway-test', 'kong', 'start'])

if __name__ == '__main__':
    main()
