-- Run once on the INTRANET Postgres 18 host (e.g. 172.195.120.180).
-- Adjust password before running in production.

CREATE USER lanmsg WITH PASSWORD 'CHANGE_ME_INTRANET';
CREATE DATABASE lanmsg OWNER lanmsg;

-- Optional: restrict privileges further
GRANT CONNECT ON DATABASE lanmsg TO lanmsg;
\c lanmsg
GRANT USAGE ON SCHEMA public TO lanmsg;
GRANT CREATE ON SCHEMA public TO lanmsg;
