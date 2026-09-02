import os
import psycopg2

def init_db():
    # Render provides DATABASE_URL by default when linking a database to a service
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        print("DATABASE_URL not found, skipping db init.")
        return

    # Check if we are in ai-service directory, db is in ../db
    db_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "db")
    if not os.path.exists(db_dir):
        print(f"DB directory {db_dir} not found.")
        return

    try:
        conn = psycopg2.connect(database_url)
        conn.autocommit = True
        cur = conn.cursor()

        # Render Postgres might not have postgis extension created yet
        try:
            cur.execute("CREATE EXTENSION IF NOT EXISTS postgis;")
        except Exception as e:
            print(f"Warning: Could not create postgis extension: {e}")

        # Check if already initialized by looking for a specific table
        cur.execute("SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'bdg2_buildings');")
        exists = cur.fetchone()[0]
        if exists:
            print("Database already initialized. Skipping.")
            return

        print("Initializing database from SQL files...")
        sql_files = sorted([f for f in os.listdir(db_dir) if f.endswith(".sql")])
        for sql_file in sql_files:
            print(f"Executing {sql_file}...")
            with open(os.path.join(db_dir, sql_file), "r", encoding="utf-8") as f:
                cur.execute(f.read())
        
        print("Database initialization complete.")
    except Exception as e:
        print(f"Error initializing database: {e}")
    finally:
        if 'conn' in locals():
            conn.close()

if __name__ == "__main__":
    init_db()
