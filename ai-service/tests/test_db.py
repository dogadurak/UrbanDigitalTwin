"""Where the service looks for its database.

`spatial_api` used to keep its own copy of the connection parameters and read
`POSTGIS_HOST` where the rest of the service reads `POSTGRES_HOST`. Under
docker-compose that is invisible, because the default it falls back to is the
compose service name and resolves. Anywhere else, that one endpoint answered
`500 Database error: could not translate host name "postgis"` while every other
endpoint worked -- a configuration mismatch reported as a database fault.

So these tests are about the environment contract, not about SQL.
"""

import pytest

from app import db as DB


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for name in ("DATABASE_URL", "DB_NAME", "DB_USER", "DB_PASS",
                 "POSTGRES_HOST", "POSTGRES_PORT", "POSTGIS_HOST", "POSTGIS_PORT"):
        monkeypatch.delenv(name, raising=False)


def test_defaults_match_docker_compose():
    p = DB.db_params()
    assert p["host"] == "postgis"
    assert p["port"] == "5432"
    assert p["dbname"] == "geotwin_db"
    assert p["user"] == "geotwin_user"


def test_the_standard_host_variable_is_honoured(monkeypatch):
    monkeypatch.setenv("POSTGRES_HOST", "localhost")
    monkeypatch.setenv("POSTGRES_PORT", "5433")
    p = DB.db_params()
    assert (p["host"], p["port"]) == ("localhost", "5433")


def test_the_legacy_variable_still_works(monkeypatch):
    # spatial_api read only this name. Dropping it would break anyone who set
    # it, so it is accepted -- second.
    monkeypatch.setenv("POSTGIS_HOST", "legacy-host")
    assert DB.db_params()["host"] == "legacy-host"


def test_the_standard_variable_wins_over_the_legacy_one(monkeypatch):
    monkeypatch.setenv("POSTGRES_HOST", "standard")
    monkeypatch.setenv("POSTGIS_HOST", "legacy")
    assert DB.db_params()["host"] == "standard"


def test_credentials_come_from_the_environment(monkeypatch):
    # The old spatial_api hardcoded all three with no override, which is what
    # made it unusable against a managed database.
    monkeypatch.setenv("DB_NAME", "other_db")
    monkeypatch.setenv("DB_USER", "other_user")
    monkeypatch.setenv("DB_PASS", "other_pass")
    p = DB.db_params()
    assert (p["dbname"], p["user"], p["password"]) == ("other_db", "other_user", "other_pass")


def test_database_url_takes_precedence(monkeypatch):
    """A managed Postgres hands out one URL, not five variables."""
    seen = {}

    def fake_connect(*args, **kwargs):
        seen["args"], seen["kwargs"] = args, kwargs
        return object()

    monkeypatch.setattr(DB.psycopg2, "connect", fake_connect)
    monkeypatch.setenv("POSTGRES_HOST", "ignored-when-url-is-set")
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@example:5432/d")

    DB.connect()
    assert seen["args"] == ("postgresql://u:p@example:5432/d",)
    assert seen["kwargs"] == {}


def test_without_a_url_the_parameters_are_used(monkeypatch):
    seen = {}

    def fake_connect(*args, **kwargs):
        seen["args"], seen["kwargs"] = args, kwargs
        return object()

    monkeypatch.setattr(DB.psycopg2, "connect", fake_connect)
    monkeypatch.setenv("POSTGRES_HOST", "somewhere")

    DB.connect()
    assert seen["args"] == ()
    assert seen["kwargs"]["host"] == "somewhere"


def test_every_module_that_talks_to_postgres_goes_through_this_one():
    """No fourth copy of the parameters creeps back in."""
    import pathlib

    app_dir = pathlib.Path(DB.__file__).parent
    offenders = []
    for path in app_dir.rglob("*.py"):
        if path.name == "db.py" or "__pycache__" in path.parts:
            continue
        text = path.read_text(encoding="utf-8")
        if "psycopg2.connect" in text or "geotwin_password" in text:
            offenders.append(path.relative_to(app_dir).as_posix())
    assert offenders == [], (
        "these bypass app/db.py, which is how the POSTGIS_HOST/POSTGRES_HOST "
        "mismatch happened: {}".format(offenders)
    )
