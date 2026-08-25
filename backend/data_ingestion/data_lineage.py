import os
import json
from datetime import datetime
from sqlalchemy import create_engine, text
from config import DATABASE_URL

class DataLineageLogger:
    def __init__(self, log_dir="logs"):
        self.log_dir = log_dir
        os.makedirs(self.log_dir, exist_ok=True)
        self.log_file = os.path.join(self.log_dir, "data_lineage_raw.jsonl")
        self.engine = create_engine(DATABASE_URL)

    def start_run(self, source):
        """
        ingestion_runs tablosunda yeni bir RUN başlatır ve ID'sini döner.
        """
        query = text("""
            INSERT INTO ingestion_runs (source, status) 
            VALUES (:source, 'RUNNING') 
            RETURNING id;
        """)
        with self.engine.begin() as conn:
            result = conn.execute(query, {"source": source})
            run_id = result.scalar()
            
        print(f"[DATA LINEAGE] Started run #{run_id} for {source}")
        return run_id

    def finish_run(self, run_id, status, records_read=0, records_inserted=0, records_rejected=0, error_message=None):
        """
        ingestion_runs kaydını sonlandırır.
        """
        query = text("""
            UPDATE ingestion_runs 
            SET finished_at = CURRENT_TIMESTAMP, 
                status = :status,
                records_read = :read,
                records_inserted = :inserted,
                records_rejected = :rejected,
                error_message = :err
            WHERE id = :run_id;
        """)
        with self.engine.begin() as conn:
            conn.execute(query, {
                "status": status,
                "read": records_read,
                "inserted": records_inserted,
                "rejected": records_rejected,
                "err": error_message,
                "run_id": run_id
            })
            
        print(f"[DATA LINEAGE] Finished run #{run_id} (Status: {status}, Inserted: {records_inserted})")

# Singleton instance
logger = DataLineageLogger()
