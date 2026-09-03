from fastapi import APIRouter, HTTPException, Query
import psycopg2
from psycopg2.extras import RealDictCursor
from typing import Optional

from app import db as DB

router = APIRouter()


@router.get("/spatial-context/{building_id}")
def get_spatial_context(
    building_id: str,
    date: Optional[str] = Query(None, description="ISO 8601 Date string, e.g., '2016-06-15'")
):
    """
    Fetch multi-scale spatial context (50m, 100m, 250m) for a building on a given date.
    Strictly applies Forward-Fill by selecting the most recent observation <= date.
    """
    try:
        conn = DB.connect()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        
        # If no date is provided, just get the absolute latest
        date_filter = ""
        params = [building_id]
        if date:
            date_filter = "AND observation_time <= %s"
            params.append(date)
            
        actual_query = f"""
            WITH ranked_features AS (
                SELECT *, 
                       ROW_NUMBER() OVER(PARTITION BY buffer_radius_m ORDER BY observation_time DESC) as rn
                FROM spatial_features
                WHERE building_id = %s {date_filter}
            )
            SELECT * FROM ranked_features WHERE rn = 1;
        """
        
        cur.execute(actual_query, tuple(params))
        rows = cur.fetchall()
        
        if not rows:
            raise HTTPException(status_code=404, detail="No spatial context found for the given building and date.")
            
        buffers = {}
        for row in rows:
            radius = str(row['buffer_radius_m']) + "m"
            buffers[radius] = {
                "observation_time": row['observation_time'].isoformat() if row['observation_time'] else None,
                "ndvi_current": row['ndvi_current'],
                "ndvi_change_30d": row['ndvi_change_30d'],
                "ndvi_change_90d": row['ndvi_change_90d'],
                "ndmi_current": row['ndmi_current'],
                "ndbi_current": row['ndbi_current'],
                "building_density": row['building_density'],
                "road_density": row['road_density'],
                "green_ratio": row['green_ratio'],
                "source_version": row['source_version']
            }
            
        cur.close()
        conn.close()
        
        return {
            "building_id": building_id,
            "query_date": date,
            "buffers": buffers
        }

    except psycopg2.Error as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
