# This script would set up aliases and environment variables for a Pongo shell session.
# Aliases are not natively supported in Python, but you can print instructions or set env vars.
import os

def setup_profile():
    os.environ['KONG_PLUGINS'] = os.environ.get('KONG_PLUGINS', '') + ',dbless-reload' if os.environ.get('KONG_PLUGINS') else 'dbless-reload'
    print("Kong auto-reload is enabled for custom-plugins and dbless-configurations.")
    print("Once you have started Kong, it will automatically reload to reflect any changes in the files.")
    print("Use 'pongo tail' on the host to verify, or set KONG_RELOAD_CHECK_INTERVAL=0 in this shell to disable it.")
    print("Get started quickly with the following commands:")
    print("  kms   - kong migrations start; wipe/initialize the database and start Kong clean, optionally importing declarative configuration if available.")
    print("  kdbl  - kong start dbless; start Kong in dbless mode, requires a declarative configuration.")
    print("  ks    - kong start; starts Kong with the existing database contents (actually a restart).\n  kp    - kong stop; stop Kong.\n  kx    - export the current Kong database to a declarative configuration file.")

if __name__ == '__main__':
    setup_profile()
