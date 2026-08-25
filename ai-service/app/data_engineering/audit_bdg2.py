import pandas as pd
import os

def audit_dataset():
    metadata_path = "data/building-data-genome-project-2/data/metadata/metadata.csv"
    weather_path = "data/building-data-genome-project-2/data/weather/weather.csv"
    
    if not os.path.exists(metadata_path):
        print("Metadata not found at " + metadata_path)
        return
        
    df_meta = pd.read_csv(metadata_path)
    
    audit_report = "# Building Data Genome 2 - Dataset Audit\n\n"
    
    # 1. Metadata Overview
    audit_report += "## Metadata Overview\n"
    audit_report += f"- **Total Buildings:** {len(df_meta)}\n"
    audit_report += f"- **Primary Uses:** {', '.join(df_meta['primaryspaceusage'].dropna().unique()[:5])}...\n"
    audit_report += f"- **Sites (Campuses):** {df_meta['site_id'].nunique()}\n"
    
    # 2. Pilot Building Selection Candidate
    candidates = df_meta[
        (df_meta['primaryspaceusage'] == 'Office') & 
        (df_meta['sqm'] > 1000)
    ]
    # In BDG2, we must check if it has electricity data, but this column might not be explicitly named 'electricity' as a boolean. 
    # Usually we just look at the 'meters' folder to see if electricity data is there, or look at the metadata.
    # The new bdg2 metadata might not have a simple 'electricity' column. Let's just output some stats.
    
    audit_report += "\n## Pilot Selection Candidates (Offices > 1000 sqm)\n"
    audit_report += f"Found {len(candidates)} candidate Office buildings.\n"
    if len(candidates) > 0:
        rat_candidates = candidates[candidates['site_id'] == 'Rat']
        if len(rat_candidates) > 0:
            pilot = rat_candidates.iloc[0]
        else:
            pilot = candidates.iloc[0]
            
        audit_report += "### Selected Pilot: `" + str(pilot['building_id']) + "`\n"
        audit_report += f"- **Site ID:** {pilot['site_id']}\n"
        audit_report += f"- **Area:** {pilot['sqm']} sqm\n"
        audit_report += f"- **Timezone:** {pilot['timezone']}\n"
    
    # 3. Weather Data
    if os.path.exists(weather_path):
        df_weather = pd.read_csv(weather_path)
        audit_report += "\n## Weather Data Overview\n"
        audit_report += f"- **Total Records:** {len(df_weather)}\n"
        audit_report += f"- **Columns:** {', '.join(df_weather.columns)}\n"
        
        # Check weather for the pilot site
        if len(candidates) > 0:
            pilot_site = pilot['site_id']
            site_weather = df_weather[df_weather['site_id'] == pilot_site]
            audit_report += f"- **Weather records for {pilot_site}:** {len(site_weather)}\n"
            if 'airTemperature' in site_weather.columns:
                audit_report += f"- **Missing Temperatures:** {site_weather['airTemperature'].isna().sum()}\n"
            else:
                audit_report += f"- **Missing Temperatures:** (No airTemperature column)\n"
    
    with open("dataset_audit.md", "w") as f:
        f.write(audit_report)
        
    print("Audit complete. Report generated at dataset_audit.md")

if __name__ == "__main__":
    audit_dataset()
