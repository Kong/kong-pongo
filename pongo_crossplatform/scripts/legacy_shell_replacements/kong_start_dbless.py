import os
import sys
from pathlib import Path

def main():
    # Will (re)start Kong DBless from a config file; kong.y(a)ml/json
    config_dir = Path('/kong-plugin')
    for fname in ['kong.yml', 'kong.yaml', 'kong.json']:
        if (config_dir / fname).exists():
            kdbl_filename = fname
            break
    else:
        print('Error: Declarative file "kong.yml/yaml/json" not found')
        sys.exit(1)

    os.environ['KONG_DATABASE'] = 'off'
    os.environ['KONG_DECLARATIVE_CONFIG'] = f'/kong-plugin/{kdbl_filename}'
    # Replace with subprocess call to kong restart
    os.system('kong restart')

if __name__ == '__main__':
    main()
