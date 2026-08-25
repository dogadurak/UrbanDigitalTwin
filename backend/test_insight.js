const axios = require('axios');

async function sendInsight() {
  const payload = {
    id: "urn:ngsi-ld:AIInsight:TestAnomaly1" + Date.now(),
    type: "AIInsight",
    insightType: { type: "Property", value: "ThermalAnomaly" },
    severity: { type: "Property", value: "HIGH" },
    anomalyScore: { type: "Property", value: 0.95 },
    refRoom: { type: "Relationship", object: "urn:ngsi-ld:Room:203" },
    '@context': ['https://uri.etsi.org/ngsi-ld/v1/ngsi-ld-core-context.jsonld']
  };

  try {
    await axios.post('http://localhost:1026/ngsi-ld/v1/entities', payload, {
      headers: { 
        'Content-Type': 'application/ld+json',
        'Accept': 'application/ld+json'
      }
    });
    console.log("Successfully posted insight");
  } catch(e) {
    console.error("Failed:", e.response ? e.response.data : e.message);
  }
}
sendInsight();
