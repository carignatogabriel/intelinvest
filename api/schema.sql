-- Banco D1 do Intelinvest (login com Google). Dados mínimos: nada de senha, nada de dados financeiros.
CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,   -- identificador estável da conta Google ("sub")
  email      TEXT NOT NULL,
  name       TEXT NOT NULL,
  picture    TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,   -- ms desde 1970
  last_login INTEGER NOT NULL
);
