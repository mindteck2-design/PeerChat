-- Run once on the INTERNET Postgres 18 host (e.g. 172.16.69.164).
-- Separate database from intranet — never share between environments.

CREATE USER lanmsg WITH PASSWORD 'CHANGE_ME_INTERNET';
CREATE DATABASE lanmsg_internet OWNER lanmsg;

\c lanmsg_internet
GRANT USAGE ON SCHEMA public TO lanmsg;
GRANT CREATE ON SCHEMA public TO lanmsg;
