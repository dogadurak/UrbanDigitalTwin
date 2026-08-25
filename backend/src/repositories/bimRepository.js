const db = require('./db');

class BimRepository {
  async getBuildingHierarchy(buildingId) {
    const floorsQuery = await db.query('SELECT * FROM floors WHERE building_id = $1 ORDER BY floor_number ASC', [buildingId]);
    const floors = floorsQuery.rows;

    for (let floor of floors) {
      const roomsQuery = await db.query('SELECT * FROM rooms WHERE floor_id = $1', [floor.id]);
      floor.rooms = roomsQuery.rows;

      for (let room of floor.rooms) {
        const devicesQuery = await db.query('SELECT * FROM iot_devices WHERE room_id = $1', [room.id]);
        room.devices = devicesQuery.rows;

        for (let device of room.devices) {
          const readingsQuery = await db.query('SELECT * FROM sensor_readings WHERE device_id = $1 ORDER BY measured_at DESC LIMIT 1', [device.id]);
          device.lastReading = readingsQuery.rows[0] || null;
        }
      }
    }

    return {
      id: buildingId,
      name: 'Izmir Pilot Building',
      status: 'NORMAL',
      activeAlerts: 0,
      powerLoad: 0,
      opex: 0,
      co2: 0,
      hvacEfficiency: 0,
      elevators: [
        { id: 'E1', currentFloor: 0, targetFloor: 0, status: 'IDLE' },
        { id: 'E2', currentFloor: 5, targetFloor: 5, status: 'IDLE' }
      ],
      floors: floors
    };
  }
}

module.exports = new BimRepository();
