const axios = require('axios');

const ORION_LD_URL = process.env.ORION_LD_URL || 'http://localhost:1026/ngsi-ld/v1';

class FiwareGateway {
  
  async _upsertEntity(payload) {
    try {
      await axios.post(`${ORION_LD_URL}/entities`, payload, {
        headers: { 
          'Content-Type': 'application/ld+json',
          'Accept': 'application/ld+json'
        }
      });
    } catch (error) {
      if (error.response && error.response.status === 409) {
        const patchPayload = { ...payload };
        delete patchPayload.id;
        delete patchPayload.type;
        
        await axios.patch(`${ORION_LD_URL}/entities/${payload.id}/attrs`, patchPayload, {
          headers: { 
            'Content-Type': 'application/ld+json',
            'Accept': 'application/ld+json'
          }
        });
      } else {
        console.error(`Failed to upsert FIWARE context for ${payload.id}:`, error.message, error.response?.data);
      }
    }
  }

  async updateWeatherContext(weatherData) {
    if (!weatherData) return;
    const payload = {
      id: 'urn:ngsi-ld:WeatherObserved:IzmirPilot',
      type: 'WeatherObserved',
      temperature: { type: 'Property', value: weatherData.temperature },
      humidity: { type: 'Property', value: weatherData.humidity },
      windSpeed: { type: 'Property', value: weatherData.wind_speed },
      dateObserved: { type: 'Property', value: weatherData.observed_at },
      '@context': ['https://uri.etsi.org/ngsi-ld/v1/ngsi-ld-core-context.jsonld']
    };
    await this._upsertEntity(payload);
  }

  async updateIoTDeviceContext(deviceId, roomId, deviceType, readings) {
    if (!readings) return;
    
    // We create Semantic Links here using 'Relationship' type
    const payload = {
      id: deviceId,
      type: 'IoTDevice',
      category: { type: 'Property', value: [deviceType] },
      refRoom: { type: 'Relationship', object: roomId },
      temperature: { type: 'Property', value: readings.temperature || 0 },
      humidity: { type: 'Property', value: readings.humidity || 0 },
      co2: { type: 'Property', value: readings.co2 || 0 },
      statusFlag: { type: 'Property', value: readings.status_flag || 'NORMAL' },
      dateObserved: { type: 'Property', value: new Date().toISOString() },
      '@context': ['https://uri.etsi.org/ngsi-ld/v1/ngsi-ld-core-context.jsonld']
    };
    await this._upsertEntity(payload);
  }

  async setupSubscription(callbackUrl) {
    // Subscribe to both WeatherObserved and IoTDevice
    const subPayload = {
      description: "Notify on Weather or IoT update",
      type: "Subscription",
      entities: [
        { type: "WeatherObserved" },
        { type: "IoTDevice" },
        { type: "AIInsight" }
      ],
      notification: {
        endpoint: {
          uri: callbackUrl,
          accept: "application/json"
        }
      },
      '@context': ['https://uri.etsi.org/ngsi-ld/v1/ngsi-ld-core-context.jsonld']
    };

    try {
      await axios.post(`${ORION_LD_URL}/subscriptions`, subPayload, {
        headers: { 
          'Content-Type': 'application/ld+json',
          'Accept': 'application/ld+json'
        }
      });
      console.log('Successfully created FIWARE subscription');
    } catch (error) {
      if (error.response && error.response.status !== 409) {
        console.error('Failed to setup FIWARE subscription:', error.message);
      }
    }
  }
}

module.exports = new FiwareGateway();
