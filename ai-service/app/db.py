"""One way to reach the database.

The connection parameters were written out three times -- in ``main.py``, in
``spatial_api.py`` and in ``load_buildings_to_db.py`` -- and the copies had
drifted. ``spatial_api`` read ``POSTGIS_HOST`` where everything else reads
``POSTGRES_HOST``, and hardcoded the database name, user and password with no
environment override at all.

Inside docker-compose that difference is invisible: the host it defaults to,
``postgis``, is the service name and resolves. Anywhere else -- a local run, or
any deployment that sets ``POSTGRES_HOST`` -- every endpoint worked except that
one, which answered ``500 Database error: could not translate host name
"postgis"``. A configuration mismatch reported as a database failure.

``DATABASE_URL`` wins when it is set, which is how a managed Postgres hands out
credentials.
"""

from __future__ import annotations

import os

import psycopg2


def db_params():
    """Connection parameters from the environment, with compose's defaults.

    The password default is the one in ``docker-compose.yml``. It is a local
    development credential for a container that publishes no port to the
    outside world -- not a secret, and not usable anywhere else.
    """
    return {
        "dbname": os.environ.get("DB_NAME", "geotwin_db"),
        "user": os.environ.get("DB_USER", "geotwin_user"),
        "password": os.environ.get("DB_PASS", "geotwin_password"),
        # POSTGIS_HOST is accepted second because spatial_api used to read only
        # that name; dropping it outright would break anyone who set it.
        "host": os.environ.get("POSTGRES_HOST") or os.environ.get("POSTGIS_HOST", "postgis"),
        "port": os.environ.get("POSTGRES_PORT") or os.environ.get("POSTGIS_PORT", "5432"),
    }


def connect():
    """Open a connection, preferring ``DATABASE_URL`` when the platform sets it."""
    url = os.environ.get("DATABASE_URL")
    return psycopg2.connect(url) if url else psycopg2.connect(**db_params())
