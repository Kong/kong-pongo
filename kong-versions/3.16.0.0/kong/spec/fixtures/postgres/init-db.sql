DO $$
BEGIN
CREATE ROLE kong WITH LOGIN;
EXCEPTION WHEN duplicate_object THEN RAISE NOTICE '%, skipping', SQLERRM USING ERRCODE = SQLSTATE;
END
$$;

DO $$
BEGIN
CREATE ROLE kong_ro WITH LOGIN;
EXCEPTION WHEN duplicate_object THEN RAISE NOTICE '%, skipping', SQLERRM USING ERRCODE = SQLSTATE;
END
$$;

-- kong_scram connects with scram-sha-256 (see pg_hba.conf) so that the server
-- negotiates SCRAM-SHA-256-PLUS and channel binding is exercised. The password
-- has to be stored as a scram verifier for that, which is not the default on
-- postgres 13
SET password_encryption = 'scram-sha-256';

DO $$
BEGIN
CREATE ROLE kong_scram WITH LOGIN SUPERUSER PASSWORD 'kong_scram';
EXCEPTION WHEN duplicate_object THEN RAISE NOTICE '%, skipping', SQLERRM USING ERRCODE = SQLSTATE;
END
$$;

ALTER ROLE kong_scram WITH PASSWORD 'kong_scram';

SELECT 'CREATE DATABASE kong' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'kong')\gexec
SELECT 'CREATE DATABASE kong_tests' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'kong_tests')\gexec

GRANT ALL PRIVILEGES ON DATABASE kong TO kong;
GRANT ALL PRIVILEGES ON DATABASE kong_tests TO kong;

GRANT CONNECT ON DATABASE kong TO kong_ro;
GRANT CONNECT ON DATABASE kong_tests TO kong_ro;

\c kong;
ALTER SCHEMA public OWNER TO kong;
ALTER DEFAULT PRIVILEGES FOR ROLE kong IN SCHEMA public GRANT SELECT ON TABLES TO kong_ro;

\c kong_tests;
ALTER SCHEMA public OWNER TO kong;
ALTER DEFAULT PRIVILEGES FOR ROLE kong IN SCHEMA public GRANT SELECT ON TABLES TO kong_ro;
