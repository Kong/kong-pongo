import os

def main():
    os.environ['KONG_ENFORCE_RBAC'] = 'on'
    os.environ['KONG_ADMIN_GUI_AUTH'] = 'basic-auth'
    os.environ['KONG_ADMIN_GUI_SESSION_CONF'] = '{"secret":"pongo","storage":"kong","cookie_secure":false}'
    os.environ['KONG_ADMIN_GUI_URL'] = 'http://localhost:8002/'
    print("RBAC and GUI-auth have been enabled, restart Kong for it to take effect")
    print("  GUI user: 'kong_admin'")
    print("  GUI pwd : '$KONG_PASSWORD'")
    print("  GUI url : '$KONG_ADMIN_GUI_URL'   (use 'pongo expose' to access the GUI from the host)")
    print("")
    print("The password should also to be used as 'Kong-Admin-Token' on API requests.")

if __name__ == '__main__':
    main()
